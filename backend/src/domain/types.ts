/**
 * Capucine Domain Types
 *
 * Core data structures representing the shopping agent's domain.
 * These types implement the 20 architectural invariants of Capucine.
 */

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

  // The actual score for this criterion (0-100 or similar)
  score: number;

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
export interface RankedOffer {
  offer: Offer;

  // Overall ranking score (0-100 or similar scale)
  overallScore: number;

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

  // Overall confidence in interpretation
  confidence: number; // 0-1

  // If confidence is low, what's the reason?
  lowConfidenceReasons?: string[];

  // Metadata
  queryText: string;
  generatedAt: Date;
}
