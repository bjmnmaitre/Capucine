/**
 * CAPUCINE — nature d'une page Web
 * ================================
 *
 * Question traitée ici, avant tout classement :
 *
 *   « cette page est-elle réellement une offre que l'utilisateur peut
 *     comparer et éventuellement acheter ? »
 *
 * Le signal de commercialité (commerciality.ts) répond à une question plus
 * étroite : « cette page vend-elle quelque chose ? ». Insuffisant, et mesuré
 * comme tel : `/produits/aspirateur-robot` est incontestablement marchande, et
 * n'est pas une offre — c'est une rubrique. Promue en `Offer`, elle apportait
 * une `executionUrl` qui n'ouvre aucun achat précis, et un prix qui, s'il
 * était extrait, serait celui d'un produit arbitraire de la liste.
 *
 * D'où deux axes distincts, jamais confondus :
 *
 *   axe 1 — COMMERCIAL ?  (commerciality.ts, réutilisé tel quel)
 *   axe 2 — QUELLE FORME ? (ici : rubrique, recherche, fiche, offre)
 *
 *   commercial ≠ offre.
 *
 * ── Deux étages de preuve ────────────────────────────────────────────────────
 *
 * L'enrichissement (téléchargement réel de la page) n'a lieu qu'APRÈS la
 * construction des candidats, et sur les 5 premiers seulement. La
 * classification doit donc trancher pour TOUTES les pages avec l'URL, le titre
 * et l'extrait, puis se laisser affiner quand la page a réellement été lue.
 *
 *   étage 1 — URL + titre + extrait        (toutes les pages)
 *   étage 2 — balisage et structure HTML   (pages enrichies uniquement)
 *
 * L'étage 2, quand il existe, prime : un `ItemList` publié par le marchand est
 * une preuve, une forme d'URL n'est qu'un indice.
 *
 * ── Asymétrie (identique à celle de commerciality.ts) ────────────────────────
 *
 * Écarter une vraie offre prive l'utilisateur sans qu'il le sache. Laisser
 * passer une page douteuse se voit et se corrige. Donc :
 *
 *   CATEGORY et SEARCH_RESULTS exigent une PREUVE.
 *   Le doute produit COMMERCIAL_UNKNOWN ou UNKNOWN, qui passent.
 *
 * UNKNOWN ≠ BAD. UNKNOWN ≠ NON_COMMERCIAL.
 *
 * ── Aucune règle de domaine ─────────────────────────────────────────────────
 *
 * Rien ici ne nomme un site. Un test dédié échoue si un nom de marchand ou de
 * média apparaît dans les règles.
 */

import { assessCommerciality, type Commerciality } from './commerciality';

/**
 * Nature de la page.
 *
 * Les quatre premières valeurs ne sont pas des offres et ne le deviendront
 * jamais. Les quatre suivantes peuvent en porter une. `COMMERCIAL_UNKNOWN` et
 * `UNKNOWN` sont les états d'ignorance assumée — distincts, parce que « la
 * page vend, forme indéterminée » et « on ne sait rien de cette page » ne se
 * diagnostiquent pas pareil.
 */
export type PageType =
  /** Référence, documentation, encyclopédie, notice, aide. */
  | 'INFORMATIONAL'
  /** Article, test, comparatif, guide d'achat, bon plan rédactionnel. */
  | 'EDITORIAL'
  | 'VIDEO'
  /** Forum, fil de discussion, questions-réponses. */
  | 'COMMUNITY'
  /** Rubrique marchande : plusieurs produits, pas d'offre individuelle. */
  | 'CATEGORY'
  /** Résultats d'une recherche interne au site. */
  | 'SEARCH_RESULTS'
  /** Fiche produit : un produit identifié, portant zéro, une ou plusieurs offres. */
  | 'PRODUCT_DETAIL'
  /** Fiche produit dont l'offre exacte est identifiée : vendeur, prix, disponibilité. */
  | 'OFFER_DETAIL'
  /** La page vend, mais rien ne dit encore si c'est une fiche ou une rubrique. */
  | 'COMMERCIAL_UNKNOWN'
  /** Aucune preuve dans un sens ni dans l'autre. */
  | 'UNKNOWN';

/** Force de la preuve ayant produit le verdict. */
export type ClassificationConfidence =
  /** Balisage structuré du site lui-même, ou marqueur d'URL sans ambiguïté. */
  | 'proven'
  /** Plusieurs indices concordants, aucun décisif isolément. */
  | 'likely'
  /** Rien de concluant — le verdict est un état d'ignorance, pas une conclusion. */
  | 'ambiguous';

/**
 * Ce que l'on sait de la STRUCTURE de la page, quand elle a réellement été
 * téléchargée. Tout est optionnel : `undefined` signifie « non observé », ce
 * qui n'est jamais lu comme « absent ». Cette distinction est le coeur de
 * l'honnêteté du signal — une page non lue ne doit rien prouver.
 */
export interface PageStructureEvidence {
  /** Types schema.org relevés dans le JSON-LD (`Product`, `ItemList`, `CollectionPage`…). */
  jsonLdTypes?: string[];
  /** Nombre d'entités Product distinctes balisées sur la page. */
  productEntryCount?: number;
  /** Nombre d'entités Offer distinctes balisées. */
  offerEntryCount?: number;
  /** `AggregateOffer` : un produit, plusieurs vendeurs ou une fourchette de prix. */
  hasAggregateOffer?: boolean;
  /** Éléments de pagination (`rel=next`, numéros de page). */
  hasPagination?: boolean;
  /** Contrôles de liste : tri, filtres, facettes. */
  hasListingControls?: boolean;
  /** Commande d'ajout au panier réellement présente dans le document. */
  hasAddToCart?: boolean;
  /** Identifiant produit unique publié (sku, gtin, mpn). */
  hasProductIdentifier?: boolean;
  hasSeller?: boolean;
  hasPrice?: boolean;
  hasAvailability?: boolean;
}

export interface PageClassificationInput {
  url: string;
  title?: string;
  snippet?: string;
  /** Renseigné uniquement pour les pages effectivement téléchargées. */
  structure?: PageStructureEvidence;
}

export interface PageClassification {
  type: PageType;
  confidence: ClassificationConfidence;
  /**
   * La page peut-elle légitimement produire une `Offer` ?
   *
   * Dérivé du type, jamais renseigné à la main : une rubrique et une page de
   * résultats ne sont pas des offres, quoi qu'elles affichent par ailleurs.
   */
  offerEligible: boolean;
  /** Verdict de l'axe commercial, conservé tel quel — les deux axes coexistent. */
  commerciality: Commerciality;
  /** Preuves retenues, dans l'ordre où elles ont pesé. */
  signals: string[];
  /** Explication lisible de la décision. Jamais vide. */
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Marqueurs d'URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recherche interne. Ces pages affichent de vrais produits et de vrais prix,
 * et ne sont pourtant l'offre de rien : leur contenu dépend d'une requête.
 */
const SEARCH_SEGMENTS = ['search', 'recherche', 'resultats', 'results', 'suche', 'busca'];
const SEARCH_QUERY_KEYS = ['q', 's', 'k', 'query', 'search', 'keyword', 'kw', 'term', 'motcle'];

/**
 * Conteneurs de rubrique. Volontairement restreint aux formes qui ne désignent
 * QU'une liste : `/collections/` (rubrique), `/rayon/`, `/category/`. Les
 * formes ambiguës — `/products/`, `/shop/` — n'y figurent pas : elles désignent
 * une fiche produit chez beaucoup de marchands, et les inscrire ici
 * fabriquerait des faux négatifs, c'est-à-dire des offres réelles perdues.
 *
 * `c` y figure sur mesure : les 22 URLs du corpus portant un segment `/c/`
 * sont toutes des rubriques. Le garde-fou reste le même que pour les autres
 * conteneurs — un identifiant d'article en fin de chemin annule la conclusion.
 */
const CATEGORY_SEGMENTS = [
  'category', 'categories', 'categorie', 'categories', 'cat',
  'rayon', 'rayons', 'collections', 'collection',
  'browse', 'univers', 'gamme', 'selection', 'nos-produits', 'tous-les-produits',
  // Relevés sur le corpus : `/catalogue/velo-electrique/decathlon/`.
  'catalogue', 'catalog',
];

/** Conteneurs pluriels : rubrique OU fiche selon ce qui suit. Jamais décisifs seuls. */
const PLURAL_CONTAINERS = ['produits', 'products', 'articles', 'items'];

/**
 * Conteneur de rubrique abrégé. Traité à part des autres : une lettre isolée
 * est un segment trop banal pour décider seule. Elle ne compte que suivie d'un
 * libellé de rubrique — un mot, pas une lettre. Sans ce garde-fou, un chemin
 * quelconque comportant un segment `c` perdait son éligibilité, et donc une
 * offre potentiellement réelle.
 */
const SHORT_CATEGORY_SEGMENT = 'c';
const MIN_CATEGORY_LABEL_LENGTH = 3;

function hasShortCategoryContainer(segments: string[]): boolean {
  const i = segments.indexOf(SHORT_CATEGORY_SEGMENT);
  if (i < 0) return false;
  const next = segments[i + 1];
  return next !== undefined && next.length >= MIN_CATEGORY_LABEL_LENGTH && /[a-z]/.test(next);
}

/**
 * Navigation à facettes : `brand~logitech`, `phone_memory:256go+phone_model:x`,
 * `facettes_gsm_____memoire`. Une facette filtre une LISTE ; elle ne désigne
 * jamais un article. Relevé sur le corpus réel.
 */
function carriesFacet(segment: string): boolean {
  if (segment.includes('~')) return true;
  if (segment.startsWith('facette')) return true;
  if (segment.includes(':') && segment.includes('+')) return true;
  return false;
}

/** Documentation et aide : commercialement neutres, jamais des offres. */
const DOC_SEGMENTS = ['support', 'aide', 'help', 'faq', 'manuel', 'manual', 'documentation', 'docs', 'notice', 'guide-utilisateur'];

/**
 * Familles reconnaissables au SOUS-DOMAINE.
 *
 * Mesuré : une page d'assistance constructeur arrivait en tête des offres pour
 * « iPhone 15 Pro ». Son marqueur n'est pas dans le chemin — il est dans le
 * nom d'hôte. C'est la même convention structurelle qu'un segment de chemin,
 * et elle ne nomme aucune marque : seuls des mots communs figurent ici.
 *
 * Les conteneurs marchands (`shop.`, `boutique.`, `store.`) en sont
 * délibérément absents : les inscrire écarterait de vraies boutiques.
 */
const HOST_LABEL_FAMILIES: Array<{ labels: string[]; type: PageType; why: string }> = [
  { labels: ['support', 'help', 'aide', 'docs', 'doc', 'documentation', 'faq', 'assistance', 'helpguide'],
    type: 'INFORMATIONAL', why: 'sous-domaine d’assistance' },
  { labels: ['forum', 'forums', 'community', 'communaute', 'answers', 'discussions'],
    type: 'COMMUNITY', why: 'sous-domaine communautaire' },
  { labels: ['blog', 'news', 'presse', 'press', 'pressroom', 'newsroom', 'magazine'],
    type: 'EDITORIAL', why: 'sous-domaine éditorial' },
];

/** Étiquettes de sous-domaine : tout sauf le domaine et son extension. */
function subdomainLabels(hostname: string): string[] {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return [];
  return parts.slice(0, -2).filter(l => l !== 'www' && l !== 'm');
}

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulaire de liste
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formulations qui n'existent que sur une page de liste. Signal FAIBLE : jamais
 * décisif seul, il faut un second indice concordant.
 */
const LISTING_VOCAB: Array<{ re: RegExp; label: string }> = [
  { re: /\btrier par\b|\bsort by\b/i,                              label: 'contrôle de tri' },
  { re: /\bfiltrer\b|\bfiltres?\b|\brefine\b/i,                    label: 'contrôle de filtre' },
  { re: /\d[\d\s]*\s*(?:produits?|articles?|r[ée]f[ée]rences?|results?)\b/i, label: 'décompte d’articles' },
  { re: /\bnotre s[ée]lection\b|\bvoir tous?\b|\btoute la gamme\b/i, label: 'formulation de sélection' },
  { re: /\bpage \d+\s*(?:sur|of|\/)\s*\d+/i,                       label: 'pagination annoncée' },
  { re: /\bd[ée]couvrez? (?:notre|nos|tous)\b/i,                   label: 'formulation de rubrique' },
];

/** Formulations propres à une page de résultats de recherche. */
const SEARCH_VOCAB: Array<{ re: RegExp; label: string }> = [
  { re: /r[ée]sultats? (?:de (?:la )?recherche|pour)\b/i, label: 'libellé de résultats de recherche' },
  { re: /\bsearch results?\b/i,                           label: 'libellé de résultats de recherche' },
  { re: /\brecherche\s*:/i,                               label: 'libellé de recherche' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

function collect(text: string, rules: Array<{ re: RegExp; label: string }>): string[] {
  const out: string[] = [];
  for (const { re, label } of rules) if (re.test(text) && !out.includes(label)) out.push(label);
  return out;
}

/** Segments d'URL normalisés : extension et identifiant de CMS en tête retirés. */
function pathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map(s => s.toLowerCase().replace(/\.(html?|php|aspx?)$/, ''));
}

/**
 * Ce segment porte-t-il un identifiant d'article ?
 *
 * Signal cité au mandat comme distinguant une rubrique d'une fiche :
 * « absence d'identifiant produit unique ». Une rubrique se nomme
 * `aspirateur-robot` ; une fiche se nomme `1331611-sony-wh-1000xm5`,
 * `casque-p68753`, `dp/B08XYZ1234`.
 */
function carriesItemIdentifier(segment: string): boolean {
  if (/\d{4,}/.test(segment)) return true;                 // 1331611-sony, p68753
  if (/^[a-z]?\d{3,}/.test(segment)) return true;          // a2591, 445263
  if (/^[A-Z0-9]{8,}$/i.test(segment) && /\d/.test(segment)) return true; // B08XYZ1234
  return false;
}

/**
 * Le segment ressemble-t-il au nom d'un produit précis plutôt qu'à celui d'une
 * rubrique ? Un modèle commercial porte presque toujours des chiffres
 * (`wh-1000xm5`, `v15`, `iphone-15-pro`), une rubrique presque jamais
 * (`aspirateur-robot`, `smartphones`, `casque-audio`).
 *
 * Utilisé UNIQUEMENT pour refuser de conclure à la rubrique — jamais pour
 * conclure à la fiche. Le sens de la précaution compte : ce test protège
 * contre les faux négatifs.
 */
function looksLikeSpecificModel(segment: string): boolean {
  return /\d/.test(segment) && segment.split('-').length >= 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Types schema.org par lesquels un site déclare que sa page EST un article.
 *
 * Mesuré : sur 84 pages du corpus dont le balisage a pu être lu, 14 portaient
 * l'un de ces types, et les 14 étaient rédactionnelles — tests, guides,
 * comparatifs, communiqués, billets de blog, y compris hébergés par des
 * marchands. Aucune vraie fiche produit n'en portait. Le signal est donc
 * décisif, et il vient du site lui-même.
 */
const ARTICLE_JSONLD_TYPES = ['Article', 'NewsArticle', 'BlogPosting'];

/** Types de page qui ne peuvent, par nature, porter aucune offre. */
const NON_OFFER_TYPES: ReadonlySet<PageType> = new Set<PageType>([
  'INFORMATIONAL', 'EDITORIAL', 'VIDEO', 'COMMUNITY', 'CATEGORY', 'SEARCH_RESULTS',
]);

export function isOfferEligible(type: PageType): boolean {
  return !NON_OFFER_TYPES.has(type);
}

export function classifyPage(input: PageClassificationInput): PageClassification {
  const signals: string[] = [];
  const reasons: string[] = [];

  /**
   * Verdict commercial fondé sur la seule URL — c'est LUI qui décide de la
   * famille rédactionnelle.
   *
   * Mesuré : une page de test publiant un balisage `Product` et douze `Offer`
   * (comparaison de prix insérée dans l'article) basculait en fiche produit,
   * alors que le site la déclare `NewsArticle`. Un balisage produit prouve
   * qu'on PARLE d'un produit, jamais que la page le vend. La forme de l'URL,
   * elle, dit ce qu'est la page.
   */
  const urlCommerciality = assessCommerciality({
    url: input.url,
    title: input.title,
    snippet: input.snippet,
  });

  const commercialityVerdict = assessCommerciality({
    url: input.url,
    title: input.title,
    snippet: input.snippet,
    page: input.structure
      ? {
          hasProductMarkup: (input.structure.jsonLdTypes ?? []).includes('Product'),
          hasOfferMarkup: (input.structure.offerEntryCount ?? 0) > 0,
          priceKnown: input.structure.hasPrice,
          sellerKnown: input.structure.hasSeller,
          availabilityKnown: input.structure.hasAvailability,
        }
      : undefined,
  });

  const decide = (
    type: PageType,
    confidence: ClassificationConfidence,
    because: string
  ): PageClassification => {
    reasons.push(because);
    return {
      type,
      confidence,
      offerEligible: isOfferEligible(type),
      commerciality: commercialityVerdict.verdict,
      signals,
      reasons,
    };
  };

  let pathname = '';
  let search = '';
  let hostname = '';
  try {
    const parsed = new URL(input.url);
    pathname = parsed.pathname;
    search = parsed.search;
    hostname = parsed.hostname;
  } catch {
    // Une URL illisible ne prouve rien. Elle ne doit surtout pas être écartée
    // sur ce seul motif : c'est peut-être une vraie offre mal formée en amont.
    return decide('UNKNOWN', 'ambiguous', 'URL illisible — nature indéterminable');
  }

  const segments = pathSegments(pathname);
  const last = segments[segments.length - 1] ?? '';
  const text = `${input.title ?? ''} ${input.snippet ?? ''}`;
  const structure = input.structure;

  // ── 1. Familles non marchandes ────────────────────────────────────────────
  // Traitées EN PREMIER, avant toute lecture de structure : un guide d'achat
  // publie fréquemment un `ItemList` de produits recommandés, et resterait un
  // guide. Une page de comparaison n'est pas une rubrique marchande.
  const hostLabels = subdomainLabels(hostname);
  for (const family of HOST_LABEL_FAMILIES) {
    if (hostLabels.some(l => family.labels.includes(l))) {
      signals.push(family.why);
      return decide(family.type, 'proven', `${family.why} — cette page ne vend rien`);
    }
  }

  if (segments.some(s => DOC_SEGMENTS.includes(s))) {
    signals.push('segment de documentation');
    return decide('INFORMATIONAL', 'proven', 'chemin de documentation ou d’aide — page de référence, pas de vente');
  }

  if (structure?.jsonLdTypes?.some(t => ARTICLE_JSONLD_TYPES.includes(t))) {
    const declared = structure.jsonLdTypes.find(t => ARTICLE_JSONLD_TYPES.includes(t));
    signals.push(`balisage ${declared}`);
    return decide('EDITORIAL', 'proven', 'le site déclare lui-même un article');
  }

  if (urlCommerciality.verdict === 'non_commercial') {
    signals.push(...urlCommerciality.editorialSignals);
    const editorial = urlCommerciality.editorialSignals.join(' ');
    if (editorial.includes('vidéo')) {
      return decide('VIDEO', 'proven', 'page de lecture vidéo — jamais une offre');
    }
    if (editorial.includes('discussion')) {
      return decide('COMMUNITY', 'proven', 'page de discussion communautaire — jamais une offre');
    }
    if (editorial.includes('wiki')) {
      return decide('INFORMATIONAL', 'proven', 'page de wiki — page de référence, pas de vente');
    }
    return decide(
      'EDITORIAL',
      urlCommerciality.editorialSignals.length > 1 ? 'proven' : 'likely',
      `contenu rédactionnel : ${urlCommerciality.reasons[0]}`
    );
  }

  // ── 2. Recherche interne ──────────────────────────────────────────────────
  // Une page de résultats affiche de vrais produits à de vrais prix, et n'est
  // l'offre d'aucun d'eux : son contenu dépend d'une requête, pas d'un article.
  const searchParams = new URLSearchParams(search);
  const searchKeyHit = SEARCH_QUERY_KEYS.find(k => {
    const v = searchParams.get(k);
    return v !== null && v.trim().length > 0;
  });
  const searchSegmentHit = segments.some(s => SEARCH_SEGMENTS.includes(s));
  const searchVocab = collect(text, SEARCH_VOCAB);

  if (searchSegmentHit) {
    signals.push('segment de recherche interne');
    if (searchKeyHit) signals.push(`paramètre de requête « ${searchKeyHit} »`);
    return decide('SEARCH_RESULTS', 'proven', 'chemin de recherche interne au site');
  }
  if (structure?.jsonLdTypes?.includes('SearchResultsPage')) {
    signals.push('balisage SearchResultsPage');
    return decide('SEARCH_RESULTS', 'proven', 'le site déclare lui-même une page de résultats');
  }
  if (searchKeyHit && searchVocab.length > 0) {
    // Un paramètre `q=` seul ne suffit pas : beaucoup de fiches produit en
    // portent un pour le suivi de campagne. Il faut un second indice.
    signals.push(`paramètre de requête « ${searchKeyHit} »`, ...searchVocab);
    return decide('SEARCH_RESULTS', 'likely', 'paramètre de recherche et libellé de résultats concordants');
  }

  // ── 3. Preuve de structure : le site décrit lui-même sa page ──────────────
  if (structure) {
    const types = structure.jsonLdTypes ?? [];
    const productCount = structure.productEntryCount;

    // `ItemList` / `CollectionPage` avec plusieurs produits : preuve directe.
    // Le nombre seul ne suffit pas — §7 : une rubrique peut n'afficher qu'un
    // article. C'est la conjonction type + pluralité, ou type + contrôles de
    // liste, qui prouve.
    const listType = types.find(t => t === 'ItemList' || t === 'CollectionPage' || t === 'OfferCatalog');
    if (listType) {
      const corroboration =
        (productCount !== undefined && productCount > 1) ||
        structure.hasPagination === true ||
        structure.hasListingControls === true;
      if (corroboration) {
        signals.push(`balisage ${listType}`);
        if (productCount !== undefined && productCount > 1) signals.push(`${productCount} produits balisés`);
        if (structure.hasPagination) signals.push('pagination');
        if (structure.hasListingControls) signals.push('contrôles de liste');
        return decide('CATEGORY', 'proven', 'le site déclare une liste de produits');
      }
      // `ItemList` sans corroboration : peut être un fil d'Ariane ou une liste
      // d'images sur une fiche produit. On ne conclut pas.
      signals.push(`balisage ${listType} non corroboré`);
    }

    if (productCount !== undefined && productCount > 1 &&
        (structure.hasPagination === true || structure.hasListingControls === true)) {
      signals.push(`${productCount} produits balisés`, structure.hasPagination ? 'pagination' : 'contrôles de liste');
      return decide('CATEGORY', 'proven', 'plusieurs produits balisés et contrôles de liste');
    }

    // Fiche : un produit identifié.
    if (types.includes('Product') && (productCount === undefined || productCount <= 1)) {
      signals.push('balisage Product');
      if (structure.hasProductIdentifier) signals.push('identifiant produit publié');

      // §6 — une fiche portant plusieurs vendeurs reste UNE fiche produit.
      // Elle ne devient pas une offre unique par écrasement : le modèle
      // existant sait déjà représenter un Product portant plusieurs Offers,
      // et c'est cette voie qui doit être empruntée en aval.
      if (structure.hasAggregateOffer || (structure.offerEntryCount ?? 0) > 1) {
        signals.push(
          structure.hasAggregateOffer ? 'AggregateOffer' : `${structure.offerEntryCount} offres balisées`
        );
        return decide('PRODUCT_DETAIL', 'proven', 'fiche produit portant plusieurs offres — aucune offre unique ne peut en être déduite');
      }

      // §5 — une FICHE OFFRE exige vendeur, prix et disponibilité identifiés.
      if (structure.hasSeller && structure.hasPrice && structure.hasAvailability) {
        signals.push('vendeur publié', 'prix publié', 'disponibilité publiée');
        return decide('OFFER_DETAIL', 'proven', 'fiche produit dont l’offre exacte est identifiée : vendeur, prix et disponibilité');
      }

      // Fiche produit sans offre exploitable : elle reste une fiche produit.
      // UNKNOWN ≠ BAD — l'absence de prix n'est pas un motif de rejet, elle
      // sera portée honnêtement en aval par un DataPoint 'unknown'.
      return decide('PRODUCT_DETAIL', 'proven', 'fiche produit balisée, sans offre complète identifiée');
    }
  }

  // ── 4. Indices de rubrique dans l'URL et le texte ─────────────────────────
  // Sans preuve de structure, il faut DEUX indices concordants. Une rubrique
  // classée à tort est une offre perdue.
  const facetHit = segments.some(carriesFacet);
  if (facetHit) {
    signals.push('navigation à facettes');
    return decide('CATEGORY', 'proven', 'facette de navigation — filtre une liste, ne désigne aucun article');
  }

  const categorySegmentHit =
    segments.some(s => CATEGORY_SEGMENTS.includes(s)) || hasShortCategoryContainer(segments);
  const pluralContainerIdx = segments.findIndex(s => PLURAL_CONTAINERS.includes(s));
  const listingVocab = collect(text, LISTING_VOCAB);

  if (categorySegmentHit) {
    signals.push('segment de rubrique');
    // Un conteneur de rubrique suivi d'un identifiant d'article désigne une
    // fiche rangée dans cette rubrique, pas la rubrique elle-même.
    if (carriesItemIdentifier(last)) {
      signals.push('identifiant d’article en fin de chemin');
      return decide('COMMERCIAL_UNKNOWN', 'ambiguous', 'chemin de rubrique mais identifiant d’article final — fiche probable, non tranché');
    }
    if (listingVocab.length > 0) signals.push(...listingVocab);
    return decide('CATEGORY', listingVocab.length > 0 ? 'proven' : 'likely', 'chemin de rubrique marchande sans identifiant d’article');
  }

  if (pluralContainerIdx >= 0) {
    const tail = segments.slice(pluralContainerIdx + 1);
    signals.push('conteneur pluriel');
    if (tail.length === 0) {
      return decide('CATEGORY', 'likely', 'conteneur pluriel sans article désigné — liste de produits');
    }
    const hasId = tail.some(carriesItemIdentifier);
    const specific = tail.some(looksLikeSpecificModel);
    if (hasId || specific) {
      // `/produits/casque-audio/sony/1331611-sony-wh-1000xm5` : fiche.
      signals.push(hasId ? 'identifiant d’article' : 'nom de modèle précis');
      return decide('COMMERCIAL_UNKNOWN', 'ambiguous', 'conteneur pluriel menant à un article désigné');
    }

    // Un conteneur pluriel suivi d'UN SEUL libellé est le cas réellement
    // ambigu, et c'est une mesure qui l'a établi, pas un raisonnement : dans
    // le corpus, `/products/levoit-purificateur-dair-everestair` est une vraie
    // fiche (plateforme marchande qui range les fiches sous `/products/` et
    // les rubriques sous `/collections/`), tandis que `/produits/smartphones`
    // et `/produits/aspirateur-robot` sont des rubriques. Ce qui les sépare
    // est la longueur du libellé : une rubrique se nomme en un ou deux mots,
    // une fiche porte un nom de produit.
    //
    // Au-delà d'un seul niveau, la hiérarchie tranche d'elle-même : un chemin
    // `/produits/outillage/outillage-electroportatif/visseuse` est une
    // navigation par rayons, jamais un article.
    if (tail.length === 1 && tail[0].split('-').filter(Boolean).length > 2) {
      signals.push('libellé final long — nom d’article probable');
      return decide('COMMERCIAL_UNKNOWN', 'ambiguous', 'conteneur pluriel suivi d’un libellé trop spécifique pour une rubrique');
    }

    // `/produits/aspirateur-robot` : rubrique. Deux indices — conteneur
    // pluriel, et libellé final générique sans identifiant ni modèle.
    signals.push('libellé final générique, sans identifiant ni modèle');
    if (listingVocab.length > 0) signals.push(...listingVocab);
    return decide(
      'CATEGORY',
      listingVocab.length > 0 ? 'proven' : 'likely',
      'conteneur pluriel suivi d’un libellé générique — rubrique'
    );
  }

  // Vocabulaire de liste seul : faible. Il faut au moins deux formulations
  // distinctes pour conclure, sinon une fiche produit affichant « trier par »
  // dans ses avis clients basculerait à tort.
  if (listingVocab.length >= 2) {
    signals.push(...listingVocab);
    return decide('CATEGORY', 'likely', 'plusieurs formulations de liste concordantes');
  }

  // ── 5. Marchand, forme indéterminée ───────────────────────────────────────
  if (commercialityVerdict.verdict === 'commercial') {
    signals.push(...commercialityVerdict.commercialSignals);
    if (listingVocab.length > 0) signals.push(...listingVocab);
    return decide('COMMERCIAL_UNKNOWN', 'ambiguous', `page marchande de forme indéterminée : ${commercialityVerdict.reasons[0]}`);
  }

  return decide('UNKNOWN', 'ambiguous', 'aucune preuve dans un sens ni dans l’autre');
}
