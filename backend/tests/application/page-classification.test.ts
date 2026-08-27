/**
 * CAPUCINE — corpus de classification des pages Web
 *
 * Répartition voulue par le mandat : 15 rubriques, 15 recherches internes,
 * 15 fiches produit, 15 fiches offre, 10 comparateurs, 10 guides, 10 articles,
 * 5 forums, 5 vidéos — plus les cas limites et les gardes anti-régression.
 *
 * Chaque cas porte la RAISON pour laquelle la classification est attendue.
 * Un test qui n'explique pas ce qu'il protège ne protège rien.
 *
 * Principe vérifié partout : `offerEligible` est faux pour tout ce qui n'est
 * pas une offre possible, et une page ambiguë reste éligible — écarter une
 * vraie offre est le pire des défauts.
 */
import { classifyPage, isOfferEligible, type PageType } from '../../src/application/page-classification';

const typeOf = (url: string, title = '', snippet = ''): PageType =>
  classifyPage({ url, title, snippet }).type;

// ═══════════════════════════════════════════════════════════════════════════
// 1. RUBRIQUES (15) — plusieurs produits, aucune offre individuelle
// ═══════════════════════════════════════════════════════════════════════════
describe('CATEGORY — rubriques marchandes', () => {
  it.each([
    ['conteneur pluriel + libellé générique (cas mesuré sur le Web réel)', 'https://m.example/produits/aspirateur-robot'],
    ['conteneur pluriel + libellé générique (2)',                         'https://m.example/produits/smartphones'],
    ['conteneur pluriel anglais',                                         'https://m.example/products/headphones'],
    ['conteneur pluriel nu',                                              'https://m.example/produits'],
    ['segment /category/',                                                'https://m.example/category/audio'],
    ['segment /categorie/',                                               'https://m.example/categorie/electromenager'],
    ['segment /rayon/',                                                   'https://m.example/rayon/informatique/ordinateurs'],
    ['segment /collections/ (rubrique, jamais fiche)',                    'https://m.example/collections/casques'],
    ['segment /browse/',                                                  'https://m.example/browse/tv-video'],
    ['segment /univers/',                                                 'https://m.example/univers/cuisine'],
    ['segment /gamme/',                                                   'https://m.example/gamme/aspirateurs'],
    ['sous-rubrique imbriquée',                                           'https://m.example/category/audio/casques-sans-fil'],
    ['segment /nos-produits/',                                            'https://m.example/nos-produits'],
    ['segment /selection/',                                               'https://m.example/selection/noel'],
    ['segment /cat/ abrégé',                                              'https://m.example/cat/petit-electromenager'],
    ['conteneur /c/ (22 URLs réelles du corpus)',                         'https://m.example/c/speakers'],
    ['conteneur /c/ imbriqué',                                            'https://m.example/fr-fr/c/cafe/machines-a-cafe'],
    ['facette de marque',                                                 'https://m.example/c/clavier-gamer/brand~logitech'],
    ['facette multiple',                                                  'https://m.example/c/telephones/phone_brand:apple+phone_memory:256go'],
  ])('%s → CATEGORY', (_r, url) => {
    expect(typeOf(url)).toBe('CATEGORY');
  });

  it('une rubrique n’est JAMAIS éligible à devenir une offre', () => {
    const c = classifyPage({ url: 'https://m.example/produits/aspirateur-robot' });
    expect(c.offerEligible).toBe(false);
  });

  it('le vocabulaire de liste renforce la preuve sans être requis', () => {
    const sans = classifyPage({ url: 'https://m.example/rayon/audio' });
    const avec = classifyPage({ url: 'https://m.example/rayon/audio', snippet: 'Trier par prix — 248 produits' });
    expect(sans.confidence).toBe('likely');
    expect(avec.confidence).toBe('proven');
  });

  it('deux formulations de liste suffisent, même sans marqueur d’URL', () => {
    expect(typeOf('https://m.example/le-coin-des-bonnes-idees', 'Casques', 'Trier par prix — 248 produits trouvés')).toBe('CATEGORY');
  });

  it('une seule formulation de liste ne suffit pas — une fiche affiche « trier par » dans ses avis', () => {
    expect(typeOf('https://m.example/un-casque', 'Casque', 'Trier par : avis les plus récents')).not.toBe('CATEGORY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. RECHERCHES INTERNES (15) — vrais produits, vrais prix, aucune offre
// ═══════════════════════════════════════════════════════════════════════════
describe('SEARCH_RESULTS — recherche interne au site', () => {
  it.each([
    ['/search',                     'https://m.example/search?q=casque'],
    ['/recherche',                  'https://m.example/recherche?q=casque'],
    ['/search sans paramètre',      'https://m.example/search'],
    ['/resultats',                  'https://m.example/resultats?motcle=aspirateur'],
    ['/results anglais',            'https://m.example/results?query=vacuum'],
    ['/suche (allemand)',           'https://m.example/suche?q=kopfhorer'],
    ['/busca (espagnol)',           'https://m.example/busca?s=auriculares'],
    ['recherche imbriquée',         'https://m.example/fr/search/casque-bluetooth'],
    ['paramètre k= (usage réel)',   'https://m.example/search?k=sony+wh1000xm5'],
    ['paramètre term=',             'https://m.example/search?term=casque'],
    ['recherche + pagination',      'https://m.example/recherche?q=casque&page=3'],
    ['recherche + tri',             'https://m.example/search?q=casque&sort=price'],
    ['recherche + filtres',         'https://m.example/search?q=tv&brand=sony&min=200'],
    ['recherche majuscule',         'https://m.example/Search?Q=casque'],
    ['recherche avec extension',    'https://m.example/search.html?q=casque'],
  ])('%s → SEARCH_RESULTS', (_r, url) => {
    expect(typeOf(url)).toBe('SEARCH_RESULTS');
  });

  it('une page de résultats n’est jamais une offre, même avec des prix', () => {
    const c = classifyPage({
      url: 'https://m.example/search?q=casque',
      snippet: 'Casque Sony 329 € — Casque Bose 299 € — Casque JBL 129 €',
    });
    expect(c.offerEligible).toBe(false);
  });

  it('le site peut le déclarer lui-même (SearchResultsPage)', () => {
    const c = classifyPage({ url: 'https://m.example/liste', structure: { jsonLdTypes: ['SearchResultsPage'] } });
    expect(c.type).toBe('SEARCH_RESULTS');
    expect(c.confidence).toBe('proven');
  });

  it('un paramètre q= SEUL ne suffit pas — beaucoup de fiches en portent un pour le suivi de campagne', () => {
    expect(typeOf('https://m.example/produit/casque-sony?q=promo-hiver')).not.toBe('SEARCH_RESULTS');
  });

  it('paramètre de recherche + libellé de résultats concordants suffisent', () => {
    expect(typeOf('https://m.example/liste?q=casque', 'Résultats pour « casque »')).toBe('SEARCH_RESULTS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FICHES PRODUIT (15) — un produit identifié, offre non complète
// ═══════════════════════════════════════════════════════════════════════════
describe('PRODUCT_DETAIL — fiche produit', () => {
  const base = { url: 'https://m.example/article', title: 'Casque Sony WH-1000XM5' };

  it('balisage Product seul → fiche produit', () => {
    expect(classifyPage({ ...base, structure: { jsonLdTypes: ['Product'] } }).type).toBe('PRODUCT_DETAIL');
  });

  it('fiche SANS prix reste une fiche — UNKNOWN n’est pas un motif de rejet', () => {
    const c = classifyPage({ ...base, structure: { jsonLdTypes: ['Product'], hasPrice: false } });
    expect(c.type).toBe('PRODUCT_DETAIL');
    expect(c.offerEligible).toBe(true);
  });

  it.each([
    ['prix sans vendeur',            { hasPrice: true }],
    ['prix + dispo sans vendeur',    { hasPrice: true, hasAvailability: true }],
    ['vendeur sans prix',            { hasSeller: true }],
    ['vendeur + dispo sans prix',    { hasSeller: true, hasAvailability: true }],
    ['dispo seule',                  { hasAvailability: true }],
    ['identifiant seul',             { hasProductIdentifier: true }],
    ['bouton panier sans prix',      { hasAddToCart: true }],
    ['sans aucun attribut',          {}],
  ])('%s → PRODUCT_DETAIL (offre incomplète, jamais OFFER_DETAIL)', (_r, extra) => {
    const c = classifyPage({ ...base, structure: { jsonLdTypes: ['Product'], ...extra } });
    expect(c.type).toBe('PRODUCT_DETAIL');
  });

  it('§6 — une fiche portant PLUSIEURS vendeurs reste une fiche, pas une offre unique', () => {
    const c = classifyPage({ ...base, structure: { jsonLdTypes: ['Product'], offerEntryCount: 3, hasPrice: true, hasSeller: true, hasAvailability: true } });
    expect(c.type).toBe('PRODUCT_DETAIL');
    expect(c.reasons.join(' ')).toContain('aucune offre unique');
  });

  it('§6 — AggregateOffer : une fourchette de prix n’est l’offre de personne', () => {
    const c = classifyPage({ ...base, structure: { jsonLdTypes: ['Product'], hasAggregateOffer: true, hasPrice: true, hasSeller: true, hasAvailability: true } });
    expect(c.type).toBe('PRODUCT_DETAIL');
    expect(c.signals).toContain('AggregateOffer');
  });

  it('§7 — une rubrique n’affichant qu’UN produit ne devient pas une fiche', () => {
    // Le nombre ne décide pas : c'est la structure déclarée qui décide.
    const c = classifyPage({
      url: 'https://m.example/liste',
      structure: { jsonLdTypes: ['ItemList'], productEntryCount: 1, hasPagination: true },
    });
    expect(c.type).toBe('CATEGORY');
  });

  it('un ItemList NON corroboré ne conclut pas — c’est peut-être un fil d’Ariane', () => {
    const c = classifyPage({ url: 'https://m.example/x', structure: { jsonLdTypes: ['ItemList', 'Product'] } });
    expect(c.type).toBe('PRODUCT_DETAIL');
    expect(c.signals.join(' ')).toContain('non corroboré');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. FICHES OFFRE (15) — vendeur, prix et disponibilité identifiés
// ═══════════════════════════════════════════════════════════════════════════
describe('OFFER_DETAIL — offre exacte identifiée', () => {
  const complete = { jsonLdTypes: ['Product'], hasSeller: true, hasPrice: true, hasAvailability: true };

  it('vendeur + prix + disponibilité → OFFER_DETAIL', () => {
    const c = classifyPage({ url: 'https://m.example/p/casque', structure: complete });
    expect(c.type).toBe('OFFER_DETAIL');
    expect(c.confidence).toBe('proven');
    expect(c.offerEligible).toBe(true);
  });

  it.each([
    ['avec identifiant produit',   { hasProductIdentifier: true }],
    ['avec bouton panier',         { hasAddToCart: true }],
    ['avec une seule offre balisée', { offerEntryCount: 1 }],
    ['avec contrôles de liste (avis triables)', { hasListingControls: true }],
    ['avec un seul produit balisé', { productEntryCount: 1 }],
  ])('%s → reste OFFER_DETAIL', (_r, extra) => {
    expect(classifyPage({ url: 'https://m.example/p/x', structure: { ...complete, ...extra } }).type).toBe('OFFER_DETAIL');
  });

  it.each([
    ['sur chemin /dp/',      'https://m.example/dp/B08XYZ1234'],
    ['sur chemin /produit/', 'https://m.example/produit/casque-sony'],
    ['sur chemin /p/',       'https://m.example/p/casque-sony-xm5'],
    ['sur chemin /item/',    'https://m.example/item/998877'],
    ['sur chemin obscur',    'https://m.example/x/y/z'],
    ['sur chemin nu',        'https://m.example/'],
    ['sur chemin pluriel',   'https://m.example/products/casque-sony'],
    ['sur chemin rubrique',  'https://m.example/category/audio/casque-p12345'],
    ['avec paramètres',      'https://m.example/p/casque?color=noir&size=m'],
  ])('la structure prime sur la forme de l’URL — %s', (_r, url) => {
    // Le balisage du marchand est une preuve ; la forme de l'URL, un indice.
    expect(classifyPage({ url, structure: complete }).type).toBe('OFFER_DETAIL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. COMPARATEURS (10) — 10 prix ne font pas 10 offres
// ═══════════════════════════════════════════════════════════════════════════
describe('Comparateurs — une page de comparaison n’est pas une rubrique marchande', () => {
  it.each([
    ['comparatif en fin de chemin',  'https://p.example/audio/casque/comparatif'],
    ['comparateur en fin de chemin', 'https://p.example/hightech/casques/comparateur'],
    ['comparatif préfixe + .html',   'https://p.example/casque/comparatif-casques-a259.html'],
    ['comparatif daté',              'https://p.example/comparatif/casques-2024'],
    ['comparatif de rubrique',       'https://p.example/electromenager/aspirateurs/comparateur'],
    ['comparatifs au pluriel',       'https://p.example/comparatifs/tv'],
    ['comparaison de matériel',      'https://p.example/test-materiel/comparaison-montres-garmin'],
    ['top produits',                 'https://p.example/guide/top-5-machine-cafe'],
    ['meilleurs produits',           'https://p.example/guide/les-meilleurs-casques'],
    ['comparatif imbriqué',          'https://p.example/fr/audio/comparatif/sans-fil'],
  ])('%s → EDITORIAL, jamais éligible à une offre', (_r, url) => {
    const c = classifyPage({ url });
    expect(c.type).toBe('EDITORIAL');
    expect(c.offerEligible).toBe(false);
  });

  it('§9 — dix prix cités ne produisent pas dix offres', () => {
    const c = classifyPage({
      url: 'https://p.example/audio/comparatif',
      title: 'Comparatif : les 10 meilleurs casques',
      snippet: 'Sony 329 € · Bose 299 € · JBL 129 € · Sennheiser 249 € · Apple 549 €',
    });
    expect(c.offerEligible).toBe(false);
  });

  it('§9 — un ItemList sur un comparatif ne le transforme pas en rubrique marchande', () => {
    // La famille rédactionnelle est décidée AVANT la lecture de structure,
    // précisément pour cela : un guide balise ses recommandations en ItemList.
    const c = classifyPage({
      url: 'https://p.example/audio/comparatif',
      structure: { jsonLdTypes: ['ItemList'], productEntryCount: 10, hasPagination: true },
    });
    expect(c.type).toBe('EDITORIAL');
    expect(c.offerEligible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. GUIDES (10)
// ═══════════════════════════════════════════════════════════════════════════
describe('Guides d’achat', () => {
  it.each([
    ['guide-dachat imbriqué',   'https://p.example/guide-dachat/guide-audio/457173_guide-dachat-casques'],
    ['guide-d-achat suffixé',   'https://p.example/guide-d-achat-aspirateurs-robots-n8441/'],
    ['guide-achat suffixé',     'https://p.example/telephone/guide-achat-meilleurs-smartphones-g243'],
    ['guide simple',            'https://p.example/guide/comment-choisir-son-casque'],
    ['guides au pluriel',       'https://p.example/guides/audio'],
    ['guide de marque',         'https://p.example/guide-asics-meilleurs-modeles-running/'],
    ['guide + clavier',         'https://p.example/clavier/guide-achat-quel-clavier-choisir-g184337.html'],
    ['conseils',                'https://p.example/conseils/bien-choisir-son-aspirateur'],
    ['dossier',                 'https://p.example/dossier/audio-sans-fil'],
    ['tutoriel',                'https://p.example/tuto/regler-son-casque'],
  ])('%s → EDITORIAL', (_r, url) => {
    expect(typeOf(url)).toBe('EDITORIAL');
  });

  it('un guide hébergé par un MARCHAND reste un guide — la page ne vend pas', () => {
    // Cas réel : le blog conseil d'une boutique. Aucune blacklist : c'est la
    // forme de la page qui décide, pas l'identité de l'hébergeur.
    expect(typeOf('https://boutique.example/guide/top-5-machine-cafe-grains/')).toBe('EDITORIAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. ARTICLES (10)
// ═══════════════════════════════════════════════════════════════════════════
describe('Articles et contenus rédactionnels', () => {
  it.each([
    ['test rédactionnel',      'https://p.example/test/casque-sony'],
    ['test avec id de CMS',    'https://p.example/marques/apple/1811513_test-apple-iphone-15'],
    ['blog',                   'https://p.example/blog/mon-article'],
    ['actualités',             'https://p.example/actualites/sortie-produit'],
    ['news',                   'https://p.example/news/2024/sony-annonce'],
    ['presse',                 'https://p.example/presse/communique'],
    ['bon plan rédactionnel',  'https://p.example/bons-plans/le-dyson-v15-a-prix-casse'],
    ['bon-plan singulier',     'https://p.example/bon-plan/sony-wh-1000xm5-accessible'],
    ['avis rédactionnel',      'https://p.example/avis/casque-sony'],
    ['dossiers pluriel',       'https://p.example/dossiers/electromenager'],
  ])('%s → EDITORIAL', (_r, url) => {
    expect(typeOf(url)).toBe('EDITORIAL');
  });

  it('un article citant un prix ne devient pas une offre', () => {
    const c = classifyPage({ url: 'https://p.example/test/casque', snippet: 'Vendu 329 €, il vaut son prix' });
    expect(c.offerEligible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. FORUMS (5) & 9. VIDÉOS (5)
// ═══════════════════════════════════════════════════════════════════════════
describe('Forums et vidéos', () => {
  it.each([
    ['fil communautaire', 'https://c.example/r/AskFrance/comments/1k4c5ht/quel-aspirateur'],
    ['forum classique',   'https://c.example/forum/topic/12345-casque'],
    ['discussion',        'https://c.example/discussion/mon-sujet'],
    ['thread',            'https://c.example/thread/98765'],
    ['communauté',        'https://c.example/communaute/audio/sujet-42'],
  ])('%s → COMMUNITY', (_r, url) => {
    const c = classifyPage({ url });
    expect(c.type).toBe('COMMUNITY');
    expect(c.offerEligible).toBe(false);
  });

  it.each([
    ['watch',            'https://v.example/watch?v=abc123'],
    ['watch nu',         'https://v.example/watch'],
    ['shorts',           'https://v.example/shorts/abc'],
    ['videos imbriqué',  'https://v.example/100077701980120/videos/moulinex-companion-xl'],
    ['videos/watch',     'https://v.example/videos/watch/xyz'],
  ])('%s → VIDEO', (_r, url) => {
    const c = classifyPage({ url });
    expect(c.type).toBe('VIDEO');
    expect(c.offerEligible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. INFORMATIONNEL
// ═══════════════════════════════════════════════════════════════════════════
describe('INFORMATIONAL — référence, documentation, aide', () => {
  it.each([
    ['wiki',            'https://e.example/wiki/Casque_audio'],
    ['support',         'https://e.example/support/produit'],
    ['aide',            'https://e.example/aide/installation'],
    ['manuel',          'https://e.example/manuel/wh1000xm5/fr/index.html'],
    ['documentation',   'https://e.example/documentation/api'],
    ['faq',             'https://e.example/faq'],
    ['notice',          'https://e.example/notice/aspirateur'],
  ])('%s → INFORMATIONAL', (_r, url) => {
    const c = classifyPage({ url });
    expect(c.type).toBe('INFORMATIONAL');
    expect(c.offerEligible).toBe(false);
  });

  it('la documentation d’un MARCHAND reste de la documentation', () => {
    expect(typeOf('https://boutique.example/support/retours')).toBe('INFORMATIONAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. FAUX NÉGATIFS — le risque le plus grave
// ═══════════════════════════════════════════════════════════════════════════
describe('Familles reconnaissables au sous-domaine', () => {
  // Mesuré : une page d'assistance constructeur arrivait TOP 1 des offres
  // pour « iPhone 15 Pro ». Le marqueur était dans l'hôte, pas le chemin.
  it.each([
    ['assistance',    'https://support.exemple.com/fr/iphone', 'INFORMATIONAL'],
    ['aide',          'https://aide.exemple.fr/produit', 'INFORMATIONAL'],
    ['guide d’aide',  'https://helpguide.exemple.net/mdr/wh1000xm5/v1/fr/index.html', 'INFORMATIONAL'],
    ['forum',         'https://forum.exemple.be/sujet/42', 'COMMUNITY'],
    ['forum imbriqué','https://fr.forum.exemple.be/sujet/42', 'COMMUNITY'],
    ['communauté',    'https://community.exemple.com/t/casque', 'COMMUNITY'],
    ['blog',          'https://blog.exemple.fr/la-gamme-asics', 'EDITORIAL'],
    ['magazine',      'https://magazine.exemple.fr/notre-avis', 'EDITORIAL'],
    ['salle de presse','https://pressroom.exemple.com/nouveaute', 'EDITORIAL'],
  ])('%s → %s', (_r, url, expected) => {
    const c = classifyPage({ url });
    expect(c.type).toBe(expected);
    expect(c.offerEligible).toBe(false);
  });

  it.each([
    ['boutique',  'https://shop.exemple.com/casque'],
    ['store',     'https://store.exemple.com/casque'],
    ['boutique fr','https://boutique.exemple.fr/casque'],
    ['www',       'https://www.exemple.fr/casque'],
    ['sans sous-domaine', 'https://exemple.fr/casque'],
  ])('%s → reste éligible : un conteneur marchand n’est pas un marqueur', (_r, url) => {
    expect(classifyPage({ url }).offerEligible).toBe(true);
  });
});

describe('§11 — vraies fiches marchandes : jamais écartées', () => {
  it.each([
    ['avec prix',              'https://m.example/produit/casque', 'Casque Sony', '329 € — en stock'],
    ['sans prix',              'https://m.example/produit/casque', 'Casque Sony', 'Prix non communiqué'],
    ['avec livraison',         'https://m.example/p/casque', 'Casque', 'Livraison gratuite dès 25 €'],
    ['sans livraison',         'https://m.example/p/casque', 'Casque', ''],
    ['avec bouton',            'https://m.example/x/casque', 'Casque', 'Ajouter au panier'],
    ['sans bouton',            'https://m.example/item/998877', 'Casque', ''],
    ['avec vendeur',           'https://m.example/dp/B08XYZ1234', 'Casque', 'Vendu et expédié par la boutique'],
    ['sans vendeur',           'https://m.example/dp/B08XYZ1234', 'Casque', ''],
    ['slug purement textuel',  'https://m.example/casque-sony-sans-fil-noir', 'Casque', 'En stock'],
    ['boutique minimale',      'https://petite-boutique.example/casque', '', ''],
    ['chemin obscur',          'https://m.example/a/b/c/d', 'Casque Sony', 'Commander'],
    ['segment « c » isolé, non suivi d’un libellé', 'https://m.example/x/c/9', 'Casque', 'En stock'],
    ['fiche sous rubrique',    'https://m.example/category/audio/casque-p12345', 'Casque', ''],
    ['fiche sous pluriel + id','https://m.example/produits/casque-audio/sony/1331611-sony-wh-1000xm5', '', ''],
    ['fiche sous pluriel + modèle', 'https://m.example/produits/sony-wh-1000xm5', '', ''],
  ])('%s → reste éligible à devenir une offre', (_r, url, title, snippet) => {
    expect(isOfferEligible(typeOf(url, title, snippet))).toBe(true);
  });

  it.each([
    ['fiche Shopify, libellé long (faux négatif mesuré sur le Web réel)', 'https://m.example/products/levoit-purificateur-dair-everestair'],
    ['fiche Shopify avec modèle chiffré',                                'https://m.example/products/levoit-purificateur-d-air-core-300s'],
    ['fiche sous conteneur français',                                    'https://m.example/produits/casque-sony-sans-fil-noir'],
  ])('%s → jamais CATEGORY', (_r, url) => {
    // Mesuré : le même site sert ses rubriques sous /collections/ et ses
    // fiches sous /products/. La profondeur et la longueur du libellé les
    // séparent, sans qu'aucune règle ne nomme la plateforme.
    const c = classifyPage({ url });
    expect(c.type).not.toBe('CATEGORY');
    expect(c.offerEligible).toBe(true);
  });

  it.each([
    ['rubrique hiérarchique profonde',  'https://m.example/produits/outillage/outillage-electroportatif/visseuse-et-tournevis'],
    ['rubrique hiérarchique (2)',       'https://m.example/fr_FR/produits/imprimantes/inkjet/grand-public/c/consumer'],
  ])('%s → CATEGORY (la hiérarchie tranche)', (_r, url) => {
    expect(classifyPage({ url }).type).toBe('CATEGORY');
  });

  it('une fiche avec variantes reste une fiche', () => {
    expect(classifyPage({ url: 'https://m.example/p/casque?color=noir&size=m', structure: { jsonLdTypes: ['Product'] } }).offerEligible).toBe(true);
  });

  it('une page marchande sans JSON-LD reste éligible', () => {
    expect(classifyPage({ url: 'https://m.example/casque', snippet: 'Ajouter au panier', structure: {} }).offerEligible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. UNKNOWN — ne jamais forcer
// ═══════════════════════════════════════════════════════════════════════════
describe('Le site déclare lui-même un article (mesuré : 14/84 pages, toutes rédactionnelles)', () => {
  it.each([['NewsArticle'], ['Article'], ['BlogPosting']])(
    'balisage %s → EDITORIAL, quel que soit le reste',
    (t) => {
      // Cas réel : une page de test publiant Product + 12 Offer complètes
      // (comparaison de prix insérée dans l'article) basculait en fiche
      // produit. Un balisage produit prouve qu'on PARLE d'un produit.
      const c = classifyPage({
        url: 'https://p.example/casque/sony-p68753/test.html',
        structure: { jsonLdTypes: [t, 'Product', 'AggregateOffer', 'Offer'], productEntryCount: 1, offerEntryCount: 12, hasSeller: true, hasPrice: true, hasAvailability: true },
      });
      expect(c.type).toBe('EDITORIAL');
      expect(c.offerEligible).toBe(false);
    }
  );

  it('une URL rédactionnelle n’est pas renversée par un balisage produit', () => {
    // Cas réel : page de test sans balisage d'article, mais URL /test/.
    const c = classifyPage({
      url: 'https://p.example/test/122994-test-labo-sony',
      structure: { jsonLdTypes: ['Product', 'Offer'], productEntryCount: 1, offerEntryCount: 1, hasProductIdentifier: true, hasPrice: true },
    });
    expect(c.type).toBe('EDITORIAL');
  });

  it('mais une vraie fiche marchande garde son balisage produit', () => {
    const c = classifyPage({
      url: 'https://m.example/store/product/wh1000xm5b/casque',
      structure: { jsonLdTypes: ['Product', 'Offer'], productEntryCount: 1, offerEntryCount: 1, hasProductIdentifier: true, hasPrice: true, hasAvailability: true, hasAddToCart: true },
    });
    expect(c.offerEligible).toBe(true);
  });
});

describe('§12 — états d’ignorance explicites', () => {
  it('page sans aucun indice → UNKNOWN, et elle passe', () => {
    const c = classifyPage({ url: 'https://x.example/abcdef' });
    expect(c.type).toBe('UNKNOWN');
    expect(c.confidence).toBe('ambiguous');
    expect(c.offerEligible).toBe(true);
  });

  it('page marchande de forme indéterminée → COMMERCIAL_UNKNOWN, et elle passe', () => {
    const c = classifyPage({ url: 'https://x.example/abcdef', snippet: 'En stock' });
    expect(c.type).toBe('COMMERCIAL_UNKNOWN');
    expect(c.offerEligible).toBe(true);
  });

  it('COMMERCIAL_UNKNOWN et UNKNOWN sont distincts — le diagnostic diffère', () => {
    expect(typeOf('https://x.example/abcdef')).not.toBe(typeOf('https://x.example/abcdef', '', 'En stock'));
  });

  it('URL illisible → UNKNOWN éligible, jamais un rejet', () => {
    const c = classifyPage({ url: 'pas-une-url' });
    expect(c.type).toBe('UNKNOWN');
    expect(c.offerEligible).toBe(true);
  });

  it('rubrique avec identifiant d’article final → non tranché, donc éligible', () => {
    const c = classifyPage({ url: 'https://m.example/rayon/audio/casque-445263' });
    expect(c.type).toBe('COMMERCIAL_UNKNOWN');
    expect(c.offerEligible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. PROVENANCE ET EXPLICABILITÉ (§18)
// ═══════════════════════════════════════════════════════════════════════════
describe('§18 — toute classification est explicable', () => {
  const CORPUS = [
    'https://m.example/produits/aspirateur-robot',
    'https://m.example/search?q=casque',
    'https://p.example/audio/comparatif',
    'https://v.example/watch?v=a',
    'https://m.example/dp/B08XYZ1234',
    'https://x.example/abcdef',
    'pas-une-url',
  ];

  it('chaque verdict porte au moins une raison non vide', () => {
    for (const url of CORPUS) {
      const c = classifyPage({ url });
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.reasons.every(r => r.trim().length > 0)).toBe(true);
    }
  });

  it('offerEligible est TOUJOURS dérivé du type, jamais posé à la main', () => {
    for (const url of CORPUS) {
      const c = classifyPage({ url });
      expect(c.offerEligible).toBe(isOfferEligible(c.type));
    }
  });

  it('les deux axes coexistent — commercialité et forme ne se confondent pas', () => {
    // Une rubrique marchande : commerciale ET pas une offre. C'est tout le sujet.
    const c = classifyPage({ url: 'https://m.example/rayon/audio', snippet: 'Ajouter au panier' });
    expect(c.commerciality).toBe('commercial');
    expect(c.offerEligible).toBe(false);
  });

  it('une confiance « proven » cite une preuve du site, pas un indice', () => {
    const c = classifyPage({ url: 'https://m.example/x', structure: { jsonLdTypes: ['ItemList'], productEntryCount: 12, hasPagination: true } });
    expect(c.confidence).toBe('proven');
    expect(c.signals.join(' ')).toContain('ItemList');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. RÈGLE ANTI-BLACKLIST (§25)
// ═══════════════════════════════════════════════════════════════════════════
describe('§25 — aucune règle de domaine', () => {
  it('le module ne nomme aucun site', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../src/application/page-classification.ts'), 'utf8'
    ) as string;
    for (const brand of ['youtube', 'reddit', 'wikipedia', 'amazon', 'fnac', 'dyson', 'lesnumeriques', 'clubic', 'cdiscount', 'darty', 'boulanger']) {
      expect(src.toLowerCase()).not.toContain(brand);
    }
  });

  it('deux hôtes différents, même structure → même classification', () => {
    const a = classifyPage({ url: 'https://premier-site.example/produits/aspirateur-robot' });
    const b = classifyPage({ url: 'https://autre-site.example/produits/aspirateur-robot' });
    expect(a.type).toBe(b.type);
  });
});
