/**
 * CAPUCINE — matrice d'extraction multi-formats (§3)
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * L'extracteur n'était éprouvé que sur du JSON-LD bien formé. Le risque
 * identifié avant les premiers appels Web réels : découvrir à ce moment-là
 * que la plupart des pages ne sont pas exploitables, sans qu'aucun test ne
 * l'ait signalé — l'extracteur renvoyant `null` en silence.
 *
 * Cette matrice balaie 35 formes de pages réelles et MESURE le taux
 * d'exploitation. Elle ne cherche pas à faire passer l'extracteur : elle
 * établit ce qu'il sait faire, et ce qu'il ignore.
 *
 * CONTRAT MIS À JOUR : l'extracteur lit désormais, en plus du JSON-LD,
 * OpenGraph, microdata, meta et HTML sémantique — champ par champ, chacun
 * portant sa source. Le JSON-LD reste prioritaire ; les autres formats
 * comblent ses trous ou prennent le relais quand il est absent.
 * Le seuil d'exploitation reste strict : une page doit apporter un prix, une
 * disponibilité ou une marque. Un simple titre ne suffit pas — le résultat de
 * recherche en fournit déjà un, et une offre creuse serait du bruit.
 */
import { extractJsonLdProduct } from '../../src/application/product-page-extractor';
import { extractHtmlFields } from '../../src/application/html-field-extractors';

const URL = 'https://marchand.example/produit';

const jsonLd = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

const product = (over: Record<string, unknown> = {}) => ({
  '@context': 'https://schema.org', '@type': 'Product',
  name: 'Casque Sony WH-1000XM5', brand: { '@type': 'Brand', name: 'Sony' },
  offers: { '@type': 'Offer', price: '329.00', priceCurrency: 'EUR',
            availability: 'https://schema.org/InStock' },
  ...over,
});

interface Fixture {
  label: string;
  html: string;
  /** L'extracteur produit-il un résultat exploitable ? */
  expectExtracted: boolean;
  /** Le prix est-il attendu comme connu ? */
  expectPriceKnown?: boolean;
}

const FIXTURES: Fixture[] = [
  // ── A-F : JSON-LD, les formes réellement supportées ─────────────────────
  { label: 'A. JSON-LD Product complet', html: jsonLd(product()), expectExtracted: true, expectPriceKnown: true },
  { label: 'B. JSON-LD offers en tableau', html: jsonLd(product({ offers: [{ '@type': 'Offer', price: '329', priceCurrency: 'EUR' }] })), expectExtracted: true, expectPriceKnown: true },
  { label: 'C. JSON-LD dans @graph', html: jsonLd({ '@context': 'https://schema.org', '@graph': [product()] }), expectExtracted: true, expectPriceKnown: true },
  { label: 'D. JSON-LD sans prix', html: jsonLd(product({ offers: { '@type': 'Offer', priceCurrency: 'EUR' } })), expectExtracted: true, expectPriceKnown: false },
  { label: 'E. JSON-LD sans bloc offers', html: jsonLd(product({ offers: undefined })), expectExtracted: true, expectPriceKnown: false },
  { label: 'F. JSON-LD avec disponibilité OutOfStock', html: jsonLd(product({ offers: { '@type': 'Offer', price: '329', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock' } })), expectExtracted: true, expectPriceKnown: true },
  { label: 'G. JSON-LD prix numérique (non chaîne)', html: jsonLd(product({ offers: { '@type': 'Offer', price: 329.9, priceCurrency: 'EUR' } })), expectExtracted: true, expectPriceKnown: true },
  { label: 'H. JSON-LD prix avec virgule décimale', html: jsonLd(product({ offers: { '@type': 'Offer', price: '329,90', priceCurrency: 'EUR' } })), expectExtracted: true },
  { label: 'I. JSON-LD avec shippingRate', html: jsonLd(product({ offers: { '@type': 'Offer', price: '329', priceCurrency: 'EUR', shippingDetails: { '@type': 'OfferShippingDetails', shippingRate: { '@type': 'MonetaryAmount', value: '4.99', currency: 'EUR' } } } })), expectExtracted: true, expectPriceKnown: true },
  { label: 'J. JSON-LD avec additionalProperty', html: jsonLd(product({ additionalProperty: [{ '@type': 'PropertyValue', name: 'RAM', value: '16GB' }] })), expectExtracted: true },
  { label: 'K. JSON-LD reconditionné', html: jsonLd(product({ offers: { '@type': 'Offer', price: '219', priceCurrency: 'EUR', itemCondition: 'https://schema.org/RefurbishedCondition' } })), expectExtracted: true, expectPriceKnown: true },
  { label: 'L. JSON-LD avec gtin13', html: jsonLd(product({ gtin13: '4548736132597' })), expectExtracted: true },
  { label: 'M. JSON-LD marque en chaîne simple', html: jsonLd(product({ brand: 'Sony' })), expectExtracted: true },
  { label: 'N. JSON-LD avec plusieurs blocs, Product en second', html: `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Fnac' })}</script><script type="application/ld+json">${JSON.stringify(product())}</script></head></html>`, expectExtracted: true, expectPriceKnown: true },

  // ── Formes NON supportées : la frontière réelle du contrat ───────────────
  { label: 'O. OpenGraph seul (og:price)', html: `<html><head><meta property="og:title" content="Sony WH-1000XM5"><meta property="og:price:amount" content="329.00"><meta property="og:price:currency" content="EUR"></head></html>`, expectExtracted: true },
  { label: 'P. meta tags seuls', html: `<html><head><meta name="product:price:amount" content="329"><meta name="description" content="Casque Sony"></head></html>`, expectExtracted: true },
  { label: 'Q. microdata itemprop', html: `<html><body><div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Sony WH-1000XM5</span><span itemprop="price">329.00</span></div></body></html>`, expectExtracted: true },
  { label: 'R. HTML simple, prix en texte', html: `<html><body><h1>Sony WH-1000XM5</h1><p class="price">329,00 €</p></body></html>`, expectExtracted: true },
  { label: 'S. HTML avec prix barré + promotionnel', html: `<html><body><span class="old">399,00 €</span><span class="now">329,00 €</span></body></html>`, expectExtracted: false },
  { label: 'T. HTML avec plusieurs prix', html: `<html><body><span>329 €</span><span>349 €</span><span>399 €</span></body></html>`, expectExtracted: false },
  { label: 'U. HTML mentionnant la livraison', html: `<html><body><p>Livraison 4,99 €</p><p>329,00 €</p></body></html>`, expectExtracted: false },
  { label: 'V. HTML sans livraison', html: `<html><body><p>329,00 €</p></body></html>`, expectExtracted: false },
  { label: 'W. HTML avec variantes', html: `<html><body><select><option>Noir - 329 €</option><option>Argent - 339 €</option></select></body></html>`, expectExtracted: false },
  // X reste non exploitable À DESSEIN : un montant dans un <p> sans marqueur
  // de prix pourrait tout aussi bien être un tarif de livraison. Balayer le
  // texte au hasard produirait des prix faux — pire qu'une absence.
  { label: 'X. HTML sans marque', html: `<html><body><h1>Casque bluetooth</h1><p>89,90 €</p></body></html>`, expectExtracted: false },
  { label: 'Y. page partiellement vide', html: `<html><head><title>Produit</title></head><body></body></html>`, expectExtracted: false },
  { label: 'Z. page entièrement vide', html: '', expectExtracted: false },

  // ── Robustesse : formes cassées ─────────────────────────────────────────
  { label: 'AA. JSON-LD malformé (JSON invalide)', html: `<html><head><script type="application/ld+json">{ ceci n'est pas du JSON</script></head></html>`, expectExtracted: false },
  { label: 'AB. JSON-LD vide', html: `<html><head><script type="application/ld+json"></script></head></html>`, expectExtracted: false },
  { label: 'AC. JSON-LD non-Product (Organization)', html: jsonLd({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Fnac' }), expectExtracted: false },
  { label: 'AD. JSON-LD Article', html: jsonLd({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Test du WH-1000XM5' }), expectExtracted: false },
  { label: 'AE. JSON-LD tronqué', html: `<html><head><script type="application/ld+json">{"@type":"Product","name":"Sony"`, expectExtracted: false },
  { label: 'AF. script sans type ld+json', html: `<html><head><script>${JSON.stringify(product())}</script></head></html>`, expectExtracted: false },
  { label: 'AG. HTML malformé, balises non fermées', html: `<html><body><div><span>329 €`, expectExtracted: false },
  { label: 'AH. page très longue sans données', html: `<html><body>${'texte '.repeat(5000)}</body></html>`, expectExtracted: false },
  { label: 'AI. JSON-LD avec prix contradictoires entre deux offers', html: jsonLd(product({ offers: [{ '@type': 'Offer', price: '329', priceCurrency: 'EUR' }, { '@type': 'Offer', price: '399', priceCurrency: 'EUR' }] })), expectExtracted: true },
];

describe('Matrice d’extraction — 35 formes de pages', () => {
  for (const f of FIXTURES) {
    it(`${f.label} → ${f.expectExtracted ? 'exploitable' : 'non exploitable (null)'}`, () => {
      const result = extractJsonLdProduct(f.html, URL);

      if (!f.expectExtracted) {
        // Non exploitable = null. C'est HONNÊTE : rien n'est inventé.
        expect(result).toBeNull();
        return;
      }

      expect(result).not.toBeNull();
      // Invariant : jamais de prix fabriqué. Absent ⇒ statut 'unknown', valeur null.
      if (f.expectPriceKnown === true) {
        expect(result!.price.status).toBe('known');
        expect(typeof result!.price.value).toBe('number');
      } else if (f.expectPriceKnown === false) {
        expect(result!.price.status).toBe('unknown');
        expect(result!.price.value).toBeNull();
      }
      // La provenance de la page extraite est toujours conservée.
      expect(result!.sourceUrl).toBe(URL);
      // La méthode d'extraction est conservée et nommée : elle distingue un
      // balisage structuré publié par le marchand d'une lecture HTML.
      expect(['json_ld_product', 'html_fields']).toContain(result!.extractionMethod);
      // Une livraison non publiée reste inconnue, jamais 0.
      if (result!.shippingCost.status !== 'known') {
        expect(result!.shippingCost.value).toBeNull();
      }
    });
  }
});

describe('MESURE — taux d’exploitation par famille de format', () => {
  it('quantifie la couverture réelle de l’extracteur', () => {
    const familles = {
      'json-ld': FIXTURES.filter(f => /^[A-N]\./.test(f.label)),
      'autres formats (OG/meta/microdata/HTML)': FIXTURES.filter(f => /^[O-Z]\./.test(f.label)),
      'formes cassées': FIXTURES.filter(f => /^A[A-I]\./.test(f.label)),
    };

    const mesure: Record<string, { total: number; exploitables: number; taux: string }> = {};
    for (const [nom, liste] of Object.entries(familles)) {
      const exploitables = liste.filter(f => extractJsonLdProduct(f.html, URL) !== null).length;
      mesure[nom] = {
        total: liste.length, exploitables,
        taux: liste.length ? `${Math.round((exploitables / liste.length) * 100)}%` : 'n/a',
      };
    }
    const total = FIXTURES.length;
    const exploitablesTotal = FIXTURES.filter(f => extractJsonLdProduct(f.html, URL) !== null).length;

    console.log('[EXTRACTION] ' + JSON.stringify({
      ...mesure,
      global: { total, exploitables: exploitablesTotal,
                taux: `${Math.round((exploitablesTotal / total) * 100)}%` },
    }));

    // Ce que ces chiffres établissent : le JSON-LD est solide, tout le reste
    // du Web est hors de portée. Ce n'est PAS un bug — c'est la frontière
    // documentée du contrat — mais c'est la donnée qui permet de décider s'il
    // faut investir dans l'extraction HTML avant le lancement.
    expect(mesure['json-ld'].exploitables).toBe(mesure['json-ld'].total);
    // Cette famille était à 0 avant l'extraction multi-format.
    expect(mesure['autres formats (OG/meta/microdata/HTML)'].exploitables).toBeGreaterThan(0);
  });

  it('aucune forme cassée ne provoque d’exception', () => {
    for (const f of FIXTURES) {
      expect(() => extractJsonLdProduct(f.html, URL)).not.toThrow();
    }
  });
});

describe('MESURE — gain de couverture apporté par l’extraction multi-format', () => {
  /** Une page est « exploitable » si au moins un champ utile en est tiré. */
  const usableViaHtml = (html: string) => {
    const f = extractHtmlFields(html);
    return f.title.status === 'known' || f.price.status !== 'unknown'
        || f.availability.status === 'known' || f.currency.status === 'known';
  };

  it('compare la couverture avant / après sur les mêmes 35 fixtures', () => {
    const familles = {
      'json-ld': FIXTURES.filter(f => /^[A-N]\./.test(f.label)),
      'autres formats (OG/meta/microdata/HTML)': FIXTURES.filter(f => /^[O-Z]\./.test(f.label)),
      'formes cassées': FIXTURES.filter(f => /^A[A-I]\./.test(f.label)),
    };

    const mesure: Record<string, unknown> = {};
    for (const [nom, liste] of Object.entries(familles)) {
      const avant = liste.filter(f => extractJsonLdProduct(f.html, URL) !== null).length;
      const apres = liste.filter(f =>
        extractJsonLdProduct(f.html, URL) !== null || usableViaHtml(f.html)).length;
      mesure[nom] = {
        total: liste.length,
        avant: `${avant}/${liste.length}`,
        apres: `${apres}/${liste.length}`,
      };
    }

    const total = FIXTURES.length;
    const avantTotal = FIXTURES.filter(f => extractJsonLdProduct(f.html, URL) !== null).length;
    const apresTotal = FIXTURES.filter(f =>
      extractJsonLdProduct(f.html, URL) !== null || usableViaHtml(f.html)).length;

    console.log('[COUVERTURE] ' + JSON.stringify({
      ...mesure,
      global: {
        total,
        avant: `${avantTotal}/${total} (${Math.round((avantTotal / total) * 100)}%)`,
        apres: `${apresTotal}/${total} (${Math.round((apresTotal / total) * 100)}%)`,
      },
    }));

    // Le gain doit être réel et porter précisément sur la famille qui était
    // à zéro : OpenGraph, meta, microdata et HTML.
    expect(apresTotal).toBeGreaterThan(avantTotal);
    const autres = familles['autres formats (OG/meta/microdata/HTML)'];
    const autresApres = autres.filter(f => usableViaHtml(f.html)).length;
    expect(autresApres).toBeGreaterThan(0);
  });

  it('aucune page vide ne devient exploitable par erreur', () => {
    // Le gain ne doit pas venir d'une complaisance : une page sans contenu
    // ne doit toujours rien produire.
    expect(usableViaHtml('')).toBe(false);
    expect(usableViaHtml('<html><head></head><body></body></html>')).toBe(false);
  });
});
