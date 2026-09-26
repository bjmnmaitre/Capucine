/**
 * Capucine — AI Request Interpreter
 *
 * Uses the AI Orchestrator (LLM) to interpret natural language queries into
 * structured criteria. Falls back to BasicPatternInterpreter on failure.
 *
 * INVARIANT: AI output is a PROPOSAL. It never directly reaches the Priority
 * Engine. Only high-confidence (>= 0.7) criteria with origin='ai_inferred'
 * are passed to the ProfileEngine for merging.
 */

import {
  UserQuery,
  InterpretedRequest,
  QueryAnalysis,
  QueryValidationResult,
} from './request';
import { PreferenceCriterion } from '../domain/types';
import { AIOrchestrator, InterpretedQuery } from './ai-orchestrator';
import { BasicPatternInterpreter, detectSearchContext } from './request-interpreter';

interface IntentExtractionResult {
  category: string | null;
  location: string | null;
  ingredients: string[];
  budget: { max: number | null; currency: 'EUR' | null };
  temporalConstraint: string | null;
  fulfillmentMode: 'delivery' | 'pickup' | 'dine-in' | null;
  dietaryConstraints: string[];
  ram: { minValue: number; unit: string } | null;
  color: { values: string[]; canonical: string } | null;
  searchContext: 'consumer' | 'restaurant_equipment' | 'restaurant_supply' | 'b2b' | string | null;
  suggestedSearchTerms: string[];
  confidence: number;
}

const SYSTEM_PROMPT = `Tu es un extracteur d'intention d'achat. Analyse la requête et retourne
UNIQUEMENT un JSON valide, sans markdown, sans explication.
Format :
{
  "productType": string | null,
  "location": string | null,
  "ingredients": string[],
  "budget": { "max": number | null, "currency": "EUR" | null },
  "temporalConstraint": string | null,
  "fulfillmentMode": "delivery" | "pickup" | "dine-in" | null,
  "dietaryConstraints": string[],
  "confidence": number
}
- location : ville mentionnée explicitement, sinon null
- confidence : 0.0 à 1.0
- Ne jamais retourner de texte hors JSON`;

/**
 * Criterion ids the LLM may contribute on top of the deterministic baseline:
 * intents BasicPatternInterpreter does not extract (food / restaurant flows),
 * plus location when the pattern interpreter missed the city.
 */
const AI_MERGEABLE_IDS = new Set<string>([
  'location', 'ingredients', 'temporalConstraint', 'fulfillmentMode', 'dietaryConstraints',
]);

export class AIRequestInterpreter {
  private readonly aiOrchestrator: AIOrchestrator;
  private fallbackInterpreter: BasicPatternInterpreter | null = null;

  constructor(aiOrchestrator: AIOrchestrator) {
    this.aiOrchestrator = aiOrchestrator;
  }

  private getFallbackInterpreter(): BasicPatternInterpreter {
    if (!this.fallbackInterpreter) {
      this.fallbackInterpreter = new BasicPatternInterpreter();
    }
    return this.fallbackInterpreter;
  }

  /**
   * Deterministic baseline FIRST, AI as an additive proposal.
   *
   * The BasicPatternInterpreter result is always computed and is what reaches
   * the engine. The LLM may only ADD criteria for intents the deterministic
   * interpreter cannot read (AI_MERGEABLE_IDS), and only when that id is
   * absent - it never overrides, duplicates or tightens a deterministic value.
   *
   * productType / searchContext are metadata, NOT criteria: no offer carries
   * those characteristics, so as `required` criteria they rejected every offer.
   */
  async interpret(query: UserQuery): Promise<InterpretedRequest> {
    const interpretation: InterpretedRequest = await this.getFallbackInterpreter().interpret(query);

    if (!query.text) return interpretation;

    let intentResult: IntentExtractionResult | null = null;
    try {
      intentResult = await this.extractIntentWithLLM(query.text ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[AIRequestInterpreter] LLM extraction failed, deterministic interpretation only:', message);
    }

    if (intentResult) {
      const proposal = { extractedCriteria: [] as PreferenceCriterion[] };
      this.applyIntentResult(intentResult, proposal);
      const present = new Set<string>(interpretation.extractedCriteria.map((c) => c.id));
      for (const c of proposal.extractedCriteria) {
        if (AI_MERGEABLE_IDS.has(c.id) && !present.has(c.id)) {
          interpretation.extractedCriteria.push(c);
          present.add(c.id);
        }
      }
      if (!interpretation.category && intentResult.category) interpretation.category = intentResult.category;
      interpretation.searchContext = intentResult.searchContext ?? interpretation.searchContext;
      if (!interpretation.location && intentResult.location) interpretation.location = intentResult.location;
      if (intentResult.suggestedSearchTerms.length > 0 && (interpretation.suggestedSearchTerms?.length ?? 0) === 0) {
        interpretation.suggestedSearchTerms = intentResult.suggestedSearchTerms;
      }
    }

    return interpretation;
  }

  private async extractIntentWithLLM(text: string): Promise<IntentExtractionResult> {
    const prompt = `Analyse cette requête d'achat : "${text}"`;

    const response = await this.aiOrchestrator.interpret({
      rawQuery: text,
      locale: 'fr',
      currency: 'EUR',
      conversationContext: `SYSTEM: ${SYSTEM_PROMPT}`,
    });

    if (response.validationErrors?.length) {
      throw new Error(`AI validation errors: ${response.validationErrors.map((e) => e.message).join(', ')}`);
    }

    const interpreted: InterpretedQuery = response;
    
    let category: string | null = null;
    let ram: { minValue: number; unit: string } | null = null;
    let budget: { max: number | null; currency: 'EUR' | null } = { max: null, currency: 'EUR' };
    let color: { values: string[]; canonical: string } | null = null;
    let location = null;
    const ingredients: string[] = [];
    let temporalConstraint: string | null = null;
    let fulfillmentMode: 'delivery' | 'pickup' | 'dine-in' | null = null;
    const dietaryConstraints: string[] = [];
    
    if (Array.isArray(interpreted.extractedCriteria)) {
      for (const c of interpreted.extractedCriteria) {
        const criterionId = c.suggestedId;
        const params = (c.extractedValue ?? {}) as Record<string, unknown>;
        
        if (criterionId === 'category') {
          const values = params.preferredValues;
          if (Array.isArray(values) && values.length > 0) {
            category = values[0];
          }
        } else if (criterionId === 'ram') {
          const minValue = params.minValue;
          const unit = (params.unit as string) ?? 'GB';
          if (typeof minValue === 'number') {
            ram = { minValue, unit };
          }
        } else if (criterionId === 'budget') {
          const maxBudget = params.maxBudget;
          const currency = params.currency === 'EUR' ? 'EUR' : null;
          if (typeof maxBudget === 'number') {
            budget = { max: maxBudget, currency };
          }
        } else if (criterionId === 'color') {
          const values = params.preferredValues;
          const canonical = params.canonical;
          if (Array.isArray(values) && values.length > 0) {
            color = { values, canonical: canonical ?? values[0] };
          }
        } else if (criterionId === 'location') {
          const city = params.city ?? params.value;
          if (typeof city === 'string' && city.length > 0) {
            location = city;
          }
        } else if (criterionId === 'ingredients') {
          const values = params.values;
          if (Array.isArray(values)) {
            ingredients.push(...values.filter((v): v is string => typeof v === 'string'));
          }
        } else if (criterionId === 'temporalConstraint') {
          const value = params.value;
          if (typeof value === 'string') {
            temporalConstraint = value;
          }
        } else if (criterionId === 'fulfillmentMode') {
          const value = params.value;
          if (['delivery', 'pickup', 'dine-in'].includes(value as string)) {
            fulfillmentMode = value as 'delivery' | 'pickup' | 'dine-in';
          }
        } else if (criterionId === 'dietaryConstraints') {
          const values = params.values;
          if (Array.isArray(values)) {
            dietaryConstraints.push(...values.filter((v): v is string => typeof v === 'string'));
          }
        }
      }
    }
    
    let searchContext: 'consumer' | 'restaurant_equipment' | 'restaurant_supply' | 'b2b' | null = null;
    if (Array.isArray(interpreted.extractedCriteria)) {
      for (const c of interpreted.extractedCriteria) {
        if (c.suggestedId === 'searchContext') {
          const params = (c.extractedValue ?? {}) as Record<string, unknown>;
          const value = params.value;
          if (typeof value === 'string') {
            searchContext = value as 'consumer' | 'restaurant_equipment' | 'restaurant_supply' | 'b2b';
          }
        }
      }
    }
    
    const BUDGET_STOP = new Set([
      'budget', 'euros', 'euro', 'maximum', 'minimum', 'maxi', 'moins', 'plus',
      'cherche', 'cherches', 'cherchez', 'cherchons',
      'trouve', 'trouves', 'trouvez', 'trouvons', 'trouver', 'trouve-moi',
      'montre', 'montres', 'montrez', 'montrons', 'montrer',
      'recherche', 'recherches', 'recherchez', 'rechercher',
      'affiche', 'affichez', 'afficher',
      'propose', 'proposez', 'proposer',
      'donne', 'donnez', 'donner',
      'veux', 'voudrais', 'besoin', 'acheter', 'avoir', 'faut',
      'uniquement', 'seulement', 'finalement',
      'dans', 'pour', 'avec', 'sans', 'mais', 'plus', 'très',
      'impérativement', 'absolument', 'obligatoirement', 'idéalement',
      'notamment', 'surtout', 'aussi', 'encore', 'toujours',
      'looking', 'search', 'find', 'show', 'need', 'want', 'like', 'prefer',
      'that', 'this', 'with', 'from', 'have', 'should', 'could', 'would',
    ]);
    const suggestedSearchTerms = Array.isArray(interpreted.suggestedTerms)
      ? interpreted.suggestedTerms.filter((t: string) => t.length >= 3 && !BUDGET_STOP.has(t.toLowerCase()) && !/^\d+$/.test(t))
      : [];
    
    return {
      location,
      ingredients,
      budget,
      temporalConstraint,
      fulfillmentMode,
      dietaryConstraints,
      category,
      ram,
      color,
      searchContext: detectSearchContext(text),
      suggestedSearchTerms,
      confidence: interpreted.confidence ?? 0.5,
    };
  }

  private applyIntentResult(intent: IntentExtractionResult, proposal: { extractedCriteria: PreferenceCriterion[] }): void {
    if (intent.category) {
      proposal.extractedCriteria.push({
        id: 'category',
        name: 'Catégorie',
        level: 'required',
        parameters: { preferredValues: [intent.category], unknownPolicy: 'pass' },
      });
    }

    if (intent.location) {
      proposal.extractedCriteria.push({
        id: 'location',
        name: 'Localisation',
        level: 'required',
        parameters: { city: intent.location },
      });
    }

    if (intent.ingredients.length > 0) {
      proposal.extractedCriteria.push({
        id: 'ingredients',
        name: 'Ingrédients',
        level: 'preference',
        parameters: { values: intent.ingredients },
      });
    }

    if (intent.budget.max !== null) {
      proposal.extractedCriteria.push({
        id: 'budget',
        name: 'Budget',
        level: 'required',
        parameters: { maxBudget: intent.budget.max, currency: intent.budget.currency ?? 'EUR' },
      });
    }

    if (intent.temporalConstraint) {
      proposal.extractedCriteria.push({
        id: 'temporalConstraint',
        name: 'Contrainte temporelle',
        level: 'preference',
        parameters: { value: intent.temporalConstraint },
      });
    }

    if (intent.fulfillmentMode) {
      proposal.extractedCriteria.push({
        id: 'fulfillmentMode',
        name: 'Mode de fulfillment',
        level: 'preference',
        parameters: { value: intent.fulfillmentMode },
      });
    }

    if (intent.dietaryConstraints.length > 0) {
      proposal.extractedCriteria.push({
        id: 'dietaryConstraints',
        name: 'Contraintes alimentaires',
        level: 'preference',
        parameters: { values: intent.dietaryConstraints },
      });
    }

    if (intent.ram) {
      proposal.extractedCriteria.push({
        id: 'ram',
        name: 'Mémoire RAM',
        level: 'required',
        parameters: { minValue: intent.ram.minValue, unit: intent.ram.unit, unknownPolicy: 'pass' },
      });
    }

    if (intent.color) {
      proposal.extractedCriteria.push({
        id: 'color',
        name: 'Couleur',
        level: 'required',
        parameters: { preferredValues: intent.color.values, canonical: intent.color.canonical, unknownPolicy: 'pass' },
      });
    }

    if (intent.searchContext) {
      proposal.extractedCriteria.push({
        id: 'searchContext',
        name: 'Contexte de recherche',
        level: 'required',
        parameters: { value: intent.searchContext },
      });
    }
  }

  async analyzeQuery(query: UserQuery): Promise<QueryAnalysis> {
    return {
      queryId: query.id,
      analysisTime: new Date(),
      queryLength: query.text?.length ?? 0,
      estimatedComplexity: 'simple',
      isTimeConstrained: false,
      detectedCategories: [],
      ambiguityCount: 0,
      averageAmbiguityConfidence: 0,
      isRankable: true,
      needsClarification: false,
      estimatedClarificationQuestions: 0,
    };
  }

  async validateQuery(query: UserQuery): Promise<QueryValidationResult> {
    return { queryId: query.id, isValid: true, errors: [], warnings: [], timeToValidate: 0 };
  }
}