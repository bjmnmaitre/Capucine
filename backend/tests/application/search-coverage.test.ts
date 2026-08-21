/**
 * Tests for computeSearchCoverage — the "have I searched enough?" decision.
 */

import { computeSearchCoverage, DEFAULT_COVERAGE_THRESHOLDS } from '../../src/application/search-coverage';

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
      { minExploitableOffers: 1, minUniqueDomains: 1 }
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
  });
});
