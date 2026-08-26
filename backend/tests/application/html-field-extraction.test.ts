/**
 * CAPUCINE — extraction multi-format, champ par champ
 *
 * Éprouve le moteur ajouté pour sortir de la dépendance au seul JSON-LD
 * (mesuré précédemment : 0 % de couverture hors JSON-LD).
 *
 * Deux exigences tenues simultanément : élargir ce que Capucine sait lire,
 * SANS jamais inventer. Chaque test vérifie l'un ou l'autre.
 */
import {
  extractHtmlFields, parseMoney, parseCurrency, toDataPoint,
} from '../../src/application/html-field-extractors';

const page = (head: string, body = '') =>
  `<html><head>${head}</head><body>${body}</body></html>`;

describe('parseMoney — les formes réelles d’écriture des prix', () => {
  const CASES: Array<[string, number | null]> = [
    ['319 €', 319],
    ['319,99 €', 319.99],
    ['319.99', 319.99],
    ['1 299 €', 1299],
    ['1 299,99 €', 1299.99],
    ['1.299,99 €', 1299.99],   // format français
    ['1,299.99', 1299.99],     // format anglais
    ['1.299', 1299],           // milliers, pas 1,299
    ['1,299', 1299],
    ['$349.99', 349.99],
    ['349.99 USD', 349.99],
    ['319 EUR', 319],
    ['0', 0],
    ['0,00 €', 0],
    ['', null],
    ['gratuit', null],
    ['abc', null],
    ['1.2345', null],          // 4 décimales : forme non reconnue, on refuse
  ];

  for (const [raw, expected] of CASES) {
    it(`« ${raw || '(vide)'} » → ${expected}`, () => {
      expect(parseMoney(raw)).toBe(expected);
    });
  }

  it('ne devine jamais : une forme ambiguë retourne null plutôt qu’un chiffre', () => {
    expect(parseMoney('1.2345')).toBeNull();
    expect(parseMoney('prix sur demande')).toBeNull();
  });
});

describe('parseCurrency', () => {
  it.each([
    ['319 €', 'EUR'], ['$349', 'USD'], ['£99', 'GBP'],
    ['349.99 USD', 'USD'], ['319 EUR', 'EUR'], ['319', null], ['', null],
  ])('« %s » → %s', (raw, expected) => {
    expect(parseCurrency(raw)).toBe(expected);
  });
});

describe('OpenGraph — désormais exploité (0 % auparavant)', () => {
  const og = page(`
    <meta property="og:title" content="Casque Sony WH-1000XM5">
    <meta property="og:price:amount" content="329.00">
    <meta property="og:price:currency" content="EUR">
    <meta property="og:url" content="https://fnac.com/a12345/xm5">
  `);

  it('titre, prix, devise et URL canonique sont extraits', () => {
    const f = extractHtmlFields(og);
    expect(f.title.value).toBe('Casque Sony WH-1000XM5');
    expect(f.price.value).toBe(329);
    expect(f.currency.value).toBe('EUR');
    expect(f.canonicalUrl.value).toBe('https://fnac.com/a12345/xm5');
  });

  it('chaque champ conserve la source qui l’a fourni', () => {
    const f = extractHtmlFields(og);
    expect(f.title.origin).toEqual({ source: 'open_graph', locator: 'og:title' });
    expect(f.price.origin?.source).toBe('open_graph');
  });
});

describe('Microdata — désormais exploité', () => {
  const micro = page('', `
    <div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">Sony WH-1000XM5</span>
      <span itemprop="brand">Sony</span>
      <span itemprop="price" content="329.00">329,00 €</span>
      <meta itemprop="priceCurrency" content="EUR">
      <link itemprop="availability" href="https://schema.org/InStock">
    </div>`);

  it('nom, marque, prix, devise et disponibilité sont extraits', () => {
    const f = extractHtmlFields(micro);
    expect(f.title.value).toBe('Sony WH-1000XM5');
    expect(f.brand.value).toBe('Sony');
    expect(f.price.value).toBe(329);
    expect(f.currency.value).toBe('EUR');
    expect(f.availability.value).toBe('in_stock');
  });
});

describe('HTML sémantique — repli, jamais balayage aveugle', () => {
  it('un prix explicitement désigné est lu', () => {
    const f = extractHtmlFields(page('', '<h1>Casque</h1><span class="price">329,00 €</span>'));
    expect(f.price.value).toBe(329);
    expect(f.price.origin?.source).toBe('html');
  });

  it('un nombre quelconque dans le texte n’est JAMAIS pris pour un prix', () => {
    // « 2024 » et « 40 heures » ne sont pas des prix : rien ne les désigne.
    const f = extractHtmlFields(page('', '<p>Modèle 2024, autonomie 40 heures.</p>'));
    expect(f.price.status).toBe('unknown');
    expect(f.price.value).toBeNull();
  });

  it('le titre retombe sur h1 puis title', () => {
    expect(extractHtmlFields(page('', '<h1>Aspirateur Dyson V15</h1>')).title.value)
      .toBe('Aspirateur Dyson V15');
    expect(extractHtmlFields(page('<title>Chaussures running</title>')).title.value)
      .toBe('Chaussures running');
  });
});

describe('Disponibilité — français et anglais', () => {
  it.each([
    ['En stock', 'in_stock'], ['In Stock', 'in_stock'], ['Disponible', 'in_stock'],
    ['Rupture de stock', 'out_of_stock'], ['Out of stock', 'out_of_stock'],
    ['Épuisé', 'out_of_stock'], ['Précommande', 'preorder'], ['Pre-order', 'preorder'],
  ])('« %s » → %s', (text, expected) => {
    const f = extractHtmlFields(page('', `<div class="stock">${text}</div>`));
    expect(f.availability.value).toBe(expected);
  });

  it('un texte non concluant reste unknown', () => {
    const f = extractHtmlFields(page('', '<div class="stock">Nous contacter</div>'));
    expect(f.availability.status).toBe('unknown');
  });
});

describe('Livraison — « gratuite » est un fait, « à partir de » ne l’est pas', () => {
  it('« Livraison gratuite » donne 0, un montant réel', () => {
    const f = extractHtmlFields(page('', '<p>Livraison gratuite</p>'));
    expect(f.shippingCost.value).toBe(0);
    expect(f.shippingCost.status).toBe('known');
  });

  it('« Free shipping » aussi', () => {
    expect(extractHtmlFields(page('', '<p>Free shipping on this item</p>')).shippingCost.value).toBe(0);
  });

  it('un tarif explicite est lu', () => {
    expect(extractHtmlFields(page('', '<p>Livraison : 5,99 €</p>')).shippingCost.value).toBe(5.99);
  });

  it('« offerte dès 50 € » reste UNKNOWN — la condition n’est pas remplie d’office', () => {
    const f = extractHtmlFields(page('', '<p>Livraison offerte dès 50 € d\'achat</p>'));
    expect(f.shippingCost.status).toBe('unknown');
    expect(f.shippingCost.value).toBeNull();
  });

  it('« à partir de 4,99 € » reste UNKNOWN — ce n’est pas le tarif de CE panier', () => {
    const f = extractHtmlFields(page('', '<p>Livraison à partir de 4,99 €</p>'));
    expect(f.shippingCost.status).toBe('unknown');
  });

  it('aucune mention → unknown, jamais 0', () => {
    const f = extractHtmlFields(page('', '<p>Casque sans fil</p>'));
    expect(f.shippingCost.status).toBe('unknown');
    expect(f.shippingCost.value).toBeNull();
  });
});

describe('Contradictions — conservées, jamais arbitrées en silence', () => {
  it('deux sources structurées avec des prix différents → contradictory', () => {
    const f = extractHtmlFields(page(`
      <meta property="og:price:amount" content="329.00">
      <meta property="product:price:amount" content="399.00">
    `));
    expect(f.price.status).toBe('contradictory');
    expect(f.price.value).toBeNull();
    expect(f.price.conflicting?.map(c => c.value).sort()).toEqual([329, 399]);
  });

  it('deux sources concordantes → known, sans conflit', () => {
    const f = extractHtmlFields(page(`
      <meta property="og:price:amount" content="329.00">
      <meta property="product:price:amount" content="329.00">
    `));
    expect(f.price.status).toBe('known');
    expect(f.price.value).toBe(329);
  });

  it('une contradiction devient un DataPoint contradictory, sans valeur', () => {
    const f = extractHtmlFields(page(`
      <meta property="og:price:amount" content="100">
      <meta property="product:price:amount" content="200">
    `));
    const dp = toDataPoint(f.price);
    expect(dp.status).toBe('contradictory');
    expect(dp.value).toBeNull();
  });
});

describe('Promotions — détecter n’est pas vérifier', () => {
  it('un prix barré est signalé comme prix d’origine', () => {
    const f = extractHtmlFields(page('', '<del>399,00 €</del><span class="price">329,00 €</span>'));
    expect(f.promotion.value?.originalPrice).toBe(399);
    expect(f.price.value).toBe(329);
  });

  it('un code promo mentionné en clair est relevé, jamais déduit', () => {
    const f = extractHtmlFields(page('', '<p>Utilisez le code promo SOLDES20 à la caisse</p>'));
    expect(f.promotion.value?.code).toBe('SOLDES20');
  });

  it('un pourcentage affiché est relevé', () => {
    const f = extractHtmlFields(page('', '<p>-20% de remise</p>'));
    expect(f.promotion.value?.percentOff).toBe(20);
  });

  it('aucune promotion affichée → unknown, rien n’est inventé', () => {
    const f = extractHtmlFields(page('', '<p>Casque Sony</p>'));
    expect(f.promotion.status).toBe('unknown');
    expect(f.promotion.value).toBeNull();
  });

  it('la détection ne produit AUCUNE économie appliquée — cela reste RULE 4', () => {
    const f = extractHtmlFields(page('', '<del>399 €</del><span class="price">329 €</span>'));
    // Le module signale un prix barré ; il ne dit ni « économie de 70 € »,
    // ni que la promotion est valide. Ce jugement appartient à PromotionEngine.
    expect(Object.keys(f.promotion.value!)).toEqual(['originalPrice', 'code', 'percentOff']);
  });
});

describe('Résilience — aucune page ne fait échouer l’extraction', () => {
  it.each([
    ['page vide', ''],
    ['HTML malformé', '<html><body><div><span>329 €'],
    ['balises non fermées', '<div><p>test'],
    ['head seul', '<html><head></head></html>'],
    ['texte brut', 'juste du texte sans balise'],
    ['script sans fin', '<script>var x = {'],
  ])('%s : renvoie des champs unknown sans lever', (_label, html) => {
    expect(() => extractHtmlFields(html)).not.toThrow();
    const f = extractHtmlFields(html);
    expect(f.price.status).toMatch(/unknown|known|contradictory/);
  });

  it('une page sans aucune donnée produit des champs unknown, pas null global', () => {
    const f = extractHtmlFields(page('', '<p>bonjour</p>'));
    // Contrairement à l'extracteur JSON-LD qui renvoyait null pour toute la
    // page, chaque champ existe et porte son statut : c'est exploitable.
    expect(f.price.status).toBe('unknown');
    expect(f.shippingCost.status).toBe('unknown');
    expect(f.availability.status).toBe('unknown');
  });
});
