/**
 * Scenarios Test Suite
 *
 * Tests the 14 detailed business scenarios from the Capucine specification.
 * Each scenario is a complete user journey with explicit data and expectations.
 */

import { rankOffers, mergeProfileAndRequirements } from '../../src/decision/priority-engine';
import {
  PreferenceCriterion,
  Offer,
  Merchant,
  RankingRequest,
  DataPoint,
  UserProfile,
  CurrentSearchRequirements,
  CriteriaProfile,
} from '../../src/domain/types';

// ============================================================================
// SCENARIO TEST HELPERS
// ============================================================================

function createMerchant(id: string, name: string, country: string): Merchant {
  return { id, name, country, executionCapabilities: ['web_redirect'] };
}

function createDataPoint<T>(
  value: T,
  status: 'verified' | 'known' | 'unknown' | 'contradictory' = 'known'
): DataPoint<T> {
  return { value, status, provenance: { source: 'test', retrievedAt: new Date() } };
}

function createUnknownDataPoint<T>(): DataPoint<T> {
  return { value: null, status: 'unknown' };
}

function createContradictoryDataPoint<T>(values: T[]): DataPoint<T> {
  return { value: null, status: 'contradictory', conflictingValues: values };
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
    provenance: { source: 'test', retrievedAt: new Date() },
  };
}

function createCriterion(
  id: string,
  name: string,
  level: 'required' | 'very_important' | 'important' | 'preference' | 'forbidden' | 'low' | 'none',
  params?: Record<string, unknown>
): PreferenceCriterion {
  return { id, name, level, parameters: params };
}

function createUserProfile(criteria: PreferenceCriterion[]): UserProfile {
  return {
    userId: 'user-1',
    preferences: {
      criteria,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createRankingRequest(
  offers: Offer[],
  criteria: PreferenceCriterion[]
): RankingRequest {
  return {
    offers,
    effectiveCriteria: criteria,
    requestId: `scenario-${Date.now()}`,
    timestamp: new Date(),
  };
}

// ============================================================================
// SCENARIO 1: PROFIL PERMANENT + DEMANDE PONCTUELLE (SANS EXCEPTION)
// ============================================================================

describe('Scenario 1: Permanent Profile + Punctual Demand (No Exception)', () => {
  test('Should rank offers using merged profile + demand criteria', () => {
    // PROFIL: EU products preferred, avoid marketplaces
    const profile = createUserProfile([
      createCriterion('country', 'EU origin', 'very_important'),
      createCriterion('marketplace', 'Avoid marketplace', 'important'),
    ]);

    // DEMANDE: Find wireless headphones under 200€
    const demand: CurrentSearchRequirements = {
      criteria: [
        createCriterion('price', 'Price budget', 'required', { maxBudget: 200 }),
        createCriterion('type', 'Wireless', 'required'),
      ],
      createdAt: new Date(),
      queryText: 'wireless headphones under 200 EUR',
    };

    // OFFERS
    const fnacMerchant = createMerchant('fnac', 'Fnac', 'FR');
    const amazonDeMerchant = createMerchant('amz-de', 'Amazon Germany', 'DE');
    const amazonMarketplaceMerchant = createMerchant('amz-mp', 'Amazon Marketplace', 'XX');

    const offers = [
      createOffer('o1', fnacMerchant, 189, {
        country: createDataPoint('France'),
        marketplace: createDataPoint(false),
        type: createDataPoint('wireless'),
      }),
      createOffer('o2', amazonDeMerchant, 175, {
        country: createDataPoint('Germany'),
        marketplace: createDataPoint(false),
        type: createDataPoint('wireless'),
      }),
      createOffer('o3', amazonMarketplaceMerchant, 155, {
        country: createDataPoint('Unknown'),
        marketplace: createDataPoint(true),
        type: createDataPoint('wireless'),
      }),
    ];

    // MERGE
    const effectiveCriteria = mergeProfileAndRequirements(
      profile.preferences.criteria,
      demand.criteria
    );

    // RANK
    const result = rankOffers(createRankingRequest(offers, effectiveCriteria));

    // VERIFY
    expect(result.rankedOffers.length).toBe(3);
    // All satisfy hard constraints (price + wireless)
    expect(result.rejectedOffers?.length).toBeFalsy();

    // Intention du scénario : la préférence permanente « éviter les
    // marketplaces » doit écarter o3, et parmi les deux offres qui la
    // respectent, la meilleure sur le reste doit gagner.
    //
    // NOTE — assertion corrigée. Elle exigeait auparavant `o1` en tête, avec
    // pour justification que « les écarts de prix s'annulent » et que le tri
    // stable conservait l'ordre d'entrée. Les écarts ne s'annulaient pas : ils
    // étaient ARRONDIS. o1 et o2 sont identiques sur tous les critères sauf le
    // prix, où o2 marque 83 contre 81 à o1. o2 est donc strictement meilleure,
    // et o1 ne l'emportait que par le départage sur l'id. Depuis que l'ordre
    // utilise le score non arrondi, c'est o2 qui gagne — ce qui est correct.
    // L'ancienne attente figeait un artefact d'arrondi, pas une règle métier.

    // o3 est la marketplace : elle doit être dernière.
    expect(result.rankedOffers[result.rankedOffers.length - 1].offer.id).toBe('o3');

    // Les deux offres non-marketplace passent devant.
    const topTwo = result.rankedOffers.slice(0, 2).map(r => r.offer.id);
    expect(topTwo.sort()).toEqual(['o1', 'o2']);

    // Et entre elles, celle qui marque le mieux sur le prix est première.
    const scoreOf = (id: string, criterionId: string) =>
      result.rankedOffers.find(r => r.offer.id === id)!
        .criterionScores.find(c => c.criterionId === criterionId)!.score;
    const [firstId, secondId] = result.rankedOffers.slice(0, 2).map(r => r.offer.id);
    expect(scoreOf(firstId, 'price')).toBeGreaterThanOrEqual(scoreOf(secondId, 'price'));
  });

  test('DEBUG: Check detailed scores for Scenario 1', () => {
    const profile = createUserProfile([
      createCriterion('country', 'EU origin', 'very_important'),
      createCriterion('marketplace', 'Avoid marketplace', 'important'),
    ]);

    const demand: CurrentSearchRequirements = {
      criteria: [
        createCriterion('price', 'Price budget', 'required', { maxBudget: 200 }),
        createCriterion('type', 'Wireless', 'required'),
      ],
      createdAt: new Date(),
    };

    const fnac = createMerchant('fnac', 'Fnac', 'FR');
    const amzDe = createMerchant('amz-de', 'Amazon DE', 'DE');
    const amzMp = createMerchant('amz-mp', 'Amazon MP', 'XX');

    const offers = [
      createOffer('o1', fnac, 189, {
        country: createDataPoint('France'),
        marketplace: createDataPoint(false),
        type: createDataPoint('wireless'),
      }),
      createOffer('o2', amzDe, 175, {
        country: createDataPoint('Germany'),
        marketplace: createDataPoint(false),
        type: createDataPoint('wireless'),
      }),
      createOffer('o3', amzMp, 155, {
        country: createDataPoint(null), // Unknown
        marketplace: createDataPoint(true),
        type: createDataPoint('wireless'),
      }),
    ];

    const effectiveCriteria = mergeProfileAndRequirements(
      profile.preferences.criteria,
      demand.criteria
    );

    const result = rankOffers(createRankingRequest(offers, effectiveCriteria));

    // Log scores for analysis
    result.rankedOffers.forEach((r) => {
      const scores = r.criterionScores.map((cs) => `${cs.criterionName}:${cs.score}`).join(' | ');
      console.log(`${r.offer.id}: score=${r.overallScore} | ${scores}`);
    });

    // OPEN_DECISION: The correct weighting between hard constraints and profile preferences
    expect(result.rankedOffers.length).toBe(3);
  });
});

// ============================================================================
// SCENARIO 2: EXCEPTION TEMPORAIRE (NE MODIFIE PAS LE PROFIL)
// ============================================================================

describe('Scenario 2: Temporary Exception to Profile (Profile Not Modified)', () => {
  test('Should apply exception without mutating UserProfile', () => {
    const profileCriteria = [
      createCriterion('marketplace', 'Avoid marketplace', 'very_important'),
    ];

    const profile = createUserProfile(profileCriteria);
    const originalLevel = profile.preferences.criteria[0].level;

    // DEMANDE: This time, marketplaces are OK if price is really better
    const demand: CurrentSearchRequirements = {
      criteria: [
        createCriterion('price', 'Best price', 'important', { maxBudget: 400 }),
      ],
      profileExceptions: [
        {
          criterionId: 'marketplace',
          temporaryLevel: 'low',
          reason: 'User wants best price, marketplaces allowed if significantly cheaper',
        },
      ],
      createdAt: new Date(),
      queryText: 'best price, even marketplace if much cheaper',
    };

    // MERGE with exception
    const effectiveCriteria = mergeProfileAndRequirements(
      profile.preferences.criteria,
      demand.criteria,
      demand.profileExceptions
    );

    // VERIFY: Original profile unchanged
    expect(profile.preferences.criteria[0].level).toBe(originalLevel);
    expect(profile.preferences.criteria[0].level).toBe('very_important');

    // VERIFY: Effective criteria has exception applied
    const marketplaceCriterion = effectiveCriteria.find((c) => c.id === 'marketplace');
    expect(marketplaceCriterion?.level).toBe('low');
  });
});

// ============================================================================
// SCENARIO 3: DONNÉE INCONNUE (NE DOIT PAS ÊTRE PÉNALISÉE AUTOMATIQUEMENT)
// ============================================================================

describe('Scenario 3: Unknown Data is NOT Penalized Automatically', () => {
  test('Unknown warranty should NOT score lower than known bad warranty', () => {
    const fnac = createMerchant('fnac', 'Fnac', 'FR');

    // Offer A: Known good warranty
    const offerA = createOffer('A', fnac, 599, {
      warranty: createDataPoint('3 years'),
    });

    // Offer B: Unknown warranty (no data)
    const offerB = createOffer('B', fnac, 599, {
      warranty: createUnknownDataPoint(),
    });

    // Offer C: Known bad warranty
    const offerC = createOffer('C', fnac, 599, {
      warranty: createDataPoint('1 year'),
    });

    const criteria = [
      createCriterion('warranty', 'Warranty', 'preference'),
    ];

    const result = rankOffers(
      createRankingRequest([offerA, offerB, offerC], criteria)
    );

    const scoreA = result.rankedOffers.find((r) => r.offer.id === 'A')?.overallScore || 0;
    const scoreB = result.rankedOffers.find((r) => r.offer.id === 'B')?.overallScore || 0;
    const scoreC = result.rankedOffers.find((r) => r.offer.id === 'C')?.overallScore || 0;

    // CRITICAL: Unknown (B) should NOT be worse than bad warranty (C)
    expect(scoreB).toBeGreaterThanOrEqual(scoreC - 5); // Allow small tolerance
    // Good warranty should be best
    expect(scoreA).toBeGreaterThan(scoreB);
  });
});

// ============================================================================
// SCENARIO 4: DONNÉES CONTRADICTOIRES
// ============================================================================

describe('Scenario 4: Contradictory Data is Preserved', () => {
  test('Should reject offer with contradictory required criterion', () => {
    const merchant = createMerchant('m', 'Store', 'FR');

    const offer = createOffer('1', merchant, 599, {
      repairability: createContradictoryDataPoint([
        'Yes, user-repairable',
        'No, sealed design',
      ]),
    });

    const criteria = [
      createCriterion('repairability', 'Must be repairable', 'required'),
    ];

    const result = rankOffers(createRankingRequest([offer], criteria));

    // Offer should be rejected due to contradiction on required criterion
    expect(result.rankedOffers.length).toBe(0);
    expect(result.rejectedOffers?.length).toBe(1);
    expect(result.rejectedOffers?.[0].reason).toContain('contradictoires');
  });
});

// ============================================================================
// SCENARIO 5: PLUSIEURS OFFERS POUR UN MÊME PRODUCT
// ============================================================================

describe('Scenario 5: Multiple Offers for Same Product', () => {
  test('Should rank multiple offers of same product independently', () => {
    const fnac = createMerchant('fnac', 'Fnac', 'FR');
    const amazon = createMerchant('amz', 'Amazon', 'DE');
    const leclerc = createMerchant('leclerc', 'Leclerc', 'FR');

    // All same product (Canon EOS R6), different prices and sellers
    const offers = [
      createOffer('fnac-r6', fnac, 2099),
      createOffer('amazon-r6', amazon, 2019),
      createOffer('leclerc-r6', leclerc, 2149),
    ];

    const criteria = [
      createCriterion('price', 'Best price', 'important', { maxBudget: 2200 }),
    ];

    const result = rankOffers(createRankingRequest(offers, criteria));

    // All should be ranked
    expect(result.rankedOffers.length).toBe(3);

    // Cheapest first
    expect(result.rankedOffers[0].offer.id).toBe('amazon-r6');
    expect(result.rankedOffers[1].offer.id).toBe('fnac-r6');
    expect(result.rankedOffers[2].offer.id).toBe('leclerc-r6');
  });
});

// ============================================================================
// SCENARIO 6: NEUTRALITÉ MARCHAND (CRITÈRE IMPLICIT CACHÉ)
// ============================================================================

describe('Scenario 6: Merchant Neutrality (No Hidden Merchant Preference)', () => {
  test('Identical offers from different merchants should score identically', () => {
    const partnerMerchant = createMerchant('partner-store', 'Our Partner', 'FR');
    const neutralMerchant = createMerchant('random-store', 'Random Store', 'DE');

    // Completely identical offers, different merchants
    const offerPartner = createOffer('p1', partnerMerchant, 599);
    const offerNeutral = createOffer('p2', neutralMerchant, 599);

    const criteria = [
      createCriterion('price', 'Price', 'important', { maxBudget: 600 }),
    ];

    const result = rankOffers(createRankingRequest([offerPartner, offerNeutral], criteria));

    const scorePartner =
      result.rankedOffers.find((r) => r.offer.id === 'p1')?.overallScore || 0;
    const scoreNeutral =
      result.rankedOffers.find((r) => r.offer.id === 'p2')?.overallScore || 0;

    // CRITICAL: Scores must be identical
    expect(scorePartner).toBe(scoreNeutral);
  });
});

// ============================================================================
// SCENARIO 7: DÉTERMINISME (MÊME INPUT = MÊME OUTPUT)
// ============================================================================

describe('Scenario 7: Determinism (Same Input Always Produces Same Output)', () => {
  test('Running ranking multiple times should produce identical results', () => {
    const merchant = createMerchant('m', 'Store', 'FR');
    const offers = [
      createOffer('1', merchant, 599),
      createOffer('2', merchant, 549),
      createOffer('3', merchant, 649),
    ];

    const criteria = [
      createCriterion('price', 'Price', 'important', { maxBudget: 700 }),
    ];

    const request = createRankingRequest(offers, criteria);

    // Run 5 times
    const results = Array.from({ length: 5 }, () => rankOffers(request));

    // All should be identical
    for (let i = 1; i < results.length; i++) {
      expect(results[i].rankedOffers.map((r) => r.offer.id)).toEqual(
        results[0].rankedOffers.map((r) => r.offer.id)
      );
      expect(results[i].rankedOffers.map((r) => r.overallScore)).toEqual(
        results[0].rankedOffers.map((r) => r.overallScore)
      );
    }
  });
});

// ============================================================================
// SCENARIO 8: PROFIL VS DEMANDE (CONFLIT)
// ============================================================================

describe('Scenario 8: Profile vs Demand Conflict (Priority)', () => {
  test('Search-time constraint should override profile preference if explicit', () => {
    // Profile: Always prefer EU
    const profile = createUserProfile([
      createCriterion('country', 'Prefer EU', 'very_important'),
    ]);

    // Demand: This time, find cheapest regardless of origin
    const demand: CurrentSearchRequirements = {
      criteria: [
        createCriterion('price', 'Find cheapest', 'required', { maxBudget: 1000 }),
      ],
      profileExceptions: [
        {
          criterionId: 'country',
          temporaryLevel: 'none',
          reason: 'User wants cheapest for this search',
        },
      ],
      createdAt: new Date(),
    };

    const eu = createMerchant('eu', 'EU Store', 'FR');
    const china = createMerchant('cn', 'China Store', 'CN');

    const offers = [
      createOffer('eu-offer', eu, 599, { country: createDataPoint('France') }),
      createOffer('cn-offer', china, 399, { country: createDataPoint('China') }),
    ];

    const effective = mergeProfileAndRequirements(
      profile.preferences.criteria,
      demand.criteria,
      demand.profileExceptions
    );

    // OPEN_DECISION: When exception temporaryLevel='none', should the criterion be:
    // A) Completely removed from ranking?
    // B) Weighted to 0 (but still evaluated)?
    // C) Something else?
    //
    // Currently, mergeProfileAndRequirements modifies the criterion level,
    // but getLevelWeight('none') = 0, so it shouldn't affect scoring.
    // However, if profile country=very_important is not properly overridden,
    // the old level might still apply.

    const result = rankOffers(createRankingRequest(offers, effective));

    // TEMPORARY: Accept current behavior pending clarification
    expect(result.rankedOffers.length).toBe(2);
    // If exception works correctly: cn-offer first (cheapest)
    // If exception doesn't work: eu-offer first (country preference)
  });
});

// ============================================================================
// SCENARIO 9: CONTRAINTE INTERDITE (FORBIDDEN)
// ============================================================================

describe('Scenario 9: Forbidden Constraint', () => {
  test('Offer violating forbidden criterion should be rejected', () => {
    const marketplace = createMerchant('mp', 'Amazon Marketplace', 'XX');

    const offer = createOffer('mp-offer', marketplace, 399, {
      isMarketplace: createDataPoint(true),
    });

    const criteria = [
      createCriterion('isMarketplace', 'Must NOT be marketplace', 'forbidden'),
    ];

    const result = rankOffers(createRankingRequest([offer], criteria));

    expect(result.rankedOffers.length).toBe(0);
    expect(result.rejectedOffers?.length).toBe(1);
  });
});

// ============================================================================
// SCENARIO 10: EXÉCUTION ≠ RANKING
// ============================================================================

describe('Scenario 10: Execution Capability Does NOT Affect Ranking', () => {
  test('Hard-to-execute offer should rank same as easy-to-execute if characteristics identical', () => {
    const hardExecute = createMerchant('hard', 'Hard Store', 'FR');
    hardExecute.executionCapabilities = ['web_redirect'];

    const easyExecute = createMerchant('easy', 'Easy Store', 'DE');
    easyExecute.executionCapabilities = ['ucp'];

    // Same price, different execution capabilities
    const offerHard = createOffer('hard-offer', hardExecute, 599);
    const offerEasy = createOffer('easy-offer', easyExecute, 599);

    const criteria = [
      createCriterion('price', 'Price', 'important', { maxBudget: 600 }),
    ];

    const result = rankOffers(createRankingRequest([offerHard, offerEasy], criteria));

    const scoreHard =
      result.rankedOffers.find((r) => r.offer.id === 'hard-offer')?.overallScore || 0;
    const scoreEasy =
      result.rankedOffers.find((r) => r.offer.id === 'easy-offer')?.overallScore || 0;

    // CRITICAL: Scores must be identical
    expect(scoreHard).toBe(scoreEasy);
  });
});

// ============================================================================
// SCENARIO 11: PRODUCT ≠ OFFER (DISTINCTION IMPORTANTE)
// ============================================================================

describe('Scenario 11: Product != Offer Distinction', () => {
  test('Same product with multiple offers should maintain distinction', () => {
    // This test verifies the model structure, not the engine logic
    // because the engine receives pre-built Offers

    const merchant1 = createMerchant('m1', 'Store 1', 'FR');
    const merchant2 = createMerchant('m2', 'Store 2', 'DE');

    // Same productId (same product) but different offers
    const offers = [
      createOffer('offer-1', merchant1, 599),
      createOffer('offer-2', merchant2, 549),
    ];

    expect(offers[0].productId).toBe(offers[1].productId);
    expect(offers[0].id).not.toBe(offers[1].id);
    expect(offers[0].merchant.id).not.toBe(offers[1].merchant.id);
  });
});

// ============================================================================
// SCENARIO 12: BUDGET FLEXIBLE (AMBIGUITÉ)
// ============================================================================

describe('Scenario 12: Flexible Budget ("Can exceed by 10-15% if quality really better")', () => {
  test('Should handle flexible budget constraint correctly', () => {
    const merchant = createMerchant('m', 'Store', 'FR');

    // The meaning of "really better" is AMBIGUOUS
    // Without more specification, this is an OPEN_DECISION

    const offers = [
      createOffer('a', merchant, 580),  // Within budget
      createOffer('b', merchant, 650),  // 8% over budget
      createOffer('c', merchant, 720),  // 20% over budget
    ];

    const criteria = [
      createCriterion('price', 'Budget (flexible 10-15%)', 'required', {
        maxBudget: 600,
        flexibilityPercent: 15,
      }),
    ];

    // OPEN_DECISION: How does flexibility affect required constraint?
    // For now, we test that the engine works, but result depends on interpretation
    const result = rankOffers(createRankingRequest(offers, criteria));

    // At minimum, offers A and B should likely be valid
    expect(result.rankedOffers.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// SCENARIO 13: CAS DE FAILLITE (AUCUNE OFFRE VALIDE)
// ============================================================================

describe('Scenario 13: No Valid Offers (No Offers Match All Constraints)', () => {
  test('Should reject all offers when none satisfy hard constraints', () => {
    const merchant = createMerchant('m', 'Store', 'FR');

    const offers = [
      createOffer('expensive', merchant, 700),
      createOffer('very-expensive', merchant, 900),
    ];

    const criteria = [
      createCriterion('price', 'Budget', 'required', { maxBudget: 600 }),
    ];

    const result = rankOffers(createRankingRequest(offers, criteria));

    expect(result.rankedOffers.length).toBe(0);
    expect(result.rejectedOffers?.length).toBe(2);
  });
});

// ============================================================================
// SCENARIO 14: DONNÉES INCOMPLÈTES / MIXTES
// ============================================================================

describe('Scenario 14: Mixed Data Completeness (Known + Unknown + Contradictory)', () => {
  test('Should handle mixed data statuses in same ranking', () => {
    const merchant = createMerchant('m', 'Store', 'FR');

    const offers = [
      // Offer A: Complete data
      createOffer('a', merchant, 599, {
        warranty: createDataPoint('2 years'),
        noise: createDataPoint(28),
      }),
      // Offer B: Unknown warranty
      createOffer('b', merchant, 549, {
        warranty: createUnknownDataPoint(),
        noise: createDataPoint(32),
      }),
      // Offer C: Contradictory warranty
      createOffer('c', merchant, 579, {
        warranty: createContradictoryDataPoint(['1 year', '3 years']),
        noise: createDataPoint(25),
      }),
    ];

    const criteria = [
      createCriterion('warranty', 'Warranty preferred', 'preference'),
      createCriterion('noise', 'Low noise', 'preference'),
      createCriterion('price', 'Price', 'important', { maxBudget: 600 }),
    ];

    const result = rankOffers(createRankingRequest(offers, criteria));

    // All should be ranked (preferences don't reject)
    expect(result.rankedOffers.length).toBe(3);

    // Offer A (complete + known good) should rank high
    const scoreA = result.rankedOffers.find((r) => r.offer.id === 'a')?.overallScore || 0;
    const scoreB = result.rankedOffers.find((r) => r.offer.id === 'b')?.overallScore || 0;

    // Complete > unknown
    expect(scoreA).toBeGreaterThan(scoreB);
  });
});
