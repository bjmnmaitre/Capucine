/**
 * CAPUCINE — la fusion ne doit jamais confondre Produit et Offre
 *
 * Deux défauts réels, trouvés en mesurant sur le Web : 2 offres sur 13
 * arrivaient à l'API sans type de page, alors que toutes en avaient un à la
 * sortie de la découverte.
 *
 * 1. `resolveOffers` remplaçait les caractéristiques de CHAQUE offre par la
 *    fusion au niveau PRODUIT. Le type de page, l'URL canonique et la chaîne
 *    de redirection décrivent pourtant LA PAGE de cette offre-là : deux
 *    marchands vendant le même casque n'ont pas la même page.
 *
 * 2. Dans la fusion, une caractéristique connue d'UNE SEULE source qui n'était
 *    pas l'offre de référence tombait dans un `continue` et disparaissait —
 *    EAN, SKU, destination de livraison, type de page compris.
 *    « Connu par une seule source » n'est pas « inconnu ».
 */
import { DeduplicationEngine } from '../../src/application/deduplication';
import type { DataPoint, Offer } from '../../src/domain/types';

const dp = <T,>(value: T): DataPoint<T> => ({
  value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() },
});

function offerOf(id: string, chars: Record<string, unknown>, price: number, domain = id): Offer {
  return {
    id, productId: 'p-casque',
    merchant: { id: domain, name: domain, country: 'FR', executionCapabilities: ['web_redirect'] },
    price: dp(price), currency: 'EUR',
    shippingCost: { value: null, status: 'unknown' },
    characteristics: Object.fromEntries(Object.entries(chars).map(([k, v]) => [k, dp(v)])),
    executionUrl: `https://${domain}/p/${id}`,
    provenance: { source: 'serper', retrievedAt: new Date() },
    createdAt: new Date(), retrievedAt: new Date(),
  } as Offer;
}

/** Résout un groupe comme le fait le pipeline, et rend les offres finales. */
function resolve(offers: Offer[]): Offer[] {
  const engine = new DeduplicationEngine();
  const result = engine.deduplicate(offers);
  const out: Offer[] = [];
  for (const group of result.groups) out.push(...engine.resolveOffers(group));
  for (const single of result.unique) out.push(single);
  return out;
}

const TITRE = 'Casque Sony WH-1000XM5';

describe('Les faits de page appartiennent à l’offre, jamais au produit', () => {
  it('chaque offre conserve SON type de page', () => {
    const resolved = resolve([
      offerOf('a', { title: TITRE, pageType: 'OFFER_DETAIL' }, 329, 'marchand-a.example'),
      offerOf('b', { title: TITRE, pageType: 'COMMERCIAL_UNKNOWN' }, 349, 'marchand-b.example'),
    ]);
    const types = resolved.map(o => o.characteristics['pageType']?.value).sort();
    expect(types).toEqual(['COMMERCIAL_UNKNOWN', 'OFFER_DETAIL']);
  });

  it('aucune offre ne se voit attribuer la page d’une autre', () => {
    const resolved = resolve([
      offerOf('a', { title: TITRE, pageType: 'OFFER_DETAIL', canonicalUrl: 'https://a.example/canon' }, 329, 'a.example'),
      offerOf('b', { title: TITRE, pageType: 'PRODUCT_DETAIL' }, 349, 'b.example'),
    ]);
    const b = resolved.find(o => o.merchant.id === 'b.example');
    // L'URL canonique de A ne doit pas contaminer B.
    expect(b!.characteristics['canonicalUrl']).toBeUndefined();
  });

  it('la chaîne de redirection reste attachée à l’offre qui a redirigé', () => {
    const resolved = resolve([
      offerOf('a', { title: TITRE, redirectChain: 'https://a.example/x → https://a.example/y' }, 329, 'a.example'),
      offerOf('b', { title: TITRE }, 349, 'b.example'),
    ]);
    expect(resolved.find(o => o.merchant.id === 'b.example')!.characteristics['redirectChain']).toBeUndefined();
    expect(resolved.find(o => o.merchant.id === 'a.example')!.characteristics['redirectChain']).toBeDefined();
  });
});

describe('Une donnée connue d’une seule source n’est jamais perdue', () => {
  it('un EAN publié par une seule offre survit à la fusion', () => {
    const resolved = resolve([
      offerOf('a', { title: TITRE }, 329, 'a.example'),
      offerOf('b', { title: TITRE, ean: '4548736132320' }, 349, 'b.example'),
    ]);
    // Fait PRODUIT : il doit se propager, y compris quand la source n'est pas
    // l'offre de référence.
    for (const o of resolved) {
      expect(o.characteristics['ean']?.value).toBe('4548736132320');
    }
  });

  it('un SKU connu d’une seule source survit également', () => {
    const resolved = resolve([
      offerOf('a', { title: TITRE }, 329, 'a.example'),
      offerOf('b', { title: TITRE, sku: 'WH1000XM5B' }, 349, 'b.example'),
    ]);
    expect(resolved.some(o => o.characteristics['sku']?.value === 'WH1000XM5B')).toBe(true);
  });

  it('le champ conserve sa provenance d’origine, sans marqueur de fusion', () => {
    const resolved = resolve([
      offerOf('a', { title: TITRE }, 329, 'a.example'),
      offerOf('b', { title: TITRE, ean: '4548736132320' }, 349, 'b.example'),
    ]);
    const ean = resolved[0].characteristics['ean'];
    // Une seule source l'a rapporté : rien ne doit laisser croire à un accord.
    expect(ean?.status).not.toBe('verified');
  });
});
