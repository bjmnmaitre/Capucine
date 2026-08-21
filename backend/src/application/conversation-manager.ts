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

import { UserProfile, PreferenceCriterion } from '../domain/types';
import { ClarificationItem } from './clarification-engine';
import type { SearchEngineResult } from './capucine-engine';
import { SupportedCountry, DEFAULT_COUNTRY, DEFAULT_BROADEN_COUNTRIES } from './i18n';
import { RankingPreference, DEFAULT_RANKING_PREFERENCE } from './ranking-preference';
import { InternationalIntent, RetryIntent } from './request-interpreter';

/**
 * Sentinel `questionId` value POST /clarify recognizes as "this is a
 * free-form conversational follow-up, not an answer to a specific pending
 * question" — see server.ts's POST /clarify and applyFollowUp() below.
 * questionId stays a required field either way; this just picks which of
 * the two modes it means, explicitly, never inferred from its absence.
 */
export const FOLLOWUP_QUESTION_ID = '__followup__';

/**
 * Pure extraction of "what did we actually show the user" from a
 * SearchEngineResult — reused by buildSession() (seed) and updateResult()
 * (accumulate). Reads result.ranking.rankedOffers — the ADMISSIBLE,
 * user-facing offers, not raw/rejected discovery candidates.
 */
const SeenOffers = {
  merchantNamesOf(result: SearchEngineResult): string[] {
    return result.ranking.rankedOffers.map(ro => ro.offer.merchant.name);
  },
  productIdsOf(result: SearchEngineResult): string[] {
    return result.ranking.rankedOffers.map(ro => ro.offer.productId);
  },
};

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
   * Language resolved for the ORIGINAL search (CapucineEngine.search()'s
   * resolveLanguage() — explicit request > detected from query text > profile
   * > 'fr'). Follow-up turns reuse it explicitly (see applyFollowUp()/
   * server.ts) rather than re-detecting from searchText alone, which is
   * often too short/ambiguous for language detection to be reliable (e.g.
   * a one-word searchText like "laptop" may not clear the detector's
   * confidence threshold, silently falling back to French mid-conversation).
   */
  language: string;

  /**
   * Cleaned product search terms from the ORIGINAL interpretation (e.g.
   * "ordinateur portable" from "ordinateur portable 16 Go moins de 1000
   * euros") — used as `queryText` when re-running search() for a follow-up
   * turn (see applyFollowUp()/FOLLOWUP_QUESTION_ID). Follow-up turns supply
   * criteria directly via preInterpretedCriteria, which makes CapucineEngine
   * skip re-interpretation entirely — so queryText's ONLY remaining job on
   * that turn is driving discovery search terms, and it must not still
   * carry the original query's budget/RAM noise (e.g. "1000", "euros"),
   * which the interpreter would normally have stripped before term
   * extraction but which a bypassed interpretation never gets the chance
   * to. Falls back to the full original query when interpretation didn't
   * run at all (e.g. the first search supplied inline criteria).
   */
  searchText: string;

  /**
   * Where the user would receive the product — conceptually equivalent to
   * i18n.ts's already-scaffolded (but unused) InternationalSearchScope.
   * shippingCountry. Defaults to France (DEFAULT_COUNTRY) and, unlike
   * targetCountries below, is NOT modified by a "cherche aussi en
   * Allemagne" follow-up — that widens WHERE Capucine searches, not where
   * the user lives. Kept separate on purpose (megaprompt PARTIE 4: never
   * conflate merchant/shipping/destination country).
   */
  destinationCountry: SupportedCountry;

  /**
   * Countries Capucine should search IN, additive across the conversation —
   * "cherche aussi en Allemagne" ADDS 'DE' here, it never replaces or resets
   * the set (a later "cherche aussi en Espagne" keeps Germany too). Starts
   * as [destinationCountry] (searching the destination market is always
   * implied). Derived into DiscoveryCriteria.internationalLanguages via
   * COUNTRY_TO_LANGUAGE (see capucine-engine.ts) — searchLanguages
   * themselves are NOT stored here since they're a pure derivation, kept in
   * one place rather than duplicated.
   */
  targetCountries: SupportedCountry[];

  /**
   * "montre-moi les moins chers" — persists across turns (a later "uniquement
   * neuf" must not silently reset it back to BEST_MATCH) until the user
   * explicitly asks for a different order. See ranking-preference.ts.
   */
  rankingPreference: RankingPreference;

  /**
   * "montre-moi les 3 meilleures" — a presentation-only cap applied AFTER
   * ranking/reordering (server.ts), same "extend the presentation layer,
   * never re-run discovery" principle as rankingPreference. Persists like
   * rankingPreference until the user asks for a different number.
   * Undefined = no cap (show everything admissible), never defaulted to a
   * guessed number.
   */
  resultLimit?: number;

  /**
   * "exclue Amazon" — free-text merchant NAMES to exclude, additive across
   * the conversation (a later "exclue Fnac" keeps Amazon excluded too).
   * Matched case-insensitively against offer.merchant.name at presentation
   * time (server.ts) — not a catalog id, since the user names a brand in
   * free text, not Capucine's internal merchant id.
   */
  excludedMerchantNames: string[];

  /**
   * "trouve une meilleure offre" excludes these from the NEXT presented
   * list (see server.ts) — deliberately SEPARATE from excludedMerchantNames:
   * FIND_BETTER avoids the exact products already shown, not the merchants
   * that sold them (a different offer from the same merchant is fine).
   * Populated by merchant.name + productId pairs turned into offer ids —
   * see updateSeenOffers() below.
   */
  excludedOfferIds: string[];

  /**
   * offer.merchant.name / offer.productId actually PRESENTED to the user
   * across every turn so far (not just discovered/admissible — what they
   * actually SAW) — the basis for SEARCH_ELSEWHERE (avoid these merchants)
   * and SEARCH_AGAIN. Updated after every search via updateSeenOffers().
   */
  seenMerchantNames: string[];
  seenProductIds: string[];

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

  /**
   * SearchCriteriaSnapshot: the criteria extracted from the ORIGINAL query
   * text (before profile merge), refined turn-by-turn by applyFollowUp().
   * This is what lets a free-form follow-up ("élargis à 1100€", "et avec
   * 32 Go ?", "uniquement du neuf") update ONE criterion in place — via
   * preInterpretedCriteria — without re-parsing the whole conversation as
   * one text blob (which would be ambiguous: which of two budget mentions
   * wins?) and without discarding the criteria the follow-up didn't mention.
   */
  currentCriteria: PreferenceCriterion[];

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

export interface ApplyFollowUpResult {
  /** currentCriteria after merging the follow-up's delta — pass to the
   *  engine as preInterpretedCriteria (with the session's ORIGINAL query
   *  text, so search terms stay based on the real product request). */
  mergedCriteria: PreferenceCriterion[];
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
    return this.buildSession(userId, query, profile, result).id;
  }

  /**
   * Create a session for a completed search REGARDLESS of whether it has
   * clarification opportunities — unlike createSession() above (which is
   * clarification-gated and whose contract/tests are unchanged), this always
   * returns a session id. This is what lets the user continue ANY search
   * conversationally ("uniquement du neuf", "élargis à 1100€") — see
   * megaprompt PARTIE 1/3 — not just ones the backend proactively asked a
   * clarification question about. Server.ts calls this as a fallback when
   * createSession() returns null.
   */
  createFollowUpSession(
    userId: string,
    query: string,
    profile: UserProfile,
    result: SearchEngineResult
  ): string {
    return this.buildSession(userId, query, profile, result).id;
  }

  private buildSession(
    userId: string,
    query: string,
    profile: UserProfile,
    result: SearchEngineResult
  ): ConversationSession {
    const id = this.generateId();
    const now = new Date();

    // SearchCriteriaSnapshot seed: criteria extracted from THIS query's text
    // (pre-profile-merge) when interpretation ran, else fall back to the
    // resolved effectiveCriteria (e.g. when the caller supplied inline
    // criteria and interpretation was skipped entirely).
    const currentCriteria = result.interpretedRequest?.extractedCriteria ?? result.effectiveCriteria;

    const suggestedTerms = result.interpretedRequest?.suggestedSearchTerms;
    const searchText = suggestedTerms && suggestedTerms.length > 0 ? suggestedTerms.join(' ') : query;

    const session: ConversationSession = {
      id,
      userId,
      originalQuery: query,
      language: result.language,
      searchText,
      destinationCountry: DEFAULT_COUNTRY,
      targetCountries: [DEFAULT_COUNTRY],
      rankingPreference: DEFAULT_RANKING_PREFERENCE,
      excludedMerchantNames: [],
      excludedOfferIds: [],
      seenMerchantNames: SeenOffers.merchantNamesOf(result),
      seenProductIds: SeenOffers.productIdsOf(result),
      enrichedQuery: query,
      answeredQuestions: [],
      unansweredQuestions: [...result.clarifications.opportunities],
      profile,
      lastResult: result,
      currentCriteria,
      turn: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.TTL_MS),
    };

    this.sessions.set(id, session);
    this.scheduleExpiry(id);
    return session;
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
   * Apply a free-form conversational follow-up ("uniquement du neuf",
   * "élargis à 1100€", "et avec 32 Go ?") that MODIFIES the current search
   * rather than answering a specific pending clarification question.
   *
   * `deltaCriteria` is computed by the caller (CapucineEngine.interpretFollowUp())
   * from the follow-up text alone — this method only owns the MERGE: each
   * delta criterion replaces the session's current criterion with the same
   * id (last-wins, so "élargis à 1100€" overrides the original budget
   * without disturbing RAM/screen_size/etc.); criteria the follow-up didn't
   * mention are carried over unchanged.
   *
   * INVARIANT 5: the ORIGINAL query text is never rewritten — only the
   * criteria snapshot changes. The follow-up is recorded verbatim for audit,
   * same as answeredQuestions is for applyAnswer().
   *
   * @throws Error if sessionId is not found/expired.
   */
  applyFollowUp(
    sessionId: string,
    followUpText: string,
    deltaCriteria: PreferenceCriterion[],
    userId?: string,
    options: {
      rankingPreference?: RankingPreference;
      internationalIntent?: InternationalIntent;
      resultLimit?: number;
      excludeMerchantName?: string;
      retryIntent?: RetryIntent;
    } = {}
  ): ApplyFollowUpResult {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session not found or expired: ${sessionId}`);
    }

    const untouched = session.currentCriteria.filter(
      c => !deltaCriteria.some(d => d.id === c.id)
    );
    const mergedCriteria = [...untouched, ...deltaCriteria];

    const answeredQuestion: AnsweredQuestion = {
      questionId: `followup-${session.turn}`,
      question: '(follow-up)',
      answer: followUpText.trim(),
      answeredAt: new Date(),
    };

    // rankingPreference: replaced when explicitly requested, otherwise
    // carried over unchanged (a later "uniquement neuf" must not silently
    // reset "montre-moi les moins chers" back to BEST_MATCH).
    const rankingPreference = options.rankingPreference ?? session.rankingPreference;

    // targetCountries: ADDITIVE union, never reset — "cherche aussi en
    // Allemagne" then later "cherche aussi en Espagne" keeps both.
    let targetCountries = session.targetCountries;
    if (options.internationalIntent) {
      const { targetCountries: named, broaden } = options.internationalIntent;
      const toAdd = named.length > 0 ? named : (broaden ? DEFAULT_BROADEN_COUNTRIES : []);
      const union = new Set(session.targetCountries);
      for (const c of toAdd) union.add(c);
      targetCountries = [...union];
    }

    // resultLimit: replaced when explicitly requested, otherwise carried
    // over — same persistence rule as rankingPreference.
    const resultLimit = options.resultLimit ?? session.resultLimit;

    // excludedMerchantNames: ADDITIVE, never reset — "exclue Amazon" then
    // later "exclue Fnac" keeps both excluded.
    let excludedMerchantNames = options.excludeMerchantName
      ? [...new Set([...session.excludedMerchantNames, options.excludeMerchantName])]
      : session.excludedMerchantNames;

    // excludedOfferIds: ADDITIVE — FIND_BETTER avoids exact products
    // already shown (not merchants — a different offer from the same
    // merchant is a valid "better" candidate).
    let excludedOfferIds = session.excludedOfferIds;

    // Retry intents — each changes something REAL (never a bare identical
    // re-run, which would return identical results — CapucineEngine's
    // ranking is deterministic). See extractRetryIntent()'s doc comment
    // for why these three are distinct mechanisms.
    if (options.retryIntent === 'SEARCH_ELSEWHERE' || options.retryIntent === 'SEARCH_AGAIN') {
      excludedMerchantNames = [...new Set([...excludedMerchantNames, ...session.seenMerchantNames])];
      if (options.retryIntent === 'SEARCH_AGAIN' && targetCountries.length <= 1) {
        // Only broaden if the user hasn't already scoped an international
        // search themselves — never override an explicit earlier choice,
        // and never broaden a SECOND time redundantly. AND only if the
        // LAST search's real SearchCoverage (see search-coverage.ts —
        // REUSED, not a second notion of coverage) says it wasn't already
        // saturated. `coverage` is only present for the multi-phase Web
        // path (RealWebDiscoveryStrategy) — absent for the local catalog,
        // in which case there is no evidence coverage was sufficient, so
        // the existing (pre-this-chantier) behavior of broadening is kept
        // as the honest default.
        const coverage = session.lastResult.discovery?.statistics?.coverage;
        const alreadySaturated = coverage?.saturated === true;
        if (!alreadySaturated) {
          targetCountries = [...new Set([...targetCountries, ...DEFAULT_BROADEN_COUNTRIES])];
        }
      }
    } else if (options.retryIntent === 'FIND_BETTER') {
      excludedOfferIds = [...new Set([...excludedOfferIds, ...session.seenProductIds])];
    }

    const updatedSession: ConversationSession = {
      ...session,
      currentCriteria: mergedCriteria,
      rankingPreference,
      targetCountries,
      resultLimit,
      excludedOfferIds,
      excludedMerchantNames,
      answeredQuestions: [...session.answeredQuestions, answeredQuestion],
      turn: session.turn + 1,
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + this.TTL_MS),
    };

    this.sessions.set(sessionId, updatedSession);
    return { mergedCriteria, updatedSession };
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
      // Accumulate what was actually ranked/shown THIS turn into the
      // running "already seen" set — additive, never reset, so a LATER
      // SEARCH_ELSEWHERE/FIND_BETTER always avoids everything shown across
      // the WHOLE conversation, not just the most recent turn.
      seenMerchantNames: [...new Set([...session.seenMerchantNames, ...SeenOffers.merchantNamesOf(result)])],
      seenProductIds: [...new Set([...session.seenProductIds, ...SeenOffers.productIdsOf(result)])],
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
