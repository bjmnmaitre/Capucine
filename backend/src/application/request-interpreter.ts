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
import { PreferenceCriterion, PreferenceLevel, UsageContext, UsageType, ContextType } from '../domain/types';
import { SupportedCountry } from './i18n';
import { RankingPreference } from './ranking-preference';

// ============================================================================
// CATEGORY VOCABULARY
//
// Split in two, not one bag of keywords, because they answer different
// questions and must never be ranked against each other by raw confidence:
//   - DOMAIN: real Capucine catalog categories. These are what
//     DiscoveryCriteria.categories' hard filter and in-memory-discovery.ts's
//     `entry.category` actually index offers by — a domain match is safe to
//     use as a strong signal (see DOMAIN_PRODUCT_CATEGORIES, consumed by
//     CapucineEngine.buildSearchPlan()).
//   - GENERIC: broad classifications (electronics, clothing, ...) that exist
//     for coverage on queries with no domain-specific vocabulary, but match
//     NOTHING in the catalog — using one as a hard discovery filter would
//     silently zero out every candidate. See extractCategories()'s
//     domain-always-outranks-generic sort below.
// Extending Capucine to a new product type is adding one line to
// DOMAIN_CATEGORY_PATTERNS (+ optionally a matching catalog category) — not
// building a new ontology.
// ============================================================================

const DOMAIN_CATEGORY_PATTERNS: Record<string, string[]> = {
  smartphone: ['smartphone', 'téléphone', 'telephone', 'iphone', 'android', 'mobile', 'pixel', 'galaxy', 'fairphone'],
  ordinateur_portable: ['ordinateur', 'laptop', 'pc portable', 'macbook', 'thinkpad', 'notebook', 'ultrabook'],
  casque: ['casque', 'écouteur', 'ecouteur', 'headphone', 'airpod', 'earphone', 'audio', 'bluetooth'],
  aspirateur_robot: ['aspirateur', 'robot aspirateur', 'vacuum', 'roomba', 'roborock'],
  clavier: ['clavier', 'keyboard', 'keychron', 'mécanique', 'mecanique'],
  livre: ['livre', 'roman', 'book', 'manga', 'bd', 'bande dessinée'],
};

const GENERIC_CATEGORY_PATTERNS: Record<string, string[]> = {
  electronics: ['laptop', 'phone', 'tablet', 'computer', 'headphone'],
  clothing: ['jacket', 'shirt', 'pants', 'dress', 'shoes'],
  furniture: ['chair', 'table', 'desk', 'bookcase', 'sofa'],
  appliances: ['microwave', 'blender', 'toaster', 'vacuum'],
  food: ['cereal', 'chocolate', 'pasta', 'bread'],
};

/**
 * Category ids known to correspond to real catalog/domain categories —
 * safe to use as a hard discovery pre-filter (DiscoveryCriteria.categories).
 * A GENERIC category (e.g. 'electronics') must never be used that way: no
 * catalog entry carries that value, so it would silently discard every
 * candidate rather than narrow the search. See buildSearchPlan() in
 * capucine-engine.ts.
 */
export const DOMAIN_PRODUCT_CATEGORIES: ReadonlySet<string> = new Set(Object.keys(DOMAIN_CATEGORY_PATTERNS));

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
      this.applyCategoryDetection(query.text, interpretation);
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
      this.applyCategoryDetection(query.text, interpretation);
    }

    this.assessConfidence(interpretation);

    return interpretation;
  }

  /**
   * Detect the primary product category from text and, if found, promote it
   * to a structured criterion — shared by interpret() and interpretSync() so
   * both paths (the async HTTP pipeline and the sync test/CLI path) see the
   * same category behavior.
   *
   * Wiring notes (why these exact parameters):
   * - `preferredValues: [top.category]` — NOT a bespoke `category` key. This
   *   is what makes AdmissibilityEngine.checkConstraint's existing
   *   checkPreferredValues() branch actually run a real equality check
   *   against offer.characteristics.category. Using an unread parameter key
   *   here previously meant category was never actually verified — any
   *   offer with *a* category value passed regardless of what it was.
   * - `unknownPolicy: 'pass'` — category is a best-effort classification
   *   hint, not a strictly verifiable spec value like RAM or screen size.
   *   An offer with no explicit `category` characteristic must not be
   *   rejected outright — see AdmissibilityEngine.resolveUnknownData().
   */
  private applyCategoryDetection(text: string, interpretation: InterpretedRequest): void {
    const detectedCategories = this.extractCategories(text);
    if (detectedCategories.length > 0 && !interpretation.extractedCriteria.some(c => c.id === 'category')) {
      const top = detectedCategories[0];
      interpretation.category = top.category;
      interpretation.extractedCriteria.push({
        id: 'category',
        name: 'Catégorie',
        level: 'required',
        parameters: { preferredValues: [top.category], unknownPolicy: 'pass' },
      });
    }
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
        currency: structured.budget.currency || 'unknown',
      };

      interpretation.extractedCriteria.push({
        id: 'budget',
        name: 'Budget',
        level: 'required',
        parameters: {
          maxBudget: structured.budget.max,
          currency: structured.budget.currency || 'unknown',
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
    // Extract structured technical constraints FIRST. Each extractor returns
    // the raw substring it matched (e.g. "moins de 1000 €", "14 pouces",
    // "16 Go RAM") so those spans can be removed before free-text term
    // extraction runs. Without this, extractProductTerms' model-number regex
    // treats "16 Go" / "de 1000" as if they were product refs ("pouces-16",
    // "de-1000") — constraints must never leak into search terms.
    const matchedSpans: string[] = [];
    const track = (span: string | null) => { if (span) matchedSpans.push(span); };

    track(this.extractBudget(text, interpretation));
    track(this.extractScreenSize(text, interpretation));
    track(this.extractRAM(text, interpretation));
    track(this.extractStorage(text, interpretation));
    track(this.extractCondition(text, interpretation));
    track(this.extractUsageContext(text, interpretation));

    // Extract must-have/required patterns
    this.extractRequirements(text, interpretation);

    // Extract prefer patterns
    this.extractPreferences(text, interpretation);

    // Extract exclusions
    this.extractExclusions(text, interpretation);

    // Extract product terms (brand names + model numbers) from the text with
    // recognized constraint phrases stripped out — see comment above.
    const sanitizedForTerms = this.stripMatchedSpans(text, matchedSpans);
    interpretation.suggestedSearchTerms = this.extractProductTerms(sanitizedForTerms);

    // Detect ambiguities
    this.detectAmbiguities(text, interpretation);
  }

  /**
   * Extract usage context from text (e.g., "pour les transports", "pour écouter de la musique")
   * This returns contextual signals that influence relevance but are NOT hard constraints.
   * Returns the matched substring (for span-stripping), or null.
   */
  private extractUsageContext(text: string, interpretation: InterpretedRequest): string | null {
    // Don't add duplicate usage context
    if (interpretation.usageContext) {
      return null;
    }

    // Patterns for usage context
    const usagePatterns: Array<{ usage: UsageType; context?: ContextType; patterns: RegExp[]; confidence: number }> = [
      // Transport/commuting usage
      {
        usage: 'transport',
        patterns: [
          /pour\s+(?:les?\s+)?transports?\b/i,
          /dans\s+(?:les?\s+)?transports?\b/i,
          /surtout\s+(?:dans|pour)\s+(?:les?\s+)?transports?\b/i,
          /pour\s+(?:prendre|aller\s+en)\s+(?:le\s+)?(?:métro|bus|train|tramway?)\b/i,
          /pour\s+(?:voyager|déplacements?)\b/i,
          /en\s+(?:déplacement|mobilité)\b/i
        ],
        context: 'transport',
        confidence: 0.9
      },
      // Music listening
      {
        usage: 'music',
        patterns: [
          /pour\s+(?:écouter|écoute)\s+(?:de\s+)?la?\s+musique\b/i,
          /principalement\s+pour\s+(?:la\s+)?musique\b/i,
          /écoute\s+(?:de\s+)?musique\b/i
        ],
        confidence: 0.85
      },
      // Sport/fitness
      {
        usage: 'sport',
        patterns: [
          /pour\s+(?:faire\s+)?du?\s+sport\b/i,
          /pour\s+courir\b/i,
          /pour\s+(?:faire\s+)?de\s+l'exercice\b/i,
          /pour\s+(?:la\s+)?gym(?:nase)?\b/i,
          /pour\s+(?:fitness|cardio)\b/i
        ],
        context: 'gym',
        confidence: 0.8
      },
      // Office/work
      {
        usage: 'office',
        patterns: [
          /pour\s+(?:travailler|le\s+travail)\b/i,
          /au\s+bureau\b/i,
          /pour\s+(?:le\s+)?bureau\b/i,
          /pour\s+(?:télé)?travail\b/i,
          /au\s+travail\b/i
        ],
        context: 'office',
        confidence: 0.8
      },
      // Gaming
      {
        usage: 'gaming',
        patterns: [
          /pour\s+(?:jouer|le\s+jeu)\b/i,
          /pour\s+gaming\b/i,
          /pour\s+(?:pc\s+)?gaming\b/i,
          /jouer\s+sur\s+(?:pc|ordinateur)\b/i
        ],
        context: 'gaming',
        confidence: 0.85
      },
      // Travel
      {
        usage: 'travel',
        patterns: [
          /pour\s+voyager\b/i,
          /en\s+voyage\b/i,
          /pour\s+(?:les\s+)?vacances?\b/i,
          /en\s+weekend\b/i
        ],
        context: 'travel',
        confidence: 0.75
      },
      // Home usage
      {
        usage: 'home',
        patterns: [
          /chez\s+soi\b/i,
          /à\s+la\s+maison\b/i,
          /pour\s+(?:la\s+)?maison\b/i,
          /utilisation\s+(?:domestique|à\s+la\s+maison)\b/i
        ],
        context: 'home',
        confidence: 0.7
      }
    ];

    for (const { usage, context, patterns, confidence } of usagePatterns) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          // Create usage context object
          interpretation.usageContext = {
            usage,
            context: context ?? undefined,
            source: 'user',
            confidence,
            timestamp: new Date()
          };
          return match[0];
        }
      }
    }

    return null;
  }

  /** Remove each matched constraint substring (first occurrence, case-insensitive) from text. */
  private stripMatchedSpans(text: string, spans: string[]): string {
    let result = text;
    for (const span of spans) {
      const idx = result.toLowerCase().indexOf(span.toLowerCase());
      if (idx !== -1) {
        result = result.slice(0, idx) + ' ' + result.slice(idx + span.length);
      }
    }
    return result;
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
      // French — shopping-intent verbs, every common conjugation actually
      // seen in a natural request. Missing conjugations here is a REAL bug,
      // not a cosmetic gap: any leaked verb becomes a required AND-keyword
      // for local-catalog discovery (InMemoryDiscoveryStrategy requires
      // every keyword to appear in a candidate's corpus), so a single
      // missed verb like "trouve" silently zeroes out every result for an
      // entirely ordinary query ("trouve-moi un ordinateur portable").
      'cherche', 'cherches', 'cherchez', 'cherchons',
      'trouve', 'trouves', 'trouvez', 'trouvons', 'trouver',
      'montre', 'montres', 'montrez', 'montrons', 'montrer',
      'recherche', 'recherches', 'recherchez', 'rechercher',
      'affiche', 'affichez', 'afficher',
      'propose', 'proposez', 'proposer',
      'donne', 'donnez', 'donner',
      'veux', 'voudrais', 'besoin', 'acheter', 'avoir', 'faut',
      'dans', 'pour', 'avec', 'sans', 'mais', 'plus', 'moins', 'très',
      'impérativement', 'absolument', 'obligatoirement', 'idéalement',
      'notamment', 'surtout', 'aussi', 'encore', 'toujours',
      // English
      'looking', 'search', 'find', 'show', 'need', 'want', 'like', 'prefer',
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

  /** Returns the matched substring (for span-stripping), or null if no budget pattern matched. */
  private extractBudget(
    text: string,
    interpretation: InterpretedRequest
  ): string | null {
    // Patterns: "under €500", "max 500", "less than 600", "up to 1000", "around 1000"
    // French: "moins de 500€", "pas plus de 600", "budget de 800€", "jusqu'à 1000€", "sous 1000€"
    const patterns = [
      // ── French patterns (checked first) ──
      /moins\s+de\s*(\d+)(?:\s*€|\s*euros?)?/i,
      /pas\s+plus\s+de\s*(\d+)(?:\s*€|\s*euros?)?/i,
      /sous\s*(\d+)(?:\s*€|\s*euros?)?/i,
      /max(?:i(?:mum)?)?\s+(\d+)(?:\s*€|\s*euros?)?/i,
      /budget\s+(?:de\s+)?(\d+)(?:\s*€|\s*euros?)?/i,
      /jusqu[''`]?à\s*(\d+)(?:\s*€|\s*euros?)?/i,
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
      // ── Conversational refinement phrasing (e.g. "élargis à 1100€" as a
      // follow-up to an existing search) — appended last so they never
      // shadow the patterns above for ordinary single-turn queries; see
      // CapucineEngine.interpretFollowUp(). ──
      /[ée]largis?(?:\s+(?:le\s+)?budget)?\s*(?:à|a)\s*€?(\d+)/i,
      /augmente[r]?\s+(?:le\s+)?budget\s*(?:à|a)\s*€?(\d+)/i,
      /porte[r]?\s+(?:le\s+)?budget\s*(?:à|a)\s*€?(\d+)/i,
      /increase\s+(?:the\s+)?budget\s+to\s*€?(\d+)/i,
      /raise\s+(?:the\s+)?budget\s+to\s*€?(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseInt(match[1], 10);
        if (!interpretation.budget) {
          // Determine currency from the matched string
          let currency = 'unknown';
          const matchedStr = match[0];
          if (/€/i.test(matchedStr) || /euros?/i.test(matchedStr)) {
            currency = 'EUR';
          } else if (/£/i.test(matchedStr) || /pounds?/i.test(matchedStr) || /gbp/i.test(matchedStr)) {
            currency = 'GBP';
          } else if (/\$/i.test(matchedStr) || /dollars?/i.test(matchedStr) || /usd/i.test(matchedStr)) {
            currency = 'USD';
          }
          interpretation.budget = {
            maximum: amount,
            currency: currency,
          };

          interpretation.extractedCriteria.push({
            id: 'budget',
            name: 'Budget',
            level: 'required',
            parameters: { maxBudget: amount, currency: currency },
          });
        }
        return match[0];
      }
    }
    return null;
  }

  /**
   * Extract screen size ("14 pouces", "14\"", "écran 14 pouces", "14 po", "14 inch").
   * Pushed as a REQUIRED criterion — an explicitly stated screen size is a hard
   * constraint, not a hint. characteristics.screen_size is normalized to a plain
   * number of inches by NormalizationEngine before admissibility runs, so a small
   * tolerance absorbs rounding (13.9" listed as "14 pouces" by a merchant, etc.).
   * Returns the matched substring (for span-stripping), or null.
   */
  private extractScreenSize(text: string, interpretation: InterpretedRequest): string | null {
    const patterns = [
      /(\d+(?:[.,]\d+)?)\s*pouces?\b/i,
      /(\d+(?:[.,]\d+)?)\s*po\b/i,
      /(\d+(?:[.,]\d+)?)\s*"/,
      /(\d+(?:[.,]\d+)?)\s*(?:inch(?:es)?|in)\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(',', '.'));
        if (!interpretation.extractedCriteria.some(c => c.id === 'screen_size')) {
          interpretation.extractedCriteria.push({
            id: 'screen_size',
            name: "Taille d'écran",
            level: 'required',
            parameters: { exactValue: value, tolerance: 0.5, unit: 'pouces' },
          });
        }
        return match[0];
      }
    }
    return null;
  }

  /**
   * Extract RAM ("16 Go RAM", "16 Go de RAM", "16GB RAM", "RAM 16 Go").
   * Pushed as a REQUIRED minimum — a stated RAM amount is read as "at least
   * this much", which matches how shoppers phrase memory requirements.
   * Returns the matched substring (for span-stripping), or null.
   */
  private extractRAM(text: string, interpretation: InterpretedRequest): string | null {
    const patterns = [
      /(\d+)\s*go\s*(?:de\s*)?ram\b/i,
      /ram\s*(?:de\s*)?(\d+)\s*go\b/i,
      /(\d+)\s*gb\s*(?:of\s*)?ram\b/i,
      /ram\s*(?:of\s*)?(\d+)\s*gb\b/i,
      // ── Conversational refinement phrasing — "uniquement 16 Go" /
      // "finalement 32 Go" / "and with 32 GB" as a follow-up to an existing
      // search never repeats the word "ram" (see CapucineEngine.interpretFollowUp()
      // / ConversationManager.applyFollowUp()). Requiring the quantifier
      // ("uniquement"/"seulement"/"finalement"/"and with"/"with") keeps this
      // from firing on an ordinary standalone storage query like "clé USB
      // 32 Go" — appended last so it never shadows the patterns above. ──
      /\b(?:uniquement|seulement|finalement)\s+(\d+)\s*go\b/i,
      /\b(?:uniquement|seulement|finalement)\s+(\d+)\s*gb\b/i,
      /\bet\s+avec\s+(\d+)\s*go\b/i,
      /\band\s+with\s+(\d+)\s*gb\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseInt(match[1], 10);
        if (!interpretation.extractedCriteria.some(c => c.id === 'ram')) {
          interpretation.extractedCriteria.push({
            id: 'ram',
            name: 'Mémoire RAM',
            level: 'required',
            parameters: { minValue: value, unit: 'GB' },
          });
        }
        return match[0];
      }
    }
    return null;
  }

  /**
   * Extract storage ("512 Go SSD", "SSD 512 Go", "1 To", "1TB").
   * Pushed as a REQUIRED minimum, same rationale as RAM. To/TB is converted
   * to GB using the ×1024 convention NormalizationEngine already uses
   * (normalizeStorageValue in normalization-engine.ts) so both sides of the
   * admissibility comparison agree on what "1 To" means.
   * Returns the matched substring (for span-stripping), or null.
   */
  /**
   * Extract product condition ("neuf", "reconditionné", "occasion" / "brand
   * new", "refurbished", "used", "second-hand"). Pushed with unknownPolicy
   * 'pass' — like category, this is a best-effort filter: today's discovery
   * pipeline rarely extracts condition data from offers, so an offer with no
   * condition data must stay UNKNOWN, never be treated as VIOLATED (INVARIANT:
   * absence of data is never read as non-conformance). Also the extractor a
   * conversational follow-up ("uniquement du neuf") relies on — see
   * CapucineEngine.interpretFollowUp() / ConversationManager.applyFollowUp().
   * Returns the matched substring (for span-stripping), or null.
   */
  private extractCondition(text: string, interpretation: InterpretedRequest): string | null {
    const patterns: Array<{ re: RegExp; value: string }> = [
      // Trailing \b (not \s|$) after an accented character never matches —
      // \b requires a word/non-word transition, but JS regex treats accented
      // letters as non-word too, so "é" followed by a space/end is a
      // non-word→non-word "boundary" that never fires. Use a lookahead instead.
      { re: /\breconditionn[ée]e?s?(?=\s|$)/i, value: 'refurbished' },
      { re: /\brefurbished\b/i, value: 'refurbished' },
      { re: /\boccasion\b/i, value: 'used' },
      { re: /\busagé/i, value: 'used' },
      { re: /\bsecond[\s-]hand\b/i, value: 'used' },
      { re: /\bused\b/i, value: 'used' },
      { re: /\bneuf(?:ve)?s?\b/i, value: 'new' },
      { re: /\bbrand[\s-]new\b/i, value: 'new' },
    ];

    for (const { re, value } of patterns) {
      const match = text.match(re);
      if (match) {
        if (!interpretation.extractedCriteria.some(c => c.id === 'condition')) {
          interpretation.extractedCriteria.push({
            id: 'condition',
            name: 'État du produit',
            level: 'required',
            parameters: { preferredValues: [value], unknownPolicy: 'pass' },
          });
        }
        return match[0];
      }
    }
    return null;
  }

  private extractStorage(text: string, interpretation: InterpretedRequest): string | null {
    const patterns: Array<{ re: RegExp; isTeraUnit: boolean }> = [
      { re: /(\d+)\s*go\s*ssd\b/i, isTeraUnit: false },
      { re: /ssd\s*(?:de\s*)?(\d+)\s*go\b/i, isTeraUnit: false },
      { re: /(\d+)\s*gb\s*ssd\b/i, isTeraUnit: false },
      { re: /(\d+(?:[.,]\d+)?)\s*to\b/i, isTeraUnit: true },
      { re: /(\d+(?:[.,]\d+)?)\s*tb\b/i, isTeraUnit: true },
    ];

    for (const { re, isTeraUnit } of patterns) {
      const match = text.match(re);
      if (match) {
        let value = parseFloat(match[1].replace(',', '.'));
        if (isTeraUnit) value = Math.round(value * 1024);
        if (!interpretation.extractedCriteria.some(c => c.id === 'storage')) {
          interpretation.extractedCriteria.push({
            id: 'storage',
            name: 'Stockage',
            level: 'required',
            parameters: { minValue: value, unit: 'GB' },
          });
        }
        return match[0];
      }
    }
    return null;
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
  ): { category: string; confidence: number; kind: 'domain' | 'generic' }[] {
    // Category detection — French and English keywords
    const categories: { category: string; confidence: number; kind: 'domain' | 'generic' }[] = [];

    for (const [category, keywords] of Object.entries(DOMAIN_CATEGORY_PATTERNS)) {
      const matches = keywords.filter(kw => this.matchesAsWord(text, kw)).length;
      if (matches > 0) {
        categories.push({ category, confidence: Math.min(1, matches / keywords.length), kind: 'domain' });
      }
    }
    for (const [category, keywords] of Object.entries(GENERIC_CATEGORY_PATTERNS)) {
      const matches = keywords.filter(kw => this.matchesAsWord(text, kw)).length;
      if (matches > 0) {
        categories.push({ category, confidence: Math.min(1, matches / keywords.length), kind: 'generic' });
      }
    }

    // Domain categories ALWAYS outrank generic ones, regardless of confidence
    // ratio. Without this, a query like "laptop" (1 keyword match) resolves
    // to 'electronics' (1/5 = 0.2) over 'ordinateur_portable' (1/7 ≈ 0.143)
    // purely because 'electronics' has a shorter keyword list — a smaller,
    // less specific category winning BECAUSE it's less specific is backwards.
    // A domain category IS the specific one: it's what the Capucine catalog
    // (and DiscoveryCriteria.categories' hard filter — see buildSearchPlan())
    // actually indexes offers by; 'electronics' matches nothing in the
    // catalog at all. Within the same kind, highest confidence wins; ties
    // keep their original relative order (Array.sort is stable).
    categories.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'domain' ? -1 : 1;
      return b.confidence - a.confidence;
    });

    return categories;
  }

  /**
   * Word-boundary keyword match (case-insensitive, French-accent-aware,
   * optional trailing 's' for simple plurals).
   *
   * Plain `text.includes(keyword)` matches a keyword anywhere, including
   * mid-word — e.g. "table" inside "por[table]" — which let short-keyword
   * categories (like 'furniture': chair/table/desk/bookcase/sofa) win by
   * accident over the actually-relevant category. `\b` isn't safe here
   * either: JS's default \w doesn't include accented letters, so `\bécouteur\b`
   * fails to match "un écouteur bluetooth" at all (no recognized boundary
   * before 'é'). This uses an explicit French-aware "word character" class
   * via lookaround instead.
   */
  private matchesAsWord(text: string, keyword: string): boolean {
    const WORD_CHAR = 'a-z0-9à-ÿ';
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![${WORD_CHAR}])${escaped}s?(?![${WORD_CHAR}])`, 'i');
    return pattern.test(text.toLowerCase());
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
            currency: finalBudget.currency || 'unknown',
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

// ============================================================================
// CONVERSATIONAL RANKING-PREFERENCE INTENT
// ("montre-moi les moins chers" / "show me the cheapest ones")
//
// Pure, standalone functions (not part of BasicPatternInterpreter's
// parseText pipeline) — same reasoning as extractCondition()/the budget-
// refinement patterns: these are conversational-refinement phrasings, only
// ever run via CapucineEngine.interpretFollowUp(), never mixed into a
// single-turn product query's criteria extraction.
// ============================================================================

/**
 * Detects a request to reorder results by price — returns the
 * RankingPreference id (see ranking-preference.ts) or null when the text
 * expresses no ranking intent. Never guesses BEST_VALUE/FASTEST_DELIVERY/
 * BEST_RATED from vague wording — only PRICE_LOWEST has real signal
 * patterns today, matching what ranking-preference.ts actually implements.
 */
export function extractRankingPreference(text: string): RankingPreference | null {
  const PRICE_LOWEST_PATTERNS = [
    /\bmoins\s+chers?\b/i,
    /\ble\s+(?:moins|plus\s+bas)\s+cher\b/i,
    /\bprix\s+(?:le\s+plus\s+bas|croissants?)\b/i,
    /\b(?:classe|classer|classez|trie|trier|triez|tri[ée])[a-zàâäéèêëïîôùûüç -]*\bprix\b/i,
    /\bdu\s+moins\s+cher\s+au\s+plus\s+cher\b/i,
    /\bmeilleur\s+prix\b/i,
    /\bcheapest\b/i,
    /\blowest\s+price\b/i,
    /\bsort(?:ed)?\s+by\s+price\b/i,
    /\bbest\s+price\b/i,
  ];
  if (PRICE_LOWEST_PATTERNS.some(re => re.test(text))) return 'PRICE_LOWEST';
  return null;
}

/**
 * "montre-moi les 3 meilleures" / "top 3" / "les 3 premières" — limits how
 * many results are presented, applied as a pure post-ranking slice (see
 * server.ts) — never re-runs discovery/admissibility for fewer candidates.
 * Returns null (never 0 or a guessed default) when no number is expressed.
 */
export function extractResultLimit(text: string): number | null {
  const PATTERNS = [
    /\b(?:montre|affiche|donne)[a-zàâäéèêëïîôùûüç -]*\bles?\s+(\d+)\s+(?:meilleur|premi)/i,
    /\btop\s*(\d+)\b/i,
    /\bles?\s+(\d+)\s+(?:meilleures?|premi[eè]res?|premiers?)\b/i,
    /\bshow\s+(?:me\s+)?(?:the\s+)?(\d+)\s+best\b/i,
  ];
  for (const re of PATTERNS) {
    const match = text.match(re);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

/**
 * "exclue Amazon" / "sans Amazon" / "exclude Amazon" / "pas Fnac" — merchant
 * EXCLUSION by free-text NAME (not a controlled catalog id — matched against
 * offer.merchant.name case-insensitively at presentation time, see
 * server.ts). Returns null when no exclusion is expressed. A merchant name
 * is whatever word(s) follow the exclusion verb — capitalized-word
 * heuristic keeps this from matching on lowercase common words.
 */
export function extractMerchantExclusion(text: string): string | null {
  const PATTERNS = [
    /\bexclu\w*\s+([A-ZÀ-Ý][\w.-]*(?:\s+[A-ZÀ-Ý][\w.-]*)?)/,
    /\bsans\s+([A-ZÀ-Ý][\w.-]*(?:\s+[A-ZÀ-Ý][\w.-]*)?)\b(?!\s*frais)/,
    /\bpas\s+([A-ZÀ-Ý][\w.-]*(?:\s+[A-ZÀ-Ý][\w.-]*)?)/,
    /\bexclude\s+([A-ZÀ-Ý][\w.-]*(?:\s+[A-ZÀ-Ý][\w.-]*)?)/,
    /\bwithout\s+([A-ZÀ-Ý][\w.-]*(?:\s+[A-ZÀ-Ý][\w.-]*)?)/,
  ];
  for (const re of PATTERNS) {
    const match = text.match(re);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * "sans frais de livraison" / "livraison gratuite uniquement" / "free
 * shipping only" — a real, checkable criterion (Offer.shippingCost IS
 * populated by every discovery source that reports it — see
 * AdmissibilityEngine's generic offer.characteristics[id] lookup). Returns
 * a PreferenceCriterion the SAME WAY extractCondition()/applyCategoryDetection()
 * do — unknownPolicy 'pass' since many offers legitimately have unknown
 * shipping cost (see ConversationSession follow-up wiring), never treating
 * an unreported shipping cost as a violation.
 */
export function extractFreeShippingIntent(text: string): PreferenceCriterion | null {
  const PATTERNS = [
    /\bsans\s+frais\s+de\s+livraison\b/i,
    /\blivraison\s+gratuite\s+(?:uniquement|seulement)\b/i,
    /\buniquement\s+(?:la\s+)?livraison\s+gratuite\b/i,
    /\bfree\s+shipping\s+only\b/i,
    /\bonly\s+free\s+shipping\b/i,
  ];
  if (!PATTERNS.some(re => re.test(text))) return null;
  return {
    id: 'shipping_cost',
    name: 'Livraison gratuite',
    level: 'required',
    parameters: { exactValue: 0, unit: 'unknown', unknownPolicy: 'pass' },
  };
}

/**
 * "garde uniquement les offres livrables en France" / "livrable chez moi" /
 * "deliverable to France" — takes `destinationCountry` explicitly (the
 * criterion means nothing without it — "livrable" to WHERE?) and produces a
 * criterion with `preferredValues: [destinationCountry]`, the SAME
 * `offer.characteristics[id] === preferredValues[?]` comparison every other
 * generic criterion uses (AdmissibilityEngine.checkPreferredValues) — a
 * PREVIOUS version of this function omitted preferredValues entirely, which
 * meant the criterion could never actually compare anything even once a
 * data source populated `characteristics['deliversTo']` (fixed here).
 *
 * HONEST LIMITATION (still real, root-cause audited — see final report,
 * megaprompt PARTIE 2 "PROBLÈME A"): no discovery source (local catalog
 * fixtures, ProductPageExtractor) yet WRITES `characteristics['deliversTo']`
 * — schema.org's OfferShippingDetails.shippingDestination is the correct
 * real-world source for this (merchants that publish it), but extracting it
 * is a separate, not-yet-implemented ProductPageExtractor enhancement. The
 * criterion is now correctly FORMED and ready to compare the moment that
 * data exists; today it still honestly resolves UNKNOWN (unknownPolicy
 * 'pass') for every offer, never VIOLATED, never fabricated as SATISFIED.
 */
export function extractDeliverabilityIntent(text: string, destinationCountry: string): PreferenceCriterion | null {
  const PATTERNS = [
    /\blivrables?\s+(?:en|chez)\s+/i,
    /\bdeliverable\s+(?:to|in)\s+/i,
  ];
  if (!PATTERNS.some(re => re.test(text))) return null;
  return {
    id: 'deliversTo',
    name: 'Livrable à destination',
    level: 'required',
    parameters: { preferredValues: [destinationCountry], unknownPolicy: 'pass' },
  };
}

/**
 * Country-name recognition — small, controlled, FR/EN (extensible), NOT a
 * general translator. Scoped to the countries CATEGORY_TRANSLATIONS in
 * search-strategy-planner.ts already has query vocabulary for (de/es/it),
 * plus pt/en — a targetCountry with no matching search-language support
 * would silently produce no extra query, which is the correct honest
 * behavior (see SearchStrategyPlanner.buildInternationalStrategies()).
 */
// Exported so product-page-extractor.ts can reuse the SAME name→code
// dictionary when normalizing a merchant's JSON-LD-published shipping
// destination (e.g. shippingDestination.addressCountry: "France") — one
// controlled country-name dictionary, not two.
export const COUNTRY_NAMES: Record<string, SupportedCountry> = {
  allemagne: 'DE', germany: 'DE', deutschland: 'DE',
  espagne: 'ES', spain: 'ES', españa: 'ES',
  italie: 'IT', italy: 'IT', italia: 'IT',
  portugal: 'PT',
  'royaume-uni': 'GB', 'royaume uni': 'GB', angleterre: 'GB', 'united kingdom': 'GB', uk: 'GB', england: 'GB', britain: 'GB',
  france: 'FR',
};

export interface InternationalIntent {
  /** Countries explicitly named — empty if the text only broadens generically. */
  targetCountries: SupportedCountry[];
  /** "cherche partout en Europe" / "peu importe le pays" / "search abroad" —
   *  broaden without a specific country. Resolved to a curated default set
   *  by the caller (CapucineEngine), never an unbounded "every country". */
  broaden: boolean;
}

/**
 * Detects an international-search-scope follow-up ("cherche aussi en
 * Allemagne", "also search Germany", "cherche partout en Europe"). Returns
 * null when the text expresses no such intent — a plain "casque bluetooth"
 * follow-up must never be misread as an international request.
 */
export function extractInternationalIntent(text: string): InternationalIntent | null {
  const lower = text.toLowerCase();

  // Requires a search/look/compare framing so an unrelated mention of a
  // country name (rare, but possible) isn't misread as a scope change.
  const FRAMING = /\b(?:cherche|regarde|compare|recherche|search|look|compare)\w*\b/i;
  const BROADEN = /\b(?:partout|peu importe le pays|plusieurs pays|à l'étranger|a l'etranger|en europe|internationally|across europe|abroad|multiple countries|any country)\b/i;

  const hasFraming = FRAMING.test(lower);
  const broaden = BROADEN.test(lower);

  const targetCountries: SupportedCountry[] = [];
  if (hasFraming || broaden) {
    for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower) && !targetCountries.includes(code)) targetCountries.push(code);
    }
  }

  if (!hasFraming && !broaden) return null;
  if (targetCountries.length === 0 && !broaden) return null; // framing alone ("cherche un casque") is not an international intent

  return { targetCountries, broaden };
}

// ============================================================================
// RETRY / RELAUNCH INTENT — "cherche ailleurs" / "trouve une meilleure offre"
// (megaprompt PARTIE 3/4). Three DISTINCT intents, not one "try again"
// bucket — see capucine-engine.ts's interpretFollowUp() / server.ts for how
// each maps to a genuinely different, real mechanism:
//   SEARCH_ELSEWHERE — avoid the merchants already shown (reuses the SAME
//     excludedMerchantNames presentation filter as "exclue Amazon" — see
//     ConversationSession).
//   SEARCH_AGAIN — SEARCH_ELSEWHERE's merchant avoidance PLUS broadens the
//     international search scope if it hasn't been already (reuses
//     extractInternationalIntent's broaden mechanism — no new discovery
//     engine).
//   FIND_BETTER — avoids the exact PRODUCTS already shown (not merchants —
//     a different offer from the SAME merchant is fine), keeping every
//     existing constraint and the current ranking preference, so "better"
//     is judged by whatever the user already asked for (cost if
//     PRICE_LOWEST, relevance otherwise) — never a redefined notion of
//     "better".
// A bare re-run with IDENTICAL parameters would return IDENTICAL results
// (CapucineEngine's ranking is deterministic — see determinism tests), so
// every retry intent must change SOMETHING real, never just replay the
// same search and call it a relaunch.
// ============================================================================

export type RetryIntent = 'SEARCH_AGAIN' | 'SEARCH_ELSEWHERE' | 'FIND_BETTER';

export function extractRetryIntent(text: string): RetryIntent | null {
  const FIND_BETTER_PATTERNS = [
    /\bmeilleure?\s+offre\b/i,
    /\btrouve\s+mieux\b/i,
    /\bune\s+meilleure\s+offre\b/i,
    /\bfind\s+(?:a\s+)?better\b/i,
    /\bsomething\s+better\b/i,
    /\bbetter\s+deal\b/i,
  ];
  if (FIND_BETTER_PATTERNS.some(re => re.test(text))) return 'FIND_BETTER';

  const SEARCH_ELSEWHERE_PATTERNS = [
    /\bcherch(?:e|ez|ons)\s+ailleurs\b/i,
    /\bautres?\s+sites?\b/i,
    /\bautres?\s+magasins?\b/i,
    /\btrouve\s+autre\s+chose\b/i,
    /\blook\s+elsewhere\b/i,
    /\bother\s+(?:stores|websites|shops|sites)\b/i,
    /\bfind\s+another\s+(?:one)?\b/i,
  ];
  if (SEARCH_ELSEWHERE_PATTERNS.some(re => re.test(text))) return 'SEARCH_ELSEWHERE';

  const SEARCH_AGAIN_PATTERNS = [
    /\b(?:cherche|regarde)[a-zàâäéèêëïîôùûüç -]*\bencore\b/i,
    /\b(?:cherche|recherche)[a-zàâäéèêëïîôùûüç -]*\bdavantage\b/i,
    // No leading \b before "é" — accented letters aren't \w in JS regex, so
    // a word-boundary check right before one never fires (same fix as
    // extractCondition()'s "reconditionné" pattern earlier in this file).
    /élargis?\s+la\s+recherche\b/i,
    /\bcontinue(?:r|z)?\b/i,
    /\bd'?autres?\s+r[ée]sultats\b/i,
    /\bsearch\s+again\b/i,
    /\bsearch\s+more\b/i,
    /\bkeep\s+searching\b/i,
  ];
  if (SEARCH_AGAIN_PATTERNS.some(re => re.test(text))) return 'SEARCH_AGAIN';

  return null;
}
