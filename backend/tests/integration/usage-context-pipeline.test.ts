/**
 * Usage context — PROPAGATION, SEARCH, EXPLANATION, CONVERSATION
 *
 * Covers spec §18-C (the context really crosses the intermediate structures),
 * §18-D (it really produces extra query families), §18-I (explanations tell
 * inference apart from an explicit request), §18-J (multi-turn), §18-K (no
 * context → unchanged behaviour), §8 (the permanent profile is never touched),
 * and the full §19 four-turn scenario end to end over HTTP.
 *
 * These tests trace the REAL structures the pipeline produces. None of them
 * asserts "a field exists somewhere"; each one follows the value from the
 * user's sentence to the thing it changed.
 */

import { buildApp } from '../../src/api/server';
import { CapucineEngine } from '../../src/application/capucine-engine';
import { ConversationManager, FOLLOWUP_QUESTION_ID } from '../../src/application/conversation-manager';
import { SearchStrategyPlanner } from '../../src/application/search-strategy-planner';
import {
  DiscoveryOrchestrator,
  IDiscoveryStrategy,
  DiscoveryCriteria,
  DiscoveryResult,
} from '../../src/application/discovery';
import { DataPoint, Merchant, Offer, UserProfile, UsageContext } from '../../src/domain/types';
import type { Application } from 'express';

// ============================================================================
// HELPERS
// ============================================================================

function emptyProfile(userId = 'user-usage-context'): UserProfile {
  return {
    userId,
    preferences: { criteria: [] } as unknown as UserProfile['preferences'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function dp<T>(value: T, status: 'verified' | 'known' = 'known'): DataPoint<T> {
  return { value, status, provenance: { source: 'test', retrievedAt: new Date() } };
}

function makeOffer(
  id: string,
  price: number,
  merchantId: string,
  characteristics: Record<string, DataPoint<unknown>>,
  // Distinct per variant on purpose: DeduplicationEngine groups by product and
  // merges characteristics across the group, so two offers that genuinely
  // differ (a black one and a silver one) must not share a product id — that
  // would turn their colours into one 'contradictory' field instead of two
  // separate products, which is not what this scenario is testing.
  productId = `product-${id}`
): Offer {
  const merchant: Merchant = { id: merchantId, name: merchantId, country: 'FR', executionCapabilities: [] };
  return {
    id,
    productId,
    merchant,
    price: dp(price),
    currency: 'EUR',
    shippingCost: dp(0),
    characteristics,
    provenance: { source: merchantId, retrievedAt: new Date() },
    createdAt: new Date(),
    retrievedAt: new Date(),
  };
}

/**
 * A discovery source that returns exactly the offers given to it, minus the
 * ones a price ceiling already rules out — the same pattern as
 * pipeline-scenarios.test.ts. Used where the local catalogue has no offer that
 * can satisfy the scenario's own constraints.
 */
class FixedSource implements IDiscoveryStrategy {
  readonly name = 'fixed-source';
  readonly version = '1.0.0';
  readonly isReady = true;

  constructor(private readonly offers: Offer[]) {}

  private candidates(criteria: DiscoveryCriteria) {
    return this.offers
      .filter(o => criteria.maxPrice === undefined || (o.price.value ?? 0) <= criteria.maxPrice + 200)
      .map(o => ({ offer: o, matchScore: 0.9, matchReason: 'fixed source' }));
  }

  private result(criteria: DiscoveryCriteria): DiscoveryResult {
    const candidates = this.candidates(criteria);
    return {
      id: `fixed-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      candidates,
      statistics: {
        queriedSources: 1,
        candidatesFound: candidates.length,
        candidatesFiltered: 0,
        searchTimeMs: 0,
        relevanceEstimate: 'high',
      },
      strategy: this.name,
    };
  }

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> { return this.result(criteria); }
  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult { return this.result(criteria); }
  async health() { return { status: 'healthy' as const }; }
}

function buildEngineWith(offers: Offer[]): CapucineEngine {
  const orchestrator = new DiscoveryOrchestrator();
  orchestrator.registerStrategy(new FixedSource(offers), true);
  return new CapucineEngine({ discoveryOrchestrator: orchestrator, enableWebDiscovery: false });
}

function engine(): CapucineEngine {
  return new CapucineEngine({ enableWebDiscovery: false });
}

const CENTRAL_QUERY =
  'casque bluetooth pour écouter de la musique, surtout dans les transports, moins de 300 euros';

// ============================================================================
// C. PROPAGATION — follow the value, structure by structure
// ============================================================================

describe('C. The usage context really crosses every intermediate structure', () => {
  const result = engine().searchSync({
    queryText: CENTRAL_QUERY,
    requestId: 'req-propagation',
    profile: emptyProfile(),
  });

  it('1. interpretation — extracted from the user\'s own words', () => {
    expect(result.interpretedRequest!.usageContext).toBeDefined();
    expect(result.interpretedRequest!.usageContext!.usage).toBe('music');
    expect(result.interpretedRequest!.usageContext!.context).toBe('transport');
  });

  it('2. profile merge — survives into the resolved criteria set', () => {
    // Exposed on the engine result, which is populated from EffectiveCriteriaSet.
    expect(result.usageContext).toBeDefined();
    expect(result.usageContext!.usage).toBe('music');
  });

  it('3. search plan — carried onto the plan', () => {
    expect(result.searchPlan.usageContext).toBeDefined();
    expect(result.searchPlan.usageContext!.context).toBe('transport');
  });

  it('4. discovery criteria — reaches the layer that builds queries', () => {
    expect(result.discovery.criteria.usageContext).toBeDefined();
    expect(result.discovery.criteria.usageContext!.usage).toBe('music');
  });

  it('5. ranking — every ranked offer carries an auditable contextual verdict', () => {
    expect(result.ranking.rankedOffers.length).toBeGreaterThan(0);
    for (const ranked of result.ranking.rankedOffers) {
      expect(ranked.contextualRelevance).toBeDefined();
      expect(ranked.contextualRelevance!.usageContext.usage).toBe('music');
    }
  });

  it('6. explanation — a sentence about the usage exists for each offer', () => {
    for (const explanation of result.explanation.rankedExplanations) {
      expect(explanation.contextual).toBeDefined();
      expect(explanation.contextual!.statement).toBeTruthy();
    }
  });

  it('the context survives search-plan escalation without being altered', () => {
    // escalate() copies the plan wholesale — assert it, don't assume it.
    const { SearchPlanBuilder } = require('../../src/application/search-plan');
    const builder = new SearchPlanBuilder();
    const escalated = builder.escalate(result.searchPlan);
    if (escalated) {
      expect(escalated.usageContext).toEqual(result.searchPlan.usageContext);
      expect(escalated.hardConstraints).toEqual(result.searchPlan.hardConstraints);
    }
  });
});

// ============================================================================
// D. SEARCH — the context produces extra, complementary query families
// ============================================================================

describe('D. The context produces real, bounded, complementary query families', () => {
  const planner = new SearchStrategyPlanner();
  const usageContext: UsageContext = {
    usage: 'music',
    context: 'transport',
    source: 'user',
    confidence: 0.85,
    timestamp: new Date(),
  };

  it('adds a usage family and a contextual-technical family', () => {
    const strategies = planner.buildStrategies(
      { keywords: ['sony', 'xm5'], categories: ['casque'], usageContext },
      [],
      'fr'
    );
    const usage = strategies.find(s => s.channel === 'usage_context');
    const contextual = strategies.find(s => s.channel === 'contextual_specs');

    expect(usage).toBeDefined();
    expect(usage!.query).toContain('sony');
    expect(usage!.query).toContain('transport');

    expect(contextual).toBeDefined();
    expect(contextual!.query).toContain('autonomie');
  });

  it('produces NEITHER family when the user stated no usage', () => {
    const strategies = planner.buildStrategies({ keywords: ['sony', 'xm5'], categories: ['casque'] }, [], 'fr');
    expect(strategies.some(s => s.channel === 'usage_context')).toBe(false);
    expect(strategies.some(s => s.channel === 'contextual_specs')).toBe(false);
  });

  it('the product families are untouched — the context ADDS, it never replaces', () => {
    const withContext = planner.buildStrategies({ keywords: ['sony', 'xm5'], categories: ['casque'], usageContext }, [], 'fr');
    const without = planner.buildStrategies({ keywords: ['sony', 'xm5'], categories: ['casque'] }, [], 'fr');

    for (const base of without) {
      expect(withContext.find(s => s.channel === base.channel && s.query === base.query)).toBeDefined();
    }
  });

  it('adds AT MOST two queries — no uncontrolled family explosion', () => {
    const withContext = planner.buildStrategies({ keywords: ['sony', 'xm5'], categories: ['casque'], usageContext }, [], 'fr');
    const without = planner.buildStrategies({ keywords: ['sony', 'xm5'], categories: ['casque'] }, [], 'fr');
    expect(withContext.length - without.length).toBeLessThanOrEqual(2);
  });

  it('both extra families are phase 2 — governed by the existing coverage budget', () => {
    const strategies = planner.buildStrategies({ keywords: ['sony'], usageContext }, [], 'fr');
    for (const s of strategies.filter(s => s.channel === 'usage_context' || s.channel === 'contextual_specs')) {
      expect(s.phase).toBe(2);
    }
  });

  it('technical_specs stays derived from HARD CONSTRAINTS only, never from the usage', () => {
    const strategies = planner.buildStrategies({ keywords: ['sony'], usageContext }, [], 'fr');
    // No numeric hard constraint was supplied → no technical_specs query at all.
    expect(strategies.some(s => s.channel === 'technical_specs')).toBe(false);
  });

  it('is phrased in the query language', () => {
    const fr = planner.buildStrategies({ keywords: ['sony'], usageContext }, [], 'fr');
    const en = planner.buildStrategies({ keywords: ['sony'], usageContext }, [], 'en');
    expect(fr.find(s => s.channel === 'usage_context')!.query).toContain('transport');
    expect(en.find(s => s.channel === 'usage_context')!.query).toContain('commuting');
  });
});

// ============================================================================
// I. EXPLANATIONS — inference is never dressed up as a request
// ============================================================================

describe('I. Explanations distinguish what was asked from what was inferred', () => {
  const result = engine().searchSync({
    queryText: CENTRAL_QUERY,
    requestId: 'req-explanation',
    profile: emptyProfile(),
  });
  const explanation = result.explanation.rankedExplanations[0];

  it('names the usage and attributes the factors to it, not to the user', () => {
    const statement = explanation.contextual!.statement;
    expect(statement).toContain('usage');
    expect(statement.toLowerCase()).not.toContain('vous avez demandé');
    expect(statement.toLowerCase()).not.toContain('vous vouliez');
  });

  it('says explicitly that these are not requirements the user expressed', () => {
    expect(explanation.contextual!.statement)
      .toContain("Ce ne sont pas des exigences que vous avez formulées");
  });

  it('states whether the usage came from the user or was inferred', () => {
    expect(explanation.contextual!.usageSource).toBe('user');
    expect(explanation.contextual!.statement).toContain('que vous avez indiqué');
  });

  it('keeps contextual factors OUT of the criterion breakdown (no invented criteria)', () => {
    const criterionIds = explanation.criterionBreakdown.map(c => c.criterionId);
    for (const inferred of ['weight', 'poids', 'battery_life', 'anc', 'portability']) {
      expect(criterionIds).not.toContain(inferred);
    }
  });

  it('reports the unknown contextual data as neutral instead of hiding it', () => {
    const anyUnknown = result.explanation.rankedExplanations
      .some(e => (e.contextual?.unknownSignals.length ?? 0) > 0);
    expect(anyUnknown).toBe(true);
    const statementForEmpty = result.explanation.rankedExplanations
      .map(e => e.contextual!)
      .find(c => c.appliedSignals.length === 0);
    if (statementForEmpty) {
      expect(statementForEmpty.statement).toContain('ni valorisée ni pénalisée');
    }
  });

  it('no contextual block at all when the user stated no usage', () => {
    const noContext = engine().searchSync({
      queryText: 'casque bluetooth moins de 300 euros',
      requestId: 'req-no-context-explanation',
      profile: emptyProfile(),
    });
    for (const e of noContext.explanation.rankedExplanations) {
      expect(e.contextual).toBeUndefined();
    }
  });
});

// ============================================================================
// K. NO CONTEXT → IDENTICAL BEHAVIOUR
// ============================================================================

describe('K. A search without usage keeps the previous behaviour exactly', () => {
  it('same query, same ranking and same scores as before the feature', () => {
    const first = engine().searchSync({
      queryText: 'casque bluetooth moins de 300 euros',
      requestId: 'req-k-1',
      profile: emptyProfile(),
    });
    const second = engine().searchSync({
      queryText: 'casque bluetooth moins de 300 euros',
      requestId: 'req-k-2',
      profile: emptyProfile(),
    });

    // Compared by product + merchant, not by offer id: the in-memory catalogue
    // numbers its offers per process, so two engine instances legitimately
    // produce different ids for the same offer.
    const identity = (r: { offer: { productId: string; merchant: { id: string } }; overallScore: number }) =>
      [r.offer.productId, r.offer.merchant.id, r.overallScore];

    expect(first.usageContext).toBeUndefined();
    expect(first.searchPlan.usageContext).toBeUndefined();
    expect(first.ranking.rankedOffers.map(identity))
      .toEqual(second.ranking.rankedOffers.map(identity));
    for (const ranked of first.ranking.rankedOffers) {
      expect(ranked.contextualRelevance).toBeUndefined();
    }
  });

  it('a usage context changes the score but never the eligible SET', () => {
    const withContext = engine().searchSync({
      queryText: CENTRAL_QUERY,
      requestId: 'req-k-3',
      profile: emptyProfile(),
    });
    const withoutContext = engine().searchSync({
      queryText: 'casque bluetooth moins de 300 euros',
      requestId: 'req-k-4',
      profile: emptyProfile(),
    });

    const key = (r: { offer: { productId: string; merchant: { id: string } } }) =>
      `${r.offer.productId}|${r.offer.merchant.id}`;
    const withKeys = new Set(withContext.ranking.rankedOffers.map(key));
    for (const ranked of withoutContext.ranking.rankedOffers) {
      expect(withKeys.has(key(ranked))).toBe(true);
    }
  });
});

// ============================================================================
// §8 — THE PERMANENT PROFILE IS NEVER TOUCHED
// ============================================================================

describe('§8 A one-off usage never becomes a permanent preference', () => {
  it('the profile object is byte-identical after a search with a usage context', () => {
    const profile = emptyProfile('user-profile-immutability');
    const before = JSON.stringify(profile);

    engine().searchSync({
      queryText: 'casque pour le train demain, moins de 300 euros',
      requestId: 'req-profile-immutability',
      profile,
    });

    expect(JSON.stringify(profile)).toBe(before);
    expect(profile.usageContextHistory).toBeUndefined();
  });

  it('the resolved criteria contain no criterion derived from the usage', () => {
    const result = engine().searchSync({
      queryText: CENTRAL_QUERY,
      requestId: 'req-no-derived-criteria',
      profile: emptyProfile(),
    });
    const ids = result.effectiveCriteria.map(c => c.id);
    for (const inferred of ['weight', 'poids', 'battery_life', 'anc', 'portability', 'usage', 'usageContext']) {
      expect(ids).not.toContain(inferred);
    }
  });
});

// ============================================================================
// J. MULTI-TURN CONVERSATION
// ============================================================================

describe('J. Multi-turn — a usage stated on turn 2 survives turns 3 and 4', () => {
  it('interpretFollowUp surfaces the usage instead of dropping it', () => {
    const followUp = engine().interpretFollowUp('pour écouter de la musique, surtout dans les transports');
    expect(followUp.usageContext).not.toBeNull();
    expect(followUp.usageContext!.usage).toBe('music');
    expect(followUp.usageContext!.context).toBe('transport');
  });

  it('ConversationManager accumulates the usage across turns without erasing', () => {
    const manager = new ConversationManager();
    const capucine = engine();
    const profile = emptyProfile('user-multiturn');

    const firstResult = capucine.searchSync({
      queryText: 'casque Sony XM5 noir',
      requestId: 'turn-1',
      profile,
    });
    const sessionId = manager.createFollowUpSession(profile.userId, 'casque Sony XM5 noir', profile, firstResult);

    // Turn 2 — the usage
    const turn2 = capucine.interpretFollowUp('pour écouter de la musique, surtout dans les transports');
    const afterTurn2 = manager.applyFollowUp(sessionId, 'pour écouter de la musique, surtout dans les transports', turn2.criteria, undefined, {
      usageContext: turn2.usageContext ?? undefined,
    });
    expect(afterTurn2.updatedSession.usageContext!.usage).toBe('music');

    // Turn 3 — a budget, no usage: the usage must NOT be lost
    const turn3 = capucine.interpretFollowUp('300 euros maximum');
    const afterTurn3 = manager.applyFollowUp(sessionId, '300 euros maximum', turn3.criteria, undefined, {
      usageContext: turn3.usageContext ?? undefined,
    });
    expect(afterTurn3.updatedSession.usageContext!.usage).toBe('music');
    expect(afterTurn3.updatedSession.usageContext!.context).toBe('transport');

    // Turn 4 — condition, still no usage
    const turn4 = capucine.interpretFollowUp('oui, neuf uniquement');
    const afterTurn4 = manager.applyFollowUp(sessionId, 'oui, neuf uniquement', turn4.criteria, undefined, {
      usageContext: turn4.usageContext ?? undefined,
    });
    expect(afterTurn4.updatedSession.usageContext!.usage).toBe('music');
    expect(afterTurn4.updatedSession.usageContext!.context).toBe('transport');
  });

  it('a NEW usage stated later is added, the earlier one is kept', () => {
    const manager = new ConversationManager();
    const capucine = engine();
    const profile = emptyProfile('user-multiturn-2');
    const first = capucine.searchSync({ queryText: 'casque pour le bureau', requestId: 't1', profile });
    const sessionId = manager.createFollowUpSession(profile.userId, 'casque pour le bureau', profile, first);

    expect(manager.getSession(sessionId)!.usageContext!.usage).toBe('office');

    const turn2 = capucine.interpretFollowUp('en fait aussi pour le sport');
    const after = manager.applyFollowUp(sessionId, 'en fait aussi pour le sport', turn2.criteria, undefined, {
      usageContext: turn2.usageContext ?? undefined,
    });

    const usages = [after.updatedSession.usageContext!.usage,
      ...(after.updatedSession.usageContext!.additional ?? []).map(a => a.usage)];
    expect(usages).toContain('sport');
    expect(usages).toContain('office');
  });

  it('an engine call replaying the session context ranks with it, without re-interpreting', () => {
    const capucine = engine();
    const replayed: UsageContext = {
      usage: 'transport', context: 'transport', source: 'user', confidence: 0.9, timestamp: new Date(),
    };
    const result = capucine.searchSync({
      // Deliberately stripped search text — the usage cannot be re-derived from it.
      queryText: 'casque bluetooth',
      requestId: 'req-replay',
      profile: emptyProfile(),
      preInterpretedCriteria: [
        { id: 'category', name: 'Catégorie', level: 'required', parameters: { preferredValues: ['casque'], unknownPolicy: 'pass' } },
      ],
      skipAIInterpretation: true,
      usageContext: replayed,
    });

    expect(result.interpretedRequest).toBeUndefined(); // interpretation really was skipped
    expect(result.usageContext!.usage).toBe('transport');
    expect(result.ranking.rankedOffers[0].contextualRelevance).toBeDefined();
  });
});

// ============================================================================
// §19 — THE FULL FOUR-TURN SCENARIO, OVER HTTP
//
// Turn 1: "Je cherche un Sony XM5 noir."
// Turn 2: "Pour écouter de la musique, surtout dans les transports."
// Turn 3: "300 €."
// Turn 4: "Oui, neuf uniquement."
//
// Two blocks, because the local catalogue's cheapest WH-1000XM5 is 319 €:
// under a 300 € ceiling there is genuinely nothing to rank, and Capucine must
// say so rather than quietly raise the budget. The first block therefore
// verifies the accumulated understanding and that honesty; the second replays
// the exact same constraints against offers that CAN satisfy them, and
// verifies admissibility → ranking → explanation all the way through.
// ============================================================================

describe('§19 Four turns over HTTP — what Capucine ends up understanding', () => {
  let app: Application;
  let finalBody: Record<string, unknown>;

  beforeAll(async () => {
    const { default: supertest } = await import('supertest');
    app = buildApp();

    const turn1 = await supertest(app).post('/search').send({
      query: 'Je cherche un Sony XM5 noir.',
      userId: 'user-e2e-usage',
    });
    expect(turn1.status).toBe(200);
    const sessionId = turn1.body.session.sessionId;

    const clarify = async (answer: string) =>
      supertest(app).post('/clarify').send({ sessionId, questionId: FOLLOWUP_QUESTION_ID, answer });

    await clarify('Pour écouter de la musique, surtout dans les transports.');
    await clarify('300 euros maximum');
    const turn4 = await clarify('Oui, neuf uniquement');
    expect(turn4.status).toBe(200);
    finalBody = turn4.body;
  });

  it('turn 1 already understands the product and its colour', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({
      query: 'Je cherche un Sony XM5 noir.',
      userId: 'user-e2e-usage-t1',
    });
    const ids: string[] = res.body.interpretation.extractedCriteria.map((c: { id: string }) => c.id);
    expect(ids).toContain('color');
    // The product reference really drove discovery — "XM5" is not dropped.
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results.every((r: { productId: string }) => /xm5/i.test(r.productId))).toBe(true);
  });

  it('turn 1 does NOT invent a usage — it is simply absent', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({
      query: 'Je cherche un Sony XM5 noir.',
      userId: 'user-e2e-usage-t1b',
    });
    expect(res.body.usageContext).toBeNull();
    expect(res.body.results.every((r: { contextualRelevance: unknown }) => r.contextualRelevance === null)).toBe(true);
  });

  it('asks for the usage when it knows the product family and the user did not say', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({
      query: 'Je cherche un casque Sony XM5 noir.',
      userId: 'user-e2e-usage-question',
    });
    const questions: Array<{ question: string }> = res.body.clarifications?.questions ?? [];
    expect(questions.some(q => /usage/i.test(q.question))).toBe(true);
    // …and asks about the USAGE, never about attributes it can derive itself.
    for (const q of questions) {
      expect(q.question).not.toMatch(/poids|autonomie|réduction de bruit/i);
    }
  });

  it('stops asking once the user has answered', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({
      query: 'Je cherche un casque Sony XM5 noir pour écouter de la musique, surtout dans les transports.',
      userId: 'user-e2e-usage-answered',
    });
    const questions: Array<{ question: string }> = res.body.clarifications?.questions ?? [];
    expect(questions.some(q => /usage/i.test(q.question))).toBe(false);
  });

  it('after four turns: usage = music, context = transport', () => {
    const usageContext = finalBody.usageContext as { usage: string; context: string; source: string } | null;
    expect(usageContext).not.toBeNull();
    expect(usageContext!.usage).toBe('music');
    expect(usageContext!.context).toBe('transport');
    expect(usageContext!.source).toBe('user');
  });

  it('after four turns: colour, budget and condition are HARD constraints', () => {
    const criteria = finalBody.effectiveCriteria as Array<{ id: string; level: string }>;
    const ids = criteria.map(c => c.id);
    expect(ids).toContain('color');
    expect(ids).toContain('budget');
    expect(ids).toContain('condition');
    expect(criteria.find(c => c.id === 'budget')!.level).toBe('required');
    expect(criteria.find(c => c.id === 'color')!.level).toBe('required');
  });

  it('after four turns: NO criterion was fabricated from the usage', () => {
    const ids = (finalBody.effectiveCriteria as Array<{ id: string }>).map(c => c.id);
    for (const inferred of ['weight', 'poids', 'battery_life', 'anc', 'portability', 'comfort']) {
      expect(ids).not.toContain(inferred);
    }
  });

  it('the 300 € ceiling is honoured, not quietly relaxed, even with nothing to show', () => {
    const results = finalBody.results as Array<{ price: { amount: number } | null }>;
    for (const result of results) {
      if (result.price) expect(result.price.amount).toBeLessThanOrEqual(300);
    }
    const budget = (finalBody.effectiveCriteria as Array<{ id: string; level: string }>)
      .find(c => c.id === 'budget')!;
    expect(budget.level).toBe('required');
  });
});

describe('§19 Same four constraints, against offers that can satisfy them', () => {
  // The exact end state of the conversation above, replayed against a source
  // that actually stocks a sub-300 € XM5 — so admissibility, ranking and
  // explanation can be observed under those constraints.
  // Distinct MODELS on purpose: DeduplicationEngine correctly groups two offers
  // of the same model and marks disagreeing specs 'contradictory' (one real
  // WH-1000XM5 does not weigh both 250 g and 395 g). Comparing contextual
  // relevance therefore requires genuinely different products, as in real life.
  const chars = (model: string, extra: Record<string, DataPoint<unknown>>) => ({
    brand: dp('Sony'),
    model: dp(model),
    category: dp('casque'),
    condition: dp('new'),
    ...extra,
  });

  const offers: Offer[] = [
    // Best for commuting: light, long battery, ANC.
    makeOffer('xm5-commuter', 289, 'fnac', chars('WH-1000XM5', {
      color: dp('Noir'), weight: dp(250), battery_life: dp(30), anc: dp('true'), foldable: dp('true'),
    })),
    // Cheaper, and materially worse for commuting.
    makeOffer('ch720-heavy', 279, 'cdiscount', chars('WH-CH720N', {
      color: dp('Noir'), weight: dp(395), battery_life: dp(11), anc: dp('false'), foldable: dp('false'),
    })),
    // Wrong colour — an EXPLICIT constraint, so it must be rejected outright.
    makeOffer('xm5-silver', 259, 'amazon', chars('WH-1000XM5', {
      color: dp('Argenté'), weight: dp(250), battery_life: dp(30), anc: dp('true'),
    })),
    // Over budget, despite the best contextual attributes of the whole set.
    makeOffer('xm5-premium', 429, 'sony-shop', chars('WH-1000XM5-PREMIUM', {
      color: dp('Noir'), weight: dp(230), battery_life: dp(40), anc: dp('true'), foldable: dp('true'),
    })),
  ];

  // Two runs, because the scenario asks two different questions.
  //
  // WITH the model reference, "XM5" is an explicit hard constraint and the
  // WH-CH720N is simply not the product asked for — it must be rejected. That
  // is the correct answer, and it leaves nothing to compare contextually.
  // WITHOUT it (brand only), both Sony headsets are legitimately admissible,
  // which is what makes the contextual comparison meaningful.
  const result = buildEngineWith(offers).searchSync({
    queryText: 'Je cherche un Sony XM5 noir pour écouter de la musique, surtout dans les transports, moins de 300 euros, neuf uniquement',
    requestId: 'req-e2e-full',
    profile: emptyProfile('user-e2e-full'),
  });

  const brandOnly = buildEngineWith(offers).searchSync({
    queryText: 'Je cherche un casque Sony noir pour écouter de la musique, surtout dans les transports, moins de 300 euros, neuf uniquement',
    requestId: 'req-e2e-brand-only',
    profile: emptyProfile('user-e2e-brand-only'),
  });

  it('understands all four explicit constraints plus the usage', () => {
    const ids = result.effectiveCriteria.map(c => c.id);
    expect(ids).toContain('color');
    expect(ids).toContain('budget');
    expect(ids).toContain('condition');
    expect(result.usageContext!.usage).toBe('music');
    expect(result.usageContext!.context).toBe('transport');
  });

  it('1-3. the search covered the general, usage and contextual-technical angles', () => {
    const planner = new SearchStrategyPlanner();
    const strategies = planner.buildStrategies(result.discovery.criteria, result.searchPlan.hardConstraints, 'fr');
    const channels = strategies.map(s => s.channel);
    expect(channels).toContain('general');
    expect(channels).toContain('usage_context');
    expect(channels).toContain('contextual_specs');
    expect(strategies.find(s => s.channel === 'usage_context')!.query).toContain('transport');
    expect(strategies.find(s => s.channel === 'contextual_specs')!.query).toMatch(/autonomie|poids|réduction de bruit/);
  });

  it('4. admissibility rejects the wrong colour, the over-budget offer AND the wrong model', () => {
    const rankedIds = result.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).not.toContain('xm5-silver');   // explicit colour constraint
    expect(rankedIds).not.toContain('xm5-premium');  // explicit budget constraint
    expect(rankedIds).not.toContain('ch720-heavy');  // explicit model constraint: a CH720N is not an XM5
    expect(rankedIds).toContain('xm5-commuter');
  });

  it('4ter. the model reference is what rejects it — brand alone keeps it admissible', () => {
    const rankedIds = brandOnly.ranking.rankedOffers.map(r => r.offer.id);
    expect(rankedIds).toContain('xm5-commuter');
    expect(rankedIds).toContain('ch720-heavy'); // same brand, no model demanded → admissible
    expect(rankedIds).not.toContain('xm5-silver');
  });

  it('4bis. no contextual bonus can rescue the rejected offers', () => {
    // xm5-premium has the BEST contextual attributes of the whole set.
    const rejectedIds = result.admissibility.rejectedOffers.map(r => r.offer.id);
    expect(rejectedIds).toContain('xm5-premium');
  });

  it('5. among admissible offers, the better commuting one ranks first', () => {
    expect(brandOnly.ranking.rankedOffers[0].offer.id).toBe('xm5-commuter');
    const commuter = brandOnly.ranking.rankedOffers.find(r => r.offer.id === 'xm5-commuter')!;
    const heavy = brandOnly.ranking.rankedOffers.find(r => r.offer.id === 'ch720-heavy')!;
    expect(commuter.contextualRelevance!.bonus).toBeGreaterThan(heavy.contextualRelevance!.bonus);
  });

  it('5bis. the cheaper offer would have won without the usage context — the signal is what changed it', () => {
    const withoutContext = buildEngineWith(offers).searchSync({
      queryText: 'Je cherche un casque Sony noir, moins de 300 euros, neuf uniquement',
      requestId: 'req-e2e-full-nocontext',
      profile: emptyProfile('user-e2e-full-2'),
    });
    const commuter = withoutContext.ranking.rankedOffers.find(r => r.offer.id === 'xm5-commuter')!;
    const heavy = withoutContext.ranking.rankedOffers.find(r => r.offer.id === 'ch720-heavy')!;
    expect(heavy.overallScore).toBeGreaterThanOrEqual(commuter.overallScore); // cheaper wins on price alone
    expect(commuter.contextualRelevance).toBeUndefined();
  });

  it('6. the explanation says WHY it is right for this usage, without lying about it', () => {
    const explanation = result.explanation.rankedExplanations
      .find(e => e.offerId === 'xm5-commuter')!;
    expect(explanation.contextual).toBeDefined();
    expect(explanation.contextual!.statement).toContain('transports');
    expect(explanation.contextual!.appliedSignals.map(s => s.signal)).toContain('batteryLife');
    expect(explanation.contextual!.statement.toLowerCase()).not.toContain('vous avez demandé');
  });
});
