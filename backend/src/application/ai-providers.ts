/**
 * Capucine — Real AI Provider Implementations
 *
 * Concrete implementations of the AIProvider interface for each supported
 * AI service. Keys are read from process.env at call time — NEVER stored on
 * objects, NEVER logged, NEVER returned in responses.
 *
 * Status:
 *   AnthropicProvider  — NOT_EXECUTABLE without ANTHROPIC_API_KEY env var
 *   OpenAIProvider     — NOT_EXECUTABLE without OPENAI_API_KEY env var
 *   MockAIProvider     — always available (re-exported from ai-orchestrator)
 *
 * Security invariants (from spec):
 *   - "aucune clé API dans le code client"  → keys only read inside complete()
 *   - "aucune réponse IA considérée automatiquement comme vérité"
 *     → caller (AIOrchestrator) validates all outputs before use
 *   - "aucune dépendance à un seul fournisseur IA"
 *     → detectAvailableProviders() returns all configured providers
 *
 * All providers implement the AIProvider interface from ai-orchestrator.ts.
 */

import { AIProvider, AIRequest, AIResponse, AICapability, ModelTier, AIOrchestrator, MockAIProvider } from './ai-orchestrator';

export { AIOrchestrator } from './ai-orchestrator';

// ============================================================================
// ANTHROPIC PROVIDER
// ============================================================================

/**
 * Anthropic Claude provider — supports both official Anthropic API and
 * compatible proxies (e.g., Free Claude Code) via ANTHROPIC_BASE_URL.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY          — required
 *   ANTHROPIC_BASE_URL         — optional, defaults to official Anthropic API
 *   MODEL                      — optional, model ID to use (overrides tier selection)
 *
 * NOT_EXECUTABLE without ANTHROPIC_API_KEY.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly capabilities: AICapability[] = [
    'text_generation',
    'text_classification',
    'structured_output',
    'image_analysis',
  ];

  /** Check if this provider is executable (key present in env). */
  get isConfigured(): boolean {
    return Boolean(process.env['ANTHROPIC_API_KEY']);
  }

  selectModel(tier: ModelTier): string {
    // If MODEL env var is set, use it for all tiers (proxy mode)
    const modelEnv = process.env['MODEL'];
    if (modelEnv) return modelEnv;
    
    // Default Anthropic model names
    switch (tier) {
      case 'fast':      return 'claude-haiku-4-5-20251001';
      case 'balanced':  return 'claude-sonnet-4-6';
      case 'reasoning': return 'claude-opus-5';
      case 'vision':    return 'claude-sonnet-4-6';
      default:          return 'claude-sonnet-4-6';
    }
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'AnthropicProvider is NOT_EXECUTABLE: ANTHROPIC_API_KEY environment variable is not set.'
      );
    }

    const baseUrl = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com/v1/messages';
    const start = Date.now();

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.3,
      messages: [
        {
          role: 'user',
          content: request.prompt,
        },
      ],
      ...(request.systemPrompt
        ? { system: request.systemPrompt }
        : {}),
    };

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(no body)');
      throw new Error(
        `AnthropicProvider: HTTP ${response.status} — ${errorText.slice(0, 200)}`
      );
    }

    const data = await response.json() as AnthropicResponse;
    const content = data.content?.[0]?.text ?? '';
    const durationMs = Date.now() - start;

    return {
      content,
      providerName: this.name,
      model: request.model,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      durationMs,
    };
  }
}

// ── Anthropic response shape (partial) ────────────────────────────────────────

interface AnthropicResponse {
  content?: Array<{ type: string; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

// ============================================================================
// FREECC PROXY PROVIDER (Anthropic-compatible format for Free Claude Code proxy)
// ============================================================================

/**
 * FreeCCProxyProvider — uses Free Claude Code proxy (Anthropic-compatible format).
 *
 * Env vars:
 *   - ANTHROPIC_API_KEY (used as proxy key, default: 'freecc')
 *   - ANTHROPIC_BASE_URL (proxy URL, default: 'http://localhost:8082')
 *   - MODEL (model ID, default: 'claude-3-5-sonnet-20241022')
 *
 * The proxy at localhost:8082 expects Anthropic format at `/v1/messages`,
 * NOT OpenAI format.
 */
export class FreeCCProxyProvider implements AIProvider {
  readonly name = 'freecc-proxy';
  readonly capabilities: AICapability[] = [
    'text_generation',
    'text_classification',
    'structured_output',
  ];

  get isConfigured(): boolean {
    return true; // Proxy is always available locally
  }

  selectModel(tier: ModelTier): string {
    // Use the MODEL env var for all tiers, or fallback to default
    const modelEnv = process.env['MODEL'];
    if (modelEnv) return modelEnv;
    return 'claude-3-5-sonnet-20241022';
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const apiKey = process.env['ANTHROPIC_API_KEY'] ?? 'freecc';
    const baseUrl = process.env['ANTHROPIC_BASE_URL'] ?? 'http://localhost:8082';
    const start = Date.now();

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.3,
      messages: [
        {
          role: 'user',
          content: request.prompt,
        },
      ],
      ...(request.systemPrompt
        ? { system: request.systemPrompt }
        : {}),
    };

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(no body)');
      throw new Error(
        `FreeCCProxyProvider: HTTP ${response.status} — ${errorText.slice(0, 200)}`
      );
    }

    const data = await response.json() as AnthropicResponse;
    const content = data.content?.[0]?.text ?? '';
    const durationMs = Date.now() - start;

    return {
      content,
      providerName: this.name,
      model: request.model,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      durationMs,
    };
  }
}

// ── Anthropic response shape (partial) ────────────────────────────────────────


interface AnthropicResponse {
  content?: Array<{ type: string; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

// ============================================================================
// OPENAI PROVIDER
// ============================================================================

/**
 * OpenAI provider (GPT-4o, GPT-4o-mini, etc.).
 *
 * Env var required: OPENAI_API_KEY
 * Models used:
 *   fast      → gpt-4o-mini
 *   balanced  → gpt-4o
 *   reasoning → o1-preview   (when available)
 *   vision    → gpt-4o       (multimodal)
 *
 * NOT_EXECUTABLE without OPENAI_API_KEY.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly capabilities: AICapability[] = [
    'text_generation',
    'text_classification',
    'structured_output',
    'image_analysis',
  ];

  /** Check if this provider is executable (key present in env). */
  get isConfigured(): boolean {
    return Boolean(process.env['OPENAI_API_KEY']);
  }

  selectModel(tier: ModelTier): string {
    switch (tier) {
      case 'fast':      return 'gpt-4o-mini';
      case 'balanced':  return 'gpt-4o';
      case 'reasoning': return 'gpt-4o';   // o1 not always available; gpt-4o as fallback
      case 'vision':    return 'gpt-4o';
      default:          return 'gpt-4o';
    }
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'OpenAIProvider is NOT_EXECUTABLE: OPENAI_API_KEY environment variable is not set.'
      );
    }

    const start = Date.now();

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.3,
      messages,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,   // key consumed here, never stored
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(no body)');
      throw new Error(
        `OpenAIProvider: HTTP ${response.status} — ${errorText.slice(0, 200)}`
      );
    }

    const data = await response.json() as OpenAIResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    // Strip <think>…</think> from reasoning models (e.g. nemotron)
    const cleanContent = content.replace(/<think>[\s\S]*?<\/think>/gs, '').trim();
    const durationMs = Date.now() - start;

    return {
      content,
      providerName: this.name,
      model: request.model,
      tokensUsed: (data.usage?.total_tokens) ?? undefined,
      durationMs,
    };
  }
}

// ── OpenAI response shape (partial) ───────────────────────────────────────────

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; type: string };
}

// ============================================================================
// OPENROUTER PROVIDER
// ============================================================================

/**
 * OpenRouter provider — unified API for multiple LLM providers.
 * 
 * Env vars:
 *   - OPENROUTER_API_KEY  — required
 *   - OPENROUTER_BASE_URL — optional, defaults to https://openrouter.ai/api/v1
 *   - MODEL                 — optional, model ID to use (overrides tier selection)
 * 
 * NOT_EXECUTABLE without OPENROUTER_API_KEY.
 */
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  readonly capabilities: AICapability[] = [
    'text_generation',
    'text_classification',
    'structured_output',
    'image_analysis',
  ];

  /** Check if this provider is executable (key present in env). */
  get isConfigured(): boolean {
    return Boolean(process.env['OPENROUTER_API_KEY']);
  }

  selectModel(tier: ModelTier): string {
    // If MODEL env var is set, use it for all tiers (proxy mode)
    const modelEnv = process.env['MODEL'];
    if (modelEnv) return modelEnv;
    
    // Default OpenRouter model (free tier)
    return 'nvidia/nemotron-3-ultra-550b-a55b:free';
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'OpenRouterProvider is NOT_EXECUTABLE: OPENROUTER_API_KEY environment variable is not set.'
      );
    }

    const baseUrl = process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1';
    const start = Date.now();

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.3,
      messages,
    };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://capucine.app',
        'X-Title': 'Capucine Shopping Assistant',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(no body)');
      throw new Error(
        `OpenRouterProvider: HTTP ${response.status} — ${errorText.slice(0, 200)}`
      );
    }

    const data = await response.json() as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    const durationMs = Date.now() - start;

    return {
      content,
      providerName: this.name,
      model: request.model,
      tokensUsed: data.usage?.total_tokens ?? undefined,
      durationMs,
    };
  }
}


// ============================================================================
// GroqProvider — free tier, ultra-fast (qwen/qwen3.8-27b)
// ============================================================================
export class GroqProvider implements AIProvider {
  readonly name = 'groq';
  readonly capabilities: AICapability[] = ['text_generation', 'text_classification', 'structured_output'];
  get isConfigured(): boolean { return !!process.env['GROQ_API_KEY']; }
  getModel(): string { return 'qwen/qwen3.8-27b'; }
  selectModel(tier: ModelTier): string { return 'qwen/qwen3.8-27b'; }
  async complete(request: AIRequest): Promise<AIResponse> {
    const apiKey = process.env['GROQ_API_KEY'];
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.prompt });
    const start = Date.now();
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: request.model ?? this.getModel(),
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.1,
        messages,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const e = await response.text().catch(() => '(no body)');
      throw new Error(`GroqProvider: HTTP ${response.status} — ${e.slice(0, 200)}`);
    }
    const data = await response.json() as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    return {
      content,
      providerName: this.name,
      model: this.getModel(),
      tokensUsed: data.usage?.total_tokens,
      durationMs: Date.now() - start,
    };
  }
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; code: number };
}

// ============================================================================
// OLLAMA PROVIDER (local, no API key, no cost)
// ============================================================================

/**
 * Ollama provider — a model served locally by `ollama serve` (default
 * http://127.0.0.1:11434). Chosen FIRST when available because it is local
 * and free: no API key, nothing sent off the machine, no per-call cost. Meant
 * for the AI tasks where a local model is good enough (query interpretation,
 * short classification, phrasing) — the deterministic parts of Capucine stay
 * deterministic regardless.
 *
 * OPT-IN, NOT AUTO-DETECTED. `isConfigured` is true only when OLLAMA_MODEL is
 * set. Whether `ollama serve` is actually up cannot be known synchronously,
 * and silently trying localhost:11434 on every deployment (CI, tests, a
 * server with no Ollama) would turn "provider available" into a lie. Setting
 * OLLAMA_MODEL is the deliberate statement "a local model is running here".
 * When it is unreachable at call time, complete() throws and the
 * AIOrchestrator falls back exactly as it does for any other provider error.
 *
 *   OLLAMA_MODEL=llama3.2            # required — enables this provider
 *   OLLAMA_HOST=http://127.0.0.1:11434   # optional — defaults to this
 *   OLLAMA_MODEL_REASONING=…        # optional — heavier model for the
 *                                  #   'reasoning' tier only
 */
export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  readonly capabilities: AICapability[] = [
    'text_generation',
    'text_classification',
    'structured_output',
  ];

  get isConfigured(): boolean {
    return Boolean(process.env['OLLAMA_MODEL']);
  }

  /** Model to use for `tier`. One local model covers every tier unless
   *  OLLAMA_MODEL_REASONING names a heavier one for deep reasoning. */
  selectModel(tier: ModelTier): string {
    const base = process.env['OLLAMA_MODEL'] ?? 'llama3.2';
    if (tier === 'reasoning') return process.env['OLLAMA_MODEL_REASONING'] ?? base;
    return base;
  }

  private get host(): string {
    return (process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  }

  /** Per-call ceiling. Local models vary wildly with the machine and whether
   *  the model is already loaded; a cold first call is the slow one. Default
   *  90 s; lower it (OLLAMA_TIMEOUT_MS) when Ollama sits on a latency-critical
   *  path. The search path has its own, tighter cap (AI_ENRICHMENT_TIMEOUT_MS
   *  in CapucineEngine) and does not wait this long. */
  private get timeoutMs(): number {
    const raw = Number(process.env['OLLAMA_TIMEOUT_MS']);
    return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    if (!process.env['OLLAMA_MODEL']) {
      throw new Error(
        'OllamaProvider is NOT_EXECUTABLE: OLLAMA_MODEL environment variable is not set.'
      );
    }

    const start = Date.now();

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.prompt });

    const body = {
      model: request.model,
      messages,
      // One shot, no token stream — the orchestrator wants the whole answer to
      // validate before any of it is used.
      stream: false,
      options: {
        temperature: request.temperature ?? 0.3,
        // Ollama calls the output-token cap `num_predict`.
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Ollama not running, wrong host, timeout — a provider error like any
      // other, so the orchestrator can fall back.
      throw new Error(
        `OllamaProvider: cannot reach Ollama at ${this.host} — ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(no body)');
      throw new Error(`OllamaProvider: HTTP ${response.status} — ${errorText.slice(0, 200)}`);
    }

    const data = await response.json() as OllamaChatResponse;
    const content = data.message?.content ?? '';
    const durationMs = Date.now() - start;

    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;

    return {
      content,
      providerName: this.name,
      model: request.model,
      tokensUsed: promptTokens + completionTokens || undefined,
      durationMs,
    };
  }
}

// ── Ollama /api/chat response shape (partial) ─────────────────────────────────

interface OllamaChatResponse {
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

// ============================================================================
// PROVIDER DETECTION
// ============================================================================

/**
 * Detect which AI providers are configured in the current environment.
 *
 * Returns providers in priority order:
 *   1. Ollama    (if OLLAMA_MODEL set) — local, no key, no cost, preferred
 *   2. Anthropic (if ANTHROPIC_API_KEY set)
 *   3. OpenAI    (if OPENAI_API_KEY set)
 *
 * Returns MockAIProvider if none is configured (safe for offline use).
 *
 * SECURITY: This function reads env vars but does NOT expose their values.
 */
export function detectAvailableProviders(): {
  providers: AIProvider[];
  status: 'real' | 'mock';
  configured: string[];
  blocked: string[];
} {
  // Force MockAI for deterministic tests (e.g. CI/CD) — avoids rate limits on real providers
  if (process.env.USE_MOCK_AI === 'true') {
    return { providers: [new MockAIProvider()], status: 'mock', configured: ['mock'], blocked: [] };
  }

  const providers: AIProvider[] = [];
  const configured: string[] = [];
  const blocked: string[] = [];

  // Priority order (PROVISIONAL, 2026-09-26):
  //   1. Ollama — opt-in only (OLLAMA_MODEL), local, nothing leaves the machine,
  //      no per-call cost. When set but down, complete() throws and the
  //      orchestrator falls back to the next provider.
  //   2. Groq, 3. OpenRouter — free tiers.
  //   4. Anthropic, 5. OpenAI — paid, last before MockAI.
  const ollama = new OllamaProvider();
  if (ollama.isConfigured) {
    providers.push(ollama);
    configured.push('ollama');
  } else {
    blocked.push('ollama (OLLAMA_MODEL not set)');
  }

  const groq = new GroqProvider();
  if (groq.isConfigured) {
    providers.push(groq);
    configured.push('groq');
  } else {
    blocked.push('groq (GROQ_API_KEY not set)');
  }

  const openrouter = new OpenRouterProvider();
  if (openrouter.isConfigured) {
    providers.push(openrouter);
    configured.push('openrouter');
  } else {
    blocked.push('openrouter (OPENROUTER_API_KEY not set)');
  }

  // FreeCC proxy (FreeCCProxyProvider) stays disabled: its key has no valid
  // upstream credentials (401 from NIM/OpenRouter).
  blocked.push('freecc-proxy (API key not valid for upstream providers)');

  const anthropic = new AnthropicProvider();
  if (anthropic.isConfigured) {
    providers.push(anthropic);
    configured.push('anthropic');
  } else {
    blocked.push('anthropic (ANTHROPIC_API_KEY not set)');
  }

  const openai = new OpenAIProvider();
  if (openai.isConfigured) {
    providers.push(openai);
    configured.push('openai');
  } else {
    blocked.push('openai (OPENAI_API_KEY not set)');
  }

  if (providers.length === 0) {
    providers.push(new MockAIProvider());
    return { providers, status: 'mock', configured, blocked };
  }

  return { providers, status: 'real', configured, blocked };
}

/**
 * Build an AIOrchestrator with the best available providers.
 * Useful for server startup — call once and inject into CapucineEngine.
 */
export function buildAIOrchestrator(): {
  orchestrator: AIOrchestrator;
  status: 'real' | 'mock';
  configured: string[];
  blocked: string[];
} {
  const detection = detectAvailableProviders();

  const orchestrator = new AIOrchestrator(detection.providers, {
    maxRetries: 2,
    fallbackEnabled: true,
    strictValidation: true,
    auditMode: true,
  });

  return {
    orchestrator,
    status: detection.status,
    configured: detection.configured,
    blocked: detection.blocked,
  };
}
