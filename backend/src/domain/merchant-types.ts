/**
 * CAPUCINE — Delicity merchant domain types
 *
 * Self-contained typing contract for one Capucine merchant ("delicity:*").
 * Shared by the menu fetcher (infrastructure), the cart builder and the
 * execution adapter (application). Nothing here touches the rest of the
 * domain on purpose: Capucine keeps its merchant bindings as a thin, testable
 * slice rather than letting merchant-specific concerns leak into the core
 * (MERCHANT_INDEPENDENCE in domain/types.ts).
 *
 * INVARIANT: `price` is the merchant's own menu price in euros (decimal).
 * A missing price is a malformed item, never a zero — the fetcher skips it.
 * `isOpen` is a fact about the restaurant, not a ranking input.
 */

export type FulfillmentMode = 'takeaway' | 'delivery' | 'both';

/**
 * Light availability classification, derived from a fetched menu.
 * - 'open'              — the restaurant is taking orders now.
 * - 'closed_unknown'    — closed, and no reopening date is known (we decline
 *   to guess: an invented reopening date would violate DATA_DISCIPLINE).
 * - 'closed_reopens_on' — closed, with a `reopensAt` date we can show.
 */
export type MerchantAvailability = 'open' | 'closed_unknown' | 'closed_reopens_on';

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  /** Menu price in EUR, decimal (e.g. 12.5). MUST be a finite number >= 0. */
  price: number;
  /**
   * Capability guard: when present and false, the item cannot be ordered even
   * though it is on the menu (out of stock, temporarily removed).
   */
  available?: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface MerchantMenu {
  /** Canonical merchant id, e.g. 'delicity:proteineeatbonnefoy'. */
  merchantId: string;
  restaurantName: string;
  /**
   * The restaurant's own ordering page. This is the ONLY acceptable
   * hand-over URL: it is the page actually fetched, never synthesized.
   */
  restaurantPageUrl: string;
  address: string;
  currency: 'EUR';
  isOpen: boolean;
  /** ISO date of the scheduled reopening. Only meaningful when !isOpen. */
  reopensAt?: string;
  takeaway: boolean;
  delivery: boolean;
  categories: MenuCategory[];
  lastUpdatedAt?: string;
}

// ============================================================================
// PURE HELPERS
// ============================================================================

/**
 * Classify a menu's availability. Closed + reopensAt → 'closed_reopens_on';
 * closed without a date → 'closed_unknown' (the allow-path: we never invent a
 * date to make a 'closed_*' answer look more certain).
 */
export function deriveMerchantAvailability(menu: MerchantMenu): MerchantAvailability {
  if (menu.isOpen) {
    return 'open';
  }
  if (typeof menu.reopensAt === 'string' && menu.reopensAt.trim().length > 0) {
    return 'closed_reopens_on';
  }
  return 'closed_unknown';
}

/**
 * Guard-rail validation. Returns every problem found; an empty array IS the
 * happy path — validation never throws and never blocks on its own. The
 * fetcher runs this before handing a menu to the rest of the pipeline so a
 * malformed blob cannot silently reach the user.
 */
export function validateMerchantMenu(menu: MerchantMenu): string[] {
  const errors: string[] = [];

  if (typeof menu.merchantId !== 'string' || menu.merchantId.trim().length === 0) {
    errors.push('merchantId must not be empty');
  }
  if (typeof menu.restaurantName !== 'string' || menu.restaurantName.trim().length === 0) {
    errors.push('restaurantName must not be empty');
  }
  if (menu.currency !== 'EUR') {
    errors.push('currency must be EUR');
  }
  if (!menu.takeaway && !menu.delivery) {
    errors.push('at least one fulfillment mode (takeaway or delivery) must be available');
  }
  if (!Array.isArray(menu.categories) || menu.categories.length === 0) {
    errors.push('menu must contain at least one category');
  }

  for (const category of menu.categories ?? []) {
    if (typeof category.name !== 'string' || category.name.trim().length === 0) {
      errors.push('a category has an empty name');
    }
    if (!Array.isArray(category.items) || category.items.length === 0) {
      errors.push(`category "${category.name ?? '<unnamed>'}" has no items`);
    }
    for (const item of category.items ?? []) {
      if (typeof item.name !== 'string' || item.name.trim().length === 0) {
        errors.push('an item has an empty name');
      }
      if (!Number.isFinite(item.price) || item.price < 0) {
        errors.push(`item "${typeof item.name === 'string' ? item.name : '<unnamed>'}" has an invalid price`);
      }
    }
  }

  return errors;
}