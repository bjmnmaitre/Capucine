/**
 * Priority Engine Tests
 *
 * Tests the 20 architectural invariants of Capucine through concrete scenarios.
 * Each test verifies critical behavior of the ranking system.
 */

import { rankOffers, mergeProfileAndRequirements, filterEligible } from '../../src/decision/priority-engine';
import {
  PreferenceCriterion,
  Offer,
  Merchant,
  Product,
  RankingRequest,
  DataPoint,
} from '../../src/domain/types';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMerchant(id: string, name: string, country: string): Merchant {
  return {
    id,
    name,
    country,
    executionCapabilities: ['web_redirect'],
  };
}

function createDataPoint<T>(
  value: T,
  status: 'verified' | 'known' | 'unknown' | 'contradictory' = 'known'
): DataPoint<T> {
  return {
    value,
    status,
    provenance: {
      source: 'test',
      retrievedAt: new Date(),
    },
  };
}

function createUnknownDataPoint<T>(): DataPoint<T> {
  return {
    value: null,
    status: 'unknown',
  };
}

function createContradictoryDataPoint<T>(values: T[]): DataPoint<T> {
  return {
    value: null,
    status: 'contradictory',
    conflictingValues: values,
  };
}

function createOffer(
  id: string,
  merchant: Merchant,
  price: number,
  characteristics?: Record<string, DataPoint<unknown>>
): Offer {
  return {
    id,
    productId: 'product-1',
    merchant,
    price: createDataPoint(price),
    currency: 'EUR',
    shippingCost: createDataPoint(0),
    characteristics: characteristics || {},
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: {
      source: 'test',
      retrievedAt: new Date(),
    },
  };
}

function createCriterion(id: string, name: string, level: 'required' | 'very_important' | 'important' | 'preference' | 'forbidden' | 'low' | 'none', params?: Record<string, unknown>): PreferenceCriterion {
  return {
    id,
    name,
    level,
    parameters: params,
  };
}

function createRankingRequest(
  offers: Offer[],
  criteria: PreferenceCriterion[]
): RankingRequest {
  return {
    offers,
    effectiveCriteria: criteria,
    requestId: `test-${Date.now()}`,
    timestamp: new Date(),
  };
}

// ============================================================================
// TESTS: 14 CRITICAL SCENARIOS
// ============================================================================

describe('Priority Engine - 14 Critical Invariants', () => {

  // TEST 1: Permanent preference
  test('1. Simple permanent preference', () => {
    const merchantA = createMerchant('a', 'Fnac', 'FR');
    const merchantB = createMerchant('b', 'Amazon DE', 'DE');

    const offer1 = createOffer('1', merchantA, 599);
    const offer2 = createOffer('2', merchantB, 549);

    // Preference: price matters
    const criteria = [createCriterion('price', 'Price', 'important', { maxBudget: 600 })];

    const result = rankOffers(createRankingRequest([offer1, offer2], criteria));

    // Offer 2 (cheaper) should rank first
    expect(result.rankedOffers[0].offer.id).toBe('2');
    expect(result.rankedOffers[1].offer.id).toBe('1');
  });

  // TEST 2: Temporary exception doesn't modify profile
  test('2. Temporary exception to profile does not modify profile', () => {
    // This test verifies architectural behavior: we cannot directly test
    // that the profile object isn't modified because it's not passed to rankOffers
    // Instead, we test that mergeProfileAndRequirements produces correct output
    // without mutating inputs

    const profileCriteria = [
      createCriterion('marketplace', 'Avoid marketplaces', 'very_important'),
    ];

    const searchCriteria = [
      createCriterion('price', 'Best price', 'required', { maxBudget: 400 }),
    ];

    const exceptions = [
      { criterionId: 'marketplace', temporaryLevel: 'low' as const },
    ];

    const merged = mergeProfileAndRequirements(profileCriteria, searchCriteria, exceptions);

    // Profile criteria should still exist
    const marketplaceCriterion = merged.find((c) => c.id === 'marketplace');
    expect(marketplaceCriterion).toBeDefined();
    expect(marketplaceCriterion?.level).toBe('low'); // Exception applied

    // Original profile should be unchanged (immutable input)
    const originalMarketplace = profileCriteria.find((c) => c.id === 'marketplace');
    expect(originalMarketplace?.level).toBe('very_important'); // Original unchanged
  });

  // TEST 3: Required constraint violation
  test('3. Required constraint violation rejects offer', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    // Offer with no price (unknown)
    const offer = createOffer('1', merchant, 600, {
      repairability: createUnknownDataPoint(),
    });

    const criteria = [createCriterion('repairability', 'Must be repairable', 'required')];

    const result = rankOffers(createRankingRequest([offer], criteria));

    // Offer should be rejected because required criterion cannot be verified
    expect(result.rejectedOffers).toBeDefined();
    expect(result.rejectedOffers?.length).toBe(1);
    expect(result.rankedOffers.length).toBe(0);
  });

  // TEST 4: Unknown data is NOT treated as negative
  test('4. Unknown data is NOT negative (critical invariant)', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    // Offer A: Known good guarantee
    const offerA = createOffer('A', merchant, 599, {
      warranty: createDataPoint('2 years'),
    });

    // Offer B: Unknown warranty
    const offerB = createOffer('B', merchant, 599, {
      warranty: createUnknownDataPoint(),
    });

    const criteria = [createCriterion('warranty', 'Long warranty preferred', 'preference')];

    const result = rankOffers(createRankingRequest([offerA, offerB], criteria));

    // Both offers should be ranked (neither rejected)
    expect(result.rankedOffers.length).toBe(2);

    // Offer A should be slightly better (known warranty),
    // but Offer B should NOT be heavily penalized
    const scoreA = result.rankedOffers.find((r) => r.offer.id === 'A')?.overallScore || 0;
    const scoreB = result.rankedOffers.find((r) => r.offer.id === 'B')?.overallScore || 0;

    // Difference should be small (preference, not critical)
    expect(Math.abs(scoreA - scoreB)).toBeLessThan(30);
  });

  // TEST 5: Contradictory data is preserved, not arbitrarily resolved
  test('5. Contradictory data is preserved', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    const offer = createOffer('1', merchant, 599, {
      repairability: createContradictoryDataPoint([
        'yes, fully repairable',
        'no, sealed design',
      ]),
    });

    const criteria = [createCriterion('repairability', 'Must be repairable', 'required')];

    const result = rankOffers(createRankingRequest([offer], criteria));

    // Offer should be rejected due to contradictory data on required criterion
    expect(result.rejectedOffers?.length).toBe(1);

    // Check that the reason mentions contradiction
    const reason = result.rejectedOffers?.[0].reason || '';
    expect(reason).toContain('contradictory');
  });

  // TEST 6: Multiple offers for same product
  test('6. Multiple offers for same product ranked independently', () => {
    const merchantFnac = createMerchant('fnac', 'Fnac', 'FR');
    const merchantAmazon = createMerchant('amz', 'Amazon', 'DE');
    const merchantLeclerc = createMerchant('leclerc', 'Leclerc', 'FR');

    // Same product, different merchants and prices
    const offer1 = createOffer('1', merchantFnac, 2099);
    const offer2 = createOffer('2', merchantAmazon, 2019);
    const offer3 = createOffer('3', merchantLeclerc, 2149);

    const criteria = [createCriterion('price', 'Best price', 'important', { maxBudget: 2200 })];

    const result = rankOffers(createRankingRequest([offer1, offer2, offer3], criteria));

    // All should be ranked (all within budget)
    expect(result.rankedOffers.length).toBe(3);

    // Cheapest should be first
    expect(result.rankedOffers[0].offer.id).toBe('2');
    expect(result.rankedOffers[1].offer.id).toBe('1');
    expect(result.rankedOffers[2].offer.id).toBe('3');
  });

  // TEST 7: Merchant identity does NOT influence ranking
  test('7. Merchant identity does NOT influence ranking', () => {
    const merchantPartner = createMerchant('partner', 'Our Partner Store', 'FR');
    const merchantNeutral = createMerchant('neutral', 'Random Store', 'DE');

    // Identical prices and characteristics
    const offerPartner = createOffer('1', merchantPartner, 599);
    const offerNeutral = createOffer('2', merchantNeutral, 599);

    const criteria = [createCriterion('price', 'Price', 'important', { maxBudget: 600 })];

    const result = rankOffers(createRankingRequest([offerPartner, offerNeutral], criteria));

    // Scores should be identical (or very close due to same characteristics)
    const scorePartner = result.rankedOffers.find((r) => r.offer.id === '1')?.overallScore || 0;
    const scoreNeutral = result.rankedOffers.find((r) => r.offer.id === '2')?.overallScore || 0;

    expect(scorePartner).toBe(scoreNeutral);
  });

  // TEST 8: Deterministic ranking
  test('8. Ranking is deterministic (same input = same output)', () => {
    const merchant = createMerchant('a', 'Store', 'FR');
    const offer1 = createOffer('1', merchant, 599);
    const offer2 = createOffer('2', merchant, 549);

    const criteria = [createCriterion('price', 'Price', 'important', { maxBudget: 600 })];

    const request = createRankingRequest([offer1, offer2], criteria);

    // Run ranking twice
    const result1 = rankOffers(request);
    const result2 = rankOffers(request);

    // Results should be identical
    expect(result1.rankedOffers.map((r) => r.offer.id)).toEqual(
      result2.rankedOffers.map((r) => r.offer.id)
    );
    expect(result1.rankedOffers.map((r) => r.overallScore)).toEqual(
      result2.rankedOffers.map((r) => r.overallScore)
    );
  });

  // TEST 9: No profile modification via choice observation
  test('9. No automatic profile modification from user choices', () => {
    // This is an architectural test: we verify that ranking does not
    // have side effects that modify inputs
    const merchantA = createMerchant('a', 'Store A', 'FR');
    const offer1 = createOffer('1', merchantA, 599);
    const offer2 = createOffer('2', merchantA, 549);

    const criteria = [createCriterion('price', 'Price', 'important', { maxBudget: 600 })];

    const originalCriteriaLength = criteria.length;
    const originalCriteriaLevel = criteria[0].level;

    rankOffers(createRankingRequest([offer1, offer2], criteria));

    // Criteria should be unchanged
    expect(criteria.length).toBe(originalCriteriaLength);
    expect(criteria[0].level).toBe(originalCriteriaLevel);
  });

  // TEST 10: Execution capability does NOT influence ranking
  test('10. Execution capability does NOT influence ranking', () => {
    const merchantEasy = createMerchant('easy', 'Store Easy', 'FR');
    merchantEasy.executionCapabilities = ['ucp']; // Easy to automate

    const merchantHard = createMerchant('hard', 'Store Hard', 'DE');
    merchantHard.executionCapabilities = ['web_redirect']; // Hard to automate

    // Identical characteristics except execution
    const offerEasy = createOffer('1', merchantEasy, 599);
    const offerHard = createOffer('2', merchantHard, 599);

    const criteria = [createCriterion('price', 'Price', 'important', { maxBudget: 600 })];

    const result = rankOffers(createRankingRequest([offerEasy, offerHard], criteria));

    // Scores should be identical
    const scoreEasy = result.rankedOffers.find((r) => r.offer.id === '1')?.overallScore || 0;
    const scoreHard = result.rankedOffers.find((r) => r.offer.id === '2')?.overallScore || 0;

    expect(scoreEasy).toBe(scoreHard);
  });

  // TEST 11: Forbidden constraint
  test('11. Forbidden constraint prevents ranking', () => {
    const merchant = createMerchant('a', 'Marketplace', 'FR');

    const offer = createOffer('1', merchant, 499, {
      isMarketplace: createDataPoint(true),
    });

    const criteria = [createCriterion('isMarketplace', 'Must not be marketplace', 'forbidden')];

    const result = rankOffers(createRankingRequest([offer], criteria));

    // Offer should be rejected
    expect(result.rejectedOffers?.length).toBe(1);
    expect(result.rankedOffers.length).toBe(0);
  });

  // TEST 12: Mixed constraints and preferences
  test('12. Hard constraints + soft preferences combined correctly', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    // Offer A: Within budget, good warranty
    const offerA = createOffer('A', merchant, 599, {
      warranty: createDataPoint('3 years'),
    });

    // Offer B: Within budget, bad warranty
    const offerB = createOffer('B', merchant, 549, {
      warranty: createDataPoint('1 year'),
    });

    // Offer C: Over budget
    const offerC = createOffer('C', merchant, 700, {
      warranty: createDataPoint('5 years'),
    });

    const criteria = [
      createCriterion('price', 'Max budget', 'required', { maxBudget: 650 }),
      createCriterion('warranty', 'Long warranty preferred', 'preference'),
    ];

    const result = rankOffers(
      createRankingRequest([offerA, offerB, offerC], criteria)
    );

    // Only A and B should be ranked (C exceeds budget)
    expect(result.rankedOffers.length).toBe(2);
    expect(result.rejectedOffers?.length).toBe(1);

    // A should rank higher than B (same price, better warranty)
    expect(result.rankedOffers[0].offer.id).toBe('A');
    expect(result.rankedOffers[1].offer.id).toBe('B');
  });

  // TEST 13: filterEligible utility
  test('13. filterEligible correctly separates valid from invalid offers', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    const offers = [
      createOffer('1', merchant, 599),
      createOffer('2', merchant, 800), // Over budget
      createOffer('3', merchant, 549),
    ];

    const criteria = [
      createCriterion('price', 'Budget constraint', 'required', { maxBudget: 650 }),
    ];

    const { eligible, rejected } = filterEligible(offers, criteria);

    expect(eligible.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect(eligible.map((o) => o.id).sort()).toEqual(['1', '3']);
    expect(rejected[0].offer.id).toBe('2');
  });

  // TEST 14: Full workflow with explanation
  test('14. Full ranking with detailed explanation', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    const offer = createOffer('1', merchant, 599, {
      durability: createDataPoint('5 years'),
      reparability: createDataPoint(true),
    });

    const criteria = [
      createCriterion('price', 'Price', 'very_important', { maxBudget: 600 }),
      createCriterion('durability', 'Durability', 'important'),
      createCriterion('reparability', 'Reparability', 'preference'),
    ];

    const result = rankOffers(createRankingRequest([offer], criteria));

    // Verify structure
    expect(result.rankedOffers.length).toBe(1);
    const rankedOffer = result.rankedOffers[0];

    // Verify we have per-criterion breakdown
    expect(rankedOffer.criterionScores.length).toBe(3);

    // Verify we have a summary
    expect(rankedOffer.summary).toBeDefined();
    expect(rankedOffer.summary.length).toBeGreaterThan(0);

    // Verify overall score is in reasonable range
    expect(rankedOffer.overallScore).toBeGreaterThanOrEqual(0);
    expect(rankedOffer.overallScore).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// ADDITIONAL PROPERTY-BASED TESTS
// ============================================================================

describe('Priority Engine - Architectural Properties', () => {
  test('Ranking produces output for all eligible offers', () => {
    const merchant = createMerchant('a', 'Store', 'FR');
    const offers = [
      createOffer('1', merchant, 599),
      createOffer('2', merchant, 549),
      createOffer('3', merchant, 649),
    ];

    const criteria = [
      createCriterion('price', 'Price', 'preference', { maxBudget: 700 }),
    ];

    const result = rankOffers(createRankingRequest(offers, criteria));

    // All offers should appear (either ranked or rejected)
    const totalOffers = result.rankedOffers.length + (result.rejectedOffers?.length || 0);
    expect(totalOffers).toBe(3);
  });

  test('Ranking respects criterion weights', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    // Offer A: High price, good quality
    const offerA = createOffer('A', merchant, 699, {
      quality: createDataPoint('high'),
    });

    // Offer B: Low price, low quality
    const offerB = createOffer('B', merchant, 499, {
      quality: createDataPoint('low'),
    });

    // Test 1: Price is most important
    const criteriaPriceFirst = [
      createCriterion('price', 'Price', 'very_important', { maxBudget: 800 }),
      createCriterion('quality', 'Quality', 'low'),
    ];

    const resultPriceFirst = rankOffers(
      createRankingRequest([offerA, offerB], criteriaPriceFirst)
    );

    // Offer B should rank first (cheaper)
    expect(resultPriceFirst.rankedOffers[0].offer.id).toBe('B');
  });

  // BUG DETECTION TEST: Price formula
  test('BUGTEST: Price scoring formula is logical', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    // Test prices at different percentages of budget
    const offers = [
      createOffer('at-budget', merchant, 600),    // Exactly at budget
      createOffer('half-budget', merchant, 300),  // 50% of budget
      createOffer('cheap', merchant, 100),        // 17% of budget
    ];

    const criteria = [
      createCriterion('price', 'Price', 'important', { maxBudget: 600 }),
    ];

    const result = rankOffers(createRankingRequest(offers, criteria));

    // Extract scores
    const scoreExact = result.rankedOffers.find((r) => r.offer.id === 'at-budget')?.overallScore || 0;
    const scoreHalf = result.rankedOffers.find((r) => r.offer.id === 'half-budget')?.overallScore || 0;
    const scoreCheap = result.rankedOffers.find((r) => r.offer.id === 'cheap')?.overallScore || 0;

    console.log(`\n🔍 BUG TEST: Price Formula`);
    console.log(`Budget max: 600€`);
    console.log(`Price at budget (600€): score=${scoreExact}`);
    console.log(`Price half budget (300€): score=${scoreHalf}`);
    console.log(`Price cheap (100€): score=${scoreCheap}`);
    console.log(`Formula used: score = 100 - (price/maxBudget)*20`);
    console.log(`Expected: cheap > half > atBudget (lower price = higher score)`);
    console.log(`Actual: ${scoreCheap} > ${scoreHalf} > ${scoreExact}`);

    // Expected behavior:
    // cheap (100) : 100 - (100/600)*20 = 100 - 3.33 = 96.67
    // half (300) : 100 - (300/600)*20 = 100 - 10 = 90
    // exact (600): 100 - (600/600)*20 = 100 - 20 = 80

    // Issue: Price exactly at budget gets penalized to 80, not 100
    // This is suspicious but might be intentional (penalize max budget)
    // However, the formula doesn't make semantic sense

    expect(scoreCheap).toBeGreaterThan(scoreHalf);
    expect(scoreHalf).toBeGreaterThan(scoreExact);
    // But is it intentional that atBudget=80, not 100?
    // This needs clarification
  });

  // BUG DETECTION TEST: Boolean criterion scoring
  test('BUGTEST: Boolean criterion "Avoid marketplace" should favor false over true', () => {
    const merchant = createMerchant('a', 'Store', 'FR');

    // Offer A: NOT a marketplace
    const offerA = createOffer('A', merchant, 599, {
      isMarketplace: createDataPoint(false),
    });

    // Offer B: IS a marketplace
    const offerB = createOffer('B', merchant, 599, {
      isMarketplace: createDataPoint(true),
    });

    const criteria = [
      createCriterion('isMarketplace', 'Avoid marketplace', 'important'),
    ];

    const result = rankOffers(createRankingRequest([offerA, offerB], criteria));

    // Offer A (NOT marketplace) should rank FIRST
    const scoreA = result.rankedOffers.find((r) => r.offer.id === 'A')?.overallScore || 0;
    const scoreB = result.rankedOffers.find((r) => r.offer.id === 'B')?.overallScore || 0;

    console.log(`\n🔍 BUG TEST: Boolean Criterion Scoring`);
    console.log(`Offer A (isMarketplace=false): score=${scoreA}`);
    console.log(`Offer B (isMarketplace=true): score=${scoreB}`);
    console.log(`Criterion: "Avoid marketplace" (important)`);
    console.log(`Expected: A > B (A should avoid marketplace better)`);
    console.log(`Actual rank order: ${result.rankedOffers.map((r) => r.offer.id).join(' > ')}`);

    // This test will FAIL if there's a bug
    expect(scoreA).toBeGreaterThan(scoreB);
    expect(result.rankedOffers[0].offer.id).toBe('A');
  });
});
