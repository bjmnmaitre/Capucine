/**
 * Capucine — ProductPageExtractor
 *
 * REAL IMPLEMENTATION: fetches an actual product page and extracts
 * structured Product/Offer data via JSON-LD (schema.org), a public,
 * ToS-compliant standard most e-commerce sites already publish for
 * search engine rich snippets (Google Shopping, etc.).
 *
 * WHY THIS EXISTS
 * ────────────────
 * RealWebDiscoveryStrategy previously extracted price only via a regex
 * heuristic on the search engine's snippet text (see real-web-discovery.ts
 * extractPrice()). That only works when the snippet happens to contain a
 * price string, and it cannot recover merchant identity, availability, or
 * a reliable product name — it only had title/url/snippet/domain to work
 * with. This module closes that gap by retrieving the actual page and
 * reading the structured data the merchant itself publishes.
 *
 * HONESTY INVARIANTS (non-negotiable):
 * - No DOM/HTML parsing library — JSON-LD <script> blocks are isolated by
 *   tag boundary only, then parsed as strict JSON. No arbitrary HTML is
 *   ever "interpreted" or guessed.
 * - Network failure, timeout, non-HTML response, missing JSON-LD, or a
 *   JSON-LD block without a Product node → returns null. NEVER fabricated.
 * - Every extracted field is a DataPoint with status='known' and
 *   provenance='json_ld' + the source URL — never silently upgraded to
 *   'verified'.
 * - This module does NOT bypass authentication, CAPTCHAs, or any access
 *   restriction. A blocked/failed fetch is treated as "unavailable", full
 *   stop — never retried via another method within this module.
 *
 * NOT YET LIVE-VERIFIED: this module has been tested against constructed
 * JSON-LD fixtures (see product-page-extractor.test.ts), not against a real
 * merchant page over the network. See enrichment call site in
 * real-web-discovery.ts for how this is wired in, and the final report for
 * exactly what remains unverified.
 */

import { DataPoint } from '../domain/types';
import { SUPPORTED_COUNTRIES, SupportedCountry } from './i18n';
import { extractHtmlFields, toDataPoint } from './html-field-extractors';
import { COUNTRY_NAMES } from './request-interpreter';
import { PageReader, type PageSnapshot } from './page-reader';
import { collectPageStructureEvidence as collectPageStructureEvidenceLocal } from './page-structure-evidence';
import type { PageStructureEvidence } from './page-classification';

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedProductData {
  price: DataPoint<number>;
  /**
   * Delivery cost as published by the merchant (schema.org
   * OfferShippingDetails.shippingRate). 'unknown' on the vast majority of
   * pages — most merchants do not publish a rate in JSON-LD. Never defaulted
   * to 0: an unpublished rate is not free delivery.
   */
  shippingCost: DataPoint<number>;
  currency: string | null;
  availability: DataPoint<'in_stock' | 'out_of_stock' | 'preorder'>;
  merchantName: DataPoint<string>;
  productName: DataPoint<string>;
  /**
   * Raw category string as published by the merchant's own JSON-LD
   * (schema.org Product.category), e.g. "Ordinateurs portables". NOT mapped
   * onto Capucine's internal category vocabulary (ordinateur_portable,
   * smartphone, ...) — merchant category strings vary too widely to map
   * reliably without guessing, which would violate the "never invent"
   * invariant. AdmissibilityEngine's category criterion already handles an
   * honest mismatch here correctly (VIOLATED, not silently accepted) via its
   * preferredValues equality check.
   */
  category: DataPoint<string>;
  /** Technical specs read from Product.additionalProperty (schema.org PropertyValue list), when present. */
  ram: DataPoint<string>;
  screenSize: DataPoint<string>;
  storage: DataPoint<string>;
  /**
   * Universal product identifier — schema.org publishes several possible
   * fields (gtin13/gtin12/gtin8/gtin/isbn); the first one present is used,
   * in that order (gtin13 is the modern canonical EAN-13). Feeds
   * offer.characteristics['ean'] downstream, which is what
   * DeduplicationEngine's identical_ean/identical_isbn signals already read
   * — this is what makes an EXACT_MATCH between two DIFFERENT domains
   * possible for real Web offers (previously only the local catalog fixtures
   * ever set 'ean', so cross-domain dedup for the Web path had no hard
   * identifier to work with, only weaker title/model signals).
   */
  gtin: DataPoint<string>;
  /** schema.org Product.sku — merchant-scoped, not universal like gtin, but
   *  still useful evidence (see DeduplicationEngine's other MatchTypes). */
  sku: DataPoint<string>;
  /** schema.org Product.brand (string or {name}). */
  brand: DataPoint<string>;
  /**
   * schema.org Offer.itemCondition — maps to the SAME 'new'/'refurbished'/
   * 'used' vocabulary RequestInterpreter.extractCondition() produces from a
   * user's "uniquement du neuf"/"élargis à..." style query, so a
   * conversational condition follow-up can actually be verified (SATISFIED/
   * VIOLATED) against a real Web offer instead of always resolving UNKNOWN.
   */
  condition: DataPoint<'new' | 'refurbished' | 'used'>;
  /**
   * schema.org Offer.shippingDetails (OfferShippingDetails —
   * https://schema.org/OfferShippingDetails).shippingDestination
   * (DefinedRegion).addressCountry, normalized to Capucine's
   * SupportedCountry codes (see normalizeCountryToken()). Feeds
   * offer.characteristics['deliversTo'] downstream (real-web-discovery.ts),
   * which is what makes the conversational "livrable en France" criterion
   * (RequestInterpreter.extractDeliverabilityIntent()) actually resolve
   * SATISFIED/VIOLATED instead of always UNKNOWN.
   *
   * Real merchant pages publish this field in wildly inconsistent shapes —
   * a single country, an array, a single DefinedRegion object, an array of
   * DefinedRegion objects, or multiple OfferShippingDetails blocks (one per
   * shipping zone/rate). ALL of those are handled; a shape this parser
   * doesn't recognize (or a vague region like "Europe" with no resolvable
   * country) contributes NOTHING to the result rather than a guess — the
   * overall DataPoint only becomes 'known' when at least one country was
   * actually resolved.
   */
  shipsToCountries: DataPoint<SupportedCountry[]>;
  sourceUrl: string;
  /**
   * Quelle voie a produit ces données. La distinction compte : 'json_ld_product'
   * vient d'un balisage structuré publié par le marchand, 'html_fields' d'une
   * lecture d'OpenGraph/microdata/meta/HTML — moins explicite, donc à ne pas
   * confondre en aval.
   */
  extractionMethod: 'json_ld_product' | 'html_fields';
  /**
   * Ce que la page déclare de sa propre STRUCTURE — liste, pagination,
   * balisage produit, contrôles de tri. Relevé ici parce que le document est
   * déjà téléchargé et analysé : le second étage de la classification de page
   * (page-classification.ts) n'a pas d'autre occasion de voir le HTML.
   *
   * Absent quand la page n'a pas pu être lue. Ne décrit jamais le produit —
   * uniquement la nature du document qui le porte.
   */
  structure?: PageStructureEvidence;
}

/**
 * Ce qu'une récupération a réellement produit.
 *
 * Les URL sont tenues distinctes parce qu'elles répondent à des questions
 * différentes, et les confondre revient à affirmer ce qu'on n'a pas observé :
 *
 *   requestedUrl — ce qu'on a DEMANDÉ (vient du fournisseur de recherche) ;
 *   finalUrl     — ce qui a été SERVI, après redirections ;
 *   redirectChain— le chemin parcouru, conservé pour la provenance.
 *
 * L'URL canonique, elle, est déclarée par la page et relevée ailleurs
 * (page-reader.ts) : c'est une affirmation du site, pas une observation
 * réseau.
 */
export interface FetchedPage {
  html: string;
  requestedUrl: string;
  /** Identique à `requestedUrl` quand aucune redirection n'a eu lieu. */
  finalUrl: string;
  /** Sauts effectivement suivis, dans l'ordre. Vide sans redirection. */
  redirectChain: string[];
}

export interface PageFetcher {
  fetch(url: string, timeoutMs?: number): Promise<string | null>;
  /**
   * Récupération rapportant l'URL finale. Optionnelle : un récupérateur de
   * test qui n'implémente que `fetch()` reste valide, et l'appelant sait
   * alors qu'il n'a PAS observé d'URL finale — plutôt que de supposer
   * qu'elle vaut l'URL demandée.
   */
  fetchPage?(url: string, timeoutMs?: number): Promise<FetchedPage | null>;
}

// ============================================================================
// FETCHER (real network call, isolated behind an interface for testability)
// ============================================================================

/**
 * Real HTTP fetcher. Never throws — any failure (network, timeout,
 * non-2xx, non-HTML) resolves to null so callers can degrade gracefully
 * without special-casing exceptions.
 */
/**
 * Refuses a URL this process must not fetch.
 *
 * The extractor is pointed at URLs that came from a search provider, i.e. from
 * outside. Fetching whatever it is handed makes this the classic SSRF hop: a
 * result naming `169.254.169.254`, `localhost` or a `10.x` host would have the
 * SERVER retrieve it, from inside the network, and hand the body to the
 * parser. Only public http(s) is fetched.
 *
 * KNOWN LIMIT (deliberate, documented rather than half-solved): redirects are
 * still followed by fetch itself, so a public URL that 302s to a private
 * address is not caught here. Closing that needs manual redirect handling with
 * per-hop validation; it is out of scope for the MVP and noted as such.
 */
function isFetchableUrl(url: string, allowPrivateHosts = false): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  // Opt-in escape hatch for tests that serve a page from a local loopback
  // server. Never enabled by default, and never driven by an environment
  // variable — a private-host fetch has to be asked for in code, at the call
  // site, so it cannot be switched on inadvertently in production.
  if (allowPrivateHosts) return true;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false;

  // IPv4 literals in loopback / private / link-local ranges.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 0 || a === 10) return false;
    if (a === 169 && b === 254) return false;            // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host)) return false;

  return true;
}

export interface HttpPageFetcherOptions {
  /**
   * Allow loopback/private addresses. FOR TESTS ONLY: a fetcher built with
   * this flag is an SSRF relay by construction. Production must never set it.
   */
  allowPrivateHosts?: boolean;
}

export class HttpPageFetcher implements PageFetcher {
  private readonly allowPrivateHosts: boolean;

  constructor(options: HttpPageFetcherOptions = {}) {
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  /**
   * Hard cap on bytes read from a page's body — the Web is an untrusted
   * boundary (megaprompt PARTIE 13): a hostile or simply pathologically
   * large response must never be allowed to exhaust process memory. JSON-LD
   * product data lives in <head>, always comfortably within this cap for
   * any legitimate merchant page.
   */
  private static readonly MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB

  /**
   * Nombre maximal de redirections suivies.
   *
   * Au-delà, la page est abandonnée. Une chaîne plus longue relève soit d'une
   * boucle, soit d'un site qu'il ne sert à rien de poursuivre.
   */
  private static readonly MAX_REDIRECTS = 5;

  async fetch(url: string, timeoutMs = 8000): Promise<string | null> {
    return (await this.fetchPage(url, timeoutMs))?.html ?? null;
  }

  async fetchPage(url: string, timeoutMs = 8000): Promise<FetchedPage | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const hop = await this.followRedirects(url, controller.signal);
      if (hop === null) return null;

      const { res, finalUrl, redirectChain } = hop;
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) return null;

      return {
        html: await this.readBounded(res),
        requestedUrl: url,
        finalUrl,
        redirectChain,
      };
    } catch {
      // Network error, abort/timeout, or any other failure — never throw.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Suit les redirections À LA MAIN, en revalidant CHAQUE saut.
   *
   * Auparavant : `redirect: 'follow'`, avec la garde SSRF appliquée à la seule
   * URL de départ. Une page distante — donc non fiable, puisque son adresse
   * vient d'un moteur de recherche — n'avait qu'à répondre
   * `302 Location: http://169.254.169.254/…` ou `http://127.0.0.1:…` pour que
   * le processus aille chercher lui-même une ressource interne. La garde était
   * intégralement contournable par une redirection.
   *
   * Chaque saut est désormais soumis à `isFetchableUrl` avant d'être suivi,
   * les boucles sont détectées, et le nombre de sauts est borné.
   */
  private async followRedirects(
    startUrl: string,
    signal: AbortSignal
  ): Promise<{ res: Response; finalUrl: string; redirectChain: string[] } | null> {
    let current = startUrl;
    const redirectChain: string[] = [];
    const visited = new Set<string>([startUrl]);

    for (let hop = 0; hop <= HttpPageFetcher.MAX_REDIRECTS; hop++) {
      // Revalidé à CHAQUE saut, y compris le premier.
      if (!isFetchableUrl(current, this.allowPrivateHosts)) return null;

      const res = await fetch(current, {
        signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'CapucineBot/0.1 (+shopping research agent; respects robots.txt)',
          Accept: 'text/html',
        },
      });

      // Seul un 3xx EXPLICITE est une redirection. Formulé en positif à
      // dessein : la forme inverse traitait un statut absent ou illisible
      // comme une redirection, et poursuivait alors une `Location` qui n'en
      // était pas une.
      const isRedirect = typeof res.status === 'number' && res.status >= 300 && res.status < 400;
      if (!isRedirect) {
        return { res, finalUrl: current, redirectChain };
      }

      const location = res.headers.get('location');
      if (!location) return null; // 3xx sans destination exploitable

      let next: string;
      try {
        // Résolue par rapport au saut courant : une `Location` relative est
        // légitime, et la reconstruire à partir de l'URL de départ produirait
        // une adresse fausse.
        next = new URL(location, current).toString();
      } catch {
        return null; // destination illisible
      }

      if (visited.has(next)) return null; // boucle de redirection
      visited.add(next);
      redirectChain.push(next);
      current = next;
    }

    return null; // trop de redirections
  }

  /**
   * Reads the response body up to MAX_RESPONSE_BYTES, then stops — never
   * buffers the rest. A truncated page still gets parsed for JSON-LD (which
   * is near the top of <head> on virtually every real merchant page); a
   * truncation that happens to cut a JSON-LD block in half simply fails
   * JSON.parse for that block, which extractJsonLdBlocks already treats as
   * "skip this block, never guess its content" — no special-casing needed.
   */
  private async readBounded(res: Response): Promise<string> {
    if (!res.body) return await res.text(); // no stream available — fall back (some runtimes/mocks)

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > HttpPageFetcher.MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8');
  }
}

// ============================================================================
// JSON-LD EXTRACTION (pure, deterministic, testable without network)
// ============================================================================

const JSON_LD_BLOCK_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Extracts and parses every JSON-LD <script> block in the page. Malformed
 * blocks are skipped individually — one bad block never discards the rest
 * of the page.
 */
function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  let match: RegExpExecArray | null;
  JSON_LD_BLOCK_RE.lastIndex = 0;
  while ((match = JSON_LD_BLOCK_RE.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      continue; // malformed JSON-LD — skip, never guess its content
    }
  }
  return blocks;
}

/**
 * Recursively searches a parsed JSON-LD tree for a node with
 * "@type": "Product" (handles @graph wrapping and arrays, both common
 * in real-world JSON-LD).
 */
function findProductNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findProductNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  if (isProduct) return obj;

  if (Array.isArray(obj['@graph'])) {
    const found = findProductNode(obj['@graph'], depth + 1);
    if (found) return found;
  }

  return null;
}

function normalizeOfferNode(offers: unknown): Record<string, unknown> | null {
  if (offers === null || offers === undefined) return null;
  if (Array.isArray(offers)) {
    const first = offers[0];
    return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : null;
  }
  return typeof offers === 'object' ? (offers as Record<string, unknown>) : null;
}

function nowProvenance(): { source: string; retrievedAt: Date } {
  return { source: 'json_ld', retrievedAt: new Date() };
}

// ============================================================================
// SHIPPING DESTINATION (OfferShippingDetails.shippingDestination.addressCountry)
// ============================================================================

// A few common ISO 3166-1 alpha-3 codes merchants sometimes publish instead
// of alpha-2 — small, controlled, only for the countries Capucine already
// recognizes (SUPPORTED_COUNTRIES). Not exhaustive on purpose: an alpha-3
// code outside this map is left unresolved (UNKNOWN) rather than guessed.
const ALPHA3_TO_ALPHA2: Record<string, SupportedCountry> = {
  FRA: 'FR', DEU: 'DE', ESP: 'ES', ITA: 'IT', PRT: 'PT', GBR: 'GB',
  BEL: 'BE', NLD: 'NL', AUT: 'AT', CHE: 'CH', IRL: 'IE',
  SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', POL: 'PL',
  USA: 'US', CAN: 'CA',
};

/**
 * Normalizes ONE raw country token (whatever shape a merchant's JSON-LD
 * actually used) into a SupportedCountry code, or null when it can't be
 * resolved WITHOUT guessing (e.g. a region name like "Europe", an unknown
 * alpha-3 code, or an empty string). Never fabricates a country.
 */
function normalizeCountryToken(raw: unknown): SupportedCountry | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!token) return null;

  const upper = token.toUpperCase();
  if (upper.length === 2 && (SUPPORTED_COUNTRIES as readonly string[]).includes(upper)) {
    return upper as SupportedCountry;
  }
  if (upper.length === 3 && ALPHA3_TO_ALPHA2[upper]) {
    return ALPHA3_TO_ALPHA2[upper];
  }
  // Reuses RequestInterpreter's OWN controlled country-name dictionary
  // (COUNTRY_NAMES) — the same "France"/"Germany"/"Allemagne" mapping
  // conversational intents already use, so a merchant that publishes a
  // spelled-out country name is understood consistently everywhere in
  // Capucine, not via a second dictionary.
  const byName = COUNTRY_NAMES[token.toLowerCase()];
  if (byName) return byName;

  return null; // e.g. "Europe", "Worldwide", or anything not resolvable — never guessed
}

/**
 * Recursively pulls every resolvable country out of a DefinedRegion (or
 * array of them) — `addressCountry` may itself be a string, an array of
 * strings, or (rarely) a nested Country object with a `name` — WITHOUT ever
 * assuming a single canonical shape, since real merchant markup varies.
 */
function countriesFromRegion(region: unknown, into: Set<SupportedCountry>): void {
  if (region === null || region === undefined) return;
  if (Array.isArray(region)) {
    for (const r of region) countriesFromRegion(r, into);
    return;
  }
  if (typeof region === 'string') {
    const c = normalizeCountryToken(region);
    if (c) into.add(c);
    return;
  }
  if (typeof region === 'object') {
    const obj = region as Record<string, unknown>;
    const addressCountry = obj['addressCountry'];
    if (typeof addressCountry === 'string') {
      const c = normalizeCountryToken(addressCountry);
      if (c) into.add(c);
    } else if (Array.isArray(addressCountry)) {
      for (const entry of addressCountry) countriesFromRegion(entry, into);
    } else if (typeof addressCountry === 'object' && addressCountry !== null) {
      // e.g. { "@type": "Country", "name": "France" }
      const name = (addressCountry as Record<string, unknown>)['name'];
      const c = normalizeCountryToken(name);
      if (c) into.add(c);
    }
  }
}

/**
 * Extracts the shipping RATE from Offer.shippingDetails[].shippingRate
 * (schema.org MonetaryAmount). This is the amount the buyer pays for delivery
 * — distinct from shippingDestination, which says only WHERE the offer ships.
 *
 * Merchants may publish several OfferShippingDetails (one per zone/service),
 * each with its own rate. We do NOT pick one:
 *   - every resolvable rate agrees        → 'known'
 *   - resolvable rates disagree           → 'contradictory' (a real state:
 *                                            we saw the data and it conflicts)
 *   - nothing resolvable, or field absent → 'unknown'
 * A free-shipping rate of 0 is a fact and is reported as such; the absence of
 * a rate is NOT 0, and the two never collapse.
 */
function extractShippingRate(offerNode: Record<string, unknown> | null): DataPoint<number> {
  const shippingDetailsRaw = offerNode?.['shippingDetails'];
  if (!shippingDetailsRaw) return { value: null, status: 'unknown' };

  const detailsList = Array.isArray(shippingDetailsRaw) ? shippingDetailsRaw : [shippingDetailsRaw];
  const rates: number[] = [];

  for (const details of detailsList) {
    if (typeof details !== 'object' || details === null) continue;
    const rateRaw = (details as Record<string, unknown>)['shippingRate'];
    if (typeof rateRaw !== 'object' || rateRaw === null) continue;

    // MonetaryAmount.value — a number, or a numeric string.
    const rawValue = (rateRaw as Record<string, unknown>)['value'];
    const parsed =
      typeof rawValue === 'number' ? rawValue
      : typeof rawValue === 'string' && rawValue.trim() !== '' ? Number(rawValue.replace(',', '.'))
      : NaN;

    if (Number.isFinite(parsed) && parsed >= 0) rates.push(parsed);
  }

  if (rates.length === 0) return { value: null, status: 'unknown' };

  const allAgree = rates.every(r => Math.abs(r - rates[0]) < 0.005);
  if (!allAgree) return { value: null, status: 'contradictory' };

  return { value: rates[0], status: 'known', provenance: nowProvenance() };
}

/**
 * Extracts every country an offer ships to from Offer.shippingDetails
 * (OfferShippingDetails — possibly an array of several, one per shipping
 * zone/rate). Returns 'unknown' when the field is absent OR present but
 * unresolvable (e.g. only a vague region name) — never a fabricated guess.
 */
function extractShippingDestinations(offerNode: Record<string, unknown> | null): DataPoint<SupportedCountry[]> {
  const shippingDetailsRaw = offerNode?.['shippingDetails'];
  if (!shippingDetailsRaw) return { value: null, status: 'unknown' };

  const detailsList = Array.isArray(shippingDetailsRaw) ? shippingDetailsRaw : [shippingDetailsRaw];
  const countries = new Set<SupportedCountry>();

  for (const details of detailsList) {
    if (typeof details !== 'object' || details === null) continue;
    const destination = (details as Record<string, unknown>)['shippingDestination'];
    if (destination === undefined) continue;
    const destinationList = Array.isArray(destination) ? destination : [destination];
    for (const region of destinationList) countriesFromRegion(region, countries);
  }

  if (countries.size === 0) return { value: null, status: 'unknown' };
  return { value: [...countries], status: 'known', provenance: nowProvenance() };
}

/**
 * Read a single spec value from Product.additionalProperty — schema.org's
 * standard mechanism for arbitrary technical specs (PropertyValue list:
 * [{ "@type": "PropertyValue", "name": "RAM", "value": "16GB" }, ...]).
 *
 * `nameSynonyms` is a small, controlled, deterministic list of the property
 * names merchants commonly use for the same spec (French + English) — NOT a
 * fuzzy/ML match. If no entry's name matches (case-insensitively) any
 * synonym, the spec is honestly unknown; nothing is guessed from adjacent
 * fields (title, description, etc.).
 */
function extractAdditionalProperty(
  product: Record<string, unknown>,
  nameSynonyms: string[]
): DataPoint<string> {
  const raw = product['additionalProperty'];
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const lowerSynonyms = nameSynonyms.map(s => s.toLowerCase());

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e['name'] === 'string' ? (e['name'] as string).toLowerCase() : '';
    if (!lowerSynonyms.includes(name)) continue;

    const value = e['value'];
    if (typeof value === 'string' && value.trim() !== '') {
      return { value: value.trim(), status: 'known', provenance: nowProvenance() };
    }
    if (typeof value === 'number') {
      return { value: String(value), status: 'known', provenance: nowProvenance() };
    }
  }

  return { value: null, status: 'unknown' };
}

/** Property-name synonyms (French + English) for each spec — same idea as the
 * controlled synonym lists already used in BasicPatternInterpreter, kept local
 * here since it's specific to how merchants label additionalProperty entries. */
const RAM_PROPERTY_NAMES = ['ram', 'mémoire', 'memoire', 'mémoire vive', 'memory'];
const STORAGE_PROPERTY_NAMES = ['storage', 'stockage', 'capacité de stockage', 'capacite de stockage', 'disque', 'ssd', 'capacity'];
const SCREEN_SIZE_PROPERTY_NAMES = ['screen size', 'screensize', 'taille écran', 'taille de l\'écran', 'taille ecran', 'diagonale', 'display size'];

function mapToExtractedData(product: Record<string, unknown>, sourceUrl: string): ExtractedProductData {
  const offerNode = normalizeOfferNode(product['offers']);

  const priceRaw = offerNode?.['price'];
  const priceNumber =
    typeof priceRaw === 'number'
      ? priceRaw
      : typeof priceRaw === 'string' && priceRaw.trim() !== '' && !isNaN(Number(priceRaw))
        ? Number(priceRaw)
        : null;
  const price: DataPoint<number> =
    priceNumber !== null
      ? { value: priceNumber, status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  const currency =
    typeof offerNode?.['priceCurrency'] === 'string' ? (offerNode['priceCurrency'] as string) : null;

  const availabilityRaw = typeof offerNode?.['availability'] === 'string' ? (offerNode['availability'] as string) : '';
  const availability: DataPoint<'in_stock' | 'out_of_stock' | 'preorder'> = /InStock/i.test(availabilityRaw)
    ? { value: 'in_stock', status: 'known', provenance: nowProvenance() }
    : /OutOfStock/i.test(availabilityRaw)
      ? { value: 'out_of_stock', status: 'known', provenance: nowProvenance() }
      : /PreOrder/i.test(availabilityRaw)
        ? { value: 'preorder', status: 'known', provenance: nowProvenance() }
        : { value: null, status: 'unknown' };

  const sellerRaw = offerNode?.['seller'];
  const sellerName =
    typeof sellerRaw === 'object' && sellerRaw !== null && typeof (sellerRaw as Record<string, unknown>)['name'] === 'string'
      ? ((sellerRaw as Record<string, unknown>)['name'] as string)
      : typeof sellerRaw === 'string'
        ? sellerRaw
        : null;
  const merchantName: DataPoint<string> =
    sellerName !== null
      ? { value: sellerName, status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  const nameRaw = product['name'];
  const productName: DataPoint<string> =
    typeof nameRaw === 'string' && nameRaw.trim() !== ''
      ? { value: nameRaw, status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  const categoryRaw = product['category'];
  const category: DataPoint<string> =
    typeof categoryRaw === 'string' && categoryRaw.trim() !== ''
      ? { value: categoryRaw.trim(), status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  const ram = extractAdditionalProperty(product, RAM_PROPERTY_NAMES);
  const storage = extractAdditionalProperty(product, STORAGE_PROPERTY_NAMES);
  const screenSize = extractAdditionalProperty(product, SCREEN_SIZE_PROPERTY_NAMES);

  // GTIN: try the modern canonical field first, then older/narrower
  // variants, then ISBN (books use isbn instead of gtin) — first present
  // wins, nothing is combined or guessed across fields.
  const gtinField = ['gtin13', 'gtin', 'gtin12', 'gtin8', 'isbn']
    .map(key => product[key])
    .find(v => typeof v === 'string' && v.trim() !== '');
  const gtin: DataPoint<string> =
    typeof gtinField === 'string'
      ? { value: gtinField.trim(), status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  const skuRaw = product['sku'];
  const sku: DataPoint<string> =
    typeof skuRaw === 'string' && skuRaw.trim() !== ''
      ? { value: skuRaw.trim(), status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  const brandRaw = product['brand'];
  const brandName =
    typeof brandRaw === 'string'
      ? brandRaw
      : typeof brandRaw === 'object' && brandRaw !== null && typeof (brandRaw as Record<string, unknown>)['name'] === 'string'
        ? ((brandRaw as Record<string, unknown>)['name'] as string)
        : null;
  const brand: DataPoint<string> =
    brandName !== null && brandName.trim() !== ''
      ? { value: brandName.trim(), status: 'known', provenance: nowProvenance() }
      : { value: null, status: 'unknown' };

  // schema.org Offer.itemCondition is a full URL (schema.org/NewCondition)
  // or sometimes just the trailing token — matched loosely on the
  // distinguishing word, never on the whole URL, so either form works.
  const conditionRaw = typeof offerNode?.['itemCondition'] === 'string' ? (offerNode['itemCondition'] as string) : '';
  const condition: DataPoint<'new' | 'refurbished' | 'used'> = /NewCondition/i.test(conditionRaw)
    ? { value: 'new', status: 'known', provenance: nowProvenance() }
    : /RefurbishedCondition/i.test(conditionRaw)
      ? { value: 'refurbished', status: 'known', provenance: nowProvenance() }
      : /UsedCondition|DamagedCondition/i.test(conditionRaw)
        ? { value: 'used', status: 'known', provenance: nowProvenance() }
        : { value: null, status: 'unknown' };

  const shipsToCountries = extractShippingDestinations(offerNode);
  const shippingCost = extractShippingRate(offerNode);

  return {
    price,
    shippingCost,
    currency,
    availability,
    merchantName,
    productName,
    category,
    ram,
    screenSize,
    storage,
    gtin,
    sku,
    brand,
    condition,
    shipsToCountries,
    sourceUrl,
    extractionMethod: 'json_ld_product',
  };
}

/**
 * Pure extraction from already-retrieved HTML. Exported separately from
 * the fetch step so it can be unit-tested with fixtures, with zero
 * network dependency.
 */
/**
 * Complète une extraction JSON-LD avec les champs lisibles ailleurs dans la
 * page (OpenGraph, microdata, meta, HTML), UNIQUEMENT là où le JSON-LD n'a
 * rien fourni. Le JSON-LD reste prioritaire : c'est la source la plus
 * structurée et la plus explicitement publiée par le marchand.
 *
 * Ne remplace jamais une valeur connue par une autre. Ne comble jamais un
 * champ contradictoire — une contradiction reste une contradiction.
 */
function completeWithHtmlFields(
  base: ExtractedProductData,
  html: string
): ExtractedProductData {
  const fields = extractHtmlFields(html);
  const completed = { ...base };

  if (base.price.status === 'unknown') {
    const fromHtml = toDataPoint(fields.price);
    if (fromHtml.status !== 'unknown') completed.price = fromHtml;
  }
  if (base.currency === null && fields.currency.status === 'known') {
    completed.currency = fields.currency.value;
  }
  if (base.availability.status === 'unknown' && fields.availability.status === 'known') {
    completed.availability = toDataPoint(fields.availability) as ExtractedProductData['availability'];
  }
  if (base.shippingCost.status === 'unknown') {
    const fromHtml = toDataPoint(fields.shippingCost);
    if (fromHtml.status !== 'unknown') completed.shippingCost = fromHtml;
  }
  if (base.productName.status === 'unknown' && fields.title.status === 'known') {
    completed.productName = toDataPoint(fields.title);
  }
  if (base.brand.status === 'unknown' && fields.brand.status === 'known') {
    completed.brand = toDataPoint(fields.brand);
  }

  return completed;
}

/**
 * Construit une extraction à partir des SEULS champs HTML, pour les pages qui
 * ne publient aucun JSON-LD Product. Avant cette voie, une telle page ne
 * produisait rien du tout (mesuré : 0 % de couverture hors JSON-LD).
 *
 * Retourne null quand la page ne livre RIEN d'exploitable — une page vide ne
 * doit pas devenir une offre creuse.
 */
function extractFromHtmlOnly(html: string, sourceUrl: string): ExtractedProductData | null {
  const fields = extractHtmlFields(html);

  // Le seuil : la page doit apporter quelque chose que le résultat de
  // recherche ne donnait PAS déjà. Un titre seul n'en fait pas partie — le
  // snippet en fournit un — et produirait une offre creuse. Il faut donc un
  // prix, une disponibilité ou une marque pour justifier une extraction.
  const addsRealInformation =
    fields.price.status !== 'unknown' ||
    fields.availability.status === 'known' ||
    fields.brand.status === 'known';
  if (!addsRealInformation) return null;

  const unknownDp = <T>() => ({ value: null, status: 'unknown' as const }) as DataPoint<T>;

  return {
    price: toDataPoint(fields.price),
    shippingCost: toDataPoint(fields.shippingCost),
    currency: fields.currency.value,
    availability: toDataPoint(fields.availability) as ExtractedProductData['availability'],
    merchantName: unknownDp<string>(),
    productName: toDataPoint(fields.title),
    category: unknownDp<string>(),
    ram: unknownDp<string>(),
    screenSize: unknownDp<string>(),
    storage: unknownDp<string>(),
    gtin: unknownDp<string>(),
    sku: unknownDp<string>(),
    brand: toDataPoint(fields.brand),
    condition: unknownDp<ExtractedProductData['condition']['value']>(),
    shipsToCountries: unknownDp<SupportedCountry[]>(),
    sourceUrl,
    // Nommée distinctement du JSON-LD : la provenance de la méthode compte.
    extractionMethod: 'html_fields',
  } as ExtractedProductData;
}

/**
 * Relève les données produit ET la nature structurelle du document.
 *
 * Le relevé de structure est attaché ici, à l'unique endroit où le HTML est
 * disponible : l'enrichissement ne repasse jamais sur la page. Il est joint
 * même quand aucune donnée produit n'a pu être extraite, car « cette page est
 * une rubrique » est une information utile précisément dans ce cas.
 */
/**
 * Extrait les données produit et y joint le constat de structure déjà établi.
 *
 * Le constat n'est PAS recalculé ici : il vient du lecteur de page, qui l'a
 * produit que l'extraction réussisse ou non. C'est tout l'objet du découplage.
 */
function extractProductFromHtml(
  html: string,
  sourceUrl: string,
  snapshot: PageSnapshot
): ExtractedProductData | null {
  const data = extractProductData(html, sourceUrl);
  if (data === null) return null;
  return { ...data, structure: snapshot.signals };
}

/**
 * Voie directe HTML → données produit, sans réseau.
 *
 * Le constat de structure y est recalculé sur place, faute de lecteur de page
 * en amont. Les appelants qui disposent d'un `PageSnapshot` doivent préférer
 * `ProductPageExtractor.read()`, qui ne l'analyse qu'une fois.
 */
export function extractJsonLdProduct(html: string, sourceUrl: string): ExtractedProductData | null {
  const data = extractProductData(html, sourceUrl);
  if (data === null) return null;
  return { ...data, structure: collectPageStructureEvidenceLocal(html) };
}

function extractProductData(html: string, sourceUrl: string): ExtractedProductData | null {
  const blocks = extractJsonLdBlocks(html);
  for (const block of blocks) {
    const product = findProductNode(block);
    // JSON-LD trouvé : il fait autorité, mais ses trous sont comblés par les
    // autres formes présentes sur la même page.
    if (product) return completeWithHtmlFields(mapToExtractedData(product, sourceUrl), html);
  }
  // Aucun JSON-LD Product : on tente les autres formats plutôt que d'abandonner.
  return extractFromHtmlOnly(html, sourceUrl);
}

// ============================================================================
// PUBLIC ENTRY POINT (fetch + extract)
// ============================================================================

/**
 * Résultat complet d'une visite de page : ce qu'elle EST, et ce qu'elle
 * VEND — les deux séparément, parce qu'ils s'obtiennent séparément.
 */
export interface PageReading {
  /**
   * Ce que la page déclare d'elle-même. TOUJOURS présent dès lors que la page
   * a été récupérée, y compris quand aucun produit n'y est lisible.
   */
  snapshot: PageSnapshot;
  /**
   * Données produit, quand la page en publie. `null` sur 44 % des pages
   * réellement lues du corpus — une proportion qui rend intolérable de faire
   * dépendre la lecture de la page de ce succès-là.
   */
  product: ExtractedProductData | null;
}

export class ProductPageExtractor {
  private readonly reader: PageReader;

  constructor(private readonly fetcher: PageFetcher = new HttpPageFetcher()) {
    // L'extracteur est un CONSOMMATEUR du lecteur, jamais l'inverse : lire une
    // page ne doit rien devoir à la capacité d'y trouver un produit.
    this.reader = new PageReader(fetcher);
  }

  /**
   * Visite une page et rend les deux lectures indépendantes.
   *
   * @returns `null` UNIQUEMENT si la page n'a pas pu être récupérée. Une page
   *   obtenue rend toujours un `snapshot`; `product` vaut `null` quand elle
   *   ne publie rien d'exploitable. Confondre ces deux `null` — page
   *   inaccessible et page sans produit — était le défaut corrigé ici.
   */
  async read(url: string, timeoutMs = 8000): Promise<PageReading | null> {
    const page = await this.reader.read(url, timeoutMs);
    if (page === null) return null;
    return {
      snapshot: page.snapshot,
      // Une seule récupération réseau : l'extraction travaille sur le document
      // déjà en main, jamais sur un second téléchargement.
      product: extractProductFromHtml(page.html, url, page.snapshot),
    };
  }

  /**
   * Fetches `url` and extracts structured Product/Offer data if present.
   * Returns null on ANY failure (network, timeout, no JSON-LD, no Product
   * node) — callers must treat null as "could not enrich", never as an error
   * to propagate, and must never fall back to inventing a value.
   *
   * Conservée pour les appelants qui ne s'intéressent qu'au produit. Ceux qui
   * ont besoin de savoir ce qu'EST la page doivent passer par `read()`, seul
   * capable de le dire quand aucun produit n'est lisible.
   */
  async extract(url: string, timeoutMs = 8000): Promise<ExtractedProductData | null> {
    return (await this.read(url, timeoutMs))?.product ?? null;
  }
}
