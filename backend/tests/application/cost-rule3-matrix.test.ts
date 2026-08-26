/**
 * CAPUCINE — matrice de coût réel et MESURE de l'impact de RULE 3
 *
 * Deux objectifs distincts dans un même jeu de données :
 *
 *  1. Vérifier qu'aucun chemin ne transforme une valeur inconnue ou
 *     contradictoire en 0, en « gratuit » ou en certitude (§9).
 *  2. MESURER combien d'offres RULE 3 laisse réellement passer, et pourquoi
 *     elle bloque les autres (§10). La règle n'est PAS modifiée ici : ce
 *     fichier produit les chiffres qui permettront de trancher plus tard.
 */
import { CostEngine } from '../../src/application/cost-engine';
import { WebRedirectHandler } from '../../src/application/cart-preparation-engine';
import type { Offer, Merchant, DataStatus, DataPoint } from '../../src/domain/types';

const merchant = (caps: string[] = ['web_redirect']): Merchant =>
  ({ id: 'm', name: 'M', country: 'FR', executionCapabilities: caps as Merchant['executionCapabilities'] });

const dp = (value: number | null, status: DataStatus): DataPoint<number> =>
  ({ value, status, ...(status === 'known' || status === 'verified'
      ? { provenance: { source: 'matrice', retrievedAt: new Date() } } : {}) });

interface CostCase {
  label: string;
  price: DataPoint<number>;
  shipping: DataPoint<number>;
  taxes?: DataPoint<number>;
  importDuties?: DataPoint<number>;
  fees?: DataPoint<number>;
  url?: string;
  /** Attente sur la certitude du coût. */
  expectCertainty?: 'known' | 'partially_known' | 'unknown';
}

const KNOWN = (n: number) => dp(n, 'known');
const UNKNOWN = dp(null, 'unknown');
const CONTRADICTORY = dp(null, 'contradictory');
const URL = 'https://marchand.example/produit';

/** 20 combinaisons couvrant nominal / inconnu / contradictoire / mixte. */
const CASES: CostCase[] = [
  // ── nominaux ──────────────────────────────────────────────────────────────
  { label: 'prix + livraison connus', price: KNOWN(300), shipping: KNOWN(5) },
  { label: 'prix connu + livraison réellement gratuite (0 connu)', price: KNOWN(300), shipping: KNOWN(0) },
  { label: 'prix + livraison + frais connus', price: KNOWN(300), shipping: KNOWN(5), fees: KNOWN(2) },
  { label: 'toutes composantes connues', price: KNOWN(300), shipping: KNOWN(5), taxes: KNOWN(60), importDuties: KNOWN(0), fees: KNOWN(2), expectCertainty: 'known' },
  // ── inconnus isolés ───────────────────────────────────────────────────────
  { label: 'prix inconnu', price: UNKNOWN, shipping: KNOWN(5), expectCertainty: 'unknown' },
  { label: 'livraison inconnue', price: KNOWN(300), shipping: UNKNOWN },
  { label: 'taxes inconnues', price: KNOWN(300), shipping: KNOWN(5), taxes: UNKNOWN },
  { label: 'import inconnu', price: KNOWN(300), shipping: KNOWN(5), importDuties: UNKNOWN },
  { label: 'frais inconnus', price: KNOWN(300), shipping: KNOWN(5), fees: UNKNOWN },
  // ── contradictoires ───────────────────────────────────────────────────────
  { label: 'prix contradictoire', price: CONTRADICTORY, shipping: KNOWN(5) },
  { label: 'livraison contradictoire', price: KNOWN(300), shipping: CONTRADICTORY },
  { label: 'taxes contradictoires', price: KNOWN(300), shipping: KNOWN(5), taxes: CONTRADICTORY },
  { label: 'prix ET livraison contradictoires', price: CONTRADICTORY, shipping: CONTRADICTORY },
  // ── combinaisons ──────────────────────────────────────────────────────────
  { label: 'prix connu + livraison inconnue + taxes inconnues', price: KNOWN(300), shipping: UNKNOWN, taxes: UNKNOWN },
  { label: 'prix inconnu + livraison connue', price: UNKNOWN, shipping: KNOWN(5), expectCertainty: 'unknown' },
  { label: 'prix inconnu + livraison inconnue', price: UNKNOWN, shipping: UNKNOWN, expectCertainty: 'unknown' },
  { label: 'prix connu + import contradictoire', price: KNOWN(300), shipping: KNOWN(5), importDuties: CONTRADICTORY },
  { label: 'prix connu + tout le reste inconnu', price: KNOWN(300), shipping: UNKNOWN, taxes: UNKNOWN, importDuties: UNKNOWN, fees: UNKNOWN },
  { label: 'prix vérifié + livraison inconnue', price: dp(300, 'verified'), shipping: UNKNOWN },
  { label: 'prix connu sans URL', price: KNOWN(300), shipping: KNOWN(5), url: undefined },
];

function offerFrom(c: CostCase): Offer {
  return {
    id: `o-${c.label}`, productId: 'p', merchant: merchant(),
    price: c.price, currency: 'EUR', shippingCost: c.shipping,
    ...(c.taxes ? { taxes: c.taxes } : {}),
    ...(c.importDuties ? { importDuties: c.importDuties } : {}),
    ...(c.fees ? { fees: c.fees } : {}),
    characteristics: {},
    executionUrl: 'url' in c ? c.url : URL,
    createdAt: new Date(), retrievedAt: new Date(),
    provenance: { source: 'matrice', retrievedAt: new Date() },
  } as Offer;
}

describe('Matrice de coût — aucune inconnue ne devient une certitude', () => {
  const engine = new CostEngine();

  for (const c of CASES) {
    it(`${c.label} : le coût reste honnête`, () => {
      const breakdown = engine.computeCost(offerFrom(c));

      // 1. Une composante non connue n'a JAMAIS de valeur numérique inventée.
      for (const key of ['productPrice', 'shipping', 'taxes', 'importDuties', 'fees'] as const) {
        const component = breakdown[key];
        if (component.status === 'unknown' || component.status === 'contradictory') {
          expect(component.value).toBeNull();
        }
      }

      // 2. certainty 'known' exige que RIEN ne manque.
      if (breakdown.certainty === 'known') {
        expect(breakdown.unknownComponents).toEqual([]);
      } else {
        expect(breakdown.unknownComponents.length).toBeGreaterThan(0);
      }

      // 3. Un prix non connu rend le total indéterminable — pas égal à 0.
      if (c.price.status === 'unknown' || c.price.status === 'contradictory') {
        expect(breakdown.certainty).toBe('unknown');
      }

      if (c.expectCertainty) expect(breakdown.certainty).toBe(c.expectCertainty);
    });
  }

  it('une livraison inconnue n’est jamais confondue avec une livraison à 0', () => {
    const unknownShipping = engine.computeCost(offerFrom(
      { label: 'x', price: KNOWN(300), shipping: UNKNOWN }));
    const freeShipping = engine.computeCost(offerFrom(
      { label: 'y', price: KNOWN(300), shipping: KNOWN(0) }));

    expect(unknownShipping.shipping.value).toBeNull();
    expect(unknownShipping.unknownComponents).toContain('shipping');
    // La gratuité RÉELLE est un fait chiffré, distinct de l'absence.
    expect(freeShipping.shipping.value).toBe(0);
    expect(freeShipping.unknownComponents).not.toContain('shipping');
  });
});

describe('MESURE — impact réel de RULE 3 sur la matrice (règle NON modifiée)', () => {
  it('produit les chiffres de couverture de la règle actuelle', async () => {
    const handler = new WebRedirectHandler();
    const engine = new CostEngine();

    const stats = {
      total: 0, preparables: 0, bloquees: 0,
      bloqueesParPrix: 0, bloqueesParLivraisonContradictoire: 0, bloqueesParUrl: 0,
      livraisonInconnueMaisPreparable: 0,
      coutTotalCalculable: 0,
    };

    for (const c of CASES) {
      const offer = offerFrom(c);
      stats.total += 1;
      if (engine.computeCost(offer).certainty === 'known') stats.coutTotalCalculable += 1;

      const result = await handler.prepareCart({ offer, quantity: 1 });

      if (result.status === 'unavailable') {
        stats.bloquees += 1;
        // Classement d'après les STATUTS de l'offre, pas d'après le texte du
        // message : celui de RULE 3 se termine par « check the final price »,
        // si bien qu'une recherche de « price » attraperait aussi les blocages
        // dus à la livraison. Compter sur les données évite ce faux positif.
        const priceUnusable = offer.price.status === 'unknown' || offer.price.status === 'contradictory';
        const shippingContradictory = offer.shippingCost.status === 'contradictory';
        if (!offer.executionUrl) stats.bloqueesParUrl += 1;
        else if (priceUnusable) stats.bloqueesParPrix += 1;
        else if (shippingContradictory) stats.bloqueesParLivraisonContradictoire += 1;
      } else {
        stats.preparables += 1;
        if (offer.shippingCost.status === 'unknown') stats.livraisonInconnueMaisPreparable += 1;
      }
    }

    // Ces chiffres sont le livrable : ils alimenteront la décision sur RULE 3.
    console.log('[RULE3] ' + JSON.stringify(stats));

    expect(stats.total).toBe(CASES.length);
    expect(stats.preparables + stats.bloquees).toBe(stats.total);
    // Invariant non négociable : un prix non connu ne passe JAMAIS.
    const prixNonConnus = CASES.filter(c =>
      c.price.status === 'unknown' || c.price.status === 'contradictory').length;
    expect(stats.bloqueesParPrix).toBe(prixNonConnus);
  });
});
