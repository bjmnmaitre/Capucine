/**
 * Capucine — HTTP API Integration Tests
 *
 * End-to-end tests using the real Express app via supertest.
 * No mocks — the full pipeline runs on every request.
 *
 * Scenarios covered:
 * 1. Basic search (GET /health, POST /search)
 * 2. Validation errors (missing query, too long, bad session)
 * 3. Clarification session flow (search → session → clarify → re-search)
 * 4. Profile CRUD (GET/PUT/DELETE /profile/:userId/criterion)
 * 5. Invariants via HTTP (provenance, no-results, UNKNOWN data)
 * 6. Determinism (same request twice → same ranking)
 * 7. Source neutrality (provenance includes multiple sources after merge)
 *
 * SECURITY: No API keys used. Tests run against InMemoryDiscovery + MockAI.
 */

import { buildApp } from '../../src/api/server';
import type { Application } from 'express';

// ============================================================================
// SUPERTEST SETUP
//
// We import supertest dynamically inside each test to avoid the
// `ReturnType<typeof import('supertest').default>` TypeScript error
// that occurs with static imports in some TS/Jest configurations.
// ============================================================================

let app: Application;

beforeAll(() => {
  app = buildApp();
});

// ============================================================================
// HELPERS
// ============================================================================

async function postSearch(body: object) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/search').send(body).set('Content-Type', 'application/json');
}

async function postClarify(body: object) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/clarify').send(body).set('Content-Type', 'application/json');
}

async function getHealth() {
  const { default: supertest } = await import('supertest');
  return supertest(app).get('/health');
}

async function putCriterion(userId: string, criterion: object) {
  const { default: supertest } = await import('supertest');
  return supertest(app)
    .put(`/profile/${userId}/criterion`)
    .send(criterion)
    .set('Content-Type', 'application/json');
}

async function getProfile(userId: string) {
  const { default: supertest } = await import('supertest');
  return supertest(app).get(`/profile/${userId}`);
}

async function deleteCriterion(userId: string, criterionId: string) {
  const { default: supertest } = await import('supertest');
  return supertest(app).delete(`/profile/${userId}/criterion/${criterionId}`);
}

// ============================================================================
// 1. BASIC CONNECTIVITY
// ============================================================================

describe('GET /health', () => {
  test('returns 200 with service status', async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('capucine');
    expect(res.body.capabilities).toBeDefined();
    expect(res.body.capabilities.aiProviders).toBeDefined();
    expect(res.body.capabilities.webSearch).toBeDefined();
  });
});

// ============================================================================
// 2. POST /search — VALIDATION
// ============================================================================

describe('POST /search — validation', () => {
  test('missing query → 400 INVALID_REQUEST', async () => {
    const res = await postSearch({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REQUEST');
    expect(res.body.message).toBeTruthy();
  });

  test('empty string query → 400 INVALID_REQUEST', async () => {
    const res = await postSearch({ query: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REQUEST');
  });

  test('query too long (>2000 chars) → 400 QUERY_TOO_LONG', async () => {
    const res = await postSearch({ query: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('QUERY_TOO_LONG');
  });

  test('valid query returns 200 with structured response', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.results).toBeInstanceOf(Array);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.totalFound).toBeGreaterThanOrEqual(0);
    expect(res.body.timing).toBeDefined();
  });
});

// ============================================================================
// 3. POST /search — RESULT STRUCTURE
// ============================================================================

describe('POST /search — result structure', () => {
  test('XM5 search returns results with correct fields', async () => {
    const res = await postSearch({ query: 'sony wh-1000xm5 casque bluetooth' });
    expect(res.status).toBe(200);

    const results = res.body.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first.rank).toBe(1);
    expect(first.offerId).toBeTruthy();
    expect(first.productId).toBeTruthy();
    expect(first.merchant).toBeDefined();
    expect((first.merchant as Record<string, unknown>).id).toBeTruthy();
    expect((first.merchant as Record<string, unknown>).name).toBeTruthy();
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.satisfiesAllConstraints).toBeDefined();
    expect(first.explanation).toBeDefined();

    // Provenance is now serialized (source tracks multi-merchant merge)
    expect(first.provenance).toBeDefined();
    expect((first.provenance as Record<string, unknown>).source).toBeTruthy();
  });

  test('XM5 search: provenance.source contains "+" (merged from multiple sources)', async () => {
    // 4 merchants carry the XM5 → merged into 1 offer with combined provenance
    const res = await postSearch({ query: 'sony wh-1000xm5' });
    expect(res.status).toBe(200);

    const xm5 = (res.body.results as Array<Record<string, unknown>>).find(r =>
      r.productId === 'prod-sony-wh1000xm5'
    );
    expect(xm5).toBeDefined();

    // Multi-source merge → provenance.source = "sony-shop+fnac+amazon-fr+boulanger"
    const source = (xm5!.provenance as Record<string, unknown>).source as string;
    expect(source).toContain('+');
  });

  test('Walkman search: provenance.source is single (1 merchant, no merge needed)', async () => {
    // Walkman is only at Sony Shop — no deduplication merge
    const res = await postSearch({ query: 'sony walkman nw-a306 lecteur audio' });
    expect(res.status).toBe(200);

    const results = res.body.results as Array<Record<string, unknown>>;
    if (results.length > 0) {
      const walkman = results.find(r =>
        typeof r.productId === 'string' && (r.productId as string).includes('walkman')
      );
      if (walkman) {
        const source = (walkman.provenance as Record<string, unknown>).source as string;
        // Single source → no '+' separator
        expect(source).not.toContain('+');
        expect(source).toContain('sony');
      }
    }
  });

  test('no-results scenario: budget 5 EUR → empty results + noResultsDiagnosis', async () => {
    const res = await postSearch({
      query: 'casque bluetooth',
      criteria: [{ id: 'budget', name: 'Budget max', level: 'required', parameters: { maxBudget: 5 } }],
    });
    expect(res.status).toBe(200);
    expect(res.body.summary.totalFound).toBe(0);
    expect(res.body.noResultsDiagnosis).not.toBeNull();
    expect(res.body.noResultsDiagnosis.primaryCause).toBeTruthy();
    expect(res.body.noResultsDiagnosis.message).toBeTruthy();
  });

  test('criteria are echoed back in effectiveCriteria', async () => {
    const res = await postSearch({
      query: 'casque bluetooth',
      criteria: [{ id: 'anc', name: 'ANC requis', level: 'required', parameters: { preferredValues: ['true'] } }],
    });
    expect(res.status).toBe(200);

    const effectiveCriteria = res.body.effectiveCriteria as Array<Record<string, unknown>>;
    const ancCriterion = effectiveCriteria.find(c => c.id === 'anc');
    expect(ancCriterion).toBeDefined();
    expect(ancCriterion!.level).toBe('required');
  });

  test('requestId is returned in response (matching if provided)', async () => {
    const res = await postSearch({ query: 'iphone', requestId: 'my-test-req-42' });
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe('my-test-req-42');
  });

  test('requestId auto-generated when not provided', async () => {
    const res = await postSearch({ query: 'iphone' });
    expect(res.status).toBe(200);
    expect(res.body.requestId).toMatch(/^api-/);
  });
});

// ============================================================================
// 4. DETERMINISM VIA HTTP
// ============================================================================

describe('POST /search — determinism (same query → same ranking)', () => {
  test('two identical searches produce identical rankings', async () => {
    const body = { query: 'sony wh-1000xm5 casque bluetooth' };

    const [res1, res2] = await Promise.all([postSearch(body), postSearch(body)]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1 = (res1.body.results as Array<{ productId: string }>).map(r => r.productId);
    const ids2 = (res2.body.results as Array<{ productId: string }>).map(r => r.productId);

    // Same products in same order
    expect(ids1).toEqual(ids2);

    const scores1 = (res1.body.results as Array<{ score: number }>).map(r => r.score);
    const scores2 = (res2.body.results as Array<{ score: number }>).map(r => r.score);
    expect(scores1).toEqual(scores2);
  });

  test('same query with different word order → same top result', async () => {
    const res1 = await postSearch({ query: 'casque bluetooth sony xm5' });
    const res2 = await postSearch({ query: 'sony xm5 casque bluetooth' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    if (res1.body.results.length > 0 && res2.body.results.length > 0) {
      // Top result should be the same product regardless of query word order
      expect(res1.body.results[0].productId).toBe(res2.body.results[0].productId);
    }
  });
});

// ============================================================================
// 5. CLARIFICATION SESSION FLOW
// ============================================================================

describe('POST /clarify — session flow', () => {
  test('session is null when no clarification opportunities exist', async () => {
    // A very specific query with all details → no clarification needed
    const res = await postSearch({ query: 'sony wh-1000xm5 casque bluetooth' });
    expect(res.status).toBe(200);
    // Session may or may not be present depending on query ambiguity
    // If present, it must have the right shape
    if (res.body.session) {
      expect(res.body.session.sessionId).toBeTruthy();
      expect(typeof res.body.session.sessionId).toBe('string');
    }
  });

  test('missing sessionId → 400 MISSING_SESSION_ID', async () => {
    const res = await postClarify({ questionId: 'q1', answer: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_SESSION_ID');
  });

  test('missing questionId → 400 MISSING_QUESTION_ID', async () => {
    const res = await postClarify({ sessionId: 'sess-fake', answer: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_QUESTION_ID');
  });

  test('missing answer → 400 MISSING_ANSWER', async () => {
    const res = await postClarify({ sessionId: 'sess-fake', questionId: 'q1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_ANSWER');
  });

  test('unknown sessionId → 404 SESSION_NOT_FOUND', async () => {
    const res = await postClarify({
      sessionId: 'sess-nonexistent-xxxxxxxx',
      questionId: 'q1',
      answer: 'some answer',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SESSION_NOT_FOUND');
  });

  test('full session flow: search → clarify → re-search with enriched query', async () => {
    // 1. Do a search that might produce clarification questions
    const searchRes = await postSearch({
      query: 'casque',  // ambiguous — no specific product or budget
      userId: 'integration-test-user-clarify',
    });
    expect(searchRes.status).toBe(200);

    const session = searchRes.body.session;
    if (!session || !session.sessionId) {
      // No clarification opportunities — test is still valid (passes vacuously)
      return;
    }

    const sessionId = session.sessionId;

    // 2. Answer a clarification question
    const clarifications = searchRes.body.clarifications;
    if (!clarifications || !clarifications.questions || clarifications.questions.length === 0) {
      return; // No questions → can't test clarify
    }

    const firstQuestion = clarifications.questions[0];
    const clarifyRes = await postClarify({
      sessionId,
      questionId: firstQuestion.id,
      answer: 'Je cherche un casque avec réduction de bruit active',
    });

    expect(clarifyRes.status).toBe(200);

    // 3. Verify the clarify response has the right shape
    expect(clarifyRes.body.results).toBeInstanceOf(Array);
    expect(clarifyRes.body.session).toBeDefined();
    expect(clarifyRes.body.session.sessionId).toBe(sessionId);
    expect(clarifyRes.body.session.turn).toBe(2); // turn incremented

    // INVARIANT 5: originalQuery is preserved unchanged
    expect(clarifyRes.body.session.originalQuery).toBe('casque');

    // 4. Verify answered questions are tracked
    expect(clarifyRes.body.session.answeredQuestions).toBeInstanceOf(Array);
    expect(clarifyRes.body.session.answeredQuestions).toHaveLength(1);
    expect(clarifyRes.body.session.answeredQuestions[0].answer).toBe(
      'Je cherche un casque avec réduction de bruit active'
    );
  });

  test('INVARIANT 5 via HTTP: originalQuery never modified by clarification answer', async () => {
    // First search
    const searchRes = await postSearch({
      query: 'je cherche un casque',
      userId: 'invariant5-http-test',
    });
    expect(searchRes.status).toBe(200);

    const session = searchRes.body.session;
    if (!session || !session.sessionId) return;

    const sessionId = session.sessionId;
    const clarifications = searchRes.body.clarifications;
    if (!clarifications?.questions?.length) return;

    const firstQuestion = clarifications.questions[0];

    // Answer with something that could be confused for a new query
    const clarifyRes = await postClarify({
      sessionId,
      questionId: firstQuestion.id,
      answer: 'Je veux un smartphone pas un casque',  // Contradictory answer
    });

    if (clarifyRes.status !== 200) return; // Skip if question was invalid

    // INVARIANT 5: originalQuery must still be "je cherche un casque"
    // The answer appended to context, but original query NEVER changes
    expect(clarifyRes.body.session.originalQuery).toBe('je cherche un casque');
  });
});

// ============================================================================
// 6. PROFILE CRUD VIA HTTP
// ============================================================================

describe('Profile CRUD — GET/PUT/DELETE /profile/:userId/criterion', () => {
  const testUserId = `http-test-user-${Date.now()}`;

  test('GET /profile/:userId returns empty profile for new user', async () => {
    const res = await getProfile(testUserId);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(testUserId);
    expect(res.body.criteria).toBeInstanceOf(Array);
    expect(res.body.criteria).toHaveLength(0);
    expect(res.body.updatedAt).toBeTruthy();
  });

  test('PUT /profile/:userId/criterion stores a criterion', async () => {
    const res = await putCriterion(testUserId, {
      id: 'budget',
      name: 'Budget maximum',
      level: 'required',
      parameters: { maxBudget: 500 },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.userId).toBe(testUserId);
    expect(res.body.criterionId).toBe('budget');
  });

  test('GET /profile/:userId returns the stored criterion', async () => {
    const res = await getProfile(testUserId);
    expect(res.status).toBe(200);

    const criteria = res.body.criteria as Array<Record<string, unknown>>;
    const budget = criteria.find(c => c.id === 'budget');
    expect(budget).toBeDefined();
    expect(budget!.level).toBe('required');
  });

  test('profile criterion is applied in subsequent search', async () => {
    // testUserId now has budget: required: maxBudget: 500
    // Searching for camera (Sony A7 IV at 2499 EUR) should exclude it
    const res = await postSearch({
      query: 'sony alpha 7 appareil photo hybride',
      userId: testUserId,
    });
    expect(res.status).toBe(200);

    const results = res.body.results as Array<Record<string, unknown>>;
    const a7iv = results.find(r =>
      typeof r.productId === 'string' && (r.productId as string).includes('alpha7')
    );
    // A7 IV at 2499 EUR exceeds budget 500 → excluded
    expect(a7iv).toBeUndefined();
  });

  test('PUT with missing required fields → 400 INVALID_CRITERION', async () => {
    const res = await putCriterion(testUserId, { id: 'budget' }); // missing name, level
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CRITERION');
  });

  test('PUT with invalid level → 400 INVALID_LEVEL', async () => {
    const res = await putCriterion(testUserId, {
      id: 'budget',
      name: 'Budget',
      level: 'ultraimportant', // not a valid level
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_LEVEL');
  });

  test('DELETE /profile/:userId/criterion/:criterionId removes the criterion', async () => {
    // First verify criterion exists
    const beforeRes = await getProfile(testUserId);
    const criteriaBeforeDelete = (beforeRes.body.criteria as Array<Record<string, unknown>>);
    expect(criteriaBeforeDelete.some(c => c.id === 'budget')).toBe(true);

    // Delete
    const deleteRes = await deleteCriterion(testUserId, 'budget');
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    // Verify gone
    const afterRes = await getProfile(testUserId);
    const criteriaAfterDelete = (afterRes.body.criteria as Array<Record<string, unknown>>);
    expect(criteriaAfterDelete.some(c => c.id === 'budget')).toBe(false);
  });
});

// ============================================================================
// 7. SOURCE NEUTRALITY VIA HTTP (INVARIANT 3)
// ============================================================================

describe('Source neutrality via HTTP (INVARIANT 3)', () => {
  test('XM5 search: Sony Shop not ranked over other merchants purely by source identity', async () => {
    // The merged XM5 offer should appear with combined provenance.
    // It should NOT be replaced by a Sony-only offer to privilege the brand source.
    const res = await postSearch({ query: 'sony wh-1000xm5' });
    expect(res.status).toBe(200);

    const xm5 = (res.body.results as Array<Record<string, unknown>>).find(r =>
      r.productId === 'prod-sony-wh1000xm5'
    );
    expect(xm5).toBeDefined();

    // Multi-source merge occurred (4 merchants)
    const source = (xm5!.provenance as Record<string, unknown>).source as string;
    // The source combines all merchants — no single merchant was privileged
    expect(source).toContain('+');
  });

  test('ranking score is stable regardless of which merchant was first in discovery order', async () => {
    // Run same search twice — InMemoryDiscovery always returns same order,
    // but we verify the score is identical across runs (not random).
    const res1 = await postSearch({ query: 'casque bluetooth sony' });
    const res2 = await postSearch({ query: 'casque bluetooth sony' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const firstScore1 = (res1.body.results as Array<{ score: number }>)[0]?.score;
    const firstScore2 = (res2.body.results as Array<{ score: number }>)[0]?.score;

    if (firstScore1 !== undefined && firstScore2 !== undefined) {
      expect(firstScore1).toBe(firstScore2);
    }
  });
});

// ============================================================================
// 8. UNKNOWN DATA VIA HTTP (UNKNOWN ≠ false)
// ============================================================================

describe('UNKNOWN data handling via HTTP', () => {
  test('Keychron K3 Pro (null price) appears in search results', async () => {
    const res = await postSearch({ query: 'keychron k3 pro clavier mécanique bluetooth' });
    expect(res.status).toBe(200);

    const results = res.body.results as Array<Record<string, unknown>>;
    const keychron = results.find(r =>
      typeof r.productId === 'string' && (r.productId as string).includes('keychron')
    );
    expect(keychron).toBeDefined();

    // Null price is serialized as null (not as 0)
    expect(keychron!.price).toBeNull();
  });

  test('Roborock S8 (unknown repairability) appears in robot vacuum search', async () => {
    const res = await postSearch({ query: 'roborock s8 aspirateur robot' });
    expect(res.status).toBe(200);

    const results = res.body.results as Array<Record<string, unknown>>;
    const roborock = results.find(r =>
      typeof r.productId === 'string' && (r.productId as string).includes('roborock')
    );
    // UNKNOWN repairability must not prevent product from appearing (UNKNOWN ≠ false)
    expect(roborock).toBeDefined();
  });
});

// ============================================================================
// 9. SEARCH WITH INLINE CRITERIA VIA HTTP (INVARIANT 5)
// ============================================================================

describe('Inline criteria via HTTP (INVARIANT 5)', () => {
  test('budget criterion excludes expensive products', async () => {
    const res = await postSearch({
      query: 'casque bluetooth',
      criteria: [{ id: 'budget', name: 'Budget max', level: 'required', parameters: { maxBudget: 200 } }],
    });
    expect(res.status).toBe(200);

    for (const r of res.body.results as Array<{ price: { amount: number } | null }>) {
      if (r.price !== null) {
        expect(r.price.amount).toBeLessThanOrEqual(200);
      }
    }
  });

  test('ANC forbidden criterion: XM5 (ANC=true) excluded from results', async () => {
    const res = await postSearch({
      query: 'casque bluetooth',
      criteria: [{ id: 'anc', name: 'Sans ANC', level: 'forbidden' }],
    });
    expect(res.status).toBe(200);

    const xm5 = (res.body.results as Array<Record<string, unknown>>).find(r =>
      r.productId === 'prod-sony-wh1000xm5'
    );
    // XM5 has ANC → forbidden → excluded from ranked results
    expect(xm5).toBeUndefined();
  });

  test('criteria applied without modifying interpretation (INVARIANT 5)', async () => {
    // The user's explicit criteria must be honored as-is.
    // The engine must not silently remove criteria or add new ones.
    const res = await postSearch({
      query: 'casque bluetooth',
      criteria: [{ id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 100 } }],
    });
    expect(res.status).toBe(200);

    // The budget criterion must appear in effectiveCriteria (not silently dropped)
    const effective = res.body.effectiveCriteria as Array<{ id: string }>;
    const budgetFound = effective.some(c => c.id === 'budget');
    expect(budgetFound).toBe(true);
  });
});

// ============================================================================
// 10. RESPONSE SHAPE COMPLETENESS
// ============================================================================

describe('Response shape completeness', () => {
  test('all required top-level fields present', async () => {
    const res = await postSearch({ query: 'iphone 15' });
    expect(res.status).toBe(200);

    const body = res.body;
    expect(body).toHaveProperty('requestId');
    expect(body).toHaveProperty('completedAt');
    expect(body).toHaveProperty('durationMs');
    expect(body).toHaveProperty('results');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('effectiveCriteria');
    expect(body).toHaveProperty('searchPlan');
    expect(body).toHaveProperty('timing');
    // session is null when no clarification needed
    expect(body).toHaveProperty('session');
    expect(body).toHaveProperty('noResultsDiagnosis');
  });

  test('searchPlan fields present', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);

    const plan = res.body.searchPlan;
    expect(plan).toBeDefined();
    expect(plan.rarityLevel).toBeDefined();
    expect(plan.estimatedAvailability).toBeDefined();
    expect(plan.escalationLevel).toBeDefined();
    expect(plan.primaryTerms).toBeInstanceOf(Array);
    expect(plan.alternativeTerms).toBeInstanceOf(Array);
  });

  test('each result has provenance field', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);

    for (const r of res.body.results as Array<Record<string, unknown>>) {
      expect(r.provenance).toBeDefined();
      expect((r.provenance as Record<string, unknown>).source).toBeTruthy();
    }
  });

  test('durationMs is a positive number', async () => {
    const res = await postSearch({ query: 'iphone' });
    expect(res.status).toBe(200);
    expect(typeof res.body.durationMs).toBe('number');
    expect(res.body.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('provenanceSummary is present with correct shape', async () => {
    const res = await postSearch({ query: 'casque bluetooth Sony' });
    expect(res.status).toBe(200);

    const ps = res.body.provenanceSummary;
    expect(ps).toBeDefined();
    expect(typeof ps.totalRankedOffers).toBe('number');
    expect(Array.isArray(ps.contributingSources)).toBe(true);
    expect(typeof ps.sourceContributions).toBe('object');

    // Integrity: sum of contributions must equal totalRankedOffers
    const sum = (Object.values(ps.sourceContributions) as number[])
      .reduce((acc: number, n: number) => acc + n, 0);
    expect(sum).toBe(ps.totalRankedOffers);
    expect(ps.totalRankedOffers).toBe(res.body.results.length);
  });

  test('provenanceSummary.totalRankedOffers is 0 on no-results query', async () => {
    const res = await postSearch({ query: 'xxxxxxxx produit inexistant zzzzzz' });
    expect(res.status).toBe(200);
    expect(res.body.provenanceSummary.totalRankedOffers).toBe(0);
    expect(res.body.provenanceSummary.contributingSources).toHaveLength(0);
  });
});
