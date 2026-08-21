/**
 * Capucine — Tool Abstraction Layer
 *
 * A Tool is an external capability (web search, product DB, image analysis)
 * that Capucine may invoke during discovery.
 *
 * SECURITY INVARIANTS:
 * - No API keys in this file. Keys are injected via environment at runtime.
 * - Tool responses are NEVER injected directly into ranking — they must pass
 *   through NormalizationEngine first (see CapucineEngine pipeline).
 * - Provenance is ALWAYS recorded on ToolResponse so downstream layers
 *   can weight data by source reliability.
 * - Tools NEVER modify the user's request or profile.
 *
 * Architecture:
 *   ToolRegistry.execute(name, request)
 *     → Tool.execute(request) → ToolResponse<T>
 *     → NormalizationEngine → DiscoveryCandidate[]
 *     → (ranking pipeline)
 *
 * Adding a new tool:
 *   1. Implement the Tool<TInput, TOutput> interface
 *   2. Register via ToolRegistry.register()
 *   3. Done — no other code changes required
 */

import { DataProvenance } from '../domain/types';

// ============================================================================
// TOOL REQUEST / RESPONSE
// ============================================================================

/**
 * Input to a tool execution.
 * T is the tool-specific parameter type.
 */
export interface ToolRequest<T = unknown> {
  /** Unique ID for this tool call (for tracing / deduplication) */
  requestId: string;

  /** The tool-specific parameters */
  params: T;

  /** Max time to wait for a response (ms). Tool should respect this. */
  timeoutMs?: number;

  /** Whether to allow cached responses for this request */
  allowCache?: boolean;
}

/**
 * Output from a tool execution.
 * T is the tool-specific result type.
 */
export interface ToolResponse<T = unknown> {
  /** Whether the tool call succeeded */
  success: boolean;

  /** The tool-specific result (present if success = true) */
  data?: T;

  /** Error message (present if success = false) */
  error?: string;

  /** Error code for programmatic handling */
  errorCode?: ToolErrorCode;

  /** Provenance of the data (MUST be populated for ranking safety) */
  provenance: DataProvenance;

  /** How long the tool took (ms) */
  durationMs: number;

  /** Whether the response came from cache */
  fromCache: boolean;

  /** The tool that produced this response */
  toolName: string;
}

export type ToolErrorCode =
  | 'API_KEY_MISSING'      // Tool not configured — no API key
  | 'API_KEY_INVALID'      // API key rejected
  | 'RATE_LIMITED'         // Quota exceeded
  | 'TIMEOUT'              // Exceeded timeoutMs
  | 'NETWORK_ERROR'        // Connection problem
  | 'PARSE_ERROR'          // Response could not be parsed
  | 'NOT_FOUND'            // Resource does not exist
  | 'UNSUPPORTED'          // Tool does not support this request
  | 'INTERNAL_ERROR';      // Unexpected error inside tool

// ============================================================================
// TOOL INTERFACE
// ============================================================================

/**
 * A Tool is a named, versioned capability that executes external requests.
 *
 * All tools must be:
 * - Stateless: no side effects other than the returned ToolResponse
 * - Traceable: provenance always populated in response
 * - Non-blocking on ranking: responses feed NormalizationEngine, never PriorityEngine directly
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Unique, stable identifier for this tool */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Semantic version of this tool implementation */
  readonly version: string;

  /**
   * Whether this tool requires an external API key.
   * If true and key is absent, execute() returns errorCode: 'API_KEY_MISSING'.
   */
  readonly requiresApiKey: boolean;

  /**
   * Whether this tool is currently operational.
   * A tool may be available() = false due to missing config without being broken.
   */
  available(): boolean;

  /**
   * Execute the tool.
   * NEVER throws — errors are returned as ToolResponse.success = false.
   */
  execute(request: ToolRequest<TInput>): Promise<ToolResponse<TOutput>>;
}

// ============================================================================
// TOOL REGISTRY — SECURITY CONFIGURATION
// ============================================================================

/**
 * Security policy for the ToolRegistry.
 *
 * SECURITY INVARIANTS (MEGAPROMPT §security):
 * - No API key ever passes through execute() — keys are read at call-time inside Tool.execute()
 * - Tool names are validated against an allowlist pattern before dispatch
 * - Timeout is enforced by the registry using Promise.race() — tools cannot stall the engine
 * - Rate limiting prevents accidental tight-loop invocations of paid APIs
 * - Every invocation is logged to the audit trail (call time, duration, success)
 */
export interface ToolRegistryConfig {
  /**
   * Default timeout for all tool calls (ms).
   * Individual ToolRequest.timeoutMs overrides this.
   * Default: 10 000 ms.
   */
  defaultTimeoutMs: number;

  /**
   * Maximum number of calls to the same tool within a rolling window.
   * Prevents accidental tight loops from hitting paid APIs.
   * Default: 100 calls / 60 000 ms.
   */
  rateLimitPerTool: { maxCalls: number; windowMs: number };

  /**
   * Tool name allowlist pattern. Tool names not matching are rejected at register() time.
   * Default: /^[a-z0-9_-]{1,64}$/ — lowercase letters, digits, hyphens, underscores.
   */
  toolNamePattern: RegExp;

  /**
   * Whether to record every invocation in an audit log.
   * Useful for debugging; may be disabled in production for performance.
   * Default: true.
   */
  auditEnabled: boolean;
}

const DEFAULT_REGISTRY_CONFIG: ToolRegistryConfig = {
  defaultTimeoutMs: 10_000,
  rateLimitPerTool: { maxCalls: 100, windowMs: 60_000 },
  toolNamePattern: /^[a-z0-9_-]{1,64}$/,
  auditEnabled: true,
};

// ============================================================================
// TOOL REGISTRY — AUDIT LOG
// ============================================================================

export interface ToolAuditEntry {
  id: string;
  toolName: string;
  requestId: string;
  calledAt: Date;
  durationMs: number;
  success: boolean;
  errorCode?: ToolErrorCode;
  fromCache: boolean;
  timedOut: boolean;
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export interface ToolRegistration {
  tool: Tool;
  registeredAt: Date;
  callCount: number;
  errorCount: number;
  lastCalledAt?: Date;
  /** Rolling window timestamps for rate limiting */
  callTimestamps: number[];
}

/**
 * Registry for all tools available in a Capucine instance.
 *
 * SECURITY HARDENING (vs previous version):
 * 1. Tool names validated at register() time — no injection via tool name
 * 2. Timeout enforced with Promise.race() — tools cannot stall the engine indefinitely
 * 3. Per-tool rate limiting — prevents tight loops from burning paid API quotas
 * 4. Full audit trail — every call logged with outcome, duration, and timeout flag
 * 5. Tool responses are NEVER passed directly to ranking (enforced by architecture,
 *    documented here for clarity — see CapucineEngine.normalizeCandidates())
 *
 * Tools that are unavailable (missing config) remain registered
 * so the system can report their status explicitly rather than silently omitting them.
 */
export class ToolRegistry {
  private readonly registry = new Map<string, ToolRegistration>();
  private readonly auditLog: ToolAuditEntry[] = [];
  private readonly config: ToolRegistryConfig;

  constructor(config: Partial<ToolRegistryConfig> = {}) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  /**
   * Register a tool. Replaces any existing tool with the same name.
   *
   * SECURITY: Validates tool.name against the configured allowlist pattern.
   * Rejects registration of tools with names that could cause injection or confusion.
   */
  register(tool: Tool): void {
    if (!this.config.toolNamePattern.test(tool.name)) {
      throw new Error(
        `ToolRegistry: rejected tool name "${tool.name}" — ` +
        `must match ${this.config.toolNamePattern}`
      );
    }
    this.registry.set(tool.name, {
      tool,
      registeredAt: new Date(),
      callCount: 0,
      errorCount: 0,
      callTimestamps: [],
    });
  }

  /**
   * Execute a named tool with timeout enforcement and rate limiting.
   *
   * SECURITY:
   * - Validates toolName before lookup (rejects names that bypass the pattern)
   * - Enforces timeout via Promise.race(); on timeout returns TIMEOUT error, never hangs
   * - Enforces per-tool rate limit; on exceeded returns RATE_LIMITED error
   * - Logs every call to the audit trail regardless of outcome
   * - NEVER throws — all errors are returned as ToolResponse.success = false
   */
  async execute<TInput, TOutput>(
    toolName: string,
    request: ToolRequest<TInput>
  ): Promise<ToolResponse<TOutput>> {
    const startMs = Date.now();
    const auditId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 1. Validate tool name — prevent lookup with injection strings
    if (!this.config.toolNamePattern.test(toolName)) {
      return this.failure<TOutput>(toolName, request.requestId, auditId, startMs, {
        error: `Invalid tool name: "${toolName}"`,
        errorCode: 'UNSUPPORTED',
        timedOut: false,
      });
    }

    // 2. Look up registration
    const registration = this.registry.get(toolName);
    if (!registration) {
      return this.failure<TOutput>(toolName, request.requestId, auditId, startMs, {
        error: `Tool "${toolName}" not found in registry`,
        errorCode: 'UNSUPPORTED',
        timedOut: false,
      });
    }

    // 3. Check tool availability (missing API key, etc.)
    if (!registration.tool.available()) {
      return this.failure<TOutput>(toolName, request.requestId, auditId, startMs, {
        error: `Tool "${toolName}" is not available (check configuration)`,
        errorCode: 'API_KEY_MISSING',
        timedOut: false,
      });
    }

    // 4. Rate limit check
    const now = Date.now();
    const windowMs = this.config.rateLimitPerTool.windowMs;
    const maxCalls = this.config.rateLimitPerTool.maxCalls;
    // Prune timestamps outside the window
    registration.callTimestamps = registration.callTimestamps.filter(t => now - t < windowMs);
    if (registration.callTimestamps.length >= maxCalls) {
      return this.failure<TOutput>(toolName, request.requestId, auditId, startMs, {
        error: `Tool "${toolName}" rate limit exceeded (${maxCalls} calls / ${windowMs}ms)`,
        errorCode: 'RATE_LIMITED',
        timedOut: false,
      });
    }

    // 5. Record call
    registration.callTimestamps.push(now);
    registration.callCount++;
    registration.lastCalledAt = new Date(now);

    // 6. Execute with timeout
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs;
    let response: ToolResponse<TOutput>;
    let timedOut = false;

    try {
      const timeoutPromise = new Promise<ToolResponse<TOutput>>(resolve => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve({
            success: false,
            error: `Tool "${toolName}" timed out after ${timeoutMs}ms`,
            errorCode: 'TIMEOUT',
            provenance: { source: toolName, retrievedAt: new Date() },
            durationMs: timeoutMs,
            fromCache: false,
            toolName,
          } as ToolResponse<TOutput>);
        }, timeoutMs);
        // unref so this timer doesn't keep Node.js alive
        if (typeof timer === 'object' && 'unref' in timer) (timer as NodeJS.Timeout).unref();
      });

      response = await Promise.race([
        registration.tool.execute(request) as Promise<ToolResponse<TOutput>>,
        timeoutPromise,
      ]);
    } catch (err) {
      response = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'INTERNAL_ERROR',
        provenance: { source: toolName, retrievedAt: new Date() },
        durationMs: Date.now() - startMs,
        fromCache: false,
        toolName,
      } as ToolResponse<TOutput>;
    }

    if (!response.success) {
      registration.errorCount++;
    }

    // 7. Audit log
    if (this.config.auditEnabled) {
      this.auditLog.push({
        id: auditId,
        toolName,
        requestId: request.requestId,
        calledAt: new Date(now),
        durationMs: Date.now() - startMs,
        success: response.success,
        errorCode: response.errorCode,
        fromCache: response.fromCache,
        timedOut,
      });
    }

    return response;
  }

  /**
   * Check whether a named tool is registered and available.
   */
  isAvailable(toolName: string): boolean {
    if (!this.config.toolNamePattern.test(toolName)) return false;
    return this.registry.get(toolName)?.tool.available() ?? false;
  }

  /**
   * List the names of registered web-search sources (tools named 'web_search'
   * or 'web_search_<something>' by convention), filtered to those currently
   * available() — never returns a name that's registered but not configured.
   *
   * This is how RealWebDiscoveryStrategy discovers "which Web sources can I
   * query right now" instead of hardcoding a single 'web_search' tool name —
   * a future adapter just registers under 'web_search_<name>' and is picked
   * up automatically, no discovery-engine changes required.
   */
  listWebSearchTools(): string[] {
    return [...this.registry.entries()]
      .filter(([name, reg]) => (name === 'web_search' || name.startsWith('web_search_')) && reg.tool.available())
      .map(([name]) => name);
  }

  /**
   * List all registered tools with their status.
   */
  listTools(): Array<{ name: string; description: string; available: boolean; stats: { calls: number; errors: number; errorRate: number } }> {
    return [...this.registry.entries()].map(([name, reg]) => ({
      name,
      description: reg.tool.description,
      available: reg.tool.available(),
      stats: {
        calls: reg.callCount,
        errors: reg.errorCount,
        errorRate: reg.callCount > 0 ? reg.errorCount / reg.callCount : 0,
      },
    }));
  }

  /**
   * Return a copy of the audit log.
   * INVARIANT: The log is append-only — no entry is ever modified or deleted.
   */
  getAuditLog(): ToolAuditEntry[] {
    return [...this.auditLog];
  }

  /** How many tools are registered */
  size(): number {
    return this.registry.size;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private failure<TOutput>(
    toolName: string,
    requestId: string,
    auditId: string,
    startMs: number,
    opts: { error: string; errorCode: ToolErrorCode; timedOut: boolean }
  ): ToolResponse<TOutput> {
    const durationMs = Date.now() - startMs;
    if (this.config.auditEnabled) {
      this.auditLog.push({
        id: auditId,
        toolName,
        requestId,
        calledAt: new Date(startMs),
        durationMs,
        success: false,
        errorCode: opts.errorCode,
        fromCache: false,
        timedOut: opts.timedOut,
      });
    }
    return {
      success: false,
      error: opts.error,
      errorCode: opts.errorCode,
      provenance: { source: 'tool-registry', retrievedAt: new Date() },
      durationMs,
      fromCache: false,
      toolName,
    } as ToolResponse<TOutput>;
  }
}

// ============================================================================
// CONCRETE TOOLS
// ============================================================================

// ── Tool: WebSearchTool ──────────────────────────────────────────────────────

export interface WebSearchParams {
  /** Search query */
  query: string;
  /** Max number of results (default 10) */
  maxResults?: number;
  /** Restrict to a specific language (ISO 639-1) */
  language?: string;
  /** Restrict to a specific country (ISO 3166-1 alpha-2) */
  country?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  domain: string;
}

export interface WebSearchOutput {
  results: WebSearchResult[];
  totalEstimated?: number;
  searchEngine: string;
}

/**
 * WebSearchTool — searches the web for product information.
 *
 * This tool is a dispatcher: it delegates to a concrete WebSearchAdapter
 * (BraveSearchAdapter, SerperAdapter, etc.) injected at construction.
 *
 * If no adapter is injected, it is NOT_EXECUTABLE (returns API_KEY_MISSING).
 */
export class WebSearchTool implements Tool<WebSearchParams, WebSearchOutput> {
  readonly name: string;
  readonly description = 'Search the web for product pages, reviews, and prices';
  readonly version = '1.0.0';
  readonly requiresApiKey = true;

  /**
   * @param adapter - the concrete search backend for this tool instance.
   * @param name - registry name for this source. Defaults to 'web_search'
   *   (single-source, fully backward compatible). To register several
   *   sources side by side (multi-source discovery), pass a distinct name
   *   per instance — see ToolRegistry.listWebSearchTools() and
   *   buildDefaultToolRegistry(), which does this automatically for each
   *   configured adapter (e.g. 'web_search_brave_search', 'web_search_serper').
   */
  constructor(private readonly adapter?: WebSearchAdapter, name = 'web_search') {
    this.name = name;
  }

  available(): boolean {
    return this.adapter?.isConfigured() ?? false;
  }

  async execute(request: ToolRequest<WebSearchParams>): Promise<ToolResponse<WebSearchOutput>> {
    const start = Date.now();

    if (!this.adapter || !this.adapter.isConfigured()) {
      return {
        success: false,
        error: 'WebSearchTool is NOT_EXECUTABLE: no adapter configured or API key missing. Set BRAVE_API_KEY or SERPER_API_KEY environment variable.',
        errorCode: 'API_KEY_MISSING',
        provenance: { source: this.name, retrievedAt: new Date() },
        durationMs: 0,
        fromCache: false,
        toolName: this.name,
      };
    }

    try {
      const result = await this.adapter.search(request.params, request.timeoutMs);
      return {
        success: true,
        data: result,
        provenance: {
          source: this.adapter.adapterName,
          retrievedAt: new Date(),
        },
        durationMs: Date.now() - start,
        fromCache: false,
        toolName: this.name,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'INTERNAL_ERROR',
        provenance: { source: this.adapter.adapterName, retrievedAt: new Date() },
        durationMs: Date.now() - start,
        fromCache: false,
        toolName: this.name,
      };
    }
  }
}

// ── Tool: ProductSearchTool ──────────────────────────────────────────────────

export interface ProductSearchParams {
  /** Product name or keywords */
  keywords: string[];
  /** Category filter */
  category?: string;
  /** Max price filter */
  maxPrice?: number;
  /** Merchant filter */
  merchantIds?: string[];
}

export interface ProductSearchItem {
  productId: string;
  name: string;
  price?: number;
  currency?: string;
  merchantId: string;
  merchantName: string;
  url?: string;
  imageUrl?: string;
  /** Raw characteristics from the source */
  characteristics: Record<string, unknown>;
}

export interface ProductSearchOutput {
  items: ProductSearchItem[];
  source: string;
}

/**
 * ProductSearchTool — queries structured product databases.
 *
 * Currently uses in-memory data in the absence of a real product API.
 * Future: wire to a product catalog API or database.
 */
export class ProductSearchTool implements Tool<ProductSearchParams, ProductSearchOutput> {
  readonly name = 'product_search';
  readonly description = 'Search structured product databases for offers';
  readonly version = '1.0.0';
  readonly requiresApiKey = false; // Uses in-memory data

  available(): boolean {
    return true; // Always available (in-memory fallback)
  }

  async execute(request: ToolRequest<ProductSearchParams>): Promise<ToolResponse<ProductSearchOutput>> {
    const start = Date.now();

    // In-memory implementation: keyword match on hardcoded catalog
    // Real implementation would query a product API or database
    const items = this.searchInMemory(request.params);

    return {
      success: true,
      data: { items, source: 'in_memory_catalog' },
      provenance: { source: 'in_memory_catalog', retrievedAt: new Date() },
      durationMs: Date.now() - start,
      fromCache: false,
      toolName: this.name,
    };
  }

  private searchInMemory(params: ProductSearchParams): ProductSearchItem[] {
    // Minimal implementation — real discovery uses InMemoryDiscoveryStrategy
    // This tool exists as the integration point for a future product API
    void params; // params used in real implementation
    return [];
  }
}

// ── Tool: ImageAnalysisTool ──────────────────────────────────────────────────

export interface ImageAnalysisParams {
  /** URL of the image to analyze */
  imageUrl: string;
  /** What to extract from the image */
  extractionTargets: Array<'product_type' | 'brand' | 'model' | 'color' | 'condition' | 'text'>;
}

export interface ImageAnalysisOutput {
  /** Extracted product type (if detected) */
  productType?: string;
  /** Extracted brand (if visible) */
  brand?: string;
  /** Extracted model name (if visible) */
  model?: string;
  /** Dominant colors */
  colors?: string[];
  /** Visible text (OCR) */
  visibleText?: string;
  /** Confidence 0-1 for the overall analysis */
  confidence: number;
}

/**
 * ImageAnalysisTool — extracts product information from images.
 *
 * NOT_EXECUTABLE without a vision AI provider configured.
 * Marked explicitly so callers know to handle graceful degradation.
 */
export class ImageAnalysisTool implements Tool<ImageAnalysisParams, ImageAnalysisOutput> {
  readonly name = 'image_analysis';
  readonly description = 'Extract product information from images using vision AI';
  readonly version = '1.0.0';
  readonly requiresApiKey = true;

  // No vision provider injected in base implementation
  available(): boolean {
    return false; // NOT_EXECUTABLE — no vision provider configured
  }

  async execute(request: ToolRequest<ImageAnalysisParams>): Promise<ToolResponse<ImageAnalysisOutput>> {
    void request;
    return {
      success: false,
      error: 'ImageAnalysisTool is NOT_EXECUTABLE: no vision AI provider configured.',
      errorCode: 'API_KEY_MISSING',
      provenance: { source: 'image_analysis', retrievedAt: new Date() },
      durationMs: 0,
      fromCache: false,
      toolName: this.name,
    };
  }
}

// ============================================================================
// WEB SEARCH ADAPTER INTERFACE
// ============================================================================

/**
 * Pluggable web search adapter.
 * Implement this interface to add a new search provider.
 *
 * SECURITY: isConfigured() checks env var presence WITHOUT exposing the value.
 * The actual key read happens inside search() only, never stored on the object.
 */
export interface WebSearchAdapter {
  /** Stable identifier for this adapter */
  readonly adapterName: string;

  /**
   * Returns true if the required environment variable is set.
   * NEVER returns the key value — only a boolean.
   */
  isConfigured(): boolean;

  /**
   * Execute a search query.
   * Throws on network/API errors (caller wraps in try/catch).
   */
  search(params: WebSearchParams, timeoutMs?: number): Promise<WebSearchOutput>;
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Build a ToolRegistry pre-populated with the standard Capucine tools.
 *
 * @param webSearchAdapter - Optional web search adapter(s).
 *   - Omitted: WebSearchTool registered as 'web_search', NOT_EXECUTABLE.
 *   - Single adapter: registered as 'web_search' (unchanged, backward compatible).
 *   - Array of adapters: MULTI-SOURCE — each is registered under its own
 *     'web_search_<adapterName>' name (e.g. 'web_search_brave_search',
 *     'web_search_serper'), so RealWebDiscoveryStrategy can query all of
 *     them via registry.listWebSearchTools(). The registry itself stays
 *     generic — nothing here hardcodes "Brave" or "Serper"; a third adapter
 *     is picked up the same way with zero changes to this function.
 */
export function buildDefaultToolRegistry(webSearchAdapter?: WebSearchAdapter | WebSearchAdapter[]): ToolRegistry {
  const registry = new ToolRegistry();

  if (Array.isArray(webSearchAdapter)) {
    for (const adapter of webSearchAdapter) {
      const suffix = adapter.adapterName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      registry.register(new WebSearchTool(adapter, `web_search_${suffix}`));
    }
  } else {
    registry.register(new WebSearchTool(webSearchAdapter));
  }
  registry.register(new ProductSearchTool());
  registry.register(new ImageAnalysisTool());

  return registry;
}
