/**
 * Capucine — AI Orchestrator
 *
 * The AIOrchestrator is the SINGLE point of contact between Capucine's decision
 * engine and AI providers. It enforces strict separation:
 *
 * AI CAN:
 * - Parse natural language into structured criteria
 * - Generate search query terms and synonyms
 * - Produce human-readable explanations of results
 * - Identify missing information (clarification questions)
 * - Classify/translate text data
 *
 * AI CANNOT:
 * - Influence the Priority Engine ranking
 * - Change a criterion's level (required/forbidden) without explicit user consent
 * - Add constraints that the user didn't express
 * - Override admissibility decisions
 * - Inject unverified data into DataPoint<T> as 'verified'
 *
 * INVARIANT: AI output feeds the INTERPRETATION layer, never the RANKING layer directly.
 *
 * GATE 19 + GATE 20 + GATE 21 + GATE 22 + GATE 23 IMPLEMENTATION
 */

import { CurrentSearchRequirements, PreferenceCriterion, AIInterpretationResult } from '../domain/types';
import { GenericCriterion } from '../domain/criterion';
import { ModelRouter, AITaskType } from './model-router';
import { aiOutputValidator } from './ai-output-validator';
import { detectSearchContext } from './request-interpreter';

// ============================================================================
// AI PROVIDER ABSTRACTION (low-level)
// ============================================================================

export type AICapability = 'text_generation' | 'text_classification' | 'image_analysis' | 'structured_output';
export type ModelTier = 'fast' | 'balanced' | 'reasoning' | 'vision';
export type TaskClassification = 'interpretation' | 'explanation' | 'classification' | 'generation';

export interface AIRequest {
  prompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AIResponse {
  content: string;
  providerName: string;
  model: string;
  tokensUsed?: number;
  durationMs?: number;
}

export interface AIProvider {
  readonly name: string;
  readonly capabilities: AICapability[];
  selectModel(tier: ModelTier): string;
  complete(request: AIRequest): Promise<AIResponse>;
}

// ============================================================================
// ORCHESTRATOR CONFIG
// ============================================================================

export interface OrchestratorConfig {
  /** Providers available, in priority order */
  providers: AIProvider[];

  /** Maximum retries on provider failure */
  maxRetries: number;

  /** Allow fallback to a different provider on failure? */
  fallbackEnabled: boolean;

  /** Strict mode: reject ANY AI output that doesn't match expected schema */
  strictValidation: boolean;

  /** Log all AI interactions for audit? */
  auditMode: boolean;
}

// ============================================================================
// INTERPRETATION REQUEST/RESULT
// ============================================================================

/**
 * Request to AI: "interpret this natural language query"
 */
export interface InterpretationRequest {
  rawQuery: string;
  locale: string;
  currency: string;

  /** Context from previous turns (if any) */
  conversationContext?: string;

  /** What the user's profile says (for AI context only — NOT passed to ranking) */
  profileHints?: string[];
}

/**
 * AI's structured interpretation of a natural language query.
 *
 * INVARIANT: This is a PROPOSAL, not a command.
 * The user must confirm significant inferences before they affect ranking.
 * Low-confidence fields must be surfaced for clarification.
 */
export interface InterpretedQuery {
  /** What the AI understood the user to want */
  productDescription: string;

  /** Extracted criteria (AI's best guess) */
  extractedCriteria: ExtractedCriterion[];

  /** Search terms suggested by AI */
  suggestedTerms: string[];

  /** Alternative terms / synonyms */
  synonyms: string[];

  /** The search context: 'consumer', 'restaurant_equipment', 'restaurant_supply', 'b2b' */
  searchContext: string;

  /** Things the AI is NOT sure about */
  uncertainties: string[];

  /** Questions that would help narrow the search */
  clarificationOpportunities: ClarificationOpportunity[];

  /** AI's confidence in the interpretation (0-1) */
  confidence: number;

  /** Raw AI response for audit trail */
  rawResponse: string;

  /** Which provider was used */
  providerUsed: string;

  /** Which model tier was selected */
  tierUsed: ModelTier;

  /** Validation errors from AIOutputValidator (empty = all clean) */
  validationErrors?: import('./ai-output-validator').ValidationError[];
}

export interface ExtractedCriterion {
  /** Human-readable criterion name */
  name: string;

  /** Suggested criterion ID */
  suggestedId: string;

  /** What the AI extracted */
  extractedValue: unknown;

  /** How confident is the AI? */
  confidence: 'certain' | 'likely' | 'possible' | 'uncertain';

  /** What level should this be? (AI suggestion only) */
  suggestedLevel: 'required' | 'very_important' | 'important' | 'preference' | 'unknown';

  /** Is this explicitly stated or inferred? */
  origin: 'explicit' | 'inferred';

  /** Quote from user's message that led to this criterion */
  evidence?: string;
}

export interface ClarificationOpportunity {
  criterionId: string;
  question: string;
  priority: 'high' | 'medium' | 'low';
  /** Would the answer materially change results? */
  impactsResults: boolean;
}

// ============================================================================
// EXPLANATION REQUEST/RESULT
// ============================================================================

/**
 * Request to AI: "explain this ranking to the user in natural language"
 *
 * IMPORTANT: The explanation is generated AFTER ranking, from the deterministic
 * ranking data. AI translates numbers/criteria into prose. AI does NOT compute
 * the ranking.
 */
export interface ExplanationRequest {
  locale: string;
  offerTitle: string;
  rank: number;
  totalOffers: number;
  score: number;

  /** The criteria breakdown that drove ranking (already computed by Priority Engine) */
  criteriaBreakdown: Array<{
    name: string;
    score: number;
    level: string;
    contribution: 'positive' | 'neutral' | 'negative';
    reason?: string;
  }>;

  /** What was rejected and why (already computed by Admissibility Engine) */
  rejectedOffers?: Array<{
    title: string;
    primaryReason: string;
  }>;
}

export interface ExplanationResult {
  /** Human-readable explanation for the user */
  naturalLanguageExplanation: string;

  /** Key points (for structured UI display) */
  keyPoints: string[];

  /** Provider used */
  providerUsed: string;
}

// ============================================================================
// AUDIT LOG
// ============================================================================

export interface AIAuditEntry {
  id: string;
  timestamp: Date;
  operation: 'interpret' | 'explain' | 'synonyms' | 'clarify' | 'classify';
  providerUsed: string;
  tierUsed: ModelTier;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;

  /** CRITICAL: Did any AI output reach the Priority Engine? MUST be false. */
  reachedRankingEngine: false;

  /** Was output validated before use? */
  validationPassed: boolean;
}

// ============================================================================
// AI ORCHESTRATOR
// ============================================================================

/**
 * Central coordinator for all AI interactions.
 *
 * ARCHITECTURAL GUARANTEE:
 * No output from this orchestrator ever reaches the Priority Engine directly.
 * All AI output is:
 * 1. Validated against expected schema
 * 2. Marked as 'ai_inferred' status (not 'verified')
 * 3. Surfaced to the user for confirmation if significant
 * 4. Passed only to the INTERPRETATION layer, never the RANKING layer
 */
/**
 * Process-wide rate-limit cooldowns (provider name -> epoch ms until which it
 * is skipped). Written by AIOrchestrator on HTTP 429, read by GET /health.
 */
export const providerCooldownUntil = new Map<string, number>();

export function isProviderInCooldown(providerName: string, now: number = Date.now()): boolean {
  const until = providerCooldownUntil.get(providerName);
  return until !== undefined && now < until;
}

export class AIOrchestrator {
  private readonly providers: AIProvider[];
  private readonly config: OrchestratorConfig;
  private readonly auditLog: AIAuditEntry[] = [];
  private readonly modelRouter: ModelRouter;

  constructor(providers: AIProvider[], config: Partial<OrchestratorConfig> = {}) {
    this.providers = providers;
    this.config = {
      providers,
      maxRetries: 2,
      fallbackEnabled: true,
      strictValidation: true,
      auditMode: true,
      ...config,
    };
    this.modelRouter = new ModelRouter();
  }

  /**
   * Route an AI task type to the appropriate model tier.
   * DETERMINISTIC: Same task type + context → same tier.
   * Delegates to ModelRouter (no hardcoded tier strings in methods below).
   */
  private routeTier(taskType: AITaskType, opts: { userFacing?: boolean; costSensitive?: boolean } = {}): ModelTier {
    const decision = this.modelRouter.route({
      taskType,
      userFacing: opts.userFacing ?? false,
      costSensitive: opts.costSensitive ?? false,
    });
    return decision.recommendedTier;
  }

  // ── Interpretation ─────────────────────────────────────────────────────────

  /**
   * Interpret a natural language query into structured criteria.
   *
   * INVARIANT: The returned InterpretedQuery is a PROPOSAL.
   * Nothing from this output is passed to the Priority Engine until:
   * 1. Converted to PreferenceCriterion with origin='ai_inferred'
   * 2. High-confidence criteria only (confidence >= 0.7)
   * 3. User confirms significant inferences
   */
  async interpret(request: InterpretationRequest): Promise<InterpretedQuery> {
    const start = Date.now();

    const prompt = this.buildInterpretationPrompt(request);
    const response = await this.callWithFallback({
      prompt,
      capability: 'text_generation',
      tier: this.routeTier('query_interpretation', { userFacing: true }),
      maxTokens: 1500,
    });

    const interpreted = this.parseInterpretationResponse(response);

    this.logAudit({
      operation: 'interpret',
      providerUsed: response.providerName,
      tierUsed: 'balanced',
      inputSummary: `Query: "${request.rawQuery}"`,
      outputSummary: `${interpreted.extractedCriteria.length} criteria, confidence: ${interpreted.confidence}`,
      durationMs: Date.now() - start,
      validationPassed: !interpreted.validationErrors?.length,
    });

    return interpreted;
  }

  /**
   * Generate search terms and synonyms for a query.
   * Fast operation — uses lightweight model.
   */
  async generateSearchTerms(
    productDescription: string,
    locale: string
  ): Promise<{ primaryTerms: string[]; synonyms: string[]; alternativeSpellings: string[] }> {
    const start = Date.now();

    const response = await this.callWithFallback({
      prompt: `Generate search terms for: "${productDescription}" in locale ${locale}.
Return JSON: {"primaryTerms": [], "synonyms": [], "alternativeSpellings": []}`,
      capability: 'text_generation',
      tier: this.routeTier('search_term_generation', { costSensitive: true }),
      maxTokens: 500,
    });

    // Parse + validate through AIOutputValidator
    const { parsed: rawParsed, error: parseError } = aiOutputValidator.parseJSON(response.content);
    const fallback = [productDescription];
    const validation = aiOutputValidator.validateSearchTerms(rawParsed, fallback);

    this.logAudit({
      operation: 'synonyms',
      providerUsed: response.providerName,
      tierUsed: 'fast',
      inputSummary: `Product: "${productDescription}"`,
      outputSummary: `Generated terms (${validation.value.primaryTerms.length} primary)`,
      durationMs: Date.now() - start,
      validationPassed: validation.valid && !parseError,
    });

    return validation.value;
  }

  /**
   * Generate a natural-language explanation of a ranking.
   *
   * INVARIANT: AI is only explaining pre-computed data. It is NOT computing
   * a ranking or adding new evaluations.
   */
  async explain(request: ExplanationRequest): Promise<ExplanationResult> {
    const start = Date.now();

    const prompt = this.buildExplanationPrompt(request);
    const response = await this.callWithFallback({
      prompt,
      capability: 'text_generation',
      tier: this.routeTier('explanation_prose', { userFacing: true }),
      maxTokens: 800,
    });

    this.logAudit({
      operation: 'explain',
      providerUsed: response.providerName,
      tierUsed: 'balanced',
      inputSummary: `Offer rank ${request.rank}, score ${request.score}`,
      outputSummary: `Explanation generated`,
      durationMs: Date.now() - start,
      validationPassed: true,
    });

    return {
      naturalLanguageExplanation: response.content,
      keyPoints: this.extractKeyPoints(response.content),
      providerUsed: response.providerName,
    };
  }

  /**
   * Identify what clarification questions to ask the user.
   * Based on missing/uncertain criteria that would materially change results.
   */
  async identifyClarifications(
    rawQuery: string,
    interpretedCriteria: PreferenceCriterion[],
    locale: string
  ): Promise<ClarificationOpportunity[]> {
    const start = Date.now();

    const prompt = `User asked: "${rawQuery}"
We extracted these criteria: ${JSON.stringify(interpretedCriteria.map(c => ({ id: c.id, name: c.name, level: c.level })))}

What clarification questions would materially change the search results?
Return JSON array: [{"criterionId": "", "question": "", "priority": "high|medium|low", "impactsResults": true|false}]`;

    const response = await this.callWithFallback({
      prompt,
      capability: 'text_generation',
      tier: this.routeTier('clarification_phrasing', { userFacing: true }),
      maxTokens: 600,
    });

    // Parse + validate through AIOutputValidator
    const { parsed: rawParsed, error: parseError } = aiOutputValidator.parseJSON(response.content);
    const validation = aiOutputValidator.validateClarificationQuestions(rawParsed);

    this.logAudit({
      operation: 'clarify',
      providerUsed: response.providerName,
      tierUsed: 'fast',
      inputSummary: `${interpretedCriteria.length} criteria`,
      outputSummary: `${validation.value.length} clarification question(s) validated`,
      durationMs: Date.now() - start,
      validationPassed: validation.valid && !parseError,
    });

    // Map to ClarificationOpportunity shape
    return validation.value.map(q => ({
      criterionId: q.id,
      question: q.question,
      priority: q.urgency === 'blocking' ? 'high' : q.urgency === 'important' ? 'medium' : 'low',
      impactsResults: q.urgency !== 'optional',
    } as ClarificationOpportunity));
  }

  /**
   * Get the audit log.
   * INVARIANT: All entries have reachedRankingEngine: false
   */
  getAuditLog(): AIAuditEntry[] {
    return [...this.auditLog];
  }

  // ── Provider abstraction ───────────────────────────────────────────────────

  // Per-provider cooldown tracking for rate limits (429)
  private readonly providerCooldowns = new Map<string, number>();

  private isInCooldown(providerName: string): boolean {
    const until = this.providerCooldowns.get(providerName);
    return until !== undefined && Date.now() < until;
  }

  private setCooldown(providerName: string, durationMs: number): void {
    const until = Date.now() + durationMs;
    this.providerCooldowns.set(providerName, until);
    providerCooldownUntil.set(providerName, until);
  }

  private async callWithFallback(request: {
    prompt: string;
    capability: AICapability;
    tier: ModelTier;
    maxTokens?: number;
  }): Promise<AIResponse> {
    const errors: Error[] = [];

    for (const provider of this.providers) {
      if (!provider.capabilities.includes(request.capability)) continue;
      if (this.isInCooldown(provider.name)) continue;

      const model = provider.selectModel(request.tier);
      if (!model) continue;

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          const aiRequest: AIRequest = {
            prompt: request.prompt,
            model,
            maxTokens: request.maxTokens || 1000,
            temperature: request.tier === 'fast' ? 0.1 : 0.3,
          };

          const response = await provider.complete(aiRequest);
          return response;
        } catch (err) {
          const error = err as Error;
          errors.push(error);

          // Check for rate limit (429) — put provider in cooldown and try next
          if (error.message.includes('HTTP 429')) {
            this.setCooldown(provider.name, 60_000);
            console.log(`[AI-FALLBACK] ${provider.name} → rate limited (429), cooldown 60s`);
            break; // Break retry loop, try next provider
          }

          if (!this.config.fallbackEnabled) throw err;
        }
      }
    }

    // If all providers failed or in cooldown, try MockAI as last resort
    console.log(`[AI-FALLBACK] → MockAI (all providers failed or in cooldown)`);
    const mockProvider = this.providers.find(p => p.name.includes('MockAI')) || new MockAIProvider();
    const model = mockProvider.selectModel(request.tier);
    if (!model) throw new Error(`MockAI has no model for tier ${request.tier}`);
    const aiRequest: AIRequest = {
      prompt: request.prompt,
      model,
      maxTokens: request.maxTokens || 1000,
      temperature: request.tier === 'fast' ? 0.1 : 0.3,
    };
    return mockProvider.complete(aiRequest);
  }

  // ── Prompt builders ────────────────────────────────────────────────────────

  private buildInterpretationPrompt(request: InterpretationRequest): string {
    return `You are helping parse a shopping query for Capucine, a personal shopping agent.

User query (locale: ${request.locale}, currency: ${request.currency}):
"${request.rawQuery}"

${request.conversationContext ? `Conversation context:\n${request.conversationContext}\n` : ''}

Extract structured search criteria. Return valid JSON matching this schema:
{
  "productDescription": "what the user wants",
  "extractedCriteria": [
    {
      "name": "Budget",
      "id": "price",
      "parameters": { "value": 500 },
      "confidence": "certain|likely|possible|uncertain",
      "level": "required|very_important|important|preference|unknown",
      "origin": "explicit|inferred",
      "evidence": "quote from user message"
    }
  ],
  "suggestedTerms": ["search term 1"],
  "synonyms": ["alternative term"],
  "searchContext": "consumer|restaurant_equipment|restaurant_supply|b2b",
  "uncertainties": ["what is unclear"],
  "clarificationOpportunities": [
    {
      "criterionId": "condition",
      "question": "Neuf ou occasion ?",
      "priority": "high|medium|low",
      "impactsResults": true
    }
  ],
  "confidence": 0.85
}

CRITICAL: Only extract criteria that are ACTUALLY mentioned or strongly implied.
Do NOT invent criteria the user didn't express.
Mark inferred criteria with origin: "inferred" and confidence: "possible" or lower.
Determine searchContext: use "restaurant_equipment" for professional kitchen/restaurant equipment (fours, planchas, vitrines, fours à pizza, pianos de cuisson, chambres froides, friteuses professionnelles, lave-vaisselle professionnels, bains-marie, salamandres, trancheuses, hachoirs professionnels, cellules de refroidissement, matériel restaurant, équipement CHR), "restaurant_supply" for consumables (emballages, couverts jetables), "b2b" for wholesale/grossiste queries, otherwise "consumer".`;
  }

  private buildExplanationPrompt(request: ExplanationRequest): string {
    const breakdownText = request.criteriaBreakdown
      .map(c => `- ${c.name}: ${c.score}/100 (${c.level}) — ${c.reason || c.contribution}`)
      .join('\n');

    return `Explain in 2-3 sentences why this offer ranked #${request.rank} out of ${request.totalOffers}.

Offer: "${request.offerTitle}"
Overall score: ${request.score}/100

Criteria breakdown:
${breakdownText}

Be precise and factual. Mention the most impactful criteria.
Do not invent any information not present in the data above.`;
  }

  private parseInterpretationResponse(response: AIResponse): InterpretedQuery {
    const { parsed: rawParsed, error: parseError } = aiOutputValidator.parseJSON(response.content);

    if (parseError) {
      // JSON parse failure — safe minimum, no AI-supplied data reaches the engine
      return {
        productDescription: '',
        extractedCriteria: [],
        suggestedTerms: [],
        synonyms: [],
        searchContext: 'consumer',
        uncertainties: ['AI response could not be parsed'],
        clarificationOpportunities: [],
        confidence: 0,
        rawResponse: response.content,
        providerUsed: response.providerName,
        tierUsed: 'balanced',
        validationErrors: [parseError],
      };
    }

    const validation = aiOutputValidator.validateInterpretation(rawParsed);

    if (validation.usedFallback) {
      return {
        productDescription: '',
        extractedCriteria: [],
        suggestedTerms: [],
        synonyms: [],
        searchContext: 'consumer',
        uncertainties: validation.errors.map(e => `${e.field}: ${e.message}`),
        clarificationOpportunities: [],
        confidence: 0,
        rawResponse: response.content,
        providerUsed: response.providerName,
        tierUsed: 'balanced',
        validationErrors: validation.errors,
      };
    }

    // Partial success: use what validated, drop what didn't
    const v = validation.value;
    const obj = rawParsed as Record<string, unknown>;

    return {
      productDescription: v.productDescription,
      // Only validated criteria enter the pipeline; mapped to ExtractedCriterion shape
      extractedCriteria: v.extractedCriteria.map(c => ({
        name: c.name,
        suggestedId: c.id,
        extractedValue: c.parameters,
        confidence: 'possible' as const,
        suggestedLevel: (c.level === 'required' || c.level === 'very_important' || c.level === 'important' || c.level === 'preference')
          ? c.level as 'required' | 'very_important' | 'important' | 'preference'
          : 'preference' as const,
        origin: 'inferred' as const,
      })),
      suggestedTerms: v.suggestedTerms,
      synonyms: Array.isArray(obj.synonyms) ? (obj.synonyms as string[]).filter(s => typeof s === 'string').slice(0, 20) : [],
      searchContext: typeof obj.searchContext === 'string' ? obj.searchContext : 'consumer',
      uncertainties: Array.isArray(obj.uncertainties) ? (obj.uncertainties as string[]).filter(s => typeof s === 'string').slice(0, 10) : [],
      clarificationOpportunities: Array.isArray(obj.clarificationOpportunities) ? obj.clarificationOpportunities as ClarificationOpportunity[] : [],
      confidence: v.confidence,
      rawResponse: response.content,
      providerUsed: response.providerName,
      tierUsed: 'balanced',
      validationErrors: validation.errors,
    };
  }

  private extractKeyPoints(explanation: string): string[] {
    // Simple extraction: split by sentence, take first 3
    return explanation
      .split(/[.!?]/)
      .map(s => s.trim())
      .filter(s => s.length > 20)
      .slice(0, 3);
  }

  private logAudit(entry: Omit<AIAuditEntry, 'id' | 'timestamp' | 'reachedRankingEngine'>): void {
    if (!this.config.auditMode) return;

    this.auditLog.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      reachedRankingEngine: false, // INVARIANT: always false
      ...entry,
    });
  }
}

// ============================================================================
// SEARCH CONTEXT DETECTION
// ============================================================================

// ============================================================================
// MOCK AI PROVIDER (for testing)
// ============================================================================
// MOCKED: This provider is used exclusively in tests and offline pipeline demos.
// It does not call any real AI service.

export class MockAIProvider implements AIProvider {
  readonly name = 'MockAI [MOCKED]';
  readonly capabilities: AICapability[] = ['text_generation', 'text_classification'];

  selectModel(tier: ModelTier): string {
    return `mock-${tier}`;
  }

async complete(request: AIRequest): Promise<AIResponse> {
    // Return a realistic-looking mock response based on prompt keywords
    const prompt = request.prompt.toLowerCase();

    // Extract the actual user query from the prompt (strip system prompt)
    // The prompt format is: "User query (locale: fr, currency: EUR):\n\"ordinateur portable\""
    const userQueryMatch = request.prompt.match(/User query\s*\([^)]*\):\s*\n?"([^"]+)"/i) || request.prompt.match(/user\s*\([^)]*\):\s*\n?"([^"]+)"/i) || request.prompt.match(/"([^"]+)"\s*$/);
    const query = userQueryMatch ? userQueryMatch[1].toLowerCase() : request.prompt.toLowerCase();

    // Helper to build criteria based on query content
    const buildCriteria = (query: string) => {
      const criteria = [];
      
      // Detect category
      // 'portable' alone is NOT enough ("enceinte portable", "batterie portable"): a computer word is required.
      if (/\b(?:ordinateur|laptop|notebook|macbook|thinkpad|pc\s+portable)\b/i.test(query)) {
        criteria.push({ id: 'category', name: 'Catégorie', level: 'required', parameters: { preferredValues: ['ordinateur_portable'] } });
      } else if (query.includes('casque') || query.includes('headphone') || query.includes('airpod') || query.includes('sony xm') || query.includes('sony wh')) {
        criteria.push({ id: 'category', name: 'Catégorie', level: 'required', parameters: { preferredValues: ['casque'] } });
      } else if (query.includes('four professionnel') || query.includes('four pizza') || query.includes('four à pizza') || query.includes('pizza oven') || query.includes('professional oven') || query.includes('commercial oven')) {
        criteria.push({ id: 'category', name: 'Catégorie', level: 'required', parameters: { preferredValues: ['four_professionnel'] } });
      }
      
      // Detect brands
      const chrBrands = ['rational', 'hobart', 'unox', 'giorik', 'fagor', 'zanussi', 'electrolux professional', 'welbilt', 'manitowoc'];
      const consumerBrands = ['sony', 'samsung', 'apple', 'lg', 'bose', 'jbl', 'dyson', 'philips', 'bosch', 'siemens'];
      const allBrands = [...chrBrands, ...consumerBrands];
      for (const brand of allBrands) {
        const brandRegex = new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`, 'i');
        if (brandRegex.test(query)) {
          criteria.push({ id: 'brand', name: 'Marque', level: 'required', parameters: { preferredValues: [brand] } });
          break;
        }
      }
      
      // Detect location (French cities)
      const locationPatterns = [
        'paris', 'lyon', 'marseille', 'toulouse', 'nice', 'nantes', 'strasbourg', 'montpellier',
        'bordeaux', 'lille', 'rennes', 'reims', 'saint-étienne', 'toulon', 'grenoble', 'dijon',
        'angers', 'villeurbanne', 'le mans', 'aix-en-provence', 'clermont-ferrand', 'brest',
        'limoges', 'tours', 'amiens', 'perpignan', 'besançon', 'orléans', 'mulhouse', 'rouen',
        'caen', 'nancy', 'saint-étienne', 'dunkerque', 'tourcoing', 'nanterre', 'avignon',
        'la rochelle', 'la roche sur yon', 'la rochellle', 'la roche sur yon'
      ];
      for (const city of locationPatterns) {
        const cityRegex = new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i');
        if (cityRegex.test(query)) {
          criteria.push({ id: 'location', name: 'Localisation', level: 'required', parameters: { city: city } });
          break;
        }
      }
      
      // Detect color (use word boundaries to avoid matching substrings like "bluetooth" → "bleu")
      const colorPatterns = [
        { canonical: 'noir', values: ['noir', 'black'], regex: /\b(noir|black)\b/i },
        { canonical: 'blanc', values: ['blanc', 'white'], regex: /\b(blanc|white)\b/i },
        { canonical: 'gris', values: ['gris', 'grey', 'gray'], regex: /\b(gris|grey|gray)\b/i },
        { canonical: 'bleu', values: ['bleu', 'blue'], regex: /\b(bleu|blue)\b/i },
        { canonical: 'rouge', values: ['rouge', 'red'], regex: /\b(rouge|red)\b/i },
      ];
      for (const cp of colorPatterns) {
        if (cp.regex.test(query)) {
          criteria.push({ id: 'color', name: 'Couleur', level: 'required', parameters: { preferredValues: cp.values, canonical: cp.canonical } });
          break;
        }
      }
      
      // Detect condition
      // Word boundaries: 'new' must not match "news" / "renew".
      if (/\b(?:neuf|neuve|neufs|neuves|brand\s+new|new)\b/i.test(query)) {
        criteria.push({ id: 'condition', name: 'État du produit', level: 'required', parameters: { preferredValues: ['new'] } });
      } else if (/\b(?:occasion|used|reconditionn[ée]e?s?|refurbished)(?![\wÀ-ÿ])/i.test(query)) {
        criteria.push({ id: 'condition', name: 'État du produit', level: 'required', parameters: { preferredValues: ['used'] } });
      }
      
      // Detect RAM - match patterns like "16 Go RAM", "16 Go de RAM", "16GB RAM", "RAM 16 Go", "16 Go" (when likely RAM)
      const ramMatch = query.match(/(\d+)\s*(?:go|gb)\s*(?:de\s*)?ram\b/i) || query.match(/ram\s*(?:de\s*)?(\d+)\s*(?:go|gb)\b/i) || query.match(/(?:^|\s)(\d+)\s*(?:go|gb)(?=\s|$|moins|sous|max|€)/i);
      if (ramMatch) {
        criteria.push({ id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: parseInt(ramMatch[1]), unit: 'GB', unknownPolicy: 'pass' } });
      }
      
      // Detect budget
      const budgetMatch = query.match(/(?:moins de|sous|max|maximum|budget)\s*(\d+)/i) || query.match(/(\d+)\s*€/i);
      if (budgetMatch) {
        criteria.push({ id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: parseInt(budgetMatch[1]), currency: 'EUR' } });
      }
      
      // Add search context
      const searchContext = detectSearchContext(query);
      criteria.push({ id: 'searchContext', name: 'Contexte de recherche', level: 'required', parameters: { value: searchContext } });
      
      return criteria;
    };

    if (prompt.includes('analyse cette requête') || prompt.includes('search criteria') || prompt.includes('extract')) {
      const queryMatch = prompt.match(/Analyse cette requ[êe]te d'achat : "([^"]+)"/);
      const actualQuery = queryMatch ? queryMatch[1].toLowerCase() : query;
      const criteria = buildCriteria(actualQuery);
      
      // Extract brands from criteria for suggestedTerms
      const brandCriterion = criteria.find(c => c.id === 'brand');
      const brandTerms = brandCriterion?.parameters?.preferredValues?.[0] ? [brandCriterion.parameters.preferredValues[0]] : [];
      
      return {
        content: JSON.stringify({
          productDescription: 'Mock product interpretation',
          extractedCriteria: criteria,
          suggestedTerms: [
            ...brandTerms,
            ...actualQuery.split(/\s+/).filter(t => t.length > 2 && !['pour', 'avec', 'sans', 'cherche', 'trouve', 'veux', 'un', 'une', 'le', 'la', 'les', 'de', 'du', 'au', 'aux'].includes(t))
          ],
          synonyms: [],
          uncertainties: [],
          clarificationOpportunities: [],
          confidence: 0.8,
        }),
        providerName: this.name,
        model: request.model,
        tokensUsed: 150,
        durationMs: 50,
      };
    }

    if (prompt.includes('search terms') || prompt.includes('synonyms')) {
      // Extract the actual product description from the prompt so InMemoryDiscovery
      // can match real catalog entries. Without this, MockAI would return generic
      // 'mock product' terms that match nothing.
      const descMatch = request.prompt.match(/Generate search terms for: "([^"]+)"/);
      const rawDesc = descMatch ? descMatch[1] : '';
      // Use the actual words from the query as primary search terms, filter out locale
      const primaryTerms = rawDesc.length > 0
        ? rawDesc.split(/\s+/).filter(t => t.length > 2 && t !== 'in' && t !== 'locale' && t !== 'fr' && t !== 'en')
        : ['mock product'];

      return {
        content: JSON.stringify({
          primaryTerms,
          synonyms: [],
          alternativeSpellings: [],
        }),
        providerName: this.name,
        model: request.model,
        tokensUsed: 80,
        durationMs: 30,
      };
    }

    // Default explanation mock
    return {
      content: 'This offer ranked first because it best meets your stated criteria with the best price-to-quality ratio.',
      providerName: this.name,
      model: request.model,
      tokensUsed: 50,
      durationMs: 25,
    };
  }
}
