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

// ============================================================================
// ANTHROPIC PROVIDER
// ============================================================================

/**
 * Anthropic Claude provider.
 *
 * Env var required: ANTHROPIC_API_KEY
 * Models used:
 *   fast      → claude-haiku-4-5-20251001
 *   balanced  → claude-sonnet-4-6  (or latest claude-sonnet)
 *   reasoning → claude-opus-5      (or latest claude-opus)
 *   vision    → claude-sonnet-4-6  (multimodal)
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

    const start = Date.now();

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,           // key consumed here, never stored
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
      max_tokens: request.maxTokens ?? 1024,
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
        // Local models are slower than a hosted API and vary with the machine.
        signal: AbortSignal.timeout(120_000),
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
  const providers: AIProvider[] = [];
  const configured: string[] = [];
  const blocked: string[] = [];

  // Ollama first: local model, no API key, nothing leaves the machine, no
  // per-call cost. When it is set but down, its complete() throws and the
  // orchestrator falls back to the next provider below.
  const ollama = new OllamaProvider();
  if (ollama.isConfigured) {
    providers.push(ollama);
    configured.push('ollama');
  } else {
    blocked.push('ollama (OLLAMA_MODEL not set)');
  }

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
