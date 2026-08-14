/**
 * Capucine Application Layer — Request & Query Types
 *
 * Models user requests, query interpretation, and structured criteria extraction.
 * This layer bridges user input to the domain model.
 *
 * Key concepts:
 * - UserQuery: raw user input (text or structured)
 * - InterpretedRequest: AI-structured interpretation
 * - QueryAmbiguity: what needs clarification
 * - ClarificationNeeded: prompt for user to disambiguate
 */

import { PreferenceCriterion, PreferenceLevel } from '../domain/types';

// ============================================================================
// USER QUERY (INPUT)
// ============================================================================

/**
 * User query — raw input.
 * Can be text, structured parameters, or mixed.
 */
export interface UserQuery {
  id: string;
  userId: string;

  // What the user said/entered
  text?: string; // "I want a laptop under €1000 with good battery life"

  // Structured input if available
  structured?: {
    keywords?: string[];
    category?: string;
    budget?: { min?: number; max?: number; currency?: string };
    location?: string;
    language?: string;
  };

  // Context
  timestamp: Date;
  sessionId?: string; // For multi-turn conversations
  previousQueryId?: string; // If this is a refinement
}

// ============================================================================
// INTERPRETED REQUEST (STRUCTURED EXTRACTION)
// ============================================================================

/**
 * Represents the AI's interpretation of what the user wants.
 * This is structured but may still have ambiguities.
 *
 * CRITICAL: This is interpretation only, not decision.
 */
export interface InterpretedRequest {
  id: string;
  queryId: string;
  userId: string;

  // What was extracted
  extractedCriteria: PreferenceCriterion[];

  // Numeric constraints extracted (if any)
  budget?: {
    minimum?: number;
    maximum?: number;
    currency?: string;
    flexible?: boolean; // User indicated willingness to exceed budget
    flexibilityPercent?: number; // If flexible, how much room?
  };

  // Location/delivery preferences
  shippingPreferences?: {
    country?: string;
    preferDomestic?: boolean;
    maxShippingCost?: number;
    maxShippingTime?: string; // ISO 8601 duration
  };

  // Product category
  category?: string;

  // State of interpretation
  ambiguities: QueryAmbiguity[];
  confidence: number; // 0-1, how confident is interpretation?
  lowConfidenceReasons?: string[];

  // Clarifications received
  clarificationsReceived: ClarificationAnswer[];

  // Detected exceptions to user's profile
  detectedProfileExceptions: {
    criterionId: string;
    proposedLevel: PreferenceLevel;
    reason: string;
  }[];

  /**
   * Suggested search terms extracted from the query.
   * Includes brand names, model numbers, product descriptors.
   * Used by SearchPlanBuilder as primaryTerms.
   *
   * Examples:
   *   "je cherche un Sony WH-1000XM5" → ['sony', 'wh-1000xm5']
   *   "MacBook Pro 14 pouces M3" → ['macbook', 'pro', '14', 'm3']
   *   "aspirateur robot Roborock S8" → ['roborock', 's8', 'aspirateur', 'robot']
   */
  suggestedSearchTerms?: string[];

  // Metadata
  createdAt: Date;
  interpretedAt: Date;
  modelUsed?: string; // Which AI model interpreted this?
  modelVersion?: string;
}

// ============================================================================
// AMBIGUITIES & CLARIFICATIONS
// ============================================================================

/**
 * An ambiguity detected during interpretation.
 * Represents something the AI couldn't decide on its own.
 */
export interface QueryAmbiguity {
  id: string;
  ambiguityType: AmbiguityType;
  criterion?: string; // Which criterion is ambiguous?

  // What's unclear?
  description: string;

  // Possible interpretations
  possibleInterpretations: AmbiguityOption[];

  // AI's recommendation (if any)
  recommendedInterpretation?: string;

  // Status
  resolved: boolean;
  resolvedAt?: Date;
  resolution?: string;
}

export type AmbiguityType =
  | 'criterion_weight' // "important" vs "very important"?
  | 'criterion_value' // User said "reliable" — how reliable?
  | 'budget_flexibility' // "around €1000" — how much flex?
  | 'preference_priority' // "good battery AND lightweight" — which matters more?
  | 'time_constraint' // "soon" — how soon exactly?
  | 'location_scope' // "available nearby" — how far is nearby?
  | 'category_precision' // "laptop" — any specific type?
  | 'profile_exception' // User asked for something different from their profile?
  | 'other';

/**
 * One possible interpretation of an ambiguous criterion.
 */
export interface AmbiguityOption {
  interpretation: string; // e.g., "battery ≥ 12 hours"
  explanation: string; // Why this interpretation?
  likelihood?: number; // 0-1, how likely is this what user meant?
}

/**
 * Answer to a clarification question.
 */
export interface ClarificationAnswer {
  ambiguityId: string;
  selectedInterpretation: string;
  userAnswer: string; // What the user said
  timestamp: Date;
}

/**
 * A clarification question to ask the user.
 */
export interface ClarificationNeeded {
  ambiguityId: string;
  question: string; // "You mentioned 'lightweight' — does this mean under 1.5 kg?"
  options?: string[]; // Multiple choice (if applicable)
  answerType: 'text' | 'number' | 'choice' | 'yes_no';
  priority: 'critical' | 'high' | 'medium' | 'low'; // Does this block ranking?
}

// ============================================================================
// MERGED INTERPRETED REQUEST
// ============================================================================

/**
 * Fully resolved interpretation ready for ranking.
 * All ambiguities have been addressed (or accepted as-is).
 */
export interface ResolvedInterpretedRequest {
  id: string;
  originalQueryId: string;
  interpretedRequestId: string;
  userId: string;

  // Final criteria (no more ambiguities)
  finalCriteria: PreferenceCriterion[];

  // Final budget
  finalBudget?: {
    maximum: number;
    currency: string;
    flexible?: boolean;
    flexibilityPercent?: number;
  };

  // Final shipping preferences
  finalShippingPreferences?: {
    country?: string;
    maxShippingCost?: number;
    maxShippingTime?: string;
  };

  // Category
  category?: string;

  // Clarifications applied
  clarificationsApplied: ClarificationAnswer[];

  // Profile exceptions to apply
  profileExceptions: {
    criterionId: string;
    temporaryLevel: PreferenceLevel;
    reason: string;
  }[];

  // This is ready for the Priority Engine
  readyForRanking: boolean;
  readinessCheckTime: Date;

  // Metadata
  createdAt: Date;
  finalizedAt: Date;
}

// ============================================================================
// QUERY ANALYSIS & METADATA
// ============================================================================

/**
 * Analysis of a query for debugging/monitoring.
 */
export interface QueryAnalysis {
  queryId: string;
  analysisTime: Date;

  // Linguistic properties
  queryLength: number; // character count
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  detectedLanguage?: string; // ISO 639-1 code

  // Time properties
  isTimeConstrained: boolean; // User mentioned urgency?
  suggestedTimeWindow?: string; // ISO 8601 duration

  // Category detection
  detectedCategories: {
    category: string;
    confidence: number; // 0-1
  }[];

  // Ambiguity summary
  ambiguityCount: number;
  averageAmbiguityConfidence: number;

  // Overall assessment
  isRankable: boolean; // Can we rank without more info?
  needsClarification: boolean;
  estimatedClarificationQuestions: number;
}

// ============================================================================
// REQUEST LIFECYCLE
// ============================================================================

/**
 * A complete request lifecycle from raw query to ranking.
 * Tracks all transformations.
 */
export interface RequestLifecycle {
  requestId: string;
  userId: string;

  // Stage 1: Input
  userQuery: UserQuery;

  // Stage 2: Interpretation
  interpretationAttempts: InterpretedRequest[];
  currentInterpretation: InterpretedRequest;

  // Stage 3: Clarification
  clarificationsAsked: ClarificationNeeded[];
  clarificationsAnswered: ClarificationAnswer[];

  // Stage 4: Resolution
  resolvedInterpretation?: ResolvedInterpretedRequest;

  // Metadata
  createdAt: Date;
  lastModifiedAt: Date;
  status: 'input_received' | 'interpreting' | 'awaiting_clarification' | 'resolved' | 'failed';
  failureReason?: string;

  // Audit trail
  events: RequestLifecycleEvent[];
}

/**
 * Event in a request's lifecycle.
 */
export interface RequestLifecycleEvent {
  timestamp: Date;
  eventType:
    | 'query_received'
    | 'interpretation_started'
    | 'interpretation_completed'
    | 'ambiguity_detected'
    | 'clarification_asked'
    | 'clarification_answered'
    | 'resolution_completed'
    | 'resolution_failed';
  details: Record<string, unknown>;
}

// ============================================================================
// CONSTRAINTS & VALIDATION
// ============================================================================

/**
 * Validation result for a user query.
 */
export interface QueryValidationResult {
  queryId: string;
  isValid: boolean;
  errors: QueryValidationError[];
  warnings: QueryValidationWarning[];
  timeToValidate: number; // ms
}

/**
 * A validation error preventing ranking.
 */
export interface QueryValidationError {
  code: string;
  message: string;
  fieldAffected?: string;
}

/**
 * A validation warning (non-blocking).
 */
export interface QueryValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}
