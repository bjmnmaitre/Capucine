/**
 * Capucine Application Layer — Ranking Results & Explanation
 *
 * Models the results produced by the Priority Engine and how to explain them.
 *
 * Key principle: Explanation is derived from the deterministic result,
 * not invented afterward.
 */

import {
  RankedOffer,
  CriterionScore,
  Offer,
  PreferenceLevel,
  DataStatus,
  PreferenceCriterion,
} from '../domain/types';
import { Source, Evidence, ConflictSummary } from './provenance';

// ============================================================================
// CONFIDENCE & QUALITY METRICS
// ============================================================================

/**
 * Confidence metrics for a result.
 */
export interface ConfidenceMetrics {
  overall: number; // 0-1, overall confidence in this ranking
  dataCompleteness: number; // 0-1, how complete is the data?
  dataQuality: number; // 0-1, quality of data used
  scoreReliability: number; // 0-1, how reliable is the score?
  sourceReliability: number; // 0-1, reliability of sources
  reasoning: string; // Why this confidence level?
}

// ============================================================================
// RANKING RESULT WRAPPER
// ============================================================================

/**
 * A ranked result for presentation.
 * Extends the core RankedOffer with metadata for UI/explanation.
 */
export interface PresentableRankedOffer {
  // Core ranking data
  rankedOffer: RankedOffer;
  rank: number; // 1st, 2nd, 3rd, etc.

  // Explanation
  explanation: RankingExplanation;

  // Context for presentation
  confidence: ConfidenceMetrics;
  uncertaintyFlags: UncertaintyFlag[];
  alternatives: AlternativeResult[];

  // For UI rendering
  highlights: {
    strengths: string[]; // Why this offer is good
    weaknesses: string[]; // What could be better
    risks?: string[]; // Unknown data that might change ranking
  };

  // Metadata
  generatedAt: Date;
  version: string; // Ranking engine version
}

/**
 * All results from a ranking operation.
 */
export interface RankingResultSet {
  requestId: string;
  userId: string;

  // Ranked offers
  rankedOffers: PresentableRankedOffer[];
  rejectedOffers: RejectedOfferWithExplanation[];

  // Summary
  summary: ResultSetSummary;
  recommendations: Recommendation[];

  // Data quality
  dataQualityIssues: DataQualityNotice[];
  conflicts: ConflictSummary;

  // Metadata
  generatedAt: Date;
  processingTimeMs: number;
  engineVersion: string;
  requestedCriteria: number; // How many criteria were used?
  applicableCriteria: number; // How many were actually applicable?
}

// ============================================================================
// EXPLANATIONS
// ============================================================================

/**
 * Human-readable explanation for why an offer ranked where it did.
 */
export interface RankingExplanation {
  offerId: string;
  rankNumber: number;

  // Overall summary
  summary: string; // "This offer ranked #2 because it meets your budget and preferred brand, though shipping is slower."

  // Per-criterion breakdown
  criterionExplanations: CriterionExplanation[];

  // Why it won/lost vs competitors
  vsTopRanked?: ComparisonExplanation; // Why not #1?
  vsAlternatives?: ComparisonExplanation[]; // Why beat these others?

  // What would improve this?
  improvementPotentials: {
    criterion: string;
    currentValue: unknown;
    hypotheticalValue: unknown;
    projectedRankIfImproved?: number;
  }[];

  // Things that could change the ranking
  sensitivityFactors: {
    criterion: string;
    currentScore: number;
    scoreChangeThreshold: number; // How much would score need to change to affect rank?
  }[];

  // Natural language (can be elaborated by AI)
  naturalLanguageExplanation?: string;
  naturalLanguageTone?: 'technical' | 'conversational' | 'concise';
}

/**
 * Explanation for one criterion's score.
 */
export interface CriterionExplanation {
  criterion: PreferenceCriterion;
  score: CriterionScore;

  // Why this score?
  reasoning: string;

  // What data was used?
  dataUsed: {
    value?: unknown;
    status: DataStatus;
    source?: Source;
    evidence?: Evidence[];
    confidence: number; // 0-1
  };

  // Comparison to expectation
  metExpectation: boolean; // Did this meet the user's preference?
  expectationGap?: number; // How far from ideal? (negative = worse, positive = better)

  // For preferences: how much did this contribute to overall score?
  contributionToRanking: number; // Percentage of final score

  // Alternatives (if criterion could have different values)
  alternativeValues?: {
    value: unknown;
    projectedScore?: number;
    why_not_this?: string;
  }[];
}

/**
 * Explanation of why one offer ranked better than another.
 */
export interface ComparisonExplanation {
  otherOfferId: string;
  otherOfferName: string;
  thisOfferWonBecause: string; // e.g., "Lower price and faster shipping"
  othersAdvantage?: string; // What did the other offer have?
  scoreDifference: number; // Points difference
  scoreDifferencePercent: number; // Percentage difference
}

// ============================================================================
// UNCERTAINTY & RISK FLAGS
// ============================================================================

/**
 * Flags indicating uncertainty that might affect ranking.
 */
export interface UncertaintyFlag {
  flag: UncertaintyFlagType;
  criterion?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';

  // What's uncertain?
  description: string;

  // Why does this matter?
  affectsRanking: boolean;
  affectsRecommendation?: boolean;

  // What could change?
  ifResolvedWould: string; // e.g., "might move to rank #1"

  // Can we do something about it?
  suggestedAction?: string; // e.g., "Contact merchant for shipping time"
}

export type UncertaintyFlagType =
  | 'unknown_data' // Data point is unknown
  | 'contradictory_data' // Multiple sources conflict
  | 'unverified_data' // Data exists but can't be verified
  | 'stale_data' // Data is old
  | 'low_confidence' // Source has low reliability
  | 'limited_sources' // Only one source for this data
  | 'data_quality_issue' // Something seems wrong with the data
  | 'ties_with_another' // Another offer has identical score
  | 'criteria_not_applicable' // Criterion doesn't apply to this product
  | 'conflicting_criteria' // This criterion conflicts with another;

/**
 * A data quality notice.
 */
export interface DataQualityNotice {
  type: 'issue' | 'warning' | 'info';
  fieldName?: string;
  message: string;
  affectsRanking: boolean;
  source?: Source;
}

// ============================================================================
// ALTERNATIVES & RECOMMENDATIONS
// ============================================================================

/**
 * Alternative offer that didn't rank as high, but might be worth considering.
 */
export interface AlternativeResult {
  offer: RankedOffer;
  alternativeRank: number;

  // Why might user consider this?
  reasons: {
    reason: string; // "Significantly cheaper"
    criterion: string;
    priorityToUser?: PreferenceLevel;
  }[];

  // Trade-offs
  tradeOffs: {
    advantage: string; // "20% cheaper"
    disadvantage: string; // "Slower shipping"
  }[];

  // When might this become top choice?
  when: string; // e.g., "If you're willing to wait for shipping"
}

/**
 * A recommendation to the user.
 */
export interface Recommendation {
  type: RecommendationType;
  priority: 'critical' | 'high' | 'medium' | 'low';

  // What's the recommendation?
  title: string;
  description: string;

  // What to do about it?
  suggestedAction?: string;

  // Affects which offers?
  affectsOffers?: string[];

  // Based on what?
  reasoning: string;
}

export type RecommendationType =
  | 'ask_clarification' // Need more info from user
  | 'check_alternative' // Consider this other option
  | 'verify_data' // Verify something before purchasing
  | 'timing' // Wait or buy now?
  | 'budget_advice' // Budget-related suggestion
  | 'category_advice' // Product category advice
  | 'source_advice' // Merchant/source advice
  | 'other';

// ============================================================================
// RESULT SUMMARY & STATISTICS
// ============================================================================

/**
 * High-level summary of the ranking results.
 */
export interface ResultSetSummary {
  // Counts
  totalOffersEvaluated: number;
  offersRanked: number;
  offersRejected: number;

  // Score distribution
  topScore: number;
  bottomScore: number;
  averageScore: number;
  scoreDistribution: {
    range: string; // e.g., "90-100"
    count: number;
  }[];

  // Criteria coverage
  criteriaApplied: number;
  criteriaWithCompleteData: number;
  criteriaWithUnknownData: number;
  criteriaWithConflicts: number;

  // Data quality
  overallDataQuality: 'excellent' | 'good' | 'fair' | 'poor';
  dataCompletenessPercent: number; // 0-100

  // Consistency
  isConsistent: boolean; // No apparent ranking anomalies?
  anomalyCount: number;

  // Recommendation
  canRankReliably: boolean;
  recommendationReason?: string;
}

// ============================================================================
// REJECTED OFFERS
// ============================================================================

/**
 * An offer that was rejected (didn't meet hard constraints).
 */
export interface RejectedOfferWithExplanation {
  offer: Offer;

  // Why was it rejected?
  violatedConstraints: {
    criterion: PreferenceCriterion;
    reason: string; // "Price €750 exceeds budget of €600"
  }[];

  // Could it have ranked?
  ifConstraintWaive: {
    constraintId: string;
    projectedRank?: number; // Where would it rank if we removed this constraint?
  }[];

  // Is there a similar offer that passed?
  similar_passing_offer?: {
    offerId: string;
    merchantName: string;
    keyDifference: string; // "€100 cheaper"
  };
}

// ============================================================================
// RESULT VERSIONING & REPRODUCIBILITY
// ============================================================================

/**
 * Metadata for result reproducibility.
 */
export interface ResultReproducibility {
  resultId: string;
  timestamp: Date;

  // What engine produced this?
  engineVersion: string;
  engineBuild?: string;
  engineChecksum?: string; // Hash of engine code

  // What input produced this?
  inputChecksum: string; // Hash of ranking request
  profileVersion?: string; // User profile version
  profileChecksum?: string;

  // Data versions
  dataSourceVersions: {
    source: string;
    version: string;
    timestamp: Date;
  }[];

  // Can we reproduce?
  isReproducible: boolean;
  failureToReproduceReason?: string;

  // For debugging
  debugInfo?: {
    randomSeed?: number; // If any randomness was used
    environmentVariables?: Record<string, string>;
  };
}

/**
 * Temporal metadata for results.
 */
export interface ResultTemporal {
  requestedAt: Date;
  processingStartedAt: Date;
  rankingCompletedAt: Date;
  explainationGeneratedAt: Date;
  presentedAt?: Date;

  // How long each stage took
  stageDurations: {
    stage: string;
    durationMs: number;
  }[];

  // Data freshness
  dataFreshnessScore: number; // 0-1, how fresh is data?
  oldestDataPoint?: Date;
  newestDataPoint?: Date;
}

// ============================================================================
// RANKING RESULT ANALYTICS
// ============================================================================

/**
 * Analytics/telemetry for a ranking result.
 * For monitoring and improvement.
 */
export interface ResultAnalytics {
  resultId: string;

  // User behavior
  userOpenedResult: boolean;
  userHoveredOffers: string[]; // Which offers did they look at?
  userClickedOn: string[]; // Which did they click?
  userPurchased?: string; // Which did they buy?

  // Result quality feedback
  userSatisfaction?: 'very_satisfied' | 'satisfied' | 'neutral' | 'dissatisfied' | 'very_dissatisfied';
  userFeedback?: string;

  // Did ranking prove accurate?
  actualPurchaseRank?: number; // What rank was the purchased offer?
  rankingAccuracy?: boolean; // Did top-ranked offer sell?

  // Time metrics
  timeToDecision?: number; // How long to decide?
  timeToInitialInterest?: number; // Time to first click?

  // Follow-up queries
  userRefinedSearch: boolean;
  refinementCriteria?: string[];
}
