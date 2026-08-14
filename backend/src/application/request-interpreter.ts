/**
 * Capucine Application Layer — Request Interpreter
 *
 * REAL IMPLEMENTATION: Parses user queries and produces structured requests.
 *
 * This is NOT just types. This contains actual interpretation logic.
 * - Extracts criteria from natural language
 * - Identifies ambiguities
 * - Resolves simple patterns
 * - Handles structured input
 *
 * Note: Does NOT integrate actual AI yet.
 * Uses heuristic-based parsing for MVP.
 * Future: Can be replaced with real LLM via AIInterpreter interface.
 */

import {
  UserQuery,
  InterpretedRequest,
  QueryAmbiguity,
  AmbiguityType,
  ClarificationNeeded,
  ResolvedInterpretedRequest,
  QueryAnalysis,
  QueryValidationResult,
  QueryValidationError,
  QueryValidationWarning,
} from './request';
import { PreferenceCriterion, PreferenceLevel } from '../domain/types';

// ============================================================================
// REQUEST INTERPRETER INTERFACE
// ============================================================================

/**
 * Interprets user queries without requiring actual AI.
 * Provides heuristic-based parsing for MVP.
 */
export interface IRequestInterpreter {
  interpret(query: UserQuery): Promise<InterpretedRequest>;
  analyzeQuery(query: UserQuery): Promise<QueryAnalysis>;
  validateQuery(query: UserQuery): Promise<QueryValidationResult>;
}

// ============================================================================
// BASIC PATTERN-BASED INTERPRETER
// ============================================================================

/**
 * MVP implementation: Parses queries using regex and heuristics.
 * Not perfect, but deterministic and testable.
 *
 * Recognizes patterns:
 * - Budget: "under €500", "less than 600", "max 500"
 * - Constraints: "must have", "need", "require"
 * - Preferences: "prefer", "want", "like"
 * - Exclusions: "avoid", "not", "don't want"
 * - Quantities: "at least X", "more than", "less than"
 */
export class BasicPatternInterpreter implements IRequestInterpreter {
  async interpret(query: UserQuery): Promise<InterpretedRequest> {
    if (!query.text && !query.structured) {
      throw new Error('Query must have text or structured data');
    }

    const interpretation: InterpretedRequest = {
      id: `int-${query.id}-${Date.now()}`,
      queryId: query.id,
      userId: query.userId,
      extractedCriteria: [],
      ambiguities: [],
      confidence: 0.5,
      lowConfidenceReasons: [],
      clarificationsReceived: [],
      detectedProfileExceptions: [],
      createdAt: new Date(),
      interpretedAt: new Date(),
    };

    // Extract from structured input first
    if (query.structured) {
      this.parseStructured(query.structured, interpretation);
    }

    // Extract from text
    if (query.text) {
      this.parseText(query.text, interpretation);
    }

    // Assess confidence
    this.assessConfidence(interpretation);

    return interpretation;
  }

  /**
   * Synchronous interpretation — same logic as interpret(), no async overhead.
   * Used by CapucineEngine.searchSync().
   */
  interpretSync(query: UserQuery): InterpretedRequest {
    if (!query.text && !query.structured) {
      throw new Error('Query must have text or structured data');
    }

    const interpretation: InterpretedRequest = {
      id: `int-${query.id}-${Date.now()}`,
      queryId: query.id,
      userId: query.userId,
      extractedCriteria: [],
      ambiguities: [],
      confidence: 0.5,
      lowConfidenceReasons: [],
      clarificationsReceived: [],
      detectedProfileExceptions: [],
      createdAt: new Date(),
      interpretedAt: new Date(),
    };

    if (query.structured) {
      this.parseStructured(query.structured, interpretation);
    }

    if (query.text) {
      this.parseText(query.text, interpretation);
    }

    // Detect primary category from text and promote to criterion
    if (query.text) {
      const detectedCategories = this.extractCategories(query.text);
      if (detectedCategories.length > 0 && !interpretation.extractedCriteria.some(c => c.id === 'category')) {
        const top = detectedCategories[0];
        interpretation.category = top.category;
        interpretation.extractedCriteria.push({
          id: 'category',
          name: 'Catégorie',
          level: 'required',
          parameters: { category: top.category },
        });
      }
    }

    this.assessConfidence(interpretation);

    return interpretation;
  }

  async analyzeQuery(query: UserQuery): Promise<QueryAnalysis> {
    const textLength = query.text?.length || 0;
    const complexity = this.estimateComplexity(query.text || '');

    return {
      queryId: query.id,
      analysisTime: new Date(),
      queryLength: textLength,
      estimatedComplexity: complexity,
      detectedLanguage: /[àâäéèêëïîôùûüçœæ]/i.test(query.text || '') ? 'fr' : 'en',
      isTimeConstrained: this.hasTimeConstraint(query.text),
      detectedCategories: this.extractCategories(query.text || ''),
      ambiguityCount: 0, // Will be updated after interpretation
      averageAmbiguityConfidence: 0.5,
      isRankable: textLength > 0,
      needsClarification: false,
      estimatedClarificationQuestions: 0,
    };
  }

  async validateQuery(query: UserQuery): Promise<QueryValidationResult> {
    const errors: QueryValidationError[] = [];
    const warnings: QueryValidationWarning[] = [];
    const startTime = Date.now();

    if (!query.id || !query.userId) {
      errors.push({
        code: 'missing_required_field',
        message: 'Query must have id and userId',
      });
    }

    if (!query.text && !query.structured) {
      errors.push({
        code: 'empty_query',
        message: 'Query must have text or structured data',
      });
    }

    if (query.text && query.text.length < 3) {
      warnings.push({
        code: 'very_short_query',
        message: 'Query text is very short, may lack detail',
        suggestion: 'Provide more details for better results',
      });
    }

    if (query.text && query.text.length > 1000) {
      warnings.push({
        code: 'very_long_query',
        message: 'Query is very long',
        suggestion: 'Try to be more concise',
      });
    }

    return {
      queryId: query.id,
      isValid: errors.length === 0,
      errors,
      warnings,
      timeToValidate: Date.now() - startTime,
    };
  }

  // ========================================================================
  // PRIVATE: Pattern Matching & Extraction
  // ========================================================================

  private parseStructured(
    structured: any,
    interpretation: InterpretedRequest
  ): void {
    // Budget
    if (structured.budget) {
      interpretation.budget = {
        minimum: structured.budget.min,
        maximum: structured.budget.max,
        currency: structured.budget.currency || 'EUR',
      };

      interpretation.extractedCriteria.push({
        id: 'budget',
        name: 'Budget',
        level: 'required',
        parameters: {
          maxBudget: structured.budget.max,
          currency: structured.budget.currency || 'EUR',
        },
      });
    }

    // Category
    if (structured.category) {
      interpretation.category = structured.category;
    }

    // Location
    if (structured.location) {
      interpretation.shippingPreferences = {
        country: structured.location,
        preferDomestic: true,
      };
    }
  }

  private parseText(text: string, interpretation: InterpretedRequest): void {
    const lower = text.toLowerCase();

    // Extract budget patterns
    this.extractBudget(text, interpretation);

    // Extract must-have/required patterns
    this.extractRequirements(text, interpretation);

    // Extract prefer patterns
    this.extractPreferences(text, interpretation);

    // Extract exclusions
    this.extractExclusions(text, interpretation);

    // Extract product terms (brand names + model numbers)
    interpretation.suggestedSearchTerms = this.extractProductTerms(text);

    // Detect ambiguities
    this.detectAmbiguities(text, interpretation);
  }

  /**
   * Extract product-specific search terms from a query.
   *
   * Priority:
   * 1. Quoted strings (user is being precise: "WH-1000XM5")
   * 2. Model numbers (alphanumeric with hyphens: WH-1000XM5, GTX 3080, M3 Pro)
   * 3. Known brand names
   * 4. Remaining meaningful non-stop words
   *
   * These become the SearchPlan.query.primaryTerms when available.
   */
  private extractProductTerms(text: string): string[] {
    const terms: string[] = [];
    const seen = new Set<string>();

    const add = (t: string) => {
      const clean = t.toLowerCase().trim();
      if (clean.length > 1 && !seen.has(clean)) {
        seen.add(clean);
        terms.push(clean);
      }
    };

    // 1. Quoted strings → high-confidence product terms
    const quoted = text.match(/["«»""]([^"«»""]{2,40})["«»""]/g);
    if (quoted) {
      for (const q of quoted) {
        add(q.replace(/["«»""]/g, '').trim());
      }
    }

    // 2. Model numbers: patterns like WH-1000XM5, GTX3080, M2Pro, A2185, S8+, SL-1200MK7
    //    Matches: letter(s) + optional-hyphen + digit(s) + optional-letter(s)
    const modelPattern = /\b([A-Za-z]{1,6}[-\s]?\d{2,6}[A-Za-z0-9]{0,6})\b/g;
    let m: RegExpExecArray | null;
    while ((m = modelPattern.exec(text)) !== null) {
      const candidate = m[1].replace(/\s+/g, '-');
      // Exclude pure numbers and budget values (e.g., "500€")
      if (/[A-Za-z]/.test(candidate) && /\d/.test(candidate)) {
        add(candidate);
      }
    }

    // 3. Known brand names (maintained list — NOT exhaustive, just common ones)
    const BRANDS = new Set([
      // Audio
      'sony', 'bose', 'sennheiser', 'jabra', 'beyerdynamic', 'audio-technica',
      'jbl', 'harman', 'shure', 'rode', 'akg', 'plantronics',
      // Computing
      'apple', 'samsung', 'lg', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'msi',
      'microsoft', 'razer', 'logitech', 'corsair', 'gigabyte', 'nvidia', 'amd',
      // Phones
      'oneplus', 'xiaomi', 'oppo', 'huawei', 'google', 'motorola', 'nokia',
      'fairphone', 'nothing', 'realme',
      // Home
      'dyson', 'irobot', 'roborock', 'ecovacs', 'philips', 'braun',
      // Cameras
      'canon', 'nikon', 'fujifilm', 'panasonic', 'leica', 'gopro', 'dji',
      // Gaming
      'nintendo', 'playstation', 'xbox', 'valve', 'steam',
      // Mobility
      'cowboy', 'specialized', 'trek', 'brompton',
      // General
      'ikea', 'bosch', 'siemens', 'whirlpool',
    ]);

    const words = text.toLowerCase().split(/[\s\-\/]+/);
    for (const word of words) {
      const clean = word.replace(/[^a-z0-9]/g, '');
      if (BRANDS.has(clean)) {
        add(clean);
      }
    }

    // 4. Remaining meaningful words (length > 3, not stop words, not budget words)
    const EXTRACT_STOP = new Set([
      // French
      'cherche', 'veux', 'voudrais', 'besoin', 'trouver', 'acheter', 'avoir',
      'dans', 'pour', 'avec', 'sans', 'mais', 'plus', 'moins', 'très',
      'impérativement', 'absolument', 'obligatoirement', 'idéalement',
      'notamment', 'surtout', 'aussi', 'encore', 'toujours',
      // English
      'looking', 'search', 'find', 'need', 'want', 'like', 'prefer',
      'that', 'this', 'with', 'from', 'have', 'should', 'could', 'would',
      // Budget words
      'budget', 'euros', 'euro', 'maximum', 'minimum', 'maxi', 'moins', 'plus',
    ]);

    for (const word of words) {
      const clean = word.replace(/[^a-z0-9àâäéèêëïîôùûüç]/g, '');
      if (clean.length >= 4 && !EXTRACT_STOP.has(clean) && !seen.has(clean)) {
        // Only include if it's a content word (not purely a common word)
        if (!FRENCH_STOP_WORDS.has(clean) && !ENGLISH_STOP_WORDS.has(clean)) {
          add(clean);
        }
      }
    }

    // Return deduplicated, max 8 terms (model numbers + brands first)
    return terms.slice(0, 8);
  }

  private extractBudget(
    text: string,
    interpretation: InterpretedRequest
  ): void {
    // Patterns: "under €500", "max 500", "less than 600", "up to 1000", "around 1000"
    // French: "moins de 500€", "pas plus de 600", "budget de 800€", "jusqu'à 1000€"
    const patterns = [
      // ── French patterns (checked first) ──
      /moins\s+de\s*(\d+)\s*€?/i,
      /pas\s+plus\s+de\s*(\d+)\s*€?/i,
      /max(?:i(?:mum)?)?\s+(\d+)\s*€?/i,
      /budget\s+(?:de\s+)?(\d+)\s*€?/i,
      /jusqu[''`]?à\s*(\d+)\s*€?/i,
      /(\d+)\s*€\s*(?:max(?:i(?:mum)?)?|maxi)/i,
      /€\s*(\d+)/i,
      /(\d+)\s*euros?\s+(?:max|maxi|maximum)/i,
      // ── English patterns ──
      /under\s*€?(\d+)/i,
      /maximum\s+€?(\d+)/i,
      /less\s+than\s*€?(\d+)/i,
      /up\s+to\s*€?(\d+)/i,
      /around\s*€?(\d+)/i,
      /approximately\s*€?(\d+)/i,
      /roughly\s*€?(\d+)/i,
      /budget\s*€?(\d+)/i,
      /€(\d+)\s+(budget|max|limit)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseInt(match[1], 10);
        if (!interpretation.budget) {
          interpretation.budget = {
            maximum: amount,
            currency: 'EUR', // TODO: extract currency from pattern
          };

          interpretation.extractedCriteria.push({
            id: 'budget',
            name: 'Budget',
            level: 'required',
            parameters: { maxBudget: amount, currency: 'EUR' },
          });
        }
        break;
      }
    }
  }

  private extractRequirements(
    text: string,
    interpretation: InterpretedRequest
  ): void {
    // Patterns: "must have X", "need X", "require X"
    // French: "impérativement X", "obligatoirement X", "il me faut X", "j'ai besoin de X"
    const patterns = [
      // ── French ──
      /imp[ée]rativement\s+([a-zA-ZÀ-ÿ\s]+?)(?:,|et|ou|\.|$)/gi,
      /obligatoirement\s+([a-zA-ZÀ-ÿ\s]+?)(?:,|et|ou|\.|$)/gi,
      /il\s+(?:me\s+)?faut\s+(?:absolument\s+)?([a-zA-ZÀ-ÿ\s]+?)(?:,|et|ou|\.|$)/gi,
      /j[''`]?ai\s+besoin\s+d[eu]\s+([a-zA-ZÀ-ÿ\s]+?)(?:,|et|ou|\.|$)/gi,
      // ── English ──
      /must\s+have\s+([a-z\s]+?)(?:,|and|or|$)/gi,
      /\bneed\s+([a-z\s]+?)(?:,|and|or|\.|\s+with|\s+that|$)/gi,
      /require\s+([a-z\s]+?)(?:,|and|or|$)/gi,
      /has\s+to\s+have\s+([a-z\s]+?)(?:,|and|or|$)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const criterion = match[1]?.trim();
        if (criterion && criterion.length > 2) {
          // Check if not already added
          if (
            !interpretation.extractedCriteria.some(
              c => c.name.toLowerCase() === criterion.toLowerCase()
            )
          ) {
            interpretation.extractedCriteria.push({
              id: `req-${criterion.toLowerCase().replace(/\s+/g, '-')}`,
              name: criterion,
              level: 'required',
            });
          }
        }
      }
    }
  }

  private extractPreferences(
    text: string,
    interpretation: InterpretedRequest
  ): void {
    // Patterns: "prefer X", "want X", "like X"
    // French: "de préférence X", "idéalement X", "j'aimerais X", "si possible X"
    const prefPattern = /(?:de pr[eé]f[eé]rence|id[eé]alement|si possible|j[''`]?aimerais|prefer|want|like)\s+([a-zA-ZÀ-ÿ\s]+?)(?:\.|,|and|or|et|ou|$)/gi;

    let match;
    while ((match = prefPattern.exec(text)) !== null) {
      const criterion = match[1].trim();
      if (criterion.length > 2 && !interpretation.extractedCriteria.some(c => c.name === criterion)) {
        interpretation.extractedCriteria.push({
          id: `pref-${criterion.toLowerCase().replace(/\s+/g, '-')}`,
          name: criterion,
          level: 'preference',
        });
      }
    }
  }

  private extractExclusions(
    text: string,
    interpretation: InterpretedRequest
  ): void {
    // Patterns: "avoid X", "not X", "no X", "don't want"
    // French: "sans X", "pas de X", "j'évite X", "je veux pas de X", "surtout pas"
    const avoidPattern = /(?:sans\s+|pas\s+de\s+|j[''`]?[eé]vite\s+|je\s+veux\s+pas\s+(?:de\s+)?|surtout\s+pas\s+(?:de\s+)?|avoid\s+|no\s+|don[''`]?t\s+want\s+)([a-zA-ZÀ-ÿ\s]+?)(?:\.|,|and|or|et|ou|$)/gi;

    let match;
    while ((match = avoidPattern.exec(text)) !== null) {
      const criterion = match[1].trim();
      if (criterion.length > 2) {
        interpretation.extractedCriteria.push({
          id: `avoid-${criterion.toLowerCase().replace(/\s+/g, '-')}`,
          name: criterion,
          level: 'forbidden',
        });
      }
    }
  }

  private detectAmbiguities(
    text: string,
    interpretation: InterpretedRequest
  ): void {
    // French vague budget language
    if (/pas trop cher|raisonnable|abordable|[eé]conomique|budget serr[eé]|pas cher|bon march[eé]|petit prix/i.test(text)) {
      interpretation.ambiguities.push({
        id: `amb-${Date.now()}-budget-vague-fr`,
        ambiguityType: 'budget_flexibility',
        criterion: 'budget',
        description: 'Expression de budget vague sans montant précis.',
        possibleInterpretations: [
          { interpretation: 'Budget modeste (< 300€)', explanation: 'Gamme entrée de gamme', likelihood: 0.4 },
          { interpretation: 'Budget moyen (< 600€)', explanation: 'Rapport qualité-prix', likelihood: 0.4 },
          { interpretation: 'Budget confortable (< 1000€)', explanation: 'Milieu de gamme', likelihood: 0.2 },
        ],
        resolved: false,
      });
    }

    // French comparative without reference
    if (/plus\s+(?:l[eé]ger|petit|rapide|puissant|autonome|compact)|moins\s+(?:lourd|encombrant)/i.test(text)) {
      interpretation.ambiguities.push({
        id: `amb-${Date.now()}-comparative-fr`,
        ambiguityType: 'criterion_value',
        criterion: 'comparison',
        description: 'Expression comparative sans référence absolue.',
        possibleInterpretations: [
          { interpretation: 'Préférence relative au marché', explanation: 'Pondération dans le classement', likelihood: 0.8 },
        ],
        resolved: false,
      });
    }

    // Pattern: "around €1000"
    if (/around\s*€?\d+|approximately|roughly/i.test(text)) {
      interpretation.ambiguities.push({
        id: `amb-${Date.now()}-budget-flex`,
        ambiguityType: 'budget_flexibility',
        criterion: 'budget',
        description: 'User indicated approximate budget. How much flexibility?',
        possibleInterpretations: [
          { interpretation: '±10%', explanation: 'Strict', likelihood: 0.3 },
          { interpretation: '±20%', explanation: 'Moderate', likelihood: 0.5 },
          { interpretation: '±30%', explanation: 'Very flexible', likelihood: 0.2 },
        ],
        resolved: false,
      });
    }

    // Pattern: "good", "nice", "best"
    if (/good|nice|best|excellent|high\s+quality/i.test(text)) {
      interpretation.ambiguities.push({
        id: `amb-${Date.now()}-quality`,
        ambiguityType: 'criterion_value',
        criterion: 'quality',
        description: 'User mentioned quality but didn\'t specify measurable criteria',
        possibleInterpretations: [
          { interpretation: 'Rating >= 4/5', explanation: 'Good customer reviews', likelihood: 0.6 },
          { interpretation: 'Warranty >= 2 years', explanation: 'Manufacturer confidence', likelihood: 0.3 },
          { interpretation: 'Premium brand', explanation: 'Known quality', likelihood: 0.1 },
        ],
        resolved: false,
      });
    }
  }

  private assessConfidence(interpretation: InterpretedRequest): void {
    let confidence = 0.7; // Start with baseline

    // Reduce if many ambiguities
    confidence -= interpretation.ambiguities.length * 0.1;

    // Reduce if few criteria extracted
    if (interpretation.extractedCriteria.length === 0) {
      confidence = 0.3;
      interpretation.lowConfidenceReasons = [
        'No structured criteria detected in query',
      ];
    }

    // Increase if budget detected (usually clear)
    if (interpretation.budget) {
      confidence += 0.1;
    }

    interpretation.confidence = Math.max(0, Math.min(1, confidence));
  }

  private estimateComplexity(text: string): 'simple' | 'moderate' | 'complex' {
    const length = text.length;
    const andCount = (text.match(/\band\b/gi) || []).length;
    const orCount = (text.match(/\bor\b/gi) || []).length;
    const questionCount = (text.match(/\?/g) || []).length;

    const complexity = length + andCount * 2 + orCount * 2 + questionCount * 3;

    if (complexity < 50) return 'simple';
    if (complexity < 150) return 'moderate';
    return 'complex';
  }

  private hasTimeConstraint(text?: string): boolean {
    if (!text) return false;
    return /urgent|asap|soon|today|this week|quickly/i.test(text);
  }

  private extractCategories(
    text: string
  ): { category: string; confidence: number }[] {
    // Category detection — French and English keywords
    const categories: { category: string; confidence: number }[] = [];

    const categoryPatterns: Record<string, string[]> = {
      // ── Domain categories (Capucine catalog) ──
      smartphone: ['smartphone', 'téléphone', 'telephone', 'iphone', 'android', 'mobile', 'pixel', 'galaxy', 'fairphone'],
      ordinateur_portable: ['ordinateur', 'laptop', 'pc portable', 'macbook', 'thinkpad', 'notebook', 'ultrabook'],
      casque: ['casque', 'écouteur', 'ecouteur', 'headphone', 'airpod', 'earphone', 'audio', 'bluetooth'],
      aspirateur_robot: ['aspirateur', 'robot aspirateur', 'vacuum', 'roomba', 'roborock'],
      clavier: ['clavier', 'keyboard', 'keychron', 'mécanique', 'mecanique'],
      livre: ['livre', 'roman', 'book', 'manga', 'bd', 'bande dessinée'],
      // ── Generic categories ──
      electronics: ['laptop', 'phone', 'tablet', 'computer', 'headphone'],
      clothing: ['jacket', 'shirt', 'pants', 'dress', 'shoes'],
      furniture: ['chair', 'table', 'desk', 'bookcase', 'sofa'],
      appliances: ['microwave', 'blender', 'toaster', 'vacuum'],
      food: ['cereal', 'chocolate', 'pasta', 'bread'],
    };

    for (const [category, keywords] of Object.entries(categoryPatterns)) {
      const matches = keywords.filter(kw => text.toLowerCase().includes(kw)).length;
      if (matches > 0) {
        categories.push({
          category,
          confidence: Math.min(1, matches / keywords.length),
        });
      }
    }

    return categories;
  }
}

// ============================================================================
// RESOLUTION: Convert InterpretedRequest to ResolvedInterpretedRequest
// ============================================================================

export class RequestResolver {
  /**
   * Resolve ambiguities and produce final request ready for ranking.
   * Uses clarifications provided by user.
   */
  resolveRequest(
    interpretedRequest: InterpretedRequest,
    clarifications: Map<string, string>
  ): ResolvedInterpretedRequest {
    // Ensure budget has required fields
    const finalBudget =
      interpretedRequest.budget && interpretedRequest.budget.maximum
        ? interpretedRequest.budget
        : undefined;

    const resolved: ResolvedInterpretedRequest = {
      id: `res-${interpretedRequest.id}-${Date.now()}`,
      originalQueryId: interpretedRequest.queryId,
      interpretedRequestId: interpretedRequest.id,
      userId: interpretedRequest.userId,
      finalCriteria: [...interpretedRequest.extractedCriteria],
      finalBudget: finalBudget
        ? {
            maximum: finalBudget.maximum!,
            currency: finalBudget.currency || 'EUR',
            flexible: finalBudget.flexible,
            flexibilityPercent: finalBudget.flexibilityPercent,
          }
        : undefined,
      finalShippingPreferences: interpretedRequest.shippingPreferences,
      category: interpretedRequest.category,
      clarificationsApplied: [],
      profileExceptions: interpretedRequest.detectedProfileExceptions.map(ex => ({
        criterionId: ex.criterionId,
        temporaryLevel: ex.proposedLevel as PreferenceLevel,
        reason: ex.reason,
      })),
      readyForRanking: true,
      readinessCheckTime: new Date(),
      createdAt: new Date(),
      finalizedAt: new Date(),
    };

    // Apply clarifications
    for (const [ambiguityId, answer] of clarifications) {
      const ambiguity = interpretedRequest.ambiguities.find(
        a => a.id === ambiguityId
      );
      if (ambiguity) {
        this.applyClarification(ambiguity, answer, resolved);
      }
    }

    return resolved;
  }

  private applyClarification(
    ambiguity: QueryAmbiguity,
    answer: string,
    resolved: ResolvedInterpretedRequest
  ): void {
    // Apply the clarification answer to modify resolved criteria
    switch (ambiguity.ambiguityType) {
      case 'budget_flexibility':
        // Parse flexibility: "±20%" → 0.2
        const match = answer.match(/±?(\d+)%/);
        if (match && resolved.finalBudget) {
          const flex = parseInt(match[1], 10) / 100;
          resolved.finalBudget.flexibilityPercent = flex;
          resolved.finalBudget.flexible = true;
          // Adjust max budget
          resolved.finalBudget.maximum =
            resolved.finalBudget.maximum * (1 + flex);
        }
        break;

      case 'criterion_weight':
        // Modify criterion level based on answer
        const criterion = resolved.finalCriteria.find(
          c => c.id === ambiguity.criterion
        );
        if (criterion) {
          if (answer.toLowerCase().includes('important')) {
            criterion.level = 'important' as PreferenceLevel;
          } else if (answer.toLowerCase().includes('very')) {
            criterion.level = 'very_important' as PreferenceLevel;
          }
        }
        break;

      default:
        // Generic: just record that clarification was provided
        break;
    }

    resolved.clarificationsApplied.push({
      ambiguityId: ambiguity.id,
      selectedInterpretation: answer,
      userAnswer: answer,
      timestamp: new Date(),
    });
  }
}

// ============================================================================
// STOP WORD SETS (used by extractProductTerms)
// ============================================================================

const FRENCH_STOP_WORDS = new Set([
  'les', 'des', 'une', 'pour', 'avec', 'que', 'qui', 'dans', 'sur', 'par',
  'mon', 'mes', 'son', 'ses', 'notre', 'votre', 'leur', 'leurs',
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'est', 'sont', 'était', 'être', 'avoir', 'fait', 'faire', 'fais',
  'pas', 'non', 'oui', 'bien', 'tout', 'tous', 'même',
  'très', 'trop', 'assez', 'peu', 'beaucoup',
  'cher', 'chère', 'prix', 'coût', 'tarif',
]);

const ENGLISH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have',
  'will', 'not', 'but', 'can', 'are', 'was', 'were', 'been',
  'good', 'great', 'nice', 'best', 'high', 'low',
  'cheap', 'price', 'cost', 'expensive',
]);
