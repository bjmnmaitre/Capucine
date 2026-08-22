/**
 * Capucine — Search Coverage *
 * A search does not end just because a search engine returned N results.
 * SearchCoverage gives RealWebDiscoveryStrategy (or any future multi-source
 * discovery strategy) a deterministic way to ask "have I searched enough?"
 * instead of always stopping after a fixed number of queries, and without
 * ever pretending to have covered a source that wasn't actually queried.
 *
 * Enhanced with marginal return analysis and multi-dimensional stopping criteria.
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
  /**
   * Historical data for marginal return analysis - tracks new offers per query
   * to detect diminishing returns. Array length = queriesExecuted.
   */
  newOffersPerQuery?: number[];
  /**
   * Target number of relevant offers to find (optional goal, not requirement)
   * Prevents infinite searching for impossible targets while allowing
   * expression of search ambition.
   */
  targetRelevantOffers?: number;
  /**
   * Maximum number of queries allowed (search budget)
   */
  maxQueries?: number;
}

/**
 * Extended thresholds for sophisticated stopping decisions.
 * Allows configuration of marginal return thresholds and budget limits.
 */
export interface SearchCoverageThresholds {
  /** Stop once at least this many exploitable (priced) offers are found. */
  minExploitableOffers: number;
  /** Stop once results span at least this many distinct domains — avoids
   *  declaring victory on 5 results that are all the same reseller. */
  minUniqueDomains: number;
  /**
   * Marginal return threshold: stop when average new offers per query
   * falls below this value (indicates diminishing returns).
   * Set to 0 to disable marginal return checking.
   */
  minMarginalReturn: number;
  /**
   * Minimum number of queries before marginal return analysis becomes valid.
   * Prevents stopping too early based on noisy initial data.
   */
  minQueriesForMarginalAnalysis: number;
  /**
   * Stop if we've reached the target offer count (if target is set).
   * Set to 0 to disable target-based stopping.
   */
  targetRelevantOffers: number;
  /**
   * Stop if we've exhausted the maximum allowed queries.
   * Set to 0 to disable query-based stopping.
   */
  maxQueries: number;
}

export const DEFAULT_COVERAGE_THRESHOLDS: SearchCoverageThresholds = {
  minExploitableOffers: 3,
  minUniqueDomains: 2,
  minMarginalReturn: 0.5, // Stop when less than 0.5 new offers per query on average
  minQueriesForMarginalAnalysis: 3, // Need at least 3 queries for meaningful analysis
  targetRelevantOffers: 0, // Disabled by default (0 = no target)
  maxQueries: 0, // Disabled by default (0 = no limit)
};

export interface SearchCoverage extends SearchCoverageInput {
  /** uniqueDomains / rawResultsCount, 0 when there are no raw results. */
  domainDiversity: number;
  /** Average new offers per query over recent queries (for marginal return analysis). */
  marginalReturn: number;
  /** Progress toward target as ratio (0-1+ where 1+ means target reached/exceeded). */
  targetProgress: number;
  /** Queries remaining if maxQueries is set (negative means exceeded). */
  queriesRemaining: number;
  saturated: boolean;
  recommendation: 'stop' | 'continue';
  /** Detailed reason for stopping/continuing decision - surfaced in DiscoveryResult.warnings. */
  reason: string;
  /** Specific stopping reason code for programmatic use. */
  stopReason?:
    | 'target_reached'
    | 'coverage_sufficient'
    | 'budget_exhausted'
    | 'marginal_return_low'
    | 'no_more_queries'
    | 'provider_exhausted'
    | 'search_time_limit'
    | 'insufficient_results_but_budget_exhausted'
    | undefined;
}

// ============================================================================
// COMPUTE
// ============================================================================

export function computeSearchCoverage(
  input: SearchCoverageInput,
  thresholds: SearchCoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS
): SearchCoverage {
  // Basic domain diversity calculation
  const domainDiversity = input.rawResultsCount > 0 ? input.uniqueDomains / input.rawResultsCount : 0;

  // Marginal return calculation (average new offers per query)
  const marginalReturn = input.newOffersPerQuery && input.newOffersPerQuery.length > 0
    ? input.newOffersPerQuery.reduce((sum, val) => sum + val, 0) / input.newOffersPerQuery.length
    : 0;

  // Target progress calculation
  const targetProgress = input.targetRelevantOffers && input.targetRelevantOffers > 0
    ? input.exploitableOffers / input.targetRelevantOffers
    : 0;

  // Queries remaining calculation
  const queriesRemaining = input.maxQueries && input.maxQueries > 0
    ? (input.maxQueries - input.queriesExecuted)
    : 0;

  // Check stopping conditions in priority order
  let stopReason: SearchCoverage['stopReason'] | undefined = undefined;
  let recommendation: SearchCoverage['recommendation'] = 'continue';
  let reason: string = '';

  // 1. Target reached (highest priority - user goal achieved)
  if (thresholds.targetRelevantOffers > 0 && input.exploitableOffers >= thresholds.targetRelevantOffers) {
    stopReason = 'target_reached';
    recommendation = 'stop';
    reason = `Objectif atteint : ${input.exploitableOffers}/${thresholds.targetRelevantOffers} offres pertinentes trouvées`;
  }
  // 2. Query budget exhausted
  else if (thresholds.maxQueries > 0 && input.queriesExecuted >= thresholds.maxQueries) {
    stopReason = 'budget_exhausted';
    recommendation = 'stop';
    reason = `Budget de recherche épuisé : ${input.queriesExecuted}/${thresholds.maxQueries} requêtes effectuées`;
  }
  // 3. Marginal return too low (diminishing returns)
  else if (
    thresholds.minMarginalReturn > 0 &&
    input.queriesExecuted >= thresholds.minQueriesForMarginalAnalysis &&
    marginalReturn < thresholds.minMarginalReturn
  ) {
    stopReason = 'marginal_return_low';
    recommendation = 'stop';
    reason = `Rendement marginal insuffisant : ${marginalReturn.toFixed(2)} nouvelles offres/requête en moyenne (seuil : ${thresholds.minMarginalReturn})`;
  }
  // 4. Coverage sufficient (traditional thresholds)
  else {
    const enoughOffers = input.exploitableOffers >= thresholds.minExploitableOffers;
    const enoughDomains = input.uniqueDomains >= thresholds.minUniqueDomains;

    if (enoughOffers && enoughDomains) {
      stopReason = 'coverage_sufficient';
      recommendation = 'stop';
      reason = `${input.exploitableOffers} offre(s) exploitable(s) sur ${input.uniqueDomains} domaine(s) distinct(s) — couverture jugée suffisante`;
    } else if (!enoughOffers) {
      // Not enough offers
      if (thresholds.maxQueries > 0 && input.queriesExecuted >= thresholds.maxQueries) {
        // We tried but couldn't get enough offers within budget
        stopReason = 'insufficient_results_but_budget_exhausted';
        recommendation = 'stop';
        reason = `Résultats insuffisants mais budget épuisé : ${input.exploitableOffers}/${thresholds.minExploitableOffers} offres exploitable(s)`;
      } else {
        stopReason = undefined;
        recommendation = 'continue';
        reason = `${input.exploitableOffers}/${thresholds.minExploitableOffers} offre(s) exploitable(s) — insuffisant`;
      }
    } else if (!enoughDomains) {
      // Not enough domain diversity
      if (thresholds.maxQueries > 0 && input.queriesExecuted >= thresholds.maxQueries) {
        // We tried but couldn't get enough diversity within budget
        stopReason = 'insufficient_results_but_budget_exhausted';
        recommendation = 'stop';
        reason = `Diversité de domaines insuffisante mais budget épuisé : ${input.uniqueDomains}/${thresholds.minUniqueDomains} domaine(s) distinct(s)`;
      } else {
        stopReason = undefined;
        recommendation = 'continue';
        reason = `${input.uniqueDomains}/${thresholds.minUniqueDomains} domaine(s) distinct(s) — diversité insuffisante`;
      }
    }
  }

  return {
    ...input,
    domainDiversity,
    marginalReturn,
    targetProgress,
    queriesRemaining,
    saturated: recommendation === 'stop',
    recommendation,
    reason,
    stopReason,
  };
}