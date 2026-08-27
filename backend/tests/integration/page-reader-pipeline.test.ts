/**
 * CAPUCINE — le découplage lecture/extraction tient dans le pipeline réel
 *
 * Quatre cas, tous à vérifier de bout en bout :
 *
 *   A. lecture OK, extraction OK      → offre enrichie et classée
 *   B. lecture OK, extraction KO      → la classification SURVIT
 *   C. lecture OK, extraction partielle → ce qui manque reste UNKNOWN
 *   D. lecture KO                     → verdict d'URL conservé, rien d'inventé
 *
 * En B et C, les signaux de structure ne doivent jamais être perdus : c'est
 * exactement ce que l'ancien couplage détruisait.
 */
import { RealWebDiscoveryStrategy } from '../../src/application/real-web-discovery';
import { ProductPageExtractor } from '../../src/application/product-page-extractor';

const adapterOf = (urls: string[]) => ({
  adapterName: 'fixture',
  isConfigured: () => true,
  async search() {
    return {
      searchEngine: 'fixture',
      results: urls.map((url, i) => ({
        title: 'Casque Sony WH-1000XM5',
        url,
        snippet: 'Casque sans fil',
        domain: new URL(url).hostname,
        position: i + 1,
      })),
    };
  },
});

const fetcherOf = (pages: Map<string, string>) => ({
  async fetch(url: string) { return pages.get(url) ?? null; },
});

const criteria = { keywords: ['casque'], limit: 20 } as never;

async function runWith(url: string, html: string | null) {
  const pages = new Map<string, string>();
  if (html !== null) pages.set(url, html);
  const strategy = new RealWebDiscoveryStrategy(
    adapterOf([url]),
    new ProductPageExtractor(fetcherOf(pages) as never),
    { maxPagesRead: 5 }
  );
  return strategy.discover(criteria);
}

const OFFRE_COMPLETE = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Casque Sony WH-1000XM5","sku":"XM5",
 "offers":{"@type":"Offer","price":"329.00","priceCurrency":"EUR",
 "availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Boutique"}}}
</script></head><body><form action="/cart"><button>Ajouter au panier</button></form></body></html>`;

const RUBRIQUE_SANS_PRODUIT = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[]}
</script><link rel="next" href="/page/2"></head>
<body><select name="sort"><option>Trier par prix</option></select></body></html>`;

const PRODUIT_PARTIEL = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Casque Sony WH-1000XM5"}
</script></head><body></body></html>`;

const HTML_MALFORME = '<html><head><script type="application/ld+json">{ceci n\'est pas du json</script></head><body><p>Casque</p>';

describe('§7 A — lecture OK, extraction OK', () => {
  it('l’offre est enrichie et classée', async () => {
    const url = 'https://b.example/produit/casque-sony';
    const r = await runWith(url, OFFRE_COMPLETE);
    expect(r.statistics.pagesRead).toBe(1);
    const c = r.candidates[0];
    expect(c.offer.price.value).toBe(329);
    expect(c.offer.characteristics['pageType']?.value).toBe('OFFER_DETAIL');
  });
});

describe('§7 B — lecture OK, extraction KO : la classification survit', () => {
  it('la rubrique est reconnue bien qu’aucun produit ne soit lisible', async () => {
    // C'est LE cas que l'ancien couplage perdait : sans produit, la page ne
    // disait plus rien et passait pour une offre.
    const url = 'https://b.example/une-page-sans-marqueur';
    const r = await runWith(url, RUBRIQUE_SANS_PRODUIT);

    expect(r.statistics.pagesRead).toBe(1);
    expect(r.statistics.pageEnrichedCount).toBe(0); // rien à enrichir
    // La page a été démise : elle ne peut pas porter d'offre.
    expect(r.candidates).toHaveLength(0);
  });

  it('la page est lue même quand l’HTML est malformé', async () => {
    const url = 'https://b.example/produit/casque-abime';
    const r = await runWith(url, HTML_MALFORME);
    expect(r.statistics.pagesRead).toBe(1);
    // Aucun produit lisible : le prix reste inconnu, jamais inventé.
    expect(r.candidates[0]?.offer.price.value).toBeNull();
  });
});

describe('§7 C — lecture OK, extraction partielle', () => {
  it('le nom est repris, le prix reste UNKNOWN', async () => {
    const url = 'https://b.example/produit/casque-sony';
    const r = await runWith(url, PRODUIT_PARTIEL);
    const c = r.candidates[0];
    expect(c).toBeDefined();
    // UNKNOWN != 0, UNKNOWN != BAD : l'offre survit sans prix.
    expect(c.offer.price.value).toBeNull();
    expect(c.offer.price.status).toBe('unknown');
    // La page reste une fiche produit, pas une offre exploitable.
    expect(c.offer.characteristics['pageType']?.value).toBe('PRODUCT_DETAIL');
  });

  it('une fiche sans prix reste présentée — l’absence n’est pas un rejet', async () => {
    const r = await runWith('https://b.example/produit/casque-sony', PRODUIT_PARTIEL);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

describe('§7 D — lecture KO', () => {
  it('le verdict d’URL est conservé, rien n’est inventé', async () => {
    const url = 'https://b.example/produit/casque-sony';
    const r = await runWith(url, null); // page inaccessible

    expect(r.statistics.pagesRead).toBe(0);
    const c = r.candidates[0];
    expect(c).toBeDefined();
    expect(c.offer.price.value).toBeNull();
    // Classification du premier étage uniquement, et elle le dit.
    expect(String(c.offer.characteristics['pageType']?.provenance?.source)).toContain('page-classification');
    expect(String(c.offer.characteristics['pageType']?.provenance?.source)).not.toContain('+page');
  });

  it('une page inaccessible n’écarte jamais l’offre — l’asymétrie tient', async () => {
    const r = await runWith('https://b.example/produit/casque-sony', null);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});
