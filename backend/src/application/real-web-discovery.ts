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
import { SearchStrategyPlanner, SearchStrategy } from './search-strategy-planner';
import { computeSearchCoverage, SearchCoverageThresholds, DEFAULT_COVERAGE_THRESHOLDS } from './search-coverage';
import { SupportedLanguage } from './i18n';

/** Run `fn` over `items` with at most `limit` in flight at once. Simple chunked
 *  batching — enough to bound concurrency without a full scheduler/pool. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += Math.max(1, limit)) {
    const chunk = items.slice(i, i + Math.max(1, limit));
    await Promise.allSettled(chunk.map(fn));
  }
}

/** A WebSearchResult tagged with which source actually produced it — precise
 *  per-result provenance, needed once multiple sources run in parallel (a
 *  single blanket "web_search" label would lose which one found what). */
type SourcedWebResult = WebSearchResult & { __sourceName?: string };

export interface RealWebDiscoveryOptions {
  /** How many strategy phases to run before stopping regardless of coverage. Default 2. */
  maxPhases?: number;
  /** Max search queries in flight at once, across all sources. Default 4. */
  maxConcurrentQueries?: number;
  /** Thresholds used to decide whether phase 1 already found "enough". */
  coverageThresholds?: SearchCoverageThresholds;
  /**
   * Search BUDGET — total wall-clock time (ms) this discover() call may
   * spend across ALL phases before it must stop starting new ones, even if
   * coverage isn't saturated and maxPhases hasn't been reached yet. A phase
   * already in flight is never aborted mid-way (query timeouts + the
   * enrichment budget already bound that) — this only gates whether a NEW
   * phase is allowed to START. Default 15000ms.
   */
  maxTotalTimeMs?: number;
  /**
   * Additional languages to search in (phase 3) when phases 1-2 (the query's
   * own language) don't reach coverage AND maxPhases >= 3. Empty by default —
   * multilingual search is opt-in per call, not automatic (Part 24: cost).
   * See SearchStrategyPlanner.buildInternationalStrategies().
   */
  internationalLanguages?: SupportedLanguage[];
}

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
  readonly version = '1.1.0';

  /** Direct mode: zero or more adapters — MULTI-SOURCE (Brave + Serper + any
   *  future adapter) run in parallel, each isolated from the others' failures.
   *  Empty when operating in registry mode. */
  private readonly adapters: WebSearchAdapter[];
  private readonly registry: ToolRegistry | null;
  private readonly pageExtractor: ProductPageExtractor | null;
  private readonly strategyPlanner = new SearchStrategyPlanner();
  private readonly maxPhases: number;
  private readonly maxConcurrentQueries: number;
  private readonly maxTotalTimeMs: number;
  private readonly internationalLanguages: SupportedLanguage[];
  private readonly coverageThresholds: SearchCoverageThresholds;

  /** How many top candidates get a real page-fetch enrichment attempt per search. */
  private static readonly MAX_ENRICHED_CANDIDATES = 5;
  /** Hard budget for the whole enrichment phase, so a slow/unreachable site never stalls the pipeline. */
  private static readonly ENRICHMENT_BUDGET_MS = 6000;

  get isReady(): boolean {
    if (this.registry) {
      return this.registry.listWebSearchTools().length > 0;
    }
    return this.adapters.some(a => a.isConfigured());
  }

  /**
   * @param adapterOrAdaptersOrRegistry - A single WebSearchAdapter, an array
   *   of them (MULTI-SOURCE direct mode — each queried in parallel, a failing
   *   source never blocks the others), or a ToolRegistry (registry mode: all
   *   guarantees — timeout/rate-limit/audit — enforced, but currently routes
   *   through the registry's single registered 'web_search' tool; see final
   *   report for what multi-source registry mode would still need).
   * @param pageExtractor - Optional. When provided, the top candidates from
   *   each search are enriched with real page data (JSON-LD) after the
   *   snippet-based skeleton is built. Omitted by default so existing
   *   callers/tests are entirely unaffected (opt-in, non-breaking).
   * @param options - maxPhases/maxConcurrentQueries/coverageThresholds. All optional with sane defaults.
   */
  constructor(
    adapterOrAdaptersOrRegistry: WebSearchAdapter | WebSearchAdapter[] | ToolRegistry,
    pageExtractor?: ProductPageExtractor,
    options: RealWebDiscoveryOptions = {}
  ) {
    if (adapterOrAdaptersOrRegistry instanceof ToolRegistry) {
      this.registry = adapterOrAdaptersOrRegistry;
      this.adapters = [];
    } else {
      this.registry = null;
      this.adapters = Array.isArray(adapterOrAdaptersOrRegistry)
        ? adapterOrAdaptersOrRegistry
        : [adapterOrAdaptersOrRegistry];
    }
    this.pageExtractor = pageExtractor ?? null;
    this.maxPhases = options.maxPhases ?? 2;
    this.maxConcurrentQueries = options.maxConcurrentQueries ?? 4;
    this.maxTotalTimeMs = options.maxTotalTimeMs ?? 15_000;
    this.internationalLanguages = options.internationalLanguages ?? [];
    this.coverageThresholds = options.coverageThresholds ?? DEFAULT_COVERAGE_THRESHOLDS;
  }

  /**
   * ADAPTIVE, MULTI-SOURCE, MULTI-PHASE discovery:
   *
   *   SearchStrategyPlanner → phase 1 strategies (general/category)
   *   → run each strategy against every configured source, in parallel,
   *     bounded by maxConcurrentQueries — one source failing/timing out
   *     never blocks the others (Promise.allSettled)
   *   → assess SearchCoverage
   *   → saturated OR maxPhases reached?  → stop
   *   → else run phase 2 strategies (technical_specs/budget/synonym) the
   *     same way, then re-assess coverage once more
   *
   * This never pretends to have covered a source that wasn't actually
   * queried — coverage.sourcesFailed / queriesExecuted are real counts from
   * this exact run, surfaced on the result for transparency.
   */
  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const start = Date.now();
    const resultId = `rwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check readiness (registry mode or direct mode)
    if (!this.isReady) {
      const adapterName = this.adapters[0]?.adapterName ?? 'web_search';
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

    const allStrategies = this.strategyPlanner.buildStrategies(criteria, criteria.hardConstraints ?? [], criteria.language);
    const phase1 = allStrategies.filter(s => s.phase === 1);
    const phase2 = allStrategies.filter(s => s.phase === 2);

    const allResults: SourcedWebResult[] = [];
    let queriesExecuted = 0;
    let sourcesAttempted = 0;
    let sourcesFailed = 0;

    const runStrategies = async (strategies: SearchStrategy[]): Promise<void> => {
      if (strategies.length === 0) return;

      // Fan out: each strategy × each available source is one independent task.
      // Registry mode discovers sources by naming convention (listWebSearchTools())
      // instead of a single hardcoded 'web_search' tool name — this is what makes
      // multi-source real in the actual production pipeline (CapucineEngine),
      // not just in direct-mode tests.
      type Task = { strategy: SearchStrategy; adapter: WebSearchAdapter | null; toolName: string | null };
      const tasks: Task[] = this.registry
        ? strategies.flatMap(strategy =>
            this.registry!.listWebSearchTools().map(toolName => ({ strategy, adapter: null, toolName }))
          )
        : strategies.flatMap(strategy =>
            this.adapters.filter(a => a.isConfigured()).map(adapter => ({ strategy, adapter, toolName: null }))
          );

      await runWithConcurrency(tasks, this.maxConcurrentQueries, async task => {
        queriesExecuted += 1;
        sourcesAttempted += 1;
        try {
          let output: WebSearchOutput;
          if (this.registry) {
            const toolResp = await this.registry.execute<
              { query: string; maxResults: number; language: string },
              WebSearchOutput
            >(task.toolName!, {
              requestId: `${resultId}-q${queriesExecuted}`,
              params: {
                query: task.strategy.query,
                maxResults: Math.min(criteria.limit ?? 10, 20),
                // task.strategy.language — NOT hardcoded 'fr'. Each
                // SearchStrategy already carries the language it was
                // phrased in (buildStrategies() for phase 1-2, always the
                // query language; buildInternationalStrategies() for phase
                // 3, one per target language) — sending 'fr' regardless
                // would have told the search engine to bias results to
                // French even for a query phrased in German ("Laptop unter
                // 1000"), defeating the entire point of phase 3.
                language: task.strategy.language,
              },
            });
            if (!toolResp.success || !toolResp.data) {
              sourcesFailed += 1;
              return;
            }
            output = toolResp.data;
            allResults.push(...output.results.map(r => ({ ...r, __sourceName: toolResp.provenance.source })));
          } else {
            output = await task.adapter!.search({
              query: task.strategy.query,
              maxResults: Math.min(criteria.limit ?? 10, 20),
              language: task.strategy.language,
            });
            allResults.push(...output.results.map(r => ({ ...r, __sourceName: task.adapter!.adapterName })));
          }
        } catch {
          // One source/query failing is recoverable — never aborts the rest.
          sourcesFailed += 1;
        }
      });
    };

    await runStrategies(phase1);

    const domainsOf = (results: WebSearchResult[]) => new Set(results.map(r => r.domain)).size;
    // buildCandidates() is a pure, synchronous function (regex price
    // extraction + rough dedup, no I/O) — cheap enough to call here just to
    // get a REAL exploitableOffers count for the phase-2 go/no-go decision.
    // Without this, the decision would always see 0 exploitable offers and
    // phase 2 would run unconditionally, defeating the point of coverage.
    let coverage = computeSearchCoverage(
      {
        queriesExecuted,
        sourcesAttempted,
        sourcesFailed,
        rawResultsCount: allResults.length,
        uniqueDomains: domainsOf(allResults),
        productPagesIdentified: allResults.filter(r => !!r.url).length,
        exploitableOffers: this.buildCandidates(allResults, criteria).filter(c => c.offer.price.value !== null).length,
        duplicatesRemoved: 0,
      },
      this.coverageThresholds
    );

    // Budget check: a new phase may only START if there's still time left in
    // the search budget. A phase already running is never cut off mid-flight
    // (per-query timeouts + the enrichment budget already bound that).
    const budgetRemaining = Date.now() - start < this.maxTotalTimeMs;

    if (!coverage.saturated && this.maxPhases >= 2 && phase2.length > 0 && budgetRemaining) {
      await runStrategies(phase2);
    }

    // ── Phase 3 (optional): MULTILINGUAL WEB SEARCH ───────────────────────────
    // Only reached when own-language coverage (phases 1-2) is still
    // insufficient AND the search budget allows it AND maxPhases explicitly
    // authorizes a 3rd phase (default maxPhases is 2 — international search
    // is opt-in, never automatic, per Part 24: it multiplies query/enrichment
    // cost and must not run on every request). Reuses the SAME
    // SearchCoverage/budget machinery as phases 1-2 — no second budget system.
    const midCoverage = computeSearchCoverage(
      {
        queriesExecuted,
        sourcesAttempted,
        sourcesFailed,
        rawResultsCount: allResults.length,
        uniqueDomains: domainsOf(allResults),
        productPagesIdentified: allResults.filter(r => !!r.url).length,
        exploitableOffers: this.buildCandidates(allResults, criteria).filter(c => c.offer.price.value !== null).length,
        duplicatesRemoved: 0,
      },
      this.coverageThresholds
    );
    const budgetRemainingForPhase3 = Date.now() - start < this.maxTotalTimeMs;
    // Per-request override (e.g. a conversational "cherche aussi en
    // Allemagne" follow-up) takes precedence over the strategy's static
    // constructor-level default — see DiscoveryCriteria.internationalLanguages.
    const internationalLanguages = criteria.internationalLanguages ?? this.internationalLanguages;
    if (!midCoverage.saturated && this.maxPhases >= 3 && internationalLanguages.length > 0 && budgetRemainingForPhase3) {
      const phase3 = this.strategyPlanner.buildInternationalStrategies(criteria, criteria.hardConstraints ?? [], internationalLanguages);
      await runStrategies(phase3);
    }

    // Convert search results → offer candidates (exact-URL dedup + hard price
    // filter — DeduplicationEngine does the real cross-field merge downstream).
    const candidates = this.buildCandidates(allResults, criteria);

    coverage = computeSearchCoverage(
      {
        queriesExecuted,
        sourcesAttempted,
        sourcesFailed,
        elapsedMs: Date.now() - start,
        rawResultsCount: allResults.length,
        uniqueDomains: domainsOf(allResults),
        productPagesIdentified: allResults.filter(r => !!r.url).length,
        exploitableOffers: candidates.filter(c => c.offer.price.value !== null).length,
        duplicatesRemoved: allResults.length - candidates.length,
      },
      this.coverageThresholds
    );

    // Optional enrichment: fetch the actual page for the top candidates and
    // extract structured Product/Offer data (JSON-LD) to replace the
    // fragile snippet-regex price with a real published price when possible.
    // Best-effort only: never blocks, never overwrites good data with worse
    // data, never invents anything when extraction fails.
    let enrichedCount = 0;
    if (this.pageExtractor) {
      enrichedCount = await this.enrichTopCandidates(candidates, criteria);
    }

    return {
      id: resultId,
      timestamp: new Date(),
      criteria,
      candidates,
      statistics: {
        queriedSources: queriesExecuted,
        candidatesFound: allResults.length,
        candidatesFiltered: allResults.length - candidates.length,
        searchTimeMs: Date.now() - start,
        relevanceEstimate: candidates.length > 0 ? 'medium' : 'low',
        pageEnrichedCount: enrichedCount,
        coverage,
      },
      strategy: this.name,
      warnings: (() => {
        const w: string[] = [];
        if (sourcesFailed > 0) {
          w.push(`${sourcesFailed}/${sourcesAttempted} source quer(y/ies) failed and were skipped; search continued with the rest.`);
        }
        if (!budgetRemaining) {
          w.push(`Search time budget (${this.maxTotalTimeMs}ms) exhausted after phase 1 — phase 2 was skipped even though coverage was not saturated.`);
        }
        return w.length > 0 ? w : undefined;
      })(),
    };
  }

  /**
   * Picks which candidates are worth spending the enrichment budget on —
   * value/cost, not pure rank (megaprompt PARTIE 11). Enrichment's actual
   * value-add is (a) replacing a MISSING price — the fragile snippet-regex
   * often finds none — with a real published one, and (b) adding a merchant
   * (proxy for a distinct source/domain here — see DiscoveryResult.candidates'
   * offer.merchant) not yet covered among selections, rather than spending
   * the whole budget re-confirming five offers from the one domain that
   * happened to rank highest. Both signals reuse data already on the
   * candidate (offer.price.value, offer.merchant.id, matchScore) — no new
   * extraction, no new abstraction, and no re-implementation of ranking:
   * matchScore (from PriorityEngine-adjacent relevance scoring upstream)
   * still dominates — the bonuses are small nudges that only matter among
   * comparably-relevant candidates, never enough to pull a genuinely
   * irrelevant result ahead of a relevant one.
   */
  private selectEnrichmentTargets(
    candidates: DiscoveryResult['candidates']
  ): DiscoveryResult['candidates'] {
    const n = RealWebDiscoveryStrategy.MAX_ENRICHED_CANDIDATES;
    if (candidates.length <= n) return candidates;

    const MISSING_PRICE_BONUS = 0.15;
    const NEW_MERCHANT_BONUS = 0.1;

    const remaining = [...candidates];
    const selected: DiscoveryResult['candidates'] = [];
    const selectedMerchants = new Set<string>();

    while (selected.length < n && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        const missingPriceBonus = c.offer.price.value === null ? MISSING_PRICE_BONUS : 0;
        const newMerchantBonus = selectedMerchants.has(c.offer.merchant.id) ? 0 : NEW_MERCHANT_BONUS;
        const score = c.matchScore + missingPriceBonus + newMerchantBonus;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const [chosen] = remaining.splice(bestIdx, 1);
      selected.push(chosen);
      selectedMerchants.add(chosen.offer.merchant.id);
    }
    return selected;
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
    candidates: DiscoveryResult['candidates'],
    criteria: DiscoveryCriteria
  ): Promise<number> {
    const targets = this.selectEnrichmentTargets(candidates);
    if (targets.length === 0 || !this.pageExtractor) return 0;

    // The 'deliversTo' criterion (RequestInterpreter.extractDeliverabilityIntent())
    // carries the user's REQUESTED destination as preferredValues[0] — read
    // once here (not per-candidate) so extracted.shipsToCountries can be
    // turned into a single comparable characteristic value below, reusing
    // AdmissibilityEngine.checkPreferredValues() as-is (no admissibility.ts
    // changes needed). Absent when no such criterion is active this turn.
    const requestedDestination = criteria.hardConstraints
      ?.find(c => c.id === 'deliversTo')
      ?.parameters?.preferredValues as string[] | undefined;
    const destinationCountry = requestedDestination?.[0];

    const withTimeout = async <T,>(promise: Promise<T | null>): Promise<T | null> => {
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RealWebDiscoveryStrategy.ENRICHMENT_BUDGET_MS);
      });
      try {
        return await Promise.race([promise, timeout]);
      } finally {
        // Clear even when `promise` wins the race — an uncleared timer keeps
        // the event loop alive for the rest of the budget window for nothing.
        clearTimeout(timer!);
      }
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
        // Structured technical specs (category, ram, screen_size, storage) —
        // same characteristic keys the local catalog fixtures and
        // AdmissibilityEngine's structured constraints already use (see
        // request-interpreter.ts extractRAM/extractScreenSize/extractStorage
        // and admissibility.ts checkNumericConstraint). Only ever set when the
        // merchant's own JSON-LD actually publishes them — never guessed from
        // title/description. NormalizationEngine (already run at Stage 5 of
        // CapucineEngine.search()) canonicalizes these raw values exactly like
        // it does for catalog fixtures — no separate normalization needed here.
        if (extracted.category.status === 'known' && extracted.category.value) {
          candidate.offer.characteristics['category'] = extracted.category;
          changed = true;
        }
        if (extracted.ram.status === 'known' && extracted.ram.value) {
          candidate.offer.characteristics['ram'] = extracted.ram;
          changed = true;
        }
        if (extracted.screenSize.status === 'known' && extracted.screenSize.value) {
          candidate.offer.characteristics['screen_size'] = extracted.screenSize;
          changed = true;
        }
        if (extracted.storage.status === 'known' && extracted.storage.value) {
          candidate.offer.characteristics['storage'] = extracted.storage;
          changed = true;
        }
        // gtin/isbn → 'ean' — the exact characteristic key
        // DeduplicationEngine.getCharValue(offer, 'ean') already reads for
        // its identical_ean/identical_isbn signals (see deduplication.ts).
        // Wiring it here is what lets two DIFFERENT domains' offers for the
        // literal same product reach EXACT_MATCH confidence instead of only
        // ever having weaker title/model-number evidence to go on for
        // Web-discovered offers.
        if (extracted.gtin.status === 'known' && extracted.gtin.value) {
          candidate.offer.characteristics['ean'] = extracted.gtin;
          changed = true;
        }
        if (extracted.sku.status === 'known' && extracted.sku.value) {
          candidate.offer.characteristics['sku'] = extracted.sku;
          changed = true;
        }
        if (extracted.brand.status === 'known' && extracted.brand.value) {
          candidate.offer.characteristics['brand'] = extracted.brand;
          changed = true;
        }
        // 'condition' — same characteristic key + vocabulary
        // (new/refurbished/used) as RequestInterpreter.extractCondition(),
        // so a conversational "uniquement du neuf" follow-up can actually
        // resolve SATISFIED/VIOLATED against a real Web offer instead of
        // always UNKNOWN (no prior source ever populated this key).
        if (extracted.condition.status === 'known' && extracted.condition.value) {
          candidate.offer.characteristics['condition'] = extracted.condition;
          changed = true;
        }
        // 'deliversTo' — only computed when a destination was actually
        // requested THIS turn (destinationCountry set above) AND the page
        // published resolvable shipping-destination data. The stored value
        // is the destination itself when the offer DOES ship there (so
        // AdmissibilityEngine.checkPreferredValues([destinationCountry])
        // matches → SATISFIED), or the offer's actual (different) shipping
        // countries when it does NOT (so the same check finds no match →
        // VIOLATED). No admissibility.ts changes — reuses the existing
        // string-equality preferredValues path exactly as every other
        // criterion does. Absent (never fabricated) when the page
        // published no resolvable destination at all — stays UNKNOWN.
        if (destinationCountry && extracted.shipsToCountries.status === 'known' && extracted.shipsToCountries.value) {
          const ships = (extracted.shipsToCountries.value as string[]).includes(destinationCountry);
          candidate.offer.characteristics['deliversTo'] = {
            value: ships ? destinationCountry : extracted.shipsToCountries.value.join(','),
            status: 'known',
            provenance: extracted.shipsToCountries.provenance,
          };
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
  // (Query construction now lives in SearchStrategyPlanner — see discover().)

  /**
   * Convert raw search results into Offer skeletons.
   *
   * IMPORTANT: These offers have minimal characteristics (extracted from snippets).
   * They must pass through NormalizationEngine before ranking.
   * All characteristics have status='known' (not 'verified') to signal they
   * came from a web snippet, not a canonical source.
   */
  private buildCandidates(
    results: SourcedWebResult[],
    criteria: DiscoveryCriteria
  ): DiscoveryResult['candidates'] {
    const candidates: DiscoveryResult['candidates'] = [];
    const seenUrls = new Set<string>();

    for (const result of results) {
      // Deduplicate by exact URL — NOT by domain. A domain is a merchant, not
      // a product: fnac.com legitimately lists many different laptops, and
      // deduping by domain alone was silently collapsing all of them into
      // one, which is a real coverage bug (not just rough tidying) —
      // "recherche large multi-domaine" means preserving distinct offers
      // from the same merchant, not capping one-result-per-domain.
      // The exact same URL surfacing twice (e.g. two sources finding the
      // same product page) IS a genuine duplicate — DeduplicationEngine does
      // the real cross-field merge downstream, this is just the coarse
      // "don't build two candidates from the identical page" pass.
      if (result.url) {
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);
      }

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

  private buildOfferSkeleton(result: SourcedWebResult, price: number | null): Offer {
    const id = `web-${result.domain}-${result.position}`;

    // Price DataPoint — provenance names the EXACT source that produced this
    // result (tagged at fetch time in discover()'s runStrategies, from
    // ToolResponse.provenance.source in registry mode or adapter.adapterName
    // in direct mode), even when several sources ran in parallel.
    const adapterName = result.__sourceName ?? 'web_search';
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
