/**
 * Capucine — Approval Engine
 *
 * Responsible for managing the approval state of a checkout session:
 * - Tracking user approval
 * - Managing approval expiration
 * - Handling approval invalidation (e.g., due to changes)
 */
import { ApprovalState } from '../domain/types';

export class ApprovalEngine {
  /**
   * Create an initial approval state.
   * @returns The initial approval state
   */
  createInitialState(): ApprovalState {
    return {
      approved: false,
      approvedAt: null,
      approvedBy: null,
      version: 1,
      approvedTotal: 0,
      approvedCurrency: 'EUR',
      expiresAt: null
    };
  }

  /**
   * Set the approval state to approved.
   * @param sessionId The session ID
   * @param approvedBy The user ID who approved
   * @param approvedTotal The total amount approved
   * @param approvedCurrency The currency of the approved total
   * @param expiresAt When the approval expires (optional)
   * @returns The updated approval state
   */
  approve(
    approvedBy: string | null,
    approvedTotal: number,
    approvedCurrency: string,
    expiresAt: Date | null = null
  ): ApprovalState {
    return {
      approved: true,
      approvedAt: new Date(),
      approvedBy,
      version: 1, // In practice, this would be incremented from the current version
      approvedTotal,
      approvedCurrency,
      expiresAt
    };
  }

  /**
   * Invalidate the approval (e.g., due to changes in cart or price).
   * @returns The invalidated approval state
   */
  invalidate(): ApprovalState {
    return {
      approved: false,
      approvedAt: null,
      approvedBy: null,
      version: 1, // In practice, increment from current
      approvedTotal: 0,
      approvedCurrency: 'EUR',
      expiresAt: null
    };
  }

  /**
   * Check if the approval has expired.
   * @param approvalState The current approval state
   * @returns true if expired
   */
  isExpired(approvalState: ApprovalState): boolean {
    if (!approvalState.approved || !approvalState.expiresAt) {
      return false;
    }
    return new Date() > approvalState.expiresAt;
  }
}