/**
 * CAPUCINE — signal de commercialité
 *
 * Corpus construit à partir des pages RÉELLEMENT rencontrées pendant la
 * campagne Serper (24 % des « offres » étaient des vidéos, forums, wikis et
 * tests de presse), plus des cas limites choisis pour éprouver l'asymétrie :
 *
 *   un faux négatif — vraie offre écartée — est bien plus grave qu'un faux
 *   positif. Il prive l'utilisateur d'une offre réelle, sans qu'il le sache.
 *
 * D'où la règle testée partout ici : `non_commercial` exige une PREUVE, tout
 * le reste est `unknown`, et `unknown` passe.
 */
import { assessCommerciality } from '../../src/application/commerciality';

const verdict = (url: string, title = '', snippet = '') =>
  assessCommerciality({ url, title, snippet }).verdict;

describe('Pages non commerciales — écartées sur preuve structurelle', () => {
  it.each([
    ['vidéo (watch)',        'https://www.youtube.com/watch?v=abc123'],
    ['vidéo (autre hôte)',   'https://peertube.example/videos/watch/xyz'],
    ['shorts',               'https://plateforme.example/shorts/abc'],
    ['wiki',                 'https://fr.wikipedia.org/wiki/Casque_audio'],
    ['wiki auto-hébergé',    'https://doc.example.org/wiki/Produit'],
    ['forum communautaire',  'https://www.reddit.com/r/headphones/comments/xyz'],
    ['forum classique',      'https://forum.example.fr/topic/12345-casque'],
    ['discussion',           'https://site.example/discussion/mon-sujet'],
    ['blog',                 'https://exemple.fr/blog/mon-article'],
    ['actualités',           'https://presse.example/actualites/sortie-produit'],
    ['test éditorial',       'https://media.example/test/casque-sony'],
    ['comparatif',           'https://media.example/comparatif/casques-2024'],
    ['dossier',              'https://media.example/dossier/audio'],
  ])('%s → non_commercial', (_l, url) => {
    expect(verdict(url)).toBe('non_commercial');
  });

  it.each([
    ['test rédactionnel',  'https://site.example/page', 'Notre test du Sony WH-1000XM5', 'Nous avons testé ce casque pendant 3 semaines. Publié le 12 mars par la rédaction.'],
    ['comparatif + guide', 'https://site.example/page', 'Comparatif : les meilleurs casques de 2024', 'Guide d’achat : comment choisir son casque.'],
  ])('%s → non_commercial (deux marqueurs concordants)', (_l, url, t, s) => {
    expect(verdict(url, t, s)).toBe('non_commercial');
  });
});

describe('Formes d’URL éditoriales RÉELLEMENT rencontrées sur le Web', () => {
  // Relevées telles quelles pendant la campagne Serper. La première version du
  // signal, qui exigeait des motifs délimités (`/comparatif/`), n'en captait
  // aucune : elles se présentent en fin de chemin ou en préfixe de segment.
  it.each([
    ['comparatif en fin de chemin',   '/materiel-audio-hifi/casque-audio/comparatif'],
    ['comparateur en fin de chemin',  '/hightech/casques-audio-et-ecouteurs/comparateur'],
    ['comparateur (autre rubrique)',  '/electromenager/aspirateurs-robots/comparateur'],
    ['comparatif en préfixe + .html', '/casque-nomade/comparatif-casques-audio-ecouteurs-nomades-a259.html'],
    ['comparatif smartphones .html',  '/telephone-portable/comparatif-smartphones-telephones-portables-a407.html'],
    ['guide-dachat imbriqué',         '/guide-dachat/guide-audio/457173_guide-dachat-les-meilleurs-casques'],
    ['guide-d-achat suffixé',         '/guide-d-achat-aspirateurs-robots-n8441/'],
    ['guide-achat suffixé',           '/telephone-portable/guide-achat-quels-sont-les-meilleurs-smartphones-g243'],
    ['bon-plan',                      '/bon-plan/a-ce-prix-le-sony-wh-1000xm5-devient-accessible-40/'],
    ['watch nu',                      '/watch'],
  ])('%s → non_commercial', (_l, path) => {
    expect(verdict(`https://media.example${path}`)).toBe('non_commercial');
  });

  it('une extension de fichier n’est jamais un marqueur en soi', () => {
    expect(verdict('https://shop.example/casque-sony-p68753.html')).toBe('unknown');
  });
});

describe('Segments proches d’un marqueur — pas de faux négatif par préfixe', () => {
  it.each([
    ['« testeur » n’est pas « test »',      'https://shop.example/testeur-de-piles'],
    ['« guidon » n’est pas « guide »',      'https://shop.example/guidon-velo'],
    ['« newsletter » n’est pas « news »',   'https://shop.example/newsletter'],
    ['« article » reste une fiche produit', 'https://shop.example/article/12345'],
    ['« avisio » n’est pas « avis »',       'https://shop.example/avisio-casque'],
  ])('%s → jamais non_commercial', (_l, url) => {
    expect(verdict(url)).not.toBe('non_commercial');
  });
});

describe('Vraies offres — JAMAIS écartées (le faux négatif est le pire risque)', () => {
  it.each([
    ['fiche produit /dp/',      'https://boutique.example/dp/B08XYZ1234'],
    ['chemin /produit/',        'https://boutique.example/produit/casque-sony'],
    ['chemin /product/',        'https://shop.example/product/headphones'],
    ['chemin /p/',              'https://shop.example/p/casque-sony-xm5'],
    ['chemin /item/',           'https://shop.example/item/998877'],
    ['chemin /ref/',            'https://shop.example/ref/1160245'],
    ['chemin /achat/',          'https://shop.example/achat/casque'],
    ['fiche numérotée /a12345/','https://shop.example/a12345/Sony-WH-1000XM5'],
  ])('%s → commercial', (_l, url) => {
    expect(verdict(url)).toBe('commercial');
  });

  it.each([
    ['action panier',    'ajouter au panier'],
    ['stock',            'En stock, expédié sous 24h'],
    ['vendeur',          'Vendu et expédié par la boutique'],
    ['livraison',        'Livraison gratuite dès 25 €'],
    ['appel à l’achat',  'Commander maintenant'],
  ])('vocabulaire commercial « %s » → commercial', (_l, snippet) => {
    expect(verdict('https://site.example/une-page', 'Casque Sony', snippet)).toBe('commercial');
  });

  it('une page marchande SANS prix reste commerciale — UNKNOWN n’est pas BAD', () => {
    const v = assessCommerciality({
      url: 'https://boutique.example/produit/casque',
      title: 'Casque Sony WH-1000XM5',
      snippet: 'Prix non affiché',
      page: { hasProductMarkup: true, hasOfferMarkup: true, priceKnown: false },
    });
    expect(v.verdict).toBe('commercial');
    expect(v.commercialSignals).toContain('balisage Offer structuré');
  });

  it('une page marchande sans balisage ni vocabulaire reste UNKNOWN, jamais écartée', () => {
    // Cas fréquent : boutique artisanale, page minimale. Rien ne prouve
    // qu'elle vend, rien ne prouve le contraire. Elle doit passer.
    expect(verdict('https://petite-boutique.example/casque-sony')).toBe('unknown');
  });

  it('une page inaccessible reste UNKNOWN — l’échec de lecture n’est pas une preuve', () => {
    expect(verdict('https://marchand.example/une-page-403')).toBe('unknown');
  });
});

describe('Le prix seul ne prouve JAMAIS la commercialité', () => {
  const PRICE_TEXTS = [
    'Le Sony WH-1000XM5 est vendu 329 €',
    'On le trouve autour de 329,00 €',
    'Son prix de lancement était de 419 €',
    'Prix constaté : 329 €',
  ];

  it.each(PRICE_TEXTS)('article citant un prix : « %s » → jamais commercial', (snippet) => {
    // URL éditoriale + prix cité : le prix ne doit pas renverser le verdict.
    expect(verdict('https://media.example/test/casque', 'Test du casque', snippet)).toBe('non_commercial');
  });

  it('vidéo mentionnant un prix → non_commercial', () => {
    expect(verdict('https://plateforme.example/watch?v=abc', 'Sony XM5 à 329 €', 'Le prix a baissé à 329 €')).toBe('non_commercial');
  });

  it('forum mentionnant un prix → non_commercial', () => {
    expect(verdict('https://site.example/r/audio/comments/x', 'Bon plan 329 €', 'Je l’ai eu à 329 € hier')).toBe('non_commercial');
  });

  it('wiki mentionnant un prix historique → non_commercial', () => {
    expect(verdict('https://encyclo.example/wiki/Sony_WH-1000XM5', 'Sony WH-1000XM5', 'Prix de lancement : 419 €')).toBe('non_commercial');
  });

  it('un prix structuré SEUL, sans autre preuve, ne suffit pas', () => {
    const v = assessCommerciality({
      url: 'https://site.example/une-page',
      page: { priceKnown: true },
    });
    // priceKnown n'est compté que combiné à une autre preuve commerciale.
    expect(v.commercialSignals).not.toContain('prix publié');
    expect(v.verdict).toBe('unknown');
  });
});

describe('Sites éditoriaux présentant une VRAIE offre — non sur-filtrés', () => {
  it('un comparateur avec chemin produit et vocabulaire d’achat est commercial', () => {
    // §14 : ne pas filtrer sur « domaine éditorial » — si la page présente
    // réellement une offre, elle doit être retenue.
    expect(verdict(
      'https://comparateur.example/produit/casque-sony',
      'Casque Sony WH-1000XM5',
      'Ajouter au panier — en stock'
    )).toBe('commercial');
  });

  it('un média avec une vraie fiche produit est commercial malgré le contexte', () => {
    expect(verdict(
      'https://media.example/boutique/casque-sony',
      'Casque Sony',
      'Vendu et expédié par notre boutique'
    )).toBe('commercial');
  });

  it('un seul marqueur rédactionnel ne suffit pas à écarter', () => {
    // « guide d'achat » seul, sur une URL neutre : insuffisant.
    expect(verdict('https://site.example/page', 'Guide d’achat casque', '')).toBe('unknown');
  });
});

describe('La preuve structurelle prime sur la prose', () => {
  // Défaut mesuré sur le Web réel : une vidéo dont la description portait
  // « Livraison gratuite — commander maintenant » devenait une offre.
  it.each([
    ['vidéo + prose commerciale',  'https://plateforme.example/watch?v=abc'],
    ['forum + prose commerciale',  'https://site.example/r/audio/comments/x'],
    ['comparatif + prose',         'https://media.example/audio/comparatif'],
  ])('%s → reste non_commercial', (_l, url) => {
    expect(verdict(url, 'Sony WH-1000XM5', 'Livraison gratuite — commander maintenant, en stock')).toBe('non_commercial');
  });

  it('le rejet explique que le vocabulaire n’a pas suffi', () => {
    const v = assessCommerciality({
      url: 'https://plateforme.example/watch?v=abc',
      snippet: 'Livraison gratuite',
    });
    expect(v.reasons.join(' ')).toContain('vocabulaire');
  });

  it('une commande de page (panier) l’emporte, elle, sur la forme de l’URL', () => {
    // Asymétrie : « ajouter au panier » n'existe pas dans de la prose.
    // Une boutique rangée sous /guide-audio/ doit rester admise.
    expect(verdict('https://shop.example/guide-audio/casque', 'Casque', 'Ajouter au panier')).toBe('commercial');
  });

  it('un balisage Offer l’emporte aussi sur la forme de l’URL', () => {
    expect(assessCommerciality({
      url: 'https://shop.example/blog/casque-edition-limitee',
      page: { hasOfferMarkup: true, priceKnown: true },
    }).verdict).toBe('commercial');
  });

  it('un identifiant de CMS en tête de segment ne masque pas le marqueur', () => {
    expect(verdict('https://media.example/marques/apple/1811513_test-apple-iphone-15')).toBe('non_commercial');
  });

  it('mais un segment purement numérique reste neutre', () => {
    expect(verdict('https://shop.example/12345-casque-sony')).not.toBe('non_commercial');
  });
});

describe('Explicabilité — jamais une boîte noire', () => {
  it('chaque verdict porte ses raisons', () => {
    for (const url of [
      'https://plateforme.example/watch?v=a',
      'https://shop.example/dp/B01ABCDEFG',
      'https://inconnu.example/page',
    ]) {
      const v = assessCommerciality({ url });
      expect(v.reasons.length).toBeGreaterThan(0);
      expect(v.reasons.every(r => r.length > 0)).toBe(true);
    }
  });

  it('un rejet nomme la preuve ET l’absence de signal commercial', () => {
    const v = assessCommerciality({ url: 'https://encyclo.example/wiki/Produit' });
    expect(v.verdict).toBe('non_commercial');
    expect(v.reasons.join(' ')).toContain('URL');
    expect(v.reasons.join(' ')).toContain('aucun signal commercial');
  });

  it('une acceptation nomme la preuve commerciale retenue', () => {
    const v = assessCommerciality({ url: 'https://shop.example/produit/x' });
    expect(v.verdict).toBe('commercial');
    expect(v.reasons.join(' ')).toContain('preuve commerciale');
  });
});

describe('Robustesse', () => {
  it.each([
    ['URL illisible', 'pas-une-url'],
    ['chaîne vide', ''],
    ['protocole inattendu', 'ftp://serveur/fichier'],
  ])('%s → unknown, jamais une exception', (_l, url) => {
    expect(() => assessCommerciality({ url })).not.toThrow();
    expect(verdict(url)).toBe('unknown');
  });

  it('aucun nom de domaine réel n’apparaît dans les règles du module', () => {
    // Garde-fou : le jour où quelqu'un ajoutera « youtube » ou « amazon »
    // dans ce fichier, ce test le signalera. Le signal doit rester structurel.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../src/application/commerciality.ts'), 'utf8'
    ) as string;
    const rules = src.slice(src.indexOf('EDITORIAL_URL_PATTERNS'));
    for (const brand of ['youtube', 'reddit', 'wikipedia', 'amazon', 'fnac', 'dyson', 'lesnumeriques', 'quechoisir']) {
      expect(rules.toLowerCase()).not.toContain(brand);
    }
  });
});
