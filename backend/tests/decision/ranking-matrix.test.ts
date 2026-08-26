/**
 * CAPUCINE — matrice de classement
 *
 * Campagne de comparaison à grande échelle sur le VRAI moteur (rankOffers).
 * Elle existe pour deux raisons :
 *
 *  1. Les deux défauts d'arrondi trouvés (score global puis sous-scores) ne se
 *     manifestaient qu'en présence de plusieurs critères et d'écarts faibles —
 *     une configuration qu'aucun test unitaire ne produisait. Cette matrice
 *     balaie systématiquement ces configurations.
 *  2. Fournir des observations chiffrées pour OD-109 (poids du prix) sans
 *     trancher la question ici.
 */
import { rankOffers } from '../../src/decision/priority-engine';
import type { Offer, Merchant, PreferenceCriterion, DataStatus } from '../../src/domain/types';

const merchant = (id: string): Merchant =>
  ({ id, name: id, country: 'FR', executionCapabilities: ['web_redirect'] });

interface OfferSpec {
  id: string;
  price: number | null;
  priceStatus?: DataStatus;
  merchant?: string;
  characteristics?: Record<string, { value: unknown; status: DataStatus }>;
}

function build(spec: OfferSpec): Offer {
  return {
    id: spec.id,
    productId: 'prod',
    merchant: merchant(spec.merchant ?? spec.id),
    price: { value: spec.price, status: spec.priceStatus ?? 'known',
             provenance: { source: 'matrice', retrievedAt: new Date() } },
    currency: 'EUR',
    shippingCost: { value: 0, status: 'known' },
    characteristics: (spec.characteristics ?? {}) as Offer['characteristics'],
    executionUrl: `https://${spec.merchant ?? spec.id}.example/p`,
    createdAt: new Date(), retrievedAt: new Date(),
    provenance: { source: 'matrice', retrievedAt: new Date() },
  } as Offer;
}

function rank(offers: Offer[], criteria: PreferenceCriterion[]) {
  return rankOffers({
    effectiveCriteria: criteria, offers, requestId: 'matrix', timestamp: new Date(),
  }).rankedOffers;
}

const PRICE = (level: PreferenceCriterion['level'], budget = 400): PreferenceCriterion =>
  ({ id: 'price', name: 'Prix', level, parameters: { maxBudget: budget, currency: 'EUR' } });

/** Critères neutres : ils diluent, exactement comme une vraie recherche. */
const NOISE = (n: number): PreferenceCriterion[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `noise${i}`, name: `Neutre ${i}`, level: 'preference' as const,
  }));

// ── Écarts de prix balayés, du plus fin au plus large ────────────────────────
const PRICE_SPREADS: Array<{ label: string; prices: number[] }> = [
  { label: 'écart 1 €', prices: [300, 299] },
  { label: 'écart 2 €', prices: [310, 308] },
  { label: 'écart 5 €', prices: [325, 320] },
  { label: 'écart 10 €', prices: [329, 319] },
  { label: 'écart 30 €', prices: [349, 319] },
  { label: 'écart 100 €', prices: [399, 299] },
  { label: '4 offres serrées', prices: [349, 329, 335, 319] },
  { label: '4 offres étalées', prices: [390, 250, 320, 199] },
  { label: '5 offres', prices: [380, 200, 310, 275, 349] },
  { label: 'prix identiques', prices: [300, 300] },
];

const NOISE_LEVELS = [0, 2, 4, 6];
const LEVELS: PreferenceCriterion['level'][] = ['required', 'very_important', 'important', 'preference', 'low'];

describe('Matrice de classement — le prix départage à toutes les échelles', () => {
  // 10 écarts × 4 niveaux de bruit = 40 scénarios de comparaison.
  for (const spread of PRICE_SPREADS) {
    for (const noise of NOISE_LEVELS) {
      it(`${spread.label}, ${noise} critère(s) neutre(s) : ordre = prix croissant`, () => {
        const offers = spread.prices.map((p, i) => build({ id: `o${i + 1}`, price: p, merchant: `m${i + 1}` }));
        const ranked = rank(offers, [PRICE('required'), ...NOISE(noise)]);

        expect(ranked.length).toBe(offers.length);
        const prices = ranked.map(r => r.offer.price.value!);
        // Le bruit ne doit jamais effacer un écart de prix réel.
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
      });
    }
  }

  // 5 niveaux de préférence = 5 scénarios supplémentaires.
  for (const level of LEVELS) {
    it(`niveau '${level}' : le prix ordonne toujours, seule son influence varie`, () => {
      const offers = [349, 319, 335].map((p, i) => build({ id: `o${i + 1}`, price: p, merchant: `m${i + 1}` }));
      const ranked = rank(offers, [PRICE(level), ...NOISE(3)]);
      const prices = ranked.map(r => r.offer.price.value!);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });
  }
});

describe('Matrice de classement — déterminisme et invariance', () => {
  const PERMUTATIONS: number[][] = [
    [0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 2, 1, 3],
  ];

  // 5 permutations × 2 configurations = 10 scénarios.
  for (const noise of [0, 4]) {
    for (const [i, perm] of PERMUTATIONS.entries()) {
      it(`permutation ${i + 1} avec ${noise} bruit(s) : ordre identique`, () => {
        const base = [349, 329, 335, 319].map((p, k) =>
          build({ id: `o${k + 1}`, price: p, merchant: `m${k + 1}` }));
        const shuffled = perm.map(k => base[k]);

        const a = rank(base, [PRICE('required'), ...NOISE(noise)]).map(r => r.offer.id);
        const b = rank(shuffled, [PRICE('required'), ...NOISE(noise)]).map(r => r.offer.id);
        // L'ordre d'entrée ne doit avoir AUCUNE influence.
        expect(b).toEqual(a);
      });
    }
  }

  it('deux exécutions identiques produisent des scores identiques', () => {
    const offers = [349, 319].map((p, i) => build({ id: `o${i + 1}`, price: p, merchant: `m${i}` }));
    const a = rank(offers, [PRICE('required'), ...NOISE(3)]);
    const b = rank(offers, [PRICE('required'), ...NOISE(3)]);
    expect(b.map(r => r.overallScoreExact)).toEqual(a.map(r => r.overallScoreExact));
  });

  it("le départage par id ne sert QUE lorsque les scores sont réellement égaux", () => {
    // Prix identiques : aucune différence réelle, le départage est légitime.
    const equal = rank(
      [build({ id: 'zz', price: 300, merchant: 'z' }), build({ id: 'aa', price: 300, merchant: 'a' })],
      [PRICE('required')]
    );
    expect(equal.map(r => r.offer.id)).toEqual(['aa', 'zz']);

    // Prix différents : l'id ne doit PAS l'emporter, même s'il vient en premier.
    const different = rank(
      [build({ id: 'aa', price: 349, merchant: 'a' }), build({ id: 'zz', price: 299, merchant: 'z' })],
      [PRICE('required'), ...NOISE(4)]
    );
    expect(different[0].offer.id).toBe('zz');
  });
});

describe('Matrice de classement — UNKNOWN n’est pas pénalisé comme mauvais', () => {
  const known = (v: unknown) => ({ value: v, status: 'known' as DataStatus });
  const unknown = { value: null, status: 'unknown' as DataStatus };
  const contradictory = { value: null, status: 'contradictory' as DataStatus };

  it('une donnée inconnue score mieux qu’une donnée connue mauvaise', () => {
    const criteria: PreferenceCriterion[] = [
      { id: 'spec', name: 'Spec', level: 'important', parameters: { requiredValue: 'bon' } },
    ];
    const ranked = rank([
      build({ id: 'connu-mauvais', price: 300, merchant: 'a', characteristics: { spec: known('mauvais') } }),
      build({ id: 'inconnu', price: 300, merchant: 'b', characteristics: { spec: unknown } }),
    ], criteria);

    const scoreOf = (id: string) =>
      ranked.find(r => r.offer.id === id)!.criterionScores.find(c => c.criterionId === 'spec')!.score;
    // UNKNOWN != BAD : l'inconnu ne doit pas être traité comme un échec.
    expect(scoreOf('inconnu')).toBeGreaterThan(scoreOf('connu-mauvais'));
  });

  it('une donnée contradictoire est distinguée d’une donnée inconnue', () => {
    const criteria: PreferenceCriterion[] = [
      { id: 'spec', name: 'Spec', level: 'important', parameters: { requiredValue: 'bon' } },
    ];
    const ranked = rank([
      build({ id: 'inconnu', price: 300, merchant: 'a', characteristics: { spec: unknown } }),
      build({ id: 'contradictoire', price: 300, merchant: 'b', characteristics: { spec: contradictory } }),
    ], criteria);

    const status = (id: string) =>
      ranked.find(r => r.offer.id === id)!.criterionScores.find(c => c.criterionId === 'spec')!.dataUsed.status;
    expect(status('inconnu')).toBe('unknown');
    expect(status('contradictoire')).toBe('contradictory');
  });

  it('un prix inconnu ne devient jamais un prix de 0 dans le classement', () => {
    const ranked = rank([
      build({ id: 'sans-prix', price: null, priceStatus: 'unknown', merchant: 'a' }),
      build({ id: 'avec-prix', price: 300, merchant: 'b' }),
    ], [PRICE('important')]);

    const sansPrix = ranked.find(r => r.offer.id === 'sans-prix')!;
    // Un prix inconnu traité comme 0 ferait de cette offre la meilleure.
    expect(ranked[0].offer.id).not.toBe('sans-prix');
    expect(sansPrix.criterionScores.find(c => c.criterionId === 'price')!.dataUsed.status).toBe('unknown');
  });
});
