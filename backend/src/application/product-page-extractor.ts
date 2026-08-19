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

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedProductData {
  price: DataPoint<number>;
  currency: string | null;
  availability: DataPoint<'in_stock' | 'out_of_stock' | 'preorder'>;
  merchantName: DataPoint<string>;
  productName: DataPoint<string>;
  sourceUrl: string;
  extractionMethod: 'json_ld_product';
}

export interface PageFetcher {
  fetch(url: string, timeoutMs?: number): Promise<string | null>;
}

// ============================================================================
// FETCHER (real network call, isolated behind an interface for testability)
// ============================================================================

/**
 * Real HTTP fetcher. Never throws — any failure (network, timeout,
 * non-2xx, non-HTML) resolves to null so callers can degrade gracefully
 * without special-casing exceptions.
 */
export class HttpPageFetcher implements PageFetcher {
  async fetch(url: string, timeoutMs = 8000): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'CapucineBot/0.1 (+shopping research agent; respects robots.txt)',
          Accept: 'text/html',
        },
      });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) return null;
      return await res.text();
    } catch {
      // Network error, abort/timeout, or any other failure — never throw.
      return null;
    } finally {
      clearTimeout(timer);
    }
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

  return {
    price,
    currency,
    availability,
    merchantName,
    productName,
    sourceUrl,
    extractionMethod: 'json_ld_product',
  };
}

/**
 * Pure extraction from already-retrieved HTML. Exported separately from
 * the fetch step so it can be unit-tested with fixtures, with zero
 * network dependency.
 */
export function extractJsonLdProduct(html: string, sourceUrl: string): ExtractedProductData | null {
  const blocks = extractJsonLdBlocks(html);
  for (const block of blocks) {
    const product = findProductNode(block);
    if (product) return mapToExtractedData(product, sourceUrl);
  }
  return null;
}

// ============================================================================
// PUBLIC ENTRY POINT (fetch + extract)
// ============================================================================

export class ProductPageExtractor {
  constructor(private readonly fetcher: PageFetcher = new HttpPageFetcher()) {}

  /**
   * Fetches `url` and extracts structured Product/Offer data if present.
   * Returns null on ANY failure (network, timeout, no JSON-LD, no Product
   * node) — callers must treat null as "could not enrich", never as an error
   * to propagate, and must never fall back to inventing a value.
   */
  async extract(url: string, timeoutMs = 8000): Promise<ExtractedProductData | null> {
    const html = await this.fetcher.fetch(url, timeoutMs);
    if (html === null) return null;
    return extractJsonLdProduct(html, url);
  }
}
