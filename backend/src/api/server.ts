/**
 * Capucine — HTTP API Layer
 *
 * Minimal Express server exposing the Capucine search pipeline via HTTP.
 *
 * Routes:
 *   POST /search       → Full pipeline → SearchEngineResult (JSON)
 *   POST /prepare-cart → Prepare the purchase of one already-ranked offer
 *   GET  /health       → Service status
 *   GET  /tools        → List of registered tools and their availability
 *
 * SECURITY INVARIANTS:
 * - No API keys in this file. Keys are read from env by adapters.
 * - Request body is validated before entering the pipeline.
 * - AI responses NEVER reach PriorityEngine (enforced by CapucineEngine).
 * - All errors return structured JSON (never raw stack traces in production).
 *
 * NOT in scope for this layer:
 * - Authentication / authorization (caller's responsibility)
 * - Rate limiting (use a reverse proxy / API gateway)
 * - HTTPS (use a reverse proxy)
 * - Payment, purchase, affiliate — NEVER
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { CapucineEngine, SearchRequest } from '../application/capucine-engine';
import { buildDefaultToolRegistry } from '../application/tools';
import { detectWebSearchAdapters } from '../application/web-search-adapters';
import { buildAIOrchestrator } from '../application/ai-providers';
import { InMemoryProfileStore } from '../application/profile-store';
import { ConversationManager, FOLLOWUP_QUESTION_ID } from '../application/conversation-manager';
import { PreferenceCriterion, SearchMatchQuality } from '../domain/types';
import { translate, SupportedLanguage, DEFAULT_COUNTRY, COUNTRY_TO_SEARCH_LANGUAGE } from '../application/i18n';
import { sortByPreference, reasonCodeFor, RankingPreference, DEFAULT_RANKING_PREFERENCE } from '../application/ranking-preference';
import { createDefaultCartPreparationEngine } from '../application/cart-preparation-engine';

// ============================================================================
// APP FACTORY
// ============================================================================

/**
 * Build and configure the Express application.
 * Separated from listen() so the app can be tested without starting a server.
 */
export function buildApp(): express.Application {
  const app = express();

  // Parse JSON bodies
  app.use(express.json({ limit: '64kb' }));

  // Serve the minimal first-version frontend (public/) from the same
  // server/port as the API — avoids CORS and avoids requiring a second
  // process to run the app. Resolved from process.cwd() (not
  // import.meta.url) because import.meta is not supported by ts-jest's
  // transform — this keeps behavior identical whether the server is run
  // via `npm run dev` (tsx) or invoked from an integration test (jest),
  // both of which run with cwd = backend/.
  app.use(express.static(path.join(process.cwd(), 'public')));

  // AI orchestrator — uses real providers if keys are set, MockAI otherwise
  const aiSetup = buildAIOrchestrator();
  if (aiSetup.status === 'real') {
    console.log(`[CapucineAPI] AI providers: ${aiSetup.configured.join(', ')}`);
  } else {
    console.log(`[CapucineAPI] AI providers: MockAI (set ANTHROPIC_API_KEY or OPENAI_API_KEY for real AI)`);
  }

  // Web search adapters — ALL configured sources, not just the first one, so
  // ToolRegistry can register each as its own source (multi-source discovery).
  const webAdapters = detectWebSearchAdapters();
  const configuredAdapters = webAdapters.filter(a => a.isConfigured());
  if (configuredAdapters.length > 0) {
    console.log(`[CapucineAPI] Web search: ${configuredAdapters.map(a => a.adapterName).join(', ')} (configured)`);
  } else {
    console.log(`[CapucineAPI] Web search: NOT_EXECUTABLE (set BRAVE_API_KEY or SERPER_API_KEY)`);
  }

  // Profile store — in-memory for now (swap for PostgresProfileStore in production)
  // ARCHITECTURAL NOTE: This is a stateless replacement point. The store is injected
  // here; CapucineEngine itself never touches storage.
  const profileStore = new InMemoryProfileStore();

  // Conversation manager — tracks multi-turn clarification sessions (30-min TTL)
  const conversationManager = new ConversationManager();

  // Execution layer. Strictly separate from ranking: it is only ever consulted
  // AFTER PriorityEngine has produced an order, and never feeds anything back
  // into it (EXECUTION_INDEPENDENCE).
  const cartPreparationEngine = createDefaultCartPreparationEngine();

  // Tool registry — the single registry for this server process.
  // Shared with the engine so both use the same audit log and rate-limit counters.
  // In production this is the ONLY path tool calls take (enforces timeout/rate-limit/audit).
  const toolRegistry = buildDefaultToolRegistry(webAdapters);

  // Engine (one instance per process, shared across requests)
  // Injecting toolRegistry ensures CapucineEngine routes all web search calls through it.
  const engine = new CapucineEngine({
    aiOrchestrator: aiSetup.orchestrator,
    toolRegistry,
  });

  // ── Routes ─────────────────────────────────────────────────────────────────

  /**
   * GET /health
   *
   * Returns service status. Used by load balancers and monitoring.
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'capucine',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      capabilities: {
        aiProviders: {
          status: aiSetup.status,
          configured: aiSetup.configured,
          blocked: aiSetup.blocked,
        },
        webSearch: {
          status: configuredAdapters.length > 0 ? 'configured' : 'not_configured',
          adapters: webAdapters.map(a => a.adapterName),
        },
      },
    });
  });

  /**
   * GET /tools
   *
   * Returns the list of registered tools and their availability.
   * Useful for debugging whether API keys are configured.
   */
  app.get('/tools', (_req: Request, res: Response) => {
    res.json({
      tools: toolRegistry.listTools(),
    });
  });

  /**
   * POST /search
   *
   * Execute a full Capucine search pipeline.
   *
   * Request body:
   * {
   *   "query": "je cherche un casque bluetooth pas trop cher",   // required
   *   "requestId": "req-abc123",                                 // optional
   *   "userId": "user-xyz",                                      // optional
   *   "criteria": [...],                                         // optional pre-parsed criteria
   *   "overrides": [...],                                        // optional temporary overrides
   *   "skipInterpreter": false                                   // optional (default false)
   * }
   *
   * Response: SearchEngineResult (JSON)
   */
  /**
   * GET /profile/:userId
   *
   * Load a user's stored preferences.
   * Returns empty profile if user not found (not a 404).
   */
  app.get('/profile/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params['userId'] as string;
      if (!userId || userId.length > 128) {
        return res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId must be 1-128 chars.' });
      }
      const profile = await profileStore.load(userId);
      return res.json({
        userId: profile.userId,
        criteria: profile.preferences.criteria.map(c => ({
          id: c.id,
          name: c.name,
          level: c.level,
          parameters: c.parameters ?? null,
        })),
        updatedAt: profile.updatedAt.toISOString(),
      });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * PUT /profile/:userId/criterion
   *
   * Add or update a single preference criterion for a user.
   *
   * Body: { id, name, level, parameters? }
   *
   * INVARIANT: This stores permanent preferences.
   * Temporary overrides go in POST /search, not here.
   */
  app.put('/profile/:userId/criterion', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params['userId'] as string;
      const { id, name, level, parameters } = req.body as {
        id?: string;
        name?: string;
        level?: string;
        parameters?: Record<string, unknown>;
      };

      if (!userId || userId.length > 128) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
      }
      if (!id || !name || !level) {
        return res.status(400).json({
          error: 'INVALID_CRITERION',
          message: 'criterion requires: id, name, level',
        });
      }

      const VALID_LEVELS = ['forbidden', 'required', 'very_important', 'important', 'preference', 'low', 'none'];
      if (!VALID_LEVELS.includes(level)) {
        return res.status(400).json({
          error: 'INVALID_LEVEL',
          message: `level must be one of: ${VALID_LEVELS.join(', ')}`,
        });
      }

      await profileStore.updateCriterion(userId, {
        id,
        name,
        level: level as PreferenceCriterion['level'],
        parameters,
      });

      return res.json({ ok: true, userId, criterionId: id });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * DELETE /profile/:userId/criterion/:criterionId
   *
   * Remove a preference criterion from a user's profile.
   */
  app.delete('/profile/:userId/criterion/:criterionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params['userId'] as string;
      const criterionId = req.params['criterionId'] as string;
      await profileStore.removeCriterion(userId, criterionId);
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  app.post('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ── Validate ──────────────────────────────────────────────────────────
      const { query, requestId, userId, criteria, skipInterpreter, language } = req.body as {
        query?: string;
        requestId?: string;
        userId?: string;
        criteria?: PreferenceCriterion[];
        skipInterpreter?: boolean;
        /** Optional — BCP-47/ISO 639-1 (e.g. "fr", "en-US"). Never required:
         *  detected from `query` when absent, defaulting to 'fr' (see
         *  CapucineEngine.search()'s resolveLanguage()). */
        language?: string;
      };

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: '"query" field is required and must be a non-empty string.',
          example: { query: 'je cherche un casque bluetooth pas trop cher' },
        });
      }

      if (query.length > 2000) {
        return res.status(400).json({
          error: 'QUERY_TOO_LONG',
          message: 'Query must be under 2000 characters.',
        });
      }

      // ── Build request ─────────────────────────────────────────────────────
      // Load profile from store (returns empty profile if user not found).
      // The store is the single point of truth for persistent preferences.
      const effectiveUserId = userId ?? 'anonymous';
      const profile = await profileStore.load(effectiveUserId);

      const searchRequest: SearchRequest = {
        queryText: query.trim(),
        requestId: requestId ?? `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        profile,
        preInterpretedCriteria: Array.isArray(criteria) ? criteria : [],
        skipAIInterpretation: skipInterpreter === true,
        language,
        // Where the product must ARRIVE — drives the delivery dimension of
        // purchase readiness and the customs-border rule in CostEngine.
        // Never conflated with which countries Capucine searches in.
        destinationCountry: DEFAULT_COUNTRY,
      };

      // ── Execute pipeline ──────────────────────────────────────────────────
      const result = await engine.search(searchRequest);

      // ── Create a continuable session ────────────────────────────────────────
      // createSession() only returns an id when the backend has an actual
      // clarification question to ask (unchanged contract). Every OTHER
      // completed search still gets a session via createFollowUpSession(),
      // so the user can continue conversationally afterwards — "uniquement
      // du neuf", "élargis à 1100€", "et avec 32 Go ?" — via POST /clarify
      // without a questionId (see below). The sessionId is always returned.
      const sessionId = conversationManager.createSession(
        effectiveUserId,
        query.trim(),
        profile,
        result
      ) ?? conversationManager.createFollowUpSession(
        effectiveUserId,
        query.trim(),
        profile,
        result
      );

      // ── Serialize ─────────────────────────────────────────────────────────
      return res.json(serializeResult(result, sessionId));

    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /clarify
   *
   * Continues a search session — either by answering a specific clarification
   * question the backend asked, OR by sending a free-form conversational
   * follow-up that refines the current search (megaprompt PARTIE 1/3):
   * "uniquement du neuf", "élargis à 1100€", "et avec 32 Go ?".
   *
   * Request body:
   * {
   *   "sessionId": "sess-...",         // required — from any previous POST /search
   *   "questionId": "clarif-0",        // required — see FOLLOWUP_QUESTION_ID below
   *   "answer": "500 euros max"        // required — the user's free-text answer/follow-up
   * }
   *
   * questionId selects which of the two modes this is:
   *   - a real pending question id (from clarifications.questions[].id) → answers
   *     that specific question (unchanged behavior/contract).
   *   - the FOLLOWUP_QUESTION_ID sentinel → `answer` is interpreted as a free-form
   *     refinement of the CURRENT search (works even when there was no pending
   *     clarification question — every POST /search response now carries a
   *     continuable sessionId, see createFollowUpSession()).
   * questionId stays REQUIRED either way (never silently inferred) so a
   * client always states explicitly which mode it means.
   *
   * Response: same shape as POST /search, with updated results.
   *
   * INVARIANT 5: The original query text is NEVER modified — clarification
   * answers extend it via enrichedQuery; follow-ups extend the criteria
   * snapshot instead (see ConversationManager.applyFollowUp()). Either way
   * the engine re-runs the real pipeline — no shortcut, no fabricated delta.
   */
  app.post('/clarify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, questionId, answer } = req.body as {
        sessionId?: string;
        questionId?: string;
        answer?: string;
      };

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'MISSING_SESSION_ID', message: '"sessionId" is required.' });
      }
      if (!questionId || typeof questionId !== 'string') {
        return res.status(400).json({ error: 'MISSING_QUESTION_ID', message: '"questionId" is required.' });
      }
      if (!answer || typeof answer !== 'string' || answer.trim().length === 0) {
        return res.status(400).json({ error: 'MISSING_ANSWER', message: '"answer" is required and must be non-empty.' });
      }

      // Look up session (validates ownership if userId was set)
      const session = conversationManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'SESSION_NOT_FOUND',
          message: 'Session not found or expired. Please start a new search.',
        });
      }

      if (questionId === FOLLOWUP_QUESTION_ID) {
        // ── Free-form conversational follow-up ──────────────────────────────
        const followUp = engine.interpretFollowUp(answer, session.userId, session.destinationCountry);
        const followUpResult = conversationManager.applyFollowUp(sessionId, answer, followUp.criteria, undefined, {
          rankingPreference: followUp.rankingPreference ?? undefined,
          internationalIntent: followUp.internationalIntent ?? undefined,
          resultLimit: followUp.resultLimit ?? undefined,
          excludeMerchantName: followUp.excludeMerchantName ?? undefined,
          retryIntent: followUp.retryIntent ?? undefined,
          // "pour écouter de la musique, surtout dans les transports" said on
          // turn 2 — merged into the session so turns 3, 4… still know it.
          usageContext: followUp.usageContext ?? undefined,
        });
        const updatedSession = followUpResult.updatedSession;

        // targetCountries → search languages (COUNTRY_TO_SEARCH_LANGUAGE),
        // minus the language already used for phase 1-2 — a "cherche aussi
        // en France" on a French search would otherwise ask
        // RealWebDiscoveryStrategy to redundantly re-query in French.
        const additionalSearchLanguages = [...new Set(
          updatedSession.targetCountries
            .map(c => COUNTRY_TO_SEARCH_LANGUAGE[c])
            .filter((l): l is SupportedLanguage => !!l && l !== updatedSession.language)
        )];

        const searchRequest: SearchRequest = {
          // session.searchText (NOT originalQuery) — clean product terms
          // only, no budget/RAM noise. preInterpretedCriteria makes the
          // engine skip re-interpretation, so queryText's only remaining
          // job this turn is driving discovery search terms; see
          // ConversationSession.searchText's doc comment for why the raw
          // original text would otherwise pollute them.
          queryText: session.searchText,
          requestId: `followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          profile: session.profile,
          preInterpretedCriteria: followUpResult.mergedCriteria,
          skipAIInterpretation: true,
          // Explicit — searchText is often too short for reliable re-detection
          // (see ConversationSession.language's doc comment). Reuses the
          // language resolved for the ORIGINAL search instead.
          language: session.language,
          additionalSearchLanguages,
          // Replayed explicitly: this turn skips interpretation, so the engine
          // cannot re-derive the usage from the (deliberately stripped) search
          // text. Everything the user has said about usage so far, in one place.
          usageContext: updatedSession.usageContext,
          destinationCountry: updatedSession.destinationCountry,
        };

        const result = await engine.search(searchRequest);
        conversationManager.updateResult(sessionId, result);

        return res.json(serializeResult(result, sessionId, {
          turn: updatedSession.turn,
          originalQuery: session.originalQuery,
          answeredQuestions: updatedSession.answeredQuestions.map(aq => ({
            questionId: aq.questionId,
            question: aq.question,
            answer: aq.answer,
          })),
          remainingQuestions: updatedSession.unansweredQuestions.length,
        }, {
          rankingPreference: updatedSession.rankingPreference,
          targetCountries: updatedSession.targetCountries,
          destinationCountry: updatedSession.destinationCountry,
          resultLimit: updatedSession.resultLimit,
          excludedMerchantNames: updatedSession.excludedMerchantNames,
          excludedOfferIds: updatedSession.excludedOfferIds,
        }));
      }

      // ── Answering a specific pending clarification question (unchanged) ──
      let applyResult;
      try {
        applyResult = conversationManager.applyAnswer(sessionId, questionId, answer);
      } catch (err) {
        return res.status(400).json({
          error: 'INVALID_QUESTION_ID',
          message: err instanceof Error ? err.message : 'Invalid questionId.',
        });
      }

      // Re-run the full search pipeline with the enriched query
      const searchRequest: SearchRequest = {
        queryText: applyResult.enrichedQuery,
        requestId: `clarify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        profile: session.profile,
        preInterpretedCriteria: [],
        skipAIInterpretation: false,
      };

      const result = await engine.search(searchRequest);

      // Update the session with the new result
      conversationManager.updateResult(sessionId, result);

      // Serialize — same session ID, so client can ask more questions
      return res.json(serializeResult(result, sessionId, {
        turn: applyResult.updatedSession.turn,
        originalQuery: session.originalQuery,
        answeredQuestions: applyResult.updatedSession.answeredQuestions.map(aq => ({
          questionId: aq.questionId,
          question: aq.question,
          answer: aq.answer,
        })),
        remainingQuestions: applyResult.updatedSession.unansweredQuestions.length,
      }));

    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /prepare-cart
   *
   * Takes ONE offer the user has already been shown and prepares its
   * purchase — the last step before the user leaves for the merchant.
   *
   * Request body:
   * {
   *   "sessionId": "sess-...",   // required — from a previous POST /search
   *   "offerId": "web-fnac-3",   // required — `results[].offerId` of that search
   *   "quantity": 1              // optional, default 1
   * }
   *
   * WHY THE OFFER IS LOOKED UP, NOT POSTED
   * ──────────────────────────────────────
   * The client sends an id, never an offer object. The offer — and above all
   * its purchase URL — is read back from the session's own last result, so
   * the link handed to the user is always one Capucine actually discovered
   * and recorded provenance for. Accepting an offer body would let a caller
   * hand Capucine any URL and have Capucine present it to the user as a
   * vetted result.
   *
   * INVARIANTS
   * - NEVER completes a purchase. The response is a link plus instructions;
   *   payment and final confirmation happen on the merchant's site, by the
   *   user (NO_SILENT_MODIFICATION).
   * - NEVER invents a URL. An offer with no verified executionUrl returns
   *   status 'unavailable' (see cart-preparation-engine.ts).
   * - Reads the ranking, never writes to it. Whether an offer can be
   *   prepared has no bearing on where it ranked (EXECUTION_INDEPENDENCE).
   */
  app.post('/prepare-cart', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, offerId, quantity } = req.body as {
        sessionId?: string;
        offerId?: string;
        quantity?: number;
      };

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'MISSING_SESSION_ID', message: '"sessionId" is required.' });
      }
      if (!offerId || typeof offerId !== 'string') {
        return res.status(400).json({ error: 'MISSING_OFFER_ID', message: '"offerId" is required.' });
      }

      // Quantity must be a positive integer. A malformed value is rejected
      // rather than silently coerced to 1 — the user asked for something
      // specific and we must not quietly change it.
      let requestedQuantity = 1;
      if (quantity !== undefined) {
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
          return res.status(400).json({
            error: 'INVALID_QUANTITY',
            message: '"quantity" must be a positive integer.',
          });
        }
        requestedQuantity = quantity;
      }

      const session = conversationManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'SESSION_NOT_FOUND',
          message: 'Session not found or expired. Please start a new search.',
        });
      }

      // Only offers that actually survived admissibility and were RANKED can
      // be prepared. A candidate rejected for violating a hard constraint is
      // not purchasable through Capucine — offering it here would reintroduce
      // by the back door exactly what AdmissibilityEngine filtered out.
      const rankedOffer = session.lastResult?.ranking.rankedOffers.find(ro => ro.offer.id === offerId);
      if (!rankedOffer) {
        return res.status(404).json({
          error: 'OFFER_NOT_FOUND',
          message: 'This offer is not part of the current results for this session.',
        });
      }

      const preparation = await cartPreparationEngine.prepare({
        offer: rankedOffer.offer,
        quantity: requestedQuantity,
      });

      return res.json({
        sessionId,
        offerId,
        quantity: requestedQuantity,
        status: preparation.status,
        // Null rather than absent when unknown — an unknown URL is reported
        // as unknown, never omitted in a way a client might read as "pending".
        checkoutUrl: preparation.checkoutUrl ?? null,
        nextAction: preparation.nextAction ?? null,
        error: preparation.error ?? null,
        // Purchase tracking fields
        merchantCartId: preparation.merchantCartId ?? null,
        webhookUrl: preparation.webhookUrl ?? null,
        purchaseInitiatedAt: preparation.purchaseInitiatedAt?.toISOString() ?? null,
        merchant: {
          id: rankedOffer.offer.merchant.id,
          name: rankedOffer.offer.merchant.name,
        },
        // Restated so a client never has to re-derive it: Capucine has not
        // bought anything and never will.
        purchaseCompleted: false,
      });
    } catch (err) {
      return next(err);
    }
  });

  // ── Error handler ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // NEVER expose stack traces in responses — log them server-side only
    console.error('[CapucineAPI] Unhandled error:', err.message);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    });
  });

  return app;
}

// ============================================================================
// RESULT SERIALIZER
// ============================================================================

/**
 * Serialize SearchEngineResult to a clean JSON-safe structure.
 *
 * We don't expose the full internal result to the API consumer — only the
 * fields relevant to a calling client. Internal timing, raw admissibility
 * objects, etc. are reduced to summary form.
 */
interface ConversationContext {
  turn: number;
  originalQuery: string;
  answeredQuestions: Array<{ questionId: string; question: string; answer: string }>;
  remainingQuestions: number;
}

/**
 * Translates the internal MatchQuality value into a user-facing label, in
 * `language`. The interface must NEVER show the raw enum value (e.g.
 * 'exact_match') — see mégaprompt §9. Codes registered by
 * explanation-engine.ts (MATCH_EXACT etc.) so fr/en (and future locales)
 * agree in one place.
 */
function describeMatchQuality(quality: SearchMatchQuality | undefined, language: SupportedLanguage): string {
  switch (quality) {
    case 'exact_match':
      return translate('MATCH_EXACT', language);
    case 'close_match':
      return translate('MATCH_CLOSE', language);
    case 'partial_match':
      return translate('MATCH_PARTIAL', language);
    case 'alternative':
      return translate('MATCH_ALTERNATIVE', language);
    case 'unknown':
    default:
      return translate('MATCH_UNKNOWN', language);
  }
}

function serializeResult(
  result: ReturnType<CapucineEngine['searchSync']>,
  sessionId?: string,
  conversation?: ConversationContext,
  sessionState?: {
    rankingPreference: RankingPreference;
    targetCountries: string[];
    destinationCountry: string;
    resultLimit?: number;
    excludedMerchantNames?: string[];
    excludedOfferIds?: string[];
  }
): object {
  // "montre-moi les moins chers" reorders PriorityEngine's already-ranked
  // output using real cost (product + shipping + known fees), it never
  // re-evaluates admissibility/relevance — see ranking-preference.ts. Every
  // result carries its CostBreakdown regardless of preference, since "is
  // the cost known" is useful information on its own (mégaprompt PARTIE 10).
  const rankingPreference = sessionState?.rankingPreference ?? DEFAULT_RANKING_PREFERENCE;
  let preferenceResult = sortByPreference(result.ranking.rankedOffers, rankingPreference);

  // "exclue Amazon" — filtered at presentation time (free-text merchant
  // name, not a catalog id — see extractMerchantExclusion()). Applied AFTER
  // ranking, never re-runs discovery/admissibility for fewer candidates.
  const excludedNames = sessionState?.excludedMerchantNames ?? [];
  if (excludedNames.length > 0) {
    const excludedOffers = preferenceResult.offers.filter(ro =>
      excludedNames.some(name => ro.offer.merchant.name.toLowerCase().includes(name.toLowerCase()))
    );
    preferenceResult = {
      ...preferenceResult,
      offers: preferenceResult.offers.filter(ro => !excludedOffers.includes(ro)),
    };
  }

  // "trouve une meilleure offre" — excludes PRODUCTS already shown across
  // this conversation (see ConversationSession.excludedOfferIds /
  // SeenOffers), so a re-run genuinely surfaces something new instead of
  // repeating the same top result CapucineEngine's deterministic ranking
  // would otherwise produce again.
  const excludedProductIds = sessionState?.excludedOfferIds ?? [];
  if (excludedProductIds.length > 0) {
    preferenceResult = {
      ...preferenceResult,
      offers: preferenceResult.offers.filter(ro => !excludedProductIds.includes(ro.offer.productId)),
    };
  }

  // "montre-moi les 3 meilleures" — a pure presentation cap, applied last
  // (after reordering/exclusion) so it always caps the FINAL list the user
  // actually sees.
  const resultLimit = sessionState?.resultLimit;
  if (resultLimit !== undefined) {
    preferenceResult = { ...preferenceResult, offers: preferenceResult.offers.slice(0, resultLimit) };
  }

  return {
    requestId: result.requestId,
    completedAt: result.completedAt.toISOString(),
    durationMs: result.durationMs,

    // Effective query language actually used to drive interpretation and
    // Web-search phrasing (see CapucineEngine.search()'s resolveLanguage()) —
    // explicit request.language > detected from query text > profile > 'fr'.
    language: result.language,

    // Multi-turn session (present only when there are/were clarification questions)
    session: sessionId ? { sessionId, ...(conversation ?? {}) } : null,

    // rankingPreference: which preference produced this order (`applied`
    // is false for a preference that's accepted but not yet implemented —
    // e.g. BEST_VALUE — so the order silently stayed BEST_MATCH; never
    // claim a preference was honored when it wasn't).
    rankingPreference: { preference: preferenceResult.preference, applied: preferenceResult.applied },

    // destination: where the user would receive the product (FR by default)
    // vs. which countries Capucine actually searched IN this turn — kept
    // separate on purpose (mégaprompt PARTIE 4: never conflate destination
    // with search scope).
    destination: {
      destinationCountry: sessionState?.destinationCountry ?? DEFAULT_COUNTRY,
      targetCountries: sessionState?.targetCountries ?? [DEFAULT_COUNTRY],
    },

    // Ranked results (in the order `rankingPreference` above produced)
    results: preferenceResult.offers.map((ro, idx) => ({
      rank: idx + 1,
      offerId: ro.offer.id,
      productId: ro.offer.productId,
      merchant: {
        id: ro.offer.merchant.id,
        name: ro.offer.merchant.name,
      },
      // verifiedAt/source let a client honestly say "prix vérifié sur cette
      // page à telle date" (mégaprompt PARTIE 10) instead of an unqualified
      // price — null whenever the price's own provenance wasn't recorded
      // (e.g. the local in-memory catalog's fixed test prices), never guessed.
      price: ro.offer.price.value !== null ? {
        amount: ro.offer.price.value,
        currency: ro.offer.currency,
        status: ro.offer.price.status,
        verifiedAt: ro.offer.price.provenance?.retrievedAt?.toISOString() ?? null,
        source: ro.offer.price.provenance?.source ?? null,
      } : null,
      // Real total cost (CostEngine) — NEVER just `price` re-labeled.
      // certainty is 'known' only when every component (shipping/taxes/
      // importDuties/fees) was actually reported by a source; otherwise
      // 'partially_known'/'unknown' — see cost-engine.ts. unknownComponents
      // names exactly what's missing so a client can render "+ frais de
      // douane inconnus" instead of a false total.
      cost: (() => {
        // The engine computed the cost ONCE, with the delivery destination in
        // hand (so duties inside a customs union are 'not_applicable' rather
        // than 'unknown'). Prefer it; fall back to the presentation-time
        // computation only if it is somehow absent.
        const engineCost = result.costs?.get(ro.offer.id) ?? ro.cost;
        const exp = result.explanation.rankedExplanations.find(e => e.offerId === ro.offer.id);
        return {
          totalKnown: engineCost.totalKnown,
          currency: engineCost.currency,
          certainty: engineCost.certainty,
          unknownComponents: engineCost.unknownComponents,
          componentStates: engineCost.componentStates,
          containsEstimate: engineCost.containsEstimate,
          statement: exp?.cost?.statement ?? null,
          budgetWarning: exp?.cost?.budgetWarning ?? null,
        };
      })(),
      // Language-independent — translate(code, result.language) at render
      // time, same reasonCode/translate() pattern as `explanation` below.
      rankingReasonCode: reasonCodeFor(rankingPreference, ro, idx + 1),
      score: Math.round(ro.overallScore),
      satisfiesAllConstraints: ro.satisfiesAllConstraints,
      // Localized in result.language (i18n.ts translate()) from the
      // language-independent headlineCode ExplanationEngine produced — falls
      // back to the French `.headline` text only if code/params are absent
      // (defensive; ExplanationEngine always sets both today).
      explanation: (() => {
        // Looked up by offer id, NOT array index — `preferenceResult.offers`
        // may be in a DIFFERENT order than result.explanation.rankedExplanations
        // (PriorityEngine's original order) once a non-BEST_MATCH preference
        // has reordered them (see sortByPreference() above).
        const exp = result.explanation.rankedExplanations.find(e => e.offerId === ro.offer.id);
        if (!exp) return '';
        return exp.headlineCode
          ? translate(exp.headlineCode, result.language, exp.headlineParams)
          : exp.headline;
      })(),
      matchQuality: describeMatchQuality(ro.offer.matchQuality, result.language),
      // Can this actually be bought? Each dimension separately, each with its
      // own unknown state — 'unknown' is never rendered as 'unavailable'.
      readiness: (() => {
        const exp = result.explanation.rankedExplanations.find(e => e.offerId === ro.offer.id);
        if (!exp?.readiness) return null;
        return {
          ready: exp.readiness.ready,
          pending: exp.readiness.pending,
          blocked: exp.readiness.blocked,
          details: exp.readiness.details,
          statement: exp.readiness.statement,
        };
      })(),
      // How solid the evidence is. Informational only — it never decided
      // whether this offer is here.
      dataQuality: (() => {
        const exp = result.explanation.rankedExplanations.find(e => e.offerId === ro.offer.id);
        if (!exp?.dataQuality) return null;
        return {
          overall: exp.dataQuality.overall,
          priceConfidence: exp.dataQuality.priceConfidence,
          missingForConstraints: exp.dataQuality.missingForConstraints,
          statement: exp.dataQuality.statement,
        };
      })(),
      // Usage-context contribution, kept in its OWN field and never folded
      // into `explanation` or `criteria` above: what the user asked for and
      // what Capucine inferred was relevant must stay tellable apart.
      // `bonus` is always >= 0 — an unknown attribute costs an offer nothing.
      contextualRelevance: ro.contextualRelevance ? {
        bonus: ro.contextualRelevance.bonus,
        maxBonus: ro.contextualRelevance.maxBonus,
        statement: result.explanation.rankedExplanations
          .find(e => e.offerId === ro.offer.id)?.contextual?.statement ?? null,
        signals: ro.contextualRelevance.signals.map(sig => ({
          signal: sig.signal,
          outcome: sig.outcome,
          attribute: sig.attribute ?? null,
          points: sig.contribution,
          reasoning: sig.reasoning,
        })),
      } : null,
      offerUrl: ro.offer.executionUrl ?? null,
      // Per-criterion breakdown, exposing the SATISFIED / VIOLATED / UNKNOWN
      // distinction the admissibility engine already computes (see
      // domain/admissibility.ts) — 'dataUsed.status' is the authoritative
      // signal (not re-derived from score alone), so UNKNOWN never gets
      // silently reported as VIOLATED or SATISFIED. requiredOrForbidden
      // marks which criteria are hard constraints vs soft preferences, so
      // the UI can group "your criteria" separately from "nice to have".
      criteria: ro.criterionScores.map(cs => ({
        id: cs.criterionId,
        name: cs.criterionName,
        level: cs.level,
        requiredOrForbidden: cs.level === 'required' || cs.level === 'forbidden',
        status: cs.dataUsed.status === 'unknown'
          ? 'unknown'
          : (cs.score >= 50 ? 'satisfied' : 'violated'),
        reasoning: cs.reasoning,
      })),
      // Provenance: which source(s) contributed to this offer's data.
      // '+' separator means data was merged from multiple sources.
      // CONFLICTING fields are tracked here — a '+' in source means multi-source merge occurred.
      provenance: {
        source: ro.offer.provenance?.source ?? 'unknown',
        reliability: ro.offer.provenance?.reliability ?? null,
      },
    })),

    // Summary
    summary: {
      totalFound: result.ranking.rankedOffers.length,
      totalRejected: result.admissibility.rejectedOffers.length,
      // Localized in result.language — falls back to the French text only
      // defensively (resultSummaryCode is always set by ExplanationEngine).
      resultSummary: result.explanation.resultSummaryCode
        ? translate(result.explanation.resultSummaryCode, result.language, result.explanation.resultSummaryParams)
        : result.explanation.resultSummary,
    },

    // Criteria used (transparency)
    effectiveCriteria: result.effectiveCriteria.map(c => ({
      id: c.id,
      name: c.name,
      level: c.level,
    })),

    // If BasicPatternInterpreter ran, expose what it found
    interpretation: result.interpretedRequest ? {
      confidence: result.interpretedRequest.confidence,
      extractedCriteria: result.interpretedRequest.extractedCriteria.map(c => ({
        id: c.id,
        name: c.name,
        level: c.level,
      })),
      ambiguities: result.interpretedRequest.ambiguities.length,
      // Typed attributes with their provenance and confidence — what Capucine
      // understood, and how sure it is. Includes the ones deliberately too
      // uncertain to filter on, so a client can show them without them ever
      // having rejected an offer.
      attributes: (result.interpretedRequest.attributes ?? []).map(a => ({
        kind: a.kind,
        criterionId: a.criterionId,
        classification: a.classification,
        confidence: a.provenance.confidence,
        matchedText: a.provenance.matchedText,
        values: a.values ?? null,
        quantity: a.quantity
          ? { operator: a.quantity.operator, value: a.quantity.value, unit: a.quantity.unit, normalized: a.quantity.normalized }
          : null,
      })),
    } : null,

    // What Capucine understood about HOW the product will be used. Reported
    // with its provenance (source/confidence/matchedText) so a client can say
    // "vous avez indiqué…" only when the user really did.
    usageContext: result.usageContext ? {
      usage: result.usageContext.usage,
      context: result.usageContext.context ?? null,
      source: result.usageContext.source,
      confidence: result.usageContext.confidence,
      matchedText: result.usageContext.matchedText ?? null,
      additional: (result.usageContext.additional ?? []).map(entry => ({
        usage: entry.usage,
        context: entry.context ?? null,
        source: entry.source,
        confidence: entry.confidence,
        matchedText: entry.matchedText ?? null,
      })),
    } : null,

    // Clarification opportunities (if any)
    clarifications: result.clarifications.opportunities.length > 0 ? {
      count: result.clarifications.opportunities.length,
      canProceed: result.clarifications.canProceedWithoutClarification,
      questions: result.clarifications.recommendedQuestions.map(q => ({
        id: q.id,
        urgency: q.urgency,
        question: q.suggestedQuestion,
      })),
    } : null,

    // No-results diagnosis (only present when 0 results). message/description/
    // impact are localized in result.language from the (code, params) pair
    // NoResultsAnalyzer produced — same split as `explanation` above.
    noResultsDiagnosis: result.noResultsDiagnosis ? {
      primaryCause: result.noResultsDiagnosis.primaryCause,
      message: translate(result.noResultsDiagnosis.diagnosisCode, result.language, result.noResultsDiagnosis.diagnosisParams),
      recoveryOptions: result.noResultsDiagnosis.recoveryOptions.map(r => ({
        id: r.id,
        type: r.type,
        description: translate(r.descriptionCode, result.language, r.descriptionParams),
        impact: translate(r.impactCode, result.language),
        requiresConfirmation: r.requiresUserConfirmation,
      })),
    } : null,

    // Search plan (what strategy was used, what escalation levels were tried)
    searchPlan: {
      rarityLevel: result.searchPlan.rarityLevel,
      estimatedAvailability: result.searchPlan.estimatedAvailability,
      escalationLevel: result.searchPlan.expansion.currentLevel,
      attemptedLevels: result.searchPlan.expansion.attemptedLevels,
      primaryTerms: result.searchPlan.query.primaryTerms,
      alternativeTerms: result.searchPlan.query.alternativeTerms ?? [],
    },

    // Provenance summary — which sources contributed to the ranked results
    provenanceSummary: result.provenanceSummary,

    // Search coverage (SearchCoverage — see application/search-coverage.ts):
    // real counts from THIS search only (queries executed, sources
    // attempted/failed, unique domains, saturation) — never fabricated, and
    // absent entirely when the discovery strategy that ran didn't compute
    // one (e.g. the local in-memory catalog path, which isn't a multi-phase
    // Web search and has nothing to report here).
    coverage: result.discovery.statistics.coverage ?? null,

    // Pipeline timing (for debugging/monitoring)
    timing: result.timing,
  };
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Start the server.
 *
 * Usage:
 *   PORT=3001 node dist/api/server.js
 *
 * The PORT environment variable controls the listening port.
 * Default: 3001 (avoid conflict with common dev servers on 3000).
 */
export function startServer(port?: number): void {
  const app = buildApp();
  const listenPort = port ?? parseInt(process.env['PORT'] ?? '3001', 10);

  app.listen(listenPort, () => {
    console.log(`[CapucineAPI] Server listening on port ${listenPort}`);
    console.log(`[CapucineAPI] POST http://localhost:${listenPort}/search`);
    console.log(`[CapucineAPI] GET  http://localhost:${listenPort}/health`);
    console.log(`[CapucineAPI] GET  http://localhost:${listenPort}/tools`);
  });
}

// Auto-start if this file is the entry point
// ESM equivalent of `if (require.main === module)`
const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMain) {
  startServer();
}
