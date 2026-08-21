/**
 * Tests for the frontend's pure logic modules: criteria.js (SATISFIED/
 * VIOLATED/UNKNOWN grouping), coverage.js (SearchCoverage display helper —
 * never fabricates when absent), product-grouping.js (product/offer
 * distinction), format.js (Intl-based price formatting).
 *
 * No jsdom needed — none of these touch the DOM.
 */

const criteria = require('../../public/js/criteria.js');
const coverage = require('../../public/js/coverage.js');
const productGrouping = require('../../public/js/product-grouping.js');
const format = require('../../public/js/format.js');

describe('frontend criteria.js — SATISFIED / VIOLATED / UNKNOWN grouping', () => {
  const sample = [
    { id: 'ram', name: 'Mémoire RAM', level: 'required', requiredOrForbidden: true, status: 'satisfied' },
    { id: 'budget', name: 'Budget', level: 'required', requiredOrForbidden: true, status: 'satisfied' },
    { id: 'screen_size', name: "Taille d'écran", level: 'required', requiredOrForbidden: true, status: 'violated' },
    { id: 'category', name: 'Catégorie', level: 'required', requiredOrForbidden: true, status: 'unknown' },
    { id: 'color', name: 'Couleur', level: 'preference', requiredOrForbidden: false, status: 'unknown' },
  ];

  it('10. groups criteria into satisfied/violated/unknown buckets, matching the API status verbatim', () => {
    const grouped = criteria.group(sample);
    expect(grouped.satisfied.map((c: any) => c.id)).toEqual(['ram', 'budget']);
    expect(grouped.violated.map((c: any) => c.id)).toEqual(['screen_size']);
    expect(grouped.unknown.map((c: any) => c.id)).toEqual(['category', 'color']);
  });

  it('never reclassifies unknown as violated or satisfied — exact pass-through', () => {
    const grouped = criteria.group(sample);
    const allUnknownIds = grouped.unknown.map((c: any) => c.id);
    expect(allUnknownIds).not.toContain('ram');
    expect(allUnknownIds).not.toContain('screen_size');
  });

  it('hardOnly() keeps only required/forbidden criteria, excluding soft preferences', () => {
    const hard = criteria.hardOnly(sample);
    expect(hard.map((c: any) => c.id)).toEqual(['ram', 'budget', 'screen_size', 'category']);
    expect(hard.find((c: any) => c.id === 'color')).toBeUndefined();
  });
});

describe('frontend coverage.js — never fabricates', () => {
  it('16. hasCoverage(null) is false — a search with no coverage data reports nothing, not zeros', () => {
    expect(coverage.hasCoverage(null)).toBe(false);
    expect(coverage.summaryLines(null)).toEqual([]);
    expect(coverage.saturationKey(null)).toBeNull();
    expect(coverage.elapsedSeconds(null)).toBeNull();
  });

  it('16b. a real coverage object produces real summary lines from present fields only', () => {
    const cov = {
      queriesExecuted: 4, sourcesAttempted: 2, sourcesFailed: 0,
      uniqueDomains: 3, saturated: true, elapsedMs: 8234,
    };
    expect(coverage.hasCoverage(cov)).toBe(true);
    const lines = coverage.summaryLines(cov);
    expect(lines.find((l: any) => l.pluralKey === 'coverage.queries')?.count).toBe(4);
    expect(lines.find((l: any) => l.pluralKey === 'coverage.domains')?.count).toBe(3);
    // sourcesFailed = 0 → no line for it (never pads with a zero-failure line)
    expect(lines.find((l: any) => l.pluralKey === 'coverage.sourcesFailed')).toBeUndefined();
    expect(coverage.saturationKey(cov)).toBe('coverage.saturatedYes');
    expect(coverage.elapsedSeconds(cov)).toBe(8.2);
  });

  it('reports sourcesFailed only when actually > 0', () => {
    const cov = { queriesExecuted: 2, sourcesAttempted: 2, sourcesFailed: 1, uniqueDomains: 1, saturated: false };
    const lines = coverage.summaryLines(cov);
    expect(lines.find((l: any) => l.pluralKey === 'coverage.sourcesFailed')?.count).toBe(1);
    expect(coverage.saturationKey(cov)).toBe('coverage.saturatedNo');
  });
});

describe('frontend product-grouping.js — Product / Offer distinction', () => {
  it('11. groups several offers of the same product together, in ranking order', () => {
    const results = [
      { productId: 'prod-macbook-air-m2', rank: 1, merchant: { name: 'Apple Store' } },
      { productId: 'prod-dell-xps13', rank: 2, merchant: { name: 'LDLC' } },
      { productId: 'prod-macbook-air-m2', rank: 3, merchant: { name: 'Fnac' } },
    ];
    const groups = productGrouping.groupByProduct(results);
    expect(groups).toHaveLength(2);
    expect(groups[0].productId).toBe('prod-macbook-air-m2');
    expect(groups[0].offers).toHaveLength(2);
    expect(groups[0].offers.map((o: any) => o.merchant.name)).toEqual(['Apple Store', 'Fnac']);
    expect(groups[1].productId).toBe('prod-dell-xps13');
    expect(groups[1].offers).toHaveLength(1);
  });

  it('never drops an offer even if productId is missing (falls back to offerId)', () => {
    const results = [{ offerId: 'offer-1', rank: 1 }];
    const groups = productGrouping.groupByProduct(results);
    expect(groups).toHaveLength(1);
    expect(groups[0].offers).toHaveLength(1);
  });
});

describe('frontend format.js — locale-aware price formatting', () => {
  it('12. formats EUR for a French locale', () => {
    const text = format.price(1299.99, 'EUR', 'fr');
    expect(text).toContain('1');
    expect(text).toContain('299');
    expect(text).toMatch(/€/);
  });

  it('13. formats USD for an English locale, distinctly from EUR/fr', () => {
    const text = format.price(1299.99, 'USD', 'en');
    expect(text).toMatch(/\$/);
    expect(text).not.toBe(format.price(1299.99, 'EUR', 'fr'));
  });

  it('returns null for a null/undefined amount — never fabricates a price', () => {
    expect(format.price(null, 'EUR', 'fr')).toBeNull();
    expect(format.price(undefined, 'EUR', 'fr')).toBeNull();
  });
});
