/**
 * Capucine — Purchase Orchestrator
 *
 * Orchestrates the full purchase flow from cart preparation to checkout completion.
 * Coordinates with cart preparation engine, promotion engine, and execution handlers.
 *
 * INVARIANTS:
 * 1. Capucine NEVER takes payment directly — only prepares the cart and facilitates
 *    the transition to merchant checkout
 * 2. User must validate and complete payment on merchant's secure checkout
 * 3. Purchase orchestration is separate from ranking (EXECUTION_INDEPENDENCE)
 * 4. All sensitive data stays with merchant (not through Capucine)
 * 5. Purchase state is tracked for auditing and retry
 * 6. User data is only used for pre-fill and never stored by Capucine
 */

import { Offer, Merchant, ExecutionCapabilityType, CartItem, Cart, UserInfo, PromotionApplication, CheckoutSession, CheckoutStatus, AuditEntry, CartPreparedStatus, MerchantCart } from '../domain/types';
import { CartPreparationEngine, CartPreparationRequest, CartPreparationResult, PreparedCart } from './cart-preparation-engine';
import { PromotionEngine } from './promotion-engine';

/**
 * Handler for executing purchase orchestration with specific capabilities.
 * Extends merchant execution with purchase-specific functionality.
 */
export interface PurchaseExecutionHandler {
  capability: ExecutionCapabilityType;

  canHandle(merchant: Merchant): boolean;

  /**
   * Prepare a cart for purchase and return session information.
   * @param request Contains offer, quantity, variants, promotions, and user info
   * @returns Purchase preparation result with session info
   */
  preparePurchase(request: PurchaseRequest): Promise<PurchaseResult>;

  /**
   * Handle a webhook notification from a merchant about purchase completion.
   * @param merchantId The merchant sending the notification
   * @param payload The webhook payload
   * @returns Whether the webhook was processed successfully
   */
  handleWebhook?(merchantId: string, payload: Record<string, unknown>): Promise<boolean>;

  /**
   * Get the status of a purchase from the merchant system.
   * @param merchantId The merchant to query
   * @param merchantCartId The cart ID in the merchant's system
   * @returns Current purchase status
   */
  getPurchaseStatus?(merchantId: string, merchantCartId: string): Promise<PurchaseStatusResult>;
}

/**
 * Request for purchase preparation.
 */
export interface PurchaseRequest extends CartPreparationRequest {
  /** User information for pre-fill (not stored by Capucine) */
  userInfo?: UserInfo;
  /** Whether this is a retry attempt */
  isRetry?: boolean;
}

/**
 * Result of purchase preparation.
 */
export interface PurchaseResult {
  /** Status of the purchase preparation */
  status: PurchaseStatus;
  /** The cart being purchased */
  cart: Cart;
  /** Merchant-specific cart data (if applicable) */
  merchantCart?: MerchantCart;
  /** URL to complete purchase (when applicable) */
  checkoutUrl?: string;
  /** What the user should do next */
  nextAction?: string;
  /** Error message if preparation failed */
  error?: string;
  /** Audit trail entry for this action */
  auditEntry: AuditEntry;
  /** Whether this was a retry attempt */
  isRetry: boolean;
}

/**
 * Status of a purchase operation.
 */
export type PurchaseStatus =
  | 'initiated'        // Purchase process started
  | 'cart_prepared'    // Cart successfully prepared
  | 'redirecting'      // User being redirected to merchant
  | 'awaiting_payment' // Waiting for user to complete payment
  | 'completed'        // Purchase completed successfully
  | 'failed'           // Purchase failed
  | 'cancelled';       // User canceled the purchase

/**
 * Result of checking purchase status with a merchant.
 */
export interface PurchaseStatusResult {
  /** Current status of the purchase */
  status: PurchaseStatus;
  /** Additional details about the status */
  details?: string;
  /** Error if status check failed */
  error?: string;
}

/**
 * Main purchase orchestrator that coordinates the purchase flow.
 */
export class PurchaseOrchestrator {
  private cartPreparationEngine: CartPreparationEngine;
  private promotionEngine: PromotionEngine;
  private purchaseHandlers: Map<ExecutionCapabilityType, PurchaseExecutionHandler> = new Map();

  constructor(
    cartPreparationEngine: CartPreparationEngine,
    promotionEngine: PromotionEngine
  ) {
    this.cartPreparationEngine = cartPreparationEngine;
    this.promotionEngine = promotionEngine;
  }

  /**
   * Register a handler for a specific execution capability.
   */
  registerPurchaseHandler(handler: PurchaseExecutionHandler): void {
    this.purchaseHandlers.set(handler.capability, handler);
  }

  /**
   * Orchestrate the full purchase process for an offer.
   * Handles cart preparation, promotion application, and session setup.
   */
  async orchestratePurchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const startTime = Date.now();
    const auditEntry: AuditEntry = {
      timestamp: new Date(),
      action: 'purchase_orchestration_start',
      result: 'success', // Will be updated if fails
      details: `Starting purchase orchestration for offer ${request.offer.id}`
    };

    try {
      // Validate the offer can be purchased
      if (!this.canPurchaseOffer(request.offer)) {
        throw new Error(`Offer ${request.offer.id} cannot be purchased`);
      }

      // Prepare the cart using the cart preparation engine
      const cartPreparationRequest: CartPreparationRequest = {
        offer: request.offer,
        quantity: request.quantity,
        selectedVariants: request.selectedVariants,
        appliedPromo: request.appliedPromo,
        userEmail: request.userInfo?.email,
        userFirstName: request.userInfo?.firstName,
        userLastName: request.userInfo?.lastName,
        shippingCountry: request.userInfo?.shippingAddress?.country
      };

      const cartPreparationResult = await this.cartPreparationEngine.prepare(cartPreparationRequest);

      // Convert cart preparation result to purchase result
      const purchaseResult: PurchaseResult = {
        status: this.mapCartPreparationResultToPurchaseStatus(cartPreparationResult.status),
        cart: this.buildCartFromRequest(request, cartPreparationResult.cart!),
        merchantCart: undefined, // Will be filled by handlers that support it
        checkoutUrl: cartPreparationResult.checkoutUrl,
        nextAction: cartPreparationResult.nextAction,
        error: cartPreparationResult.error,
        auditEntry: {
          timestamp: new Date(),
          action: 'cart_preparation_completed',
          result: cartPreparationResult.status === 'success' || cartPreparationResult.status === 'partial' ? 'success' : 'failure',
          details: `Cart preparation resulted in status: ${cartPreparationResult.status}`,
          error: cartPreparationResult.error
        },
        isRetry: request.isRetry || false
      };

      // If cart preparation was successful, try to enhance with purchase-specific handlers
      if (purchaseResult.status === 'cart_prepared' || purchaseResult.status === 'redirecting') {
        try {
          const enhancedResult = await this.enhanceWithPurchaseHandler(request.offer.merchant, purchaseResult, request);
          if (enhancedResult) {
            return enhancedResult;
          }
        } catch (error) {
          // If enhancement fails, we still return the cart preparation result
          // but we update the audit trail to reflect that enhancement failed
          return {
            ...purchaseResult,
            auditEntry: {
              ...purchaseResult.auditEntry,
              result: 'failure',
              details: `${purchaseResult.auditEntry.details}; Purchase enhancement failed: ${error instanceof Error ? error.message : String(error)}`,
              error: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }

      return purchaseResult;
    } catch (error) {
      return {
        status: 'failed',
        cart: this.buildCartFromRequest(request, undefined), // Build minimal cart
        auditEntry: {
          timestamp: new Date(),
          action: 'purchase_orchestration_failed',
          result: 'failure',
          details: `Purchase orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error)
        },
        isRetry: request.isRetry || false
      };
    }
  }

  /**
   * Check if an offer can be purchased based on its execution capabilities.
   */
  canPurchaseOffer(offer: Offer): boolean {
    const merchant = offer.merchant;
    const capabilities = merchant.executionCapabilities || [];

    // Check if any registered handler can handle this merchant
    for (const [capability, handler] of this.purchaseHandlers) {
      if (capabilities.includes(capability) && handler.canHandle(merchant)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Enhance a purchase result with purchase-specific handler capabilities.
   * Returns the enhanced result if a handler succeeds.
   * Throws an error if all handlers fail.
   */
  private async enhanceWithPurchaseHandler(
    merchant: Merchant,
    purchaseResult: PurchaseResult,
    originalRequest: PurchaseRequest
  ): Promise<PurchaseResult> {
    const capabilities = merchant.executionCapabilities || [];

    // Try handlers in order of preference
    const preferredOrder: ExecutionCapabilityType[] = [
      'ucp',
      'merchant_api',
      'oauth_redirect',
      'web_redirect',
      'browser_automation'
    ];

    const errors: Error[] = [];

    for (const capability of preferredOrder) {
      if (capabilities.includes(capability)) {
        const handler = this.purchaseHandlers.get(capability);
        if (handler && handler.canHandle(merchant)) {
          try {
            // Attempt to enhance the purchase result using the original request
            const enhanced = await handler.preparePurchase(originalRequest);
            if (enhanced) {
              return enhanced;
            }
          } catch (error) {
            // Collect the error and continue to try other handlers
            errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }

    // If we get here, all handlers failed
    throw new Error(`All purchase handlers failed: ${errors.map(e => e.message).join('; ')}`);
  }

  /**
   * Map cart preparation result status to purchase status.
   */
  private mapCartPreparationResultToPurchaseStatus(cartStatus: CartPreparationResult['status']): PurchaseStatus {
    // First map cart preparation result status to internal cart prepared status
    let preparedStatus: CartPreparedStatus;
    switch (cartStatus) {
      case 'success':
        preparedStatus = 'prepared';
        break;
      case 'partial':
        preparedStatus = 'partially_prepared';
        break;
      case 'failed':
        preparedStatus = 'failed';
        break;
      case 'unavailable':
        preparedStatus = 'failed'; // Treat unavailable as failed for purchase purposes
        break;
      default:
        preparedStatus = 'pending';
    }

    // Then map to purchase status
    switch (preparedStatus) {
      case 'prepared':
        return 'cart_prepared';
      case 'partially_prepared':
        return 'redirecting'; // User needs to complete steps manually
      case 'failed':
        return 'failed';
      default:
        return 'initiated';
    }
  }

  /**
   * Build a cart from the purchase request and optional cart preparation result.
   */
  private buildCartFromRequest(request: PurchaseRequest, preparedCart: PreparedCart | undefined): Cart {
    // Build cart items from request
    const cartItems: CartItem[] = [{
      offerId: request.offer.id,
      quantity: request.quantity,
      selectedVariants: request.selectedVariants
    }];

    // Build cart
    return {
      id: preparedCart?.id ?? `cart-${request.offer.id}-${Date.now()}`,
      items: cartItems,
      appliedPromotions: request.appliedPromo ? [request.appliedPromo] : [],
      userInfo: request.userInfo,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Handle a webhook notification from a merchant.
   * Routes to the appropriate handler based on merchant capabilities.
   */
  async handleWebhook(merchantId: string, payload: Record<string, unknown>): Promise<boolean> {
    // In a real implementation, we'd look up the merchant to get its capabilities
    // For now, we'll try all handlers that support webhooks
    for (const [capability, handler] of this.purchaseHandlers) {
      if (handler.handleWebhook) {
        try {
          const result = await handler.handleWebhook(merchantId, payload);
          if (result) {
            return true;
          }
        } catch (error) {
          console.warn(`Webhook handler ${capability} failed:`, error);
        }
      }
    }
    return false;
  }

  /**
   * Get the status of a purchase from the merchant system.
   */
  async getPurchaseStatus(merchantId: string, merchantCartId: string): Promise<PurchaseStatusResult | undefined> {
    // In a real implementation, we'd look up the merchant to get its capabilities
    // For now, we'll try all handlers that support status checking
    for (const [capability, handler] of this.purchaseHandlers) {
      if (handler.getPurchaseStatus) {
        try {
          const result = await handler.getPurchaseStatus(merchantId, merchantCartId);
          if (result) {
            return result;
          }
        } catch (error) {
          console.warn(`Purchase status handler ${capability} failed:`, error);
        }
      }
    }
    return undefined;
  }
}

/**
 * Create a default purchase orchestrator with standard cart preparation engine.
 */
export function createDefaultPurchaseOrchestrator(): PurchaseOrchestrator {
  const cartPreparationEngine = /* import and create */ require('./cart-preparation-engine').createDefaultCartPreparationEngine();
  const promotionEngine = /* import and create */ require('./promotion-engine').createDefaultPromotionEngine();
  return new PurchaseOrchestrator(cartPreparationEngine, promotionEngine);
}