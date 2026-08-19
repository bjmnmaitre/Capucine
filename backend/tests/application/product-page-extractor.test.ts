import {
  extractJsonLdProduct,
  ProductPageExtractor,
  PageFetcher,
} from '../../src/application/product-page-extractor';

// ============================================================================
// FIXTURES
// ============================================================================
// These are minimal, representative schema.org/Product JSON-LD samples
// constructed to exercise the parser against the public schema.org
// specification — they do not reproduce any real merchant's actual markup.

const FIXTURE_STANDARD = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "Casque sans fil XM6",
  "offers": {
    "@type": "Offer",
    "price": "349.00",
    "priceCurrency": "EUR",
    "availability": "https://schema.org/InStock",
    "seller": { "@type": "Organization", "name": "Boutique Exemple" }
  }
}
</script>
</head><body></body></html>
`;

const FIXTURE_GRAPH_WRAPPED = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "name": "Page produit" },
    {
      "@type": "Product",
      "name": "Chaussures de trail",
      "offers": [
        {
          "@type": "Offer",
          "price": 120,
          "priceCurrency": "EUR",
          "availability": "https://schema.org/OutOfStock",
          "seller": "Marchand Y"
        }
      ]
    }
  ]
}
</script>
</head></html>
`;

const FIXTURE_NO_JSON_LD = `<html><head><title>Page sans données structurées</title></head><body></body></html>`;

const FIXTURE_MALFORMED_JSON_LD = `
<html><head>
<script type="application/ld+json">
{ this is not valid JSON at all
</script>
</head></html>
`;

const FIXTURE_NON_PRODUCT_JSON_LD = `
<html><head>
<script type="application/ld+json">
{ "@context": "https://schema.org/", "@type": "Organization", "name": "Une entreprise" }
</script>
</head></html>
`;

const FIXTURE_MISSING_PRICE = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Product",
  "name": "Produit sans prix affiché",
  "offers": { "@type": "Offer", "priceCurrency": "EUR" }
}
</script>
</head></html>
`;

// ============================================================================
// extractJsonLdProduct — pure parsing, no network
// ============================================================================

describe('extractJsonLdProduct', () => {
  it('extrait prix, devise, disponibilité, marchand et nom depuis un JSON-LD standard', () => {
    const result = extractJsonLdProduct(FIXTURE_STANDARD, 'https://exemple.fr/produit/1');

    expect(result).not.toBeNull();
    expect(result?.price).toEqual({
      value: 349,
      status: 'known',
      provenance: expect.objectContaining({ source: 'json_ld' }),
    });
    expect(result?.currency).toBe('EUR');
    expect(result?.availability.value).toBe('in_stock');
    expect(result?.merchantName.value).toBe('Boutique Exemple');
    expect(result?.productName.value).toBe('Casque sans fil XM6');
    expect(result?.sourceUrl).toBe('https://exemple.fr/produit/1');
  });

  it('gère le wrapping @graph et les offers en tableau', () => {
    const result = extractJsonLdProduct(FIXTURE_GRAPH_WRAPPED, 'https://exemple.fr/produit/2');

    expect(result).not.toBeNull();
    expect(result?.productName.value).toBe('Chaussures de trail');
    expect(result?.price.value).toBe(120);
    expect(result?.availability.value).toBe('out_of_stock');
    expect(result?.merchantName.value).toBe('Marchand Y'); // seller as plain string
  });

  it("retourne null si aucun bloc JSON-LD n'est présent — jamais de donnée inventée", () => {
    expect(extractJsonLdProduct(FIXTURE_NO_JSON_LD, 'https://exemple.fr/x')).toBeNull();
  });

  it('ignore un bloc JSON-LD malformé sans planter et retourne null', () => {
    expect(extractJsonLdProduct(FIXTURE_MALFORMED_JSON_LD, 'https://exemple.fr/x')).toBeNull();
  });

  it("retourne null si le JSON-LD présent n'est pas un Product (ex: Organization)", () => {
    expect(extractJsonLdProduct(FIXTURE_NON_PRODUCT_JSON_LD, 'https://exemple.fr/x')).toBeNull();
  });

  it('marque le prix comme unknown (jamais 0 ni inventé) quand absent du JSON-LD', () => {
    const result = extractJsonLdProduct(FIXTURE_MISSING_PRICE, 'https://exemple.fr/x');
    expect(result).not.toBeNull();
    expect(result?.price).toEqual({ value: null, status: 'unknown' });
    expect(result?.productName.value).toBe('Produit sans prix affiché');
  });
});

// ============================================================================
// ProductPageExtractor — fetch + extract, with a fake fetcher (no network)
// ============================================================================

class FakeFetcher implements PageFetcher {
  constructor(private readonly response: string | null) {}
  async fetch(): Promise<string | null> {
    return this.response;
  }
}

class ThrowingFetcher implements PageFetcher {
  async fetch(): Promise<string | null> {
    throw new Error('should never be called directly by ProductPageExtractor callers');
  }
}

describe('ProductPageExtractor', () => {
  it('extrait correctement quand le fetcher renvoie une page valide', async () => {
    const extractor = new ProductPageExtractor(new FakeFetcher(FIXTURE_STANDARD));
    const result = await extractor.extract('https://exemple.fr/produit/1');
    expect(result?.price.value).toBe(349);
  });

  it("retourne null sans planter quand le fetcher échoue (réseau indisponible, timeout, etc.)", async () => {
    const extractor = new ProductPageExtractor(new FakeFetcher(null));
    const result = await extractor.extract('https://exemple.fr/produit/1');
    expect(result).toBeNull();
  });

  it('ne fait jamais de deuxième tentative implicite via une autre méthode en cas d\'échec', async () => {
    // Documente explicitement l'invariant : un échec de fetch = null, point.
    // Pas de repli automatique vers un scraping alternatif non demandé.
    const extractor = new ProductPageExtractor(new FakeFetcher(null));
    const result = await extractor.extract('https://exemple.fr/produit/1');
    expect(result).toBeNull();
  });
});

// ============================================================================
// HttpPageFetcher — comportement réel non vérifiable en réseau ici
// ============================================================================
//
// NOTE HONNÊTE : HttpPageFetcher effectue un vrai appel réseau (fetch()).
// Ce fichier ne le teste PAS contre un vrai site marchand : l'environnement
// d'exécution de ces tests n'a pas d'accès réseau vers des domaines
// marchands arbitraires. Son comportement réel (timeout, redirections,
// blocage anti-bot, robots.txt) reste donc REAL_BUT_UNVERIFIED_LIVE tant
// qu'il n'a pas été exécuté contre un vrai marchand dans un environnement
// avec accès réseau complet.
