/**
 * Tests for computeSearchCoverage — the "have I searched enough?" decision.
 */

import { computeSearchCoverage, DEFAULT_COVERAGE_THRESHOLDS, type SearchCoverageThresholds } from '../../src/application/search-coverage';

describe('computeSearchCoverage', () => {
  it('recommends stop when both thresholds (offers + domain diversity) are met', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 2,
      sourcesAttempted: 2,
      sourcesFailed: 0,
      rawResultsCount: 6,
      uniqueDomains: 3,
      productPagesIdentified: 6,
      exploitableOffers: 4,
      duplicatesRemoved: 1,
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 2,
      minMarginalReturn: 0,
      minQueriesForMarginalAnalysis: 0,
      targetRelevantOffers: 0,
      maxQueries: 0
    });

    expect(coverage.saturated).toBe(true);
    expect(coverage.recommendation).toBe('stop');
  });

  it('recommends continue when there are not enough exploitable (priced) offers yet', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 1,
      sourcesAttempted: 1,
      sourcesFailed: 0,
      rawResultsCount: 2,
      uniqueDomains: 2,
      productPagesIdentified: 2,
      exploitableOffers: 1, // below default minExploitableOffers (3)
      duplicatesRemoved: 0,
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 2,
      minMarginalReturn: 0,
      minQueriesForMarginalAnalysis: 0,
      targetRelevantOffers: 0,
      maxQueries: 0
    });

    expect(coverage.saturated).toBe(false);
    expect(coverage.recommendation).toBe('continue');
    expect(coverage.reason).toMatch(/insuffisant/);
  });

  it('recommends continue when offers are numerous but all from a single domain (low diversity)', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 1,
      sourcesAttempted: 1,
      sourcesFailed: 0,
      rawResultsCount: 5,
      uniqueDomains: 1, // below default minUniqueDomains (2)
      productPagesIdentified: 5,
      exploitableOffers: 5,
      duplicatesRemoved: 0,
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 2,
      minMarginalReturn: 0,
      minQueriesForMarginalAnalysis: 0,
      targetRelevantOffers: 0,
      maxQueries: 0
    });

    expect(coverage.saturated).toBe(false);
    expect(coverage.recommendation).toBe('continue');
  });

  it('computes domainDiversity as uniqueDomains / rawResultsCount', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 1, sourcesAttempted: 1, sourcesFailed: 0,
      rawResultsCount: 4, uniqueDomains: 2,
      productPagesIdentified: 4, exploitableOffers: 4, duplicatesRemoved: 0,
    });
    expect(coverage.domainDiversity).toBe(0.5);
  });

  it('domainDiversity is 0 (not NaN/Infinity) when there are no raw results', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 1, sourcesAttempted: 1, sourcesFailed: 1,
      rawResultsCount: 0, uniqueDomains: 0,
      productPagesIdentified: 0, exploitableOffers: 0, duplicatesRemoved: 0,
    });
    expect(coverage.domainDiversity).toBe(0);
    expect(coverage.saturated).toBe(false);
  });

  it('respects custom thresholds instead of the defaults', () => {
    const lenient = computeSearchCoverage(
      {
        queriesExecuted: 1, sourcesAttempted: 1, sourcesFailed: 0,
        rawResultsCount: 1, uniqueDomains: 1,
        productPagesIdentified: 1, exploitableOffers: 1, duplicatesRemoved: 0,
      },
      { minExploitableOffers: 1, minUniqueDomains: 1, minMarginalReturn: 0, minQueriesForMarginalAnalysis: 0, targetRelevantOffers: 0, maxQueries: 0 }
    );
    expect(lenient.saturated).toBe(true);
  });

  it('the input counters are echoed verbatim on the result (no silent recomputation)', () => {
    const input = {
      queriesExecuted: 5, sourcesAttempted: 4, sourcesFailed: 2,
      rawResultsCount: 10, uniqueDomains: 4,
      productPagesIdentified: 8, exploitableOffers: 6, duplicatesRemoved: 2,
    };
    const coverage = computeSearchCoverage(input);
    expect(coverage).toMatchObject(input);
  });

  it('DEFAULT_COVERAGE_THRESHOLDS are sane, non-zero values', () => {
    expect(DEFAULT_COVERAGE_THRESHOLDS.minExploitableOffers).toBeGreaterThan(0);
    expect(DEFAULT_COVERAGE_THRESHOLDS.minUniqueDomains).toBeGreaterThan(0);
    // Check that extended thresholds have sensible defaults
    expect(DEFAULT_COVERAGE_THRESHOLDS.minMarginalReturn).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_COVERAGE_THRESHOLDS.minQueriesForMarginalAnalysis).toBeGreaterThanOrEqual(0);
  });

  it('stops when target offer count is reached', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 5,
      sourcesAttempted: 5,
      sourcesFailed: 0,
      rawResultsCount: 20,
      uniqueDomains: 5,
      productPagesIdentified: 20,
      exploitableOffers: 25,
      duplicatesRemoved: 5,
      targetRelevantOffers: 20
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 2,
      minMarginalReturn: 0,
      minQueriesForMarginalAnalysis: 0,
      targetRelevantOffers: 20,
      maxQueries: 0
    });

    expect(coverage.targetProgress).toBeGreaterThanOrEqual(1);
    expect(coverage.stopReason).toBe('target_reached');
    expect(coverage.recommendation).toBe('stop');
  });

  it('stops when query budget is exhausted', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 10,
      sourcesAttempted: 10,
      sourcesFailed: 0,
      rawResultsCount: 30,
      uniqueDomains: 8,
      productPagesIdentified: 25,
      exploitableOffers: 12,
      duplicatesRemoved: 5,
      maxQueries: 10
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 2,
      minMarginalReturn: 0,
      minQueriesForMarginalAnalysis: 0,
      targetRelevantOffers: 0,
      maxQueries: 10
    });

    expect(coverage.queriesRemaining).toBe(0);
    expect(coverage.stopReason).toBe('budget_exhausted');
    expect(coverage.recommendation).toBe('stop');
  });

  it('stops when marginal return is too low', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 5,
      sourcesAttempted: 5,
      sourcesFailed: 0,
      rawResultsCount: 15,
      uniqueDomains: 4,
      productPagesIdentified: 12,
      exploitableOffers: 6,
      duplicatesRemoved: 3,
      newOffersPerQuery: [3, 2, 1, 1, 0] // declining returns
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 2,
      minMarginalReturn: 1.5, // Stop when less than 1.5 new offers per query
      minQueriesForMarginalAnalysis: 3,
      targetRelevantOffers: 0,
      maxQueries: 0
    });

    expect(coverage.marginalReturn).toBeLessThan(1.5);
    expect(coverage.stopReason).toBe('marginal_return_low');
    expect(coverage.recommendation).toBe('stop');
  });

  it('continues when marginal return is sufficient but coverage not met', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 3,
      sourcesAttempted: 3,
      sourcesFailed: 0,
      rawResultsCount: 9,
      uniqueDomains: 2, // Only 2 domains, need 3
      productPagesIdentified: 8,
      exploitableOffers: 4, // Good number of offers
      duplicatesRemoved: 1,
      newOffersPerQuery: [2, 2, 1] // Good marginal return
    }, {
      minExploitableOffers: 3,
      minUniqueDomains: 3, // Need 3 domains
      minMarginalReturn: 1.0,
      minQueriesForMarginalAnalysis: 3,
      targetRelevantOffers: 0,
      maxQueries: 0
    });

    expect(coverage.marginalReturn).toBeGreaterThanOrEqual(1.0);
    expect(coverage.stopReason).toBeUndefined();
    expect(coverage.recommendation).toBe('continue');
  });

  it('handles insufficient results with budget exhausted correctly (budget exhaustion takes priority)', () => {
    const coverage = computeSearchCoverage({
      queriesExecuted: 5,
      sourcesAttempted: 5,
      sourcesFailed: 0,
      rawResultsCount: 10,
      uniqueDomains: 3,
      productPagesIdentified: 8,
      exploitableOffers: 2, // Only 2 offers, need 5
      duplicatesRemoved: 0,
      maxQueries: 5
    }, {
      minExploitableOffers: 5,
      minUniqueDomains: 2,
      minMarginalReturn: 0,
      minQueriesForMarginalAnalysis: 0,
      targetRelevantOffers: 0,
      maxQueries: 5
    });

    expect(coverage.stopReason).toBe('budget_exhausted');
    expect(coverage.recommendation).toBe('stop');
  });
});
