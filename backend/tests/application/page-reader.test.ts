/**
 * CAPUCINE — découplage lecture de page / extraction produit
 *
 * L'invariant vérifié partout ici :
 *
 *   lire une page ne doit rien devoir à la capacité d'y trouver un produit.
 *
 * Il ne s'agit pas d'une préférence de conception. Mesuré sur les 112 pages
 * réellement téléchargées du corpus : 44 % ne rendent aucune donnée produit,
 * 28 d'entre elles portaient un relevé de structure exploitable qui était
 * jeté, et 3 pages incapables de porter une offre passaient pour des offres
 * uniquement parce qu'on avait renoncé à les lire.
 *
 * Deux `null` que le code confondait et qui ne doivent plus l'être :
 *   page INACCESSIBLE  → on ne sait rien ;
 *   page SANS PRODUIT  → on sait qu'elle ne vend pas ce qu'on cherchait.
 */
import { PageReader, type PageFetcherLike } from '../../src/application/page-reader';
import { ProductPageExtractor } from '../../src/application/product-page-extractor';
import { classifyPage } from '../../src/application/page-classification';

/** Récupérateur contrôlé : rend exactement ce qu'on lui donne, sans réseau. */
function fetcherOf(html: string | null): PageFetcherLike {
  return { async fetch() { return html; } };
}

const RUBRIQUE_SANS_PRODUIT = `<!doctype html><html><head>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ItemList","itemListElement":[]}
  </script>
  <link rel="next" href="/page/2">
</head><body>
  <select name="sort"><option>Trier par prix</option></select>
</body></html>`;

const FICHE_PRODUIT = `<!doctype html><html><head>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Casque Sony WH-1000XM5",
     "sku":"WH1000XM5","offers":{"@type":"Offer","price":"329.00","priceCurrency":"EUR",
     "availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Boutique"}}}
  </script>
</head><body><form action="/cart"><button>Ajouter au panier</button></form></body></html>`;

const PAGE_MUETTE = '<!doctype html><html><body><p>Bonjour.</p></body></html>';

describe('PageReader — l’invariant fondateur', () => {
  it('rend null UNIQUEMENT quand la page n’a pas pu être récupérée', async () => {
    const reader = new PageReader(fetcherOf(null));
    expect(await reader.read('https://x.example/a')).toBeNull();
  });

  it('une page muette produit quand même un instantané', async () => {
    // « Lue, et elle ne déclare rien » n'est pas « non lue ». Les confondre
    // reviendrait à transformer une ignorance en constat.
    const reader = new PageReader(fetcherOf(PAGE_MUETTE));
    const read = await reader.read('https://x.example/a');
    expect(read).not.toBeNull();
    expect(read!.snapshot.requestedUrl).toBe('https://x.example/a');
    expect(read!.snapshot.signals).toBeDefined();
  });

  it('une page SANS produit rend un relevé de structure complet', async () => {
    // C'est exactement le cas qui était perdu : aucun Product lisible, mais la
    // page déclare une liste, une pagination et des contrôles de tri.
    const reader = new PageReader(fetcherOf(RUBRIQUE_SANS_PRODUIT));
    const read = await reader.read('https://x.example/liste');
    expect(read!.snapshot.signals.jsonLdTypes).toContain('ItemList');
    expect(read!.snapshot.signals.hasPagination).toBe(true);
    expect(read!.snapshot.signals.hasListingControls).toBe(true);
  });

  it('l’instantané ne porte AUCUNE donnée commerciale', async () => {
    // Le lecteur constate la nature du document, jamais ce qu'il vend.
    const reader = new PageReader(fetcherOf(FICHE_PRODUIT));
    const read = await reader.read('https://x.example/p');
    const serialized = JSON.stringify(read!.snapshot);
    expect(serialized).not.toContain('329');
    expect(serialized).not.toContain('Boutique');
  });

  it('le document brut est rendu, pour qu’aucune page ne soit lue deux fois', async () => {
    let calls = 0;
    const counting: PageFetcherLike = { async fetch() { calls++; return FICHE_PRODUIT; } };
    const read = await new PageReader(counting).read('https://x.example/p');
    expect(read!.html).toBe(FICHE_PRODUIT);
    expect(calls).toBe(1);
  });

  it('la taille rapportée est celle du document réellement lu', async () => {
    const read = await new PageReader(fetcherOf(PAGE_MUETTE)).read('https://x.example/a');
    expect(read!.snapshot.length).toBe(PAGE_MUETTE.length);
  });
});

describe('ProductPageExtractor.read — les deux lectures sont indépendantes', () => {
  const extractorOf = (html: string | null) =>
    new ProductPageExtractor(fetcherOf(html) as never);

  it('page inaccessible → null, on ne sait rien', async () => {
    expect(await extractorOf(null).read('https://x.example/a')).toBeNull();
  });

  it('page lue sans produit → instantané présent, produit absent', async () => {
    const reading = await extractorOf(RUBRIQUE_SANS_PRODUIT).read('https://x.example/liste');
    expect(reading).not.toBeNull();
    expect(reading!.product).toBeNull();
    expect(reading!.snapshot.signals.jsonLdTypes).toContain('ItemList');
  });

  it('page lue avec produit → les deux sont présents', async () => {
    const reading = await extractorOf(FICHE_PRODUIT).read('https://x.example/p');
    expect(reading!.product).not.toBeNull();
    expect(reading!.product!.price.value).toBe(329);
    expect(reading!.snapshot.signals.hasAddToCart).toBe(true);
  });

  it('extract() reste disponible et se comporte comme avant', async () => {
    expect(await extractorOf(FICHE_PRODUIT).extract('https://x.example/p')).not.toBeNull();
    expect(await extractorOf(RUBRIQUE_SANS_PRODUIT).extract('https://x.example/l')).toBeNull();
    expect(await extractorOf(null).extract('https://x.example/a')).toBeNull();
  });

  it('le constat de structure n’est analysé qu’UNE fois par page', async () => {
    // Le produit reçoit l'instantané du lecteur, il ne le recalcule pas.
    const reading = await extractorOf(FICHE_PRODUIT).read('https://x.example/p');
    expect(reading!.product!.structure).toBe(reading!.snapshot.signals);
  });
});

describe('Conséquence : une page sans produit reste classifiable', () => {
  it('la rubrique est reconnue alors qu’aucun produit n’y est lisible', async () => {
    // Avant le découplage, cette page ne disait plus rien et passait pour une
    // offre. C'est la régression que ce test empêche de revenir.
    const reading = await new ProductPageExtractor(fetcherOf(RUBRIQUE_SANS_PRODUIT) as never)
      .read('https://boutique.example/une-page-quelconque');
    expect(reading!.product).toBeNull();

    const sansLecture = classifyPage({ url: 'https://boutique.example/une-page-quelconque' });
    const avecLecture = classifyPage({
      url: 'https://boutique.example/une-page-quelconque',
      structure: reading!.snapshot.signals,
    });

    expect(sansLecture.offerEligible).toBe(true);   // l'URL ne dit rien
    expect(avecLecture.type).toBe('CATEGORY');       // la page, elle, le dit
    expect(avecLecture.offerEligible).toBe(false);
  });
});

describe('§3 — URL demandée ≠ URL finale ≠ URL canonique', () => {
  /** Récupérateur complet : rapporte l'URL finale et le chemin parcouru. */
  const redirectingFetcher = (html: string, finalUrl: string, chain: string[]) => ({
    async fetch() { return html; },
    async fetchPage(requestedUrl: string) {
      return { html, requestedUrl, finalUrl, redirectChain: chain };
    },
  });

  const withCanonical = (href: string) =>
    `<html><head><link rel="canonical" href="${href}"></head><body></body></html>`;

  it('les trois URL sont conservées séparément', async () => {
    const reader = new PageReader(redirectingFetcher(
      withCanonical('https://boutique.example/produit/casque-sony'),
      'https://boutique.example/fr/produit/casque-sony',
      ['https://boutique.example/fr/produit/casque-sony'],
    ));
    const read = await reader.read('https://boutique.example/p/xm5');
    expect(read!.snapshot.requestedUrl).toBe('https://boutique.example/p/xm5');
    expect(read!.snapshot.finalUrl).toBe('https://boutique.example/fr/produit/casque-sony');
    expect(read!.snapshot.canonicalUrl).toBe('https://boutique.example/produit/casque-sony');
  });

  it('la chaîne de redirection est conservée pour la provenance', async () => {
    const chain = ['https://b.example/b', 'https://b.example/c'];
    const read = await new PageReader(redirectingFetcher(withCanonical('https://b.example/c'), 'https://b.example/c', chain))
      .read('https://b.example/a');
    expect(read!.snapshot.redirectChain).toEqual(chain);
  });

  it('sans redirection, la chaîne est vide et finalUrl vaut l’adresse servie', async () => {
    const read = await new PageReader(redirectingFetcher('<html></html>', 'https://b.example/a', []))
      .read('https://b.example/a');
    expect(read!.snapshot.redirectChain).toEqual([]);
    expect(read!.snapshot.finalUrl).toBe('https://b.example/a');
  });

  it('un récupérateur qui ne rapporte pas l’URL finale laisse null — jamais l’URL demandée', async () => {
    // « Peut-être redirigé » n'est pas « on sait qu'il n'a pas redirigé ».
    const read = await new PageReader(fetcherOf('<html></html>')).read('https://b.example/a');
    expect(read!.snapshot.finalUrl).toBeNull();
    expect(read!.snapshot.requestedUrl).toBe('https://b.example/a');
  });

  it('un canonical RELATIF est résolu contre l’adresse servie, pas la demandée', async () => {
    // Après redirection les deux diffèrent : la mauvaise base fabriquerait
    // une URL fausse.
    const read = await new PageReader(redirectingFetcher(
      withCanonical('/fr/produit/casque'),
      'https://autre-hote.example/x/y',
      ['https://autre-hote.example/x/y'],
    )).read('https://depart.example/a');
    expect(read!.snapshot.canonicalUrl).toBe('https://autre-hote.example/fr/produit/casque');
  });

  it('un canonical malformé ne produit rien plutôt qu’une URL devinée', async () => {
    // Note : presque toute chaîne se résout en chemin relatif contre une base.
    // Seule une adresse structurellement invalide échoue — c'est ce cas-là
    // qui ne doit jamais produire une URL inventée.
    const read = await new PageReader(redirectingFetcher(withCanonical('http://[malforme'), 'https://b.example/a', []))
      .read('https://b.example/a');
    expect(read!.snapshot.canonicalUrl).toBeNull();
  });

  it('un canonical relatif inhabituel est résolu, non rejeté', async () => {
    const read = await new PageReader(redirectingFetcher(withCanonical('../produit/casque'), 'https://b.example/fr/p/x', []))
      .read('https://b.example/fr/p/x');
    expect(read!.snapshot.canonicalUrl).toBe('https://b.example/fr/produit/casque');
  });

  it('l’absence de canonical est un null, pas une valeur de repli', async () => {
    const read = await new PageReader(redirectingFetcher('<html><head></head></html>', 'https://b.example/a', []))
      .read('https://b.example/a');
    expect(read!.snapshot.canonicalUrl).toBeNull();
  });

  it('un canonical désignant une AUTRE page est conservé tel quel', async () => {
    // Cas réel : variante de couleur pointant vers la fiche mère. Capucine
    // doit pouvoir le constater, pas le corriger en silence.
    const read = await new PageReader(redirectingFetcher(
      withCanonical('https://b.example/produit/casque-mere'), 'https://b.example/produit/casque-noir', []
    )).read('https://b.example/produit/casque-noir');
    expect(read!.snapshot.canonicalUrl).not.toBe(read!.snapshot.finalUrl);
  });
});

describe('Budget de lecture — mesurable, et honnêtement rapporté', () => {
  const { RealWebDiscoveryStrategy } = require('../../src/application/real-web-discovery');

  /** Adaptateur de recherche déterministe, sans réseau. */
  const adapterOf = (urls: string[]) => ({
    adapterName: 'fixture',
    isConfigured: () => true,
    async search() {
      return {
        searchEngine: 'fixture',
        results: urls.map((url, i) => ({
          title: 'Casque Sony WH-1000XM5',
          url,
          snippet: 'Casque 99 EUR',
          domain: new URL(url).hostname,
          position: i + 1,
        })),
      };
    },
  });

  /** Récupérateur qui compte ses appels : aucune page ne doit être lue deux fois. */
  const countingFetcher = (pages: Map<string, string>) => {
    const calls: string[] = [];
    return {
      calls,
      fetcher: {
        async fetch(url: string) { calls.push(url); return pages.get(url) ?? null; },
      },
    };
  };

  const criteria = { keywords: ['casque'], limit: 20 } as never;

  const buildStrategy = (urls: string[], pages: Map<string, string>, maxPagesRead: number) => {
    const { fetcher, calls } = countingFetcher(pages);
    const strategy = new RealWebDiscoveryStrategy(
      adapterOf(urls),
      new ProductPageExtractor(fetcher as never),
      { maxPagesRead }
    );
    return { strategy, calls };
  };

  const productPage = (price: number) => `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
      "name":"Casque","offers":{"@type":"Offer","price":"${price}","priceCurrency":"EUR"}}</script>
    </head><body></body></html>`;

  it('lit au plus le nombre de pages demandé', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://b${i}.example/produit/casque-${i}`);
    const pages = new Map(urls.map((u, i) => [u, productPage(100 + i)]));
    const { strategy, calls } = buildStrategy(urls, pages, 3);
    const result = await strategy.discover(criteria);
    expect(result.statistics.pagesRead).toBeLessThanOrEqual(3);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it('aucune page n’est récupérée deux fois', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://b${i}.example/produit/casque-${i}`);
    const pages = new Map(urls.map((u, i) => [u, productPage(200 + i)]));
    const { strategy, calls } = buildStrategy(urls, pages, 6);
    await strategy.discover(criteria);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it('pagesRead compte les pages LUES, pageEnrichedCount les offres MODIFIÉES', async () => {
    // Distincts par construction : une page peut être lue et caractérisée sans
    // rien apporter au produit. Les confondre ferait passer une lecture
    // réussie pour un échec.
    const url = 'https://b.example/produit/casque';
    const pages = new Map([[url, '<html><body><p>rien de balisé</p></body></html>']]);
    const { strategy } = buildStrategy([url], pages, 5);
    const result = await strategy.discover(criteria);
    expect(result.statistics.pagesRead).toBe(1);
    expect(result.statistics.pageEnrichedCount).toBe(0);
  });

  it('une page inaccessible n’est pas comptée comme lue', async () => {
    const url = 'https://b.example/produit/casque';
    const { strategy } = buildStrategy([url], new Map(), 5);
    const result = await strategy.discover(criteria);
    expect(result.statistics.pagesRead).toBe(0);
  });
});
