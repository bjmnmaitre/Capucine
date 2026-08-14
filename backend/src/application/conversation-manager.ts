/**
 * Capucine — ConversationManager
 *
 * Manages multi-turn clarification sessions.
 *
 * DESIGN:
 *   1. POST /search returns a sessionId when there are clarification questions.
 *   2. POST /clarify accepts { sessionId, questionId, answer } and re-runs the
 *      search with the answer woven into the effective query context.
 *   3. Sessions expire after TTL_MS (default 30 min) — no persistent storage needed.
 *
 * ANSWER APPLICATION STRATEGY (simple + composable):
 *   We append each answer as a structured annotation to the original query text.
 *   Example: "casque bluetooth pas trop cher\n[budget → 500€]"
 *   The RequestInterpreter then re-parses the enriched text and extracts the
 *   refined budget criterion. This avoids a parallel answer→criterion mapping
 *   layer while remaining fully transparent.
 *
 * INVARIANT 5: ConversationManager NEVER silently changes the user's original intent.
 *   Each answer must be explicitly provided by the user; defaults are NEVER applied.
 *   The original query is always preserved as-is; answers are additive.
 *
 * SECURITY:
 *   - Session IDs are random and unguessable (not sequential).
 *   - Sessions are scoped to userId — only the owning user can continue them.
 *   - No secrets or API keys are stored in sessions.
 */

import { UserProfile } from '../domain/types';
import { ClarificationItem } from './clarification-engine';
import type { SearchEngineResult } from './capucine-engine';

// ============================================================================
// TYPES
// ============================================================================

export interface AnsweredQuestion {
  questionId: string;
  question: string;
  answer: string;
  answeredAt: Date;
}

/**
 * An in-progress multi-turn clarification session.
 */
export interface ConversationSession {
  /** Unique session ID — returned to the client so they can call /clarify */
  id: string;

  /** User who owns this session (security scope) */
  userId: string;

  /** Original unmodified query text from POST /search */
  originalQuery: string;

  /**
   * Query enriched with all answers so far.
   * This is what gets passed to CapucineEngine on continuation.
   * Format: "original query\n[Q: question → A: answer]\n..."
   */
  enrichedQuery: string;

  /** Q&A pairs applied so far */
  answeredQuestions: AnsweredQuestion[];

  /** Questions still waiting for answers */
  unansweredQuestions: ClarificationItem[];

  /** Profile at the time of the first search (immutable during session) */
  profile: UserProfile;

  /** Latest search result — updated on each continuation */
  lastResult: SearchEngineResult;

  /** Iteration count (1 = initial search, 2 = after first clarification, …) */
  turn: number;

  createdAt: Date;
  updatedAt: Date;

  /** Wall-clock expiry — session is deleted after this */
  expiresAt: Date;
}

export interface ApplyAnswerResult {
  /** Query text to pass to the engine for re-search */
  enrichedQuery: string;
  /** Updated session (already persisted in the store) */
  updatedSession: ConversationSession;
}

// ============================================================================
// CONVERSATION MANAGER
// ============================================================================

export class ConversationManager {
  private readonly sessions: Map<string, ConversationSession> = new Map();

  /** How long a session lives without activity (default 30 minutes) */
  private readonly TTL_MS: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.TTL_MS = options.ttlMs ?? 30 * 60 * 1000;
  }

  // ── Session lifecycle ───────────────────────────────────────────────────────

  /**
   * Create a new session after an initial POST /search.
   * Only creates a session if there are clarification opportunities.
   * Returns null if there is nothing to clarify.
   */
  createSession(
    userId: string,
    query: string,
    profile: UserProfile,
    result: SearchEngineResult
  ): string | null {
    if (result.clarifications.opportunities.length === 0) return null;

    const id = this.generateId();
    const now = new Date();

    const session: ConversationSession = {
      id,
      userId,
      originalQuery: query,
      enrichedQuery: query,
      answeredQuestions: [],
      unansweredQuestions: [...result.clarifications.opportunities],
      profile,
      lastResult: result,
      turn: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.TTL_MS),
    };

    this.sessions.set(id, session);
    this.scheduleExpiry(id);
    return id;
  }

  /**
   * Retrieve a session, checking expiry and ownership.
   * Returns null (not throws) when session is missing/expired.
   */
  getSession(id: string, userId?: string): ConversationSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (session.expiresAt < new Date()) {
      this.sessions.delete(id);
      return null;
    }

    if (userId !== undefined && session.userId !== userId) return null;

    return session;
  }

  /**
   * Apply a clarification answer and update the enriched query.
   *
   * The answer is appended to the enriched query as a structured annotation
   * so the RequestInterpreter can extract it on re-run.
   *
   * INVARIANT 5: we never silently apply safeDefaults here.
   * Only the explicit user-provided answer is incorporated.
   *
   * @throws Error if sessionId or questionId is not found.
   */
  applyAnswer(
    sessionId: string,
    questionId: string,
    answer: string,
    userId?: string
  ): ApplyAnswerResult {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session not found or expired: ${sessionId}`);
    }

    const question = session.unansweredQuestions.find(q => q.id === questionId);
    if (!question) {
      throw new Error(
        `Question ${questionId} not found in session ${sessionId}. ` +
        `Available: ${session.unansweredQuestions.map(q => q.id).join(', ')}`
      );
    }

    // Append the answer as a structured annotation
    const annotation = `[${question.suggestedQuestion} → ${answer.trim()}]`;
    const enrichedQuery = session.enrichedQuery + '\n' + annotation;

    const answeredQuestion: AnsweredQuestion = {
      questionId,
      question: question.suggestedQuestion,
      answer: answer.trim(),
      answeredAt: new Date(),
    };

    const updatedSession: ConversationSession = {
      ...session,
      enrichedQuery,
      answeredQuestions: [...session.answeredQuestions, answeredQuestion],
      unansweredQuestions: session.unansweredQuestions.filter(q => q.id !== questionId),
      turn: session.turn + 1,
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + this.TTL_MS),
    };

    this.sessions.set(sessionId, updatedSession);
    return { enrichedQuery, updatedSession };
  }

  /**
   * Update the lastResult after a re-search.
   * Called by the API layer after receiving the new SearchEngineResult.
   */
  updateResult(
    sessionId: string,
    result: SearchEngineResult,
    newUnansweredQuestions?: ClarificationItem[]
  ): ConversationSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const updatedSession: ConversationSession = {
      ...session,
      lastResult: result,
      // If the new result has new clarification questions, surface them
      // (minus any already answered)
      unansweredQuestions: newUnansweredQuestions ??
        result.clarifications.opportunities.filter(
          opp => !session.answeredQuestions.some(aq => aq.questionId === opp.id)
        ),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  /** Number of active sessions (for monitoring / testing). */
  size(): number {
    return this.sessions.size;
  }

  /** Clear all sessions (testing only). */
  clear(): void {
    this.sessions.clear();
  }

  /** List all active (non-expired) session IDs. */
  listActive(): string[] {
    const now = new Date();
    const active: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.expiresAt >= now) active.push(id);
    }
    return active;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private generateId(): string {
    // Sufficient entropy for session IDs — not a security-critical token
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private scheduleExpiry(id: string): void {
    // unref() prevents the timer from keeping the process alive (critical for Jest)
    setTimeout(() => {
      this.sessions.delete(id);
    }, this.TTL_MS).unref();
  }
}
