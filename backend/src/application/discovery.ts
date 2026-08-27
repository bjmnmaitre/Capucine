/**
 * Capucine Application Layer — Discovery Abstraction
 *
 * INTERFACE: Pluggable product/offer discovery strategies
 *
 * Discovery is the process of finding candidate offers that match a user's request.
 * This abstraction allows multiple discovery strategies (DB query, API calls, search)
 * to be swapped out without changing application logic.
 *
 * DETERMINISTIC: Same criteria = same results (required for testing)
 */

import { Product, Offer, SearchMatchQuality, PreferenceCriterion, UsageContext } from '../domain/types';
import { SearchCoverage } from './search-coverage';
import { SupportedLanguage } from './i18n';

// ============================================================================
// DISCOVERY CRITERIA
// ============================================================================

/**
 * Criteria for discovering offers.
 * Extracted from normalized request.
 */
export interface DiscoveryCriteria {
  // Search terms
  keywords?: string[];
  categories?: string[];
  productIds?: string[];

  // Price constraints
  minPrice?: number;
  maxPrice?: number;
  currency?: string;

  // Availability
  inStock?: boolean;
  shipping?: {
    countries?: string[];
    maxDays?: number;
  };

  // Merchants
  allowedMerchants?: string[];
  excludedMerchants?: string[];

  /**
   * Exact reference terms (model number/SKU) identified upstream, if any.
   * Used to enable strict exact_match classification — see match-quality.ts.
   * Absent for generic/descriptive searches with no identifiable reference.
   */
  exactRefs?: string[];

  // Sorting
  sortBy?: 'price_asc' | 'price_desc' | 'relevance' | 'rating' | 'recency';
  limit?: number;
  offset?: number;

  // Quality filters
  minRating?: number;
  verifiedOnly?: boolean;

  /**
   * SearchPlan.hardConstraints, passed through so discovery strategies that
   * build multiple complementary queries (SearchStrategyPlanner) can derive
   * a technical-specs query generically from whatever numeric constraints
   * (ram, screen_size, storage, ...) are actually present — without
   * duplicating that logic or hardcoding specific criterion ids.
   */
  hardConstraints?: PreferenceCriterion[];

  /**
   * Usage context from the request (contextual signals, not hard constraints).
   * This influences search strategy and ranking but does not affect admissibility.
   */
  usageContext?: UsageContext;

  /**
   * The QUERY's language — separate from the user's interface/response
   * language (see i18n.ts's resolveLanguage). Drives which language
   * SearchStrategyPlanner phrases phase 1-2 queries in; RealWebDiscoveryStrategy
   * falls back to DEFAULT_LANGUAGE when absent (e.g. sync/local-catalog paths
   * that never resolved a language).
   */
  language?: SupportedLanguage;

  /**
   * Per-REQUEST override for RealWebDiscoveryStrategy's phase-3
   * international queries (SearchStrategyPlanner.buildInternationalStrategies())
   * — e.g. a conversational "cherche aussi en Allemagne" follow-up adding
   * 'de' for just this search. Falls back to the strategy's own constructor-
   * level `internationalLanguages` (a static default) when absent, so
   * existing callers that never set this are unaffected. Reuses the EXACT
   * same phase-3 mechanism — no second international-search system.
   */
  internationalLanguages?: SupportedLanguage[];
}

// ============================================================================
// DISCOVERY STATUS
// ============================================================================

/**
 * Semantic status code for a discovery result.
 *
 * Richer than a boolean success/failure — allows the API layer, UI layer,
 * and tests to branch on *why* a search produced no results or failed.
 *
 * NEVER infer status from result shape alone — use this explicit field.
 *
 * Values:
 *   RESULTS              — At least one candidate found. Happy path.
 *   NO_RESULTS           — Searched successfully, but nothing matched.
 *   SEARCH_PROVIDER_NOT_CONFIGURED — No web search adapter is set up.
 *                          (Differs from UNAVAILABLE: this is a deploy issue, not transient.)
 *   UNAVAILABLE          — Provider is temporarily down or rate-limited.
 *   FAILED               — Strategy threw an unexpected error.
 *   INVALID              — Results returned but all failed structural validation.
 *   PARTIALLY_VALID      — Some results valid, some dropped due to structural issues.
 *   ESCALATION_EXHAUSTED — All escalation levels tried, still 0 results.
 *   CACHED               — Result returned from cache (may be RESULTS or NO_RESULTS internally).
 */
export type DiscoveryStatus =
  | 'RESULTS'
  | 'NO_RESULTS'
  | 'SEARCH_PROVIDER_NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'FAILED'
  | 'INVALID'
  | 'PARTIALLY_VALID'
  | 'ESCALATION_EXHAUSTED'
  | 'CACHED';

// ============================================================================
// DISCOVERY RESULT
// ============================================================================

/**
 * Result of a discovery operation.
 */
export interface DiscoveryResult {
  id: string;
  timestamp: Date;
  criteria: DiscoveryCriteria;

  /**
   * Semantic status — always populated.
   * Default for legacy results without an explicit status: inferred at read time
   * via inferDiscoveryStatus(result).
   */
  status?: DiscoveryStatus;

  // Candidates found
  candidates: Array<{
    offer: Offer;
    matchScore: number; // 0-1: how well does this match criteria
    matchReason?: string;
    /**
     * Categorical match classification, distinct from matchScore.
     * Optional: only populated by strategies that implement it
     * (RealWebDiscoveryStrategy). Never influences PriorityEngine ranking —
     * descriptive metadata only, exactly like provenance.
     */
    matchQuality?: SearchMatchQuality;
  }>;

  // Statistics
  statistics: {
    queriedSources: number;
    candidatesFound: number;
    candidatesFiltered: number;
    searchTimeMs: number;
    relevanceEstimate: 'high' | 'medium' | 'low';
    /** Number of candidates whose data was upgraded via real page-fetch
     *  enrichment (JSON-LD). Optional — only present when a ProductPageExtractor
     *  was provided to the discovery strategy. */
    pageEnrichedCount?: number;
    /**
     * Pages effectivement RÉCUPÉRÉES et caractérisées.
     *
     * Distinct de `pageEnrichedCount`, qui ne compte que les offres dont une
     * donnée a réellement changé. Une page peut être lue et classée sans rien
     * apporter au produit — c'est le cas de 44 % des pages du corpus. Confondre
     * les deux ferait passer une lecture réussie pour un échec.
     */
    pagesRead?: number;
    /** Search-coverage assessment (see search-coverage.ts). Optional — only
     *  populated by strategies that run multiple queries/phases and need to
     *  decide "have I searched enough?" (currently RealWebDiscoveryStrategy). */
    coverage?: SearchCoverage;
  };

  // Metadata
  strategy: string; // e.g., 'database', 'api', 'hybrid'
  warnings?: string[];
}

/**
 * Infer a DiscoveryStatus from a result that may not have one set explicitly.
 * Use only for backward compatibility — new code should set status directly.
 */
export function inferDiscoveryStatus(result: DiscoveryResult): DiscoveryStatus {
  if (result.status) return result.status;
  if (result.candidates.length > 0) return 'RESULTS';
  const w = result.warnings ?? [];
  if (w.some(w => w.includes('not configured') || w.includes('API_KEY_MISSING'))) {
    return 'SEARCH_PROVIDER_NOT_CONFIGURED';
  }
  if (w.some(w => w.includes('failed') || w.includes('threw') || w.includes('error'))) {
    return 'FAILED';
  }
  if (w.some(w => w.includes('exhausted'))) return 'ESCALATION_EXHAUSTED';
  return 'NO_RESULTS';
}

// ============================================================================
// DISCOVERY STRATEGY INTERFACE
// ============================================================================

/**
 * Abstract discovery strategy.
 *
 * Implementations:
 * - DatabaseDiscovery: Query local database
 * - APIDiscovery: Call external APIs
 * - HybridDiscovery: Combine multiple sources
 */
export interface IDiscoveryStrategy {
  // Identification
  readonly name: string;
  readonly version: string;
  readonly isReady: boolean;

  // Execution
  discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult>;
  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult;

  // Health
  health(): Promise<{ status: 'healthy' | 'degraded' | 'unavailable' }>;

  // Configuration
  setCachePolicy?(ttlMs: number): void;
  setRateLimit?(queriesPerSecond: number): void;
}

// ============================================================================
// DISCOVERY ORCHESTRATOR
// ============================================================================

/**
 * Coordinates discovery across multiple strategies.
 *
 * DETERMINISTIC: For testing, uses ordered preference:
 * 1. Try primary strategy
 * 2. If fails, try fallback strategies in order
 * 3. Results are always sorted consistently
 */
export class DiscoveryOrchestrator {
  private strategies: IDiscoveryStrategy[] = [];
  private primaryStrategy?: IDiscoveryStrategy;
  private cache: Map<string, DiscoveryResult> = new Map();
  private cacheEnabled: boolean = false;
  private cacheTtlMs: number = 60000; // 1 minute default

  /**
   * Register a discovery strategy.
   */
  registerStrategy(strategy: IDiscoveryStrategy, isPrimary: boolean = false): void {
    if (!this.strategies.some(s => s.name === strategy.name)) {
      this.strategies.push(strategy);
    }
    if (isPrimary) {
      this.primaryStrategy = strategy;
    }
  }

  /**
   * List registered strategies.
   */
  listStrategies(): Array<{ name: string; version: string; ready: boolean }> {
    return this.strategies.map(s => ({
      name: s.name,
      version: s.version,
      ready: s.isReady,
    }));
  }

  /**
   * Enable/disable caching.
   */
  enableCache(enabled: boolean, ttlMs?: number): void {
    this.cacheEnabled = enabled;
    if (ttlMs) {
      this.cacheTtlMs = ttlMs;
    }
  }

  /**
   * Discover offers (async).
   */
  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const cacheKey = this.criteriaToKey(criteria);

    // Check cache
    if (this.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Try primary strategy first, then fallbacks.
    // Falls through to the next strategy when: (a) primary throws, OR (b) primary returns 0 candidates.
    // This ensures InMemoryDiscovery (or another fallback) is tried when the primary web adapter
    // returns nothing (e.g. NoOpWebSearchAdapter is configured but has no results).
    // If no strategy returns >0 candidates, return the last non-throwing strategy's result.
    const allStrategies = [
      ...(this.primaryStrategy ? [this.primaryStrategy] : []),
      ...this.strategies.filter(s => s !== this.primaryStrategy),
    ];

    let lastValidResult: DiscoveryResult | undefined;

    for (const strategy of allStrategies) {
      if (!strategy.isReady) continue;

      try {
        const result = await strategy.discover(criteria);
        lastValidResult = result; // Track last non-throwing result
        if (result.candidates.length > 0) {
          if (this.cacheEnabled) {
            this.cache.set(cacheKey, result);
            // unref() so the timer doesn't keep Node.js alive after tests complete
            setTimeout(() => this.cache.delete(cacheKey), this.cacheTtlMs).unref();
          }
          return result;
        }
        // 0 candidates → fall through to next strategy
      } catch (_error) {
        // Strategy threw → fall through to next strategy (do NOT update lastValidResult)
      }
    }

    // Return the last strategy that didn't throw (even if 0 candidates), if any.
    // Cache this result so repeated identical queries don't re-query all strategies.
    if (lastValidResult) {
      // Tag with NO_RESULTS status if not already set
      if (!lastValidResult.status) {
        lastValidResult = { ...lastValidResult, status: 'NO_RESULTS' };
      }
      if (this.cacheEnabled) {
        this.cache.set(cacheKey, lastValidResult);
        setTimeout(() => this.cache.delete(cacheKey), this.cacheTtlMs).unref();
      }
      return lastValidResult;
    }

    // All strategies threw — return explicit failure result
    const failResult: DiscoveryResult = {
      id: `discovery-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      status: 'FAILED',
      candidates: [],
      statistics: {
        queriedSources: this.strategies.length,
        candidatesFound: 0,
        candidatesFiltered: 0,
        searchTimeMs: 0,
        relevanceEstimate: 'low',
      },
      strategy: 'none',
      warnings: ['All discovery strategies failed'],
    };
    if (this.cacheEnabled) {
      this.cache.set(cacheKey, failResult);
      setTimeout(() => this.cache.delete(cacheKey), this.cacheTtlMs).unref();
    }
    return failResult;
  }

  /**
   * Discover offers (sync).
   */
  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    const cacheKey = this.criteriaToKey(criteria);

    // Check cache
    if (this.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Same fallback logic as async discover(): fall through on 0 candidates or throw.
    // Return the last non-throwing strategy's result if none finds candidates.
    const allStrategiesSync = [
      ...(this.primaryStrategy ? [this.primaryStrategy] : []),
      ...this.strategies.filter(s => s !== this.primaryStrategy),
    ];

    let lastValidResultSync: DiscoveryResult | undefined;

    for (const strategy of allStrategiesSync) {
      if (!strategy.isReady) continue;

      try {
        const result = strategy.discoverSync(criteria);
        lastValidResultSync = result;
        if (result.candidates.length > 0) {
          if (this.cacheEnabled) {
            this.cache.set(cacheKey, result);
            // unref() so the timer doesn't keep Node.js alive after tests complete
            setTimeout(() => this.cache.delete(cacheKey), this.cacheTtlMs).unref();
          }
          return result;
        }
        // 0 candidates → fall through to next strategy
      } catch (_error) {
        // Strategy threw → fall through to next strategy
      }
    }

    if (lastValidResultSync) {
      if (!lastValidResultSync.status) {
        lastValidResultSync = { ...lastValidResultSync, status: 'NO_RESULTS' };
      }
      if (this.cacheEnabled) {
        this.cache.set(cacheKey, lastValidResultSync);
        setTimeout(() => this.cache.delete(cacheKey), this.cacheTtlMs).unref();
      }
      return lastValidResultSync;
    }

    // All strategies threw
    const failResultSync: DiscoveryResult = {
      id: `discovery-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      status: 'FAILED',
      candidates: [],
      statistics: {
        queriedSources: this.strategies.length,
        candidatesFound: 0,
        candidatesFiltered: 0,
        searchTimeMs: 0,
        relevanceEstimate: 'low',
      },
      strategy: 'none',
      warnings: ['All discovery strategies failed'],
    };
    if (this.cacheEnabled) {
      this.cache.set(cacheKey, failResultSync);
      setTimeout(() => this.cache.delete(cacheKey), this.cacheTtlMs).unref();
    }
    return failResultSync;
  }

  /**
   * Clear cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Convert criteria to cache key.
   */
  private criteriaToKey(criteria: DiscoveryCriteria): string {
    return JSON.stringify(criteria);
  }
}

// ============================================================================
// MOCK DISCOVERY STRATEGY (for testing/development)
// ============================================================================

/**
 * Mock strategy that returns deterministic results.
 * Used for testing without external dependencies.
 */
export class MockDiscoveryStrategy implements IDiscoveryStrategy {
  readonly name = 'mock';
  readonly version = '1.0.0';
  readonly isReady = true;

  private mockOffers: Map<string, Offer[]> = new Map();

  constructor() {
    this.registerMockOffers();
  }

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const results = this.executeDiscovery(criteria);
    const searchTimeMs = Date.now() - startTime;

    return {
      ...results,
      statistics: {
        ...results.statistics,
        searchTimeMs,
      },
    };
  }

  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    return this.executeDiscovery(criteria);
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unavailable' }> {
    return { status: 'healthy' };
  }

  private executeDiscovery(criteria: DiscoveryCriteria): DiscoveryResult {
    const candidates: Array<{ offer: Offer; matchScore: number; matchReason?: string }> = [];

    // Simple mock: return all registered offers that match category
    for (const [category, offers] of this.mockOffers.entries()) {
      if (criteria.categories && !criteria.categories.includes(category)) {
        continue;
      }

      for (const offer of offers) {
        // Check price
        if (criteria.minPrice && offer.price.value && offer.price.value < criteria.minPrice) continue;
        if (criteria.maxPrice && offer.price.value && offer.price.value > criteria.maxPrice) continue;

        // Check merchants
        if (criteria.allowedMerchants && !criteria.allowedMerchants.includes(offer.merchant.id)) {
          continue;
        }
        if (criteria.excludedMerchants?.includes(offer.merchant.id)) {
          continue;
        }

        candidates.push({
          offer,
          matchScore: 0.9, // Mock score
          matchReason: 'Matches all criteria',
        });
      }
    }

    // Apply limit and offset
    const limit = criteria.limit || 10;
    const offset = criteria.offset || 0;
    const limited = candidates.slice(offset, offset + limit);

    return {
      id: `discovery-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      candidates: limited,
      statistics: {
        queriedSources: 1,
        candidatesFound: candidates.length,
        candidatesFiltered: candidates.length - limited.length,
        searchTimeMs: 0,
        relevanceEstimate: candidates.length > 0 ? 'high' : 'low',
      },
      strategy: 'mock',
      warnings: candidates.length === 0 ? ['No offers found'] : undefined,
    };
  }

  /**
   * Register mock offers for testing.
   */
  private registerMockOffers(): void {
    // Would be populated with test data in real use
  }
}
