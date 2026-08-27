/**
 * CAPUCINE — signal de commercialité d'une page Web
 *
 * POURQUOI CETTE COUCHE EXISTE
 * ────────────────────────────
 * Jusqu'ici, TOUT résultat de recherche devenait une Offer, avec
 * `merchant.id = domaine`. Une campagne Serper réelle a mesuré le coût de ce
 * raccourci : 24 % des « offres » étaient des pages non commerciales —
 * YouTube, Reddit, Wikipédia, tests de la presse spécialisée — présentées à
 * l'utilisateur comme des offres d'achat avec un marchand.
 *
 * Ce n'est pas une donnée inconnue, c'est une affirmation fausse : une vidéo
 * n'est pas une offre, et lui attribuer un marchand invente un fait.
 *
 * CE QUE CE MODULE N'EST PAS
 * ──────────────────────────
 * Ce n'est PAS une liste de domaines. Capucine cherche sur tout le Web légal ;
 * une règle par domaine irait contre cette ambition et serait de toute façon
 * dépassée dès le lendemain. Les signaux ci-dessous sont STRUCTURELS —
 * formes d'URL, vocabulaire, données structurées — et s'appliquent
 * indifféremment à n'importe quel site.
 *
 * L'ASYMÉTRIE FONDAMENTALE
 * ────────────────────────
 * Un faux négatif (vraie offre écartée) est bien plus grave qu'un faux
 * positif : il prive l'utilisateur d'une offre réelle, définitivement et sans
 * qu'il le sache. Le verdict `non_commercial` exige donc une PREUVE positive
 * de nature éditoriale ET l'absence totale de signal commercial. Tout le
 * reste est `unknown` — et `unknown` passe.
 *
 * C'est l'invariant UNKNOWN ≠ BAD appliqué ici : une page sans prix, sans
 * balisage, ou simplement inaccessible n'est pas « non commerciale », elle
 * est « indéterminée ».
 */

/** Verdict explicable sur la nature d'une page. */
export type Commerciality = 'commercial' | 'non_commercial' | 'unknown';

export interface CommercialityVerdict {
  verdict: Commerciality;
  /** Preuves ayant conduit au verdict — jamais une boîte noire. */
  reasons: string[];
  /** Signaux commerciaux relevés. */
  commercialSignals: string[];
  /** Signaux éditoriaux relevés. */
  editorialSignals: string[];
}

export interface CommercialityInput {
  url: string;
  title?: string;
  snippet?: string;
  /** Renseignés uniquement quand la page a réellement été récupérée. */
  page?: {
    hasProductMarkup?: boolean;
    hasOfferMarkup?: boolean;
    priceKnown?: boolean;
    availabilityKnown?: boolean;
    sellerKnown?: boolean;
  };
}

// ── Signaux STRUCTURELS d'URL ────────────────────────────────────────────────
// Formes de chemin, pas noms de domaine : `/wiki/` désigne un wiki où qu'il
// soit hébergé, et `/dp/` une fiche produit chez qui que ce soit.

/** Formes d'URL propres aux plateformes de contenu, quel que soit l'hôte. */
/**
 * Marqueurs rédactionnels reconnus AU NIVEAU DU SEGMENT d'URL.
 *
 * Première version : des motifs délimités (`/comparatif/`). Mesuré sur le Web
 * réel, ils ne captaient presque rien — les formes rencontrées sont
 * `/materiel-audio-hifi/casque-audio/comparatif` (segment final),
 * `comparatif-casques-audio-ecouteurs-nomades-a259.html` (préfixe de segment),
 * `guide-d-achat-aspirateurs-robots-n8441/`. On raisonne donc par segment :
 * un segment porte un marqueur s'il EST ce marqueur ou s'il COMMENCE par lui
 * suivi d'un séparateur.
 *
 * `article` est délibérément absent : en commerce français, « article » désigne
 * un produit, et `/article/12345` est une vraie fiche chez plusieurs marchands.
 * L'inclure fabriquerait des faux négatifs.
 */
const EDITORIAL_SEGMENTS: Array<{ tokens: string[]; label: string }> = [
  { tokens: ['watch', 'shorts', 'video', 'videos', 'reel', 'reels', 'embed'], label: 'URL de contenu vidéo' },
  { tokens: ['wiki'], label: 'URL de wiki' },
  { tokens: ['forum', 'forums', 'thread', 'threads', 'topic', 'topics', 'discussion', 'discussions', 'comments', 'communaute', 'community'], label: 'URL de discussion' },
  // `pressroom` / `newsroom` relevés sur le corpus réel : salles de presse de
  // marques, rédactionnelles malgré un hôte marchand.
  { tokens: ['blog', 'blogs', 'actualite', 'actualites', 'actu', 'news', 'presse', 'pressroom', 'newsroom'], label: 'URL de publication' },
  { tokens: ['test', 'tests', 'comparatif', 'comparatifs', 'comparateur', 'comparateurs', 'dossier', 'dossiers', 'guide', 'guides', 'avis', 'tuto', 'tutoriel', 'tutoriels', 'conseils'], label: 'URL de contenu éditorial' },
  { tokens: ['bon-plan', 'bons-plans', 'bonplan', 'bonsplans'], label: 'URL de bon plan éditorial' },
];

/** Un segment porte-t-il ce marqueur ? Égalité, ou préfixe suivi d'un séparateur. */
function segmentCarries(segment: string, token: string): boolean {
  if (segment === token) return true;
  return segment.startsWith(token) && (segment[token.length] === '-' || segment[token.length] === '_');
}

function editorialUrlSignals(path: string, query: string): string[] {
  const found: string[] = [];
  // `.html` / `.htm` final : une extension n'est pas un marqueur, on la retire
  // pour que `comparatif-...-a259.html` soit lu comme le segment qu'il est.
  const segments = path
    .split('/')
    .filter(Boolean)
    .map(seg => seg.toLowerCase().replace(/\.(html?|php|aspx?)$/, ''))
    // Un identifiant numérique en tête de segment est un artefact de CMS, pas
    // un marqueur : `1811513_test-apple-iphone-15` reste un test rédactionnel.
    .map(seg => seg.replace(/^\d+[-_]/, ''));

  for (const { tokens, label } of EDITORIAL_SEGMENTS) {
    if (segments.some(seg => tokens.some(tok => segmentCarries(seg, tok)))) found.push(label);
  }
  if (/[?&]v=/.test(query) && !found.includes('URL de contenu vidéo')) {
    found.push('URL de contenu vidéo');
  }
  return found;
}

/** Formes d'URL propres aux plateformes de contenu, quel que soit l'hôte. */
const EDITORIAL_URL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\/watch\b|[?&]v=/i,                       label: 'URL de lecture vidéo' },
  { re: /\/wiki\//i,                                label: 'URL de wiki' },
  { re: /\/r\/[a-z0-9_]+/i,                         label: 'URL de forum communautaire' },
  { re: /\/(forum|forums|thread|topic|discussion)s?\//i, label: 'URL de discussion' },
  { re: /\/(blog|actualites|actualite|news|presse)\//i,  label: 'URL de publication' },
  { re: /\/(test|tests|comparatif|comparatifs|dossier|guide-d-achat|guides?)\//i, label: 'URL de contenu éditorial' },
  { re: /\/(video|videos|shorts|reels?)\//i,        label: 'URL de contenu vidéo' },
];

/** Formes d'URL propres aux fiches produit, quel que soit l'hôte. */
const COMMERCE_URL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\/dp\/[A-Z0-9]{6,}/i,                      label: 'chemin de fiche produit' },
  { re: /\/(produit|product|products|produits)\//i,  label: 'chemin produit' },
  { re: /\/(item|items|sku|ref|reference)\//i,       label: 'chemin de référence article' },
  { re: /\/(achat|acheter|buy|shop|boutique)\//i,    label: 'chemin transactionnel' },
  { re: /\/p\/[a-z0-9-]+/i,                          label: 'chemin de fiche produit court' },
  { re: /\/a\d{4,}\//i,                              label: 'chemin de fiche produit numérotée' },
];

// ── Signaux de VOCABULAIRE ───────────────────────────────────────────────────
// Le vocabulaire est un signal FAIBLE, jamais suffisant seul : une fiche
// produit affiche des avis clients, un article de test cite des prix.

/**
 * Vocabulaire commercial. `strong: true` désigne une COMMANDE DE PAGE — un
 * libellé qui n'existe que sur une page qui vend réellement. Le reste est de
 * la prose : une description de vidéo dit « livraison gratuite », un article
 * dit « commander », un forum dit « en stock ». Mesuré : une vidéo dont la
 * description portait « Livraison gratuite — commander maintenant » était
 * classée commerciale malgré une URL `/watch` sans ambiguïté.
 */
const COMMERCE_VOCAB: Array<{ re: RegExp; label: string; strong?: boolean }> = [
  { re: /ajouter au panier|add to cart|add to basket/i, label: 'action panier', strong: true },
  { re: /\ben stock\b|\bin stock\b|disponible en ligne/i, label: 'mention de stock' },
  // Pas de `\b` après une lettre accentuée : en JavaScript, « é » n'est pas
  // un caractère de mot, si bien que la limite ne se comporte pas comme
  // attendu et « vendu et expédié par » n'était pas reconnu.
  { re: /vendu (?:et exp[ée]di[ée]|par)|sold (?:and shipped )?by/i, label: 'mention de vendeur', strong: true },
  { re: /livraison (?:gratuite|offerte|en \d)|free shipping/i, label: 'mention de livraison' },
  { re: /\bcommander\b|\bacheter\b|\bbuy now\b/i,         label: 'appel à l’achat' },
];

const EDITORIAL_VOCAB: Array<{ re: RegExp; label: string }> = [
  { re: /notre (?:test|avis|verdict)|nous avons test[ée]/i, label: 'test rédactionnel' },
  { re: /\bcomparatif\b|\bmeilleurs?\b\s+\w+\s+de\s+20\d\d|top \d+/i, label: 'comparatif éditorial' },
  { re: /guide d['’]achat|comment choisir/i,          label: 'guide d’achat' },
  { re: /\bfiche technique\b.*\bwikip/i,               label: 'contenu encyclopédique' },
  { re: /publi[ée] le \d|par la r[ée]daction/i,        label: 'signature rédactionnelle' },
];

function collect(
  text: string,
  patterns: Array<{ re: RegExp; label: string }>
): string[] {
  return patterns.filter(p => p.re.test(text)).map(p => p.label);
}

/**
 * Évalue si une page constitue une offre commerciale exploitable.
 *
 * Le verdict `non_commercial` n'est rendu que sur PREUVE : une forme d'URL
 * structurellement éditoriale (vidéo, wiki, forum) ou au moins deux marqueurs
 * rédactionnels — et, dans les deux cas, aucun signal commercial. Sinon
 * `unknown`, qui laisse passer.
 */
export function assessCommerciality(input: CommercialityInput): CommercialityVerdict {
  const commercial: string[] = [];
  const editorial: string[] = [];
  const reasons: string[] = [];

  let path = '';
  let query = '';
  try {
    const parsed = new URL(input.url);
    path = parsed.pathname;
    query = parsed.search;
  } catch {
    return {
      verdict: 'unknown',
      reasons: ['URL illisible — nature indéterminable'],
      commercialSignals: [], editorialSignals: [],
    };
  }

  commercial.push(...collect(path + query, COMMERCE_URL_PATTERNS));
  editorial.push(...editorialUrlSignals(path, query));

  const text = `${input.title ?? ''} ${input.snippet ?? ''}`;
  const strongVocab = collect(text, COMMERCE_VOCAB.filter(v => v.strong));
  commercial.push(...collect(text, COMMERCE_VOCAB));
  editorial.push(...collect(text, EDITORIAL_VOCAB));

  // ── Données structurées : le signal le plus fort, quand la page a été lue ──
  const page = input.page;
  if (page) {
    if (page.hasOfferMarkup) commercial.push('balisage Offer structuré');
    if (page.hasProductMarkup) commercial.push('balisage Product structuré');
    if (page.availabilityKnown) commercial.push('disponibilité publiée');
    if (page.sellerKnown) commercial.push('vendeur publié');
    // Le prix seul ne prouve RIEN : un article de test en cite, un forum aussi.
    // Il ne compte que combiné à une autre preuve commerciale.
    if (page.priceKnown && commercial.length > 0) commercial.push('prix publié');
  }

  // ── Décision ──────────────────────────────────────────────────────────────
  // La preuve STRUCTURELLE (forme d'URL, balisage) prime sur la prose. Sans
  // cela, un mot dans un extrait de résultat suffisait à faire d'une vidéo une
  // offre. On n'écarte toutefois que si rien de solide ne plaide pour l'achat.
  const structuralCommercial =
    collect(path + query, COMMERCE_URL_PATTERNS).length > 0 ||
    Boolean(page && (page.hasOfferMarkup || page.hasProductMarkup || page.sellerKnown));
  const editorialUrl = editorialUrlSignals(path, query).length > 0;

  if (editorialUrl && !structuralCommercial && strongVocab.length === 0) {
    reasons.push(`forme d’URL non transactionnelle : ${editorialUrlSignals(path, query).join(', ')}`);
    reasons.push(
      commercial.length > 0
        ? `signaux commerciaux limités à du vocabulaire (${commercial.join(', ')}) — insuffisant face à la forme de l’URL`
        : 'aucun signal commercial relevé'
    );
    return { verdict: 'non_commercial', reasons, commercialSignals: commercial, editorialSignals: editorial };
  }

  if (commercial.length > 0) {
    reasons.push(`preuve commerciale : ${commercial.join(', ')}`);
    return { verdict: 'commercial', reasons, commercialSignals: commercial, editorialSignals: editorial };
  }

  // Aucun signal commercial. Le verdict négatif exige une preuve POSITIVE.
  const structuralEditorial = editorialUrlSignals(path, query).length > 0;
  if (structuralEditorial) {
    reasons.push(`forme d’URL non transactionnelle : ${editorial.join(', ')}`);
    reasons.push('aucun signal commercial relevé');
    return { verdict: 'non_commercial', reasons, commercialSignals: commercial, editorialSignals: editorial };
  }

  if (editorial.length >= 2) {
    reasons.push(`marqueurs rédactionnels concordants : ${editorial.join(', ')}`);
    reasons.push('aucun signal commercial relevé');
    return { verdict: 'non_commercial', reasons, commercialSignals: commercial, editorialSignals: editorial };
  }

  // Rien de concluant : on ne tranche pas. UNKNOWN != NON_COMMERCIAL.
  reasons.push(
    editorial.length === 1
      ? `un seul marqueur rédactionnel (${editorial[0]}) — insuffisant pour exclure`
      : 'aucune preuve dans un sens ni dans l’autre'
  );
  return { verdict: 'unknown', reasons, commercialSignals: commercial, editorialSignals: editorial };
}
