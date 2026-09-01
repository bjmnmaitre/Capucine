/**
 * CAPUCINE — préférence « privilégier la disponibilité immédiate »
 *
 * La disponibilité (readiness) alimente déjà le classement via un bonus
 * borné, bonus-only. Cette préférence PERMANENTE, opt-in, RELÈVE le plafond
 * de ce bonus — sans jamais soustraire pour une disponibilité inconnue, ni
 * renverser une correspondance nettement meilleure.
 *
 * Trois questions vérifiées ici :
 *  - scoreReadiness : ready / not-ready / unknown → combien de points, off vs on ;
 *  - rankOffers : l'ordre change quand c'est justifié, PAS quand l'écart de
 *    correspondance est trop grand ;
 *  - ex æquo : à score de correspondance égal, l'offre confirmée disponible
 *    passe devant.
 */
import { rankOffers } from '../../src/decision/priority-engine';
import {
  scoreReadiness, READINESS_BONUS_MAX, READINESS_BONUS_EMPHASIS,
  OfferReadiness, ReadinessAssessment,
} from '../../src/domain/purchase-readiness';
import {
  Offer, Merchant, PreferenceCriterion, RankingRequest, DataPoint,
} from '../../src/domain/types';

// ── helpers ────────────────────────────────────────────────────────────────

const dp = <T,>(value: T): DataPoint<T> => ({
  value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() },
});

const merchant = (id: string): Merchant => ({
  id, name: id, country: 'FR', executionCapabilities: ['web_redirect'],
});

const offer = (id: string, characteristics: Record<string, DataPoint<unknown>> = {}): Offer => ({
  id, productId: 'p1', merchant: merchant(id),
  price: dp(300), currency: 'EUR', shippingCost: dp(0),
  characteristics, createdAt: new Date(), retrievedAt: new Date(),
  provenance: { source: 'test', retrievedAt: new Date() },
});

const A = (state: ReadinessAssessment['state']): ReadinessAssessment => ({ state, reason: state });

/** OfferReadiness with the two SCORED dimensions (inStock, deliverable) set;
 *  verified/purchasable fixed to confirmed (they are not scored anyway). */
function readiness(inStock: ReadinessAssessment['state'], deliverable: ReadinessAssessment['state']): OfferReadiness {
  const pending = ([
    ['inStock', inStock], ['deliverable', deliverable],
  ] as const).filter(([, s]) => s !== 'confirmed').map(([d]) => d);
  const blocked = ([
    ['inStock', inStock], ['deliverable', deliverable],
  ] as const).filter(([, s]) => s === 'not_available').map(([d]) => d);
  return {
    discovered: true,
    verified: A('confirmed'), purchasable: A('confirmed'),
    inStock: A(inStock), deliverable: A(deliverable),
    ready: pending.length === 0, pending, blocked, summary: 'test',
  };
}

const criterion = (id: string, level: PreferenceCriterion['level'], params?: Record<string, unknown>): PreferenceCriterion =>
  ({ id, name: id, level, parameters: params });

const req = (
  offers: Offer[], criteria: PreferenceCriterion[], prioritizeAvailability?: boolean
): RankingRequest => ({
  offers, effectiveCriteria: criteria, requestId: 't', timestamp: new Date(),
  ...(prioritizeAvailability === undefined ? {} : { prioritizeAvailability }),
});

// ── scoreReadiness ─────────────────────────────────────────────────────────

describe('scoreReadiness — bonus borné, jamais négatif', () => {
  it('OFF : les deux dimensions confirmées → plafond normal', () => {
    expect(scoreReadiness(readiness('confirmed', 'confirmed')).bonus).toBe(READINESS_BONUS_MAX);
  });

  it('ON : les deux dimensions confirmées → plafond emphase', () => {
    expect(scoreReadiness(readiness('confirmed', 'confirmed'), { emphasis: true }).bonus)
      .toBe(READINESS_BONUS_EMPHASIS);
  });

  it('une seule confirmée → moitié du plafond, OFF comme ON', () => {
    expect(scoreReadiness(readiness('confirmed', 'unknown')).bonus).toBe(READINESS_BONUS_MAX / 2);
    expect(scoreReadiness(readiness('confirmed', 'unknown'), { emphasis: true }).bonus)
      .toBe(READINESS_BONUS_EMPHASIS / 2);
  });

  it.each(['unknown', 'not_available'] as const)('dimension « %s » → 0 point (jamais de malus)', (state) => {
    expect(scoreReadiness(readiness(state, state)).bonus).toBe(0);
    expect(scoreReadiness(readiness(state, state), { emphasis: true }).bonus).toBe(0);
  });
});

// ── intégration rankOffers ─────────────────────────────────────────────────

describe('rankOffers — la préférence n\'écrase pas la correspondance', () => {
  // La correspondance est pilotée par un critère 'price' (score = 100 - 20·prix/budget) :
  // simple, monotone, écart contrôlable au prix près.
  const priced = (id: string, price: number) => {
    const o = offer(id);
    o.price = dp(price);
    return o;
  };
  const budget = criterion('price', 'important', { maxBudget: 500 });

  it('OFF : à correspondance identique, l\'offre confirmée disponible départage', () => {
    const ready = priced('ready', 200);
    const unknown = priced('unknown', 200);
    const readinessMap = new Map<string, OfferReadiness>([
      ['ready', readiness('confirmed', 'confirmed')],
      ['unknown', readiness('unknown', 'unknown')],
    ]);
    const result = rankOffers(req([unknown, ready], [budget]), undefined, readinessMap);
    expect(result.rankedOffers[0].offer.id).toBe('ready');
  });

  it('ON : une offre confirmée disponible remonte devant une offre légèrement mieux notée', () => {
    // better : 100 € → score 96 ; ready : 250 € → score 90.
    // Écart brut 6 pts : le bonus normal (+5) laisse better devant, l'emphase (+20) flippe.
    const better = priced('better', 100);
    const ready = priced('ready', 250);
    const readinessMap = new Map<string, OfferReadiness>([
      ['better', readiness('unknown', 'unknown')],
      ['ready', readiness('confirmed', 'confirmed')],
    ]);

    const off = rankOffers(req([better, ready], [budget], false), undefined, readinessMap);
    const on = rankOffers(req([better, ready], [budget], true), undefined, readinessMap);

    expect(off.rankedOffers[0].offer.id).toBe('better');
    expect(on.rankedOffers[0].offer.id).toBe('ready');
    expect(on.rankedOffers.find((o) => o.offer.id === 'ready')!.readinessBonus)
      .toBe(READINESS_BONUS_EMPHASIS);
  });

  it('ON : une correspondance NETTEMENT meilleure reste en tête malgré une offre dispo', () => {
    // better : 100 € → score 96 ; ready : 700 € (hors budget) → score 0.
    // Écart 96 pts : +20 ne le comble pas.
    const better = priced('better', 100);
    const ready = priced('ready', 700);
    const readinessMap = new Map<string, OfferReadiness>([
      ['better', readiness('unknown', 'unknown')],
      ['ready', readiness('confirmed', 'confirmed')],
    ]);
    const on = rankOffers(req([better, ready], [budget], true), undefined, readinessMap);
    expect(on.rankedOffers[0].offer.id).toBe('better');
  });

  it('déterminisme : même entrée, même sortie, mode ON', () => {
    const o1 = priced('o1', 200);
    const o2 = priced('o2', 200);
    const map = new Map<string, OfferReadiness>([
      ['o1', readiness('confirmed', 'unknown')],
      ['o2', readiness('confirmed', 'confirmed')],
    ]);
    const a = rankOffers(req([o1, o2], [budget], true), undefined, map);
    const b = rankOffers(req([o2, o1], [budget], true), undefined, map);
    expect(a.rankedOffers.map((o) => o.offer.id)).toEqual(b.rankedOffers.map((o) => o.offer.id));
  });

  it('sans readinessMap : prioritizeAvailability est sans effet (aucun score ne bouge)', () => {
    const o1 = priced('o1', 200);
    const o2 = priced('o2', 300);
    const withFlag = rankOffers(req([o1, o2], [budget], true));
    const without = rankOffers(req([o1, o2], [budget], false));
    expect(withFlag.rankedOffers.map((o) => o.overallScore))
      .toEqual(without.rankedOffers.map((o) => o.overallScore));
  });
});
