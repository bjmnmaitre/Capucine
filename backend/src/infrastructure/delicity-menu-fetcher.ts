/**
 * CAPUCINE — Delicity menu fetcher (infrastructure)
 *
 * Fetches and parses a Delicity restaurant's menu into the domain
 * `MerchantMenu` model. Strategy, in order:
 *
 *   1. API (preferred): GET https://api.delicity.com/v1/restaurant/<slug>
 *      The real public API's exact shape is not documented for us, so this
 *      module documents the assumed JSON schema explicitly (see
 *      `DelicityApiRestaurant`) and guards every field. The attempt itself is
 *      honest: if the endpoint answers with JSON it is parsed; anything else
 *      falls through to the HTML path.
 *   2. HTML fallback: fetch the restaurant's ordering page and look for
 *      JSON-LD (a Menu node, or a Restaurant node carrying `hasMenu`).
 *   3. If nothing parses, `fetchMenu` returns `null` — it NEVER throws.
 *
 * The returned `restaurantPageUrl` is always the URL that was actually
 * fetched: the hand-over URL Capucine can stand behind.
 *
 * ALL NETWORK FAILURES ARE SILENT NULLS. A fetch, a timeout, a 500, a
 * corrupted JSON body — each one yields `null`, never an exception. The
 * caller treats `null` as "no verified menu for now" ('unavailable'), which
 * is the honest Capucine outcome rather than a guessed menu.
 */

import { parse } from 'node-html-parser';
import { validateMerchantMenu, type MenuCategory, type MenuItem, type MerchantMenu } from '../domain/merchant-types';

export const DELICITY_API_BASE = 'https://api.delicity.com/v1/restaurant';
export const DEFAULT_TIMEOUT_MS = 8000;

export interface IDelicityMenuFetcher {
  /** Returns a validated menu, or null when nothing could be fetched/parsed. */
  fetchMenu(restaurantUrl: string): Promise<MerchantMenu | null>;
}

export interface DelicityFetcherOptions {
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

/**
 * Assumed public API schema (documented as assumption — the real payload may
 * differ; every field is guarded so a surprising payload degrades to a
 * skipped item / a null menu, never to invented data).
 */
interface DelicityApiRestaurant {
  slug?: unknown;
  name?: unknown;
  address?: unknown;
  isOpen?: unknown;
  reopensAt?: unknown;
  takeaway?: unknown;
  delivery?: unknown;
  categories?: unknown;
}

interface DelicityApiCategory {
  name?: unknown;
  items?: unknown;
}

interface DelicityApiItem {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  available?: unknown;
}

// ============================================================================
// FETCHER
// ============================================================================

export class DelicityMenuFetcher implements IDelicityMenuFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: DelicityFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? 'Capucine/1.0 (menu fetcher)';
  }

  async fetchMenu(restaurantUrl: string): Promise<MerchantMenu | null> {
    const slug = extractSlug(restaurantUrl);
    if (!slug) {
      return null;
    }

    // 1. API preferred.
    const apiMenu = await this.fetchFromApi(slug, restaurantUrl);
    if (apiMenu) {
      return apiMenu;
    }

    // 2. HTML / JSON-LD fallback, on the page the user would actually open.
    const htmlMenu = await this.fetchFromHtml(restaurantUrl, slug);
    if (htmlMenu) {
      return htmlMenu;
    }

    // 3. Nothing verified.
    return null;
  }

  private async fetchFromApi(slug: string, restaurantUrl: string): Promise<MerchantMenu | null> {
    const url = `${DELICITY_API_BASE}/${slug}`;
    const body = await this.requestText(url, { accept: 'application/json' });
    if (body === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    return this.buildMenuFromApi(parsed, slug, restaurantUrl);
  }

  private async fetchFromHtml(restaurantUrl: string, slug: string): Promise<MerchantMenu | null> {
    const html = await this.requestText(restaurantUrl, { accept: 'text/html' });
    if (html === null) {
      return null;
    }
    return this.buildMenuFromHtml(html, slug, restaurantUrl);
  }

  /** Never throws: every failure mode returns null. */
  private async requestText(url: string, headers: Record<string, string>): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent, ...headers },
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      const text = await response.text();
      return text && text.trim().length > 0 ? text : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ============================================================================
  // PARSING (API JSON)
  // ============================================================================

  private buildMenuFromApi(parsed: unknown, slug: string, restaurantUrl: string): MerchantMenu | null {
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const raw = parsed as DelicityApiRestaurant;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
    if (!name) {
      return null;
    }

    const categories = this.parseApiCategories(raw.categories, slug);
    const menu: MerchantMenu = {
      merchantId: `delicity:${slug}`,
      restaurantName: name,
      restaurantPageUrl: restaurantUrl,
      address: typeof raw.address === 'string' ? raw.address : '',
      currency: 'EUR',
      isOpen: raw.isOpen !== false,
      takeaway: raw.takeaway !== false,
      delivery: raw.delivery !== false,
      categories,
      lastUpdatedAt: new Date().toISOString(),
    };
    if (typeof raw.reopensAt === 'string' && raw.reopensAt.trim().length > 0) {
      menu.reopensAt = raw.reopensAt;
    }

    return validateMerchantMenu(menu).length === 0 ? menu : null;
  }

  private parseApiCategories(value: unknown, slug: string): MenuCategory[] {
    const categories: MenuCategory[] = [];
    if (!Array.isArray(value)) {
      return categories;
    }
    value.forEach((entry, categoryIndex) => {
      const cat = entry as DelicityApiCategory;
      if (typeof cat.name !== 'string' || cat.name.trim().length === 0) {
        return; // allow-path: skip one malformed category, keep the rest
      }
      const items = this.parseApiItems(cat.items, slug, categoryIndex);
      if (items.length > 0) {
        categories.push({
          id: `${slug}-cat-${categoryIndex}`,
          name: cat.name.trim(),
          items,
        });
      }
    });
    return categories;
  }

  private parseApiItems(value: unknown, slug: string, categoryIndex: number): MenuItem[] {
    const items: MenuItem[] = [];
    if (!Array.isArray(value)) {
      return items;
    }
    value.forEach((entry, itemIndex) => {
      const item = entry as DelicityApiItem;
      const name = typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : null;
      const price = typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 ? item.price : null;
      if (!name || price === null) {
        return; // allow-path: never invent a name or a price for a broken entry
      }
      items.push({
        id: `${slug}-cat-${categoryIndex}-item-${itemIndex}`,
        name,
        description: typeof item.description === 'string' ? item.description : undefined,
        price,
        available: typeof item.available === 'boolean' ? item.available : undefined,
      });
    });
    return items;
  }

  // ============================================================================
  // PARSING (HTML / JSON-LD)
  // ============================================================================

  private buildMenuFromHtml(html: string, slug: string, restaurantUrl: string): MerchantMenu | null {
    const jsonLd = this.extractJsonLdNodes(html);
    for (const node of jsonLd) {
      const menu = this.buildMenuFromJsonLd(node, slug, restaurantUrl);
      if (menu) {
        return menu;
      }
    }
    return null;
  }

  private extractJsonLdNodes(html: string): unknown[] {
    const nodes: unknown[] = [];
    try {
      const root = parse(html);
      const scriptTags = root.querySelectorAll('script[type="application/ld+json"]');
      for (const tag of scriptTags) {
        const text = tag.textContent;
        if (!text) {
          continue;
        }
        try {
          const value = JSON.parse(text);
          if (Array.isArray(value)) {
            nodes.push(...value);
          } else if (value && typeof value === 'object') {
            nodes.push(value);
          }
        } catch {
          // allow-path: ignore one corrupt JSON-LD block, keep scanning
        }
      }
    } catch {
      // HTML parse failure: we simply have no JSON-LD to work with.
    }
    return nodes;
  }

  private buildMenuFromJsonLd(node: unknown, slug: string, restaurantUrl: string): MerchantMenu | null {
    const obj = node as Record<string, unknown>;
    const type = Array.isArray(obj['@type']) ? obj['@type'][0] : obj['@type'];

    // A Restaurant node may carry the menu under `hasMenu`.
    if (type === 'Restaurant') {
      const subMenu = obj['hasMenu'];
      if (subMenu) {
        return this.buildMenuFromJsonLd(subMenu, slug, restaurantUrl);
      }
      return null;
    }

    if (type !== 'Menu') {
      return null;
    }

    const name =
      typeof obj['name'] === 'string' && obj['name'].trim().length > 0
        ? obj['name'].trim()
        : null;
    if (!name) {
      return null;
    }

    const sections = Array.isArray(obj['hasMenuSection']) ? obj['hasMenuSection'] : [];
    const categories: MenuCategory[] = [];
    sections.forEach((sectionValue, categoryIndex) => {
      const section = sectionValue as Record<string, unknown>;
      const sectionName =
        typeof section['name'] === 'string' && section['name'].trim().length > 0
          ? section['name'].trim()
          : null;
      const itemValues = Array.isArray(section['hasMenuItem']) ? section['hasMenuItem'] : [];
      const items: MenuItem[] = [];
      itemValues.forEach((itemValue, itemIndex) => {
        const item = itemValue as Record<string, unknown>;
        const itemName =
          typeof item['name'] === 'string' && item['name'].trim().length > 0 ? item['name'].trim() : null;
        const price = this.jsonLdPrice(item['offers']);
        if (!itemName || price === null) {
          return;
        }
        items.push({
          id: `${slug}-cat-${categoryIndex}-item-${itemIndex}`,
          name: itemName,
          description: typeof item['description'] === 'string' ? item['description'] : undefined,
          price,
        });
      });
      if (sectionName && items.length > 0) {
        categories.push({ id: `${slug}-cat-${categoryIndex}`, name: sectionName, items });
      }
    });

    if (categories.length === 0) {
      return null;
    }

    const menu: MerchantMenu = {
      merchantId: `delicity:${slug}`,
      restaurantName: name,
      restaurantPageUrl: restaurantUrl,
      address: '',
      currency: 'EUR',
      isOpen: true, // a reachable, parsed menu implies the page is live
      takeaway: true,
      delivery: false, // HTML alone does not prove delivery is offered
      categories,
      lastUpdatedAt: new Date().toISOString(),
    };

    return validateMerchantMenu(menu).length === 0 ? menu : null;
  }

  private jsonLdPrice(offers: unknown): number | null {
    const offer = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown> | undefined;
    if (!offer || typeof offer !== 'object') {
      return null;
    }
    const priceSpec = offer['priceSpecification'];
    if (priceSpec && typeof priceSpec === 'object') {
      const p = (priceSpec as Record<string, unknown>)['price'];
      if (typeof p === 'number' && Number.isFinite(p) && p >= 0) {
        return p;
      }
    }
    const p = offer['price'];
    if (typeof p === 'number' && Number.isFinite(p) && p >= 0) {
      return p;
    }
    return null;
  }
}

// ============================================================================
// SLUG EXTRACTION
// ============================================================================

/**
 * Derive the Delicity slug from a restaurant URL: the first label of the
 * hostname (with 'www.' stripped). 'https://proteineeatbonnefoy.com/order'
 * → 'proteineeatbonnefoy'. Returns null for anything unparseable so the
 * caller can back off to 'unavailable' instead of guessing.
 */
export function extractSlug(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const withoutWww = host.startsWith('www.') ? host.slice(4) : host;
  const label = withoutWww.split('.')[0];
  if (!label || !/^[a-z0-9-]+$/i.test(label)) {
    return null;
  }
  return label;
}

export function merchantIdFor(slug: string): string {
  return `delicity:${slug}`;
}