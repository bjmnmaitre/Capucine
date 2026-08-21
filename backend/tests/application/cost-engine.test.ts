/**
 * Tests for CostEngine — the price shown on a page is never treated as the
 * final cost. Covers: known/partially_known/unknown certainty, discount
 * application, currency conversion (mock provider only — no real exchange
 * rate provider exists in this session), and the "cheapest" comparator's
 * honesty guarantees.
 */

import { CostEngine, MockExchangeRateProvider, CostBreakdown } from '../../src/application/cost-engine';
import { Offer, DataPoint } from '../../src/domain/types';

const engine = new CostEngine();

function known(value: number): DataPoint<number> {
  return { value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } };
}
function unknownDP(): DataPoint<number> {
  return { value: null, status: 'unknown' };
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    productId: 'prod-1',
    merchant: { id: 'm1', name: 'Merchant', country: 'FR', executionCapabilities: [] },
    price: known(999),
    currency: 'EUR',
    shippingCost: known(0),
    characteristics: {},
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
    ...overrides,
  };
}

describe('CostEngine.computeCost', () => {
  // ---- A. basic known cost ----
  it('A. price + shipping known, but taxes/duties/fees not reported by any source → totalKnown sums what IS known, certainty stays "partially_known" (taxes are never assumed included — see PARTIE 5: "ne suppose jamais qu\'un prix Web est TTC")', () => {
    const offer = makeOffer({ price: known(999), shippingCost: known(20) });
    const cost = engine.computeCost(offer);
    expect(cost.certainty).toBe('partially_known');
    expect(cost.totalKnown).toBe(1019);
    expect(cost.unknownComponents).toEqual(['taxes', 'importDuties', 'fees']);
  });

  it('A2. price + shipping + taxes + importDuties + fees ALL explicitly known → certainty "known"', () => {
    const offer = makeOffer({
      price: known(999), shippingCost: known(20), taxes: known(0), importDuties: known(0), fees: known(0),
    });
    const cost = engine.computeCost(offer);
    expect(cost.certainty).toBe('known');
    expect(cost.totalKnown).toBe(1019);
    expect(cost.unknownComponents).toEqual([]);
  });

  // ---- C. currency stays structured, not stringified ----
  it('C. currency is a structured field, never pre-formatted into a string', () => {
    const offer = makeOffer({ currency: 'USD' });
    const cost = engine.computeCost(offer);
    expect(cost.currency).toBe('USD');
    expect(typeof cost.totalKnown).toBe('number');
  });

  // ---- F. unknown components never default to 0 ----
  it('F. a missing (unknown) shippingCost is excluded from the total, not silently added as 0, and flagged', () => {
    const offer = makeOffer({ price: known(999), shippingCost: unknownDP() });
    const cost = engine.computeCost(offer);
    expect(cost.certainty).toBe('partially_known');
    expect(cost.totalKnown).toBe(999); // shipping simply not summed
    expect(cost.unknownComponents).toContain('shipping');
  });

  it('F2. an unknown price makes the whole breakdown "unknown" — nothing meaningful to total', () => {
    const offer = makeOffer({ price: unknownDP() });
    const cost = engine.computeCost(offer);
    expect(cost.certainty).toBe('unknown');
    expect(cost.unknownComponents).toContain('productPrice');
  });

  it('taxes/importDuties/fees absent from the Offer entirely (no source populates them yet) are treated as unknown, never as 0', () => {
    const offer = makeOffer({ price: known(999), shippingCost: known(0) }); // no taxes/importDuties/fees fields at all
    const cost = engine.computeCost(offer);
    expect(cost.taxes.status).toBe('unknown');
    expect(cost.importDuties.status).toBe('unknown');
    expect(cost.fees.status).toBe('unknown');
    expect(cost.certainty).toBe('partially_known');
  });

  it('a known discount is subtracted from the total', () => {
    const offer = makeOffer({ price: known(1000), shippingCost: known(0), discount: known(100) });
    const cost = engine.computeCost(offer);
    expect(cost.totalKnown).toBe(900);
  });

  it('an unknown discount does NOT itself block certainty "known" — absence of a discount is a fact, not a gap (unlike taxes/duties/fees, which are never assumed absent)', () => {
    const offer = makeOffer({
      price: known(999), shippingCost: known(0), taxes: known(0), importDuties: known(0), fees: known(0),
    }); // no discount field — everything else explicitly known
    const cost = engine.computeCost(offer);
    expect(cost.certainty).toBe('known');
    expect(cost.unknownComponents).not.toContain('discount');
  });

  it('every component known (including taxes/importDuties/fees) → certainty "known"', () => {
    const offer = makeOffer({
      price: known(999), shippingCost: known(20), taxes: known(0), importDuties: known(0), fees: known(0),
    });
    const cost = engine.computeCost(offer);
    expect(cost.certainty).toBe('known');
    expect(cost.totalKnown).toBe(1019);
  });
});

describe('CostEngine — currency conversion (MockExchangeRateProvider only — NO real provider configured this session)', () => {
  const provider = new MockExchangeRateProvider();

  // ---- B/D. devise + conversion ----
  it('B/D. converts a known USD total to EUR using the mock provider, tagging the rate source as mock', () => {
    const offer = makeOffer({ price: known(1000), currency: 'USD', shippingCost: known(0) });
    const cost = engine.computeCost(offer);
    const converted = engine.convertBreakdown(cost, 'EUR', provider);
    expect(converted.currency).toBe('EUR');
    expect(converted.totalKnown).toBeCloseTo(920, 0); // 1000 USD * 0.92
    const rate = provider.getRate('USD', 'EUR');
    expect(rate?.source).toBe('mock_static_table');
  });

  it('never fabricates a conversion when the provider has no rate for the pair — stays in the original currency', () => {
    const offer = makeOffer({ price: known(1000), currency: 'PLN' as any, shippingCost: known(0) });
    const cost = engine.computeCost(offer);
    const converted = engine.convertBreakdown(cost, 'EUR', provider);
    expect(converted.currency).toBe('PLN'); // unchanged — no invented rate
    expect(converted.totalKnown).toBe(cost.totalKnown);
  });

  it('converting to the same currency is a no-op (no provider call needed)', () => {
    const offer = makeOffer({ price: known(500), currency: 'EUR', shippingCost: known(0) });
    const cost = engine.computeCost(offer);
    expect(engine.convertBreakdown(cost, 'EUR', provider)).toBe(cost);
  });
});

describe('CostEngine.compareCost — "cheapest" must stay honest about uncertainty', () => {
  // ---- H/I. le moins cher doit utiliser le coût réel, pas seulement le prix ----
  it('H/I. an offer with free shipping (980 total) ranks before a cheaper sticker price with paid shipping (950+100=1050)', () => {
    const offerA = engine.computeCost(makeOffer({ price: known(950), shippingCost: known(100) })); // total 1050
    const offerB = engine.computeCost(makeOffer({ price: known(980), shippingCost: known(0) }));    // total 980
    expect(engine.compareCost(offerB, offerA)).toBeLessThan(0); // B (980) before A (1050)
  });

  it('compareCost returns a deterministic order even when a breakdown has unknown components — callers must still consult `certainty` before claiming "cheapest"', () => {
    const known900NoShipping = engine.computeCost(makeOffer({ price: known(900), shippingCost: unknownDP() })); // totalKnown=900, certainty partially_known
    const known980FreeShipping = engine.computeCost(makeOffer({
      price: known(980), shippingCost: known(0), taxes: known(0), importDuties: known(0), fees: known(0),
    })); // every component known → totalKnown=980, certainty known

    // Numerically 900 < 980, so it sorts first — but certainty makes clear
    // this is NOT a confident "definitely cheaper" claim.
    expect(engine.compareCost(known900NoShipping, known980FreeShipping)).toBeLessThan(0);
    expect(known900NoShipping.certainty).not.toBe('known');
    expect(known980FreeShipping.certainty).toBe('known');
  });

  it('comparing different currencies without conversion returns a tie (0) rather than comparing incompatible numbers', () => {
    const eur = engine.computeCost(makeOffer({ price: known(900), currency: 'EUR', shippingCost: known(0) }));
    const usd = engine.computeCost(makeOffer({ price: known(900), currency: 'USD', shippingCost: known(0) }));
    expect(engine.compareCost(eur, usd)).toBe(0);
  });
});
