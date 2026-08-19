/**
 * Capucine — RealWebDiscoveryStrategy
 *
 * A DiscoveryStrategy that finds product offers by searching the web.
 * Uses an injected WebSearchAdapter (BraveSearchAdapter, SerperAdapter, etc.)
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  NOT_EXECUTABLE without a configured WebSearchAdapter.           ║
 * ║  If no adapter is configured, discover() returns 0 candidates   ║
 * ║  with a clear warning — it does NOT silently use fake data.     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * SECURITY INVARIANTS (verbatim from spec):
 * - "aucune réponse IA considérée automatiquement comme vérité"
 *   → All web results pass through NormalizationEngine before ranking
 * - "aucune donnée externe injectée directement dans le ranking sans normalisation"
 *   → Offer characteristics extracted from web are marked provenance='web_search'
 *     and status='known' (not 'verified') so downstream can weight accordingly
 * - "aucune provenance supprimée lors d'une transformation"
 *   → Every offer has offer.provenance set to the search adapter name
 *
 * Architecture:
 *   RealWebDiscoveryStrategy.discover(criteria)
 *     → WebSearchAdapter.search(query)        ← real HTTP call (NOT_EXECUTABLE without key)
 *     → parseSearchResults()                  ← extract product candidates from HTML snippets
 *     → buildOfferSkeletons()                 ← create Offer objects with provenance
 *     → DiscoveryResult (candidates)
 *     → [NormalizationEngine]                 ← REQUIRED before ranking
 *     → [AdmissibilityEngine + PriorityEngine]
 */

import { Offer, DataPoint } from '../domain/types';
import { IDiscoveryStrategy, DiscoveryCriteria, DiscoveryResult } from './discovery';
import { WebSearchAdapter, WebSearchOutput, WebSearchResult, ToolRegistry } from './tools';
import { ProductPageExtractor } from './product-page-extractor';
import { classifyMatchQuality } from './match-quality';

// ============================================================================
// REAL WEB DISCOVERY STRATEGY
// ============================================================================

/**
 * RealWebDiscoveryStrategy can operate in two modes:
 *
 * 1. DIRECT MODE (legacy): adapter is passed directly. No timeout/rate-limit/audit.
 *    Used when ToolRegistry is not available (e.g. tests with mock adapters).
 *
 * 2. REGISTRY MODE (production): a ToolRegistry is passed.
 *    All web search calls route through registry.execute('web_search', ...) which
 *    enforces: timeout, rate limiting, audit trail, availability checks.
 *    CapucineEngine always uses this mode in production.
 *
 * INVARIANT: isReady() reflects the adapter/registry state — never fakes readiness.
 */
export class RealWebDiscoveryStrategy implements IDiscoveryStrategy {
  readonly name = 'real_web_discovery';
  readonly version = '1.0.0';

  private readonly adapter: WebSearchAdapter | null;
  private readonly registry: ToolRegistry | null;
  private readonly pageExtractor: ProductPageExtractor | null;

  /** How many top candidates get a real page-fetch enrichment attempt per search. */
  private static readonly MAX_ENRICHED_CANDIDATES = 5;
  /** Hard budget for the whole enrichment phase, so a slow/unreachable site never stalls the pipeline. */
  private static readonly ENRICHMENT_BUDGET_MS = 6000;

  get isReady(): boolean {
    if (this.registry) {
      return this.registry.isAvailable('web_search');
    }
    return this.adapter?.isConfigured() ?? false;
  }

  /**
   * @param adapterOrRegistry - Either a WebSearchAdapter (direct mode) or a ToolRegistry (registry mode)
   * @param pageExtractor - Optional. When provided, the top candidates from
   *   each search are enriched with real page data (JSON-LD) after the
   *   snippet-based skeleton is built. Omitted by default so existing
   *   callers/tests are entirely unaffected (opt-in, non-breaking).
   */
  constructor(adapterOrRegistry: WebSearchAdapter | ToolRegistry, pageExtractor?: ProductPageExtractor) {
    if (adapterOrRegistry instanceof ToolRegistry) {
      this.registry = adapterOrRegistry;
      this.adapter = null;
    } else {
      this.adapter = adapterOrRegistry;
      this.registry = null;
    }
    this.pageExtractor = pageExtractor ?? null;
  }

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const start = Date.now();
    const resultId = `rwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check readiness (registry mode or direct mode)
    if (!this.isReady) {
      const adapterName = this.adapter?.adapterName ?? 'web_search';
      return {
        id: resultId,
        timestamp: new Date(),
        criteria,
        candidates: [],
        statistics: {
          queriedSources: 0,
          candidatesFound: 0,
          candidatesFiltered: 0,
          searchTimeMs: Date.now() - start,
          relevanceEstimate: 'low',
        },
        strategy: this.name,
        status: 'SEARCH_PROVIDER_NOT_CONFIGURED' as const,
        warnings: [
          `RealWebDiscoveryStrategy is NOT_EXECUTABLE: web search adapter "${adapterName}" is not configured. ` +
          'Set the required environment variable (BRAVE_API_KEY or SERPER_API_KEY) to enable real web search. ' +
          'Falling back to InMemoryDiscoveryStrategy.'
        ],
      };
    }

    // Build search query from criteria
    const queries = this.buildSearchQueries(criteria);
    const allResults: WebSearchResult[] = [];
    const requestId = `rwd-${resultId}`;

    for (const query of queries) {
      try {
        let output: WebSearchOutput;

        if (this.registry) {
          // REGISTRY MODE — all guarantees enforced (timeout, rate limit, audit)
          const toolResp = await this.registry.execute<
            { query: string; maxResults: number; language: string },
            WebSearchOutput
          >('web_search', {
            requestId: `${requestId}-q${allResults.length}`,
            params: {
              query,
              maxResults: Math.min(criteria.limit ?? 10, 20),
              language: 'fr',
            },
          });

          if (!toolResp.success || !toolResp.data) {
            // Tool failed (timeout, rate limit, etc.) — log and skip this query
            continue;
          }
          output = toolResp.data;
        } else {
          // DIRECT MODE — no registry guarantees (legacy / test mode)
          output = await this.adapter!.search({
            query,
            maxResults: Math.min(criteria.limit ?? 10, 20),
            language: 'fr',
          });
        }

        allResults.push(...output.results);
      } catch {
        // Individual query failure is recoverable — continue with other queries
      }
    }

    // Convert search results → offer candidates
    const candidates = this.buildCandidates(allResults, criteria);

    // Optional enrichment: fetch the actual page for the top candidates and
    // extract structured Product/Offer data (JSON-LD) to replace the
    // fragile snippet-regex price with a real published price when possible.
    // Best-effort only: never blocks, never overwrites good data with worse
    // data, never invents anything when extraction fails.
    let enrichedCount = 0;
    if (this.pageExtractor) {
      enrichedCount = await this.enrichTopCandidates(candidates);
    }

    return {
      id: resultId,
      timestamp: new Date(),
      criteria,
      candidates,
      statistics: {
        queriedSources: queries.length,
        candidatesFound: allResults.length,
        candidatesFiltered: allResults.length - candidates.length,
        searchTimeMs: Date.now() - start,
        relevanceEstimate: candidates.length > 0 ? 'medium' : 'low',
        pageEnrichedCount: enrichedCount,
      },
      strategy: this.name,
    };
  }

  /**
   * Attempts to enrich the top N candidates with real page data. Runs all
   * fetches concurrently but respects a hard overall time budget — slow or
   * unreachable pages are simply left as snippet-only skeletons, never
   * retried, never blocking the rest of the pipeline.
   *
   * INVARIANT: a candidate's existing DataPoint is only replaced when the
   * extractor returns status='known' — a failed/partial extraction never
   * downgrades a value that was already known from the snippet.
   */
  private async enrichTopCandidates(
    candidates: DiscoveryResult['candidates']
  ): Promise<number> {
    const targets = candidates.slice(0, RealWebDiscoveryStrategy.MAX_ENRICHED_CANDIDATES);
    if (targets.length === 0 || !this.pageExtractor) return 0;

    const withTimeout = async <T,>(promise: Promise<T | null>): Promise<T | null> => {
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), RealWebDiscoveryStrategy.ENRICHMENT_BUDGET_MS)
      );
      return Promise.race([promise, timeout]);
    };

    let enrichedCount = 0;

    await Promise.all(
      targets.map(async (candidate) => {
        const url = candidate.offer.characteristics['url']?.value;
        if (typeof url !== 'string') return;

        const extracted = await withTimeout(this.pageExtractor!.extract(url));
        if (!extracted) return; // fetch/parse failed — leave snippet-only skeleton untouched

        let changed = false;

        if (extracted.price.status === 'known') {
          candidate.offer.price = extracted.price;
          changed = true;
        }
        if (extracted.currency) {
          candidate.offer.currency = extracted.currency;
          changed = true;
        }
        if (extracted.merchantName.status === 'known' && extracted.merchantName.value) {
          candidate.offer.merchant = {
            ...candidate.offer.merchant,
            name: extracted.merchantName.value,
          };
          changed = true;
        }
        if (extracted.productName.status === 'known' && extracted.productName.value) {
          candidate.offer.characteristics['title'] = extracted.productName;
          changed = true;
        }

        if (changed) enrichedCount += 1;
      })
    );

    return enrichedCount;
  }

  /**
   * Sync variant — not possible for real HTTP calls.
   * Returns empty result with explicit warning. Tests should use discover() or InMemoryStrategy.
   */
  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    return {
      id: `rwd-sync-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      candidates: [],
      statistics: {
        queriedSources: 0,
        candidatesFound: 0,
        candidatesFiltered: 0,
        searchTimeMs: 0,
        relevanceEstimate: 'low',
      },
      strategy: this.name,
      warnings: [
        'RealWebDiscoveryStrategy.discoverSync() is NOT_EXECUTABLE: real web search requires async. Use discover() instead.'
      ],
    };
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unavailable' }> {
    if (!this.isReady) {
      return { status: 'unavailable' };
    }
    // Could add a lightweight ping here
    return { status: 'healthy' };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Build search queries from discovery criteria.
   * Multiple queries improve recall (different angles on the same need).
   */
  private buildSearchQueries(criteria: DiscoveryCriteria): string[] {
    const queries: string[] = [];

    const keywords = criteria.keywords ?? [];
    const category = criteria.categories?.[0] ?? '';
    const maxPrice = criteria.maxPrice;

    // Primary query: keywords + category
    if (keywords.length > 0 || category) {
      let q = [...keywords, category].filter(Boolean).join(' ');
      if (maxPrice) q += ` prix moins de ${maxPrice}€`;
      queries.push(q.trim());
    }

    // Secondary query: with site modifiers for shopping
    if (keywords.length > 0) {
      queries.push(`acheter ${keywords.join(' ')} comparatif prix`);
    }

    return queries.filter(Boolean).slice(0, 3); // Max 3 queries to limit API usage
  }

  /**
   * Convert raw search results into Offer skeletons.
   *
   * IMPORTANT: These offers have minimal characteristics (extracted from snippets).
   * They must pass through NormalizationEngine before ranking.
   * All characteristics have status='known' (not 'verified') to signal they
   * came from a web snippet, not a canonical source.
   */
  private buildCandidates(
    results: WebSearchResult[],
    criteria: DiscoveryCriteria
  ): DiscoveryResult['candidates'] {
    const candidates: DiscoveryResult['candidates'] = [];
    const seenDomains = new Set<string>();

    for (const result of results) {
      // Deduplicate by domain (rough dedup — DeduplicationEngine does the real work)
      if (seenDomains.has(result.domain)) continue;
      seenDomains.add(result.domain);

      // Extract price from snippet (heuristic)
      const price = this.extractPrice(result.snippet);

      // Apply price filter early (hard filter — not ranking)
      if (criteria.maxPrice !== undefined && price !== null && price > criteria.maxPrice) {
        continue;
      }

      // Build a minimal offer from the search result
      const offer = this.buildOfferSkeleton(result, price);
      const keywords = criteria.keywords ?? [];
      const text = `${result.title} ${result.snippet}`.toLowerCase();
      const keywordsMatched = keywords.filter((kw) => text.includes(kw.toLowerCase())).length;
      const matchScore = keywords.length > 0 ? keywordsMatched / keywords.length : 0.5;
      const matchQuality = classifyMatchQuality({
        text,
        exactRefs: criteria.exactRefs ?? [],
        keywordsMatched,
        keywordsTotal: keywords.length,
      });

      candidates.push({
        offer: { ...offer, matchQuality },
        matchScore,
        matchReason: `Web result: "${result.title}"`,
        matchQuality,
      });
    }

    // Sort by match score descending, then by position ascending (lower position = more relevant)
    candidates.sort((a, b) => {
      if (Math.abs(b.matchScore - a.matchScore) > 0.05) return b.matchScore - a.matchScore;
      return (a.offer.id < b.offer.id ? -1 : 1); // Stable sort by id
    });

    return candidates.slice(0, criteria.limit ?? 20);
  }

  private buildOfferSkeleton(result: WebSearchResult, price: number | null): Offer {
    const id = `web-${result.domain}-${result.position}`;

    // Price DataPoint
    const adapterName = this.adapter?.adapterName ?? 'web_search';
    const priceDP: DataPoint<number> = price !== null
      ? { value: price, status: 'known', provenance: { source: adapterName, retrievedAt: new Date() } }
      : { value: null, status: 'unknown' };

    const now = new Date();
    const prov = { source: adapterName, retrievedAt: now };
    return {
      id,
      productId: `product-web-${result.domain}`,
      merchant: {
        id: result.domain,
        name: result.domain,
        country: 'unknown',
        executionCapabilities: [],
      },
      price: priceDP,
      currency: 'EUR',
      shippingCost: { value: null, status: 'unknown' },
      characteristics: {
        title: { value: result.title, status: 'known', provenance: prov },
        description: { value: result.snippet, status: 'known', provenance: prov },
        url: { value: result.url, status: 'known', provenance: prov },
      },
      executionUrl: result.url,
      provenance: prov,
      createdAt: now,
      retrievedAt: now,
    };
  }

  /** Heuristic price extraction from snippet text */
  private extractPrice(snippet: string): number | null {
    // Match patterns like "€599", "599€", "599,00 €", "599.00€"
    const patterns = [
      /€\s*(\d[\d\s]*(?:[.,]\d{1,2})?)/,
      /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*€/,
      /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*euros?/i,
    ];

    for (const pattern of patterns) {
      const match = snippet.match(pattern);
      if (match) {
        const raw = match[1].replace(/\s/g, '').replace(',', '.');
        const price = parseFloat(raw);
        if (!isNaN(price) && price > 0 && price < 100000) {
          return price;
        }
      }
    }

    return null;
  }
}
