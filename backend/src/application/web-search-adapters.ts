/**
 * Capucine — Web Search Adapters
 *
 * Concrete implementations of WebSearchAdapter for real web search.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  NOT_EXECUTABLE without the corresponding environment variable. ║
 * ║  These adapters will return API_KEY_MISSING if unconfigured.    ║
 * ║                                                                  ║
 * ║  BraveSearchAdapter  → requires: BRAVE_API_KEY env var          ║
 * ║  SerperAdapter        → requires: SERPER_API_KEY env var         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * SECURITY INVARIANTS:
 * - API keys are read from env at call time, NEVER stored on the object
 * - isConfigured() only checks presence (Boolean cast) — never exposes key
 * - No key is ever logged, serialized, or placed in error messages
 * - External responses are never trusted as ground truth — they feed
 *   NormalizationEngine before any downstream use
 *
 * Adding a new provider:
 *   1. Implement WebSearchAdapter
 *   2. Read the required env var inside search() only
 *   3. Call isConfigured() first and short-circuit if false
 *   4. Register via buildDefaultToolRegistry(new YourAdapter())
 */

import { WebSearchAdapter, WebSearchParams, WebSearchOutput, WebSearchResult } from './tools';

// ============================================================================
// BRAVE SEARCH ADAPTER
// ============================================================================

/**
 * BraveSearchAdapter — uses Brave Search API.
 *
 * NOT_EXECUTABLE without BRAVE_API_KEY environment variable.
 *
 * API reference: https://api.search.brave.com/app/documentation
 * Rate limits: depend on plan (free tier: 2000 queries/month)
 *
 * IMPORTANT: This adapter does NOT scrape — it uses the official Brave
 * Search API, which is terms-compliant for programmatic use.
 */
export class BraveSearchAdapter implements WebSearchAdapter {
  readonly adapterName = 'brave_search';

  private static readonly API_URL = 'https://api.search.brave.com/res/v1/web/search';
  private static readonly ENV_KEY = 'BRAVE_API_KEY';

  /**
   * Check that the API key env var is set.
   * Does NOT validate the key — only checks presence.
   */
  isConfigured(): boolean {
    return Boolean(process.env[BraveSearchAdapter.ENV_KEY]);
  }

  async search(params: WebSearchParams, timeoutMs = 10000): Promise<WebSearchOutput> {
    const apiKey = process.env[BraveSearchAdapter.ENV_KEY];

    if (!apiKey) {
      throw new Error(
        'BraveSearchAdapter is NOT_EXECUTABLE: BRAVE_API_KEY environment variable is not set. ' +
        'Set it in your .env file or environment to enable real web search.'
      );
    }

    const url = new URL(BraveSearchAdapter.API_URL);
    url.searchParams.set('q', params.query);
    url.searchParams.set('count', String(Math.min(params.maxResults ?? 10, 20)));
    if (params.language) url.searchParams.set('search_lang', params.language);
    if (params.country) url.searchParams.set('country', params.country.toLowerCase());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          // Key read from env at call time — NEVER stored or logged
          'X-Subscription-Token': apiKey,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as BraveSearchResponse;
      return this.parseResponse(json);

    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(json: BraveSearchResponse): WebSearchOutput {
    const results: WebSearchResult[] = (json.web?.results ?? []).map((item, idx) => ({
      title: item.title ?? '',
      url: item.url ?? '',
      snippet: item.description ?? '',
      position: idx + 1,
      domain: item.url ? new URL(item.url).hostname : '',
    }));

    return {
      results,
      totalEstimated: json.web?.totalEstimated,
      searchEngine: 'brave',
    };
  }
}

// Brave API response shape (minimal — only fields we use)
interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
    totalEstimated?: number;
  };
}

// ============================================================================
// SERPER ADAPTER
// ============================================================================

/**
 * SerperAdapter — uses Serper.dev API (Google Search wrapper).
 *
 * NOT_EXECUTABLE without SERPER_API_KEY environment variable.
 *
 * API reference: https://serper.dev/api-reference
 * Rate limits: depend on plan (free tier: 2500 queries/month)
 */
export class SerperAdapter implements WebSearchAdapter {
  readonly adapterName = 'serper';

  private static readonly API_URL = 'https://google.serper.dev/search';
  private static readonly ENV_KEY = 'SERPER_API_KEY';

  isConfigured(): boolean {
    return Boolean(process.env[SerperAdapter.ENV_KEY]);
  }

  async search(params: WebSearchParams, timeoutMs = 10000): Promise<WebSearchOutput> {
    const apiKey = process.env[SerperAdapter.ENV_KEY];

    if (!apiKey) {
      throw new Error(
        'SerperAdapter is NOT_EXECUTABLE: SERPER_API_KEY environment variable is not set. ' +
        'Set it in your .env file or environment to enable real web search.'
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body: Record<string, unknown> = {
        q: params.query,
        num: Math.min(params.maxResults ?? 10, 20),
      };
      if (params.language) body['hl'] = params.language;
      if (params.country) body['gl'] = params.country.toLowerCase();

      const response = await fetch(SerperAdapter.API_URL, {
        method: 'POST',
        headers: {
          // Key read from env at call time — NEVER stored or logged
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json() as SerperResponse;
      return this.parseResponse(json);

    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(json: SerperResponse): WebSearchOutput {
    const results: WebSearchResult[] = (json.organic ?? []).map((item, idx) => ({
      title: item.title ?? '',
      url: item.link ?? '',
      snippet: item.snippet ?? '',
      position: item.position ?? idx + 1,
      domain: item.link ? new URL(item.link).hostname : '',
    }));

    return {
      results,
      searchEngine: 'serper_google',
    };
  }
}

// Serper API response shape (minimal)
interface SerperResponse {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    position?: number;
  }>;
}

// ============================================================================
// FALLBACK: NO-OP ADAPTER (for testing)
// ============================================================================

/**
 * NoOpWebSearchAdapter — always returns empty results.
 * Use in tests where you don't want real HTTP calls.
 */
export class NoOpWebSearchAdapter implements WebSearchAdapter {
  readonly adapterName = 'noop';

  isConfigured(): boolean {
    return true; // Always "configured" — just returns nothing
  }

  async search(_params: WebSearchParams): Promise<WebSearchOutput> {
    return { results: [], searchEngine: 'noop' };
  }
}

// ============================================================================
// FACTORY: Pick the best available adapter
// ============================================================================

/**
 * Detect which web search adapter to use based on available env vars.
 *
 * Priority: BRAVE_API_KEY > SERPER_API_KEY > NoOp
 *
 * Returns the adapter regardless of whether it is configured —
 * callers should check adapter.isConfigured() before use.
 */
export function detectWebSearchAdapter(): WebSearchAdapter {
  if (process.env['BRAVE_API_KEY']) {
    return new BraveSearchAdapter();
  }
  if (process.env['SERPER_API_KEY']) {
    return new SerperAdapter();
  }
  // Neither key available — return a NoOp to make status explicit
  return new NoOpWebSearchAdapter();
}

/**
 * Detect ALL web search adapters actually configured (not just the
 * highest-priority one) — lets ToolRegistry register a source PER configured
 * adapter, so RealWebDiscoveryStrategy can query them in parallel instead of
 * being limited to whichever one detectWebSearchAdapter() would have picked.
 *
 * Returns [NoOpWebSearchAdapter] (never an empty array) when nothing is
 * configured, so callers always have at least one explicit, honest source to
 * register rather than special-casing "zero adapters".
 */
export function detectWebSearchAdapters(): WebSearchAdapter[] {
  const adapters: WebSearchAdapter[] = [];
  if (process.env['BRAVE_API_KEY']) adapters.push(new BraveSearchAdapter());
  if (process.env['SERPER_API_KEY']) adapters.push(new SerperAdapter());
  return adapters.length > 0 ? adapters : [new NoOpWebSearchAdapter()];
}
