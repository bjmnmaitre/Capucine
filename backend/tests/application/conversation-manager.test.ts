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

function makeSearchResultWithCriteria(
  criteria: PreferenceCriterion[],
  suggestedSearchTerms: string[],
  opportunities: ClarificationItem[] = []
): any {
  const base = makeSearchResult(opportunities);
  return {
    ...base,
    effectiveCriteria: criteria,
    interpretedRequest: { extractedCriteria: criteria, suggestedSearchTerms },
  };
}

function makeSearchResult(opportunities: ClarificationItem[] = []): any {
  return {
    requestId: 'req-test',
    completedAt: new Date(),
    durationMs: 50,
    language: 'fr',
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
// createFollowUpSession / applyFollowUp — conversational refinement turns
// (megaprompt PARTIE 1/3): "élargis à 1100€", "et avec 32 Go ?",
// "uniquement du neuf" MODIFY the current search rather than starting a new one.
// ============================================================================

describe('ConversationManager — conversational follow-ups', () => {
  let mgr: ConversationManager;
  const profile = makeProfile();

  const budgetCriterion: PreferenceCriterion = {
    id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000, currency: 'EUR' },
  };
  const ramCriterion: PreferenceCriterion = {
    id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' },
  };

  beforeEach(() => {
    mgr = new ConversationManager({ ttlMs: 60_000 });
  });

  it('createFollowUpSession always returns a session id, even with zero clarification opportunities', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable moins de 1000 euros', profile, result);
    expect(typeof id).toBe('string');
    expect(mgr.size()).toBe(1);
  });

  it('seeds currentCriteria from interpretedRequest.extractedCriteria and searchText from suggestedSearchTerms', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion, ramCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable 16 Go moins de 1000 euros', profile, result);
    const session = mgr.getSession(id)!;
    expect(session.currentCriteria).toEqual([budgetCriterion, ramCriterion]);
    expect(session.searchText).toBe('ordinateur portable');
    // originalQuery stays the real, full, unmodified text — searchText is a
    // separate internal field, never shown to the user as "what they typed".
    expect(session.originalQuery).toBe('ordinateur portable 16 Go moins de 1000 euros');
  });

  it('searchText falls back to the full query when interpretation produced no suggestedSearchTerms', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], [], []);
    const id = mgr.createFollowUpSession('user-1', 'casque bluetooth', profile, result);
    expect(mgr.getSession(id)!.searchText).toBe('casque bluetooth');
  });

  it('seeds language from the original result — a follow-up must not silently fall back to French', () => {
    const result = { ...makeSearchResultWithCriteria([budgetCriterion], ['laptop'], []), language: 'en' };
    const id = mgr.createFollowUpSession('user-1', 'laptop under 1000 euros', profile, result);
    expect(mgr.getSession(id)!.language).toBe('en');
  });

  it('applyFollowUp replaces a criterion with the same id (last wins) and keeps the others untouched', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion, ramCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable 16 Go moins de 1000 euros', profile, result);

    const widenedBudget: PreferenceCriterion = {
      id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1100, currency: 'EUR' },
    };
    const { mergedCriteria } = mgr.applyFollowUp(id, 'élargis à 1100€', [widenedBudget]);

    expect(mergedCriteria).toHaveLength(2);
    expect(mergedCriteria.find(c => c.id === 'budget')?.parameters?.maxBudget).toBe(1100);
    // RAM criterion, untouched by this follow-up, carries over unchanged.
    expect(mergedCriteria.find(c => c.id === 'ram')?.parameters?.minValue).toBe(16);
  });

  it('applyFollowUp ADDS a new criterion id instead of dropping existing ones', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable moins de 1000 euros', profile, result);

    const conditionCriterion: PreferenceCriterion = {
      id: 'condition', name: 'État du produit', level: 'required', parameters: { preferredValues: ['new'], unknownPolicy: 'pass' },
    };
    const { mergedCriteria } = mgr.applyFollowUp(id, 'uniquement du neuf', [conditionCriterion]);

    expect(mergedCriteria.map(c => c.id).sort()).toEqual(['budget', 'condition']);
  });

  it('applyFollowUp increments turn and records the follow-up text for audit, without touching originalQuery', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable moins de 1000 euros', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'élargis à 1100€', [
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1100 } },
    ]);

    expect(updatedSession.turn).toBe(2);
    expect(updatedSession.originalQuery).toBe('ordinateur portable moins de 1000 euros');
    expect(updatedSession.answeredQuestions).toHaveLength(1);
    expect(updatedSession.answeredQuestions[0].answer).toBe('élargis à 1100€');
  });

  it('applyFollowUp throws for an unknown sessionId (same contract as applyAnswer)', () => {
    expect(() => mgr.applyFollowUp('bad-id', 'élargis à 1100€', [])).toThrow('Session not found');
  });

  it('a follow-up session created via createFollowUpSession can be continued a second time', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable moins de 1000 euros', profile, result);

    mgr.applyFollowUp(id, 'élargis à 1100€', [
      { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1100 } },
    ]);
    const { mergedCriteria } = mgr.applyFollowUp(id, 'et avec 32 Go', [
      { id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 32, unit: 'GB' } },
    ]);

    expect(mergedCriteria.find(c => c.id === 'budget')?.parameters?.maxBudget).toBe(1100);
    expect(mergedCriteria.find(c => c.id === 'ram')?.parameters?.minValue).toBe(32);
    expect(mgr.getSession(id)!.turn).toBe(3);
  });

  // ── M/N/P. session state — rankingPreference/targetCountries/destinationCountry ──

  it('a new session defaults to BEST_MATCH ranking, France as destination, and [FR] as target countries', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);
    const session = mgr.getSession(id)!;
    expect(session.rankingPreference).toBe('BEST_MATCH');
    expect(session.destinationCountry).toBe('FR');
    expect(session.targetCountries).toEqual(['FR']);
  });

  it('une préférence PERMANENTE PRICE_LOWEST est l\'ordre de départ de la session', () => {
    const cheapestProfile: UserProfile = {
      ...profile,
      preferences: {
        ...profile.preferences,
        criteria: [{
          id: 'ranking-preference', name: 'Toujours le moins cher',
          level: 'preference', parameters: { rankingPreference: 'PRICE_LOWEST' },
        }],
      },
    };
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', cheapestProfile, result);
    expect(mgr.getSession(id)!.rankingPreference).toBe('PRICE_LOWEST');
  });

  it('un affinage explicite « meilleure correspondance » annule le PRICE_LOWEST permanent POUR CETTE conversation', () => {
    const cheapestProfile: UserProfile = {
      ...profile,
      preferences: {
        ...profile.preferences,
        criteria: [{
          id: 'ranking-preference', name: 'Toujours le moins cher',
          level: 'preference', parameters: { rankingPreference: 'PRICE_LOWEST' },
        }],
      },
    };
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', cheapestProfile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'trie par meilleure correspondance', [], undefined, {
      rankingPreference: 'BEST_MATCH',
    });
    expect(updatedSession.rankingPreference).toBe('BEST_MATCH');
    // le profil permanent lui-même n'est pas touché
    expect(mgr.getSession(id)!.profile.preferences.criteria[0].parameters!.rankingPreference).toBe('PRICE_LOWEST');
  });

  it('J. a rankingPreference set via applyFollowUp persists across LATER follow-ups that don\'t mention it', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'montre-moi les moins chers', [], undefined, { rankingPreference: 'PRICE_LOWEST' });
    // A later, unrelated follow-up (no rankingPreference passed) must NOT reset it.
    const { updatedSession } = mgr.applyFollowUp(id, 'uniquement neuf', [
      { id: 'condition', name: 'État du produit', level: 'required', parameters: { preferredValues: ['new'], unknownPolicy: 'pass' } },
    ]);
    expect(updatedSession.rankingPreference).toBe('PRICE_LOWEST');
  });

  it('K/L/M. targetCountries accumulate ADDITIVELY across follow-ups — never reset, never replaced', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'cherche aussi en Allemagne', [], undefined, {
      internationalIntent: { targetCountries: ['DE'], broaden: false },
    });
    expect(mgr.getSession(id)!.targetCountries.sort()).toEqual(['DE', 'FR']);

    const { updatedSession } = mgr.applyFollowUp(id, 'regarde aussi en Espagne', [], undefined, {
      internationalIntent: { targetCountries: ['ES'], broaden: false },
    });
    // Germany from the PREVIOUS turn is still there — not replaced by Spain.
    expect(updatedSession.targetCountries.sort()).toEqual(['DE', 'ES', 'FR']);
    // destinationCountry (where the user lives) is untouched by an
    // international SEARCH SCOPE change — those are different dimensions.
    expect(updatedSession.destinationCountry).toBe('FR');
  });

  it('"cherche partout en Europe" (broaden, no named country) adds the curated default set', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'cherche partout en Europe', [], undefined, {
      internationalIntent: { targetCountries: [], broaden: true },
    });
    expect(updatedSession.targetCountries).toContain('FR');
    expect(updatedSession.targetCountries.length).toBeGreaterThan(1); // real countries added, not an unbounded "everywhere"
  });

  it('M. a follow-up that only changes ranking/international state leaves currentCriteria (category/RAM/budget/condition) fully intact', () => {
    const ramCriterion: PreferenceCriterion = { id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } };
    const result = makeSearchResultWithCriteria([budgetCriterion, ramCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'cherche aussi en Allemagne', [], undefined, {
      internationalIntent: { targetCountries: ['DE'], broaden: false },
    });
    expect(updatedSession.currentCriteria.map(c => c.id).sort()).toEqual(['budget', 'ram']);
    expect(updatedSession.currentCriteria.find(c => c.id === 'ram')?.parameters?.minValue).toBe(16);
  });

  // ── resultLimit / excludedMerchantNames persistence (megaprompt tours 8-10) ──

  it('a new session has no resultLimit and no excluded merchants', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);
    const session = mgr.getSession(id)!;
    expect(session.resultLimit).toBeUndefined();
    expect(session.excludedMerchantNames).toEqual([]);
  });

  it('"montre-moi les 3 meilleures" sets resultLimit, which persists across a later unrelated follow-up', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'montre-moi les 3 meilleures', [], undefined, { resultLimit: 3 });
    const { updatedSession } = mgr.applyFollowUp(id, 'uniquement neuf', [
      { id: 'condition', name: 'État du produit', level: 'required', parameters: { preferredValues: ['new'], unknownPolicy: 'pass' } },
    ]);
    expect(updatedSession.resultLimit).toBe(3);
  });

  it('excludedMerchantNames accumulate ADDITIVELY — "exclue Amazon" then later "exclue Fnac" keeps both', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'exclue Amazon', [], undefined, { excludeMerchantName: 'Amazon' });
    const { updatedSession } = mgr.applyFollowUp(id, 'exclue Fnac', [], undefined, { excludeMerchantName: 'Fnac' });
    expect(updatedSession.excludedMerchantNames.sort()).toEqual(['Amazon', 'Fnac']);
  });

  it('the SAME merchant excluded twice is not duplicated', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'exclue Amazon', [], undefined, { excludeMerchantName: 'Amazon' });
    const { updatedSession } = mgr.applyFollowUp(id, 'exclue Amazon', [], undefined, { excludeMerchantName: 'Amazon' });
    expect(updatedSession.excludedMerchantNames).toEqual(['Amazon']);
  });

  // ── SEARCH_AGAIN / SEARCH_ELSEWHERE / FIND_BETTER (megaprompt PARTIE 3/4) ──

  function rankedOffer(merchantName: string, productId: string): any {
    return { offer: { merchant: { name: merchantName }, productId } };
  }

  it('a new session seeds seenMerchantNames/seenProductIds from the offers actually shown in the FIRST search', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a'), rankedOffer('LDLC', 'prod-b')];
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);
    const session = mgr.getSession(id)!;
    expect(session.seenMerchantNames.sort()).toEqual(['Fnac', 'LDLC']);
    expect(session.seenProductIds.sort()).toEqual(['prod-a', 'prod-b']);
  });

  it('updateResult ACCUMULATES seen merchants/products across turns — never resets', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a')];
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const secondResult = { ...result, ranking: { rankedOffers: [rankedOffer('LDLC', 'prod-b')] } };
    mgr.updateResult(id, secondResult);

    const session = mgr.getSession(id)!;
    expect(session.seenMerchantNames.sort()).toEqual(['Fnac', 'LDLC']); // both turns, not just the latest
    expect(session.seenProductIds.sort()).toEqual(['prod-a', 'prod-b']);
  });

  it('SEARCH_ELSEWHERE adds every already-seen merchant to excludedMerchantNames', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a'), rankedOffer('LDLC', 'prod-b')];
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'cherche ailleurs', [], undefined, { retryIntent: 'SEARCH_ELSEWHERE' });
    expect(updatedSession.excludedMerchantNames.sort()).toEqual(['Fnac', 'LDLC']);
    // A retry intent must never touch existing criteria (category/budget/etc).
    expect(updatedSession.currentCriteria.map(c => c.id)).toEqual(['budget']);
  });

  it('SEARCH_AGAIN excludes seen merchants AND broadens targetCountries when NO SearchCoverage data exists (local catalog path — absence of coverage is not evidence of sufficiency, so the honest default is to broaden)', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a')];
    // No `discovery` field at all on this fixture — exercises the
    // optional-chaining fallback, same as the real local-catalog path
    // (RealWebDiscoveryStrategy never ran, so no coverage was ever computed).
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'cherche encore', [], undefined, { retryIntent: 'SEARCH_AGAIN' });
    expect(updatedSession.excludedMerchantNames).toEqual(['Fnac']);
    expect(updatedSession.targetCountries).toContain('FR');
    expect(updatedSession.targetCountries.length).toBeGreaterThan(1); // real broadening, not a no-op
  });

  // ── F. SEARCH_AGAIN's broadening decision is driven by REAL SearchCoverage
  // (search-coverage.ts, reused — not a second notion of coverage) ──

  function withCoverage(result: any, saturated: boolean): any {
    return {
      ...result,
      discovery: {
        statistics: {
          coverage: {
            queriesExecuted: 3, sourcesAttempted: 2, sourcesFailed: 0,
            rawResultsCount: 10, uniqueDomains: saturated ? 6 : 1,
            productPagesIdentified: 8, exploitableOffers: saturated ? 8 : 1,
            duplicatesRemoved: 1, domainDiversity: saturated ? 0.6 : 0.1,
            saturated, recommendation: saturated ? 'stop' : 'continue',
            reason: saturated ? 'enough' : 'not enough',
          },
        },
      },
    };
  }

  it('F. SEARCH_AGAIN does NOT broaden internationally when the last search\'s coverage was already saturated — only excludes seen merchants, exactly like SEARCH_ELSEWHERE', () => {
    const result = withCoverage(makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []), true);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a')];
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'cherche encore', [], undefined, { retryIntent: 'SEARCH_AGAIN' });
    expect(updatedSession.excludedMerchantNames).toEqual(['Fnac']); // still avoids what was seen
    expect(updatedSession.targetCountries).toEqual(['FR']); // NOT broadened — coverage was already sufficient
  });

  it('F2. SEARCH_AGAIN DOES broaden internationally when the last search\'s coverage was NOT saturated (real evidence more coverage would help)', () => {
    const result = withCoverage(makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []), false);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a')];
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'cherche encore', [], undefined, { retryIntent: 'SEARCH_AGAIN' });
    expect(updatedSession.targetCountries.length).toBeGreaterThan(1);
  });

  it('SEARCH_AGAIN does NOT broaden a second time if the user already explicitly scoped an international search', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'cherche aussi en Allemagne', [], undefined, {
      internationalIntent: { targetCountries: ['DE'], broaden: false },
    });
    const { updatedSession } = mgr.applyFollowUp(id, 'cherche encore', [], undefined, { retryIntent: 'SEARCH_AGAIN' });
    expect(updatedSession.targetCountries.sort()).toEqual(['DE', 'FR']); // unchanged by SEARCH_AGAIN's broadening
  });

  it('FIND_BETTER excludes already-seen PRODUCTS (excludedOfferIds), not merchants — a different offer from the same merchant is still a valid "better" candidate', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    result.ranking.rankedOffers = [rankedOffer('Fnac', 'prod-a'), rankedOffer('LDLC', 'prod-b')];
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    const { updatedSession } = mgr.applyFollowUp(id, 'trouve une meilleure offre', [], undefined, { retryIntent: 'FIND_BETTER' });
    expect(updatedSession.excludedOfferIds.sort()).toEqual(['prod-a', 'prod-b']);
    expect(updatedSession.excludedMerchantNames).toEqual([]); // merchants NOT excluded
  });

  it('a retry intent never disturbs currentCriteria, rankingPreference, or resultLimit already set', () => {
    const result = makeSearchResultWithCriteria([budgetCriterion], ['ordinateur', 'portable'], []);
    const id = mgr.createFollowUpSession('user-1', 'ordinateur portable', profile, result);

    mgr.applyFollowUp(id, 'montre-moi les moins chers', [], undefined, { rankingPreference: 'PRICE_LOWEST' });
    mgr.applyFollowUp(id, 'montre-moi les 3 meilleures', [], undefined, { resultLimit: 3 });
    const { updatedSession } = mgr.applyFollowUp(id, 'cherche ailleurs', [], undefined, { retryIntent: 'SEARCH_ELSEWHERE' });

    expect(updatedSession.rankingPreference).toBe('PRICE_LOWEST');
    expect(updatedSession.resultLimit).toBe(3);
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
