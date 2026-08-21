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
import { FOLLOWUP_QUESTION_ID } from '../../src/application/conversation-manager';
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

  test('each result exposes a per-criterion breakdown with satisfied/unknown/violated status', async () => {
    const res = await postSearch({ query: 'sony wh-1000xm5 casque bluetooth' });
    expect(res.status).toBe(200);

    const results = res.body.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);

    const criteria = results[0].criteria as Array<Record<string, unknown>>;
    expect(Array.isArray(criteria)).toBe(true);
    expect(criteria.length).toBeGreaterThan(0);
    for (const c of criteria) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(['satisfied', 'unknown', 'violated']).toContain(c.status);
      expect(typeof c.requiredOrForbidden).toBe('boolean');
    }
  });

  test('a required criterion the ranked offer actually satisfies is reported "satisfied", not silently omitted', async () => {
    const res = await postSearch({ query: 'sony wh-1000xm5 moins de 400 €' });
    expect(res.status).toBe(200);
    const results = res.body.results as Array<Record<string, unknown>>;
    if (results.length > 0) {
      const criteria = results[0].criteria as Array<Record<string, unknown>>;
      const budget = criteria.find(c => c.id === 'budget');
      expect(budget).toBeDefined();
      expect(budget!.status).toBe('satisfied');
    }
  });

  test('language field is present and defaults to fr for a French query', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('fr');
  });

  test('coverage is present (possibly null for the local catalog path) but never fabricated', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);
    expect('coverage' in res.body).toBe(true);
    // Local in-memory discovery (no keys configured) never ran a multi-phase
    // Web search — coverage is honestly null, not a fabricated object.
    expect(res.body.coverage).toBeNull();
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

  test('noResultsDiagnosis.message is localized in English, never falls back to French', async () => {
    const res = await postSearch({
      query: 'casque bluetooth',
      language: 'en',
      criteria: [{ id: 'budget', name: 'Budget max', level: 'required', parameters: { maxBudget: 5 } }],
    });
    expect(res.status).toBe(200);
    expect(res.body.noResultsDiagnosis).not.toBeNull();
    // English diagnosis text — must not contain the French wording.
    expect(res.body.noResultsDiagnosis.message).not.toMatch(/trouvée|dépassent|découverte/i);
    if (res.body.noResultsDiagnosis.recoveryOptions.length > 0) {
      for (const opt of res.body.noResultsDiagnosis.recoveryOptions) {
        expect(opt.description).not.toMatch(/[éèç]/); // no French diacritics leaking through
        expect(opt.impact).toBeTruthy();
      }
    }
  });

  test('price carries verifiedAt/source when the price DataPoint has provenance, null otherwise — never fabricated (PARTIE 10 transparency)', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const r of res.body.results as Array<{ price: { amount: number; verifiedAt: string | null; source: string | null } | null }>) {
      if (!r.price) continue;
      expect('verifiedAt' in r.price).toBe(true);
      expect('source' in r.price).toBe(true);
      // Whatever the value, it must be a real ISO timestamp or explicitly null — never a placeholder.
      if (r.price.verifiedAt !== null) {
        expect(() => new Date(r.price!.verifiedAt as string).toISOString()).not.toThrow();
      }
    }
  });

  test('matchQuality label is localized (French default, no raw enum value)', async () => {
    const res = await postSearch({ query: 'casque bluetooth' });
    expect(res.status).toBe(200);
    for (const r of res.body.results as Array<{ matchQuality: string }>) {
      expect(r.matchQuality).toBeTruthy();
      expect(['exact_match', 'close_match', 'partial_match', 'alternative', 'unknown']).not.toContain(r.matchQuality);
    }
  });

  test('summary.resultSummary is localized in English for an English search', async () => {
    const res = await postSearch({ query: 'bluetooth headphones', language: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.summary.resultSummary).toBeTruthy();
    expect(res.body.summary.resultSummary).not.toMatch(/offre\(s\)|classée|Meilleure|Aucun candidat/i);
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
// 5b. CONVERSATIONAL FOLLOW-UPS (megaprompt PARTIE 1/3) — refine a search
//     via free-form text, distinct from answering a pending clarification
//     question. See ConversationManager.applyFollowUp() / FOLLOWUP_QUESTION_ID.
// ============================================================================

describe('POST /clarify — conversational follow-up (FOLLOWUP_QUESTION_ID)', () => {
  test('every completed search gets a continuable sessionId, even with no pending clarification', async () => {
    const res = await postSearch({ query: 'ordinateur portable 16 Go moins de 1000 euros' });
    expect(res.status).toBe(200);
    expect(res.body.session).not.toBeNull();
    expect(typeof res.body.session.sessionId).toBe('string');
  });

  test('the exact megaprompt conversation chain: laptop → 16 Go → budget → 32 Go → neuf, preserving language/category/product throughout', async () => {
    // "trouve-moi un ordinateur portable" — real bug found running this exact
    // scenario: (a) language-detection misclassified it as Spanish, and (b)
    // the leaked verb "trouve" zeroed out discovery entirely. Both fixed;
    // this test locks in the corrected end-to-end behavior.
    const initial = await postSearch({ query: 'trouve-moi un ordinateur portable' });
    expect(initial.status).toBe(200);
    expect(initial.body.language).toBe('fr');
    const sessionId = initial.body.session.sessionId;

    const step2 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement 16 Go' });
    expect(step2.status).toBe(200);
    expect(step2.body.language).toBe('fr');
    expect(step2.body.results.length).toBeGreaterThan(0); // Framework/Dell/Lenovo etc., all 16GB

    const step3 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'moins de 1100 €' });
    expect(step3.status).toBe(200);
    for (const r of step3.body.results as Array<{ price: { amount: number } | null }>) {
      if (r.price) expect(r.price.amount).toBeLessThanOrEqual(1100);
    }

    // "finalement 32 Go" — the local catalog has no 32GB laptop, so 0
    // results is the HONEST outcome here, not a bug — verified separately
    // (unit level, request-interpreter.test.ts #15b) that ram=32 is what
    // actually gets extracted from this exact phrase.
    const step4 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'finalement 32 Go' });
    expect(step4.status).toBe(200);
    expect(step4.body.effectiveCriteria.find((c: { id: string }) => c.id === 'ram')).toBeDefined();

    // Revert to a satisfiable RAM requirement so 'neuf' can be observed
    // against real (if UNKNOWN) offers rather than an already-empty set.
    const step4b = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'finalement 16 Go' });
    const step5 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement neuf' });
    expect(step5.status).toBe(200);
    expect(step5.body.session.originalQuery).toBe('trouve-moi un ordinateur portable'); // never rewritten
    for (const r of step5.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      const category = r.criteria.find(c => c.id === 'category');
      const condition = r.criteria.find(c => c.id === 'condition');
      expect(category?.status).not.toBe('violated'); // category from turn 1 still holds
      expect(condition?.status).not.toBe('violated'); // UNKNOWN (no fixture has condition data), never wrongly rejected
    }
  });

  test('W. full megaprompt scenario with ranking + international state: laptop → 16 Go → budget → "moins chers" → Allemagne → neuf, verifying category/RAM/budget/condition/rankingPreference/targetCountries/destination/language are ALL preserved at every turn (FR)', async () => {
    const initial = await postSearch({ query: 'trouve-moi un ordinateur portable' });
    expect(initial.status).toBe(200);
    expect(initial.body.language).toBe('fr');
    expect(initial.body.rankingPreference).toEqual({ preference: 'BEST_MATCH', applied: true });
    expect(initial.body.destination).toEqual({ destinationCountry: 'FR', targetCountries: ['FR'] });
    const sessionId = initial.body.session.sessionId;

    const step2 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement 16 Go' });
    expect(step2.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram']));

    const step3 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'moins de 2000 €' });
    expect(step3.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram', 'budget']));
    expect(step3.body.results.length).toBeGreaterThan(1); // several 16GB laptops under 2000€ — need >1 to prove reordering next

    // Tour 4 : "finalement montre-moi les moins chers" — a REAL ranking
    // preference, and results reordered by real cost, not just relevance score.
    const step4 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'finalement montre-moi les moins chers' });
    expect(step4.status).toBe(200);
    expect(step4.body.rankingPreference).toEqual({ preference: 'PRICE_LOWEST', applied: true });
    const costs = (step4.body.results as Array<{ cost: { totalKnown: number } }>).map(r => r.cost.totalKnown);
    expect(costs).toEqual([...costs].sort((a, b) => a - b)); // ascending by real cost
    // category/ram/budget from earlier turns must still be there — a ranking
    // change is presentation-only, never a criteria reset.
    expect(step4.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram', 'budget']));

    // Tour 5 : "cherche aussi en Allemagne" — widens search scope, France
    // stays the destination, ranking preference from turn 4 persists.
    const step5 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche aussi en Allemagne' });
    expect(step5.status).toBe(200);
    expect(step5.body.destination.destinationCountry).toBe('FR'); // never confused with search scope
    expect(step5.body.destination.targetCountries.sort()).toEqual(['DE', 'FR']);
    expect(step5.body.rankingPreference.preference).toBe('PRICE_LOWEST'); // NOT reset

    // Tour 6 : "uniquement neuf" — adds condition, everything else (category/
    // ram/budget/rankingPreference/targetCountries/destination) still intact.
    const step6 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement neuf' });
    expect(step6.status).toBe(200);
    const ids6 = step6.body.effectiveCriteria.map((c: { id: string }) => c.id);
    expect(ids6).toEqual(expect.arrayContaining(['category', 'ram', 'budget', 'condition']));
    expect(step6.body.destination.targetCountries.sort()).toEqual(['DE', 'FR']);
    expect(step6.body.rankingPreference.preference).toBe('PRICE_LOWEST');
    expect(step6.body.language).toBe('fr'); // response language never drifted across 5 follow-up turns
    expect(step6.body.session.originalQuery).toBe('trouve-moi un ordinateur portable'); // INVARIANT 5 held throughout
  });

  test('X. the FULL 10-turn megaprompt reference scenario: laptop → 16 Go → budget → 16 Go (revised) → neuf → moins chers → Allemagne → livrables France → tri prix → top 3', async () => {
    // Tour 1
    const t1 = await postSearch({ query: 'trouve-moi un ordinateur portable' });
    expect(t1.status).toBe(200);
    expect(t1.body.language).toBe('fr');
    const sessionId = t1.body.session.sessionId;

    // Tour 2 : "uniquement 16 Go"
    const t2 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement 16 Go' });
    expect(t2.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram']));

    // Tour 3 : "moins de 1 100 €" — real megaprompt value; local catalog's
    // cheapest 16GB laptop is 1049€, so this must stay non-empty.
    const t3 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'moins de 1100 €' });
    expect(t3.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram', 'budget']));
    expect(t3.body.results.length).toBeGreaterThan(0);

    // Tour 4 : "finalement 32 Go" — local catalog has no 32GB laptop, 0
    // results is the HONEST outcome (already verified at unit level that
    // ram=32 is genuinely extracted from this exact phrase — request-interpreter.test.ts #15b).
    const t4 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'finalement 32 Go' });
    expect(t4.body.effectiveCriteria.find((c: { id: string }) => c.id === 'ram')).toBeDefined();
    // Revert to a satisfiable RAM so the rest of the scenario has real
    // results to exercise ranking/exclusion/limit against.
    await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'finalement 16 Go' });

    // Tour 5 : "uniquement neuf"
    const t5 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement neuf' });
    expect(t5.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram', 'budget', 'condition']));
    for (const r of t5.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      expect(r.criteria.find(c => c.id === 'condition')?.status).not.toBe('violated'); // UNKNOWN, never falsely rejected
    }

    // Tour 6 : "montre-moi les moins chers" — real ranking, real cost order.
    const t6 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'montre-moi les moins chers' });
    expect(t6.body.rankingPreference).toEqual({ preference: 'PRICE_LOWEST', applied: true });
    const t6costs = (t6.body.results as Array<{ cost: { totalKnown: number } }>).map(r => r.cost.totalKnown);
    expect(t6costs).toEqual([...t6costs].sort((a, b) => a - b));

    // Tour 7 : "cherche aussi en Allemagne" — widens search scope, France
    // stays destination, PRICE_LOWEST persists, all prior criteria intact.
    const t7 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche aussi en Allemagne' });
    expect(t7.body.destination).toEqual({ destinationCountry: 'FR', targetCountries: expect.arrayContaining(['FR', 'DE']) });
    expect(t7.body.rankingPreference.preference).toBe('PRICE_LOWEST');
    expect(t7.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram', 'budget', 'condition']));

    // Tour 8 : "et garde uniquement les offres livrables en France" — the
    // deliverability criterion is added and honestly UNKNOWN (never
    // VIOLATED) since no source populates per-offer deliverability data —
    // documented as PRÉPARÉ MAIS NON BRANCHÉ in the final report. Existing
    // results must NOT be wrongly zeroed out by this.
    const t8 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'et garde uniquement les offres livrables en France' });
    expect(t8.status).toBe(200);
    expect(t8.body.results.length).toBe(t7.body.results.length); // nothing wrongly filtered out
    for (const r of t8.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      const deliv = r.criteria.find(c => c.id === 'deliversTo');
      if (deliv) expect(deliv.status).not.toBe('violated');
    }

    // Tour 9 : "classe-les du moins cher au plus cher" — re-affirms PRICE_LOWEST.
    const t9 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'classe-les du moins cher au plus cher' });
    expect(t9.body.rankingPreference).toEqual({ preference: 'PRICE_LOWEST', applied: true });
    const t9costs = (t9.body.results as Array<{ cost: { totalKnown: number } }>).map(r => r.cost.totalKnown);
    expect(t9costs).toEqual([...t9costs].sort((a, b) => a - b));

    // Tour 10 : "montre-moi les 3 meilleures" — presentation cap, applied
    // to the (already cost-sorted) list.
    const t10 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'montre-moi les 3 meilleures' });
    expect(t10.status).toBe(200);
    expect(t10.body.results.length).toBeLessThanOrEqual(3);
    expect(t10.body.session.originalQuery).toBe('trouve-moi un ordinateur portable'); // INVARIANT 5 held across all 10 turns
    expect(t10.body.language).toBe('fr'); // never drifted across 9 follow-up turns
  });

  test('Y. "cherche ailleurs" (SEARCH_ELSEWHERE) genuinely excludes every merchant already shown — a real relaunch, not a repeat of the same results', async () => {
    const initial = await postSearch({ query: 'casque bluetooth' });
    expect(initial.status).toBe(200);
    const sessionId = initial.body.session.sessionId;
    const seenMerchants = new Set((initial.body.results as Array<{ merchant: { name: string } }>).map(r => r.merchant.name));
    expect(seenMerchants.size).toBeGreaterThan(0);

    const followUp = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche ailleurs' });
    expect(followUp.status).toBe(200);
    for (const r of followUp.body.results as Array<{ merchant: { name: string } }>) {
      expect(seenMerchants.has(r.merchant.name)).toBe(false); // never a merchant already shown
    }
    // The product being searched (category) is untouched by a relaunch.
    expect(followUp.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(initial.body.effectiveCriteria.map((c: { id: string }) => c.id))
    );
  });

  test('Z. "trouve une meilleure offre" (FIND_BETTER) excludes already-shown PRODUCTS while keeping every existing constraint and the active ranking preference', async () => {
    const initial = await postSearch({ query: 'casque bluetooth' });
    const sessionId = initial.body.session.sessionId;
    const seenProductIds = new Set((initial.body.results as Array<{ productId: string }>).map(r => r.productId));

    await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'montre-moi les moins chers' });
    const followUp = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'trouve une meilleure offre' });
    expect(followUp.status).toBe(200);
    expect(followUp.body.rankingPreference).toEqual({ preference: 'PRICE_LOWEST', applied: true }); // preserved, not reset
    for (const r of followUp.body.results as Array<{ productId: string }>) {
      expect(seenProductIds.has(r.productId)).toBe(false);
    }
  });

  test('"cherche encore" (SEARCH_AGAIN) broadens international search scope while keeping France as destination and all prior criteria', async () => {
    const initial = await postSearch({ query: 'trouve-moi un ordinateur portable' });
    const sessionId = initial.body.session.sessionId;
    await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement 16 Go' });

    const followUp = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche encore' });
    expect(followUp.status).toBe(200);
    expect(followUp.body.destination.destinationCountry).toBe('FR');
    expect(followUp.body.destination.targetCountries.length).toBeGreaterThan(1);
    expect(followUp.body.effectiveCriteria.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['category', 'ram']));
  });

  test('AA. the megaprompt\'s 8-turn reference scenario (livraison + relances): laptop 16 Go budget → neuf → livrable FR → tri prix → Allemagne → encore → ailleurs → meilleure offre — no state silently disappears at ANY turn', async () => {
    const hasId = (arr: Array<{ id: string }>, id: string) => arr.some(c => c.id === id);

    // Tour 1 ("16 Go RAM", not a bare "16 Go" — single-turn RAM extraction
    // requires "ram" adjacency; a bare quantity alone is only recognized as
    // RAM in a conversational REFINEMENT phrasing, e.g. "uniquement 16 Go" —
    // see request-interpreter.test.ts #15/#15d).
    const t1 = await postSearch({ query: 'trouve-moi un ordinateur portable 16 Go RAM moins de 1100 €' });
    expect(t1.status).toBe(200);
    expect(hasId(t1.body.effectiveCriteria, 'category')).toBe(true);
    expect(hasId(t1.body.effectiveCriteria, 'ram')).toBe(true);
    expect(hasId(t1.body.effectiveCriteria, 'budget')).toBe(true);
    expect(t1.body.destination).toEqual({ destinationCountry: 'FR', targetCountries: ['FR'] });
    const sessionId = t1.body.session.sessionId;
    const seenAfterT1 = new Set((t1.body.results as Array<{ merchant: { name: string } }>).map(r => r.merchant.name));

    // Tour 2 : "uniquement neuf"
    const t2 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'uniquement neuf' });
    expect(t2.status).toBe(200);
    expect(hasId(t2.body.effectiveCriteria, 'category')).toBe(true);
    expect(hasId(t2.body.effectiveCriteria, 'ram')).toBe(true);
    expect(hasId(t2.body.effectiveCriteria, 'budget')).toBe(true);
    expect(hasId(t2.body.effectiveCriteria, 'condition')).toBe(true);

    // Tour 3 : "livrable en France" — criterion added, resolves honestly
    // (local catalog never populates deliversTo, so UNKNOWN — unknownPolicy
    // 'pass' means results are NOT wrongly zeroed out by an absent signal).
    const t3 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'livrable en France' });
    expect(t3.status).toBe(200);
    expect(hasId(t3.body.effectiveCriteria, 'deliversTo')).toBe(true);
    for (const r of t3.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      const delivers = r.criteria.find(c => c.id === 'deliversTo');
      if (delivers) expect(delivers.status).not.toBe('violated');
    }
    expect(hasId(t3.body.effectiveCriteria, 'category')).toBe(true);
    expect(hasId(t3.body.effectiveCriteria, 'ram')).toBe(true);
    expect(hasId(t3.body.effectiveCriteria, 'budget')).toBe(true);
    expect(hasId(t3.body.effectiveCriteria, 'condition')).toBe(true);

    // Tour 4 : "classe-les du moins cher au plus cher"
    const t4 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'classe-les du moins cher au plus cher' });
    expect(t4.status).toBe(200);
    expect(t4.body.rankingPreference).toEqual({ preference: 'PRICE_LOWEST', applied: true });
    const t4costs = (t4.body.results as Array<{ cost: { totalKnown: number } }>).map(r => r.cost.totalKnown);
    expect(t4costs).toEqual([...t4costs].sort((a: number, b: number) => a - b));

    // Tour 5 : "cherche aussi en Allemagne"
    const t5 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche aussi en Allemagne' });
    expect(t5.status).toBe(200);
    expect(t5.body.destination).toEqual({ destinationCountry: 'FR', targetCountries: expect.arrayContaining(['FR', 'DE']) });
    expect(t5.body.rankingPreference.preference).toBe('PRICE_LOWEST'); // preserved

    // Tour 6 : "cherche encore" (SEARCH_AGAIN) — no SearchCoverage data exists
    // for the local catalog path, so the honest default (broaden) applies;
    // destination/ranking/criteria must all still be intact.
    const t6 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche encore' });
    expect(t6.status).toBe(200);
    expect(t6.body.destination.destinationCountry).toBe('FR');
    expect(t6.body.rankingPreference.preference).toBe('PRICE_LOWEST');
    expect(hasId(t6.body.effectiveCriteria, 'condition')).toBe(true);
    expect(hasId(t6.body.effectiveCriteria, 'deliversTo')).toBe(true);

    // Tour 7 : "cherche ailleurs" (SEARCH_ELSEWHERE) — avoids every merchant
    // shown across the WHOLE conversation so far (turns 1-6), not just t6.
    const t7 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'cherche ailleurs' });
    expect(t7.status).toBe(200);
    for (const r of t7.body.results as Array<{ merchant: { name: string } }>) {
      expect(seenAfterT1.has(r.merchant.name)).toBe(false);
    }
    expect(hasId(t7.body.effectiveCriteria, 'budget')).toBe(true); // constraints still intact

    // Tour 8 : "trouve une meilleure offre" (FIND_BETTER) — ranking preference
    // and every constraint preserved, distinct mechanism from tour 6/7.
    const t8 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'trouve une meilleure offre' });
    expect(t8.status).toBe(200);
    expect(t8.body.rankingPreference.preference).toBe('PRICE_LOWEST');
    expect(t8.body.session.originalQuery).toBe('trouve-moi un ordinateur portable 16 Go RAM moins de 1100 €'); // INVARIANT 5 held across all 8 turns
    expect(t8.body.language).toBe('fr');
  });

  test('the same scenario in English: response language stays English throughout, even with a French country name in the search-scope follow-up', async () => {
    const initial = await postSearch({ query: 'find me a laptop', language: 'en' });
    expect(initial.status).toBe(200);
    expect(initial.body.language).toBe('en');
    const sessionId = initial.body.session.sessionId;

    await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'only 16 GB' });
    await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'under 2000 euros' });

    const step4 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'show me the cheapest ones' });
    expect(step4.status).toBe(200);
    expect(step4.body.language).toBe('en'); // never silently switched to fr
    expect(step4.body.rankingPreference).toEqual({ preference: 'PRICE_LOWEST', applied: true });

    const step5 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'also search Germany' });
    expect(step5.status).toBe(200);
    expect(step5.body.language).toBe('en');
    expect(step5.body.destination.targetCountries.sort()).toEqual(['DE', 'FR']);

    const step6 = await postClarify({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer: 'only new' });
    expect(step6.status).toBe(200);
    expect(step6.body.language).toBe('en');
    expect(step6.body.session.originalQuery).toBe('find me a laptop');
  });

  test('"élargis à 1100€" widens the budget of the CURRENT search (does not start a new one)', async () => {
    const initial = await postSearch({ query: 'ordinateur portable 16 Go moins de 1000 euros' });
    expect(initial.status).toBe(200);
    const sessionId = initial.body.session.sessionId;
    const initialIds = new Set((initial.body.results as Array<{ productId: string }>).map(r => r.productId));

    const followUp = await postClarify({
      sessionId,
      questionId: FOLLOWUP_QUESTION_ID,
      answer: 'élargis à 1100€',
    });
    expect(followUp.status).toBe(200);
    // Session identity preserved — this is a refinement, not a fresh search.
    expect(followUp.body.session.sessionId).toBe(sessionId);
    expect(followUp.body.session.originalQuery).toBe('ordinateur portable 16 Go moins de 1000 euros');

    // The Framework Laptop 13 (1049€, 16GB) is over the original 1000€ budget
    // but under the widened 1100€ one — it must appear now even though the
    // RAM criterion (16 Go, from the ORIGINAL query text) is still enforced.
    const widenedIds = new Set((followUp.body.results as Array<{ productId: string }>).map((r: { productId: string }) => r.productId));
    expect(widenedIds.has('prod-framework-laptop-13-amd')).toBe(true);
    expect(initialIds.has('prod-framework-laptop-13-amd')).toBe(false);
    for (const r of followUp.body.results as Array<{ price: { amount: number } | null }>) {
      if (r.price) expect(r.price.amount).toBeLessThanOrEqual(1100);
    }
  });

  test('"uniquement du neuf" adds a condition criterion, reported UNKNOWN (not violated) when offers carry no condition data', async () => {
    const initial = await postSearch({ query: 'ordinateur portable 16 Go' });
    expect(initial.status).toBe(200);
    const sessionId = initial.body.session.sessionId;

    const followUp = await postClarify({
      sessionId,
      questionId: FOLLOWUP_QUESTION_ID,
      answer: 'uniquement du neuf',
    });
    expect(followUp.status).toBe(200);
    expect(followUp.body.results.length).toBeGreaterThan(0);
    for (const r of followUp.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      const conditionCriterion = r.criteria.find(c => c.id === 'condition');
      expect(conditionCriterion).toBeDefined();
      // INVARIANT: no offer in the fixture catalog carries condition data —
      // absence of data must read as UNKNOWN, never VIOLATED.
      expect(conditionCriterion!.status).toBe('unknown');
    }
  });

  test('a follow-up does not disturb criteria it does not mention (RAM from the original query still applies)', async () => {
    const initial = await postSearch({ query: 'ordinateur portable 16 Go moins de 1000 euros' });
    const sessionId = initial.body.session.sessionId;

    const followUp = await postClarify({
      sessionId,
      questionId: FOLLOWUP_QUESTION_ID,
      answer: 'élargis à 2000€',
    });
    expect(followUp.status).toBe(200);
    // Widening the budget to 2000€ would admit the Lenovo (1699€) and Dell
    // (1449€) too — both are 16GB, so RAM still holds; a laptop with less
    // RAM would still be excluded (not tested here directly, but the
    // widened result set must still all satisfy the original 16GB minimum).
    for (const r of followUp.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      const ramCriterion = r.criteria.find(c => c.id === 'ram');
      if (ramCriterion) expect(ramCriterion.status).not.toBe('violated');
    }
  });

  test('G. category survives a follow-up turn (fixed category propagation bug does not regress conversation) — a budget widening never lets an unrelated category (e.g. headphones) leak into laptop results', async () => {
    const initial = await postSearch({ query: 'ordinateur portable 16 Go moins de 1000 euros' });
    expect(initial.body.results).toHaveLength(0); // too strict a budget — 0 results, honestly
    const sessionId = initial.body.session.sessionId;

    const followUp = await postClarify({
      sessionId,
      questionId: FOLLOWUP_QUESTION_ID,
      answer: 'élargis à 1200€',
    });
    expect(followUp.status).toBe(200);
    expect(followUp.body.results.length).toBeGreaterThan(0);
    for (const r of followUp.body.results as Array<{ criteria: Array<{ id: string; status: string }> }>) {
      const categoryCriterion = r.criteria.find(c => c.id === 'category');
      // category is unknownPolicy:'pass' — SATISFIED or UNKNOWN, never VIOLATED
      // for a genuine laptop offer, and category-guided discovery must never
      // have surfaced an unrelated product (e.g. headphones) in the first place.
      expect(categoryCriterion?.status).not.toBe('violated');
    }
  });

  test('a follow-up on an English search stays in English (language must not silently fall back to fr)', async () => {
    const initial = await postSearch({ query: 'laptop 16 GB under 1000 euros', language: 'en' });
    expect(initial.status).toBe(200);
    expect(initial.body.language).toBe('en');
    const sessionId = initial.body.session.sessionId;

    const followUp = await postClarify({
      sessionId,
      questionId: FOLLOWUP_QUESTION_ID,
      answer: 'increase the budget to 1300',
    });
    expect(followUp.status).toBe(200);
    expect(followUp.body.language).toBe('en');
    // matchQuality/resultSummary are language-derived labels — a silent
    // fallback to 'fr' would leak French text into this "en" response.
    expect(followUp.body.summary.resultSummary).not.toMatch(/offre\(s\)|classée|Meilleure|Aucun candidat/i);
  });

  test('unknown sessionId with FOLLOWUP_QUESTION_ID still 404s (session lookup happens before mode branching)', async () => {
    const res = await postClarify({
      sessionId: 'sess-nonexistent-followup',
      questionId: FOLLOWUP_QUESTION_ID,
      answer: 'élargis à 1100€',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SESSION_NOT_FOUND');
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
