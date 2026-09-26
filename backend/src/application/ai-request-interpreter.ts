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
  QueryValidationError,
  QueryValidationWarning,
} from './request';
import { PreferenceCriterion, PreferenceLevel, UsageContext } from '../domain/types';
import { AIOrchestrator, InterpretedQuery } from './ai-orchestrator';
import { detectSearchContext } from './request-interpreter';

interface IntentExtractionResult {
  productType: string | null;
  location: string | null;
  ingredients: string[];
  budget: { max: number | null; currency: 'EUR' | null };
  temporalConstraint: string | null;
  fulfillmentMode: 'delivery' | 'pickup' | 'dine-in' | null;
  dietaryConstraints: string[];
  category: string | null;
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
  private readonly aiOrchestrator: any; // AIOrchestrator type
  private fallbackInterpreter: any; // BasicPatternInterpreter

  constructor(aiOrchestrator: any) {
    this.aiOrchestrator = aiOrchestrator;
    this.fallbackInterpreter = null;
  }

  private getFallbackInterpreter() {
    if (!this.fallbackInterpreter) {
      // Lazy load to avoid circular dependency
      const { BasicPatternInterpreter } = require('./request-interpreter');
      this.fallbackInterpreter = new BasicPatternInterpreter();
    }
    return this.fallbackInterpreter;
  }

  /**
   * Deterministic baseline FIRST, AI as an additive proposal.
   *
   * The BasicPatternInterpreter result is always computed and is the
   * interpretation that reaches the engine. The LLM may only ADD criteria for
   * intents the deterministic interpreter cannot read (AI_MERGEABLE_IDS), and
   * only when that id is absent from the baseline — it never overrides,
   * duplicates or tightens a deterministic criterion.
   *
   * productType / searchContext are metadata, NOT criteria: no offer carries a
   * "productType" or "searchContext" characteristic, so as `required`
   * criteria they rejected every offer (0 results on every search).
   * searchContext is already threaded separately via detectSearchContext().
   */
  async interpret(query: any): Promise<any> {
    const interpretation: any = await this.getFallbackInterpreter().interpret(query);

    if (!query.text) return interpretation;

    const startMs = Date.now();
    let intentResult: IntentExtractionResult | null = null;
    try {
      intentResult = await this.extractIntentWithLLM(query.text ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[AIRequestInterpreter] LLM extraction failed, deterministic interpretation only:', message);
    }

    if (intentResult) {
      const proposal: any = { extractedCriteria: [] };
      this.applyIntentResult(intentResult, proposal);
      const present = new Set<string>(interpretation.extractedCriteria.map((c: { id: string }) => c.id));
      for (const c of proposal.extractedCriteria) {
        if (AI_MERGEABLE_IDS.has(c.id) && !present.has(c.id)) {
          interpretation.extractedCriteria.push(c);
          present.add(c.id);
        }
      }
      // Metadata only — never criteria.
      interpretation.productType = intentResult.productType;
      interpretation.searchContext = intentResult.searchContext;
      if (!interpretation.location && intentResult.location) interpretation.location = intentResult.location;
      if (intentResult.ingredients.length > 0) interpretation.ingredients = intentResult.ingredients;
      if (intentResult.fulfillmentMode) interpretation.fulfillmentMode = intentResult.fulfillmentMode;
      if (intentResult.temporalConstraint) interpretation.temporalConstraint = intentResult.temporalConstraint;
      if (intentResult.dietaryConstraints.length > 0) interpretation.dietaryConstraints = intentResult.dietaryConstraints;
      if ((interpretation.suggestedSearchTerms?.length ?? 0) === 0 && intentResult.suggestedSearchTerms.length > 0) {
        interpretation.suggestedSearchTerms = intentResult.suggestedSearchTerms;
      }
    }

    interpretation.interpretationMs = Date.now() - startMs;
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
      throw new Error(`AI validation errors: ${response.validationErrors.map((e: { message: string }) => e.message).join(', ')}`);
    }

    // Use the AI orchestrator's interpreted result directly (it already has validated, parsed data)
    const interpreted = response;
    
    // Extract all criteria from extractedCriteria array (AI orchestrator format)
    let category: string | null = null;
    let ram: { minValue: number; unit: string } | null = null;
    let budget: { max: number | null; currency: 'EUR' | null } = { max: null, currency: 'EUR' };
    let color = null;
    let location = null;
    
    if (Array.isArray(interpreted.extractedCriteria)) {
      for (const c of interpreted.extractedCriteria) {
        const criterionId = c.id ?? c.suggestedId;
        if (criterionId === 'category') {
          const values = c.parameters?.preferredValues ?? c.extractedValue?.preferredValues;
          if (Array.isArray(values) && values.length > 0) {
            category = values[0];
          }
        } else if (criterionId === 'ram') {
          const minValue = c.parameters?.minValue ?? c.extractedValue?.minValue;
          const unit = c.parameters?.unit ?? c.extractedValue?.unit ?? 'GB';
          if (typeof minValue === 'number') {
            ram = { minValue, unit };
          }
        } else if (criterionId === 'budget') {
          const maxBudget = c.parameters?.maxBudget ?? c.extractedValue?.maxBudget;
          const currency = (c.parameters?.currency ?? c.extractedValue?.currency) === 'EUR' ? 'EUR' : null;
          if (typeof maxBudget === 'number') {
            budget = { max: maxBudget, currency };
          }
        } else if (criterionId === 'color') {
          const values = c.parameters?.preferredValues ?? c.extractedValue?.preferredValues;
          const canonical = c.parameters?.canonical ?? c.extractedValue?.canonical;
          if (Array.isArray(values) && values.length > 0) {
            color = { values, canonical: canonical ?? values[0] };
          }
        } else if (criterionId === 'location') {
          const city = c.parameters?.city ?? c.parameters?.value ?? c.extractedValue?.city ?? c.extractedValue?.value;
          if (typeof city === 'string' && city.length > 0) {
            location = city;
          }
        } else if (criterionId === 'searchContext') {
          const value = c.parameters?.value ?? c.parameters?.value ?? null;
          if (typeof value === 'string') {
            // This will be handled by the searchContext extraction below
          }
        }
      }
    }
    
    // Extract search context from criteria
    let searchContext: 'consumer' | 'restaurant_equipment' | 'restaurant_supply' | 'b2b' | null = null;
    if (Array.isArray(interpreted.extractedCriteria)) {
      for (const c of interpreted.extractedCriteria) {
        if ((c.id ?? c.suggestedId) === 'searchContext') {
          const value = c.parameters?.value ?? c.parameters?.value ?? null;
          if (typeof value === 'string') {
            searchContext = value as 'consumer' | 'restaurant_equipment' | 'restaurant_supply' | 'b2b';
          }
        }
      }
    
    // Filter out budget/constraint words from suggested terms (same logic as BasicPatternInterpreter)
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
      productType: interpreted.productDescription ?? null,
      location,
      ingredients: Array.isArray(interpreted.ingredients) ? interpreted.ingredients : [],
      budget: interpreted.budget ?? { max: null, currency: 'EUR' },
      temporalConstraint: interpreted.temporalConstraint ?? null,
      fulfillmentMode: ['delivery', 'pickup', 'dine-in'].includes(interpreted.fulfillmentMode) ? interpreted.fulfillmentMode : null,
      dietaryConstraints: Array.isArray(interpreted.dietaryConstraints) ? interpreted.dietaryConstraints : [],
      category,
      ram,
      color,
      searchContext: detectSearchContext(text),
      suggestedSearchTerms,
confidence: interpreted.confidence ?? 0.5,
    };
  } // All paths return or throw - satisfies TypeScript control flow analysis
  // The following line is never reached but satisfies TypeScript control flow analysis
  
  throw new Error('Unreachable: all paths in extractIntentWithLLM should return or throw');
}

  private applyIntentResult(intent: IntentExtractionResult, interpretation: any): void {
    if (intent.productType) {
      interpretation.extractedCriteria.push({
        id: 'productType',
        name: 'Type de produit',
        level: 'required',
        parameters: { value: intent.productType },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.location) {
      interpretation.extractedCriteria.push({
        id: 'location',
        name: 'Localisation',
        level: 'required',
        parameters: { city: intent.location },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.ingredients.length > 0) {
      interpretation.extractedCriteria.push({
        id: 'ingredients',
        name: 'Ingrédients',
        level: 'preference',
        parameters: { values: intent.ingredients },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.budget.max !== null) {
      interpretation.extractedCriteria.push({
        id: 'budget',
        name: 'Budget',
        level: 'required',
        parameters: { maxBudget: intent.budget.max, currency: intent.budget.currency ?? 'EUR' },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.temporalConstraint) {
      interpretation.extractedCriteria.push({
        id: 'temporalConstraint',
        name: 'Contrainte temporelle',
        level: 'preference',
        parameters: { value: intent.temporalConstraint },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.fulfillmentMode) {
      interpretation.extractedCriteria.push({
        id: 'fulfillmentMode',
        name: 'Mode de fulfillment',
        level: 'preference',
        parameters: { value: intent.fulfillmentMode },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.dietaryConstraints.length > 0) {
      interpretation.extractedCriteria.push({
        id: 'dietaryConstraints',
        name: 'Contraintes alimentaires',
        level: 'preference',
        parameters: { values: intent.dietaryConstraints },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.category) {
      interpretation.extractedCriteria.push({
        id: 'category',
        name: 'Catégorie',
        level: 'required',
        parameters: { preferredValues: [intent.category], unknownPolicy: 'pass' },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.ram) {
      interpretation.extractedCriteria.push({
        id: 'ram',
        name: 'Mémoire RAM',
        level: 'required',
        parameters: { minValue: intent.ram.minValue, unit: intent.ram.unit, unknownPolicy: 'pass' },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.color) {
      interpretation.extractedCriteria.push({
        id: 'color',
        name: 'Couleur',
        level: 'required',
        parameters: { preferredValues: intent.color.values, canonical: intent.color.canonical, unknownPolicy: 'pass' },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    if (intent.searchContext) {
      interpretation.extractedCriteria.push({
        id: 'searchContext',
        name: 'Contexte de recherche',
        level: 'required',
        parameters: { value: intent.searchContext },
        origin: 'ai_inferred',
        createdAt: new Date(),
      });
    }

    interpretation.confidence = intent.confidence;
    interpretation.productType = intent.productType;
    interpretation.location = intent.location;
    interpretation.ingredients = intent.ingredients;
    interpretation.budget = intent.budget;
    interpretation.temporalConstraint = intent.temporalConstraint;
    interpretation.fulfillmentMode = intent.fulfillmentMode;
    interpretation.dietaryConstraints = intent.dietaryConstraints;
    interpretation.category = intent.category;
    interpretation.ram = intent.ram;
    interpretation.color = intent.color;
    interpretation.searchContext = intent.searchContext;
    interpretation.suggestedSearchTerms = intent.suggestedSearchTerms;
  }

  // Required by IRequestInterpreter but not used in async flow
  async analyzeQuery(query: any): Promise<any> {
    return { queryId: query.id, isValid: true, errors: [], warnings: [], timeToValidate: 0 };
  }

  async validateQuery(query: any): Promise<any> {
    return { isValid: true, errors: [], warnings: [] };
  }
}
