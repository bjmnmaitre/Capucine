/**
 * Capucine Domain Types
 *
 * Core data structures representing the shopping agent's domain.
 * These types implement the 20 architectural invariants of Capucine.
 */

/**
 * Status of a cart preparation operation.
 */
export type CartPreparedStatus =
  | 'pending'           // Not started
  | 'preparing'         // In progress
  | 'prepared'          // Ready for merchant
  | 'partially_prepared' // Some fields filled, manual completion needed
  | 'failed'            // Preparation failed
  | 'user_action_required'; // Waiting for user (e.g., login)

/**
 * Status of a checkout attempt.
 */
export type CheckoutStatus =
  | 'verification_required'
  | 'verified'
  | 'user_approval_required'
  | 'user_approving'
  | 'approved'
  | 'approval_invalidated'
  | 'execution_ready'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'verification_failed';

// ============================================================================
// PREFERENCE HIERARCHY
// ============================================================================

/**
 * Levels in the preference hierarchy.
 * Determines how strongly a criterion influences ranking.
 *
 * - forbidden: Must not be satisfied. Violates search if any result has this.
 * - required: Must be satisfied. Filtering constraint.
 * - very_important: Strong weighting in ranking.
 * - important: Moderate weighting.
 * - preference: Weak preference, but positive if present.
 * - low: Very low preference, barely affects ranking.
 * - none: No preference, neutral.
 */
export type PreferenceLevel =
  | 'forbidden'
  | 'required'
  | 'very_important'
  | 'important'
  | 'preference'
  | 'low'
  | 'none';

// ============================================================================
// USAGE CONTEXT DEFINITIONS
// ============================================================================

/**
 * Usage context represents how the user intends to use a product.
 * This is contextual information that influences attribute relevance
 * but does NOT become a hard constraint.
 */
export interface UsageContextEntry {
  /** Primary use case (music, transport, sport, etc.) */
  usage: UsageType;
  /** Specific context or environment (transport, office, home, etc.) */
  context?: ContextType;
  /**
   * Where this came from. PROVENANCE_PRESERVATION: an explanation must never
   * present an inference as something the user asked for.
   * - 'user'     — the user actually said it ("pour les transports")
   * - 'inferred' — Capucine deduced it from something else
   * - 'profile'  — carried over from the permanent profile
   */
  source: 'user' | 'inferred' | 'profile';
  /** Confidence in this interpretation (0-1) */
  confidence: number;
  /**
   * The exact substring of the user's own text this entry was read from —
   * the provenance evidence. Absent when the entry didn't come from text.
   */
  matchedText?: string;
}

/**
 * Usage context represents how the user intends to use a product.
 * This is contextual information that influences attribute relevance
 * but does NOT become a hard constraint.
 *
 * MULTI-CONTEXT: a query legitimately carries several usages ("pour le sport
 * et les voyages"). The dominant one stays on the object itself so every
 * existing reader (`ctx.usage` / `ctx.context`) keeps working unchanged; the
 * others live in `additional` and are never silently collapsed into it.
 */
export interface UsageContext extends UsageContextEntry {
  /** When this was determined */
  timestamp: Date;
  /**
   * Secondary usages stated in the same request, in the order they appeared.
   * Each keeps its own source/confidence/matchedText — never merged away.
   */
  additional?: UsageContextEntry[];
}

/** Types of usage contexts supported */
export type UsageType =
  | 'music'
  | 'transport'
  | 'travel'
  | 'sport'
  | 'office'
  | 'gaming'
  | 'home'
  | 'outdoor'
  | 'other';

/** Specific contexts that refine usage */
export type ContextType =
  | 'transport'
  | 'office'
  | 'home'
  | 'outdoor'
  | 'gaming'
  | 'studio'
  | 'classroom'
  | 'gym'
  | 'travel'
  | 'other';

/**
 * Contextual signals indicate which product attributes are relevant
 * for a given usage context. These are NOT hard constraints - they
 * merely indicate relevance for ranking and search strategy.
 *
 * A key set to 'relevant' means: "for this usage, evidence about this
 * attribute is worth taking into account". It never means "the offer must
 * have it" — that would be a constraint, and constraints only ever come
 * from what the user explicitly asked for (see AdmissibilityEngine, which
 * never sees this type).
 */
export interface ContextualSignals {
  /** Whether portability is relevant (e.g., for transport usage) */
  portability?: RelevanceLevel;
  /** Whether weight is relevant */
  weight?: RelevanceLevel;
  /** Whether battery life is relevant */
  batteryLife?: RelevanceLevel;
  /** Whether noise cancellation is relevant */
  noiseCancellation?: RelevanceLevel;
  /** Whether comfort is relevant */
  comfort?: RelevanceLevel;
  /** Whether audio/sound quality is relevant */
  audioQuality?: RelevanceLevel;
  /** Whether microphone quality is relevant */
  microphone?: RelevanceLevel;
  /** Whether latency is relevant */
  latency?: RelevanceLevel;
  /** Whether stability (staying in place) is relevant */
  stability?: RelevanceLevel;
  /** Whether sweat resistance is relevant */
  sweatResistance?: RelevanceLevel;
  /** Whether spatial audio / soundstage is relevant */
  spatialAudio?: RelevanceLevel;
  /** Whether foldability is relevant */
  foldability?: RelevanceLevel;
  /** Whether compatibility (with a device/platform) is relevant */
  compatibility?: RelevanceLevel;
  /** Whether codec support (aptX, LDAC, AAC...) is relevant */
  codecSupport?: RelevanceLevel;
  /** Whether frequency response is relevant */
  frequencyResponse?: RelevanceLevel;
}

/** Levels of relevance for contextual signals */
export type RelevanceLevel = 'relevant' | 'neutral' | 'not_relevant';

// ============================================================================
// DATA QUALITY & PROVENANCE
// ============================================================================

/**
 * Represents whether a data point is known, unknown, or contradictory.
 * This is CRITICAL to Capucine's integrity:
 * Unknown must NOT be treated as negative.
 * Contradictory must be preserved (not resolved arbitrarily).
 */
export type DataStatus =
  | 'verified'      // Data confirmed by authoritative source
  | 'known'         // Data known but not verified
  | 'unknown'       // No information available
  | 'contradictory' // Multiple sources give conflicting info
  | 'unverifiable'; // Information exists but cannot be verified

/**
 * Metadata about a data point.
 * Allows Capucine to track where information comes from.
 */
export interface DataProvenance {
  source: string;        // Where this data came from (e.g., 'manufacturer', 'retailer', 'review-site')
  retrievedAt: Date;     // When was this retrieved
  reliability?: number;  // 0-1 confidence score (optional, for future use)
}

/**
 * A data point with full metadata.
 * This prevents the critical error: treating unknown as negative.
 *
 * INVARIANT: DataPoint<T>.value can only be non-null if status !== 'unknown'
 */
export interface DataPoint<T> {
  value: T | null;
  status: DataStatus;
  provenance?: DataProvenance;
  conflictingValues?: T[]; // If status === 'contradictory', store observed values
}

// ============================================================================
// CRITERIA & PREFERENCES
// ============================================================================

/**
 * A single evaluation criterion in the shopping context.
 * Examples: price, durability, repair-ability, country-of-origin, availability
 */
export interface PreferenceCriterion {
  id: string;
  name: string;
  description?: string;

  // How important is this criterion?
  level: PreferenceLevel;

  // How should this criterion be evaluated?
  // Examples: "price-ascending", "quality-descending", "boolean"
  evaluationType?: string;

  // Optional constraints or parameters
  // E.g., { maxBudget: 600, currency: 'EUR' }
  parameters?: Record<string, unknown>;
}

/**
 * Collection of criteria with their hierarchy.
 */
export interface CriteriaProfile {
  criteria: PreferenceCriterion[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// USER PROFILE (PERMANENT)
// ============================================================================

/**
 * UserProfile represents persistent user preferences.
 * This is NEVER modified automatically by observations or searches.
 * Only explicit user actions modify the profile.
 *
 * INVARIANT: This object is immutable during a search.
 */
export interface UserProfile {
  userId: string;

  // Permanent criteria (e.g., always prefer European products, avoid marketplaces)
  preferences: CriteriaProfile;

  // Metadata
  createdAt: Date;
  updatedAt: Date;

  // Optional: User-facing description of what they want
  description?: string;

  // ── Localization / interaction preferences (permanent, lowest priority in
  // the resolution chain — an explicit request or session override always
  // wins; see application/i18n.ts resolveLanguage()). Plain strings here
  // (not a closed union) so domain/ doesn't depend on application/ — the
  // application layer validates/parses them via SUPPORTED_LANGUAGES etc. ──
  preferredLanguage?: string;  // e.g. 'fr', 'en' — ISO 639-1
  preferredLocale?: string;    // e.g. 'fr-FR', 'en-US' — BCP-47
  preferredCurrency?: string;  // ISO 4217, e.g. 'EUR'
  preferredUnits?: 'metric' | 'imperial';
  preferredVoice?: string;     // provider-specific voice id (see voice-providers.ts)
  preferredResponseMode?: 'text' | 'voice' | 'hybrid'; // see interaction-preferences.ts OutputModality

  // Usage context history (for learning, not for hard constraints)
  usageContextHistory?: UsageContext[];
}

// ============================================================================
// SEARCH REQUIREMENTS (TEMPORARY/CONTEXTUAL)
// ============================================================================

/**
 * CurrentSearchRequirements represents what the user wants RIGHT NOW.
 * This is separate from UserProfile to allow temporary exceptions.
 *
 * CRITICAL INVARIANT:
 * - Temporary exceptions do NOT modify UserProfile
 * - Exceptions are represented explicitly
 * - Ambiguous requirements are not silently interpreted
 */
export interface CurrentSearchRequirements {
  // The actual search criteria for this query
  criteria: PreferenceCriterion[];

  // Exceptions to the permanent profile
  // E.g., "this time, marketplaces are OK" or "this time, price is primary"
  profileExceptions?: {
    criterionId: string;
    temporaryLevel: PreferenceLevel;
    reason?: string; // Why this exception exists
  }[];

  // Usage context for this search (contextual, not hard constraint)
  usageContext?: UsageContext;

  // Clarifications made during AI interpretation
  clarifications?: {
    question: string;
    answer: string;
    resolvedAmbiguity: string;
  }[];

  // Metadata
  createdAt: Date;
  queryText?: string; // Original user query for reference
}

// ============================================================================
// PURCHASE FLOW TYPES
// ============================================================================

/**
 * Represents an item in a shopping cart.
 * Contains the offer reference and user-selected options.
 */
export interface CartItem {
  /** Reference to the offer being purchased */
  offerId: string;
  /** Quantity of this item */
  quantity: number;
  /** User-selected variants (e.g., size, color) */
  selectedVariants?: Record<string, string>;
}

/**
 * User information for pre-filling checkout forms.
 * NOTE: This is ONLY for pre-fill, never stored by Capucine.
 */
export interface UserInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  shippingAddress?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  };
}

/**
 * Represents a shopping cart containing items to be purchased.
 * Does NOT contain payment info (stays with merchant).
 */
export interface Cart {
  /** Unique cart identifier */
  id: string;
  /** Items in the cart */
  items: CartItem[];
  /** Promotions applied to the cart */
  appliedPromotions: PromotionApplication[];
  /** User info for pre-fill only */
  userInfo?: UserInfo;
  /** When the cart was created */
  createdAt: Date;
  /** When the cart was last updated */
  updatedAt: Date;
}

/**
 * Merchant-specific cart representation.
 * Used when the merchant system needs additional data beyond the standard cart.
 */
export interface MerchantCart {
  /** Merchant identifier */
  merchantId: string;
  /** Reference to the Capucine cart */
  cartId: string;
  /** Merchant-specific data needed for cart creation */
  merchantSpecificData: Record<string, unknown>;
}

/**
 * Audit trail entry for tracking cart preparation and checkout attempts.
 */
export interface AuditEntry {
  /** When the action occurred */
  timestamp: Date;
  /** What action was performed */
  action: string;
  /**
   * Outcome of the action. 'unknown' is NOT a soft failure: it means no
   * determination was made — the action is still running, or the data needed
   * to decide was not available. It must never be collapsed into 'success',
   * which would be exactly the UNKNOWN -> certain conversion Capucine forbids.
   * NOTE: AuditEntry is declared twice in this file; TypeScript merges the two
   * declarations, so both MUST carry an identical `result` type.
   */
  result: 'success' | 'failure' | 'unknown';
  /** Additional details about the action */
  details?: string;
  /** Error message if action failed */
  error?: string;
}

/**
 * Tracks the state of a checkout attempt from cart preparation to completion.
 * Maintains audit trail, retry state, and transactional integrity.
 */
export interface CheckoutSession {
  /** Unique session identifier */
  id: string;
  /** Identifier of the user (if authenticated) */
  userId?: string;
  /** Identifier of the offer being purchased */
  offerId: string;
  /** Identifier of the merchant */
  merchantId: string;
  /** The cart being purchased */
  cart: Cart;
  /** Merchant-specific cart representation (if applicable) */
  merchantCart?: MerchantCart;
  /** Current status of the checkout process */
  status: CheckoutStatus;
  /** Which execution capability is being used */
  executionCapability: ExecutionCapabilityType;
  /** URL to complete the purchase (when available) */
  checkoutUrl?: string;
  /** What the user should do next */
  nextAction?: string;
  /** Error message if checkout failed */
  error?: string;
  /** Audit trail of all actions taken */
  auditTrail: AuditEntry[];
  /** Number of retry attempts made */
  retryCount: number;
  /** Maximum number of retry attempts allowed */
  maxRetries: number;
  /** When the session was created */
  createdAt: Date;
  /** When the session was last updated */
  updatedAt: Date;
  /** When the session expires */
  expiresAt: Date;
  /** When the checkout was completed */
  completedAt?: Date;
  /** Correlation ID for tracing across services */
  correlationId: string;
  /** Idempotency key to prevent duplicate operations */
  idempotencyKey: string;
  /** Version of the session for optimistic concurrency */
  version: number;
  /** Snapshot of the cart at session creation */
  cartSnapshot: CartSnapshot;
  /** Snapshot of the price at session creation */
  priceSnapshot: PriceSnapshot;
  /** Snapshot of promotions at session creation */
  promotionSnapshot: PromotionSnapshot[];
  /** Snapshot of the offer at session creation */
  offerSnapshot: OfferSnapshot;
  /** Snapshot of merchant info at session creation */
  merchantSnapshot: MerchantSnapshot;
  /** Verification state */
  verificationState: VerificationState;
  /** Approval state */
  approvalState: ApprovalState;
  /** Execution state */
  executionState: ExecutionState;
  /** Failure state if applicable */
  failureState?: FailureState;
}

// ============================================================================
// MERCHANT & EXECUTION
// ============================================================================

/**
 * Execution capability types.
 * These are INFORMATIONAL ONLY and must NOT influence ranking.
 */
export type ExecutionCapabilityType =
  | 'ucp'                    // Agentic Commerce Protocol
  | 'merchant_api'           // Merchant-specific API
  | 'oauth_redirect'         // OAuth with auto-fill
  | 'web_redirect'           // Simple web redirect
  | 'browser_automation';    // Last resort: automate the browser

/**
 * Merchant entity.
 * Separate from Offer to maintain neutrality.
 *
 * INVARIANT: Merchant identity does NOT affect ranking.
 * If ranking changes based on "who the merchant is", that violates Capucine.
 */
export interface Merchant {
  id: string;
  name: string;
  country: string;

  // Execution capabilities (informational only, not for ranking)
  executionCapabilities: ExecutionCapabilityType[];

  // These MUST NOT be used for ranking:
  // - partnerships: boolean;
  // - affiliateCommission: number;
  // - preferredBy: string[];
}

// ============================================================================
// PRODUCTS & OFFERS
// ============================================================================

/**
 * Product is the commercial object itself.
 * Examples: "Sony WH-1000XM5 headphones", "IKEA Billy Bookcase"
 *
 * Multiple Offers can exist for the same Product (different merchants).
 */
export interface Product {
  id: string;

  // Product identification
  category: string;          // e.g., 'headphones', 'bookcase'
  name: string;
  description?: string;

  // Product characteristics (objective specifications)
  specifications?: Record<string, DataPoint<unknown>>;

  // Metadata
  createdAt: Date;
  source?: string; // Where this product record came from
}

/**
 * Offer is a merchant's specific proposal for a Product.
 * Multiple Offers can exist for one Product.
 *
 * CRITICAL INVARIANT:
 * - Offer.price is a DataPoint (can be unknown)
 * - Offer.availability is a DataPoint
 * - All offer characteristics use DataPoint to handle unknown/contradictory
 */
export interface Offer {
  id: string;

  // Reference to the product being offered
  productId: string;

  // Who is offering this?
  merchant: Merchant;

  // Financial terms
  price: DataPoint<number>;        // Must have currency
  currency?: string;               // ISO 4217 code
  shippingCost: DataPoint<number>;
  shippingTime?: DataPoint<string>;
  /**
   * Additional real-cost components beyond price/shippingCost — see
   * application/cost-engine.ts's CostEngine, which turns these (plus price
   * and shippingCost above) into a CostBreakdown with explicit UNKNOWN
   * propagation. All optional: no current extraction source (JSON-LD via
   * ProductPageExtractor, the local catalog fixtures) populates them yet, so
   * they are absent — never defaulted to a DataPoint with value 0 — on
   * every offer today. Added here (not stuffed into `characteristics`)
   * because, like price/shippingCost, they are financial terms of the
   * offer itself, not descriptive product characteristics.
   */
  taxes?: DataPoint<number>;
  importDuties?: DataPoint<number>;
  fees?: DataPoint<number>;
  discount?: DataPoint<number>;

  // Product-specific offer characteristics
  // These are the actual values for THIS offer of THIS product
  characteristics: Record<string, DataPoint<unknown>>;

  // Execution information (informational, NOT for ranking)
  executionCapability?: ExecutionCapabilityType;
  executionUrl?: string;

  /**
   * Categorical match classification (exact/close/partial/alternative/unknown),
   * distinct from the ranking score. Set at discovery time (see
   * application/match-quality.ts). Descriptive metadata only — NEVER read by
   * PriorityEngine, NEVER a ranking input. Optional: only web-search-derived
   * offers currently set it.
   */
  matchQuality?: SearchMatchQuality;

  // Metadata
  createdAt: Date;
  retrievedAt: Date;
  provenance: DataProvenance;
}

/**
 * How closely a discovered candidate matches what the user actually asked
 * for. See application/match-quality.ts for the classification logic.
 * Defined here (domain layer) so Offer can carry it without application/
 * depending on domain/ backwards.
 *
 * NAMED "SearchMatchQuality" (not "MatchQuality") to avoid collision with
 * the unrelated MatchQuality type already defined in
 * application/deduplication.ts (duplicate-confidence classification —
 * a different concept: "are these two candidates the same product?" vs.
 * "how well does this candidate match what the user searched for?").
 */
export type SearchMatchQuality = 'exact_match' | 'close_match' | 'partial_match' | 'alternative' | 'unknown';

// ============================================================================
// RANKING & RESULTS
// ============================================================================

/**
 * Explanation for why an Offer scored a certain value on one criterion.
 */
export interface CriterionScore {
  criterionId: string;
  criterionName: string;
  level: PreferenceLevel;

  // The actual score for this criterion (0-100 or similar), ROUNDED for display.
  score: number;

  /**
   * The same criterion score before rounding. AGGREGATION uses this one.
   *
   * WHY IT EXISTS: sub-scores were rounded to integers at computation, and the
   * weighted total was then built from those rounded values. Two offers 10 €
   * apart could therefore receive an identical criterion score (319 € and
   * 329 € against a 400 € budget both round to 84), so a real difference was
   * gone before it ever reached the total. This is the same defect as the one
   * fixed on `overallScore`, one level lower: precision must survive until the
   * comparison, and rounding is a display concern.
   */
  scoreExact?: number;

  // Why did it get this score?
  reasoning: string;

  // What data was used?
  dataUsed: {
    value?: unknown;
    status: DataStatus;
    source?: string;
  };
}

/**
 * Result of ranking a single Offer.
 * Contains the overall score and per-criterion breakdown.
 */

/**
 * How ONE contextual signal scored against ONE offer.
 *
 * A contextual signal is never a constraint: the only thing it can do is add
 * evidence-based points on top of a score the offer already earned from the
 * user's real criteria. Three outcomes are possible and all three are
 * reported explicitly rather than collapsed into a number:
 *   - 'applied'    — the offer has KNOWN data for this attribute, so it was scored.
 *   - 'unknown'    — no data. Contributes 0 and costs nothing (UNKNOWN != FALSE).
 *   - 'superseded' — the user set an explicit criterion on this same attribute,
 *                    so the explicit criterion decides and the signal stands down
 *                    (no double counting, explicit always dominates inferred).
 */
export interface ContextualSignalScore {
  /** Key from ContextualSignals, e.g. 'weight', 'batteryLife'. */
  signal: keyof ContextualSignals;
  /** The offer characteristic actually read, when one was found. */
  attribute?: string;
  outcome: 'applied' | 'unknown' | 'superseded';
  /** Raw value read from the offer, when known. */
  foundValue?: unknown;
  /** Status of that value (never 'unknown' when outcome === 'applied'). */
  foundStatus?: DataStatus;
  /** Points actually contributed. Always >= 0 — a signal can never subtract. */
  contribution: number;
  /** Points this signal could have contributed had the data been ideal. */
  maxContribution: number;
  /** Deterministic, human-readable justification. */
  reasoning: string;
}

/**
 * The complete contextual-relevance verdict for one offer.
 *
 * INVARIANT: `bonus >= 0`. The score an offer gets WITH a usage context is
 * always >= the score it would get WITHOUT one. Usage context can reward
 * evidence; it can never punish its absence.
 */
export interface ContextualRelevance {
  /** The usage context these signals were derived from (provenance). */
  usageContext: UsageContext;
  /** Points added to the offer's base score. >= 0, capped. */
  bonus: number;
  /** Maximum the offer could have obtained from the applicable signals. */
  maxBonus: number;
  /** Per-signal breakdown, including the ones that contributed nothing. */
  signals: ContextualSignalScore[];
}

/**
 * The complete ranking result for one offer.
 */
export interface RankedOffer {
  offer: Offer;

  // Overall ranking score (0-100 or similar scale), ROUNDED for display and
  // for the API contract.
  overallScore: number;

  /**
   * The same score before rounding. Ordering uses THIS value.
   *
   * WHY IT EXISTS: `overallScore` is rounded to an integer, and the sort used
   * to read that rounded value. Two offers whose real scores differed by less
   * than half a point therefore compared as exactly equal, and the order fell
   * back to the id tiebreaker — so a genuinely better offer could be listed
   * below a worse one. The engine had computed the difference and then
   * discarded it before using it.
   *
   * This changes no weight and no score: it only stops throwing away a
   * distinction that was already computed. The weighting question itself
   * (how much price should count) remains open and untouched.
   */
  overallScoreExact?: number;

  // Per-criterion breakdown
  criterionScores: CriterionScore[];

  // Readable summary of why this Offer is ranked here
  summary: string;

  // Did this Offer satisfy all hard constraints?
  satisfiesAllConstraints: boolean;

  // Which constraints were violated (if any)?
  violatedConstraints?: {
    criterionId: string;
    criterionName: string;
    reason: string;
  }[];

  /**
   * Can this offer actually be bought? Stock, delivery, a usable purchase
   * link, and whether its data is solid enough to act on — each reported
   * separately, each with its own unknown state.
   *
   * Purely INFORMATIONAL for eligibility: readiness never decided whether this
   * offer is here (AdmissibilityEngine did). It can only add the bounded,
   * non-negative `readinessBonus` below.
   * Typed as `unknown` here so domain/types.ts stays free of a dependency on
   * domain/purchase-readiness.ts; consumers narrow it to OfferReadiness.
   */
  readiness?: unknown;

  /**
   * Points added to `overallScore` for CONFIRMED availability facts. Always
   * >= 0: an offer whose merchant publishes no stock information scores
   * exactly what it would have scored without readiness (INVARIANT 2).
   */
  readinessBonus?: number;

  /**
   * Contextual relevance for the request's usage context, when one was
   * present. Absent when the request carried no usage context — in which
   * case ranking behaves exactly as it did before usage context existed.
   * `overallScore` ALREADY includes `contextualRelevance.bonus`; this field
   * is what makes that addition auditable and explainable.
   */
  contextualRelevance?: ContextualRelevance;
}

// ============================================================================
// RANKING REQUEST & RESULT
// ============================================================================

/**
 * Input to the Priority Engine.
 * Contains everything needed to produce a deterministic ranking.
 */
export interface RankingRequest {
  // Merged profile (permanent + temporary + exceptions)
  effectiveCriteria: PreferenceCriterion[];

  // Offers to rank
  offers: Offer[];

  /**
   * Usage context for this search, when the user expressed one.
   * CONTEXTUAL ONLY: it is applied AFTER admissibility, adds a bounded,
   * non-negative bonus, and can never make an inadmissible offer rankable —
   * eligibility is decided in exactly one place (AdmissibilityEngine).
   * Absent → ranking is byte-for-byte the pre-usage-context behavior.
   */
  usageContext?: UsageContext;

  // Metadata
  requestId: string;
  timestamp: Date;
}

/**
 * Output from the Priority Engine.
 * Deterministic, reproducible, independent of AI, merchant, or execution.
 */
export interface RankingResult {
  requestId: string;

  // Offers ranked from best to worst
  rankedOffers: RankedOffer[];

  // Offers that violated hard constraints (not ranked)
  rejectedOffers?: {
    offer: Offer;
    reason: string;
  }[];

  // Metadata
  generatedAt: Date;

  // For debugging and reproducibility
  checksum?: string; // Hash of input to verify determinism
}

// ============================================================================
// MERGED CONTEXT (TEMPORARY)
// ============================================================================

/**
 * Merged context combining UserProfile + CurrentSearchRequirements.
 * This is what the Priority Engine actually uses.
 * It is computed fresh for each search and discarded afterward.
 *
 * INVARIANT: Creating this does not modify either UserProfile or CurrentSearchRequirements.
 */
export interface MergedContext {
  userId: string;
  searchId: string;

  // The effective criteria after merging profile + requirements
  effectiveCriteria: PreferenceCriterion[];

  // Usage context for this search (contextual signals, not hard constraints)
  usageContext?: UsageContext;

  // Traceability: which criteria came from where?
  criteriaOrigin: {
    criterionId: string;
    source: 'profile' | 'search' | 'exception';
    originalLevel?: PreferenceLevel; // If from exception, what was the original?
  }[];

  // Metadata
  createdAt: Date;
}

// ============================================================================
// AI INTERPRETATION RESULT
// ============================================================================

/**
 * Result of AI interpretation of user query.
 * This is NOT the final decision — it's the INPUT to decision-making.
 *
 * CRITICAL INVARIANT:
 * - The AI structures and interprets the query
 * - The AI does NOT decide what's best
 * - Ambiguous interpretations are flagged for clarification
 * - The output goes to the Priority Engine, not directly to the user
 */
export interface AIInterpretationResult {
  // Understood criteria
  extractedCriteria: PreferenceCriterion[];

  // Ambiguities that need clarification
  ambiguities: {
    criterion: string;
    possibleInterpretations: string[];
    recommendation?: string; // AI's suggestion, pending user validation
  }[];

  // Clarifications already received
  resolvedClarifications: {
    ambiguity: string;
    userAnswer: string;
  }[];

  // Detected exceptions to the profile
  detectedExceptions: CurrentSearchRequirements['profileExceptions'];

  // Usage context from AI interpretation (non-binding)
  usageContext?: UsageContext;

  // Overall confidence in interpretation
  confidence: number; // 0-1

  // If confidence is low, what's the reason?
  lowConfidenceReasons?: string[];

  // Metadata
  queryText: string;
  generatedAt: Date;
}

// ============================================================================
// PURCHASE FLOW TYPES
// ============================================================================

export type PromotionType =
  | 'percentage_discount'
  | 'fixed_discount'
  | 'free_shipping'
  | 'combined'
  | 'loyalty_points'
  | 'cashback'
  | 'bundle';

export type PromotionVerificationStatus = 'verified' | 'unverified' | 'expired' | 'invalid';

export interface PromotionCondition {
  type: 'minimum_amount' | 'category' | 'quantity' | 'customer_type' | 'validity_date';
  operator: '>' | '>=' | '=' | '<' | '<=';
  value: unknown;
  description?: string;
}

/**
 * A promotional offer (code, voucher, or automatic discount).
 */
export interface Promotion {
  id: string;
  code: string; // E.g., "CAPUCINE10", "SUMMER50"

  // Type and value
  type: PromotionType;
  discountValue?: number; // For percentage or fixed discount
  discountUnit?: 'percent' | 'euro' | 'shipping';

  // Conditions for applicability
  conditions: PromotionCondition[];

  // Validity
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;

  // Source and verification
  source: string; // E.g., 'merchant_api', 'web_search', 'affiliate_network'
  verificationStatus: PromotionVerificationStatus;
  lastVerified?: Date;

  // Merchant-specific
  merchantId?: string;
  applicableToCategories?: string[];
  applicableToProducts?: string[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of applying a promotion to an offer.
 */
export interface PromotionApplication {
  promotion: Promotion;
  applicabilityStatus: 'applicable' | 'not_applicable' | 'expired' | 'invalid_conditions';
  originalPrice: number;
  discountedPrice: number;
  savingsAmount: number;
  savingsPercent: number;
  reasoning: string;
}

/**
 * Promo savings summary for an offer.
 */
export interface PromoSavings {
  bestPromoAvailable?: PromotionApplication;
  applicablePromos: PromotionApplication[];
  totalSavingsPossible: number;
  summary: string;
}

/**
 * Represents an item in a shopping cart.
 * Contains the offer reference and user-selected options.
 */
export interface CartItem {
  /** Reference to the offer being purchased */
  offerId: string;
  /** Quantity of this item */
  quantity: number;
  /** User-selected variants (e.g., size, color) */
  selectedVariants?: Record<string, string>;
}

/**
 * User information for pre-filling checkout forms.
 * NOTE: This is ONLY for pre-fill, never stored by Capucine.
 */
export interface UserInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  shippingAddress?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  };
}

/**
 * Merchant-specific cart representation.
 * Used when the merchant system needs additional data beyond the standard cart.
 */
export interface MerchantCart {
  /** Merchant identifier */
  merchantId: string;
  /** Reference to the Capucine cart */
  cartId: string;
  /** Merchant-specific data needed for cart creation */
  merchantSpecificData: Record<string, unknown>;
}

/**
 * Audit trail entry for tracking cart preparation and checkout attempts.
 */
export interface AuditEntry {
  /** When the action occurred */
  timestamp: Date;
  /** What action was performed */
  action: string;
  /**
   * Outcome of the action. 'unknown' is NOT a soft failure: it means no
   * determination was made — the action is still running, or the data needed
   * to decide was not available. It must never be collapsed into 'success',
   * which would be exactly the UNKNOWN -> certain conversion Capucine forbids.
   * NOTE: AuditEntry is declared twice in this file; TypeScript merges the two
   * declarations, so both MUST carry an identical `result` type.
   */
  result: 'success' | 'failure' | 'unknown';
  /** Additional details about the action */
  details?: string;
  /** Error message if action failed */
  error?: string;
}

/**
 * Tracks the state of a checkout attempt from cart preparation to completion.
 * Maintains audit trail and retry state.
 */
/**
 * Tracks the state of a checkout attempt from cart preparation to completion.
 * Maintains audit trail, retry state, and transactional integrity.
 */
export interface CheckoutSession {
  /** Unique session identifier */
  id: string;
  /** Identifier of the user (if authenticated) */
  userId?: string;
  /** Identifier of the offer being purchased */
  offerId: string;
  /** Identifier of the merchant */
  merchantId: string;
  /** The cart being purchased */
  cart: Cart;
  /** Merchant-specific cart representation (if applicable) */
  merchantCart?: MerchantCart;
  /** Current status of the checkout process */
  status: CheckoutStatus;
  /** Which execution capability is being used */
  executionCapability: ExecutionCapabilityType;
  /** URL to complete the purchase (when available) */
  checkoutUrl?: string;
  /** What the user should do next */
  nextAction?: string;
  /** Error message if checkout failed */
  error?: string;
  /** Audit trail of all actions taken */
  auditTrail: AuditEntry[];
  /** Number of retry attempts made */
  retryCount: number;
  /** Maximum number of retry attempts allowed */
  maxRetries: number;
  /** When the session was created */
  createdAt: Date;
  /** When the session was last updated */
  updatedAt: Date;
  /** When the session expires */
  expiresAt: Date;
  /** When the checkout was completed */
  completedAt?: Date;
  /** Correlation ID for tracing across services */
  correlationId: string;
  /** Idempotency key to prevent duplicate operations */
  idempotencyKey: string;
  /** Version of the session for optimistic concurrency */
  version: number;
  /** Snapshot of the cart at session creation */
  cartSnapshot: CartSnapshot;
  /** Snapshot of the price at session creation */
  priceSnapshot: PriceSnapshot;
  /** Snapshot of promotions at session creation */
  promotionSnapshot: PromotionSnapshot[];
  /** Snapshot of the offer at session creation */
  offerSnapshot: OfferSnapshot;
  /** Snapshot of merchant info at session creation */
  merchantSnapshot: MerchantSnapshot;
  /** Verification state */
  verificationState: VerificationState;
  /** Approval state */
  approvalState: ApprovalState;
  /** Execution state */
  executionState: ExecutionState;
  /** Failure state if applicable */
  failureState?: FailureState;
}

/**
 * Snapshot of cart data at a point in time.
 */
export interface CartSnapshot {
  /** Items in the cart */
  items: CartItem[];
  /** Quantities of each item */
  quantities: Record<string, number>;
  /** Selected variants */
  selectedVariants: Record<string, Record<string, string>>;
  /** Shipping destination */
  destinationCountry?: string;
  /** Captured at timestamp */
  capturedAt: Date;
}

/**
 * Snapshot of price data at a point in time.
 */
export interface PriceSnapshot {
  /** Base product price */
  productPrice: number | null;
  /** Shipping cost */
  shippingCost: number | null;
  /** Tax amount */
  tax: number | null;
  /** Import duty */
  importDuty: number | null;
  /** Customs fees */
  customsFees: number | null;
  /** Service fees */
  serviceFees: number | null;
  /** Promotion savings actually captured. null when not determined. */
  promotionSavings: number | null;
  /**
   * Total cost as captured. null when at least one required component was
   * unknown: an unknown component must never be summed as 0. Producers are
   * expected to derive this from CostEngine's CostBreakdown, which already
   * propagates UNKNOWN explicitly (see application/cost-engine.ts).
   */
  totalCost: number | null;
  /** Currency */
  currency: string;
  /** Confidence in the price calculation */
  confidence: number;
  /** Source of the price data */
  source: string;
  /** Captured at timestamp */
  capturedAt: Date;
}

/**
 * Snapshot of promotion data at a point in time.
 */
export interface PromotionSnapshot {
  /** Promotion ID */
  promotionId: string;
  /** Promotion code */
  code: string;
  /** Type of promotion */
  type: PromotionType;
  /** Discount value */
  discountValue: number | null;
  /** Discount unit */
  discountUnit: 'percent' | 'euro' | 'shipping' | null;
  /** Conditions */
  conditions: PromotionCondition[];
  /** Savings amount */
  savingsAmount: number;
  /** Savings percent */
  savingsPercent: number;
  /** Verification status */
  verificationStatus: PromotionVerificationStatus;
  /**
   * End of the promotion's validity window AS CAPTURED. Optional on purpose:
   * a producer that did not capture the window leaves it absent, and absent
   * means UNKNOWN — never "expired". VerificationEngine only reports an
   * expiry against the captured window when this field is actually present.
   */
  validUntil?: Date;
  /** Captured at timestamp */
  capturedAt: Date;
}

/**
 * Snapshot of offer data at a point in time.
 */
export interface OfferSnapshot {
  /** Offer ID */
  offerId: string;
  /** Product ID */
  productId: string;
  /** Merchant ID */
  merchantId: string;
  /** Title/name of the offer */
  title: string;
  /** Brand */
  brand: string | null;
  /** Model */
  model: string | null;
  /** Condition */
  condition: string | null;
  /** Seller */
  seller: string | null;
  /** Availability */
  availability: string | null;
  /** Price */
  price: number | null;
  /** Currency */
  currency: string;
  /** Product URL */
  productUrl: string | null;
  /** Execution URL */
  executionUrl: string | null;
  /** Captured at timestamp */
  capturedAt: Date;
}

/**
 * Snapshot of merchant data at a point in time.
 */
export interface MerchantSnapshot {
  /** Merchant ID */
  merchantId: string;
  /** Merchant name */
  name: string;
  /** Merchant country */
  country: string;
  /** Execution capabilities */
  executionCapabilities: ExecutionCapabilityType[];
  /** Captured at timestamp */
  capturedAt: Date;
}

/**
 * Verification state of the checkout session.
 */
export interface VerificationState {
  /** Is the session verified */
  verified: boolean;
  /** Last verification timestamp */
  verifiedAt: Date | null;
  /** Verification discrepancies */
  discrepancies: VerificationDiscrepancy[];
  /** Blocking issues preventing approval */
  blockingIssues: VerificationIssue[];
  /** Warnings (non-blocking) */
  warnings: VerificationIssue[];
  /** Verification version */
  version: number;
}

/**
 * Approval state of the checkout session.
 */
export interface ApprovalState {
  /** Is the session approved */
  approved: boolean;
  /** Approval timestamp */
  approvedAt: Date | null;
  /** Approved by user ID */
  approvedBy: string | null;
  /** Approval version */
  version: number;
  /** Approved total amount */
  approvedTotal: number;
  /** Approved currency */
  approvedCurrency: string;
  /** Expires at timestamp */
  expiresAt: Date | null;
}

/**
 * Execution state of the checkout session.
 */
export interface ExecutionState {
  /** Has execution started */
  started: boolean;
  /** Execution start timestamp */
  startedAt: Date | null;
  /** Execution completion timestamp */
  completedAt: Date | null;
  /** Execution result */
  result: 'success' | 'failure' | null;
  /** Execution error */
  error?: string;
  /** Merchant confirmation */
  merchantConfirmed: boolean;
  /** Merchant confirmation timestamp */
  merchantConfirmedAt: Date | null;
}

/**
 * Failure state details.
 */
export interface FailureState {
  /** Failure timestamp */
  timestamp: Date;
  /** Failure type */
  type: 'price_changed' | 'cart_changed' | 'offer_unavailable' | 'execution_failed' | 'expired' | 'cancelled' | 'verification_failed' | 'approval_expired' | 'approval_invalidated';
  /** Failure message */
  message: string;
  /** Failure details */
  details?: Record<string, unknown>;
}

/**
 * Verification discrepancy type.
 */
export interface VerificationDiscrepancy {
  /** Type of discrepancy */
  type: 'price' | 'cart' | 'offer' | 'promotion' | 'shipping' | 'tax' | 'fee' | 'availability' | 'url' | 'merchant';
  /** Description */
  description: string;
  /** Severity */
  severity: 'warning' | 'blocking';
  /** Expected value */
  expected: unknown;
  /** Actual value */
  actual: unknown;
}

/**
 * Verification issue (warning or blocking).
 */
export interface VerificationIssue {
  /** Type of issue */
  type: 'price_changed' | 'cart_changed' | 'offer_changed' | 'promotion_changed' | 'shipping_changed' | 'tax_changed' | 'fee_changed' | 'availability_changed' | 'url_changed' | 'merchant_changed' | 'expired' | 'execution_failed' | 'not_verified';
  /** Description */
  description: string;
  /** Detected at timestamp */
  detectedAt: Date;
}

/**
 * Purchase approval record.
 */
export interface PurchaseApproval {
  /** Unique approval identifier */
  id: string;
  /** Associated checkout session ID */
  sessionId: string;
  /** Requested at timestamp */
  requestedAt: Date;
  /** Approved at timestamp */
  approvedAt: Date | null;
  /** Approved by user ID */
  approvedBy: string | null;
  /** Approval scope */
  scope: 'full' | 'price_only' | 'cart_only';
  /** Approved price amount */
  approvedAmount: number;
  /** Approved currency */
  approvedCurrency: string;
  /** Approval version */
  version: number;
  /** Expires at timestamp */
  expiresAt: Date | null;
  /** Status */
  status: 'pending' | 'approved' | 'expired' | 'invalidated' | 'cancelled';
  /** Correlation ID */
  correlationId: string;
  /** Idempotency key */
  idempotencyKey: string;
}

/**
 * Request to purchase an offer.
 */
export interface PurchaseRequest {
  /** The offer to purchase */
  offer: Offer;
  /** Quantity of the offer */
  quantity: number;
  /** User-selected variants (e.g., size, color) */
  selectedVariants: Record<string, string>;
  /** User information for pre-fill (optional) */
  userInfo?: UserInfo;
  /** Promotion to apply (optional) */
  appliedPromo?: PromotionApplication;
  /** Flag indicating if this is a retry attempt */
  isRetry?: boolean;
}

/**
 * Result of a purchase attempt.
 */
export interface PurchaseResult {
  /** Status of the purchase attempt */
  status: string;
  /** Prepared cart (if status is 'cart_prepared') */
  cart?: Cart;
  /** URL to complete the purchase (if applicable) */
  checkoutUrl?: string;
  /** Next action for the user */
  nextAction: string;
  /** Audit entry for this attempt */
  auditEntry: AuditEntry;
  /** Flag indicating if this is a retry attempt */
  isRetry?: boolean;
}

/**
 * Interface for purchase execution handlers.
 */
export interface PurchaseExecutionHandler {
  /** The execution capability this handler supports */
  capability: ExecutionCapabilityType;
  /**
   * Check if this handler can handle the given merchant
   * @param merchant The merchant to check
   * @returns true if the handler can handle the merchant
   */
  canHandle(merchant: Merchant): boolean;
  /**
   * Prepare a purchase for the given request
   * @param request The purchase request
   * @returns A promise that resolves to the purchase result
   */
  preparePurchase(request: PurchaseRequest): Promise<PurchaseResult>;
  /**
   * Handle a webhook from the merchant
   * @param merchantId The merchant ID
   * @param payload The webhook payload
   * @returns A promise that resolves to true if the webhook was processed successfully
   */
  handleWebhook(merchantId: string, payload: Record<string, unknown>): Promise<boolean>;
}