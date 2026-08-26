/**
 * CAPUCINE — l'ordre ne doit pas être détruit par l'arrondi du score.
 *
 * DÉFAUT CORRIGÉ ICI : `overallScore` était arrondi à l'entier au moment du
 * calcul, et le tri lisait cette valeur arrondie. Deux offres dont les scores
 * réels différaient de moins d'un demi-point comparaient donc comme
 * strictement égales, et l'ordre retombait sur le départage par `offer.id` —
 * plaçant une offre objectivement moins bonne au-dessus d'une meilleure.
 *
 * Le moteur calculait la différence, puis la jetait avant de s'en servir.
 *
 * Ce test ne dit RIEN du poids qu'il faut donner au prix (question ouverte,
 * OD-109) : il vérifie seulement qu'une différence calculée est respectée.
 */
import { rankOffers } from '../../src/decision/priority-engine';
import type { Offer, Merchant, PreferenceCriterion } from '../../src/domain/types';

const merchant = (id: string): Merchant =>
  ({ id, name: id, country: 'FR', executionCapabilities: ['web_redirect'] });

const offer = (id: string, price: number, merchantId: string): Offer => ({
  id, productId: 'p1', merchant: merchant(merchantId),
  price: { value: price, status: 'known', provenance: { source: 't', retrievedAt: new Date() } },
  currency: 'EUR', shippingCost: { value: 0, status: 'known' },
  characteristics: {}, executionUrl: `https://${merchantId}.example/p`,
  createdAt: new Date(), retrievedAt: new Date(),
  provenance: { source: 't', retrievedAt: new Date() },
} as Offer);

function rank(offers: Offer[], criteria: PreferenceCriterion[]) {
  return rankOffers({
    effectiveCriteria: criteria, offers, requestId: 'r', timestamp: new Date(),
  }).rankedOffers;
}

// Le prix seul ne suffit pas à révéler le défaut : il faut des critères
// neutres qui diluent l'écart sous le demi-point, comme le fait une vraie
// recherche (modèle, catégorie, marque… tous à 50 faute de données).
const DILUTING: PreferenceCriterion[] = [
  { id: 'a', name: 'A', level: 'preference' },
  { id: 'b', name: 'B', level: 'preference' },
  { id: 'c', name: 'C', level: 'preference' },
  { id: 'd', name: 'D', level: 'preference' },
];

const PRICE: PreferenceCriterion = {
  id: 'price', name: 'Prix', level: 'required',
  parameters: { maxBudget: 400, currency: 'EUR' },
};

describe('Le classement respecte les différences que le moteur a calculées', () => {
  it("une offre au meilleur sous-score passe devant, même si les scores affichés sont égaux", () => {
    // `o1` (la plus chère) est PREMIÈRE dans l'entrée et gagne le départage
    // par id : c'est exactement la situation où l'arrondi la faisait remonter.
    const offers = [
      offer('o1', 349, 'sony'), offer('o2', 329, 'fnac'),
      offer('o3', 319, 'amazon'), offer('o4', 335, 'boulanger'),
    ];
    const ranked = rank(offers, [PRICE, ...DILUTING]);

    const priceOf = (id: string) => ranked.find(r => r.offer.id === id)!;
    const better = priceOf('o3'); // 319 €
    const worse = priceOf('o1');  // 349 €

    const sub = (r: typeof better, id: string) =>
      r.criterionScores.find(c => c.criterionId === id)!.score;
    // Prérequis du test : le sous-score de prix diffère réellement.
    expect(sub(better, 'price')).toBeGreaterThan(sub(worse, 'price'));

    // Les scores AFFICHÉS peuvent être identiques (arrondis)…
    // …mais l'ordre doit suivre la différence réelle.
    expect(ranked.indexOf(better)).toBeLessThan(ranked.indexOf(worse));
  });

  it("le score exact est conservé et reste cohérent avec le score affiché", () => {
    const ranked = rank([offer('o1', 349, 'a'), offer('o2', 319, 'b')], [PRICE, ...DILUTING]);
    for (const r of ranked) {
      expect(typeof r.overallScoreExact).toBe('number');
      // L'affiché est bien l'arrondi de l'exact — aucun des deux n'est inventé.
      expect(r.overallScore).toBe(Math.round(r.overallScoreExact!));
    }
  });

  it("des scores réellement égaux gardent un départage déterministe par id", () => {
    // Même prix : rien ne distingue les offres, l'ordre doit rester stable et
    // indépendant de l'ordre d'entrée.
    const a = [offer('o1', 300, 'x'), offer('o2', 300, 'y')];
    const b = [offer('o2', 300, 'y'), offer('o1', 300, 'x')];

    const first = rank(a, [PRICE]).map(r => r.offer.id);
    const second = rank(b, [PRICE]).map(r => r.offer.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['o1', 'o2']);
  });

  it("l'ordre reste invariant par permutation de l'entrée", () => {
    const base = [
      offer('o1', 349, 'sony'), offer('o2', 329, 'fnac'),
      offer('o3', 319, 'amazon'), offer('o4', 335, 'boulanger'),
    ];
    const shuffled = [base[2], base[0], base[3], base[1]];

    const a = rank(base, [PRICE, ...DILUTING]).map(r => r.offer.id);
    const b = rank(shuffled, [PRICE, ...DILUTING]).map(r => r.offer.id);
    expect(b).toEqual(a);
  });
});

describe('La précision survit aussi au niveau des SOUS-scores', () => {
  // Second défaut d'arrondi, un niveau plus bas que le premier : chaque
  // sous-score était arrondi à l'entier AVANT d'entrer dans le total pondéré.
  // 319 € et 329 € face à un budget de 400 € donnaient tous deux 84, si bien
  // qu'un écart de 10 € disparaissait avant même l'agrégation.
  const PRICE_ONLY: PreferenceCriterion[] = [{
    id: 'price', name: 'Prix', level: 'required',
    parameters: { maxBudget: 400, currency: 'EUR' },
  }];

  it('deux prix proches produisent des sous-scores exacts DIFFÉRENTS', () => {
    const ranked = rank([offer('o1', 329, 'fnac'), offer('o2', 319, 'amazon')], PRICE_ONLY);
    const priceScore = (id: string) =>
      ranked.find(r => r.offer.id === id)!.criterionScores.find(c => c.criterionId === 'price')!;

    const cheap = priceScore('o2');
    const dear = priceScore('o1');

    // Affichés, les deux arrondissent à la même valeur…
    expect(cheap.score).toBe(dear.score);
    // …mais la valeur exacte distingue bien les deux prix.
    expect(cheap.scoreExact).toBeGreaterThan(dear.scoreExact!);
    // Et l'affiché reste l'arrondi de l'exact : aucun des deux n'est inventé.
    expect(cheap.score).toBe(Math.round(cheap.scoreExact!));
  });

  it("l'ordre suit le prix même quand les sous-scores affichés sont égaux", () => {
    const offers = [
      offer('o1', 349, 'sony'), offer('o2', 329, 'fnac'),
      offer('o3', 319, 'amazon'), offer('o4', 335, 'boulanger'),
    ];
    const ranked = rank(offers, [...PRICE_ONLY, ...DILUTING]);
    const prices = ranked.map(r => r.offer.price.value!);
    // Strictement croissant : plus aucun écart réel n'est perdu.
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("un écart de prix minime n'est plus effacé par l'arrondi", () => {
    // 1 € d'écart : invisible après arrondi, mais réel.
    const ranked = rank([offer('o1', 300, 'a'), offer('o2', 299, 'b')], [...PRICE_ONLY, ...DILUTING]);
    expect(ranked[0].offer.price.value).toBe(299);
  });
});
