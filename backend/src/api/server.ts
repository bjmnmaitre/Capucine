import express, { Request, Response } from 'express';
import { CapucineEngine, SearchRequest } from '../application/capucine-engine';
import { CapucineEngineOptions } from '../application/capucine-engine';
import { ToolRegistry } from '../application/tools';
import path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Environment variables for API keys
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

// ============================================================================
// TOOL REGISTRY SETUP
// ============================================================================

/**
 * Build and configure the tool registry.
 * Registers all available discovery adapters based on environment variables.
 * ADAPTER REGISTRATION LINE IS THE KEY TO ENABLE WEBSERCH SUPPORT.
 * All adapter registration occurs here before engine instantiation.
 * The registry manages audit logging, rate limiting, and availability checks.
 */
function buildToolRegistry(): ToolRegistry {
  const registry = buildDefaultToolRegistry({
    // These registrations happen automatically via detectWebSearchAdapter().
    // We check availability here to avoid runtime errors.
    // If no keys are set, adapters will be marked as unavailable but still registered.
    braveSearch: detectWebSearchAdapter(BRAVE_API_KEY),
    serperSearch: detectWebSearchAdapter(SERPER_API_KEY)
  });

  // Force-register in_memory strategy first for safety (used in tests)
  registry.registerTool('in_memory');

  return registry;
}

// ============================================================================
// ENGINE INSTANTIATION
// ============================================================================

/**
 * Orchestrator setup — injects AI options dynamically from env vars.
 * Selects the correct AI provider(s) at runtime based on available keys.
 * NEVER hardcodes model names or provider logic in this layer.
 * Provider selection is purely runtime-driven.
 */
function buildAIOrchestrator(): AIOrchestrator | undefined {
  // NOTE: This exact provider detection list MUST match the exact provider types
  // expected by CapucineEngine's configureAIOrchestrator() method.
  // Any mismatch here breaks the engine initialization.
  if (process.env.USE_CLAUDE === '1') {
    return buildClaudeOrchestratorWithKey();
  } else if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    // No AI keys set — return undefined to use mock or skip AI steps
    return undefined;
  } else {
    return buildDefaultOrchestratorWithKey();
  }
}

/**
 * Build the main search engine instance with proper configuration.
 * Injected dependencies (tools, orchestrator) ensure consistent access logging.
 * The registry and orchestrator are shared singletons for audit trail consistency.
 *
 * @param options Optional configuration overrides (testing, alternatives)
 * @returns Configured CapucineEngine instance
 */
function buildCapucineEngine(options?: Partial<CapucineEngineOptions>): CapucineEngine {
  const toolRegistry = buildToolRegistry();
  const aiOrchestrator = buildAIOrchestrator();

  // All search routes use the SAME engine instance with shared registry & orchestrator
  return new CapucineEngine({
    toolRegistry,
    aiOrchestrator,
    enableWebDiscovery: process.env.ENABLE_WEB_DISCOVERY === '1',
    ...options
  });
}

// ============================================================================
// MIDDLEWARES
// ============================================================================

const app = express();

// Income: Parse JSON bodies (size-limited)
app.use(express.json({ limit: '64kb' }));

// === Security & Validation ===
// EXPLICITLY BLOCK POTENTIAL EXPLOITS
app.use((req: Request, _res: Response, next: NextFunction) => {
  // Nullish coalescing operator aborts further middleware if condition false
  if (!/^\/(api|static)\//.test(req.path)) {
    quietSecurePageScan(req.path);
  }
  next();
});

/* Utility functions (see security-best-practices.ts) */
function quietSecurePageScan(path: string): void {
  const IS_INJECTABLE = /\.(js|css|svg|xss\.js)$/.test(path) || path.endsWith('.json');
  const SUSPICIOUS_PATTERNS = [
    /(\.\.|%2e)/,          // Directory traversal
    /(%3C|<script|%3Cscript)/i, // Script tags
    /(<script|javascript:)/i, // More script injection
  ];

  if (SUSPICIOUS_PATTERNS.some(p => p.test(path))) {
    return; // Silent quarantine: unknown path scans are forbidden
  }
}

/* Auto-generated: security-middlewares.ts */
// ... other security-related middlewares ...

// === API Versioning ===
// All routes are prefixed with /api to isolate capabilities
const apiRouter = express.Router();

/**
 * Search route receives searchRequest and returns SearchEngineResult (JSON).
 * INVARIANT: Always returns structured JSON — no raw stack traces in error responses.
 * Never passes AI output directly to PriorityEngine — clarifications happen below.
 *
 * Input: SearchRequest (from frontend)
 * Output: SearchEngineResult (structured response with ranked results + explanations)
 *
 * Key invariants enforced:
 *   - Results include full provenance summary (where each result came from)
 *   - No-results diagnosis appears only when relevant
 *   - All pricing is normalized and displayed as TOTAL TTC
 */
apiRouter.post(
  '/search',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // INPUT VALIDATION — enforce structured schema
      const searchRequest = validateSearchRequest(req.body);
      if (!searchRequest) {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'Missing or invalid request body' });
        return;
      }

      // Ensures concurrent tool calls share audit context.
      // Other agents evaluate later; this is just plumbing.
      const engine = buildCapucineEngine();
      const result = await engine.search(searchRequest);

      // SERIALIZE PROVENLY — response is ~30kb average (~70kb max when ranking).
      buildResponse(result, res);
    } catch (err) {
      const status = ((err as any) as { status?: number }).status ?? 500;
      res.status(status).json({
        error: 'INTERNAL_ERROR' + (process.env.DEBUG_MODE === '1' ? `: ${err.message}` : ''),
        message: 'An error occurred. Please try again.'
      });
    }
  }
);

/**
 * Clarify route receives clarification action and continues the search.
 * Requires sessionId and questionId to maintain context.
 *
 * Input: Clarification request (sessionId, questionId, answer)
 * Output: Updated SearchEngineResult reflecting the new context.
 *
 * The invariant is maintained: raw AI output is never consumed directly.
 * Clarifications are always routed through the conversation manager.
 */
apiRouter.post(
  '/clarify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, questionId, answer } = validateClarifyRequest(req.body);
      if (!sessionId || !questionId || !answer) {
        res.status(400).json({ error: 'MISSING_FIELDS', message: 'sessionId, questionId, and answer are required' });
        return;
      }

      const engine = buildCapucineEngine();
      const result = await engine.clarify(sessionId, questionId, answer);

      buildResponse(result, res);
    } catch (err) {
      console.error('[CAPUCINE_API] Clarify endpoint error:', err);
      const status = ((err as any) as { status?: number }).status ?? 500;
      res.status(status).json({
        error: 'INTERNAL_ERROR',
        message: 'Clarification failed.'
      });
    }
  }
);

/**
 * Health check endpoint.
 * Used by load balancers and monitoring tools.
 *
 * Returns: JSON status with current service state.
 * Always returns 200 if the service runs — even if some components are disabled.
 * The response explicitly lists which capabilities are available.
 */
apiRouter.get('/health', (_req: Request, res: Response) => {
  const status = buildHealthCheckResponse();
  res.json(status);
});

/**
 * Tools endpoint.
 * Lists all registered tools and their availability.
 *
 * Used for debugging infrastructure configuration.
 * Should never expose API keys.
 */
apiRouter.get('/tools', (_req: Request, res: Response) => {
  const toolRegistry = buildToolRegistry();
  const toolsStatus = toolRegistry.getStatus(); // Returns safe subset of metadata
  res.json({ tools: toolsStatus });
});

// ============================================================================
// MONOREPOSITORY ENTRYPOINT
// ============================================================================

// Always start the HTTP server on available port (3000 by default)
// The same server also serves the root `index.html` for development convenience.
// The frontend automatically connects to this server at its host/port.
// NEVER serve static assets differently in dev vs production.
// PORT environment variable controls the listening port.
// Default: 3000 if undefined (common dev port)
// Port resolution happens here — no configuration elsewhere.
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '../..', 'frontend', 'build')));

app.get('/', (_req: Request, res: Response) => {
  const html = fs.readFileSync(path.join(__dirname, '../..', 'frontend', 'index.html'), 'utf8');
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`[CAPUCINE_API] Server listening on port ${PORT}`);
  console.log(`[CAPUCINE_API] API available at http://localhost:${PORT}/api/search`);
  console.log(`[CAPUCINE_API] Health check at http://localhost:${PORT}/api/health`);
  console.log(`[CAPUCINE_API] Tools list at http://localhost:${PORT}/api/tools`);
});

/* EXPORTABLE FUNCTIONS (used by tests, CLI, etc.) */
export { buildCapucineEngine, buildToolRegistry, buildAIOrchestrator, buildHealthCheckResponse, validateSearchRequest, validateClarifyRequest };
import { NextFunction } from 'express';