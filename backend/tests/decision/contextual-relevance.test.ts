/**
 * Usage context — RANKING
 *
 * Covers spec §18-E (signals really move the score), §18-G (UNKNOWN != FALSE),
 * §18-H (an inadmissible offer is never rescued), §18-L (an explicit
 * constraint beats a contradicting contextual signal), and §12/§13's ordering
 * rules.
 *
 * The invariant every test here ultimately protects:
 *   score(offer, withUsageContext) >= score(offer, withoutUsageContext)
 * Evidence can earn points. Its absence can never cost any.
 */

import { rankOffers } from '../../src/decision/priority-engine';
import {
  scoreContextualRelevance,
  CONTEXTUAL_BONUS_MAX,
} from '../../src/decision/contextual-relevance';
import { AdmissibilityEngine } from '../../src/domain/admissibility';
import {
  DataPoint,
  Merchant,
  Offer,
  PreferenceCriterion,
  UsageContext,
} from '../../src/domain/types';

// ============================================================================
// HELPERS
// ============================================================================

const merchant: Merchant = {
  id: 'test-merchant',
  name: 'Test Merchant',
  country: 'FR',
  executionCapabilities: ['web_redirect'],
};

function known<T>(value: T): DataPoint<T> {
  return { value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } };
}

function unknown<T>(): DataPoint<T> {
  return { value: null, status: 'unknown' };
}

function offer(id: string, price: number, characteristics: Record<string, DataPoint<unknown>> = {}): Offer {
  return {
    id,
    productId: `product-${id}`,
    merchant,
    price: known(price),
    currency: 'EUR',
    shippingCost: known(0),
    characteristics,
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
  };
}

const transportContext: UsageContext = {
  usage: 'transport',
  context: 'transport',
  source: 'user',
  confidence: 0.9,
  matchedText: 'pour les transports',
  timestamp: new Date(),
};

/** An offer that documents everything the transport context cares about, well. */
const wellDocumented = offer('well-documented', 300, {
  weight: known(210),
  battery_life: known(38),
  anc: known('true'),
  foldable: known('true'),
  comfort: known('true'),
});

/** Same offer, but the merchant published none of those attributes. */
const undocumented = offer('undocumented', 300, {
  weight: unknown(),
  battery_life: unknown(),
});

const noCriteria: PreferenceCriterion[] = [];

function rank(offers: Offer[], criteria: PreferenceCriterion[], usageContext?: UsageContext) {
  return rankOffers({
    offers,
    effectiveCriteria: criteria,
    ...(usageContext ? { usageContext } : {}),
    requestId: 'req-test',
    timestamp: new Date(),
  });
}

function scoreOf(result: ReturnType<typeof rank>, offerId: string): number {
  const found = result.rankedOffers.find(ro => ro.offer.id === offerId);
  if (!found) throw new Error(`offer ${offerId} was not ranked`);
  return found.overallScore;
}

// ============================================================================
// E. CONTEXTUAL SIGNALS REALLY INFLUENCE THE SCORE
// ============================================================================

describe('E. Contextual signals influence the score', () => {
  it('a well-documented offer scores higher WITH a usage context than without', () => {
    const without = rank([wellDocumented], noCriteria);
    const with_ = rank([wellDocumented], noCriteria, transportContext);
    expect(scoreOf(with_, 'well-documented')).toBeGreaterThan(scoreOf(without, 'well-documented'));
  });

  it('the bonus is reported, auditable, and already included in overallScore', () => {
    const result = rank([wellDocumented], noCriteria, transportContext);
    const ranked = result.rankedOffers[0];
    expect(ranked.contextualRelevance).toBeDefined();
    expect(ranked.contextualRelevance!.bonus).toBeGreaterThan(0);
    expect(ranked.contextualRelevance!.signals.length).toBeGreaterThan(0);

    const without = rank([wellDocumented], noCriteria);
    expect(ranked.overallScore).toBe(
      Math.min(100, Math.round(scoreOf(without, 'well-documented') + ranked.contextualRelevance!.bonus))
    );
  });

  it('a light, long-lasting headset outranks a heavy short-lived one FOR COMMUTING', () => {
    const light = offer('light', 300, { weight: known(210), battery_life: known(38), anc: known('true') });
    const heavy = offer('heavy', 300, { weight: known(390), battery_life: known(12), anc: known('false') });

    const withContext = rank([heavy, light], noCriteria, transportContext);
    expect(withContext.rankedOffers[0].offer.id).toBe('light');
    expect(scoreOf(withContext, 'light')).toBeGreaterThan(scoreOf(withContext, 'heavy'));
  });

  it('the very same two offers are NOT reordered when no usage was stated', () => {
    const light = offer('light', 300, { weight: known(210), battery_life: known(38), anc: known('true') });
    const heavy = offer('heavy', 300, { weight: known(390), battery_life: known(12), anc: known('false') });

    const withoutContext = rank([heavy, light], noCriteria);
    expect(scoreOf(withoutContext, 'light')).toBe(scoreOf(withoutContext, 'heavy'));
  });

  it('the bonus is bounded — it can never dominate the criteria score', () => {
    const result = rank([wellDocumented], noCriteria, transportContext);
    expect(result.rankedOffers[0].contextualRelevance!.bonus).toBeLessThanOrEqual(CONTEXTUAL_BONUS_MAX);
  });

  it('is deterministic — identical input, identical bonus', () => {
    const a = rank([wellDocumented], noCriteria, transportContext);
    const b = rank([wellDocumented], noCriteria, transportContext);
    expect(a.rankedOffers[0].contextualRelevance!.bonus)
      .toBe(b.rankedOffers[0].contextualRelevance!.bonus);
  });
});

// ============================================================================
// G. UNKNOWN != FALSE
// ============================================================================

describe('G. UNKNOWN is not FALSE', () => {
  it('an offer with no contextual data scores EXACTLY what it scored without a context', () => {
    const without = rank([undocumented], noCriteria);
    const with_ = rank([undocumented], noCriteria, transportContext);
    expect(scoreOf(with_, 'undocumented')).toBe(scoreOf(without, 'undocumented'));
  });

  it('the bonus is never negative, whatever the data says', () => {
    const worst = offer('worst', 300, {
      weight: known(2000),
      battery_life: known(1),
      anc: known('false'),
      foldable: known('false'),
    });
    const relevance = scoreContextualRelevance(worst, transportContext, noCriteria)!;
    expect(relevance.bonus).toBeGreaterThanOrEqual(0);
    for (const signal of relevance.signals) {
      expect(signal.contribution).toBeGreaterThanOrEqual(0);
    }
  });

  it('an unknown attribute is reported as unknown — not as a weakness', () => {
    const relevance = scoreContextualRelevance(undocumented, transportContext, noCriteria)!;
    const weightSignal = relevance.signals.find(s => s.signal === 'weight')!;
    expect(weightSignal.outcome).toBe('unknown');
    expect(weightSignal.contribution).toBe(0);
    expect(weightSignal.reasoning).toContain('inconnu');
  });

  it('contradictory data (no agreed value) is treated as unknown, never as bad', () => {
    const contradictory = offer('contradictory', 300, {
      weight: { value: null, status: 'contradictory', conflictingValues: [250, 260] },
    });
    const without = rank([contradictory], noCriteria);
    const with_ = rank([contradictory], noCriteria, transportContext);
    expect(scoreOf(with_, 'contradictory')).toBeGreaterThanOrEqual(scoreOf(without, 'contradictory'));
  });

  it('an offer that documents nothing is never ranked BELOW where it would be without the context', () => {
    const withoutContext = rank([wellDocumented, undocumented], noCriteria);
    const withContext = rank([wellDocumented, undocumented], noCriteria, transportContext);
    expect(scoreOf(withContext, 'undocumented')).toBe(scoreOf(withoutContext, 'undocumented'));
  });
});

// ============================================================================
// H. ADMISSIBILITY IS NEVER BYPASSED
// ============================================================================

describe('H. A contextual bonus never rescues an inadmissible offer', () => {
  const budget: PreferenceCriterion = {
    id: 'budget',
    name: 'Budget',
    level: 'required',
    parameters: { maxBudget: 300, currency: 'EUR' },
  };

  it('an over-budget offer with perfect contextual data is still rejected', () => {
    const perfectButTooExpensive = offer('too-expensive', 900, {
      weight: known(190),
      battery_life: known(50),
      anc: known('true'),
      foldable: known('true'),
      comfort: known('true'),
    });

    const admissibility = new AdmissibilityEngine().filter([perfectButTooExpensive], [budget]);
    expect(admissibility.eligibleOffers).toHaveLength(0);

    // The engine only ever ranks the eligible subset — mirror that here.
    const result = rankOffers(
      {
        offers: admissibility.eligibleOffers,
        effectiveCriteria: [budget],
        usageContext: transportContext,
        requestId: 'req-admissibility',
        timestamp: new Date(),
      },
      admissibility.resultsByOfferId
    );
    expect(result.rankedOffers).toHaveLength(0);
  });

  it('rejected offers carry no contextual bonus at all — it is never even computed', () => {
    const violating = offer('violating', 900, { weight: known(190), anc: known('true') });
    const result = rank([violating], [budget]);
    expect(result.rankedOffers).toHaveLength(0);
    expect(result.rejectedOffers).toHaveLength(1);
    expect((result.rejectedOffers![0] as unknown as { contextualRelevance?: unknown }).contextualRelevance)
      .toBeUndefined();
  });

  it('admissibility decides on criteria alone — the usage context changes nothing there', () => {
    const engine = new AdmissibilityEngine();
    const noAncOffer = offer('no-anc', 200, { anc: known('false'), weight: known(400) });
    // Nothing about "for commuting" may turn ANC or weight into a requirement.
    const verdict = engine.filter([noAncOffer], [budget]);
    expect(verdict.eligibleOffers).toHaveLength(1);
  });
});

// ============================================================================
// L. EXPLICIT CONSTRAINT vs CONTRADICTING CONTEXTUAL SIGNAL
// ============================================================================

describe('L. An explicit criterion always beats a contextual signal', () => {
  const explicitWeight: PreferenceCriterion = {
    id: 'weight',
    name: 'Poids maximum',
    level: 'required',
    parameters: { maxValue: 300, unit: 'g' },
  };

  it('the contextual weight signal stands down when the user set a weight criterion', () => {
    const relevance = scoreContextualRelevance(wellDocumented, transportContext, [explicitWeight])!;
    const weightSignal = relevance.signals.find(s => s.signal === 'weight')!;
    expect(weightSignal.outcome).toBe('superseded');
    expect(weightSignal.contribution).toBe(0);
    expect(weightSignal.reasoning).toContain('explicite');
  });

  it('weight is then scored ONCE — by the user\'s criterion, not twice', () => {
    const withExplicit = scoreContextualRelevance(wellDocumented, transportContext, [explicitWeight])!;
    const withoutExplicit = scoreContextualRelevance(wellDocumented, transportContext, noCriteria)!;
    const weightWithout = withoutExplicit.signals.find(s => s.signal === 'weight')!;
    expect(weightWithout.contribution).toBeGreaterThan(0);
    expect(withExplicit.signals.find(s => s.signal === 'weight')!.contribution).toBe(0);
  });

  it('the explicit constraint still filters — the context cannot soften it', () => {
    const tooHeavy = offer('too-heavy', 200, { weight: known(500), anc: known('true'), battery_life: known(50) });
    const admissibility = new AdmissibilityEngine().filter([tooHeavy], [explicitWeight]);
    expect(admissibility.eligibleOffers).toHaveLength(0);
  });

  it('an explicit ANC requirement supersedes the contextual noiseCancellation signal', () => {
    const explicitAnc: PreferenceCriterion = {
      id: 'anc', name: 'Réduction de bruit', level: 'required', parameters: { expectedValue: true },
    };
    const relevance = scoreContextualRelevance(wellDocumented, transportContext, [explicitAnc])!;
    expect(relevance.signals.find(s => s.signal === 'noiseCancellation')!.outcome).toBe('superseded');
  });

  it('other contextual signals keep working when one is superseded', () => {
    const relevance = scoreContextualRelevance(wellDocumented, transportContext, [explicitWeight])!;
    expect(relevance.signals.some(s => s.outcome === 'applied')).toBe(true);
    expect(relevance.bonus).toBeGreaterThan(0);
  });
});

// ============================================================================
// K. NO CONTEXT → PREVIOUS BEHAVIOUR, BYTE FOR BYTE
// ============================================================================

describe('K. A search with no usage context behaves exactly as before', () => {
  it('no contextualRelevance is attached at all', () => {
    const result = rank([wellDocumented, undocumented], noCriteria);
    for (const ranked of result.rankedOffers) {
      expect(ranked.contextualRelevance).toBeUndefined();
    }
  });

  it("a context that makes nothing relevant (usage 'other') leaves the score untouched", () => {
    const otherContext: UsageContext = {
      usage: 'other', source: 'inferred', confidence: 0.4, timestamp: new Date(),
    };
    const without = rank([wellDocumented], noCriteria);
    const with_ = rank([wellDocumented], noCriteria, otherContext);
    expect(scoreOf(with_, 'well-documented')).toBe(scoreOf(without, 'well-documented'));
    expect(with_.rankedOffers[0].contextualRelevance).toBeUndefined();
  });
});
