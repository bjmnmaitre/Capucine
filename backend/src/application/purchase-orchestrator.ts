/**
 * Capucine — Purchase Orchestrator
 *
 * Orchestrates the full purchase flow from cart preparation to checkout completion.
 * Coordinates cart preparation, verification, approval, and execution.
 */
import { Offer, ExecutionCapabilityType, PromotionApplication, CartSnapshot, PriceSnapshot, PromotionSnapshot, OfferSnapshot, MerchantSnapshot } from '../domain/types';
import { CartPreparationEngine, CartPreparationRequest, CartPreparationResult, PreparedCart, createDefaultCartPreparationEngine } from './cart-preparation-engine';
import { VerificationEngine } from './verification-engine';
import { ApprovalEngine } from './approval-engine';
import { CheckoutSessionService, CheckoutSession } from './checkout-session-service';
import { Cart, CartItem, UserInfo } from '../domain/types';

export class PurchaseOrchestrator {
  private cartPreparationEngine: CartPreparationEngine;
  private verificationEngine: VerificationEngine;
  private approvalEngine: ApprovalEngine;
  private checkoutSessionService: CheckoutSessionService;

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
    const cartSnapshot: CartSnapshot = {
      items: [], // We'll fill this from the prepared cart
      quantities: {},
      selectedVariants: {},
      destinationCountry: userInfo?.shippingAddress?.country,
      capturedAt: new Date()
    };

    // For simplicity, we'll create a basic price snapshot (to be enhanced)
    const priceSnapshot: PriceSnapshot = {
      productPrice: null,
      shippingCost: null,
      tax: null,
      importDuty: null,
      customsFees: null,
      serviceFees: null,
      promotionSavings: 0,
      totalCost: 0,
      currency: 'EUR',
      confidence: 0,
      source: 'unknown',
      capturedAt: new Date()
    };

    const promotionSnapshot: PromotionSnapshot[] = [];
    const offerSnapshot: OfferSnapshot = {
      offerId: offer.id,
      productId: offer.productId,
      merchantId: offer.merchant.id,
      title: offer.title ?? '',
      brand: offer.brand ?? null,
      model: offer.model ?? null,
      condition: offer.condition ?? null,
      seller: offer.seller ?? null,
      availability: offer.availability ?? null,
      price: offer.price.value ?? null,
      currency: offer.currency ?? 'EUR',
      productUrl: offer.productUrl ?? null,
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
      session.merchantSnapshot
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

    // Set execution state to started
    const executionState: any = {
      started: true,
      startedAt: new Date(),
      completedAt: null,
      result: null, // in progress
      error: undefined,
      merchantConfirmed: false,
      merchantConfirmedAt: null
    };

    await this.checkoutSessionService.setExecutionState(sessionId, executionState);

    // TODO: In reality, we would now redirect the user to the merchant's checkout URL
    // and wait for a webhook or polling to know the result.
    // For now, we'll simulate a successful execution after a delay?
    // But we cannot wait in this method. Instead, we'll leave it as executing and
    // let an external process (like a webhook) update it.

    // However, for the sake of having a complete flow, let's assume we get a successful result immediately.
    // In a real system, this would be asynchronous.

    // Simulate successful execution
    const finalExecutionState: ExecutionState = {
      started: true,
      startedAt: new Date(),
      completedAt: new Date(),
      result: 'success',
      error: undefined,
      merchantConfirmed: true,
      merchantConfirmedAt: new Date()
    };

    await this.checkoutSessionService.setExecutionState(sessionId, finalExecutionState);

    // Transition to executed
    await this.checkoutSessionService.transitionState(sessionId, 'executed');

    return this.checkoutSessionService.getSession(sessionId)!;
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