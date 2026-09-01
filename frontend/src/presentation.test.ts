/**
 * Ce que ces tests protègent : le texte réellement affiché face à une donnée
 * absente, partielle ou contradictoire. C'est le dernier endroit où une
 * inconnue pourrait devenir une affirmation sur l'écran de l'utilisateur.
 */
import {
  costLabel, explainOfferRanking, merchantLabel, offerAccessibilityLabel, offerUrlLabel,
  priceLabel, rankingPreferenceLabel, resultsSummary, shippingLabel,
  shippingValueLabel, isShippingKnown,
} from './presentation';
import { formatMoney } from './theme';

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

/**
 * Explication du classement : elle SITUE une offre parmi celles affichées
 * sans jamais recalculer une valeur ni inventer un motif. Points vérifiés :
 * une offre sans prix ne se compare pas, « le moins cher » n'est dit que sur
 * un coût réellement le plus bas, un écart de prix est chiffré à partir du
 * coût connu, une livraison inconnue n'est jamais « offerte ».
 */
describe('explainOfferRanking — situer une offre, jamais inventer', () => {
  const offer = (o: Record<string, unknown>) => ({
    rank: 1,
    merchant: { id: 'm', name: 'M' },
    price: { amount: 100, currency: 'EUR', status: 'known' },
    shipping: { amount: null, currency: 'EUR', status: 'unknown' },
    cost: { totalKnown: 100, currency: 'EUR', certainty: 'partially_known', unknownComponents: ['shipping'] },
    matchQuality: null,
    rankingReasonCode: undefined,
    readiness: undefined,
    ...o,
  } as never);

  it('rank 1 en BEST_MATCH → « Recommandée : meilleure correspondance »', () => {
    const out = explainOfferRanking(offer({ rank: 1 }), [], { preference: 'BEST_MATCH', applied: true });
    expect(out[0]).toMatch(/^Recommandée : meilleure correspondance/);
  });

  it('rank 1 en PRICE_LOWEST → motif de coût, selon la certitude', () => {
    const known = explainOfferRanking(
      offer({ rank: 1, rankingReasonCode: 'RANKED_LOWEST_KNOWN_COST' }),
      [], { preference: 'PRICE_LOWEST', applied: true }
    );
    expect(known[0]).toContain('coût total connu le plus bas');

    const partial = explainOfferRanking(
      offer({ rank: 1, rankingReasonCode: 'RANKED_LOWEST_PARTIAL_COST' }),
      [], { preference: 'PRICE_LOWEST', applied: true }
    );
    expect(partial[0]).toContain('composantes connues');
  });

  it('offre sans prix → dit explicitement que le coût ne peut pas être comparé', () => {
    const out = explainOfferRanking(
      offer({ price: null, cost: { totalKnown: 0, currency: 'unknown', certainty: 'unknown', unknownComponents: ['productPrice'] } }),
      [offer({})],
    );
    expect(out.some((l) => l.includes('Prix non communiqué'))).toBe(true);
    expect(out.some((l) => /moins cher|le plus bas/.test(l))).toBe(false);
  });

  // Intl insère une espace fine insécable entre le nombre et € : on compare
  // via formatMoney plutôt qu'un littéral, comme le fait l'implémentation.
  const eur = (n: number) => formatMoney(n, 'EUR');

  it('coût total connu ET le plus bas → « Coût total le plus bas »', () => {
    const self = offer({ cost: { totalKnown: 79, currency: 'EUR', certainty: 'known', unknownComponents: [] } });
    const rival = offer({ cost: { totalKnown: 90, currency: 'EUR', certainty: 'known', unknownComponents: [] } });
    const out = explainOfferRanking(self, [self, rival]);
    expect(out).toContain(`Coût total le plus bas : ${eur(79)}.`);
  });

  it('plus cher que la moins chère → écart chiffré', () => {
    const cheap = offer({ cost: { totalKnown: 79, currency: 'EUR', certainty: 'known', unknownComponents: [] } });
    const self = offer({ rank: 2, cost: { totalKnown: 85, currency: 'EUR', certainty: 'known', unknownComponents: [] } });
    const out = explainOfferRanking(self, [cheap, self]);
    expect(out.some((l) => l.startsWith(`${eur(6)} de plus que l’offre la moins chère`))).toBe(true);
  });

  it('ne compare jamais des devises différentes', () => {
    const eurOffer = offer({ cost: { totalKnown: 50, currency: 'EUR', certainty: 'known', unknownComponents: [] } });
    const usd = offer({ price: { amount: 40, currency: 'USD', status: 'known' }, cost: { totalKnown: 40, currency: 'USD', certainty: 'known', unknownComponents: [] } });
    const out = explainOfferRanking(eurOffer, [eurOffer, usd]);
    expect(out).toContain(`Coût total le plus bas : ${eur(50)}.`);
  });

  it('livraison inconnue → « non communiqué », jamais « offerte »', () => {
    const out = explainOfferRanking(offer({ shipping: { amount: null, currency: 'EUR', status: 'unknown' } }), []);
    expect(out.some((l) => l.includes('livraison non communiqué') || l.includes('Coût de livraison non communiqué'))).toBe(true);
    expect(out.some((l) => /offerte/.test(l))).toBe(false);
  });

  it('readiness prête → une phrase claire ; sinon les points à confirmer', () => {
    const ready = explainOfferRanking(offer({ readiness: { ready: true, pending: [], blocked: [] } }), []);
    expect(ready.some((l) => l.startsWith('Achat prêt'))).toBe(true);

    const pending = explainOfferRanking(
      offer({ readiness: { ready: false, pending: ['deliverable'], blocked: [] } }), []
    );
    expect(pending.some((l) => l.includes('À confirmer') && l.includes('livraison'))).toBe(true);
  });

  it('toujours au moins un point (la position)', () => {
    expect(explainOfferRanking(offer({}), []).length).toBeGreaterThan(0);
  });
});
