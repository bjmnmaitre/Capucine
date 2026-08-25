/**
 * Capucine — Cart Preparation Engine
 *
 * Prepares a shopping cart for an offer, coordinating merchant-specific execution.
 *
 * INVARIANTS:
 * 1. Capucine NEVER takes payment directly — only prepares the cart
 * 2. User must validate and complete payment on merchant's secure checkout
 * 3. Cart preparation is merchant-specific (UCP, API, OAuth, web redirect)
 * 4. All sensitive data stays with merchant (not through Capucine)
 * 5. Preparation state is tracked for auditing and retry
 *
 * Execution Capability Types:
 * - ucp: Universal Commerce Protocol (most integrated)
 * - merchant_api: Direct API to merchant's cart (e.g., Amazon, Fnac)
 * - oauth_redirect: OAuth flow with auto-fill (medium integration)
 * - web_redirect: Simple redirect with URL parameters (lightweight)
 * - browser_automation: Last resort (slow, unreliable)
 */

import { Offer, Merchant, ExecutionCapabilityType, PromotionApplication } from '../domain/types';

// ============================================================================
// CART STATE
// ============================================================================

export type CartPreparedStatus =
  | 'pending'           // Not started
  | 'preparing'         // In progress
  | 'prepared'          // Ready for merchant
  | 'partially_prepared' // Some fields filled, manual completion needed
  | 'failed'            // Preparation failed
  | 'user_action_required'; // Waiting for user (e.g., login)

/**
 * Represents a prepared shopping cart for a specific offer.
 * Does NOT contain payment info (stays with merchant).
 */
export interface PreparedCart {
  id: string;

  // What was prepared
  offer: Offer;
  quantity: number;
  selectedVariants?: Record<string, string>; // E.g., { size: '42', color: 'white' }

  // Promotions applied (if any)
  appliedPromotions?: PromotionApplication[];

  // User info (for pre-fill only, NOT stored by Capucine)
  userInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    shippingAddress?: {
      street?: string;
      city?: string;
      postalCode?: string;
      country?: string;
    };
  };

  // Merchant link to complete purchase
  merchantCheckoutUrl?: string;

  // Purchase tracking fields
  merchantCartId?: string; // ID of cart in merchant's system
  webhookUrl?: string; // URL for merchant to notify purchase completion
  purchaseTrackingUrl?: string; // URL user can visit to check purchase status
  expirationDate?: Date; // When the prepared cart expires

  // Execution details
  executionCapability: ExecutionCapabilityType;
  executionData?: Record<string, unknown>; // Merchant-specific parameters

  // Status
  status: CartPreparedStatus;
  error?: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  preparedAt?: Date;
}

// ============================================================================
// CART PREPARATION REQUEST
// ============================================================================

export interface CartPreparationRequest {
  offer: Offer;
  quantity: number;
  selectedVariants?: Record<string, string>;
  appliedPromo?: PromotionApplication;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
  shippingCountry?: string;
}

// ============================================================================
// CART PREPARATION RESULT
// ============================================================================

export interface CartPreparationResult {
  /**
   * 'success'     — cart fully prepared, checkoutUrl is a verified merchant URL.
   * 'partial'     — some steps prepared, user must finish manually.
   * 'unavailable' — nothing could be prepared for this offer (no usable
   *                 execution capability, or no verified purchase URL is
   *                 known). This is the `not_available` outcome: an honest
   *                 "Capucine cannot take you further", NEVER a fabricated
   *                 link. An offer being 'unavailable' here says nothing
   *                 about its ranking — see EXECUTION_INDEPENDENCE.
   * 'failed'      — preparation was attempted and errored.
   */
  status: 'success' | 'partial' | 'unavailable' | 'failed';
  cart?: PreparedCart;
  /**
   * A REAL merchant URL, taken verbatim from the offer's provenance-tracked
   * executionUrl. Never synthesized from a merchant id, never decorated with
   * parameters Capucine invented.
   */
  checkoutUrl?: string;
  nextAction?: string; // What user should do next
  error?: string;

  // Purchase tracking fields
  merchantCartId?: string; // Correlates with PreparedCart.merchantCartId
  webhookUrl?: string; // For merchant notifications
  purchaseInitiatedAt?: Date; // Timestamp when purchase process started
}

// ============================================================================
// MERCHANT EXECUTION HANDLER
// ============================================================================

/**
 * Handler for executing cart preparation with a specific merchant.
 */
export interface MerchantExecutionHandler {
  capability: ExecutionCapabilityType;

  canHandle(merchant: Merchant): boolean;

  prepareCart(request: CartPreparationRequest): Promise<CartPreparationResult>;
}

// ============================================================================
// CART PREPARATION ENGINE
// ============================================================================

export class CartPreparationEngine {
  private handlers: Map<ExecutionCapabilityType, MerchantExecutionHandler> = new Map();

  /**
   * Register a handler for a specific execution capability.
   */
  registerHandler(handler: MerchantExecutionHandler): void {
    this.handlers.set(handler.capability, handler);
  }

  /**
   * Prepare a cart for a given offer.
   * Selects the appropriate merchant handler based on execution capability.
   */
  async prepare(request: CartPreparationRequest): Promise<CartPreparationResult> {
    const offer = request.offer;
    const merchant = offer.merchant;

    // Select best handler
    const handler = this.selectHandler(merchant);

    if (!handler) {
      return {
        status: 'unavailable',
        nextAction:
          'No automated cart preparation is available for this merchant. ' +
          'Complete the purchase yourself on the merchant page shown with this offer.',
      };
    }

    try {
      return await handler.prepareCart(request);
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error during cart preparation',
      };
    }
  }

  /**
   * Select the best handler for a merchant.
   * Prefers more integrated capabilities (UCP > merchant_api > oauth_redirect > web_redirect).
   */
  private selectHandler(merchant: Merchant): MerchantExecutionHandler | null {
    const capabilities = merchant.executionCapabilities || [];

    // Order of preference
    const preferredOrder: ExecutionCapabilityType[] = [
      'ucp',
      'merchant_api',
      'oauth_redirect',
      'web_redirect',
      'browser_automation',
    ];

    for (const capability of preferredOrder) {
      if (capabilities.includes(capability)) {
        const handler = this.handlers.get(capability);
        if (handler?.canHandle(merchant)) {
          return handler;
        }
      }
    }

    return null;
  }

  /**
   * Check if a merchant can have cart preparation.
   */
  canPrepareCart(merchant: Merchant): boolean {
    return this.selectHandler(merchant) !== null;
  }

  /**
   * Get execution capabilities for a merchant (for UI display).
   */
  getExecutionCapabilities(merchant: Merchant): ExecutionCapabilityType[] {
    return merchant.executionCapabilities || [];
  }
}

// ============================================================================
// BUILT-IN HANDLERS
// ============================================================================

/**
 * Web Redirect Handler — Simple and universal.
 *
 * Hands the user the offer's REAL, provenance-tracked purchase URL.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ──────────────────────────────────
 * It does not synthesize a checkout URL from the merchant id (the old
 * `https://<merchant-id>.com/checkout?product_id=…` construction). Such a URL
 * is invented data: Capucine never verified that the host exists, that the
 * path is a checkout, or that the merchant reads those parameters. Handing a
 * user a fabricated link that merely *looks* authoritative is exactly the
 * failure DATA_DISCIPLINE forbids — an unknown purchase URL must stay
 * unknown ('unavailable'), never be guessed.
 *
 * It also does not append the user's email or name to the URL. Those
 * parameters were invented too (no merchant agreed to read them), and putting
 * personal data in a query string leaks it into browser history, referer
 * headers and server logs for no benefit.
 *
 * A promo code is reported as an instruction, not smuggled into the URL as a
 * `coupon` parameter Capucine has no evidence the merchant accepts.
 *
 * MERCHANT_INDEPENDENCE: this handler has no per-merchant table. It treats
 * every merchant that declares `web_redirect` identically.
 */
export class WebRedirectHandler implements MerchantExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'web_redirect';

  canHandle(merchant: Merchant): boolean {
    return merchant.executionCapabilities.includes('web_redirect');
  }

  async prepareCart(request: CartPreparationRequest): Promise<CartPreparationResult> {
    const offer = request.offer;
    const now = new Date();

    // The ONLY acceptable source of a purchase URL: the one carried by the
    // offer itself, set at discovery time from the page actually retrieved.
    const checkoutUrl = offer.executionUrl;

    if (!checkoutUrl) {
      return {
        status: 'unavailable',
        nextAction:
          'No verified purchase URL is known for this offer, so Capucine cannot ' +
          'take you to the merchant. Search this offer on the merchant site to continue.',
      };
    }

    const cart: PreparedCart = {
      id: `cart-${offer.id}`,
      offer,
      quantity: request.quantity,
      selectedVariants: request.selectedVariants,
      appliedPromotions: request.appliedPromo ? [request.appliedPromo] : [],
      merchantCheckoutUrl: checkoutUrl,
      // For web redirect, we don't have merchant cart ID or webhook URLs
      // since we're just redirecting to the merchant's page
      executionCapability: this.capability,
      // Status is 'partially_prepared', not 'prepared': a web redirect hands
      // over a page, it does not create a cart on the merchant's side. Saying
      // 'prepared' would overstate what actually happened.
      status: 'partially_prepared',
      createdAt: now,
      updatedAt: now,
      preparedAt: now,
    };

    const steps = [
      'Open the merchant page to complete your purchase.',
      request.quantity > 1 ? `Set the quantity to ${request.quantity}.` : null,
      request.appliedPromo
        ? `Enter the promo code ${request.appliedPromo.promotion.code} at checkout.`
        : null,
      'You will log in and confirm payment on the merchant site — Capucine never takes payment.',
    ].filter((step): step is string => step !== null);

    return {
      status: 'partial',
      cart,
      checkoutUrl,
      nextAction: steps.join(' '),
    };
  }
}

/**
 * OAuth Redirect Handler — NOT IMPLEMENTED (architectural stub).
 *
 * A real OAuth checkout needs three things Capucine does not have: an OAuth
 * client registered with each merchant, client credentials held in a secure
 * vault, and a callback endpoint. Until those exist this handler cannot
 * prepare anything.
 *
 * WHY canHandle() RETURNS FALSE
 * ─────────────────────────────
 * selectHandler() prefers oauth_redirect over web_redirect. If this stub
 * claimed the capability, an offer from a merchant that declares
 * `oauth_redirect` would be routed here and the user would receive a promise
 * with no URL — while WebRedirectHandler, sitting right behind it, could have
 * handed over the offer's real page. A stub must never claim a capability it
 * cannot honour: it declines, and selection falls through to something that
 * actually works.
 */
export class OAuthRedirectHandler implements MerchantExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'oauth_redirect';

  canHandle(_merchant: Merchant): boolean {
    return false;
  }

  async prepareCart(_request: CartPreparationRequest): Promise<CartPreparationResult> {
    return {
      status: 'unavailable',
      nextAction:
        'OAuth-based checkout is not available: Capucine has no OAuth client registered ' +
        'with this merchant.',
    };
  }
}

/**
 * Merchant API Handler — High integration.
 * Directly creates cart in merchant's system via API.
 */
export class MerchantAPIHandler implements MerchantExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'merchant_api';

  // This would need merchant API credentials (not stored here)
  canHandle(merchant: Merchant): boolean {
    // Only handle if we have API keys configured
    return (
      merchant.executionCapabilities.includes('merchant_api') &&
      this.hasAPICredentials(merchant)
    );
  }

  async prepareCart(_request: CartPreparationRequest): Promise<CartPreparationResult> {
    // Actual implementation would:
    // 1. Fetch API credentials for merchant from secure vault
    // 2. Call merchant's cart API to create cart
    // 3. Return cart ID and checkout URL
    //
    // Unreachable in practice: canHandle() already requires credentials that
    // no deployment currently provides. Kept explicit rather than throwing so
    // the outcome stays a described 'unavailable' rather than an error.
    return {
      status: 'unavailable',
      nextAction: 'Merchant API cart preparation is not implemented for this merchant.',
    };
  }

  private hasAPICredentials(merchant: Merchant): boolean {
    // Check if environment has API keys for this merchant
    const envKey = `${merchant.id.toUpperCase()}_API_KEY`;
    return Boolean(process.env[envKey]);
  }
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Create a default cart preparation engine with built-in handlers.
 */
export function createDefaultCartPreparationEngine(): CartPreparationEngine {
  const engine = new CartPreparationEngine();

  // Register handlers in order of preference
  engine.registerHandler(new MerchantAPIHandler());
  engine.registerHandler(new OAuthRedirectHandler());
  engine.registerHandler(new WebRedirectHandler());

  return engine;
}
