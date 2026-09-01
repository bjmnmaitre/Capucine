/**
 * Ce que ces tests protègent : le texte réellement affiché face à une donnée
 * absente, partielle ou contradictoire. C'est le dernier endroit où une
 * inconnue pourrait devenir une affirmation sur l'écran de l'utilisateur.
 */
import {
  costLabel, merchantLabel, offerAccessibilityLabel, offerUrlLabel,
  priceLabel, rankingPreferenceLabel, resultsSummary, shippingLabel,
  shippingValueLabel, isShippingKnown,
} from './presentation';

const base = {
  rank: 1,
  merchant: { id: 'fnac', name: 'Fnac' },
  price: { amount: 329, currency: 'EUR', status: 'known' },
  shipping: { amount: 0, currency: 'EUR', status: 'known' },
  cost: { totalKnown: 329, currency: 'EUR', certainty: 'known', unknownComponents: [] },
  offerUrl: 'https://fnac.com/p',
} as never;

const withShipping = (s: unknown) => ({ ...(base as object), shipping: s } as never);
const withCost = (c: unknown) => ({ ...(base as object), cost: c } as never);

describe('Livraison — « inconnue » ne devient jamais « offerte »', () => {
  it('un montant réel est affiché', () => {
    expect(shippingLabel(withShipping({ amount: 5.99, currency: 'EUR', status: 'known' })))
      .toContain('5,99');
  });

  it('0 connu → « offerte », qui est un fait', () => {
    expect(shippingLabel(withShipping({ amount: 0, currency: 'EUR', status: 'known' })))
      .toBe('livraison offerte');
  });

  it.each([
    ['statut unknown', { amount: null, currency: 'EUR', status: 'unknown' }],
    ['montant null', { amount: null, currency: 'EUR', status: 'known' }],
    ['champ absent', undefined],
  ])('%s → « inconnue », jamais « offerte »', (_l, s) => {
    const out = shippingLabel(withShipping(s));
    expect(out).toBe('livraison inconnue');
    expect(out).not.toContain('offerte');
  });

  it('une contradiction est dite comme telle', () => {
    expect(shippingLabel(withShipping({ amount: null, currency: 'EUR', status: 'contradictory' })))
      .toContain('contradictoire');
  });
});

describe('Coût — un total partiel n’est jamais présenté comme final', () => {
  it('coût connu : montant seul', () => {
    expect(costLabel(withCost({ totalKnown: 329, currency: 'EUR', certainty: 'known', unknownComponents: [] })))
      .not.toContain('au moins');
  });

  it('coût partiel : préfixé « au moins »', () => {
    expect(costLabel(withCost({ totalKnown: 329, currency: 'EUR', certainty: 'partially_known', unknownComponents: ['shipping'] })))
      .toMatch(/^au moins/);
  });

  it.each([
    ['certainty unknown', { totalKnown: null, currency: 'EUR', certainty: 'unknown', unknownComponents: ['price'] }],
    ['total null', { totalKnown: null, currency: 'EUR', certainty: 'partially_known', unknownComponents: [] }],
    ['cost absent', undefined],
  ])('%s → « coût inconnu »', (_l, c) => {
    expect(costLabel(withCost(c))).toBe('coût inconnu');
  });
});

describe('Prix et marchand — aucune valeur technique visible', () => {
  it('prix absent → « prix inconnu », jamais 0', () => {
    expect(priceLabel({ price: null } as never)).toBe('prix inconnu');
  });

  it('montant NaN → « inconnu », jamais « NaN € »', () => {
    const out = priceLabel({ price: { amount: NaN, currency: 'EUR', status: 'known' } } as never);
    expect(out).not.toContain('NaN');
  });

  it.each([undefined, null, '', '   '])('nom de marchand %p → repli lisible', (name) => {
    const out = merchantLabel({ merchant: { id: 'x', name } } as never);
    expect(out).toBe('Marchand inconnu');
    expect(out).not.toBe('undefined');
    expect(out).not.toBe('null');
  });
});

describe('URL — jamais fabriquée, jamais non-http', () => {
  it.each([
    ['https', 'https://fnac.com/p', 'https://fnac.com/p'],
    ['http', 'http://fnac.com/p', 'http://fnac.com/p'],
    ['absente', null, null],
    ['vide', '', null],
    ['slug', '/produit-42', null],
    ['identifiant', 'offer-12345', null],
    ['javascript', 'javascript:alert(1)', null],
    ['data', 'data:text/html,x', null],
  ])('%s', (_l, url, expected) => {
    expect(offerUrlLabel({ offerUrl: url } as never)).toBe(expected);
  });
});

describe('Libellé accessible — une phrase complète, sans valeur technique', () => {
  it('offre complète', () => {
    const out = offerAccessibilityLabel(base);
    expect(out).toContain('Offre numéro 1');
    expect(out).toContain('Fnac');
    expect(out).toContain('329');
  });

  it('offre entièrement inconnue reste compréhensible', () => {
    const out = offerAccessibilityLabel({
      rank: 3, merchant: { id: 'x', name: undefined }, price: null,
      shipping: { amount: null, currency: 'EUR', status: 'unknown' },
      cost: { totalKnown: null, currency: 'EUR', certainty: 'unknown', unknownComponents: [] },
    } as never);

    expect(out).toContain('Marchand inconnu');
    expect(out).toContain('prix inconnu');
    expect(out).toContain('livraison inconnue');
    for (const technical of ['undefined', 'null', 'NaN', '[object']) {
      expect(out).not.toContain(technical);
    }
  });
});

describe('Résumé de la liste', () => {
  it.each([
    [0, 0, 'Aucune offre trouvée'],
    [1, 1, '1 offre · 1 marchand'],
    [4, 3, '4 offres · 3 marchands'],
  ])('%i offres / %i marchands', (c, m, expected) => {
    expect(resultsSummary(c, m)).toBe(expected);
  });
});

/**
 * Ordre courant de la liste : l'écran ne doit annoncer un tri QUE lorsqu'il a
 * réellement eu lieu. BEST_VALUE / FASTEST_DELIVERY / BEST_RATED sont compris
 * mais ne réordonnent rien encore (backend ranking-preference.ts) : dire le
 * contraire serait présenter une inconnue comme un fait.
 */
describe('rankingPreferenceLabel — n’annonce que ce qui est réellement appliqué', () => {
  it('ordre par défaut → aucun libellé', () => {
    expect(rankingPreferenceLabel({ preference: 'BEST_MATCH', applied: true })).toBeNull();
    expect(rankingPreferenceLabel(null)).toBeNull();
    expect(rankingPreferenceLabel(undefined)).toBeNull();
  });

  it('PRICE_LOWEST appliqué → libellé de coût', () => {
    expect(rankingPreferenceLabel({ preference: 'PRICE_LOWEST', applied: true }))
      .toBe('Trié par coût total le plus bas');
  });

  it('préférence comprise mais SANS effet → aucun libellé', () => {
    expect(rankingPreferenceLabel({ preference: 'PRICE_LOWEST', applied: false })).toBeNull();
    expect(rankingPreferenceLabel({ preference: 'BEST_VALUE', applied: false })).toBeNull();
    expect(rankingPreferenceLabel({ preference: 'FASTEST_DELIVERY', applied: false })).toBeNull();
  });

  it('préférence inconnue → aucun libellé plutôt qu’un code brut', () => {
    expect(rankingPreferenceLabel({ preference: 'SOMETHING_NEW', applied: true })).toBeNull();
  });
});

/**
 * L'écran de détail portait une COPIE de la règle de livraison, qui avait
 * divergé : elle ne traitait pas la contradiction et affichait un montant
 * disputé comme un fait établi. Ces tests verrouillent la source unique.
 */
describe('Valeur de livraison — source unique, partagée par les écrans', () => {
  const withShipping = (shipping: unknown) => ({ shipping } as never);

  it.each([
    ['absente',                  undefined,                                          'inconnue'],
    ['statut inconnu',           { status: 'unknown', amount: null, currency: 'EUR' }, 'inconnue'],
    ['montant 0 mais inconnu',   { status: 'unknown', amount: 0, currency: 'EUR' },    'inconnue'],
    ['montant absent',           { status: 'known', amount: null, currency: 'EUR' },   'inconnue'],
    ['réellement gratuite',      { status: 'known', amount: 0, currency: 'EUR' },      'offerte'],
  ])('%s → « %s »', (_l, shipping, expected) => {
    expect(shippingValueLabel(withShipping(shipping))).toBe(expected);
  });

  it('un tarif contradictoire n’est jamais rendu comme un montant', () => {
    const label = shippingValueLabel(withShipping({ status: 'contradictory', amount: 4.99, currency: 'EUR' }));
    expect(label).toBe('information contradictoire');
    expect(label).not.toContain('4');
  });

  it('isShippingKnown ne dit vrai que sur une donnée établie', () => {
    expect(isShippingKnown(withShipping({ status: 'known', amount: 4.99, currency: 'EUR' }))).toBe(true);
    expect(isShippingKnown(withShipping({ status: 'unknown', amount: null, currency: 'EUR' }))).toBe(false);
    expect(isShippingKnown(withShipping({ status: 'contradictory', amount: 4.99, currency: 'EUR' }))).toBe(false);
    expect(isShippingKnown(withShipping(undefined))).toBe(false);
  });

  it('les deux formulations restent cohérentes entre elles', () => {
    for (const shipping of [
      undefined,
      { status: 'unknown', amount: null, currency: 'EUR' },
      { status: 'known', amount: 0, currency: 'EUR' },
      { status: 'known', amount: 4.99, currency: 'EUR' },
      { status: 'contradictory', amount: 4.99, currency: 'EUR' },
    ]) {
      const value = shippingValueLabel(withShipping(shipping));
      expect(shippingLabel(withShipping(shipping))).toContain(value);
    }
  });
});
