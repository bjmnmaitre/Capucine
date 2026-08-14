/**
 * Capucine Application Layer — Normalization & Data Cleaning
 *
 * Models the transformation of messy, heterogeneous data from discovery
 * into clean, consistent data ready for the Priority Engine.
 *
 * Key principle: Normalization is technical, not interpretative.
 * Never invent missing values.
 * Always preserve provenance.
 */

import { DataPoint, DataStatus, DataProvenance, PreferenceCriterion } from '../domain/types';
import { Source, Evidence, DataConflict, DataTransformation } from './provenance';

// ============================================================================
// NORMALIZATION PIPELINE
// ============================================================================

/**
 * A single normalization rule.
 * Transforms one piece of data from raw to normalized form.
 */
export interface NormalizationRule {
  id: string;
  name: string;
  description?: string;

  // What this rule matches
  fieldName: string; // e.g., "price", "warranty"
  inputPattern?: RegExp;

  // How to transform it
  transformation: NormalizationTransform;

  // When to apply it
  applicableTo?: {
    category?: string[];
    sourceType?: string[];
    country?: string[];
  };

  // Confidence
  confidence: number; // 0-1, how confident is this transformation?
  reverseTransform?: (value: unknown) => unknown; // Can we undo this?
}

/**
 * A single transformation operation.
 */
export type NormalizationTransform =
  | { type: 'parse_number'; decimalPlaces?: number; currency?: string }
  | { type: 'parse_boolean'; trueValues?: string[]; falseValues?: string[] }
  | { type: 'parse_date'; formats?: string[] }
  | { type: 'parse_duration'; format?: 'iso8601' | 'human' }
  | { type: 'parse_price'; sourceCurrency?: string; targetCurrency?: string }
  | { type: 'normalize_string'; toLowerCase?: boolean; trim?: boolean }
  | { type: 'normalize_category'; categoryMap?: Record<string, string> }
  | { type: 'normalize_country'; format?: 'iso2' | 'iso3' | 'name' }
  | { type: 'normalize_language'; format?: 'iso639_1' | 'iso639_2' }
  | { type: 'trim_whitespace' }
  | { type: 'remove_duplicates' }
  | { type: 'regex_extract'; pattern: string; groupIndex?: number }
  | { type: 'custom'; handler: (value: unknown) => unknown };

// ============================================================================
// NORMALIZED DATA STRUCTURES
// ============================================================================

/**
 * Normalized product data.
 * Clean, consistent, ready for ranking.
 */
export interface NormalizedProduct {
  id: string;
  originalProductId?: string; // Reference to original if deduped

  // Product identification (normalized)
  category: string; // ISO category or unified taxonomy
  name: string; // Normalized name
  description?: string;

  // Specifications (normalized DataPoints)
  specifications: Record<string, DataPoint<NormalizedValue>>;

  // Metadata
  createdAt: Date;
  normalizedAt: Date;
  source?: Source;
  confidence: number; // 0-1, overall confidence in this product
}

/**
 * Normalized offer data.
 * Clean, consistent, ready for ranking.
 */
export interface NormalizedOffer {
  id: string;
  originalOfferId?: string;

  productId: string;
  merchantId: string;
  merchantName: string;

  // Financial terms (normalized)
  price: DataPoint<NormalizedPrice>;
  shippingCost: DataPoint<NormalizedPrice>;
  shippingTime: DataPoint<NormalizedDuration>;

  // Offer characteristics (normalized)
  characteristics: Record<string, DataPoint<NormalizedValue>>;

  // Normalized availability
  availability: {
    inStock: DataPoint<boolean>;
    quantity?: DataPoint<number>;
    estimatedDeliveryDate?: DataPoint<string>;
  };

  // Execution information
  executionCapability?: string;
  executionUrl?: string;

  // Metadata
  createdAt: Date;
  retrievedAt: Date;
  normalizedAt: Date;
  source: Source;
  confidence: number; // 0-1
}

/**
 * A normalized value with type information.
 */
export type NormalizedValue =
  | NormalizedPrice
  | NormalizedDuration
  | NormalizedCategory
  | NormalizedBoolean
  | NormalizedString
  | NormalizedNumber
  | NormalizedDate;

/**
 * Normalized price.
 */
export interface NormalizedPrice {
  type: 'price';
  amount: number;
  currency: string; // ISO 4217
  originalValue?: unknown; // Preserve original for audit
  normalized: boolean;
}

/**
 * Normalized duration.
 */
export interface NormalizedDuration {
  type: 'duration';
  value: string; // ISO 8601 duration (e.g., "P1D" for 1 day)
  humanReadable?: string; // "1 day"
  originalValue?: unknown;
  normalized: boolean;
}

/**
 * Normalized category/enum value.
 */
export interface NormalizedCategory {
  type: 'category';
  value: string; // Unified taxonomy
  originalValue?: unknown;
  confidence: number; // 0-1, how sure is the mapping?
  normalized: boolean;
}

/**
 * Normalized boolean.
 */
export interface NormalizedBoolean {
  type: 'boolean';
  value: boolean;
  originalValue?: unknown;
  normalized: boolean;
}

/**
 * Normalized string.
 */
export interface NormalizedString {
  type: 'string';
  value: string;
  language?: string; // ISO 639-1 code
  originalValue?: unknown;
  normalized: boolean;
}

/**
 * Normalized number.
 */
export interface NormalizedNumber {
  type: 'number';
  value: number;
  unit?: string; // e.g., "kg", "mm", "hours"
  originalValue?: unknown;
  normalized: boolean;
}

/**
 * Normalized date.
 */
export interface NormalizedDate {
  type: 'date';
  value: Date;
  precision: 'day' | 'hour' | 'minute'; // How precise?
  originalValue?: unknown;
  normalized: boolean;
}

// ============================================================================
// NORMALIZATION RESULTS
// ============================================================================

/**
 * Result of normalizing a single data point.
 */
export interface NormalizationResult<T> {
  success: boolean;

  // The normalized value (if successful)
  normalizedValue?: DataPoint<T>;

  // What happened?
  status: 'success' | 'partial' | 'failed';
  error?: NormalizationError;

  // What was the input?
  originalValue: unknown;
  originalType: string;

  // Trace the normalization
  appliedRules: NormalizationRule[];
  transformations: DataTransformation[];

  // Confidence in result
  confidence: number; // 0-1

  // Alternatives (if multiple interpretations possible)
  alternativeInterpretations?: {
    value: unknown;
    confidence: number;
    reasoning: string;
  }[];

  // Time taken
  processingTime: number; // ms
}

/**
 * Normalization error.
 */
export interface NormalizationError {
  code:
    | 'unparseable'
    | 'out_of_range'
    | 'conflicting_values'
    | 'missing_unit'
    | 'invalid_format'
    | 'unknown_language'
    | 'currency_conversion_failed'
    | 'other';
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Results of normalizing a complete product/offer.
 */
export interface BatchNormalizationResult {
  id: string;
  timestamp: Date;

  // Successes
  successfullyNormalized: {
    product?: NormalizedProduct;
    offers: NormalizedOffer[];
  };

  // Partial successes
  partiallySerialized: {
    product?: {
      entity: NormalizedProduct;
      failedFields: string[];
    };
    offers: {
      entity: NormalizedOffer;
      failedFields: string[];
    }[];
  };

  // Failures
  failedItems: {
    identifier: string;
    reason: string;
    originalData: unknown;
  }[];

  // Statistics
  statistics: {
    inputCount: number;
    successCount: number;
    partialCount: number;
    failureCount: number;
    averageConfidence: number;
    totalProcessingTime: number; // ms
  };

  // Issues found
  warnings: string[];
  dataQualityIssues: DataQualityIssue[];
}

/**
 * A data quality issue found during normalization.
 */
export interface DataQualityIssue {
  fieldName: string;
  issueType:
    | 'missing_data'
    | 'inconsistent_data'
    | 'implausible_value'
    | 'conflicting_sources'
    | 'stale_data'
    | 'low_confidence';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affectsRanking: boolean;
  suggestion?: string;
}

// ============================================================================
// NORMALIZATION CONFIGURATION
// ============================================================================

/**
 * Configuration for the normalization pipeline.
 */
export interface NormalizationConfig {
  // Rules to apply
  rules: NormalizationRule[];

  // Strictness
  strictMode: boolean; // Fail on any error? Or be lenient?

  // Multi-currency
  currencyHandling: {
    defaultCurrency?: string;
    supportedCurrencies?: string[];
    conversionRequired?: boolean;
    targetCurrency?: string;
  };

  // Language handling
  languageHandling: {
    defaultLanguage?: string;
    supportedLanguages?: string[];
    requireLanguageTag?: boolean;
  };

  // Category mapping
  categoryMapping?: {
    sourceFormat: string;
    targetFormat: string;
    mappingRules: Record<string, string>;
  };

  // Custom handlers
  customHandlers?: Record<string, (value: unknown) => unknown>;

  // What to do with unknown data?
  unknownDataHandling: 'preserve' | 'flag' | 'reject';

  // Conflict resolution
  conflictResolution: 'preserve' | 'first_source' | 'latest' | 'most_authoritative';
}

/**
 * A field normalization strategy.
 */
export interface FieldNormalizationStrategy {
  fieldName: string;
  expectedType: string;
  rules: NormalizationRule[];
  required: boolean;
  fallbackValue?: unknown;
  allowMultipleValues: boolean; // Can field have array?
}

// ============================================================================
// NORMALIZATION AUDIT
// ============================================================================

/**
 * Complete audit trail for data normalization.
 */
export interface NormalizationAuditTrail {
  id: string;
  timestamp: Date;

  // What was normalized?
  inputData: unknown;
  outputData: unknown;

  // How?
  rulesApplied: NormalizationRule[];
  transformationsApplied: DataTransformation[];

  // Result
  success: boolean;
  errors?: NormalizationError[];
  warnings?: string[];

  // Performance
  processingTimeMs: number;
  rulesEvaluatedCount: number;

  // Confidence
  finalConfidence: number; // 0-1

  // Reversibility
  reversible: boolean; // Can we undo this normalization?
}

// ============================================================================
// DEDUPLICATION MARKERS
// ============================================================================

/**
 * When we identify duplicate products, we mark them for deduplication.
 */
export interface DeduplicationMarker {
  id: string;
  originalProductId: string;
  duplicateProductIds: string[];
  duplicateOffers: string[];

  // Why are they duplicates?
  deduplicationReason:
    | 'identical_specifications'
    | 'same_ean_isbn_sku'
    | 'same_model_different_source'
    | 'manual_merge';

  // Merge strategy
  keepProductId: string;
  keepOfferIds: string[];

  // Audit
  timestamp: Date;
  appliedBy?: string; // Which system made this decision?
  confidence: number; // 0-1
}
