/**
 * Capucine — Checkout State Machine
 *
 * Manages state transitions for checkout sessions to ensure valid progression
 * through the purchase flow.
 */

import { CheckoutStatus } from '../domain/types';

/**
 * Defines the allowed transitions from a given state.
 * Each key is a state, and its value is an array of states it can transition to.
 */
const ALLOWED_TRANSITIONS: Record<CheckoutStatus, CheckoutStatus[]> = {
  verification_required: ['verified', 'verification_failed', 'cancelled', 'expired'],
  verified: ['user_approval_required', 'verification_failed', 'cancelled', 'expired'],
  user_approval_required: ['user_approving', 'cancelled', 'expired'],
  user_approving: ['approved', 'approval_invalidated', 'cancelled', 'expired'],
  approved: ['execution_ready', 'approval_invalidated', 'cancelled', 'expired'],
  execution_ready: ['executing', 'cancelled', 'expired'],
  executing: ['executed', 'failed', 'cancelled', 'expired'],
  executed: [], // Terminal state
  failed: [], // Terminal state (though can be retried, but that's a new session)
  cancelled: [], // Terminal state
  expired: [], // Terminal state
  verification_failed: [], // Terminal state (can retry with new session)
  approval_invalidated: [], // Terminal state (requires re-approval)
};

/**
 * Checkout state machine that manages valid state transitions.
 */
export class CheckoutStateMachine {
  private currentState: CheckoutStatus;

  constructor(initialState: CheckoutStatus) {
    this.currentState = initialState;
  }

  /**
   * Get the current state.
   */
  getState(): CheckoutStatus {
    return this.currentState;
  }

  /**
   * Check if a transition to the target state is allowed.
   * @param targetState The state to transition to
   * @returns true if the transition is allowed
   */
  canTransitionTo(targetState: CheckoutStatus): boolean {
    return ALLOWED_TRANSITIONS[this.currentState]?.includes(targetState) ?? false;
  }

  /**
   * Transition to a new state if allowed.
   * @param targetState The state to transition to
   * @throws Error if the transition is not allowed
   */
  transitionTo(targetState: CheckoutStatus): void {
    if (!this.canTransitionTo(targetState)) {
      throw new Error(
        `Invalid transition from ${this.currentState} to ${targetState}. ` +
        `Allowed transitions: ${ALLOWED_TRANSITIONS[this.currentState]?.join(', ') || 'none'}`
      );
    }
    this.currentState = targetState;
  }

  /**
   * Get all possible next states from the current state.
   */
  getPossibleNextStates(): CheckoutStatus[] {
    return [...(ALLOWED_TRANSITIONS[this.currentState] || [])];
  }

  /**
   * Reset the state machine to an initial state.
   * @param initialState The state to reset to
   */
  reset(initialState: CheckoutStatus): void {
    this.currentState = initialState;
  }

  /**
   * Check if the current state is a terminal state (no outgoing transitions).
   */
  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.currentState]?.length === 0;
  }
}