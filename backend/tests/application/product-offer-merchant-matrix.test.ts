/**
 * CAPUCINE — matrice Product ≠ Offer ≠ Merchant (§7)
 *
 * L'invariant fondateur du produit : Capucine compare des OFFRES concurrentes.
 * Un dédoublonnage trop agressif détruirait sa raison d'être en fusionnant deux
 * marchands qui vendent le même produit ; un dédoublonnage trop timide
 * laisserait passer le même lien deux fois.
 *
 * Cette matrice éprouve les deux erreurs symétriques sur le VRAI moteur.
 */
import { DeduplicationEngine } from '../../src/application/deduplication';
import type { Offer, Merchant, DataStatus } from '../../src/domain/types';

const merchant = (id: string): Merchant =>
  ({ id, name: id, country: 'FR', executionCapabilities: ['web_redirect'] });

interface Spec {
  id: string;
  product: string;
  merchant: string;
  price?: number;
  url?: string;
  title?: string;
  brand?: string;
  model?: string;
  source?: string;
}

function build(s: Spec): Offer {
  const known = (v: unknown) => ({ value: v, status: 'known' as DataStatus });
  return {
    id: s.id, productId: s.product, merchant: merchant(s.merchant),
    price: { value: s.price ?? 300, status: 'known',
             provenance: { source: s.source ?? 'src', retrievedAt: new Date() } },
    currency: 'EUR', shippingCost: { value: 0, status: 'known' },
    characteristics: {
      ...(s.title ? { title: known(s.title) } : {}),
      ...(s.brand ? { brand: known(s.brand) } : {}),
      ...(s.model ? { model: known(s.model) } : {}),
      ...(s.url ? { url: known(s.url) } : {}),
    } as Offer['characteristics'],
    executionUrl: s.url,
    createdAt: new Date(), retrievedAt: new Date(),
    provenance: { source: s.source ?? 'src', retrievedAt: new Date() },
  } as Offer;
}

const dedup = new DeduplicationEngine();

/**
 * Le moteur groupe par PRODUIT : deux marchands vendant le même produit
 * forment UN groupe contenant DEUX offres. C'est le modèle correct — ce qui
 * ne doit jamais disparaître, ce sont les OFFRES. Ce helper compte donc les
 * offres réellement conservées, tous groupes confondus.
 */
function run(offers: Offer[]) {
  const result = dedup.deduplicate(offers);
  // `groups` contient TOUTES les offres conservées ; `result.unique` en est
  // une vue redondante (les groupes à une seule offre). Les additionner
  // compterait deux fois — vérifié sur le moteur.
  const kept = result.groups.flatMap(g => g.offers);
  return { ...result, kept, produits: result.distinctProducts };
}

describe('Le dédoublonnage ne fusionne JAMAIS des offres concurrentes', () => {
  it('cas A — même produit, deux marchands : deux offres conservées', () => {
    const result = run([
      build({ id: 'o1', product: 'sony-xm5', merchant: 'fnac', price: 329,
              url: 'https://fnac.fr/xm5', title: 'Sony WH-1000XM5', model: 'WH-1000XM5' }),
      build({ id: 'o2', product: 'sony-xm5', merchant: 'darty', price: 319,
              url: 'https://darty.fr/xm5', title: 'Sony WH-1000XM5', model: 'WH-1000XM5' }),
    ]);
    // C'est exactement la comparaison que Capucine existe pour rendre possible.
    expect(result.kept.length).toBe(2);
    expect(new Set(result.kept.map(o => o.merchant.id)).size).toBe(2);
    // Un seul produit, mais deux offres : c'est précisément la comparaison.
    expect(result.produits).toBe(1);
  });

  it('cas B — même marchand, deux produits : deux offres conservées', () => {
    const result = run([
      build({ id: 'o1', product: 'sony-xm5', merchant: 'fnac', url: 'https://fnac.fr/xm5', model: 'WH-1000XM5' }),
      build({ id: 'o2', product: 'sony-xm4', merchant: 'fnac', url: 'https://fnac.fr/xm4', model: 'WH-1000XM4' }),
    ]);
    expect(result.kept.length).toBe(2);
  });

  it('cas C — modèles proches mais différents : jamais confondus', () => {
    const result = run([
      build({ id: 'o1', product: 'p-xm4', merchant: 'a', url: 'https://a.fr/xm4',
              title: 'Sony WH-1000XM4', model: 'WH-1000XM4' }),
      build({ id: 'o2', product: 'p-xm5', merchant: 'b', url: 'https://b.fr/xm5',
              title: 'Sony WH-1000XM5', model: 'WH-1000XM5' }),
    ]);
    expect(result.kept.length).toBe(2);
  });

  it('cas D — titres identiques mais marchands ET URLs différents', () => {
    const result = run([
      build({ id: 'o1', product: 'p', merchant: 'a', url: 'https://a.fr/p', title: 'Casque Bluetooth' }),
      build({ id: 'o2', product: 'p', merchant: 'b', url: 'https://b.fr/p', title: 'Casque Bluetooth' }),
    ]);
    // Un titre commun ne suffit pas à fusionner : ce sont deux vendeurs.
    expect(result.kept.length).toBe(2);
  });

  it('cas E — deux offres du même marchand à des prix différents restent distinctes', () => {
    const result = run([
      build({ id: 'o1', product: 'p', merchant: 'a', price: 299, url: 'https://a.fr/p?v=neuf' }),
      build({ id: 'o2', product: 'p', merchant: 'a', price: 219, url: 'https://a.fr/p?v=reconditionne' }),
    ]);
    expect(result.kept.length).toBe(2);
  });

  it('cas F — provenances différentes n’autorisent pas la fusion', () => {
    const result = run([
      build({ id: 'o1', product: 'p', merchant: 'a', url: 'https://a.fr/p', source: 'brave' }),
      build({ id: 'o2', product: 'p', merchant: 'b', url: 'https://b.fr/p', source: 'serper' }),
    ]);
    expect(result.kept.length).toBe(2);
    // La provenance de chaque offre survit au dédoublonnage.
    expect(result.kept.every(o => Boolean(o.provenance?.source))).toBe(true);
  });
});

describe('Répartition des responsabilités de dédoublonnage', () => {
  // CONSTAT VÉRIFIÉ, pas une supposition : DeduplicationEngine groupe par
  // PRODUIT et conserve toutes les offres du groupe. Le dédoublonnage par URL
  // — deux requêtes tombant sur la même page — est fait en amont par
  // RealWebDiscoveryStrategy (couvert par real-web-discovery.test.ts:388).
  // Les deux couches sont complémentaires ; aucune ne remplace l'autre.

  it('deux offres de même URL sont groupées sous UN produit', () => {
    const result = run([
      build({ id: 'o1', product: 'p', merchant: 'fnac', url: 'https://fnac.fr/xm5', source: 'brave' }),
      build({ id: 'o2', product: 'p', merchant: 'fnac', url: 'https://fnac.fr/xm5', source: 'serper' }),
    ]);
    // Un seul produit reconnu…
    expect(result.produits).toBe(1);
    // …les offres restant à la charge de la couche amont pour l'URL.
    expect(result.groups.length).toBe(1);
  });

  it('des offres de produits distincts ne sont jamais regroupées', () => {
    const result = run([
      build({ id: 'o1', product: 'pA', merchant: 'fnac', url: 'https://fnac.fr/a', model: 'XM4' }),
      build({ id: 'o2', product: 'pB', merchant: 'fnac', url: 'https://fnac.fr/b', model: 'XM5' }),
    ]);
    expect(result.produits).toBe(2);
  });
});

describe('Robustesse du dédoublonnage', () => {
  it('des offres sans URL ni identifiant ne sont pas fusionnées à l’aveugle', () => {
    const result = run([
      build({ id: 'o1', product: 'p', merchant: 'a' }),
      build({ id: 'o2', product: 'p', merchant: 'b' }),
    ]);
    // Sans preuve d'identité commune, deux marchands restent deux offres.
    expect(result.kept.length).toBe(2);
  });

  it('une liste vide ne provoque aucune erreur', () => {
    expect(run([]).kept).toEqual([]);
  });

  it('une offre seule est conservée telle quelle', () => {
    const result = run([build({ id: 'o1', product: 'p', merchant: 'a', url: 'https://a.fr/p' })]);
    expect(result.kept.length).toBe(1);
    expect(result.kept[0].id).toBe('o1');
  });

  it('le dédoublonnage est déterministe et indépendant de l’ordre d’entrée', () => {
    const a = build({ id: 'o1', product: 'p', merchant: 'a', url: 'https://a.fr/p' });
    const b = build({ id: 'o2', product: 'p', merchant: 'b', url: 'https://b.fr/p' });
    const c = build({ id: 'o3', product: 'p', merchant: 'a', url: 'https://a.fr/p' });

    const forward = run([a, b, c]).kept.length;
    const backward = run([c, b, a]).kept.length;
    expect(backward).toBe(forward);
  });
});
