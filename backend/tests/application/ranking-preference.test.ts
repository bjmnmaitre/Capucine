/**
 * Tests for RankingPreference / sortByPreference — "montre-moi les moins
 * chers" reorders PriorityEngine's output using CostEngine's real cost, but
 * never re-evaluates admissibility/relevance itself.
 */

import { sortByPreference, reasonCodeFor, DEFAULT_RANKING_PREFERENCE } from '../../src/application/ranking-preference';
import { RankedOffer, Offer, DataPoint } from '../../src/domain/types';

function known(value: number): DataPoint<number> {
  return { value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } };
}
function unknownDP(): DataPoint<number> {
  return { value: null, status: 'unknown' };
}

function makeRanked(id: string, price: number, shipping: DataPoint<number>, score: number): RankedOffer {
  const offer: Offer = {
    id, productId: `prod-${id}`,
    merchant: { id: `m-${id}`, name: id, country: 'FR', executionCapabilities: [] },
    price: known(price), currency: 'EUR', shippingCost: shipping,
    characteristics: {}, createdAt: new Date(), retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
  };
  return { offer, overallScore: score, criterionScores: [], summary: '', satisfiesAllConstraints: true };
}

describe('sortByPreference', () => {
  it('G. default preference is BEST_MATCH', () => {
    expect(DEFAULT_RANKING_PREFERENCE).toBe('BEST_MATCH');
  });

  it('BEST_MATCH preserves PriorityEngine\'s own order untouched', () => {
    const ranked = [makeRanked('a', 1200, known(0), 90), makeRanked('b', 900, known(0), 70)];
    const result = sortByPreference(ranked, 'BEST_MATCH');
    expect(result.offers.map(o => o.offer.id)).toEqual(['a', 'b']); // unchanged order
    expect(result.applied).toBe(true);
  });

  // ---- H. "moins cher" produit une vraie préférence de classement ----
  it('H. PRICE_LOWEST reorders by real cost, overriding the relevance-score order', () => {
    // 'a' scores higher (more relevant) but costs more — PRICE_LOWEST must
    // still put the cheaper 'b' first.
    const ranked = [makeRanked('a', 1200, known(0), 95), makeRanked('b', 900, known(0), 60)];
    const result = sortByPreference(ranked, 'PRICE_LOWEST');
    expect(result.offers.map(o => o.offer.id)).toEqual(['b', 'a']);
    expect(result.applied).toBe(true);
  });

  // ---- I. le classement utilise le coût réel, pas seulement le prix affiché ----
  it('I. free shipping (980 total) ranks before a cheaper sticker price with paid shipping (950+100=1050)', () => {
    const ranked = [makeRanked('paid-shipping', 950, known(100), 80), makeRanked('free-shipping', 980, known(0), 80)];
    const result = sortByPreference(ranked, 'PRICE_LOWEST');
    expect(result.offers.map(o => o.offer.id)).toEqual(['free-shipping', 'paid-shipping']);
  });

  it('each offer carries its own CostBreakdown for the API/frontend to render', () => {
    const ranked = [makeRanked('a', 900, known(50), 80)];
    const result = sortByPreference(ranked, 'PRICE_LOWEST');
    expect(result.offers[0].cost.totalKnown).toBe(950);
    expect(result.offers[0].cost.currency).toBe('EUR');
  });

  it('an offer with unknown shipping is not falsely presented as strictly cheaper — reasonCode distinguishes known vs partial cost', () => {
    const ranked = [makeRanked('cheap-but-uncertain', 900, unknownDP(), 80), makeRanked('known-total', 980, known(0), 80)];
    const result = sortByPreference(ranked, 'PRICE_LOWEST');
    expect(result.offers[0].offer.id).toBe('cheap-but-uncertain'); // numerically first (900 < 980)
    expect(result.offers[0].cost.certainty).not.toBe('known');
    expect(reasonCodeFor('PRICE_LOWEST', result.offers[0], 1)).toBe('RANKED_LOWEST_PARTIAL_COST');
  });

  it('a fully-known cheapest offer (every cost component reported) gets the confident reasonCode', () => {
    const [ranked] = [makeRanked('a', 900, known(0), 80)];
    ranked.offer.taxes = known(0);
    ranked.offer.importDuties = known(0);
    ranked.offer.fees = known(0);
    const result = sortByPreference([ranked], 'PRICE_LOWEST');
    expect(result.offers[0].cost.certainty).toBe('known');
    expect(reasonCodeFor('PRICE_LOWEST', result.offers[0], 1)).toBe('RANKED_LOWEST_KNOWN_COST');
  });

  // ---- BEST_VALUE/FASTEST_DELIVERY/BEST_RATED : acceptés mais INERTES ----
  it('BEST_VALUE/FASTEST_DELIVERY/BEST_RATED ne réordonnent rien ET se déclarent non pris en charge (supported:false + raison)', () => {
    const ranked = [makeRanked('a', 1200, known(0), 95), makeRanked('b', 900, known(0), 60)];
    for (const pref of ['BEST_VALUE', 'FASTEST_DELIVERY', 'BEST_RATED'] as const) {
      const result = sortByPreference(ranked, pref);
      expect(result.offers.map(o => o.offer.id)).toEqual(['a', 'b']); // ordre PriorityEngine préservé
      expect(result.applied).toBe(false);
      // Nouveau : la préférence dit explicitement qu'elle est inerte, avec pourquoi.
      expect(result.supported).toBe(false);
      expect(result.unsupportedReasonCode).toBeDefined();
    }
  });

  it('BEST_MATCH et PRICE_LOWEST se déclarent pris en charge', () => {
    const ranked = [makeRanked('a', 1200, known(0), 95)];
    expect(sortByPreference(ranked, 'BEST_MATCH').supported).toBe(true);
    expect(sortByPreference(ranked, 'PRICE_LOWEST').supported).toBe(true);
    expect(sortByPreference(ranked, 'BEST_MATCH').unsupportedReasonCode).toBeUndefined();
  });

  it('never mutates the original RankedOffer array', () => {
    const ranked = [makeRanked('a', 1200, known(0), 95), makeRanked('b', 900, known(0), 60)];
    const originalOrder = ranked.map(r => r.offer.id);
    sortByPreference(ranked, 'PRICE_LOWEST');
    expect(ranked.map(r => r.offer.id)).toEqual(originalOrder);
  });
});
