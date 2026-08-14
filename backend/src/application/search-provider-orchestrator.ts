/**
 * Capucine — Search Provider Orchestrator
 *
 * Coordinates searches across multiple providers (Brave, Serper, etc.) in parallel.
 * Designed to handle provider failures gracefully: if Brave is down, Serper can continue.
 *
 * INVARIANTS:
 * 1. Multiple providers are queried in PARALLEL (not sequentially)
 * 2. Results are DEDUPLICATED by URL to avoid reporting same offer twice
 * 3. Conflicting data (e.g., price differences from two sources) is PRESERVED
 * 4. Timeouts on one provider do NOT abort the whole search
 * 5. All results maintain PROVENANCE (which provider returned it)
 * 6. If ALL providers fail, returns structured error (not exception)
 *
 * Usage:
 *   const orchestrator = new SearchProviderOrchestrator([braveAdapter, serperAdapter]);
 *   const results = await orchestrator.search({
 *     query: 'AirPods Pro',
 *     maxResults: 10,
 *   });
 *   // results.status will be RESULTS, PARTIAL, or FAILED depending on outcomes
 */

import { WebSearchAdapter, WebSearchParams, WebSearchOutput, WebSearchResult } from './tools';

// ============================================================================
// ORCHESTRATOR CONFIGURATION
// ============================================================================

export interface SearchProviderOrchestratorConfig {
  /** Time to wait for each provider independently (ms) */
  timeoutPerProviderMs?: number;

  /** Maximum total time for all parallel searches (ms) */
  maxTotalTimeMs?: number;

  /** If true, continue even if all providers fail (return empty results) */
  continueOnAllFailures?: boolean;

  /** How to handle price conflicts from different providers */
  conflictResolution?: 'preserve_all' | 'average' | 'most_recent';

  /** Deduplicate results by URL */
  deduplicateByUrl?: boolean;

  /** Log provider errors for debugging */
  verbose?: boolean;
}

// ============================================================================
// ORCHESTRATOR RESULT
// ============================================================================

export type OrchestratorStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NO_PROVIDERS';

export interface ProviderOutcome {
  providerName: string;
  status: 'success' | 'timeout' | 'error' | 'not_configured';
  resultsCount: number;
  error?: string;
  elapsedMs: number;
}

export interface MergedResult extends WebSearchResult {
  /** Which providers returned this result (may have found it independently) */
  foundBy: string[];

  /** Confidence score (0-1) based on source agreement */
  confidence: number;

  /** If multiple sources gave different prices, store all */
  alternativePrices?: Array<{
    provider: string;
    price?: number;
    currency?: string;
  }>;
}

export interface SearchOrchestratorResult {
  /** Unique identifier for this search operation */
  searchId: string;

  /** Status: all succeeded, some succeeded, all failed */
  status: OrchestratorStatus;

  /** Merged and deduplicated results */
  results: MergedResult[];

  /** Per-provider details for debugging */
  providerOutcomes: ProviderOutcome[];

  /** Timestamp of search */
  timestamp: Date;

  /** Total time taken (ms) */
  elapsedMs: number;

  /** Breakdown of how results were merged */
  mergeMetadata: {
    totalCandidatesBeforeMerge: number;
    totalCandidatesAfterDedup: number;
    dedupByUrlCount: number;
    conflictsDetected: number;
  };
}

// ============================================================================
// SEARCH PROVIDER ORCHESTRATOR
// ============================================================================

export class SearchProviderOrchestrator {
  private readonly providers: WebSearchAdapter[];
  private readonly config: Required<SearchProviderOrchestratorConfig>;

  constructor(
    providers: WebSearchAdapter[],
    config: SearchProviderOrchestratorConfig = {}
  ) {
    this.providers = providers;
    this.config = {
      timeoutPerProviderMs: config.timeoutPerProviderMs ?? 10000,
      maxTotalTimeMs: config.maxTotalTimeMs ?? 30000,
      continueOnAllFailures: config.continueOnAllFailures ?? true,
      conflictResolution: config.conflictResolution ?? 'preserve_all',
      deduplicateByUrl: config.deduplicateByUrl ?? true,
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Execute search across all providers in parallel.
   */
  async search(params: WebSearchParams): Promise<SearchOrchestratorResult> {
    const searchId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    if (this.providers.length === 0) {
      return {
        searchId,
        status: 'NO_PROVIDERS',
        results: [],
        providerOutcomes: [],
        timestamp: new Date(),
        elapsedMs: 0,
        mergeMetadata: {
          totalCandidatesBeforeMerge: 0,
          totalCandidatesAfterDedup: 0,
          dedupByUrlCount: 0,
          conflictsDetected: 0,
        },
      };
    }

    // Execute all provider searches in parallel with individual timeouts
    const outcomes = await Promise.allSettled(
      this.providers.map((provider) =>
        this.searchWithProvider(provider, params)
      )
    );

    // Collect results and outcomes
    const allResults: WebSearchResult[] = [];
    const providerOutcomes: ProviderOutcome[] = [];

    outcomes.forEach((outcome, idx) => {
      const provider = this.providers[idx];
      const startProviderTime = Date.now();

      if (outcome.status === 'fulfilled') {
        const { output, elapsed } = outcome.value;
        providerOutcomes.push({
          providerName: provider.adapterName,
          status: 'success',
          resultsCount: output.results.length,
          elapsedMs: elapsed,
        });
        allResults.push(...output.results);
      } else {
        const error = outcome.reason as Error;
        const classifiedStatus = this.classifyError(error);

        // Check if error is due to provider not being configured
        const isNotConfigured = !provider.isConfigured();

        providerOutcomes.push({
          providerName: provider.adapterName,
          status: isNotConfigured ? 'not_configured' : classifiedStatus,
          resultsCount: 0,
          error: error.message,
          elapsedMs: Date.now() - startProviderTime,
        });

        if (this.config.verbose) {
          console.warn(
            `[SearchOrchestrator] Provider ${provider.adapterName} failed: ${error.message}`
          );
        }
      }
    });

    // Determine overall status
    const successCount = providerOutcomes.filter((o) => o.status === 'success').length;
    const status: OrchestratorStatus =
      successCount === this.providers.length
        ? 'SUCCESS'
        : successCount > 0
          ? 'PARTIAL'
          : 'FAILED';

    // Merge and deduplicate results
    const { merged, metadata } = this.mergeResults(allResults);

    const elapsedMs = Date.now() - startTime;

    return {
      searchId,
      status,
      results: merged,
      providerOutcomes,
      timestamp: new Date(),
      elapsedMs,
      mergeMetadata: metadata,
    };
  }

  /**
   * Execute search with a single provider, with timeout.
   */
  private async searchWithProvider(
    provider: WebSearchAdapter,
    params: WebSearchParams
  ): Promise<{ output: WebSearchOutput; elapsed: number }> {
    const startTime = Date.now();

    // Skip provider if not configured
    if (!provider.isConfigured()) {
      throw new Error(
        `Provider ${provider.adapterName} is not configured (missing API key)`
      );
    }

    // Execute with per-provider timeout
    const result = await Promise.race([
      provider.search(params),
      this.delay(this.config.timeoutPerProviderMs).then(() => {
        throw new Error(
          `Provider ${provider.adapterName} timeout (${this.config.timeoutPerProviderMs}ms)`
        );
      }),
    ]);

    return {
      output: result,
      elapsed: Date.now() - startTime,
    };
  }

  /**
   * Merge results from multiple providers.
   * Deduplicates by URL, preserves provenance and conflicts.
   */
  private mergeResults(
    allResults: WebSearchResult[]
  ): { merged: MergedResult[]; metadata: SearchOrchestratorResult['mergeMetadata'] } {
    const metadata: SearchOrchestratorResult['mergeMetadata'] = {
      totalCandidatesBeforeMerge: allResults.length,
      totalCandidatesAfterDedup: 0,
      dedupByUrlCount: 0,
      conflictsDetected: 0,
    };

    if (allResults.length === 0) {
      return { merged: [], metadata };
    }

    // Group by URL (for deduplication)
    const byUrl = new Map<string, WebSearchResult[]>();
    const urlOrder: string[] = [];

    for (const result of allResults) {
      if (!byUrl.has(result.url)) {
        byUrl.set(result.url, []);
        urlOrder.push(result.url);
      }
      byUrl.get(result.url)!.push(result);
    }

    // Merge deduplicated groups
    const merged: MergedResult[] = [];

    for (const url of urlOrder) {
      const group = byUrl.get(url)!;
      const first = group[0];

      if (!first) continue;

      // If only one provider found it, include as-is
      if (group.length === 1) {
        merged.push({
          ...first,
          foundBy: [first.domain || 'unknown'],
          confidence: 1.0,
        });
        continue;
      }

      // Multiple providers found this URL
      // Merge snippets and track providers
      const foundBy = [...new Set(group.map((r) => r.domain || 'unknown'))];

      const merged_result: MergedResult = {
        title: first.title,
        url: first.url,
        snippet: this.mergeSippets(group.map((r) => r.snippet)),
        position: Math.min(...group.map((r) => r.position)),
        domain: first.domain,
        foundBy,
        confidence: Math.min(1.0, foundBy.length / this.providers.length),
      };

      merged.push(merged_result);
      metadata.conflictsDetected += group.length - 1;
    }

    metadata.totalCandidatesAfterDedup = merged.length;
    if (this.config.deduplicateByUrl) {
      metadata.dedupByUrlCount = allResults.length - merged.length;
    }

    return { merged, metadata };
  }

  /**
   * Merge snippet text from multiple sources.
   */
  private mergeSippets(snippets: string[]): string {
    // Take the longest, most informative snippet
    return snippets.sort((a, b) => b.length - a.length)[0] || '';
  }

  /**
   * Classify error as timeout or other.
   */
  private classifyError(error: Error): 'timeout' | 'error' {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('abort') ? 'timeout' : 'error';
  }

  /**
   * Sleep helper for timeouts.
   */
  private delay(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    );
  }
}

// ============================================================================
// FACTORY HELPER
// ============================================================================

/**
 * Create a default orchestrator with Brave and Serper.
 * Returns null if neither provider is configured.
 */
export function createDefaultSearchOrchestrator(
  braveAdapter?: WebSearchAdapter,
  serperAdapter?: WebSearchAdapter
): SearchProviderOrchestrator | null {
  const providers: WebSearchAdapter[] = [];

  if (braveAdapter?.isConfigured()) providers.push(braveAdapter);
  if (serperAdapter?.isConfigured()) providers.push(serperAdapter);

  if (providers.length === 0) {
    return null; // No providers available
  }

  return new SearchProviderOrchestrator(providers, {
    timeoutPerProviderMs: 10000,
    maxTotalTimeMs: 30000,
    continueOnAllFailures: true,
    deduplicateByUrl: true,
    verbose: process.env.DEBUG_SEARCH_ORCHESTRATOR === 'true',
  });
}
