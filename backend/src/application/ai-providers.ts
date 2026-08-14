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

import { AIProvider, AIRequest, AIResponse, AICapability, ModelTier } from './ai-orchestrator';

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
// PROVIDER DETECTION
// ============================================================================

/**
 * Detect which AI providers are configured in the current environment.
 *
 * Returns providers in priority order:
 *   1. Anthropic (if ANTHROPIC_API_KEY set)
 *   2. OpenAI    (if OPENAI_API_KEY set)
 *
 * Returns MockAIProvider if neither is configured (safe for offline use).
 *
 * SECURITY: This function reads env vars but does NOT expose their values.
 */
export function detectAvailableProviders(): {
  providers: AIProvider[];
  status: 'real' | 'mock';
  configured: string[];
  blocked: string[];
} {
  const { MockAIProvider } = require('./ai-orchestrator');
  const providers: AIProvider[] = [];
  const configured: string[] = [];
  const blocked: string[] = [];

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
  orchestrator: import('./ai-orchestrator').AIOrchestrator;
  status: 'real' | 'mock';
  configured: string[];
  blocked: string[];
} {
  const { AIOrchestrator } = require('./ai-orchestrator');
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
