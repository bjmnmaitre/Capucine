/**
 * CAPUCINE — relevé des preuves de structure d'une page
 *
 * Traduit un document HTML en `PageStructureEvidence` : ce que la page DÉCLARE
 * d'elle-même, sans interprétation. Le module ne classe rien — il constate.
 * La décision appartient à page-classification.ts.
 *
 * Règle d'honnêteté : un champ reste `undefined` quand rien n'a permis de
 * l'observer. Il n'est jamais mis à `false` par défaut. `undefined` veut dire
 * « non observé », `false` veut dire « observé absent », et confondre les deux
 * reviendrait à transformer une ignorance en preuve.
 */

import { parse, type HTMLElement } from 'node-html-parser';
import type { PageStructureEvidence } from './page-classification';

/** Types schema.org qui nous intéressent. Tout le reste est ignoré. */
const RELEVANT_TYPES = new Set([
  'Product', 'ProductGroup', 'Offer', 'AggregateOffer', 'ItemList',
  'CollectionPage', 'OfferCatalog', 'SearchResultsPage', 'Article',
  'NewsArticle', 'BlogPosting', 'VideoObject', 'DiscussionForumPosting',
  'FAQPage', 'BreadcrumbList',
]);

/** Aplatit un graphe JSON-LD arbitrairement imbriqué en une liste de noeuds. */
function flattenNodes(value: unknown, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  // Garde-fou : un JSON-LD malformé ou volontairement récursif ne doit pas
  // faire tourner le parseur indéfiniment.
  if (depth > 12 || out.length > 5000) return out;
  if (Array.isArray(value)) {
    for (const v of value) flattenNodes(v, out, depth + 1);
    return out;
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    out.push(node);
    for (const v of Object.values(node)) {
      if (v && (typeof v === 'object')) flattenNodes(v, out, depth + 1);
    }
  }
  return out;
}

/** `@type` peut être une chaîne ou un tableau, et porter un préfixe d'URI. */
function typesOf(node: Record<string, unknown>): string[] {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.replace(/^https?:\/\/schema\.org\//, '').trim());
}

/**
 * Détecte les contrôles propres à une page de liste : tri, filtres, pagination.
 * Volontairement fondé sur des attributs de FORME (rôles ARIA, `rel`, noms de
 * champs), pas sur des noms de classes CSS propres à tel ou tel site.
 */
function detectListingControls(root: HTMLElement, html: string): boolean {
  if (root.querySelector('[role="navigation"][aria-label*="pagin" i]')) return true;
  if (root.querySelector('select[name*="sort" i], select[name*="tri" i], select[name*="order" i]')) return true;
  if (root.querySelector('[data-sort], [data-facet], [data-filter]')) return true;
  if (/\b(?:trier par|sort by|filtrer par|filter by)\b/i.test(html)) return true;
  return false;
}

function detectPagination(root: HTMLElement, html: string): boolean {
  if (root.querySelector('link[rel="next"], link[rel="prev"], a[rel="next"]')) return true;
  if (root.querySelector('nav[aria-label*="pag" i], [class~="pagination"]')) return true;
  if (/\bpage\s+\d+\s*(?:sur|of|\/)\s*\d+/i.test(html)) return true;
  return false;
}

function detectAddToCart(root: HTMLElement, html: string): boolean {
  if (root.querySelector('form[action*="/cart" i], form[action*="/panier" i], button[name*="add-to-cart" i]')) return true;
  if (/\b(?:ajouter au panier|add to cart|add to basket|ajouter au chariot)\b/i.test(html)) return true;
  return false;
}

/**
 * Relève ce que la page déclare. Ne lève jamais : un document illisible produit
 * un constat vide, ce qui laisse la classification à son état d'ignorance
 * plutôt que de lui faire croire à une absence.
 */
/**
 * Ce que la page déclare d'elle-même : sa structure, et son identité.
 *
 * L'identité canonique est tenue séparée des signaux de structure : elle
 * n'entre dans aucune décision de classification. C'est une AFFIRMATION du
 * site sur sa propre adresse, pas une observation sur sa nature.
 */
export interface PageObservations {
  signals: PageStructureEvidence;
  /** `<link rel="canonical">` tel que publié, résolu en absolu. `null` si absent ou illisible. */
  canonicalUrl: string | null;
}

/**
 * @param baseUrl - URL servant à résoudre un `canonical` relatif. Sans elle,
 *   un canonical relatif est ignoré plutôt que deviné.
 */
export function collectPageObservations(html: string, baseUrl?: string): PageObservations {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return { signals: {}, canonicalUrl: null };
  }

  let canonicalUrl: string | null = null;
  const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonicalHref) {
    try {
      canonicalUrl = baseUrl ? new URL(canonicalHref, baseUrl).toString() : new URL(canonicalHref).toString();
    } catch {
      canonicalUrl = null; // illisible : on ne fabrique rien
    }
  }

  return { signals: collectStructure(root, html), canonicalUrl };
}

/** Conservé : de nombreux appelants ne s'intéressent qu'à la structure. */
export function collectPageStructureEvidence(html: string): PageStructureEvidence {
  return collectPageObservations(html).signals;
}

function collectStructure(root: HTMLElement, html: string): PageStructureEvidence {

  const jsonLdTypes: string[] = [];
  let productCount = 0;
  let offerCount = 0;
  let hasAggregateOffer = false;
  let hasProductIdentifier = false;
  let hasSeller = false;
  let hasPrice = false;
  let hasAvailability = false;
  /** A-t-on réellement lu un balisage JSON-LD exploitable ? */
  let sawJsonLd = false;

  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.rawText || script.text || '');
    } catch {
      // Un bloc JSON-LD cassé sur une page n'invalide pas les autres.
      continue;
    }
    sawJsonLd = true;

    for (const node of flattenNodes(parsed)) {
      for (const t of typesOf(node)) {
        if (RELEVANT_TYPES.has(t) && !jsonLdTypes.includes(t)) jsonLdTypes.push(t);
        if (t === 'Product' || t === 'ProductGroup') {
          productCount++;
          if (node.sku || node.gtin13 || node.gtin12 || node.gtin8 || node.gtin || node.mpn) {
            hasProductIdentifier = true;
          }
        }
        if (t === 'Offer') {
          offerCount++;
          if (node.price !== undefined || node.lowPrice !== undefined) hasPrice = true;
          if (node.availability !== undefined) hasAvailability = true;
          if (node.seller !== undefined) hasSeller = true;
        }
        if (t === 'AggregateOffer') {
          hasAggregateOffer = true;
          if (node.lowPrice !== undefined || node.price !== undefined) hasPrice = true;
        }
      }
    }
  }

  const evidence: PageStructureEvidence = {};

  // Le balisage n'est rapporté QUE s'il a réellement été lu. Une page sans
  // JSON-LD ne doit pas se présenter comme une page dont on a constaté
  // l'absence de produits — c'est une page dont on ne sait rien.
  if (sawJsonLd) {
    evidence.jsonLdTypes = jsonLdTypes;
    evidence.productEntryCount = productCount;
    evidence.offerEntryCount = offerCount;
    evidence.hasAggregateOffer = hasAggregateOffer;
    evidence.hasProductIdentifier = hasProductIdentifier;
    evidence.hasSeller = hasSeller;
    evidence.hasPrice = hasPrice;
    evidence.hasAvailability = hasAvailability;
  }

  // Les indices de FORME se relèvent sur le document lui-même, indépendamment
  // du balisage : une page sans JSON-LD peut parfaitement afficher une
  // pagination et des filtres.
  evidence.hasPagination = detectPagination(root, html);
  evidence.hasListingControls = detectListingControls(root, html);
  evidence.hasAddToCart = detectAddToCart(root, html);

  return evidence;
}
