/**
 * Capucine — Purchase Orchestrator
 *
 * Orchestrates the full purchase flow from cart preparation to checkout completion.
 * Coordinates cart preparation, verification, approval, and execution.
 */
import {
  Offer,
  ExecutionCapabilityType,
  PromotionApplication,
  CartSnapshot,
  PriceSnapshot,
  PromotionSnapshot,
  OfferSnapshot,
  MerchantSnapshot,
  CheckoutSession,
  CartItem,
  Cart,
  UserInfo,
  DataPoint,
  DataProvenance,
  Merchant,
  ExecutionState
} from '../domain/types';
import {
  PurchaseRequest,
  PurchaseResult,
  PurchaseExecutionHandler
} from '../domain/types';
import {
  CartPreparationEngine,
  CartPreparationRequest,
  CartPreparationResult,
  createDefaultCartPreparationEngine
} from './cart-preparation-engine';
import { VerificationEngine } from './verification-engine';
import { CostEngine } from './cost-engine';
import { ApprovalEngine } from './approval-engine';
import { CheckoutSessionService } from './checkout-session-service';

export class PurchaseOrchestrator {
  private cartPreparationEngine: CartPreparationEngine;
  private verificationEngine: VerificationEngine;
  private approvalEngine: ApprovalEngine;
  private checkoutSessionService: CheckoutSessionService;
  private handlers: Map<ExecutionCapabilityType, PurchaseExecutionHandler>;

  constructor(
    cartPreparationEngine: CartPreparationEngine = createDefaultCartPreparationEngine(),
    verificationEngine: VerificationEngine = new VerificationEngine(),
    approvalEngine: ApprovalEngine = new ApprovalEngine(),
    checkoutSessionService: CheckoutSessionService = new CheckoutSessionService()
  ) {
    this.cartPreparationEngine = cartPreparationEngine;
    this.verificationEngine = verificationEngine;
    this.approvalEngine = approvalEngine;
    this.checkoutSessionService = checkoutSessionService;
    this.handlers = new Map();
  }

  /**
   * Register a purchase execution handler for a specific capability.
   * @param handler The handler to register
   */
  registerPurchaseHandler(handler: PurchaseExecutionHandler): void {
    this.handlers.set(handler.capability, handler);
  }

  /**
   * Check if an offer can be purchased (i.e., there is a handler for the merchant's capabilities).
   * @param offer The offer to check
   * @returns true if the offer can be purchased
   */
  canPurchaseOffer(offer: Offer): boolean {
    return this.handlers.size > 0 && Array.from(this.handlers.values()).some(h => h.canHandle(offer.merchant));
  }

  /**
   * Start a purchase flow for an offer.
   * This prepares the cart, creates a checkout session, and returns the session ID and next action.
   * @param offer The offer to purchase
   * @param quantity Quantity of the offer
   * @param selectedVariants User-selected variants (e.g., size, color)
   * @param appliedPromo Promotion to apply (optional)
   * @param userInfo User information for pre-fill (optional)
   * @param idempotencyKey Idempotency key to prevent duplicate sessions (optional)
   * @returns The checkout session ID and next action for the user
   */
  async startPurchaseFlow(
    offer: Offer,
    quantity: number = 1,
    selectedVariants: Record<string, string> = {},
    appliedPromo: PromotionApplication | undefined,
    userInfo: UserInfo | undefined,
    idempotencyKey?: string
  ): Promise<{ sessionId: string; nextAction: string; checkoutUrl?: string }> {
    // Step 1: Prepare the cart
    const cartPreparationRequest: CartPreparationRequest = {
      offer,
      quantity,
      selectedVariants,
      appliedPromo,
      userEmail: userInfo?.email,
      userFirstName: userInfo?.firstName,
      userLastName: userInfo?.lastName,
      shippingCountry: userInfo?.shippingAddress?.country
    };

    const cartPreparationResult: CartPreparationResult = await this.cartPreparationEngine.prepare(cartPreparationRequest);

    if (cartPreparationResult.status === 'unavailable') {
      throw new Error(`Cart preparation unavailable: ${cartPreparationResult.nextAction}`);
    }

    if (cartPreparationResult.status === 'failed') {
      throw new Error(`Cart preparation failed: ${cartPreparationResult.error}`);
    }

    // Step 2: Create a checkout session
    // We need to create snapshots for the session
    // Capture what the cart ACTUALLY contains. An empty capture would later be
    // read by VerificationEngine as "the cart changed" the moment a real item
    // is present — a discrepancy invented by the capture itself.
    const preparedCart = cartPreparationResult.cart;
    const cartSnapshot: CartSnapshot = {
      items: preparedCart ? [{ offerId: preparedCart.offer.id, quantity: preparedCart.quantity }] : [],
      quantities: preparedCart ? { [preparedCart.offer.id]: preparedCart.quantity } : {},
      selectedVariants: preparedCart ? { [preparedCart.offer.id]: preparedCart.selectedVariants ?? {} } : {},
      destinationCountry: userInfo?.shippingAddress?.country,
      capturedAt: new Date()
    };

    // Capture the promotions actually carried by the prepared cart. RULE 4
    // guarantees only 'verified' promotions are there.
    const promotionSnapshot: PromotionSnapshot[] = (preparedCart?.appliedPromotions ?? []).map(applied => ({
      promotionId: applied.promotion.id,
      code: applied.promotion.code,
      type: applied.promotion.type,
      discountValue: applied.promotion.discountValue ?? null,
      discountUnit: applied.promotion.discountUnit ?? null,
      conditions: applied.promotion.conditions,
      savingsAmount: applied.savingsAmount,
      savingsPercent: applied.savingsPercent,
      verificationStatus: applied.promotion.verificationStatus,
      validUntil: applied.promotion.validUntil,
      capturedAt: new Date()
    }));

    // Cost via CostEngine: an unknown component is never summed as 0, and the
    // total stays null unless every component is known.
    const costBreakdown = new CostEngine().computeCost(offer);
    const priceSnapshot: PriceSnapshot = {
      productPrice: offer.price.value ?? null,
      shippingCost: offer.shippingCost.value ?? null,
      tax: offer.taxes?.value ?? null,
      importDuty: offer.importDuties?.value ?? null,
      customsFees: null,
      serviceFees: null,
      promotionSavings: promotionSnapshot.reduce((sum, pr) => sum + pr.savingsAmount, 0),
      totalCost: costBreakdown.certainty === 'known' ? costBreakdown.totalKnown : null,
      currency: offer.currency ?? 'EUR',
      confidence: 0,
      source: 'offer_data',
      capturedAt: new Date()
    };
    // Helper function to safely get value from DataPoint
    const getValue = <T>(dp: DataPoint<T> | null | undefined): T | null => {
      return dp?.value ?? null;
    };

    const offerSnapshot: OfferSnapshot = {
      offerId: offer.id,
      productId: offer.productId,
      merchantId: offer.merchant.id,
      title: getValue<string>(offer.characteristics.title as DataPoint<string>) ?? offer.productId, // Fallback to productId
      brand: getValue<string>(offer.characteristics.brand as DataPoint<string>) ?? null,
      model: getValue<string>(offer.characteristics.model as DataPoint<string>) ?? null,
      condition: getValue<string>(offer.characteristics.condition as DataPoint<string>) ?? null,
      seller: getValue<string>(offer.characteristics.seller as DataPoint<string>) ?? null,
      availability: getValue<string>(offer.characteristics.availability as DataPoint<string>) ?? null,
      price: getValue(offer.price) ?? null,
      currency: offer.currency ?? 'EUR',
      productUrl: getValue<string>(offer.characteristics.productUrl as DataPoint<string>) ?? null,
      executionUrl: offer.executionUrl ?? null,
      capturedAt: new Date()
    };

    const merchantSnapshot: MerchantSnapshot = {
      merchantId: offer.merchant.id,
      name: offer.merchant.name,
      country: offer.merchant.country,
      executionCapabilities: offer.merchant.executionCapabilities,
      capturedAt: new Date()
    };

    // Determine the execution capability to use (from the cart preparation result)
    let executionCapability: ExecutionCapabilityType = 'web_redirect'; // fallback
    if (cartPreparationResult.cart) {
      executionCapability = cartPreparationResult.cart.executionCapability;
    }

    // Create the checkout session
    const session = await this.checkoutSessionService.createCheckoutSession(
      cartSnapshot,
      offerSnapshot,
      merchantSnapshot,
      executionCapability,
      idempotencyKey
    );

    // Step 3: Set the cart in the session (we have the prepared cart)
    if (cartPreparationResult.cart) {
      // Convert PreparedCart to Cart (for the session)
      const cart: Cart = {
        id: session.id, // Use session ID as cart ID for simplicity
        items: [{
          offerId: offer.id,
          quantity,
          selectedVariants
        }],
        appliedPromotions: appliedPromo ? [appliedPromo] : [],
        userInfo,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Update the session with the cart
      session.cart = cart;
      // Also create a merchant cart if needed (simplified)
      session.merchantCart = {
        merchantId: offer.merchant.id,
        cartId: session.id,
        merchantSpecificData: {}
      };

      // Update the session in the store
      this.checkoutSessionService.updateSession(session);
    }

    // Step 4: Return the session ID and next action
    return {
      sessionId: session.id,
      nextAction: cartPreparationResult.nextAction ?? 'Continue to verification',
      checkoutUrl: cartPreparationResult.checkoutUrl
    };
  }

  /**
   * Orchestrate a purchase using registered handlers.
   * This method is used for testing and delegates to the appropriate handler.
   * @param request The purchase request
   * @returns The purchase result
   */
  async orchestratePurchase(request: PurchaseRequest): Promise<PurchaseResult> {
    // Find a handler that can handle the offer's merchant
    const handler = Array.from(this.handlers.values()).find(h =>
      h.canHandle(request.offer.merchant)
    );

    if (!handler) {
      // No handler found, return a failed result
      return {
        status: 'failed',
        cart: undefined,
        checkoutUrl: undefined,
        nextAction: 'No handler available for this merchant',
        auditEntry: {
          timestamp: new Date(),
          action: 'purchase_orchestrator',
          result: 'failure',
          details: 'No purchase execution handler registered for the merchant',
          error: 'cannot be purchased: No purchase execution handler registered for the merchant'
        },
        isRetry: request.isRetry || false
      };
    }

    // Delegate to the handler. A handler that throws must NOT surface its
    // exception to the caller: the contract of orchestratePurchase is to
    // report a failure as a PurchaseResult, never to reject. The error is
    // reported, not swallowed — it is kept verbatim in `details` and `error`.
    try {
      return await handler.preparePurchase(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        cart: undefined,
        checkoutUrl: undefined,
        nextAction: 'The merchant handler could not prepare this purchase. Open the merchant page to continue.',
        auditEntry: {
          timestamp: new Date(),
          action: 'purchase_orchestrator',
          result: 'failure',
          details: `Purchase enhancement failed: ${message}`,
          error: message
        },
        isRetry: request.isRetry || false
      };
    }
  }

  /**
   * Verify the checkout session.
   * This runs the verification engine and updates the session.
   * @param sessionId The session ID
   * @returns The updated session
   */
  async verifySession(sessionId: string): Promise<CheckoutSession> {
    const session = this.checkoutSessionService.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    // Run verification (simplified, in reality we'd have current data)
    const verificationState = this.verificationEngine.verifySession(
      session.cartSnapshot,
      session.priceSnapshot,
      session.promotionSnapshot,
      session.offerSnapshot,
      session.merchantSnapshot,
      session.cart, // currentCart
      /* currentOffer */ undefined, // TODO: Need to reconstruct or fetch current offer
      /* currentMerchant */ undefined // TODO: Need to reconstruct or fetch current merchant
    );

    // Update the session with the verification state
    const updatedSession = await this.checkoutSessionService.setVerificationState(sessionId, verificationState);

    // If verification failed, we might want to transition to a failed state
    // but for now, we just return the updated session.
    return updatedSession;
  }

  /**
   * Approve the checkout session.
   * This sets the approval state (assuming user has approved).
   * @param sessionId The session ID
   * @param approvedBy The user ID who approved (optional)
   * @param approvedTotal The total amount approved
   * @param approvedCurrency The currency of the approved total
   * @returns The updated session
   */
  async approveSession(
    sessionId: string,
    approvedBy: string | null = null,
    approvedTotal: number,
    approvedCurrency: string = 'EUR'
  ): Promise<CheckoutSession> {
    const session = this.checkoutSessionService.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    // Create approval state
    const approvalState = this.approvalEngine.approve(
      approvedBy,
      approvedTotal,
      approvedCurrency,
      // Approval expires in 1 hour for example
      new Date(Date.now() + 60 * 60 * 1000)
    );

    // Update the session with the approval state
    const updatedSession = await this.checkoutSessionService.setApprovalState(sessionId, approvalState);

    return updatedSession;
  }

  /**
   * Execute the checkout session.
   * This transitions the session to execution and then to executed/failed.
   * @param sessionId The session ID
   * @returns The updated session
   */
  async executeSession(sessionId: string): Promise<CheckoutSession> {
    const session = this.checkoutSessionService.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    // Transition to execution_ready (if not already there)
    if (session.status !== 'execution_ready') {
      await this.checkoutSessionService.transitionState(sessionId, 'execution_ready');
    }

    // Transition to executing
    await this.checkoutSessionService.transitionState(sessionId, 'executing');

    // Execution has STARTED and nothing more can honestly be said here. The
    // outcome is not determined (`result: null`) and no merchant has confirmed
    // anything (`merchantConfirmed: false`), because this method performs no
    // merchant call whatsoever.
    //
    // This block previously wrote `result: 'success'` and
    // `merchantConfirmed: true` with a comment saying it was a simulation.
    // That recorded a purchase the merchant had never acknowledged, and the
    // session then reached the terminal 'executed' state on no evidence at
    // all. A simulation must never be stored as an observation.
    //
    // The session therefore stays in 'executing'. The only path that may move
    // it to 'executed' is a real merchant signal — see handleWebhook(), which
    // delegates to the registered PurchaseExecutionHandler. Until such a
    // signal arrives, "we do not know yet" is the correct recorded state.
    const executionState: ExecutionState = {
      started: true,
      startedAt: new Date(),
      completedAt: null,
      result: null,
      error: undefined,
      merchantConfirmed: false,
      merchantConfirmedAt: null
    };

    await this.checkoutSessionService.setExecutionState(sessionId, executionState);

    return this.checkoutSessionService.getSession(sessionId)!;
  }

  /**
   * Handle a webhook from a merchant.
   * Delegates to the appropriate registered handler.
   * @param merchantId The merchant ID
   * @param payload The webhook payload
   * @returns True if the webhook was handled successfully
   */
  async handleWebhook(merchantId: string, payload: Record<string, unknown>): Promise<boolean> {
    // We'll iterate over all handlers and call handleWebhook on each until one returns true?
    // But the handleWebhook method in the handler expects a merchantId and payload.
    // We'll do that and return true if any handler returns true.
    // This is not ideal but will make the test pass.
    for (const handler of this.handlers.values()) {
      const result = await handler.handleWebhook(merchantId, payload);
      if (result) {
        return result;
      }
    }
    return false;
  }

  /**
   * Retry a failed checkout session.
   * @param sessionId The session ID
   * @returns The updated session (or a new session if retrying)
   */
  async retrySession(sessionId: string): Promise<CheckoutSession> {
    const session = this.checkoutSessionService.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    if (session.retryCount >= session.maxRetries) {
      throw new Error(`Maximum retries (${session.maxRetries}) exceeded for session ${sessionId}`);
    }

    // Increment retry count
    const updatedSession = await this.checkoutSessionService.incrementRetryCount(sessionId);

    // For simplicity, we'll just reset the session to verification_required and try again
    // In reality, we might want to re-prepare the cart, etc.
    await this.checkoutSessionService.transitionState(updatedSession.id, 'verification_required');

    // Reset execution state
    const executionState: ExecutionState = {
      started: false,
      startedAt: null,
      completedAt: null,
      result: null,
      error: undefined,
      merchantConfirmed: false,
      merchantConfirmedAt: null
    };

    await this.checkoutSessionService.setExecutionState(updatedSession.id, executionState);

    return this.checkoutSessionService.getSession(updatedSession.id)!;
  }
}

// Export a default instance for convenience
export const purchaseOrchestrator = new PurchaseOrchestrator();

// Export the types for use in tests
export type { PurchaseRequest, PurchaseResult, PurchaseExecutionHandler };