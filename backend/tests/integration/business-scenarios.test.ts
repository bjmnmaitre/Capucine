/**
 * Business Scenario Tests (French)
 *
 * These tests simulate real user scenarios with French queries.
 * They verify the full pipeline from raw text → ranking.
 *
 * Scenarios covered:
 * 1. Budget strict — "moins de 300€, c'est non négociable"
 * 2. Produit rare — recherche d'un produit difficile à trouver
 * 3. Données contradictoires — même produit avec infos conflictuelles
 * 4. Langue française — patterns NL français correctement parsés
 * 5. Critère UNKNOWN ≠ négatif — données manquantes ne pénalisent pas
 * 6. Override temporaire — ne modifie pas le profil permanent
 * 7. Multiple marchands — même offre, marchands différents
 * 8. Critère interdit — filtre dur avant classement
 */

import {
  CapucineEngine,
  createSearchRequest,
  createEmptyProfile,
  SearchRequest,
} from '../../src/application/capucine-engine';
import {
  DiscoveryOrchestrator,
  IDiscoveryStrategy,
  DiscoveryCriteria,
  DiscoveryResult,
} from '../../src/application/discovery';
import { Offer, DataPoint, Merchant, UserProfile, PreferenceCriterion } from '../../src/domain/types';
import { ProfileOverride } from '../../src/domain/profile';

// ============================================================================
// HELPERS
// ============================================================================

function dp<T>(value: T, source = 'test'): DataPoint<T> {
  return { value, status: 'known', provenance: { source, retrievedAt: new Date() } };
}

function unknownDp(): DataPoint<null> {
  return { value: null, status: 'unknown' };
}

function contradictoryDp<T>(value: T, conflicting: T[]): DataPoint<T> {
  return {
    value,
    status: 'contradictory',
    conflictingValues: conflicting,
    provenance: { source: 'multiple', retrievedAt: new Date() },
  };
}

function merchant(id: string, name: string): Merchant {
  return { id, name, country: 'FR', executionCapabilities: [] };
}

function offer(id: string, m: Merchant, price: number | null, chars: Record<string, DataPoint<unknown>> = {}): Offer {
  return {
    id,
    productId: `product-${id}`,
    merchant: m,
    price: price !== null ? dp(price) : (unknownDp() as unknown as DataPoint<number>),
    currency: 'EUR',
    shippingCost: dp(0),
    characteristics: chars,
    provenance: { source: 'test', retrievedAt: new Date() },
    createdAt: new Date(),
    retrievedAt: new Date(),
  };
}

function engineWithOffers(offers: Offer[]): CapucineEngine {
  const strategy: IDiscoveryStrategy = {
    name: 'scenario',
    version: '1.0.0',
    isReady: true,
    async discover(_c: DiscoveryCriteria): Promise<DiscoveryResult> {
      return makeResult(_c, offers);
    },
    discoverSync(_c: DiscoveryCriteria): DiscoveryResult {
      return makeResult(_c, offers);
    },
    async health() { return { status: 'healthy' }; },
  };
  const orch = new DiscoveryOrchestrator();
  orch.registerStrategy(strategy, true);
  return new CapucineEngine({ discoveryOrchestrator: orch });
}

function makeResult(criteria: DiscoveryCriteria, offers: Offer[]): DiscoveryResult {
  return {
    id: `scen-${Date.now()}`,
    timestamp: new Date(),
    criteria,
    candidates: offers.map((o, i) => ({ offer: o, matchScore: 1 - i * 0.001 })),
    statistics: { queriedSources: 1, candidatesFound: offers.length, candidatesFiltered: 0, searchTimeMs: 0, relevanceEstimate: 'high' },
    strategy: 'scenario',
  };
}

// ============================================================================
// SCENARIO 1: Budget strict
// ============================================================================

describe('Scénario: Budget strict', () => {
  const casque1 = offer('c1', merchant('shop1', 'AudioPlus'), 280, { quality: dp(90) });
  const casque2 = offer('c2', merchant('shop2', 'SoundMax'), 320, { quality: dp(95) }); // hors budget
  const casque3 = offer('c3', merchant('shop3', 'BudgetAudio'), 250, { quality: dp(70) });

  test('Budget 300€ strict — offre à 320€ exclue même si meilleure qualité', () => {
    const criteria: PreferenceCriterion[] = [
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 300, currency: 'EUR' } },
      { id: 'quality', name: 'Qualité', level: 'important', parameters: { targetValue: 90 } },
    ];

    const engine = engineWithOffers([casque1, casque2, casque3]);
    const result = engine.searchSync(createSearchRequest('casque bluetooth', criteria));

    // casque2 (320€) must be rejected — REQUIRED budget constraint
    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).not.toContain('c2');
    expect(result.admissibility.rejectedOffers.some(r => r.offer.id === 'c2')).toBe(true);

    // casque1 and casque3 must pass
    expect(rankedIds).toContain('c1');
    expect(rankedIds).toContain('c3');

    // casque1 ranks higher than casque3 (better quality score)
    const pos1 = rankedIds.indexOf('c1');
    const pos3 = rankedIds.indexOf('c3');
    expect(pos1).toBeLessThan(pos3);
  });

  test('Budget strict — aucun ajustement silencieux (Invariant 5)', () => {
    const criteria: PreferenceCriterion[] = [
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 200 } },
    ];

    // All offers above 200€
    const expensiveOffers = [
      offer('e1', merchant('m1', 'M1'), 250),
      offer('e2', merchant('m2', 'M2'), 300),
    ];

    const engine = engineWithOffers(expensiveOffers);
    const result = engine.searchSync(createSearchRequest('casque', criteria));

    // Capucine must NOT silently raise the budget to show results
    expect(result.ranking.rankedOffers.length).toBe(0);

    // There should be a no-results diagnosis
    expect(result.noResultsDiagnosis).toBeDefined();
    expect(result.noResultsDiagnosis!.primaryCause).toBe('budget_too_strict');

    // Recovery options require user confirmation
    for (const option of result.noResultsDiagnosis!.recoveryOptions) {
      expect(option.requiresUserConfirmation).toBe(true);
    }
  });
});

// ============================================================================
// SCENARIO 2: Produit rare
// ============================================================================

describe('Scénario: Produit rare', () => {
  test('Produit rare (1 seul résultat) — doit quand même être classé correctement', () => {
    const fairphone = offer('fairphone-5', merchant('fairphone', 'Fairphone'), 699, {
      repairability: dp(9.3),
      battery: dp(4000),
      eco_score: dp(85),
    });

    const criteria: PreferenceCriterion[] = [
      { id: 'repairability', name: 'Réparabilité', level: 'very_important', parameters: { targetValue: 9 } },
    ];

    const engine = engineWithOffers([fairphone]);
    const result = engine.searchSync(createSearchRequest('smartphone réparable', criteria));

    // Must not return 0 results
    expect(result.ranking.rankedOffers.length).toBe(1);
    expect(result.ranking.rankedOffers[0].offer.id).toBe('fairphone-5');

    // Must have a valid score (not penalized for being the only candidate)
    expect(result.ranking.rankedOffers[0].overallScore).toBeGreaterThan(0);
  });

  test('Produit rare vs produit commun — qualité seule détermine le rang', () => {
    const rareHighQuality = offer('rare-hq', merchant('niche', 'Niche Boutique'), 500, {
      repairability: dp(9.5),
      autonomie: dp(50),
    });
    const commonLowQuality = offer('common-lq', merchant('amazon', 'Amazon'), 350, {
      repairability: dp(3.0),
      autonomie: dp(20),
    });

    const criteria: PreferenceCriterion[] = [
      { id: 'repairability', name: 'Réparabilité', level: 'very_important', parameters: { targetValue: 9 } },
      { id: 'autonomie', name: 'Autonomie', level: 'important', parameters: { targetValue: 40 } },
    ];

    const engine = engineWithOffers([commonLowQuality, rareHighQuality]); // common listed first
    const result = engine.searchSync(createSearchRequest('smartphone', criteria));

    // Rare high-quality must rank #1 despite being listed second
    expect(result.ranking.rankedOffers[0].offer.id).toBe('rare-hq');
    expect(result.ranking.rankedOffers[1].offer.id).toBe('common-lq');
  });
});

// ============================================================================
// SCENARIO 3: Données contradictoires
// ============================================================================

describe('Scénario: Données contradictoires', () => {
  test('Garantie contradictoire — informations conservées, produit toujours classé', () => {
    const thinkpad = offer('thinkpad-x1', merchant('lenovo', 'Lenovo'), 1299, {
      ram: dp(16),
      storage: dp(512),
      // Contradictory warranty between manufacturer and retailer
      warranty: contradictoryDp('2 ans', ['1 an', '3 ans']),
    });

    const criteria: PreferenceCriterion[] = [
      { id: 'ram', name: 'RAM', level: 'required', parameters: { minValue: 16 } },
      { id: 'storage', name: 'Stockage', level: 'important', parameters: { targetValue: 512 } },
    ];

    const engine = engineWithOffers([thinkpad]);
    const result = engine.searchSync(createSearchRequest('ordinateur portable', criteria));

    // Must not be excluded due to contradictory data
    expect(result.ranking.rankedOffers.length).toBe(1);

    // Score must be positive — contradiction is not treated as a missing value penalty
    expect(result.ranking.rankedOffers[0].overallScore).toBeGreaterThan(0);
  });

  test('Produit avec données UNKNOWN — pas pénalisé (Invariant 5: UNKNOWN ≠ négatif)', () => {
    const offerWithData = offer('with-data', merchant('m1', 'M1'), 200, {
      battery: dp(30),
      weight: dp(300),
    });
    const offerPartialUnknown = offer('partial-unknown', merchant('m2', 'M2'), 200, {
      battery: dp(30),
      weight: unknownDp(),   // weight unknown, but battery is same
    });

    const criteria: PreferenceCriterion[] = [
      { id: 'battery', name: 'Autonomie', level: 'very_important', parameters: { targetValue: 30 } },
      { id: 'weight', name: 'Poids', level: 'preference', parameters: { maxValue: 300 } },
    ];

    const engine = engineWithOffers([offerWithData, offerPartialUnknown]);
    const result = engine.searchSync(createSearchRequest('casque', criteria));

    // Both should appear in results
    const ranked = result.ranking.rankedOffers;
    expect(ranked.length).toBe(2);

    // The unknown weight should not cause a heavy penalty —
    // UNKNOWN is treated neutrally, not as a failure
    const scoreUnknown = ranked.find(r => r.offer.id === 'partial-unknown')!.overallScore;
    const scoreKnown = ranked.find(r => r.offer.id === 'with-data')!.overallScore;

    // Score with unknown data should be >= 0 (not negative)
    expect(scoreUnknown).toBeGreaterThanOrEqual(0);

    // Score difference should be reasonable (not a massive penalty)
    // The battery score (very_important, same) dominates — delta should be small
    expect(Math.abs(scoreKnown - scoreUnknown)).toBeLessThan(50);
  });
});

// ============================================================================
// SCENARIO 4: Parsing français
// ============================================================================

describe('Scénario: Langue française — parsing NL', () => {
  /**
   * These tests verify that BasicPatternInterpreter correctly parses French queries
   * when wired into CapucineEngine (no preInterpretedCriteria provided).
   */

  test('"je cherche un casque bluetooth moins de 200€" → budget extrait', async () => {
    const casque99 = offer('c99', merchant('shop', 'Shop'), 99, { type: dp('bluetooth') });
    const casque199 = offer('c199', merchant('shop2', 'Shop2'), 199, { type: dp('bluetooth') });
    const casque299 = offer('c299', merchant('shop3', 'Shop3'), 299, { type: dp('bluetooth') });

    const engine = engineWithOffers([casque99, casque199, casque299]);

    // No preInterpretedCriteria — engine must parse the French query
    const profile = createEmptyProfile('user-1');
    const request: SearchRequest = {
      queryText: 'je cherche un casque bluetooth moins de 200€',
      requestId: 'test-fr-budget',
      profile,
      skipAIInterpretation: false, // let BasicPatternInterpreter run
    };

    const result = await engine.search(request);

    // Interpreter should have run (interpretedRequest present)
    expect(result.interpretedRequest).toBeDefined();

    // Budget should have been extracted
    const budgetCriterion = result.interpretedRequest!.extractedCriteria.find(
      c => c.id === 'budget' || c.id.includes('budget')
    );
    expect(budgetCriterion).toBeDefined();
    expect(budgetCriterion!.parameters?.maxBudget).toBe(200);

    // casque299 must be rejected (over budget)
    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).not.toContain('c299');
  });

  test('"budget de 500€" → budget extrait (variante française)', async () => {
    const engine = engineWithOffers([
      offer('cheap', merchant('m', 'M'), 400),
      offer('expensive', merchant('m2', 'M2'), 600),
    ]);

    const profile = createEmptyProfile('user-2');
    const result = await engine.search({
      queryText: 'ordinateur portable budget de 500€',
      requestId: 'test-fr-budget2',
      profile,
      skipAIInterpretation: false,
    });

    expect(result.interpretedRequest).toBeDefined();
    const budget = result.interpretedRequest!.extractedCriteria.find(
      c => c.parameters?.maxBudget !== undefined
    );
    expect(budget?.parameters?.maxBudget).toBe(500);
  });

  test('"casque bluetooth pas trop cher" → ambiguïté budget détectée', async () => {
    const engine = engineWithOffers([offer('c1', merchant('m1', 'M1'), 150)]);

    const profile = createEmptyProfile('user-3');
    const result = await engine.search({
      queryText: 'casque bluetooth pas trop cher',
      requestId: 'test-fr-vague',
      profile,
      skipAIInterpretation: false,
    });

    expect(result.interpretedRequest).toBeDefined();
    // Should detect vague budget ambiguity
    expect(result.interpretedRequest!.ambiguities.length).toBeGreaterThan(0);
    const budgetAmb = result.interpretedRequest!.ambiguities.find(
      a => a.ambiguityType === 'budget_flexibility'
    );
    expect(budgetAmb).toBeDefined();
  });

  test('"impérativement bluetooth" → critère required extrait', async () => {
    const engine = engineWithOffers([offer('c1', merchant('m1', 'M1'), 150, { bluetooth: dp(true) })]);

    const profile = createEmptyProfile('user-4');
    const result = await engine.search({
      queryText: 'casque impérativement bluetooth autonomie 30h',
      requestId: 'test-fr-req',
      profile,
      skipAIInterpretation: false,
    });

    expect(result.interpretedRequest).toBeDefined();
    // Should extract a required criterion for bluetooth
    const requiredCriteria = result.interpretedRequest!.extractedCriteria.filter(
      c => c.level === 'required'
    );
    expect(requiredCriteria.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// SCENARIO 5: Override temporaire (Invariant 5)
// ============================================================================

describe('Scénario: Override temporaire', () => {
  test('Override ne modifie pas le profil permanent', async () => {
    const profile: UserProfile = {
      userId: 'user-permanent',
      preferences: {
        criteria: [
          { id: 'eco_score', name: 'Score éco', level: 'very_important', parameters: { targetValue: 80 } },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const engine = engineWithOffers([
      offer('eco', merchant('m1', 'M1'), 200, { eco_score: dp(85) }),
      offer('noeco', merchant('m2', 'M2'), 200, { eco_score: dp(20) }),
    ]);

    const criteria: PreferenceCriterion[] = [];
    const override: ProfileOverride = {
      criterionId: 'eco_score',
      temporaryLevel: 'low',
      reason: 'Recherche urgente, pas le temps de chercher écolo',
      source: 'explicit_user',
      createdAt: new Date(),
    };

    // Search with override
    const withOverride = engine.searchSync({
      queryText: 'casque',
      requestId: 'override-req',
      profile,
      preInterpretedCriteria: criteria,
      overrides: [override],
    });

    // Search without override (same profile)
    const withoutOverride = engine.searchSync({
      queryText: 'casque',
      requestId: 'no-override-req',
      profile,
      preInterpretedCriteria: criteria,
    });

    // Profile must not be mutated by the override
    expect(profile.preferences.criteria[0].level).toBe('very_important');

    // Both results should be valid (engine ran)
    expect(withOverride.ranking).toBeDefined();
    expect(withoutOverride.ranking).toBeDefined();
  });
});

// ============================================================================
// SCENARIO 6: Critère interdit (hard gate)
// ============================================================================

describe('Scénario: Critère interdit', () => {
  test('Offre d\'un marchand interdit — filtrée avant classement', () => {
    const blacklistedOffer = offer('bad', merchant('blacklisted-seller', 'Blacklisted Seller'), 100, {
      quality: dp(99), // excellent quality — but forbidden merchant
    });
    const goodOffer = offer('good', merchant('trusted-shop', 'Trusted Shop'), 150, {
      quality: dp(70),
    });

    const criteria: PreferenceCriterion[] = [
      {
        id: 'merchant-blacklisted-seller',
        name: 'Marchand interdit',
        level: 'forbidden',
        parameters: { merchantId: 'blacklisted-seller' },
      },
      { id: 'quality', name: 'Qualité', level: 'important', parameters: { targetValue: 80 } },
    ];

    const engine = engineWithOffers([blacklistedOffer, goodOffer]);
    const result = engine.searchSync(createSearchRequest('casque', criteria));

    // Forbidden offer must be rejected — NEVER ranked
    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).not.toContain('bad');

    // Must appear in rejected offers
    expect(result.admissibility.rejectedOffers.some(r => r.offer.id === 'bad')).toBe(true);

    // Good offer must rank
    expect(rankedIds).toContain('good');
  });
});

// ============================================================================
// SCENARIO 7: Pipeline timing & transparency
// ============================================================================

describe('Scénario: Transparence du pipeline', () => {
  test('Toutes les étapes de timing sont renseignées', () => {
    const engine = engineWithOffers([
      offer('t1', merchant('m1', 'M1'), 200, { quality: dp(80) }),
    ]);
    const result = engine.searchSync(createSearchRequest('casque', [
      { id: 'quality', name: 'Qualité', level: 'important', parameters: { targetValue: 80 } },
    ]));

    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.discoveryMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.rankingMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.admissibilityMs).toBeGreaterThanOrEqual(0);
  });

  test('requestId est propagé dans toutes les parties du résultat', () => {
    const engine = engineWithOffers([offer('p1', merchant('m1', 'M1'), 200)]);
    const result = engine.searchSync({
      queryText: 'casque',
      requestId: 'my-trace-id',
      profile: createEmptyProfile(),
      preInterpretedCriteria: [],
    });

    expect(result.requestId).toBe('my-trace-id');
    expect(result.ranking.requestId).toBe('my-trace-id');
    expect(result.explanation.requestId).toBe('my-trace-id');
    expect(result.clarifications.requestId).toBe('my-trace-id');
  });

  test('effectiveCriteria contient les critères réellement utilisés', () => {
    const profileCriteria: PreferenceCriterion[] = [
      { id: 'eco_score', name: 'Score éco', level: 'preference', parameters: { targetValue: 80 } },
    ];
    const requestCriteria: PreferenceCriterion[] = [
      { id: 'battery', name: 'Autonomie', level: 'important', parameters: { targetValue: 30 } },
    ];

    const profile: UserProfile = {
      userId: 'user-merge',
      preferences: { criteria: profileCriteria, createdAt: new Date(), updatedAt: new Date() },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const engine = engineWithOffers([offer('o1', merchant('m1', 'M1'), 200)]);
    const result = engine.searchSync({
      queryText: 'casque',
      requestId: 'test-merge',
      profile,
      preInterpretedCriteria: requestCriteria,
    });

    // effectiveCriteria must contain merged criteria from both profile and request
    const criteriaIds = result.effectiveCriteria.map(c => c.id);
    expect(criteriaIds).toContain('battery');    // from request
    expect(criteriaIds).toContain('eco_score');  // from profile
  });
});
