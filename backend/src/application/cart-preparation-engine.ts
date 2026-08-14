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

import { Offer, Merchant, ExecutionCapabilityType } from '../domain/types';
import { PromotionApplication } from './promotion-engine';

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

  // Promo applied (if any)
  appliedPromo?: PromotionApplication;

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
  status: 'success' | 'partial' | 'failed';
  cart?: PreparedCart;
  checkoutUrl?: string;
  nextAction?: string; // What user should do next
  error?: string;
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
        status: 'partial',
        nextAction:
          'Manual checkout required. No automatic cart integration available for this merchant. ' +
          'Redirect to merchant checkout page to complete your purchase.',
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
 * Constructs a merchant checkout URL with pre-filled parameters.
 */
export class WebRedirectHandler implements MerchantExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'web_redirect';

  canHandle(merchant: Merchant): boolean {
    return merchant.executionCapabilities.includes('web_redirect');
  }

  async prepareCart(request: CartPreparationRequest): Promise<CartPreparationResult> {
    const offer = request.offer;
    const merchant = offer.merchant;

    // Build checkout URL with pre-filled parameters
    const checkoutUrl = new URL(`https://${this.getMerchantDomain(merchant)}/checkout`);

    // Add product info
    checkoutUrl.searchParams.set('product_id', offer.productId);
    checkoutUrl.searchParams.set('quantity', String(request.quantity));

    // Add user info (for pre-fill)
    if (request.userEmail) {
      checkoutUrl.searchParams.set('email', request.userEmail);
    }
    if (request.userFirstName) {
      checkoutUrl.searchParams.set('first_name', request.userFirstName);
    }
    if (request.userLastName) {
      checkoutUrl.searchParams.set('last_name', request.userLastName);
    }
    if (request.shippingCountry) {
      checkoutUrl.searchParams.set('country', request.shippingCountry);
    }

    // Add promo code (if applicable)
    if (request.appliedPromo) {
      checkoutUrl.searchParams.set('coupon', request.appliedPromo.promotion.code);
    }

    return {
      status: 'partial',
      checkoutUrl: checkoutUrl.toString(),
      nextAction:
        'Click the checkout link to complete your purchase. ' +
        'You will need to log in to your merchant account and confirm payment.',
    };
  }

  private getMerchantDomain(merchant: Merchant): string {
    // Map merchant ID to domain
    const domains: Record<string, string> = {
      amazon: 'amazon.com',
      fnac: 'fnac.com',
      cdiscount: 'cdiscount.com',
    };

    return domains[merchant.id.toLowerCase()] || `${merchant.id.toLowerCase()}.com`;
  }
}

/**
 * OAuth Redirect Handler — Medium integration with auto-fill.
 * Initiates OAuth login and pre-fills cart on merchant's end.
 */
export class OAuthRedirectHandler implements MerchantExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'oauth_redirect';

  canHandle(merchant: Merchant): boolean {
    return merchant.executionCapabilities.includes('oauth_redirect');
  }

  async prepareCart(request: CartPreparationRequest): Promise<CartPreparationResult> {
    // OAuth would need:
    // 1. OAuth endpoint registration with merchant
    // 2. Client ID / Secret (stored securely, not in Capucine)
    // 3. Callback redirect after auth

    // For now, return partial — actual OAuth implementation requires merchant API keys
    return {
      status: 'partial',
      nextAction:
        'OAuth-based checkout: you will be redirected to log in to your merchant account. ' +
        'Once authenticated, your cart will be pre-filled automatically.',
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

    return {
      status: 'partial',
      nextAction: 'Merchant API preparation not yet implemented. Falling back to web redirect.',
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
