/**
 * CAPUCINE — Delicity merchant adapter (execution layer)
 *
 * Integrates a Delicity restaurant into Capucine's cart preparation pipeline
 * by implementing the SAME `MerchantExecutionHandler` contract the repo's
 * cart-preparation-engine registers for the built-in capabilities
 * (web_redirect / oauth_redirect / merchant_api). A Delicity ordering page is
 * a hand-over: Capucine opens the restaurant's own page and the user pays
 * there — so this adapter is capability 'web_redirect', with merchant-level
 * guards applied on top:
 *
 *   CAN_HANDLE     → the merchant's id matches THIS restaurant's canonical
 *                    'delicity:<slug>' and the merchant declares web_redirect.
 *   CLOSED GUARD   → if the menu says the restaurant is closed, we do not
 *                    fabricate a link: we return 'unavailable' and, when a
 *                    reopening date exists, expose it through `reopensAt`.
 *   ITEM GUARD     → if a matching menu item is present but `available: false`
 *                    the item cannot be ordered: we decline instead of sending
 *                    the user to an order that cannot be placed.
 *   URL DISCIPLINE → the ONLY URL this adapter hands over is the menu's
 *                    `restaurantPageUrl` — the page Capucine actually fetched.
 *                    The cart builder's `?items=` deep link is display-only
 *                    and never lands in `checkoutUrl`.
 *
 * EXECUTION_INDEPENDENCE: anything this adapter decides changes nothing about
 * the offer's ranking.
 */

import { ExecutionCapabilityType, type Merchant } from '../domain/types';
import { deriveMerchantAvailability } from '../domain/merchant-types';
import type { MerchantMenu, MerchantAvailability } from '../domain/merchant-types';
import type { CartPreparationRequest, CartPreparationResult, MerchantExecutionHandler } from './cart-preparation-engine';
import { buildDelicityCart, isValidLineQuantity, type DelicityCartLine } from './delicity-cart-builder';

/**
 * Extract the human-readable product name a generic Capucine line maps onto:
 * the offer's `characteristics.title` when present, else its product id.
 * Returns '' when neither is usable — the item is then unmatched and the
 * adapter still redirects (web_redirect honest hand-over).
 */
function productTitle(request: CartPreparationRequest): string {
  const title = request.offer.characteristics?.title?.value;
  if (typeof title === 'string' && title.trim().length > 0) {
    return title;
  }
  return request.offer.productId ?? '';
}

export class DelicityMerchantAdapter implements MerchantExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'web_redirect';

  constructor(private readonly menu: MerchantMenu) {}

  /** Canonical merchant id of the bound restaurant, e.g. 'delicity:proteineeatbonnefoy'. */
  getMerchantId(): string {
    return this.menu.merchantId;
  }

  /** Availability of this restaurant as of the menu fetch. */
  getAvailability(): MerchantAvailability {
    return deriveMerchantAvailability(this.menu);
  }

  /** The only URL this adapter is willing to hand over. */
  getRestaurantPageUrl(): string {
    return this.menu.restaurantPageUrl;
  }

  canHandle(merchant: Merchant): boolean {
    if (!merchant.executionCapabilities.includes('web_redirect')) {
      return false;
    }
    return merchant.id === this.menu.merchantId;
  }

  async prepareCart(request: CartPreparationRequest): Promise<CartPreparationResult> {
    const availability = this.getAvailability();

    // CLOSED GUARD — 'unavailable' is the honest outcome: never a fabricated
    // link, and a reopening date is shown only when the menu carries one.
    if (availability !== 'open') {
      return {
        status: 'unavailable',
        checkoutUrl: this.menu.restaurantPageUrl,
        reopensAt: this.menu.reopensAt,
        nextAction:
          availability === 'closed_reopens_on'
            ? `Le restaurant est fermé jusqu'au ${this.menu.reopensAt}. Réessayez après cette date.`
            : 'Le restaurant est actuellement fermé. Capucine ne peut pas préparer la commande pour le moment.',
      };
    }

    const quantity = isValidLineQuantity(request.quantity) ? request.quantity : 1;
    const line: DelicityCartLine = { name: productTitle(request), quantity };
    const cart = buildDelicityCart([line], this.menu, this.fulfillmentModeFor(request));

    // ITEM GUARD — a menu item that exists but says "not available" is a
    // refusal, not a redirect pretending the order can go through.
    const matchedItem = cart.items[0];
    if (matchedItem && this.itemIsUnavailable(matchedItem.menuItemName)) {
      return {
        status: 'unavailable',
        nextAction: `L'article « ${matchedItem.menuItemName} » n'est pas disponible actuellement. Choisissez-le sur la page du restaurant.`,
      };
    }

    return {
      status: 'partial',
      checkoutUrl: this.menu.restaurantPageUrl,
      requiresMerchantAccount: true,
      nextAction:
        'Vous vous connecterez au compte du restaurant et confirmerez le paiement sur son site — Capucine ne prend jamais de paiement.',
    };
  }

  private itemIsUnavailable(itemName: string): boolean {
    for (const category of this.menu.categories) {
      for (const item of category.items) {
        if (item.name === itemName) {
          return item.available === false;
        }
      }
    }
    return false;
  }

  private fulfillmentModeFor(request: CartPreparationRequest) {
    // A shipping country implies delivery; otherwise takeaway is the default.
    return request.shippingCountry ? 'delivery' : 'takeaway';
  }
}