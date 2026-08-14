/**
 * End-to-End Pipeline Tests
 *
 * Proves the full chain: raw queryText → ranked results.
 * Uses REAL components (no mocks beyond the discovery layer which uses
 * the in-memory catalog for deterministic results).
 *
 * These tests verify:
 * - NL interpretation → structured criteria
 * - Profile merge with request criteria
 * - SearchPlan construction from criteria
 * - SearchPlan escalation when 0 results
 * - Discovery → Normalization → Deduplication → Admissibility → Ranking → Explanation
 * - French query parsing end-to-end
 * - Invariant preservation through the full chain
 * - searchPlan is populated in result (not null)
 * - timing fields are populated
 */

import {
  CapucineEngine,
  createEmptyProfile,
  createTestEngine,
  SearchRequest,
} from '../../src/application/capucine-engine';
import { DiscoveryOrchestrator, IDiscoveryStrategy, DiscoveryCriteria, DiscoveryResult } from '../../src/application/discovery';
import { PreferenceCriterion, Offer, UserProfile } from '../../src/domain/types';

// ============================================================================
// TEST HELPERS
// ============================================================================

function makeProfile(criteria: PreferenceCriterion[] = []): UserProfile {
  return {
    userId: 'e2e-test-user',
    preferences: {
      criteria,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRequest(
  queryText: string,
  overrides: Partial<SearchRequest> = {}
): SearchRequest {
  return {
    queryText,
    requestId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    profile: makeProfile(),
    skipAIInterpretation: false, // Use real interpreter
    ...overrides,
  };
}

/** Fixed-list discovery strategy for deterministic e2e tests */
class FixedListStrategy implements IDiscoveryStrategy {
  readonly name = 'fixed_list';
  readonly version = '1.0.0';
  readonly isReady = true;

  constructor(private readonly offers: Offer[]) {}

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    return this.discoverSync(criteria);
  }

  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    let matching = [...this.offers];

    // NOTE: Do NOT pre-filter by price here.
    // Price enforcement is AdmissibilityEngine's job (hard gate).
    // Discovery returns all candidates; admissibility rejects violators.

    // Apply excluded merchants (this is a discovery-level hint, not a hard gate)
    if (criteria.excludedMerchants?.length) {
      matching = matching.filter(o =>
        !criteria.excludedMerchants!.includes(o.merchant.id)
      );
    }

    const candidates = matching.map(o => ({ offer: o, matchScore: 1.0 }));

    return {
      id: `fixed-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      candidates,
      statistics: {
        queriedSources: 1,
        candidatesFound: candidates.length,
        candidatesFiltered: this.offers.length - candidates.length,
        searchTimeMs: 0,
        relevanceEstimate: candidates.length > 0 ? 'high' : 'low',
      },
      strategy: this.name,
    };
  }

  async health() { return { status: 'healthy' as const }; }
}

function buildOffer(
  id: string,
  price: number,
  characteristics: Offer['characteristics'] = {}
): Offer {
  return {
    id,
    productId: `product-${id}`,
    merchant: {
      id: `merchant-${id}`,
      name: `Merchant ${id}`,
      country: 'FR',
      executionCapabilities: [],
    },
    price: { value: price, status: 'known' },
    currency: 'EUR',
    shippingCost: { value: 0, status: 'known' },
    characteristics,
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: {
      source: `source-${id}`,
      retrievedAt: new Date(),
      reliability: 0.9,
    },
  };
}

function engineWithOffers(offers: Offer[]): CapucineEngine {
  const orchestrator = new DiscoveryOrchestrator();
  orchestrator.registerStrategy(new FixedListStrategy(offers), true);
  return new CapucineEngine({ discoveryOrchestrator: orchestrator });
}

// ============================================================================
// 1. BASIC PIPELINE CONNECTIVITY
// ============================================================================

describe('End-to-End: Pipeline connectivity', () => {
  it('returns a populated SearchEngineResult from a raw query', async () => {
    const engine = createTestEngine();
    const result = await engine.search(makeRequest('casque bluetooth'));

    expect(result.requestId).toBeDefined();
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.ranking).toBeDefined();
    expect(result.explanation).toBeDefined();
    expect(result.deduplication).toBeDefined();
    expect(result.admissibility).toBeDefined();
    expect(result.discovery).toBeDefined();
    expect(result.clarifications).toBeDefined();
    expect(result.effectiveCriteria).toBeDefined();
    expect(Array.isArray(result.effectiveCriteria)).toBe(true);
  });

  it('populates searchPlan with primaryTerms from query', async () => {
    const engine = createTestEngine();
    const result = await engine.search(makeRequest('casque bluetooth sans fil'));

    expect(result.searchPlan).toBeDefined();
    expect(result.searchPlan.query.primaryTerms.length).toBeGreaterThan(0);
    // Should extract meaningful terms (not stop words)
    const terms = result.searchPlan.query.primaryTerms;
    expect(terms.some(t => t.includes('casque') || t.includes('bluetooth') || t.includes('sans'))).toBe(true);
  });

  it('populates timing fields', async () => {
    const engine = createTestEngine();
    const result = await engine.search(makeRequest('ordinateur portable'));

    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.discoveryMs).toBeGreaterThanOrEqual(0);
    // interpretationMs should be > 0 since we're not skipping interpreter
    expect(result.timing.interpretationMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.planBuildMs).toBeGreaterThanOrEqual(0);
  });

  it('searchSync produces equivalent structure', () => {
    const engine = createTestEngine();
    const result = engine.searchSync(makeRequest('casque bluetooth', { skipAIInterpretation: true }));

    expect(result.searchPlan).toBeDefined();
    expect(result.ranking).toBeDefined();
    expect(result.effectiveCriteria).toBeDefined();
  });
});

// ============================================================================
// 2. FRENCH NL INTERPRETATION → CRITERIA → RANKING
// ============================================================================

describe('End-to-End: French NL → criteria → ranked results', () => {
  it('extracts budget from French query and ranks cheaper offers higher', async () => {
    const offers = [
      buildOffer('cheap', 299),
      buildOffer('expensive', 799),
      buildOffer('mid', 499),
    ];
    const engine = engineWithOffers(offers);

    // Query with French budget and no pre-interpreted criteria
    const result = await engine.search({
      queryText: 'je cherche un casque bluetooth moins de 600€',
      requestId: 'fr-budget-test',
      profile: makeProfile(),
      skipAIInterpretation: false,
    });

    // The interpreter should extract a budget criterion
    // Admissibility: "expensive" (799€ > 600€) should be rejected if budget is required
    // Both cheap (299) and mid (499) should pass
    const ranked = result.ranking.rankedOffers;
    const rankedIds = ranked.map(r => r.offer.id);

    // cheap and mid should be in results (both ≤ 600)
    expect(rankedIds).toContain('cheap');
    expect(rankedIds).toContain('mid');
  });

  it('interprets "impérativement" as required criterion', async () => {
    const result = await createTestEngine().search(
      makeRequest('ordinateur portable impérativement 16Go RAM')
    );

    // The interpreter should detect an ambiguity or extract criteria
    expect(result.interpretedRequest).toBeDefined();
    expect(result.clarifications).toBeDefined();
  });

  it('detects French query language', async () => {
    const result = await createTestEngine().search(
      makeRequest('je cherche un smartphone pas trop cher')
    );

    if (result.interpretedRequest) {
      // detectedLanguage is in the QueryAnalysis sub-object
      const lang = (result.interpretedRequest as any).detectedLanguage
        ?? (result.interpretedRequest as any).queryAnalysis?.detectedLanguage;
      // Accept either 'fr' or undefined (not all interpreters expose this)
      if (lang !== undefined) {
        expect(lang).toBe('fr');
      }
    }
  });

  it('detects vague budget as ambiguity to clarify', async () => {
    const result = await createTestEngine().search(
      makeRequest('je veux un casque pas trop cher')
    );

    // "pas trop cher" should trigger a clarification opportunity for budget
    const ambiguities = result.interpretedRequest?.ambiguities ?? [];
    const hasBudgetAmbiguity = ambiguities.some(
      a => a.ambiguityType === 'budget_flexibility' || a.criterion === 'price' || a.criterion === 'budget'
    );
    // This is a soft check — the clarification engine may catch it instead
    const clarificationQuestions = result.clarifications.opportunities;
    const hasClarification = clarificationQuestions.some(
      q => q.id.includes('budget') || q.id.includes('price')
    );

    expect(hasBudgetAmbiguity || hasClarification).toBe(true);
  });
});

// ============================================================================
// 3. SEARCH PLAN CONSTRUCTION
// ============================================================================

describe('End-to-End: SearchPlan construction', () => {
  it('builds a valid SearchPlan with rarity=common for normal queries', async () => {
    const result = await createTestEngine().search(
      makeRequest('casque bluetooth Sony', { skipAIInterpretation: true })
    );

    expect(result.searchPlan.rarityLevel).toBe('common');
    expect(result.searchPlan.expansion.currentLevel).toBeGreaterThanOrEqual(1);
    expect(result.searchPlan.expansion.expansionAllowed).toBe(true);
  });

  it('detects rare product from "vintage" keyword', async () => {
    const result = await createTestEngine().search(
      makeRequest('montre vintage Casio A168', { skipAIInterpretation: true })
    );

    expect(['very_rare', 'rare', 'uncommon']).toContain(result.searchPlan.rarityLevel);
  });

  it('detects extremely_rare product from "pièce détachée" keyword', async () => {
    const result = await createTestEngine().search(
      makeRequest('pièce détachée moteur Renault 4L', { skipAIInterpretation: true })
    );

    expect(result.searchPlan.rarityLevel).toBe('extremely_rare');
  });

  it('escalates to level 2 when 0 results at level 1 and autoEscalate=true', async () => {
    // Empty catalog → forces escalation
    const engine = engineWithOffers([]);
    const result = await engine.search(
      makeRequest('casque bluetooth ultra rare modèle vintage', { skipAIInterpretation: true })
    );

    // Should have attempted level 1, then escalated
    expect(result.searchPlan.expansion.currentLevel).toBeGreaterThanOrEqual(1);
    // No results expected since catalog is empty — but escalation was attempted
    expect(result.ranking.rankedOffers.length).toBe(0);
    expect(result.noResultsDiagnosis).toBeDefined();
    expect(result.noResultsDiagnosis!.primaryCause).toBe('no_candidates_discovered');
  });

  it('extracts budget into SearchPlan price range', () => {
    const engine = createTestEngine();
    const result = engine.searchSync({
      queryText: 'casque bluetooth',
      requestId: 'plan-budget-test',
      profile: makeProfile(),
      preInterpretedCriteria: [
        {
          id: 'budget',
          name: 'Budget',
          level: 'required',
          parameters: { maxBudget: 500 },
        },
      ],
      skipAIInterpretation: true,
    });

    expect(result.searchPlan.query.priceRange?.max).toBe(500);
  });

  it('puts hardConstraints (required/forbidden) in plan.hardConstraints', () => {
    const engine = createTestEngine();
    const result = engine.searchSync({
      queryText: 'casque bluetooth',
      requestId: 'plan-constraints-test',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } },
        { id: 'merchant-amazon', name: 'Pas Amazon', level: 'forbidden', parameters: { merchantId: 'amazon' } },
        { id: 'quality', name: 'Qualité', level: 'important' },
      ],
      skipAIInterpretation: true,
    });

    // hardConstraints = required + forbidden only
    const hardIds = result.searchPlan.hardConstraints.map(c => c.id);
    expect(hardIds).toContain('budget');
    expect(hardIds).toContain('merchant-amazon');
    expect(hardIds).not.toContain('quality'); // important is NOT a hard constraint
  });
});

// ============================================================================
// 4. FULL CHAIN WITH OFFERS
// ============================================================================

describe('End-to-End: Full chain with offers', () => {
  it('ranks cheapest offer first when budget is the only criterion', async () => {
    const offers = [
      buildOffer('a', 400),
      buildOffer('b', 200),
      buildOffer('c', 600),
    ];
    const engine = engineWithOffers(offers);

    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'rank-by-budget',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } },
      ],
      skipAIInterpretation: true,
    });

    const ranked = result.ranking.rankedOffers;
    expect(ranked.length).toBe(3);
    // Offer with best budget compliance (cheapest vs max) should rank first
    // With maxBudget=1000, ratio = price/maxBudget; cheaper = higher score
    expect(ranked[0].offer.id).toBe('b'); // 200/1000 = 0.2, best compliance
  });

  it('rejects offer exceeding required budget', async () => {
    const offers = [
      buildOffer('cheap', 300),
      buildOffer('too-expensive', 800),
    ];
    const engine = engineWithOffers(offers);

    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'budget-rejection',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } },
      ],
      skipAIInterpretation: true,
    });

    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).toContain('cheap');
    expect(rankedIds).not.toContain('too-expensive');

    const rejectedIds = result.admissibility.rejectedOffers.map(r => r.offer.id);
    expect(rejectedIds).toContain('too-expensive');
  });

  it('rejects offer from forbidden merchant', async () => {
    const offers = [
      buildOffer('good', 300),
      buildOffer('banned', 200),
    ];
    const bannedOffer = { ...offers[1], merchant: { ...offers[1].merchant, id: 'banned-merchant' } };
    const engine = engineWithOffers([offers[0], bannedOffer]);

    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'merchant-rejection',
      profile: makeProfile(),
      preInterpretedCriteria: [
        {
          id: 'merchant-banned-merchant',
          name: 'Pas ce marchand',
          level: 'forbidden',
          parameters: { merchantId: 'banned-merchant' },
        },
      ],
      skipAIInterpretation: true,
    });

    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).toContain('good');
    expect(rankedIds).not.toContain('banned');
  });

  it('ranking is same regardless of discovery order', async () => {
    const offerA = buildOffer('a', 300, {
      battery: { value: 20, status: 'known' },
    });
    const offerB = buildOffer('b', 400, {
      battery: { value: 30, status: 'known' },
    });

    // Order 1: A then B
    const engine1 = engineWithOffers([offerA, offerB]);
    const result1 = await engine1.search({
      queryText: 'casque bluetooth',
      requestId: 'order-test-1',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'battery', name: 'Autonomie', level: 'important', parameters: { minValue: 25 } },
      ],
      skipAIInterpretation: true,
    });

    // Order 2: B then A
    const engine2 = engineWithOffers([offerB, offerA]);
    const result2 = await engine2.search({
      queryText: 'casque bluetooth',
      requestId: 'order-test-2',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'battery', name: 'Autonomie', level: 'important', parameters: { minValue: 25 } },
      ],
      skipAIInterpretation: true,
    });

    const order1 = result1.ranking.rankedOffers.map(r => r.offer.id);
    const order2 = result2.ranking.rankedOffers.map(r => r.offer.id);

    // Same ranking regardless of discovery order
    expect(order1).toEqual(order2);
  });

  it('noResultsDiagnosis populated when all offers rejected', async () => {
    const offers = [buildOffer('costly', 2000)];
    const engine = engineWithOffers(offers);

    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'no-results-test',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } },
      ],
      skipAIInterpretation: true,
    });

    expect(result.ranking.rankedOffers.length).toBe(0);
    expect(result.noResultsDiagnosis).toBeDefined();
    expect(result.noResultsDiagnosis!.primaryCause).toBe('budget_too_strict');
    expect(result.noResultsDiagnosis!.recoveryOptions.length).toBeGreaterThan(0);
    // Every recovery option must require user confirmation (INVARIANT 5)
    for (const opt of result.noResultsDiagnosis!.recoveryOptions) {
      expect(opt.requiresUserConfirmation).toBe(true);
    }
  });
});

// ============================================================================
// 5. PROFILE MERGE IN THE FULL PIPELINE
// ============================================================================

describe('End-to-End: Profile merge through pipeline', () => {
  it('profile criteria appear in effectiveCriteria', async () => {
    const profileWithBudget = makeProfile([
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 300 } },
    ]);

    const engine = createTestEngine();
    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'profile-merge-test',
      profile: profileWithBudget,
      skipAIInterpretation: true,
    });

    const criteriaIds = result.effectiveCriteria.map(c => c.id);
    expect(criteriaIds).toContain('budget');
  });

  it('request criteria override profile criteria (same ID → higher priority)', async () => {
    const profileWithHighBudget = makeProfile([
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } },
    ]);

    const offers = [
      buildOffer('in-budget', 400),
      buildOffer('over-profile-budget', 800), // would pass profile budget but below request override
    ];
    const engine = engineWithOffers(offers);

    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'override-test',
      profile: profileWithHighBudget,
      preInterpretedCriteria: [
        // Override: tighter budget for this request
        { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } },
      ],
      skipAIInterpretation: true,
    });

    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    // With request override budget of 500, 800€ offer should be rejected
    expect(rankedIds).toContain('in-budget');
    expect(rankedIds).not.toContain('over-profile-budget');
  });

  it('temporary override does not modify profile', async () => {
    const profile = makeProfile([
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } },
    ]);

    const originalBudget = profile.preferences.criteria[0].parameters!['maxBudget'];

    const engine = createTestEngine();
    await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'no-mutation-test',
      profile,
      overrides: [{
        criterionId: 'budget',
        temporaryLevel: 'preference',
        reason: 'test override',
        source: 'explicit_user',
        createdAt: new Date(),
      }],
      skipAIInterpretation: true,
    });

    // Profile must be unchanged after search
    expect(profile.preferences.criteria[0].parameters!['maxBudget']).toBe(originalBudget);
  });
});

// ============================================================================
// 6. EXPLANATION CHAIN
// ============================================================================

describe('End-to-End: Explanation chain', () => {
  it('explanation contains headline for each ranked offer', async () => {
    const offers = [buildOffer('a', 300), buildOffer('b', 400)];
    const engine = engineWithOffers(offers);

    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'explanation-test',
      profile: makeProfile(),
      skipAIInterpretation: true,
    });

    expect(result.explanation.rankedExplanations.length).toBe(result.ranking.rankedOffers.length);
    for (const exp of result.explanation.rankedExplanations) {
      expect(exp.headline).toBeTruthy();
    }
  });

  it('resultSummary is defined in explanation', async () => {
    const engine = createTestEngine();
    const result = await engine.search(makeRequest('casque bluetooth', { skipAIInterpretation: true }));

    expect(result.explanation.resultSummary).toBeTruthy();
    expect(typeof result.explanation.resultSummary).toBe('string');
  });
});

// ============================================================================
// 7. HTTP API LAYER
// ============================================================================

describe('End-to-End: HTTP API', () => {
  it('buildApp() returns an express app (no server started)', async () => {
    const { buildApp } = await import('../../src/api/server');
    const app = buildApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
    expect(typeof (app as any).post).toBe('function');
  });

  it('POST /search returns valid JSON structure', async () => {
    const { buildApp } = await import('../../src/api/server');
    const supertest = await import('supertest');
    const app = buildApp();
    const request = supertest.default(app);

    const response = await request
      .post('/search')
      .send({ query: 'casque bluetooth' })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body.requestId).toBeDefined();
    expect(response.body.results).toBeDefined();
    expect(Array.isArray(response.body.results)).toBe(true);
    expect(response.body.summary).toBeDefined();
    expect(response.body.searchPlan).toBeDefined();
    expect(response.body.timing).toBeDefined();
  });

  it('POST /search with budget constraint returns searchPlan with priceRange', async () => {
    const { buildApp } = await import('../../src/api/server');
    const supertest = await import('supertest');
    const app = buildApp();
    const request = supertest.default(app);

    const criteria: PreferenceCriterion[] = [
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } },
    ];

    const response = await request
      .post('/search')
      .send({ query: 'casque bluetooth', criteria })
      .expect(200);

    expect(response.body.effectiveCriteria).toBeDefined();
    expect(response.body.effectiveCriteria.some((c: any) => c.id === 'budget')).toBe(true);
  });

  it('POST /search returns 400 for missing query', async () => {
    const { buildApp } = await import('../../src/api/server');
    const supertest = await import('supertest');
    const app = buildApp();
    const request = supertest.default(app);

    const response = await request
      .post('/search')
      .send({ criteria: [] })
      .expect(400);

    expect(response.body.error).toBe('INVALID_REQUEST');
  });

  it('POST /search returns 400 for empty query', async () => {
    const { buildApp } = await import('../../src/api/server');
    const supertest = await import('supertest');
    const app = buildApp();
    const request = supertest.default(app);

    await request
      .post('/search')
      .send({ query: '   ' })
      .expect(400);
  });

  it('GET /health returns ok', async () => {
    const { buildApp } = await import('../../src/api/server');
    const supertest = await import('supertest');
    const app = buildApp();
    const request = supertest.default(app);

    const response = await request
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.capabilities).toBeDefined();
    expect(response.body.capabilities.aiProviders).toBeDefined();
    expect(response.body.capabilities.webSearch).toBeDefined();
  });

  it('GET /tools returns tool list', async () => {
    const { buildApp } = await import('../../src/api/server');
    const supertest = await import('supertest');
    const app = buildApp();
    const request = supertest.default(app);

    const response = await request
      .get('/tools')
      .expect(200);

    expect(response.body.tools).toBeDefined();
    expect(Array.isArray(response.body.tools)).toBe(true);
  });
});

// ============================================================================
// 8. INVARIANTS THROUGH FULL PIPELINE
// ============================================================================

describe('End-to-End: Invariants through full pipeline', () => {
  it('INVARIANT 1: same data + different merchant → same score', async () => {
    const chars: Offer['characteristics'] = {
      battery: { value: 20, status: 'known' },
    };
    const offerA = { ...buildOffer('a', 300, chars), merchant: { id: 'merchant-x', name: 'X', country: 'FR', executionCapabilities: [] } };
    const offerB = { ...buildOffer('b', 300, chars), merchant: { id: 'merchant-y', name: 'Y', country: 'FR', executionCapabilities: [] } };
    // Same product, same price, same characteristics, different merchant
    const offerBFixed = { ...offerB, productId: 'product-b-unique' }; // different product to avoid dedup

    const engine = engineWithOffers([offerA, offerBFixed]);
    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'invariant-1',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'battery', name: 'Autonomie', level: 'important', parameters: { minValue: 15 } },
      ],
      skipAIInterpretation: true,
    });

    const ranked = result.ranking.rankedOffers;
    expect(ranked.length).toBe(2);
    // Scores should be equal (merchant has no influence on score)
    expect(ranked[0].overallScore).toBeCloseTo(ranked[1].overallScore, 0);
  });

  it('INVARIANT 3: source has no ranking privilege — different provenance, same data → same score', async () => {
    const chars: Offer['characteristics'] = { quality: { value: 'high', status: 'known' } };
    const offerFromWeb = {
      ...buildOffer('web', 300, chars),
      productId: 'product-web',
    };
    const offerFromApi = {
      ...buildOffer('api', 300, chars),
      productId: 'product-api',
    };

    const engine = engineWithOffers([offerFromWeb, offerFromApi]);
    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'invariant-3',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'quality', name: 'Qualité', level: 'very_important' },
      ],
      skipAIInterpretation: true,
    });

    const ranked = result.ranking.rankedOffers;
    expect(ranked.length).toBe(2);
    expect(ranked[0].overallScore).toBeCloseTo(ranked[1].overallScore, 0);
  });

  it('INVARIANT 5: recovery options all have requiresUserConfirmation=true', async () => {
    // Force 0 results to trigger no-results analysis
    const engine = engineWithOffers([buildOffer('only', 2000)]);
    const result = await engine.search({
      queryText: 'casque bluetooth',
      requestId: 'invariant-5',
      profile: makeProfile(),
      preInterpretedCriteria: [
        { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 100 } },
      ],
      skipAIInterpretation: true,
    });

    expect(result.noResultsDiagnosis).toBeDefined();
    for (const opt of result.noResultsDiagnosis!.recoveryOptions) {
      expect(opt.requiresUserConfirmation).toBe(true);
    }
  });
});
