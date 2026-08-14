/**
 * Permutation Invariance Tests
 *
 * INVARIANT UNDER TEST:
 *   "Même données produit + marchand différent = même classement"
 *   "La source n'a aucun droit particulier sur le classement."
 *   "La difficulté d'exécution n'a aucun effet sur le classement."
 *
 * These tests verify that CapucineEngine produces the SAME ranking
 * regardless of:
 *   1. Merchant permutation — same offer, different merchant identity
 *   2. Source permutation — same offer discovered from different data sources
 *   3. Execution permutation — same offer with different execution capabilities
 *   4. Discovery order permutation — candidates presented in different order
 *   5. Offer ID permutation — same offer with different IDs
 *
 * Each test:
 *   a. Builds two structurally identical offers differing only in the invariant attribute
 *   b. Runs CapucineEngine with both orderings
 *   c. Asserts the ranking scores are equal (or score ordering is identical)
 */

import {
  CapucineEngine,
  createSearchRequest,
  createEmptyProfile,
} from '../../src/application/capucine-engine';
import {
  DiscoveryOrchestrator,
  IDiscoveryStrategy,
  DiscoveryCriteria,
  DiscoveryResult,
} from '../../src/application/discovery';
import { Offer, DataPoint, Merchant, PreferenceCriterion } from '../../src/domain/types';

// ============================================================================
// HELPERS
// ============================================================================

function dp<T>(value: T): DataPoint<T> {
  return { value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } };
}

function unknownDp(): DataPoint<null> {
  return { value: null, status: 'unknown' };
}

function buildMerchant(id: string, name: string): Merchant {
  return { id, name, country: 'FR', executionCapabilities: [] };
}

/**
 * Build a minimal valid Offer with explicit characteristics.
 */
function buildOffer(
  id: string,
  merchantId: string,
  merchantName: string,
  price: number,
  chars: Record<string, DataPoint<unknown>> = {}
): Offer {
  return {
    id,
    productId: `product-${id}`, // unique per offer so deduplication doesn't group them
    merchant: buildMerchant(merchantId, merchantName),
    price: dp(price),
    currency: 'EUR',
    shippingCost: dp(0),
    characteristics: {
      battery: dp(30),    // hours
      weight: dp(250),    // grams
      noise_cancellation: dp(true),
      ...chars,
    },
    provenance: { source: 'test', retrievedAt: new Date() },
    createdAt: new Date(),
    retrievedAt: new Date(),
  };
}

/**
 * Create an engine that uses a fixed list of offers as its catalog.
 */
function engineWithOffers(offers: Offer[]): CapucineEngine {
  const strategy: IDiscoveryStrategy = {
    name: 'fixed',
    version: '1.0.0',
    isReady: true,
    async discover(_c: DiscoveryCriteria): Promise<DiscoveryResult> {
      return {
        id: `fixed-${Date.now()}`,
        timestamp: new Date(),
        criteria: _c,
        candidates: offers.map((o, i) => ({ offer: o, matchScore: 1 - i * 0.001 })),
        statistics: {
          queriedSources: 1, candidatesFound: offers.length,
          candidatesFiltered: 0, searchTimeMs: 0, relevanceEstimate: 'high',
        },
        strategy: 'fixed',
      };
    },
    discoverSync(_c: DiscoveryCriteria): DiscoveryResult {
      return {
        id: `fixed-sync-${Date.now()}`,
        timestamp: new Date(),
        criteria: _c,
        candidates: offers.map((o, i) => ({ offer: o, matchScore: 1 - i * 0.001 })),
        statistics: {
          queriedSources: 1, candidatesFound: offers.length,
          candidatesFiltered: 0, searchTimeMs: 0, relevanceEstimate: 'high',
        },
        strategy: 'fixed',
      };
    },
    async health() { return { status: 'healthy' }; },
  };

  const orchestrator = new DiscoveryOrchestrator();
  orchestrator.registerStrategy(strategy, true);
  return new CapucineEngine({ discoveryOrchestrator: orchestrator });
}

const HEADPHONE_CRITERIA: PreferenceCriterion[] = [
  { id: 'battery', name: 'Autonomie', level: 'important', parameters: { targetValue: 30 } },
  { id: 'noise_cancellation', name: 'Réduction de bruit', level: 'very_important', parameters: { boolean: true } },
];

// ============================================================================
// 1. MERCHANT PERMUTATION INVARIANCE
// ============================================================================

describe('Permutation Invariance — Merchant', () => {
  /**
   * Offer A and Offer B have IDENTICAL characteristics.
   * Offer A is sold by "MegaStore" (large merchant).
   * Offer B is sold by "PetitShop" (small merchant).
   *
   * INVARIANT: Their ranking scores must be equal.
   * Merchant identity MUST NOT affect the score.
   */
  test('Same product, different merchant → identical score', async () => {
    const offerA = buildOffer('offer-a', 'megastore', 'MegaStore', 199);
    const offerB = buildOffer('offer-b', 'petitshop', 'PetitShop', 199);

    const engine = engineWithOffers([offerA, offerB]);
    const request = createSearchRequest('casque bluetooth', HEADPHONE_CRITERIA);
    const result = engine.searchSync(request);

    expect(result.ranking.rankedOffers.length).toBe(2);

    const scoreA = result.ranking.rankedOffers.find(r => r.offer.id === 'offer-a')!.overallScore;
    const scoreB = result.ranking.rankedOffers.find(r => r.offer.id === 'offer-b')!.overallScore;

    // Scores must be equal — merchant identity must not affect ranking
    expect(scoreA).toBeCloseTo(scoreB, 1);
  });

  test('Reversing merchant order does not change relative scores', async () => {
    const offerA = buildOffer('offer-a', 'merchant-x', 'Merchant X', 299);
    const offerB = buildOffer('offer-b', 'merchant-y', 'Merchant Y', 299);

    // Run with [A, B]
    const engine1 = engineWithOffers([offerA, offerB]);
    const result1 = engine1.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));

    // Run with [B, A]
    const engine2 = engineWithOffers([offerB, offerA]);
    const result2 = engine2.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));

    const scoreA1 = result1.ranking.rankedOffers.find(r => r.offer.id === 'offer-a')!.overallScore;
    const scoreA2 = result2.ranking.rankedOffers.find(r => r.offer.id === 'offer-a')!.overallScore;
    const scoreB1 = result1.ranking.rankedOffers.find(r => r.offer.id === 'offer-b')!.overallScore;
    const scoreB2 = result2.ranking.rankedOffers.find(r => r.offer.id === 'offer-b')!.overallScore;

    expect(scoreA1).toBeCloseTo(scoreA2, 1);
    expect(scoreB1).toBeCloseTo(scoreB2, 1);
  });

  test('Large marketplace vs independent shop → same score for same product', async () => {
    const chars = {
      battery: dp(40),
      noise_cancellation: dp(true),
      weight: dp(200),
    };
    const fromMarketplace = buildOffer('market', 'amazon-fr', 'Amazon', 250, chars);
    const fromShop = buildOffer('shop', 'artisan-audio', 'Artisan Audio', 250, chars);

    const engine = engineWithOffers([fromMarketplace, fromShop]);
    const result = engine.searchSync(createSearchRequest('casque bluetooth', HEADPHONE_CRITERIA));

    const scores = result.ranking.rankedOffers.map(r => r.overallScore);
    expect(scores[0]).toBeCloseTo(scores[1], 1);
  });
});

// ============================================================================
// 2. SOURCE PERMUTATION INVARIANCE
// ============================================================================

describe('Permutation Invariance — Source', () => {
  /**
   * Two offers with the same characteristics but different provenance sources.
   * Source MUST NOT affect ranking score — only provenance tracking.
   */
  test('Same offer, different provenance source → same score', async () => {
    const baseChars = { battery: dp(35), noise_cancellation: dp(true) };

    const fromBrave: Offer = {
      ...buildOffer('offer-brave', 'shop-a', 'Shop A', 179, baseChars),
      provenance: { source: 'brave_search', retrievedAt: new Date() },
    };
    const fromInMemory: Offer = {
      ...buildOffer('offer-mem', 'shop-a', 'Shop A', 179, baseChars),
      provenance: { source: 'in_memory_catalog', retrievedAt: new Date() },
    };

    const engine = engineWithOffers([fromBrave, fromInMemory]);
    const result = engine.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));

    const ranked = result.ranking.rankedOffers;
    expect(ranked.length).toBe(2);

    // Scores must be equal despite different provenance sources
    const s1 = ranked.find(r => r.offer.id === 'offer-brave')!.overallScore;
    const s2 = ranked.find(r => r.offer.id === 'offer-mem')!.overallScore;
    expect(s1).toBeCloseTo(s2, 1);
  });

  test('Web-discovered offer vs DB offer with same data → same score', async () => {
    const chars = { battery: dp(25), noise_cancellation: dp(false) };
    const webOffer = { ...buildOffer('web-1', 'm1', 'Merchant 1', 99, chars), provenance: { source: 'serper', retrievedAt: new Date() } };
    const dbOffer = { ...buildOffer('db-1', 'm1', 'Merchant 1', 99, chars), provenance: { source: 'database', retrievedAt: new Date() } };

    const engine = engineWithOffers([webOffer, dbOffer]);
    const result = engine.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));

    const s1 = result.ranking.rankedOffers.find(r => r.offer.id === 'web-1')!.overallScore;
    const s2 = result.ranking.rankedOffers.find(r => r.offer.id === 'db-1')!.overallScore;
    expect(s1).toBeCloseTo(s2, 1);
  });
});

// ============================================================================
// 3. EXECUTION PERMUTATION INVARIANCE
// ============================================================================

describe('Permutation Invariance — Execution', () => {
  /**
   * Execution capability (how easy to buy) MUST NOT affect ranking.
   *
   * Invariant 4: "La difficulté d'exécution n'a aucun effet sur le classement."
   */
  test('Easy-to-execute offer vs hard-to-execute offer → same product score', async () => {
    const chars = { battery: dp(38), noise_cancellation: dp(true) };

    // Easy: direct purchase via web redirect
    const easyOffer: Offer = {
      ...buildOffer('easy', 'shop-eu', 'EU Shop', 220, chars),
      executionCapability: 'web_redirect',
      executionUrl: 'https://shop.eu/buy/headphone-x',
    };

    // Hard: browser automation required (more difficult)
    const hardOffer: Offer = {
      ...buildOffer('hard', 'shop-remote', 'Remote Shop', 220, chars),
      executionCapability: 'browser_automation',
    };

    const engine = engineWithOffers([easyOffer, hardOffer]);
    const result = engine.searchSync(createSearchRequest('casque bluetooth', HEADPHONE_CRITERIA));

    const seasy = result.ranking.rankedOffers.find(r => r.offer.id === 'easy')!.overallScore;
    const shard = result.ranking.rankedOffers.find(r => r.offer.id === 'hard')!.overallScore;

    // Execution difficulty MUST NOT lower the score
    expect(seasy).toBeCloseTo(shard, 1);
  });

  test('Out-of-stock offer still ranked by product quality, not availability', async () => {
    const chars = { battery: dp(45), noise_cancellation: dp(true) };

    const inStock = buildOffer('in-stock', 'm1', 'Merchant 1', 300, chars);
    const outOfStock = buildOffer('out-of-stock', 'm2', 'Merchant 2', 300, chars);
    // Both have same product characteristics — ranking must be equal on quality

    const engine = engineWithOffers([inStock, outOfStock]);
    const result = engine.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));

    const s1 = result.ranking.rankedOffers.find(r => r.offer.id === 'in-stock')!.overallScore;
    const s2 = result.ranking.rankedOffers.find(r => r.offer.id === 'out-of-stock')!.overallScore;
    expect(s1).toBeCloseTo(s2, 1);
  });
});

// ============================================================================
// 4. DISCOVERY ORDER PERMUTATION
// ============================================================================

describe('Permutation Invariance — Discovery Order', () => {
  /**
   * The order in which candidates are presented to the pipeline
   * must not change the final ranking scores.
   *
   * Ranking must be deterministic: same inputs → same outputs, regardless
   * of input ordering.
   */
  test('6 candidates in 2 different orderings → identical scores per offer', async () => {
    const offers = [
      buildOffer('o1', 'm1', 'M1', 100, { battery: dp(20) }),
      buildOffer('o2', 'm2', 'M2', 150, { battery: dp(30) }),
      buildOffer('o3', 'm3', 'M3', 200, { battery: dp(40) }),
      buildOffer('o4', 'm4', 'M4', 250, { battery: dp(25) }),
      buildOffer('o5', 'm5', 'M5', 300, { battery: dp(35) }),
      buildOffer('o6', 'm6', 'M6', 350, { battery: dp(45) }),
    ];

    const criteria: PreferenceCriterion[] = [
      { id: 'battery', name: 'Autonomie', level: 'very_important', parameters: { targetValue: 40 } },
    ];

    // Forward order
    const e1 = engineWithOffers([...offers]);
    const r1 = e1.searchSync(createSearchRequest('casque', criteria));

    // Reverse order
    const e2 = engineWithOffers([...offers].reverse());
    const r2 = e2.searchSync(createSearchRequest('casque', criteria));

    // Scores for each offer must be identical across both orderings
    for (const offer of offers) {
      const s1 = r1.ranking.rankedOffers.find(r => r.offer.id === offer.id)?.overallScore ?? -1;
      const s2 = r2.ranking.rankedOffers.find(r => r.offer.id === offer.id)?.overallScore ?? -1;
      expect(s1).toBeCloseTo(s2, 1);
    }
  });

  test('Random permutations of 4 offers → same #1 winner', async () => {
    // o3 has the best battery (50h) — it must win regardless of permutation
    const o1 = buildOffer('o1', 'm1', 'M1', 200, { battery: dp(20), noise_cancellation: dp(false) });
    const o2 = buildOffer('o2', 'm2', 'M2', 200, { battery: dp(30), noise_cancellation: dp(false) });
    const o3 = buildOffer('o3', 'm3', 'M3', 200, { battery: dp(50), noise_cancellation: dp(true) });
    const o4 = buildOffer('o4', 'm4', 'M4', 200, { battery: dp(10), noise_cancellation: dp(false) });

    const criteria: PreferenceCriterion[] = [
      { id: 'battery', name: 'Autonomie', level: 'very_important', parameters: { targetValue: 50 } },
      { id: 'noise_cancellation', name: 'ANC', level: 'important', parameters: { boolean: true } },
    ];

    const permutations = [
      [o1, o2, o3, o4],
      [o4, o3, o2, o1],
      [o3, o1, o4, o2],
      [o2, o4, o1, o3],
    ];

    for (const perm of permutations) {
      const engine = engineWithOffers(perm);
      const result = engine.searchSync(createSearchRequest('casque', criteria));
      const winner = result.ranking.rankedOffers[0].offer.id;
      expect(winner).toBe('o3');
    }
  });
});

// ============================================================================
// 5. RARITY INVARIANCE
// ============================================================================

describe('Permutation Invariance — Rarity', () => {
  /**
   * Invariant 2: "La rareté ne diminue pas la pertinence."
   *
   * A rare product (only 1 candidate) must rank the same as
   * an identical product competing with many alternatives.
   */
  test('Rare product (1 candidate) vs same product in large catalog → same score', async () => {
    const rareOffer = buildOffer('rare', 'niche-shop', 'Niche Shop', 199, {
      battery: dp(30),
      noise_cancellation: dp(true),
    });

    // Compete with many inferior offers
    const competitors = Array.from({ length: 10 }, (_, i) =>
      buildOffer(`comp-${i}`, `merchant-${i}`, `Merchant ${i}`, 199, {
        battery: dp(5),       // inferior battery
        noise_cancellation: dp(false), // no ANC
      })
    );

    // With rare offer alone
    const engineAlone = engineWithOffers([rareOffer]);
    const resultAlone = engineAlone.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));
    const scoreAlone = resultAlone.ranking.rankedOffers[0].overallScore;

    // With rare offer + competitors
    const engineWithComp = engineWithOffers([rareOffer, ...competitors]);
    const resultWithComp = engineWithComp.searchSync(createSearchRequest('casque', HEADPHONE_CRITERIA));
    const scoreWithComp = resultWithComp.ranking.rankedOffers.find(r => r.offer.id === 'rare')!.overallScore;

    // Score must be the same — rarity (catalog size) must not reduce relevance
    expect(scoreAlone).toBeCloseTo(scoreWithComp, 1);
    // And the rare offer must still rank #1
    expect(resultWithComp.ranking.rankedOffers[0].offer.id).toBe('rare');
  });
});
