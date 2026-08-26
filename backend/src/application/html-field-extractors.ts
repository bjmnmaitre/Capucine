/**
 * CAPUCINE — extraction multi-format, champ par champ
 *
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────
 * L'extraction ne lisait que le JSON-LD. Mesuré sur 35 pages : 100 % de
 * réussite sur JSON-LD, **0 % sur tout le reste** (OpenGraph, meta, microdata,
 * HTML). Une page marchande sans balisage JSON-LD Product ne produisait rien.
 * Ce n'était pas malhonnête — l'extracteur renvoyait `null` plutôt que
 * d'inventer — mais cela réduisait Capucine à la fraction du Web qui publie
 * du JSON-LD.
 *
 * PRINCIPE : CHAMP PAR CHAMP, PAS PAGE PAR PAGE
 * ─────────────────────────────────────────────
 * Une page n'est pas « valide » ou « invalide ». Chaque champ est cherché
 * indépendamment, dans l'ordre des sources les plus fiables aux moins
 * fiables, et le résultat porte TOUJOURS la source qui l'a fourni. Une page
 * peut donc livrer son titre par OpenGraph, son prix par microdata et sa
 * disponibilité par le HTML — chacun tracé séparément.
 *
 * CE QUE CE MODULE NE FAIT PAS
 * ────────────────────────────
 * Il ne devine jamais. Un champ absent reste `unknown`. Deux sources
 * structurées qui se contredisent produisent `contradictory` — jamais un
 * arbitrage silencieux au profit de celle qui remplit le champ.
 */
import { parse, HTMLElement } from 'node-html-parser';
import type { DataPoint, DataStatus } from '../domain/types';

/** D'où vient concrètement une valeur extraite. Conservé jusqu'à l'offre. */
export type FieldSource =
  | 'json_ld' | 'microdata' | 'open_graph' | 'meta' | 'html' | 'document_url';

export interface FieldOrigin {
  source: FieldSource;
  /** Le sélecteur, la propriété ou la balise qui a fourni la valeur. */
  locator: string;
}

/** Une valeur extraite avec sa traçabilité. */
export interface ExtractedField<T> {
  value: T | null;
  status: DataStatus;
  origin: FieldOrigin | null;
  /** Renseigné quand plusieurs sources se contredisent. */
  conflicting?: Array<{ value: T; origin: FieldOrigin }>;
}

const UNKNOWN_FIELD = <T>(): ExtractedField<T> => ({ value: null, status: 'unknown', origin: null });

function found<T>(value: T, source: FieldSource, locator: string): ExtractedField<T> {
  return { value, status: 'known', origin: { source, locator } };
}

// ============================================================================
// PARSING DES PRIX
// ============================================================================

/**
 * Lit un montant écrit comme un humain l'écrit.
 *
 * Le point dur est l'ambiguïté entre séparateur de milliers et séparateur
 * décimal : « 1.299 » vaut 1299 en français et 1,299 en anglais. La règle
 * appliquée : le DERNIER séparateur suivi d'exactement 2 chiffres est
 * décimal ; suivi de 3 chiffres, c'est un séparateur de milliers. Quand la
 * forme reste ambiguë, on refuse plutôt que de deviner.
 */
export function parseMoney(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s  ]/g, '');
  const match = /(\d[\d.,]*)/.exec(cleaned);
  if (!match) return null;

  let digits = match[1];
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  const lastSep = Math.max(lastComma, lastDot);

  if (lastSep === -1) {
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }

  const decimals = digits.length - lastSep - 1;
  if (decimals === 3 && (digits.match(/[.,]/g) ?? []).length >= 1) {
    // « 1.299 » / « 1,299 » → séparateur de milliers, pas de décimales.
    digits = digits.replace(/[.,]/g, '');
  } else if (decimals === 1 || decimals === 2) {
    // Le dernier séparateur est décimal ; les autres sont des milliers.
    const intPart = digits.slice(0, lastSep).replace(/[.,]/g, '');
    const decPart = digits.slice(lastSep + 1);
    digits = `${intPart}.${decPart}`;
  } else {
    return null; // Forme non reconnue : on ne devine pas.
  }

  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Devise reconnue depuis un symbole ou un code ISO explicite. */
export function parseCurrency(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const iso = /\b(EUR|USD|GBP|CHF|CAD)\b/i.exec(raw);
  if (iso) return iso[1].toUpperCase();
  if (raw.includes('€')) return 'EUR';
  if (raw.includes('$')) return 'USD';
  if (raw.includes('£')) return 'GBP';
  return null;
}

// ============================================================================
// LECTEURS PAR FORMAT
// ============================================================================

function metaContent(root: HTMLElement, selector: string): string | null {
  const el = root.querySelector(selector);
  const content = el?.getAttribute('content');
  return content && content.trim().length > 0 ? content.trim() : null;
}

function microdataValue(root: HTMLElement, prop: string): string | null {
  const el = root.querySelector(`[itemprop="${prop}"]`);
  if (!el) return null;
  // schema.org autorise la valeur dans `content` ou dans le texte.
  const attr = el.getAttribute('content') ?? el.getAttribute('href');
  const raw = (attr ?? el.text ?? '').trim();
  return raw.length > 0 ? raw : null;
}

// ============================================================================
// EXTRACTION PAR CHAMP — hiérarchie explicite, source conservée
// ============================================================================

export function extractTitle(root: HTMLElement): ExtractedField<string> {
  const og = metaContent(root, 'meta[property="og:title"]');
  if (og) return found(og, 'open_graph', 'og:title');

  const micro = microdataValue(root, 'name');
  if (micro) return found(micro, 'microdata', 'itemprop=name');

  const twitter = metaContent(root, 'meta[name="twitter:title"]');
  if (twitter) return found(twitter, 'meta', 'twitter:title');

  const h1 = root.querySelector('h1')?.text?.trim();
  if (h1) return found(h1, 'html', 'h1');

  const title = root.querySelector('title')?.text?.trim();
  if (title) return found(title, 'html', 'title');

  return UNKNOWN_FIELD<string>();
}

export function extractBrand(root: HTMLElement): ExtractedField<string> {
  const micro = microdataValue(root, 'brand');
  if (micro) return found(micro, 'microdata', 'itemprop=brand');
  const meta = metaContent(root, 'meta[property="product:brand"]')
    ?? metaContent(root, 'meta[name="brand"]');
  if (meta) return found(meta, 'meta', 'product:brand');
  return UNKNOWN_FIELD<string>();
}

/**
 * Prix. Plusieurs sources structurées peuvent le publier ; si elles ne
 * s'accordent pas, la contradiction est CONSERVÉE — c'est un fait sur la page,
 * pas un problème à trancher en silence.
 */
export function extractPrice(root: HTMLElement): ExtractedField<number> {
  const candidates: Array<{ value: number; origin: FieldOrigin }> = [];

  const push = (raw: string | null, source: FieldSource, locator: string) => {
    if (!raw) return;
    const n = parseMoney(raw);
    if (n !== null) candidates.push({ value: n, origin: { source, locator } });
  };

  push(metaContent(root, 'meta[property="og:price:amount"]'), 'open_graph', 'og:price:amount');
  push(metaContent(root, 'meta[property="product:price:amount"]'), 'meta', 'product:price:amount');
  // Les pages réelles publient indifféremment `property=` ou `name=` : ignorer
  // la seconde forme laissait des pages entières inexploitées.
  push(metaContent(root, 'meta[name="product:price:amount"]'), 'meta', 'meta name=product:price:amount');
  push(metaContent(root, 'meta[name="price"]'), 'meta', 'meta name=price');
  push(microdataValue(root, 'price'), 'microdata', 'itemprop=price');

  if (candidates.length === 0) {
    // Repli HTML : uniquement sur un élément explicitement désigné comme prix.
    // On ne balaie PAS le texte de la page : un nombre trouvé au hasard n'est
    // pas un prix, et se tromper ici est pire que ne rien dire.
    for (const selector of ['[class*="price"]', '[id*="price"]', '[data-price]']) {
      const el = root.querySelector(selector);
      const raw = el?.getAttribute('data-price') ?? el?.text;
      if (raw) {
        const n = parseMoney(raw);
        if (n !== null) return found(n, 'html', selector);
      }
    }
    return UNKNOWN_FIELD<number>();
  }

  const distinct = [...new Set(candidates.map(c => c.value))];
  if (distinct.length > 1) {
    return { value: null, status: 'contradictory', origin: candidates[0].origin, conflicting: candidates };
  }
  return { value: candidates[0].value, status: 'known', origin: candidates[0].origin };
}

export function extractCurrency(root: HTMLElement): ExtractedField<string> {
  for (const [selector, source, locator] of [
    ['meta[property="og:price:currency"]', 'open_graph', 'og:price:currency'],
    ['meta[property="product:price:currency"]', 'meta', 'product:price:currency'],
  ] as const) {
    const raw = metaContent(root, selector);
    if (raw) {
      const c = parseCurrency(raw) ?? raw.toUpperCase();
      if (/^[A-Z]{3}$/.test(c)) return found(c, source, locator);
    }
  }
  const metaName = metaContent(root, 'meta[name="product:price:currency"]')
    ?? metaContent(root, 'meta[name="currency"]');
  if (metaName && /^[A-Z]{3}$/i.test(metaName)) {
    return found(metaName.toUpperCase(), 'meta', 'meta name=currency');
  }
  const micro = microdataValue(root, 'priceCurrency');
  if (micro && /^[A-Z]{3}$/i.test(micro)) return found(micro.toUpperCase(), 'microdata', 'itemprop=priceCurrency');
  return UNKNOWN_FIELD<string>();
}

export type Availability = 'in_stock' | 'out_of_stock' | 'preorder';

export function extractAvailability(root: HTMLElement): ExtractedField<Availability> {
  const normalize = (raw: string): Availability | null => {
    const v = raw.toLowerCase();
    if (/instock|in stock|en stock|disponible|available/.test(v)) return 'in_stock';
    if (/outofstock|out of stock|rupture|indisponible|épuisé|epuise|sold ?out/.test(v)) return 'out_of_stock';
    if (/preorder|pre-order|précommande|precommande/.test(v)) return 'preorder';
    return null;
  };

  const micro = microdataValue(root, 'availability');
  if (micro) { const a = normalize(micro); if (a) return found(a, 'microdata', 'itemprop=availability'); }

  const og = metaContent(root, 'meta[property="og:availability"]')
    ?? metaContent(root, 'meta[property="product:availability"]');
  if (og) { const a = normalize(og); if (a) return found(a, 'open_graph', 'og:availability'); }

  const el = root.querySelector('[class*="availability"], [class*="stock"], [id*="stock"]');
  if (el?.text) { const a = normalize(el.text); if (a) return found(a, 'html', 'class~=stock'); }

  return UNKNOWN_FIELD<Availability>();
}

/**
 * Coût de livraison. « Livraison gratuite » est un FAIT chiffré (0), à ne pas
 * confondre avec une absence d'information. Une mention conditionnelle
 * (« offerte dès 50 € », « à partir de 4,99 € ») n'est PAS un tarif ferme :
 * elle reste unknown plutôt que de devenir un montant que l'utilisateur
 * pourrait prendre pour le sien.
 */
export function extractShippingCost(root: HTMLElement): ExtractedField<number> {
  const text = root.text ?? '';

  const conditional = /(offerte|gratuite|free)[^.]{0,30}(dès|des|à partir|from|over)\s*\d/i.test(text)
    || /(à partir de|from)\s*\d+[.,]?\d*\s*(€|EUR|\$)/i.test(text);
  if (conditional) return UNKNOWN_FIELD<number>();

  if (/livraison\s+(gratuite|offerte)|free\s+(shipping|delivery)/i.test(text)) {
    return found(0, 'html', 'texte: livraison gratuite');
  }

  const micro = microdataValue(root, 'shippingRate');
  if (micro) { const n = parseMoney(micro); if (n !== null) return found(n, 'microdata', 'itemprop=shippingRate'); }

  const explicit = /(?:livraison|frais de port|shipping)\s*:?\s*(\d+[.,]?\d*)\s*(?:€|EUR)/i.exec(text);
  if (explicit) { const n = parseMoney(explicit[1]); if (n !== null) return found(n, 'html', 'texte: livraison X €'); }

  return UNKNOWN_FIELD<number>();
}

/** URL canonique déclarée par la page. Jamais construite. */
export function extractCanonicalUrl(root: HTMLElement): ExtractedField<string> {
  const link = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (link && /^https?:\/\//.test(link)) return found(link, 'html', 'link[rel=canonical]');
  const og = metaContent(root, 'meta[property="og:url"]');
  if (og && /^https?:\/\//.test(og)) return found(og, 'open_graph', 'og:url');
  return UNKNOWN_FIELD<string>();
}

/**
 * Promotion éventuelle. DÉTECTER n'est pas VÉRIFIER : ce module signale
 * seulement ce que la page affiche. L'interprétation métier (et le droit de
 * compter une économie) reste à PromotionEngine et à RULE 4.
 */
export interface DetectedPromotion {
  /** Prix barré affiché, s'il est lisible. */
  originalPrice: number | null;
  /** Code promo mentionné en clair, jamais déduit. */
  code: string | null;
  /** Pourcentage de remise affiché. */
  percentOff: number | null;
}

export function detectPromotion(root: HTMLElement): ExtractedField<DetectedPromotion> {
  const text = root.text ?? '';

  let originalPrice: number | null = null;
  const struck = root.querySelector('del, s, strike, [class*="old-price"], [class*="was-price"], [class*="barre"]');
  if (struck?.text) originalPrice = parseMoney(struck.text);

  const codeMatch = /\b(?:code|coupon)\s*(?:promo|de r[ée]duction)?\s*:?\s*([A-Z0-9]{4,20})\b/.exec(text);
  const code = codeMatch ? codeMatch[1] : null;

  const percentMatch = /-\s*(\d{1,2})\s*%|(\d{1,2})\s*%\s*(?:de\s*)?(?:remise|off|r[ée]duction)/i.exec(text);
  const percentOff = percentMatch ? Number(percentMatch[1] ?? percentMatch[2]) : null;

  if (originalPrice === null && code === null && percentOff === null) {
    return UNKNOWN_FIELD<DetectedPromotion>();
  }
  return found({ originalPrice, code, percentOff }, 'html', 'promotion affichée');
}

// ============================================================================
// POINT D'ENTRÉE
// ============================================================================

export interface HtmlExtractedFields {
  title: ExtractedField<string>;
  brand: ExtractedField<string>;
  price: ExtractedField<number>;
  currency: ExtractedField<string>;
  availability: ExtractedField<Availability>;
  shippingCost: ExtractedField<number>;
  canonicalUrl: ExtractedField<string>;
  promotion: ExtractedField<DetectedPromotion>;
}

/**
 * Extrait tous les champs d'une page, chacun indépendamment.
 * Ne renvoie jamais null : une page vide produit des champs `unknown`, ce qui
 * est une information exploitable, contrairement à une absence de résultat.
 */
export function extractHtmlFields(html: string): HtmlExtractedFields {
  let root: HTMLElement;
  try {
    root = parse(html ?? '');
  } catch {
    // Une page illisible ne fait pas échouer la recherche : tout est unknown.
    return {
      title: UNKNOWN_FIELD(), brand: UNKNOWN_FIELD(), price: UNKNOWN_FIELD(),
      currency: UNKNOWN_FIELD(), availability: UNKNOWN_FIELD(),
      shippingCost: UNKNOWN_FIELD(), canonicalUrl: UNKNOWN_FIELD(),
      promotion: UNKNOWN_FIELD(),
    };
  }

  return {
    title: extractTitle(root),
    brand: extractBrand(root),
    price: extractPrice(root),
    currency: extractCurrency(root),
    availability: extractAvailability(root),
    shippingCost: extractShippingCost(root),
    canonicalUrl: extractCanonicalUrl(root),
    promotion: detectPromotion(root),
  };
}

/** Convertit un champ extrait en DataPoint du domaine, provenance conservée. */
export function toDataPoint<T>(field: ExtractedField<T>, retrievedAt = new Date()): DataPoint<T> {
  if (field.status === 'known' && field.origin) {
    return {
      value: field.value,
      status: 'known',
      provenance: { source: `${field.origin.source}:${field.origin.locator}`, retrievedAt },
    } as DataPoint<T>;
  }
  if (field.status === 'contradictory') {
    return {
      value: null, status: 'contradictory',
      ...(field.conflicting ? { conflictingValues: field.conflicting.map(c => c.value) } : {}),
    } as DataPoint<T>;
  }
  return { value: null, status: 'unknown' } as DataPoint<T>;
}
