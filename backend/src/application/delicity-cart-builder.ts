/**
 * CAPUCINE — Delicity cart builder
 *
 * Translates Capucine's generic cart lines (a product name + a quantity,
 * which is all the offers + cart model carries after discovery) into a
 * Delicity-specific cart against a fetched menu.
 *
 * MATCHING IS HONEST:
 * - Names are compared accent-insensitively (NFD + combining-mark removal):
 *   a menu "Poké Bowl" matches the typed "poke bowl". This is the only
 *   fuzziness allowed — a typo'd keyword does not silently match.
 * - A line that matches NO menu item is reported in `unmatchedLines`, never
 *   guessed into the closest-looking item.
 * - `totalEstimate` only sums matched items. An unknown price is never an
 *   economy and never a zero (RULE 3 spirit: coût inconnu ≠ 0).
 *
 * `deepLinkUrl` is best-effort display metadata (a `?items=` construction we
 * have NOT verified the merchant's ordering page reads). It is never used as
 * a hand-over URL — see delicity-merchant-adapter.ts, which only ever hands
 * the real `restaurantPageUrl`.
 */

import type { FulfillmentMode, MerchantMenu } from '../domain/merchant-types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A line of Capucine's generic cart model as far as Delicity can read it:
 * the human-readable product name and how many the user wants. Maps onto the
 * offer's `characteristics.title` / `product.name` + `quantity`.
 */
export interface DelicityCartLine {
  name: string;
  quantity: number;
}

export interface DelicityCartItem {
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
}

export interface DelicityCart {
  restaurantUrl: string;
  fulfillmentMode: FulfillmentMode;
  items: DelicityCartItem[];
  /** Sum of matched lines only (unitPrice × quantity), in EUR. */
  totalEstimate: number;
  /** Best-effort display deep link. NOT a verified checkout URL. */
  deepLinkUrl: string;
  /** Input lines that matched nothing. Never silently dropped. */
  unmatchedLines: Array<{ name: string; quantity: number }>;
}

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

/**
 * Accent-insensitive lowercase form used for matching only — the display
 * names always keep their original typography.
 */
export function normalizeMenuText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .trim();
}

// ============================================================================
// BUILDER
// ============================================================================

/**
 * Resolve the requested fulfillment mode against what the menu actually
 * declares, with an allow-path: an unsupported mode falls back to the
 * supported one instead of erroring (the restaurant stays reachable).
 */
export function resolveFulfillmentMode(requested: FulfillmentMode, menu: MerchantMenu): FulfillmentMode {
  if (requested === 'both') {
    return 'both';
  }
  if (requested === 'delivery' && !menu.delivery && menu.takeaway) {
    return 'takeaway';
  }
  if (requested === 'takeaway' && !menu.takeaway && menu.delivery) {
    return 'delivery';
  }
  return requested;
}

function matchedCategoryAndItem(menu: MerchantMenu, rawName: string) {
  const wanted = normalizeMenuText(rawName);
  if (wanted.length === 0) {
    return undefined;
  }
  for (const category of menu.categories) {
    for (const item of category.items) {
      if (normalizeMenuText(item.name) === wanted) {
        return { category, item };
      }
    }
  }
  return undefined;
}

/**
 * Build the direct-order deep link. Only used for display; the ids are the
 * menu-relative `?items=` construction documented as unverified.
 */
export function buildItemsDeepLink(restaurantUrl: string, itemIds: string[]): string {
  if (itemIds.length === 0) {
    return restaurantUrl;
  }
  return `${restaurantUrl}${restaurantUrl.includes('?') ? '&' : '?'}items=${encodeURIComponent(itemIds.join(','))}`;
}

export function isValidLineQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity >= 1;
}

/**
 * Pure function: builds a Delicity cart from generic Capucine cart lines.
 * Never throws. A line with an unusable quantity or that matches nothing is
 * reported in `unmatchedLines`.
 */
export function buildDelicityCart(
  lines: DelicityCartLine[],
  menu: MerchantMenu,
  fulfillmentMode: FulfillmentMode,
): DelicityCart {
  const items: DelicityCartItem[] = [];
  const unmatchedLines: Array<{ name: string; quantity: number }> = [];

  for (const line of lines) {
    if (!isValidLineQuantity(line.quantity)) {
      unmatchedLines.push({ name: line.name, quantity: line.quantity });
      continue;
    }

    const found = matchedCategoryAndItem(menu, line.name);
    if (!found) {
      unmatchedLines.push({ name: line.name, quantity: line.quantity });
      continue;
    }

    items.push({
      menuItemId: found.item.id,
      menuItemName: found.item.name,
      quantity: line.quantity,
      unitPrice: found.item.price,
    });
  }

  const totalEstimate = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const resolvedMode = resolveFulfillmentMode(fulfillmentMode, menu);

  return {
    restaurantUrl: menu.restaurantPageUrl,
    fulfillmentMode: resolvedMode,
    items,
    totalEstimate,
    deepLinkUrl: buildItemsDeepLink(menu.restaurantPageUrl, items.map((item) => item.menuItemId)),
    unmatchedLines,
  };
}