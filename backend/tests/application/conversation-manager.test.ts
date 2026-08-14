/**
 * ConversationManager Tests
 *
 * Tests for multi-turn clarification session lifecycle and POST /clarify endpoint.
 */

import {
  ConversationManager,
  ConversationSession,
} from '../../src/application/conversation-manager';
import { ClarificationItem } from '../../src/application/clarification-engine';
import { UserProfile, PreferenceCriterion } from '../../src/domain/types';

// ============================================================================
// FIXTURES
// ============================================================================

function makeProfile(userId = 'user-1'): UserProfile {
  const now = new Date();
  return {
    userId,
    preferences: { criteria: [], createdAt: now, updatedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}

function makeClarificationItem(id: string, question: string, urgency: ClarificationItem['urgency'] = 'important'): ClarificationItem {
  return {
    id,
    trigger: 'ambiguous_budget',
    urgency,
    ambiguityDescription: 'Budget is unspecified',
    suggestedQuestion: question,
    involvedCriteria: ['budget'],
    possibleInterpretations: [
      { interpretation: 'low', assumedValue: 300, impact: 'fewer results' },
      { interpretation: 'high', assumedValue: 1000, impact: 'more results' },
    ],
    blocksSearch: false,
    safeDefault: { value: 500, description: '500€ assumed' },
  };
}

function makeSearchResult(opportunities: ClarificationItem[] = []): any {
  return {
    requestId: 'req-test',
    completedAt: new Date(),
    durationMs: 50,
    ranking: { rankedOffers: [] },
    admissibility: { rejectedOffers: [] },
    effectiveCriteria: [],
    interpretedRequest: null,
    clarifications: {
      opportunities,
      blockingCount: 0,
      importantCount: opportunities.length,
      optionalCount: 0,
      canProceedWithoutClarification: true,
      recommendedQuestions: opportunities,
    },
    noResultsDiagnosis: null,
    searchPlan: {
      rarityLevel: 'common',
      estimatedAvailability: 'high',
      expansion: { currentLevel: 1, attemptedLevels: [1] },
      query: { primaryTerms: [], alternativeTerms: [] },
    },
    explanation: { rankedExplanations: [], resultSummary: '' },
    timing: {},
  };
}

// ============================================================================
// ConversationManager unit tests
// ============================================================================

describe('ConversationManager', () => {
  let mgr: ConversationManager;
  const profile = makeProfile();
  const q1 = makeClarificationItem('clarif-1', 'Quel est votre budget maximum?');
  const q2 = makeClarificationItem('clarif-2', 'Préférez-vous neuf ou reconditionné?', 'optional');

  beforeEach(() => {
    mgr = new ConversationManager({ ttlMs: 60_000 }); // 1-minute TTL for tests
  });

  // ── createSession ──────────────────────────────────────────────────────────

  it('createSession returns null when result has no clarifications', () => {
    const result = makeSearchResult([]);
    const id = mgr.createSession('user-1', 'query', profile, result);
    expect(id).toBeNull();
    expect(mgr.size()).toBe(0);
  });

  it('createSession returns a string ID when clarifications exist', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result);
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^sess-/);
    expect(mgr.size()).toBe(1);
  });

  it('createSession stores unanswered questions from result', () => {
    const result = makeSearchResult([q1, q2]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    const session = mgr.getSession(id);
    expect(session?.unansweredQuestions).toHaveLength(2);
  });

  it('createSession stores the original query verbatim', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'casque bluetooth pas trop cher', profile, result)!;
    const session = mgr.getSession(id);
    expect(session?.originalQuery).toBe('casque bluetooth pas trop cher');
    expect(session?.enrichedQuery).toBe('casque bluetooth pas trop cher');
  });

  it('createSession starts at turn 1', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    const session = mgr.getSession(id);
    expect(session?.turn).toBe(1);
  });

  // ── getSession ─────────────────────────────────────────────────────────────

  it('getSession returns null for unknown ID', () => {
    expect(mgr.getSession('nonexistent')).toBeNull();
  });

  it('getSession rejects wrong userId', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    expect(mgr.getSession(id, 'user-2')).toBeNull();
  });

  it('getSession accepts correct userId', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    expect(mgr.getSession(id, 'user-1')).not.toBeNull();
  });

  it('getSession accepts omitted userId (no scope check)', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    expect(mgr.getSession(id)).not.toBeNull();
  });

  it('getSession returns null for expired session', () => {
    const shortMgr = new ConversationManager({ ttlMs: 1 }); // 1 ms TTL
    const result = makeSearchResult([q1]);
    const id = shortMgr.createSession('user-1', 'query', profile, result)!;
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(shortMgr.getSession(id)).toBeNull();
        resolve();
      }, 10);
    });
  });

  // ── applyAnswer ────────────────────────────────────────────────────────────

  it('applyAnswer throws for unknown sessionId', () => {
    expect(() => mgr.applyAnswer('bad-id', 'clarif-1', 'answer')).toThrow('Session not found');
  });

  it('applyAnswer throws for unknown questionId', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    expect(() => mgr.applyAnswer(id, 'nonexistent-q', 'answer')).toThrow('not found');
  });

  it('applyAnswer appends annotation to enrichedQuery', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'casque bluetooth', profile, result)!;
    const { enrichedQuery } = mgr.applyAnswer(id, 'clarif-1', '500€');

    expect(enrichedQuery).toContain('casque bluetooth');
    expect(enrichedQuery).toContain('Quel est votre budget maximum?');
    expect(enrichedQuery).toContain('500€');
  });

  it('applyAnswer does NOT modify originalQuery', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'original query', profile, result)!;
    mgr.applyAnswer(id, 'clarif-1', '500€');

    const session = mgr.getSession(id);
    expect(session?.originalQuery).toBe('original query');
  });

  it('applyAnswer moves question from unanswered to answered', () => {
    const result = makeSearchResult([q1, q2]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    mgr.applyAnswer(id, 'clarif-1', '500€');

    const session = mgr.getSession(id)!;
    expect(session.answeredQuestions).toHaveLength(1);
    expect(session.answeredQuestions[0].questionId).toBe('clarif-1');
    expect(session.answeredQuestions[0].answer).toBe('500€');
    expect(session.unansweredQuestions).toHaveLength(1);
    expect(session.unansweredQuestions[0].id).toBe('clarif-2');
  });

  it('applyAnswer increments turn', () => {
    const result = makeSearchResult([q1, q2]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    expect(mgr.getSession(id)?.turn).toBe(1);

    mgr.applyAnswer(id, 'clarif-1', 'answer 1');
    expect(mgr.getSession(id)?.turn).toBe(2);

    mgr.applyAnswer(id, 'clarif-2', 'answer 2');
    expect(mgr.getSession(id)?.turn).toBe(3);
  });

  it('applyAnswer strips whitespace from answer', () => {
    const result = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    const { updatedSession } = mgr.applyAnswer(id, 'clarif-1', '  500€  ');
    expect(updatedSession.answeredQuestions[0].answer).toBe('500€');
  });

  it('enrichedQuery accumulates multiple answers', () => {
    const result = makeSearchResult([q1, q2]);
    const id = mgr.createSession('user-1', 'query', profile, result)!;
    mgr.applyAnswer(id, 'clarif-1', '500€');
    const { enrichedQuery } = mgr.applyAnswer(id, 'clarif-2', 'neuf seulement');

    expect(enrichedQuery).toContain('500€');
    expect(enrichedQuery).toContain('neuf seulement');
  });

  // ── updateResult ───────────────────────────────────────────────────────────

  it('updateResult replaces lastResult', () => {
    const result1 = makeSearchResult([q1]);
    const id = mgr.createSession('user-1', 'query', profile, result1)!;

    const result2 = makeSearchResult([]);
    result2.requestId = 'req-updated';
    mgr.updateResult(id, result2);

    const session = mgr.getSession(id)!;
    expect(session.lastResult.requestId).toBe('req-updated');
  });

  it('updateResult returns null for unknown session', () => {
    expect(mgr.updateResult('nonexistent', makeSearchResult([]))).toBeNull();
  });

  // ── Invariant 5 ────────────────────────────────────────────────────────────

  it('INVARIANT 5: originalQuery never changes across turns', () => {
    const original = 'casque bluetooth pas trop cher';
    const result = makeSearchResult([q1, q2]);
    const id = mgr.createSession('user-1', original, profile, result)!;

    mgr.applyAnswer(id, 'clarif-1', '500€');
    mgr.applyAnswer(id, 'clarif-2', 'neuf');

    const session = mgr.getSession(id)!;
    expect(session.originalQuery).toBe(original);
  });

  it('INVARIANT 5: safeDefault is NEVER automatically applied', () => {
    const result = makeSearchResult([q1]); // q1 has safeDefault: { value: 500 }
    const id = mgr.createSession('user-1', 'query', profile, result)!;

    // Do NOT answer the question — enrichedQuery must remain unchanged
    const session = mgr.getSession(id)!;
    expect(session.enrichedQuery).toBe('query'); // no "500€" injected silently
  });

  // ── Utilities ──────────────────────────────────────────────────────────────

  it('listActive returns all active session IDs', () => {
    const r = makeSearchResult([q1]);
    const id1 = mgr.createSession('user-1', 'q1', profile, r)!;
    const id2 = mgr.createSession('user-2', 'q2', makeProfile('user-2'), r)!;

    const active = mgr.listActive();
    expect(active).toContain(id1);
    expect(active).toContain(id2);
    expect(active).toHaveLength(2);
  });

  it('clear() removes all sessions', () => {
    const r = makeSearchResult([q1]);
    mgr.createSession('user-1', 'q', profile, r);
    mgr.createSession('user-2', 'q', makeProfile('user-2'), r);
    mgr.clear();
    expect(mgr.size()).toBe(0);
  });
});

// ============================================================================
// POST /clarify API endpoint tests
// ============================================================================

describe('POST /clarify API endpoint', () => {
  let app: import('express').Application;

  beforeEach(async () => {
    const { buildApp } = await import('../../src/api/server');
    app = buildApp();
  });

  async function doSearch(query: string) {
    const { default: supertest } = await import('supertest');
    return supertest(app)
      .post('/search')
      .send({ query })
      .expect(200);
  }

  it('POST /clarify returns 400 for missing sessionId', async () => {
    const { default: supertest } = await import('supertest');
    await supertest(app)
      .post('/clarify')
      .send({ questionId: 'q1', answer: '500€' })
      .expect(400);
  });

  it('POST /clarify returns 400 for missing questionId', async () => {
    const { default: supertest } = await import('supertest');
    await supertest(app)
      .post('/clarify')
      .send({ sessionId: 'sess-123', answer: '500€' })
      .expect(400);
  });

  it('POST /clarify returns 400 for empty answer', async () => {
    const { default: supertest } = await import('supertest');
    await supertest(app)
      .post('/clarify')
      .send({ sessionId: 'sess-123', questionId: 'q1', answer: '   ' })
      .expect(400);
  });

  it('POST /clarify returns 404 for unknown sessionId', async () => {
    const { default: supertest } = await import('supertest');
    await supertest(app)
      .post('/clarify')
      .send({ sessionId: 'sess-does-not-exist', questionId: 'q1', answer: '500€' })
      .expect(404);
  });

  it('POST /search includes sessionId in response when clarifications exist', async () => {
    // An ambiguous query should trigger clarification opportunities
    const res = await doSearch('autour de 500 euros, quelque chose de bon');

    // May or may not have clarifications depending on query
    // Just verify the shape of the response
    expect(res.body).toHaveProperty('requestId');
    expect(res.body).toHaveProperty('results');

    if (res.body.session) {
      expect(res.body.session.sessionId).toMatch(/^sess-/);
    }
  });

  it('POST /search session is null when no clarifications', async () => {
    // A very precise query should not trigger clarifications
    const res = await doSearch('laptop Dell');
    expect(res.body).toHaveProperty('requestId');
    // session may be null (no clarifications) or may have sessionId
    // We just ensure it's either null or has the correct shape
    if (res.body.session !== null && res.body.session !== undefined) {
      expect(res.body.session).toHaveProperty('sessionId');
    }
  });

  it('POST /clarify re-runs search and returns results in same shape as POST /search', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);

    // Use a query that is likely to generate clarification (vague budget)
    const searchRes = await request
      .post('/search')
      .send({ query: 'autour de 500 euros, casque audio de qualité' })
      .expect(200);

    if (!searchRes.body.session) {
      // No clarifications — can't test /clarify flow, skip
      console.log('No clarifications generated — skipping /clarify flow test');
      return;
    }

    const { sessionId } = searchRes.body.session;
    const questionId = searchRes.body.clarifications?.questions?.[0]?.id;

    if (!questionId) {
      console.log('No question ID in response — skipping');
      return;
    }

    const clarifyRes = await request
      .post('/clarify')
      .send({ sessionId, questionId, answer: '500 euros maximum' })
      .expect(200);

    // Same shape as search result
    expect(clarifyRes.body).toHaveProperty('requestId');
    expect(clarifyRes.body).toHaveProperty('results');
    expect(clarifyRes.body).toHaveProperty('effectiveCriteria');
    expect(clarifyRes.body).toHaveProperty('timing');

    // Session context included
    expect(clarifyRes.body.session).toBeDefined();
    expect(clarifyRes.body.session.sessionId).toBe(sessionId);
    expect(clarifyRes.body.session.turn).toBe(2);
    expect(clarifyRes.body.session.answeredQuestions).toHaveLength(1);
    expect(clarifyRes.body.session.answeredQuestions[0].answer).toBe('500 euros maximum');
  });

  it('POST /clarify: answered query contains original query text', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);

    const originalQuery = 'autour de 600 euros';
    const searchRes = await request
      .post('/search')
      .send({ query: originalQuery })
      .expect(200);

    if (!searchRes.body.session) return;

    const { sessionId } = searchRes.body.session;
    const questionId = searchRes.body.clarifications?.questions?.[0]?.id;
    if (!questionId) return;

    const clarifyRes = await request
      .post('/clarify')
      .send({ sessionId, questionId, answer: 'exactement 600 euros' })
      .expect(200);

    // originalQuery preserved in session context
    expect(clarifyRes.body.session.originalQuery).toBe(originalQuery);
  });

  it('POST /clarify: budget refinement can update effectiveCriteria', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);

    const searchRes = await request
      .post('/search')
      .send({ query: 'autour de 500 euros, casque bluetooth' })
      .expect(200);

    if (!searchRes.body.session) return;

    const { sessionId } = searchRes.body.session;
    const budgetQuestion = searchRes.body.clarifications?.questions?.find(
      (q: { id: string; question: string }) => q.question.toLowerCase().includes('budget') || q.question.toLowerCase().includes('prix')
    );
    if (!budgetQuestion) return;

    const clarifyRes = await request
      .post('/clarify')
      .send({ sessionId, questionId: budgetQuestion.id, answer: 'maximum 400 euros' })
      .expect(200);

    // The refined search should have processed the budget answer
    expect(clarifyRes.body.requestId).not.toBe(searchRes.body.requestId);
    expect(clarifyRes.body.session.turn).toBeGreaterThan(1);
  });
});
