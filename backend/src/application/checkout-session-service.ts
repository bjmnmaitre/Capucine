/**
 * Capucine — Checkout Session Service
 *
 * Manages checkout sessions, including state transitions, snapshots, and persistence.
 * Uses the CheckoutStateMachine to ensure valid state transitions.
 */

import { CheckoutSession, CheckoutStatus, CartSnapshot, PriceSnapshot, PromotionSnapshot, OfferSnapshot, MerchantSnapshot, VerificationState, ApprovalState, ExecutionState, FailureState, VerificationDiscrepancy, VerificationIssue, PurchaseApproval, ExecutionCapabilityType, AuditEntry } from '../domain/types';
import { CheckoutStateMachine } from './checkout-state-machine';

/**
 * Simple UUID generator (simplified version)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * In-memory store for checkout sessions.
 * In a production environment, this would be replaced with a database or persistent store.
 */
class CheckoutSessionStore {
  private sessions: Map<string, CheckoutSession> = new Map();

  create(session: CheckoutSession): void {
    this.sessions.set(session.id, session);
  }

  findById(id: string): CheckoutSession | undefined {
    return this.sessions.get(id);
  }

  update(session: CheckoutSession): void {
    this.sessions.set(session.id, session);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  cleanupExpiredSessions(now: Date = new Date()): void {
    const sessionsArray = Array.from(this.sessions.entries());
    for (const [id, session] of sessionsArray) {
      if (now > session.expiresAt) {
        this.delete(id);
      }
    }
  }

  findByIdempotencyKey(idempotencyKey: string): CheckoutSession | undefined {
    const sessionsArray = Array.from(this.sessions.values());
    for (const session of sessionsArray) {
      if (session.idempotencyKey === idempotencyKey) {
        return session;
      }
    }
    return undefined;
  }

  getAllSessions(): CheckoutSession[] {
    return Array.from(this.sessions.values());
  }
}

/**
 * Service for managing checkout sessions.
 */
export class CheckoutSessionService {
  private store: CheckoutSessionStore;

  constructor() {
    this.store = new CheckoutSessionStore();
  }

  /**
   * Create a new checkout session from a cart and offer.
   * @param cart The cart to purchase
   * @param offer The offer being purchased
   * @param merchant The merchant selling the offer
   * @param executionCapability The execution capability to use
   * @param idempotencyKey Optional idempotency key to prevent duplicate sessions
   * @returns The created checkout session
   */
  async createCheckoutSession(
    cart: CartSnapshot,
    offer: OfferSnapshot,
    merchant: MerchantSnapshot,
    executionCapability: ExecutionCapabilityType,
    idempotencyKey?: string
  ): Promise<CheckoutSession> {
    // Check for existing session with same idempotency key
    if (idempotencyKey) {
      const existing = this.store.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const sessionId = idempotencyKey ?? generateUUID();
    const finalIdempotencyKey = idempotencyKey ?? sessionId;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const session: CheckoutSession = {
      id: sessionId,
      userId: undefined, // Will be set if user authenticates
      offerId: offer.offerId,
      merchantId: merchant.merchantId,
      cart: {
        items: cart.items,
        appliedPromotions: [], // Will be filled from promotionSnapshot
        userInfo: undefined,
        createdAt: now,
        updatedAt: now,
        id: `cart-${sessionId}` // Generate cart id
      },
      merchantCart: undefined, // Will be created by execution handler
      status: 'verification_required',
      executionCapability,
      checkoutUrl: undefined,
      nextAction: 'awaiting_verification',
      error: undefined,
      auditTrail: [{
        timestamp: now,
        action: 'session_created',
        result: 'success',
        details: `Checkout session created for offer ${offer.offerId} with merchant ${merchant.merchantId}`
      }],
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      completedAt: undefined,
      correlationId: `corr-${generateUUID()}`,
      idempotencyKey: finalIdempotencyKey,
      version: 1,
      cartSnapshot: cart,
      // This service is handed a cart/offer/merchant snapshot, never price
      // data. It therefore captures NOTHING about price and says so: null,
      // not 0. Zero is a price; unknown is not. A caller that has the figures
      // (see api/server.ts) overwrites this snapshot right after creation.
      priceSnapshot: {
        productPrice: null,
        shippingCost: null,
        tax: null,
        importDuty: null,
        customsFees: null,
        serviceFees: null,
        promotionSavings: null,
        totalCost: null,
        currency: 'EUR',
        confidence: 0,
        source: 'not_captured',
        capturedAt: now
      },
      promotionSnapshot: [],
      offerSnapshot: offer,
      merchantSnapshot: merchant,
      verificationState: {
        verified: false,
        verifiedAt: null,
        discrepancies: [],
        blockingIssues: [],
        warnings: [],
        version: 1
      },
      approvalState: {
        approved: false,
        approvedAt: null,
        approvedBy: null,
        version: 1,
        approvedTotal: 0,
        approvedCurrency: 'EUR',
        expiresAt: null
      },
      executionState: {
        started: false,
        startedAt: null,
        completedAt: null,
        result: null,
        error: undefined,
        merchantConfirmed: false,
        merchantConfirmedAt: null
      }
    };

    this.store.create(session);
    return session;
  }

  /**
   * Get a checkout session by its ID.
   * @param sessionId The session ID
   * @returns The checkout session if found
   */
  getSession(sessionId: string): CheckoutSession | undefined {
    return this.store.findById(sessionId);
  }

  /**
   * Update a checkout session.
   * @param session The session to update
   */
  updateSession(session: CheckoutSession): void {
    session.updatedAt = new Date();
    this.store.update(session);
  }

  /**
   * Transition the session to a new state using the state machine.
   * @param sessionId The session ID
   * @param targetState The state to transition to
   * @returns The updated session
   * @throws Error if the transition is invalid
   */
  async transitionState(sessionId: string, targetState: CheckoutStatus): Promise<CheckoutSession> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    const stateMachine = new CheckoutStateMachine(session.status);
    if (!stateMachine.canTransitionTo(targetState)) {
      throw new Error(
        `Invalid transition from ${session.status} to ${targetState}. ` +
        `Allowed transitions: ${stateMachine.getPossibleNextStates().join(', ')}`
      );
    }

    // Update session status
    session.status = targetState;
    session.version += 1;

    // Add audit entry
    session.auditTrail.push({
      timestamp: new Date(),
      action: `state_transition_to_${targetState}`,
      result: 'success',
      details: `Transitioned checkout session from ${stateMachine.getState()} to ${targetState}`
    });

    // Update the store
    this.updateSession(session);

    return session;
  }

  /**
   * Set the verification state of a session.
   * @param sessionId The session ID
   * @param verificationState The verification state to set
   * @returns The updated session
   */
  async setVerificationState(
    sessionId: string,
    verificationState: VerificationState
  ): Promise<CheckoutSession> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    session.verificationState = verificationState;
    session.version += 1;
    session.updatedAt = new Date();

    // Add audit entry
    session.auditTrail.push({
      timestamp: new Date(),
      action: 'verification_state_updated',
      // Since VerificationEngine distinguishes "compared, nothing blocking"
      // from "could not compare", the audit must too: no blocking issue and
      // not verified means the check did not run, which is 'unknown' — not a
      // failed verification.
      result: verificationState.verified
        ? 'success'
        : verificationState.blockingIssues.length > 0 ? 'failure' : 'unknown',
      details: `Verification state updated: verified=${verificationState.verified}, discrepancies=${verificationState.discrepancies.length}, blockingIssues=${verificationState.blockingIssues.length}`
    });

    this.updateSession(session);
    return session;
  }

  /**
   * Set the approval state of a session.
   * @param sessionId The session ID
   * @param approvalState The approval state to set
   * @returns The updated session
   */
  async setApprovalState(
    sessionId: string,
    approvalState: ApprovalState
  ): Promise<CheckoutSession> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    session.approvalState = approvalState;
    session.version += 1;
    session.updatedAt = new Date();

    // Add audit entry
    session.auditTrail.push({
      timestamp: new Date(),
      action: 'approval_state_updated',
      result: approvalState.approved ? 'success' : 'failure',
      details: `Approval state updated: approved=${approvalState.approved}, total=${approvalState.approvedTotal} ${approvalState.approvedCurrency}`
    });

    this.updateSession(session);
    return session;
  }

  /**
   * Set the execution state of a session.
   * @param sessionId The session ID
   * @param executionState The execution state to set
   * @returns The updated session
   */
  async setExecutionState(
    sessionId: string,
    executionState: ExecutionState
  ): Promise<CheckoutSession> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    session.executionState = executionState;
    session.version += 1;
    session.updatedAt = new Date();

    // ExecutionState.result is 'success' | 'failure' | null, and null means
    // "not determined yet". The audit records that third state as 'unknown'.
    // It used to be written as 'success', which claimed an outcome nobody had
    // observed. An execution in flight is not an execution that succeeded.
    const auditResult: AuditEntry['result'] =
      executionState.result === 'success' ? 'success'
      : executionState.result === 'failure' ? 'failure'
      : 'unknown';

    session.auditTrail.push({
      timestamp: new Date(),
      action: 'execution_state_updated',
      result: auditResult,
      details: `Execution state updated: started=${executionState.started}, result=${executionState.result ?? 'not determined'}, merchantConfirmed=${executionState.merchantConfirmed}`
    });

    this.updateSession(session);
    return session;
  }

  /**
   * Set the failure state of a session.
   * @param sessionId The session ID
   * @param failureState The failure state to set
   * @returns The updated session
   */
  async setFailureState(
    sessionId: string,
    failureState: FailureState
  ): Promise<CheckoutSession> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    session.failureState = failureState;
    session.version += 1;
    session.updatedAt = new Date();

    // Add audit entry
    session.auditTrail.push({
      timestamp: new Date(),
      action: 'failure_state_set',
      result: 'failure',
      details: `Failure state set: type=${failureState.type}, message=${failureState.message}`
    });

    this.updateSession(session);
    return session;
  }

  /**
   * Increment the retry count of a session.
   * @param sessionId The session ID
   * @returns The updated session
   */
  async incrementRetryCount(sessionId: string): Promise<CheckoutSession> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Checkout session ${sessionId} not found`);
    }

    session.retryCount += 1;
    session.version += 1;
    session.updatedAt = new Date();

    // Add audit entry
    session.auditTrail.push({
      timestamp: new Date(),
      action: 'retry_count_incremented',
      result: 'success',
      details: `Retry count incremented to ${session.retryCount}/${session.maxRetries}`
    });

    this.updateSession(session);
    return session;
  }

  /**
   * Check if a session has expired.
   * @param sessionId The session ID
   * @returns true if the session has expired
   */
  isExpired(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return true; // Treat non-existent as expired
    }
    return new Date() > session.expiresAt;
  }

  /**
   * Clean up expired sessions.
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    const sessions = this.store.getAllSessions();
    for (const session of sessions) {
      if (now > session.expiresAt) {
        this.store.delete(session.id);
      }
    }
  }
}

// Export a singleton instance for convenience
export const checkoutSessionService = new CheckoutSessionService();