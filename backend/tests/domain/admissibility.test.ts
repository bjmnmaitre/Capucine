/**
 * Tests for AdmissibilityEngine — generic numeric characteristic constraints.
 *
 * Covers the min/max/exact(±tolerance) check added to checkConstraint() so
 * structured technical constraints (screen_size, ram, storage, ...) extracted
 * by BasicPatternInterpreter actually gate offers, the same way budget already did.
 */

import { AdmissibilityEngine } from '../../src/domain/admissibility';
import { Offer, PreferenceCriterion, DataPoint } from '../../src/domain/types';

function dp<T>(value: T | null, status: DataPoint<T>['status'] = 'known'): DataPoint<T> {
  return { value, status };
}

function makeOffer(id: string, characteristics: Record<string, DataPoint<unknown>> = {}): Offer {
  return {
    id,
    productId: `product-${id}`,
    merchant: { id: `merchant-${id}`, name: `Merchant ${id}`, country: 'FR', executionCapabilities: [] },
    price: { value: 500, status: 'known' },
    currency: 'EUR',
    shippingCost: { value: 0, status: 'known' },
    characteristics,
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: `source-${id}`, retrievedAt: new Date() },
  };
}

describe('AdmissibilityEngine — numeric characteristic constraints', () => {
  let engine: AdmissibilityEngine;

  beforeEach(() => {
    engine = new AdmissibilityEngine();
  });

  // ---- 13. Known maximum price respected (pre-existing, regression guard) ----
  it('13. price above maxBudget is rejected when price is known', () => {
    const constraint: PreferenceCriterion = {
      id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 },
    };
    const cheap = makeOffer('cheap');
    cheap.price = { value: 900, status: 'known' };
    const expensive = makeOffer('expensive');
    expensive.price = { value: 1500, status: 'known' };

    const batch = engine.filter([cheap, expensive], [constraint]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['cheap']);
    expect(batch.rejectedOffers.map(r => r.offer.id)).toEqual(['expensive']);
  });

  // ---- 14. Known incompatible technical characteristic eliminates the offer ----
  it('14. screen_size known and incompatible (exactValue ± tolerance) eliminates the offer', () => {
    const constraint: PreferenceCriterion = {
      id: 'screen_size', name: "Taille d'écran", level: 'required',
      parameters: { exactValue: 14, tolerance: 0.5, unit: 'pouces' },
    };
    const matching = makeOffer('m14', { screen_size: dp(14) });         // normalized number, exact
    const tooSmall = makeOffer('m13', { screen_size: dp(13.3) });       // outside ±0.5 tolerance (|13.3-14|=0.7)

    const batch = engine.filter([matching, tooSmall], [constraint]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['m14']);
    const rejected = batch.rejectedOffers.find(r => r.offer.id === 'm13');
    expect(rejected).toBeDefined();
    expect(rejected!.primaryViolation).toContain('screen_size'.replace('screen_size', "Taille d'écran")); // human name in message
  });

  it('14b. ram known and below the required minimum eliminates the offer', () => {
    const constraint: PreferenceCriterion = {
      id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' },
    };
    const enough = makeOffer('r16', { ram: dp('16GB') });
    const notEnough = makeOffer('r8', { ram: dp('8GB') });

    const batch = engine.filter([enough, notEnough], [constraint]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['r16']);
    expect(batch.rejectedOffers.map(r => r.offer.id)).toEqual(['r8']);
  });

  it('14c. more RAM than required minimum still satisfies (minValue is a floor, not exact)', () => {
    const constraint: PreferenceCriterion = {
      id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' },
    };
    const moreThanEnough = makeOffer('r32', { ram: dp('32GB') });

    const batch = engine.filter([moreThanEnough], [constraint]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['r32']);
  });

  // ---- 15. Unknown technical characteristic is NOT silently treated as satisfied ----
  it('15. ram with unknown status is not automatically treated as satisfying a required minimum', () => {
    const constraint: PreferenceCriterion = {
      id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' },
    };
    const unknownRam = makeOffer('unknown-ram', { ram: dp(null, 'unknown') });

    const batch = engine.filter([unknownRam], [constraint]);
    // Unknown must NOT pass as "conforme" — it's rejected, but with a distinct
    // reason from a genuine mismatch (see AdmissibilityEngine.checkConstraint).
    expect(batch.eligibleOffers).toHaveLength(0);
    expect(batch.rejectedOffers[0].violations[0].violation).toMatch(/unknown/i);
  });

  it('15b. characteristic entirely absent from the offer is not automatically treated as satisfying', () => {
    const constraint: PreferenceCriterion = {
      id: 'storage', name: 'Stockage', level: 'required', parameters: { minValue: 512, unit: 'GB' },
    };
    const noStorageData = makeOffer('no-storage', {}); // no 'storage' key at all

    const batch = engine.filter([noStorageData], [constraint]);
    expect(batch.eligibleOffers).toHaveLength(0);
    expect(batch.rejectedOffers[0].violations[0].violation).toMatch(/no data/i);
  });

  it('15c. unknown characteristic on a forbidden constraint is a warning, not an elimination (can\'t confirm risk either way)', () => {
    const constraint: PreferenceCriterion = {
      id: 'storage', name: 'Stockage', level: 'forbidden', parameters: { maxValue: 100, unit: 'GB' },
    };
    const unknownStorage = makeOffer('u1', { storage: dp(null, 'unknown') });

    const result = engine.checkOffer(unknownStorage, [constraint]);
    expect(result.eligible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CATEGORY AS A REAL STRUCTURED CONSTRAINT
//
// category is required + unknownPolicy: 'pass' (see BasicPatternInterpreter.
// applyCategoryDetection): a best-effort classification hint, not a strictly
// verifiable spec value like RAM or screen size. An offer without an explicit
// `category` characteristic must not be rejected outright, but an offer whose
// category is present and genuinely different must be.
//
// SATISFIED / VIOLATED / UNKNOWN, made concrete:
//   category present & matching    → SATISFIED (eligible)
//   category present & mismatched  → VIOLATED  (rejected)
//   category absent / unknown      → UNKNOWN   (eligible, flagged with a warning)
// ============================================================================

describe('AdmissibilityEngine — category as a structured constraint', () => {
  let engine: AdmissibilityEngine;

  const categoryConstraint = (wanted: string): PreferenceCriterion => ({
    id: 'category', name: 'Catégorie', level: 'required',
    parameters: { preferredValues: [wanted], unknownPolicy: 'pass' },
  });

  beforeEach(() => {
    engine = new AdmissibilityEngine();
  });

  it('3. category present and correct → SATISFIED (eligible)', () => {
    const offer = makeOffer('laptop-a', { category: dp('ordinateur_portable') });
    const batch = engine.filter([offer], [categoryConstraint('ordinateur_portable')]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['laptop-a']);
  });

  it('4. category present but incorrect → VIOLATED (rejected)', () => {
    const offer = makeOffer('phone-a', { category: dp('smartphone') });
    const batch = engine.filter([offer], [categoryConstraint('ordinateur_portable')]);
    expect(batch.eligibleOffers).toHaveLength(0);
    expect(batch.rejectedOffers[0].violations[0].violation).toMatch(/Catégorie/);
  });

  it('5. category characteristic entirely absent from the offer → UNKNOWN, not VIOLATED (still eligible)', () => {
    const offerNoCategory = makeOffer('legacy-offer', {}); // e.g. a minimal/legacy fixture, no category tagged
    const batch = engine.filter([offerNoCategory], [categoryConstraint('ordinateur_portable')]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['legacy-offer']);
  });

  it('6. category present and correct, alongside other constraints → still SATISFIED', () => {
    const offer = makeOffer('laptop-b', { category: dp('ordinateur_portable'), ram: dp('16GB') });
    const batch = engine.filter(
      [offer],
      [categoryConstraint('ordinateur_portable'), { id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } }]
    );
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['laptop-b']);
  });

  it('7. category present but incorrect eliminates the offer even when every other constraint is satisfied', () => {
    const offer = makeOffer('phone-b', { category: dp('smartphone'), ram: dp('16GB') });
    const batch = engine.filter(
      [offer],
      [categoryConstraint('ordinateur_portable'), { id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } }]
    );
    expect(batch.eligibleOffers).toHaveLength(0);
  });

  it('8. required criterion (generic, not just category) + unknown data + unknownPolicy pass → UNKNOWN, eligible', () => {
    const constraint: PreferenceCriterion = {
      id: 'use_case', name: "Cas d'usage", level: 'required',
      parameters: { preferredValues: ['course a pied'], unknownPolicy: 'pass' },
    };
    const offer = makeOffer('shoe-a', {}); // no use_case data at all
    const batch = engine.filter([offer], [constraint]);
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['shoe-a']);
  });

  it('9. preferred-level criterion + unknown data → never eliminates (unaffected by unknownPolicy — only required/forbidden are hard gates)', () => {
    const constraint: PreferenceCriterion = {
      id: 'use_case', name: "Cas d'usage", level: 'preference',
      parameters: { preferredValues: ['course a pied'] },
    };
    const offer = makeOffer('shoe-b', {});
    const batch = engine.filter([offer], [constraint]);
    // 'preference' is not a hard constraint at all — filter() only enforces required/forbidden.
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['shoe-b']);
  });

  it('14. no regression: fixtures without a category characteristic (pre-existing pattern across the test suite) remain eligible for non-category required constraints', () => {
    const offerNoCategory = makeOffer('legacy', { ram: dp('16GB') });
    const batch = engine.filter(
      [offerNoCategory],
      [{ id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } }]
    );
    expect(batch.eligibleOffers.map(o => o.id)).toEqual(['legacy']);
  });
});
