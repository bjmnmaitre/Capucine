/**
 * Capucine — HTTP API Layer
 *
 * Minimal Express server exposing the Capucine search pipeline via HTTP.
 *
 * Routes:
 *   POST /search     → Full pipeline → SearchEngineResult (JSON)
 *   GET  /health     → Service status
 *   GET  /tools      → List of registered tools and their availability
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
import { CapucineEngine, SearchRequest } from '../application/capucine-engine';
import { buildDefaultToolRegistry } from '../application/tools';
import { detectWebSearchAdapter } from '../application/web-search-adapters';
import { buildAIOrchestrator } from '../application/ai-providers';
import { InMemoryProfileStore } from '../application/profile-store';
import { ConversationManager } from '../application/conversation-manager';
import { PreferenceCriterion } from '../domain/types';

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

  // AI orchestrator — uses real providers if keys are set, MockAI otherwise
  const aiSetup = buildAIOrchestrator();
  if (aiSetup.status === 'real') {
    console.log(`[CapucineAPI] AI providers: ${aiSetup.configured.join(', ')}`);
  } else {
    console.log(`[CapucineAPI] AI providers: MockAI (set ANTHROPIC_API_KEY or OPENAI_API_KEY for real AI)`);
  }

  // Web search adapter status
  const webAdapter = detectWebSearchAdapter();
  if (webAdapter.isConfigured()) {
    console.log(`[CapucineAPI] Web search: ${webAdapter.adapterName} (configured)`);
  } else {
    console.log(`[CapucineAPI] Web search: NOT_EXECUTABLE (set BRAVE_API_KEY or SERPER_API_KEY)`);
  }

  // Profile store — in-memory for now (swap for PostgresProfileStore in production)
  // ARCHITECTURAL NOTE: This is a stateless replacement point. The store is injected
  // here; CapucineEngine itself never touches storage.
  const profileStore = new InMemoryProfileStore();

  // Conversation manager — tracks multi-turn clarification sessions (30-min TTL)
  const conversationManager = new ConversationManager();

  // Tool registry — the single registry for this server process.
  // Shared with the engine so both use the same audit log and rate-limit counters.
  // In production this is the ONLY path tool calls take (enforces timeout/rate-limit/audit).
  const toolRegistry = buildDefaultToolRegistry(webAdapter);

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
          status: webAdapter.isConfigured() ? 'configured' : 'not_configured',
          adapter: webAdapter.adapterName,
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
      const { query, requestId, userId, criteria, skipInterpreter } = req.body as {
        query?: string;
        requestId?: string;
        userId?: string;
        criteria?: PreferenceCriterion[];
        skipInterpreter?: boolean;
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
      };

      // ── Execute pipeline ──────────────────────────────────────────────────
      const result = await engine.search(searchRequest);

      // ── Create clarification session (if needed) ──────────────────────────
      // Session is created only when clarification opportunities exist.
      // The sessionId is returned to the client for use with POST /clarify.
      const sessionId = conversationManager.createSession(
        effectiveUserId,
        query.trim(),
        profile,
        result
      );

      // ── Serialize ─────────────────────────────────────────────────────────
      return res.json(serializeResult(result, sessionId ?? undefined));

    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /clarify
   *
   * Continue a search session by answering a clarification question.
   *
   * Request body:
   * {
   *   "sessionId": "sess-...",      // required — from a previous POST /search response
   *   "questionId": "clarif-0",     // required — which question is being answered
   *   "answer": "500 euros max"     // required — the user's free-text answer
   * }
   *
   * Response: same shape as POST /search, with updated results reflecting the answer.
   *
   * INVARIANT 5: The answer is appended to context — the original query is NEVER modified.
   * The engine re-runs interpretation on the enriched text, which may produce refined criteria.
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

      // Apply the answer → enriched query
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

function serializeResult(
  result: ReturnType<CapucineEngine['searchSync']>,
  sessionId?: string,
  conversation?: ConversationContext
): object {
  return {
    requestId: result.requestId,
    completedAt: result.completedAt.toISOString(),
    durationMs: result.durationMs,

    // Multi-turn session (present only when there are/were clarification questions)
    session: sessionId ? { sessionId, ...(conversation ?? {}) } : null,

    // Ranked results (most relevant first)
    results: result.ranking.rankedOffers.map((ro, idx) => ({
      rank: idx + 1,
      offerId: ro.offer.id,
      productId: ro.offer.productId,
      merchant: {
        id: ro.offer.merchant.id,
        name: ro.offer.merchant.name,
      },
      price: ro.offer.price.value !== null ? {
        amount: ro.offer.price.value,
        currency: ro.offer.currency,
        status: ro.offer.price.status,
      } : null,
      score: Math.round(ro.overallScore),
      satisfiesAllConstraints: ro.satisfiesAllConstraints,
      explanation: result.explanation.rankedExplanations[idx]?.headline ?? '',
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
      resultSummary: result.explanation.resultSummary,
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

    // No-results diagnosis (only present when 0 results)
    noResultsDiagnosis: result.noResultsDiagnosis ? {
      primaryCause: result.noResultsDiagnosis.primaryCause,
      message: result.noResultsDiagnosis.diagnosis,
      recoveryOptions: result.noResultsDiagnosis.recoveryOptions.map(r => ({
        type: r.type,
        description: r.description,
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
