/**
 * Capucine — Search Coverage
 *
 * A search does not end just because a search engine returned N results.
 * SearchCoverage gives RealWebDiscoveryStrategy (or any future multi-source
 * discovery strategy) a deterministic way to ask "have I searched enough?"
 * instead of always stopping after a fixed number of queries, and without
 * ever pretending to have covered a source that wasn't actually queried.
 *
 * Deliberately simple and pure (no I/O, no state) so it's trivially testable
 * and swappable — this is the smallest useful abstraction, not a scoring ML
 * model.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SearchCoverageInput {
  queriesExecuted: number;
  sourcesAttempted: number;
  sourcesFailed: number;
  /** Raw result count across all sources/queries, BEFORE dedup. */
  rawResultsCount: number;
  /** Distinct domains seen across all raw results. */
  uniqueDomains: number;
  /** Results with an actual product URL (not just a search-engine listing). */
  productPagesIdentified: number;
  /** Results with a known, non-null price. */
  exploitableOffers: number;
  duplicatesRemoved: number;
  /** Milliseconds elapsed since the search started. Optional — informational,
   *  part of the search BUDGET (see RealWebDiscoveryOptions.maxTotalTimeMs),
   *  not itself a saturation criterion. */
  elapsedMs?: number;
}

export interface SearchCoverageThresholds {
  /** Stop once at least this many exploitable (priced) offers are found. */
  minExploitableOffers: number;
  /** Stop once results span at least this many distinct domains — avoids
   *  declaring victory on 5 results that are all the same reseller. */
  minUniqueDomains: number;
}

export const DEFAULT_COVERAGE_THRESHOLDS: SearchCoverageThresholds = {
  minExploitableOffers: 3,
  minUniqueDomains: 2,
};

export interface SearchCoverage extends SearchCoverageInput {
  /** uniqueDomains / rawResultsCount, 0 when there are no raw results. */
  domainDiversity: number;
  saturated: boolean;
  recommendation: 'stop' | 'continue';
  /** Short human-readable reason — surfaced in DiscoveryResult.warnings for transparency. */
  reason: string;
}

// ============================================================================
// COMPUTE
// ============================================================================

export function computeSearchCoverage(
  input: SearchCoverageInput,
  thresholds: SearchCoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS
): SearchCoverage {
  const domainDiversity = input.rawResultsCount > 0 ? input.uniqueDomains / input.rawResultsCount : 0;

  const enoughOffers = input.exploitableOffers >= thresholds.minExploitableOffers;
  const enoughDomains = input.uniqueDomains >= thresholds.minUniqueDomains;
  const saturated = enoughOffers && enoughDomains;

  const reason = saturated
    ? `${input.exploitableOffers} offre(s) exploitable(s) sur ${input.uniqueDomains} domaine(s) distinct(s) — couverture jugée suffisante`
    : !enoughOffers
      ? `${input.exploitableOffers}/${thresholds.minExploitableOffers} offre(s) exploitable(s) — insuffisant`
      : `${input.uniqueDomains}/${thresholds.minUniqueDomains} domaine(s) distinct(s) — diversité insuffisante`;

  return {
    ...input,
    domainDiversity,
    saturated,
    recommendation: saturated ? 'stop' : 'continue',
    reason,
  };
}
