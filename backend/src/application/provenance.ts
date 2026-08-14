/**
 * Capucine Application Layer — Provenance & Source Tracking
 *
 * Models data sources, evidence, and the provenance system.
 * Enables traceability: "Why does Capucine affirm this?"
 *
 * Key principle: Every data value should be linkable to its origin.
 */

// ============================================================================
// SOURCE TYPES
// ============================================================================

/**
 * Categories of data sources.
 */
export type SourceType =
  | 'merchant_official' // Merchant's official product page / API
  | 'marketplace' // Amazon, Fnac, eBay, etc.
  | 'comparison_site' // Price comparison sites
  | 'review_site' // Reviews and ratings (Trustpilot, etc.)
  | 'manufacturer' // Manufacturer's official specifications
  | 'user_input' // Entered directly by the user
  | 'web_scrape' // Scraped from web
  | 'api_integration' // Direct API call
  | 'database_cached' // Previously cached data
  | 'estimate' // Calculated/estimated value
  | 'other';

/**
 * Verification level of a source.
 */
export type SourceVerification =
  | 'trusted' // Officially trusted (e.g., manufacturer)
  | 'verified' // Independently verified
  | 'authoritative' // Known authority in domain
  | 'credible' // Generally credible (e.g., major retailer)
  | 'unverified' // Not yet verified
  | 'suspicious' // Known to be unreliable or spam
  | 'contradicted' // This source conflicts with others;

/**
 * A data source.
 * Represents WHERE information comes from.
 */
export interface Source {
  id: string;
  name: string; // "Sony Official Store", "Amazon.fr", "Tom's Hardware"
  type: SourceType;

  // How trustworthy is this source?
  verification: SourceVerification;
  reliabilityScore?: number; // 0-1 (future use: may inform weighting)

  // Contact/access information
  url?: string; // Source URL
  country?: string; // Where is this source based?
  language?: string; // ISO 639-1 code

  // Source capabilities
  canProvide: {
    productInfo?: boolean;
    pricing?: boolean;
    availability?: boolean;
    shipping?: boolean;
    reviews?: boolean;
    specifications?: boolean;
  };

  // Rate limiting / access
  rateLimit?: {
    requestsPerHour?: number;
    lastAccessTime?: Date;
  };

  // Metadata
  createdAt: Date;
  lastUsedAt?: Date;
  isActive: boolean;
}

/**
 * Connection to a merchant for data retrieval.
 */
export interface MerchantSource extends Source {
  type: 'merchant_official' | 'marketplace';
  merchantId?: string; // Reference to merchant
  apiAvailable?: boolean;
  apiDocumentation?: string;
  averageResponseTime?: number; // ms
}

/**
 * Connection to an API service.
 */
export interface APISource extends Source {
  type: 'api_integration';
  apiEndpoint: string;
  authentication?: {
    type: 'apikey' | 'oauth' | 'basic'; // Never store actual secrets
    keyRequired: boolean;
  };
  rateLimit: {
    requestsPerHour: number;
    costPerRequest?: number; // Some APIs charge per call
  };
}

/**
 * Scraped web source.
 */
export interface ScrapedSource extends Source {
  type: 'web_scrape';
  pageTemplate?: string; // URL pattern for pages
  selectors?: {
    // CSS/XPath selectors for extraction
    price?: string;
    availability?: string;
    product_name?: string;
  };
  updateFrequency?: string; // ISO 8601 duration (how often re-scrape?)
  lastScrapedAt?: Date;
  scrapingFailed?: boolean;
}

// ============================================================================
// EVIDENCE & DATA PROVENANCE
// ============================================================================

/**
 * Evidence is a concrete piece of information from a source.
 * Multiple pieces of evidence can support one data point.
 */
export interface Evidence {
  id: string;
  sourceId: string; // Which source provided this?

  // What's being proven?
  claimType: EvidenceClaimType;
  claim: string; // e.g., "price is €599"
  claimValue?: unknown; // Structured value if available

  // When was this observed?
  observedAt: Date;
  expiresAt?: Date; // If this is time-sensitive (e.g., price, availability)

  // How was it obtained?
  retrievalMethod?: 'api' | 'scrape' | 'user_input' | 'calculation';

  // Quality metrics
  confidence?: number; // 0-1, how confident is this evidence?
  isCanonical?: boolean; // Is this the authoritative version?

  // Related evidence
  supportsEvidenceIds?: string[]; // Other evidence this supports
  contradicts?: string[]; // Evidence this contradicts
}

export type EvidenceClaimType =
  | 'price'
  | 'availability'
  | 'shipping_time'
  | 'product_specification'
  | 'review_rating'
  | 'warranty'
  | 'condition'
  | 'stock_level'
  | 'product_name'
  | 'category'
  | 'manufacturer'
  | 'compatibility'
  | 'other';

// ============================================================================
// DATA PROVENANCE
// ============================================================================

/**
 * Complete provenance record for a data point.
 * "Where did this come from and how confident are we?"
 */
export interface CompleteProvenance {
  // Primary source
  source: Source;
  retrievedAt: Date;

  // Supporting evidence
  supportingEvidence: Evidence[];

  // Contradicting evidence
  contradictingEvidence?: Evidence[];

  // Verification
  verificationStatus: 'verified' | 'credible' | 'unverified' | 'contradicted';
  verificationMethod?: 'direct' | 'cross_reference' | 'authority';

  // Freshness
  isFresh: boolean;
  stalnessWarning?: string; // If data is old

  // Reliability
  reliability: ReliabilityMetrics;

  // Transformation history (if normalized)
  transformations?: DataTransformation[];
}

/**
 * Metrics for assessing reliability.
 */
export interface ReliabilityMetrics {
  sourceReliability: number; // 0-1, how reliable is the source?
  conflictLevel: 'none' | 'low' | 'medium' | 'high'; // How much contradiction?
  conflictingSourceCount?: number;
  dataFreshness: number; // 0-1, higher = fresher
  evidenceCount: number; // How many pieces of evidence?
  overallConfidence: number; // 0-1, synthesis of above
}

/**
 * Represents how data was transformed.
 */
export interface DataTransformation {
  stage: 'discovery' | 'normalization' | 'enrichment';
  transformationType: 'parsed' | 'calculated' | 'inferred' | 'normalized' | 'converted';
  inputValue: unknown;
  outputValue: unknown;
  rule?: string; // What rule was applied?
  timestamp: Date;
  confidence: number; // 0-1, how confident in this transform?
}

// ============================================================================
// CONFLICT & CONTRADICTION TRACKING
// ============================================================================

/**
 * Tracks when multiple sources provide conflicting information.
 */
export interface DataConflict {
  id: string;
  dataPointDescription: string; // e.g., "Sony WH-1000XM5 price"

  // The conflicting values
  conflictingValues: {
    sourceId: string;
    sourceName: string;
    value: unknown;
    observedAt: Date;
    evidence: Evidence;
  }[];

  // Resolution attempt (if any)
  resolutionAttempt?: {
    resolvedValue: unknown;
    resolutionMethod: 'source_authority' | 'consensus' | 'most_recent' | 'user_input' | 'deferred';
    confidence: number;
    reasoning?: string;
  };

  // Tracking
  detectedAt: Date;
  status: 'unresolved' | 'resolved' | 'deferred_to_user';
}

/**
 * Summary of conflicts within a ranking request.
 */
export interface ConflictSummary {
  totalConflicts: number;
  unresolvedConflicts: number;
  conflictedDataPoints: string[];
  affectsRanking: boolean; // Do conflicts affect which offer ranks first?
  userNotificationNeeded: boolean;
}

// ============================================================================
// SOURCE NETWORK & TRUST
// ============================================================================

/**
 * Represents relationships between sources.
 * Used for conflict resolution (e.g., "manufacturer trumps review site").
 */
export interface SourceTrustHierarchy {
  // Higher priority = more trusted for conflicts
  levels: {
    level: number; // 1 = highest trust
    sourceTypes: SourceType[];
    reasoning?: string;
  }[];
}

/**
 * Network of sources and their reliability.
 * Helps assess whether we have enough evidence.
 */
export interface SourceNetwork {
  sources: Source[];
  trustHierarchy: SourceTrustHierarchy;
  coverage: SourceCoverage;
  gaps: SourceGap[];
}

/**
 * What aspects of products/offers can we get info about?
 */
export interface SourceCoverage {
  coverage: {
    aspect: string; // e.g., "pricing", "availability"
    sourcesAvailable: string[]; // source IDs
    coveredCountries?: string[];
  }[];

  uncoveredAspects: string[]; // Things we can't get data for
}

/**
 * Identified gaps in source coverage.
 */
export interface SourceGap {
  aspect: string;
  reason: 'no_source_available' | 'source_unreachable' | 'not_applicable';
  workaround?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

/**
 * Complete audit trail for data provenance.
 * "Capucine's chain of evidence."
 */
export interface ProvenanceAuditTrail {
  id: string;
  dataPointId: string;

  // What was the data point?
  dataPointDescription: string;
  claimedValue: unknown;

  // Where did it come from?
  sources: {
    source: Source;
    evidence: Evidence[];
    timestamp: Date;
  }[];

  // How was it normalized?
  normalizationSteps: DataTransformation[];

  // How confident are we?
  confidenceScore: number; // 0-1
  confidenceFactors: {
    factor: string;
    impact: number;
  }[];

  // Any issues?
  conflicts?: DataConflict[];
  warnings?: string[];

  // Metadata
  createdAt: Date;
  lastUpdatedAt: Date;

  // Summary
  summary: string; // Human-readable summary of provenance
}
