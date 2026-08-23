/**
 * Capucine — CapucineEngine
 *
 * The end-to-end pipeline. Wires all layers together.
 *
 * Pipeline:
 *   USER REQUEST (text)
 *     → [BasicPatternInterpreter] heuristic NL → structured criteria
 *     → [ClarificationEngine] detect ambiguities
 *     → [ProfileEngine] merge PROFILE + REQUEST + OVERRIDES → effectiveCriteria
 *     → [SearchPlanBuilder] build discovery strategy (with rarity, escalation policy)
 *     → [AIOrchestrator?] enrich plan with synonyms / alternative terms (optional)
 *     → [DiscoveryOrchestrator] find candidates (with auto-escalation on 0 results)
 *     → [NormalizationEngine] normalize characteristic values
 *     → [DeduplicationEngine] group identical products
 *     → [AdmissibilityEngine] hard filter (required/forbidden)
 *     → [rankOffers (PriorityEngine)] deterministic scoring
 *     → [ExplanationEngine] generate structured explanations
 *     → [NoResultsAnalyzer] if 0 results: diagnose why
 *     → SearchEngineResult
 *
 * INVARIANTS enforced by pipeline architecture:
 * 1. AI output is NEVER passed directly to PriorityEngine
 * 2. AdmissibilityEngine runs BEFORE PriorityEngine (hard gate)
 * 3. ProfileSnapshot is taken ONCE at pipeline start (immutable)
 * 4. originalRequest is never mutated
 * 5. Merchant identity and source never affect ranking
 * 6. SearchPlan escalation NEVER weakens hard constraints
 *
 * SECURITY: No API keys in this file. AI provider configuration is injected.
 */

import { UserProfile, PreferenceCriterion, RankingResult, Offer, UsageContext } from '../domain/types';
import { AdmissibilityEngine, AdmissibilityBatch, RejectedOffer } from '../domain/admissibility';
import { ProfileEngine, ProfileOverride } from '../domain/profile';
import { rankOffers } from '../decision/priority-engine';
import { DeduplicationEngine, DeduplicationResult } from './deduplication';
import { DiscoveryOrchestrator, DiscoveryCriteria, DiscoveryResult } from './discovery';
import { NormalizationEngine } from './normalization-engine';
import { SearchPlan, SearchPlanBuilder, SearchPhaseQueryBuilder, PhaseTerms } from './search-plan';
import { ClarificationEngine, ClarificationAnalysis } from './clarification-engine';
import { ExplanationEngine, FullExplanation } from './explanation-engine';
import { NoResultsAnalyzer, NoResultsDiagnosis } from './no-results-analyzer';
import { AIOrchestrator } from './ai-orchestrator';
import { InMemoryDiscoveryStrategy } from './in-memory-discovery';
import {
  BasicPatternInterpreter,
  DOMAIN_PRODUCT_CATEGORIES,
  extractRankingPreference,
  extractInternationalIntent,
  extractResultLimit,
  extractMerchantExclusion,
  extractFreeShippingIntent,
  extractDeliverabilityIntent,
  extractRetryIntent,
  RetryIntent,
  InternationalIntent,
} from './request-interpreter';
import { RankingPreference } from './ranking-preference';
import { InterpretedRequest } from './request';
import { RealWebDiscoveryStrategy } from './real-web-discovery';
import { detectWebSearchAdapters } from './web-search-adapters';
import { ToolRegistry, buildDefaultToolRegistry } from './tools';
import { ProductPageExtractor } from './product-page-extractor';
import { SupportedLanguage, resolveLanguage } from './i18n';
import { defaultLanguageDetector } from './language-detection';

// ============================================================================
// ENGINE INPUT / OUTPUT
// ============================================================================

export interface SearchRequest {
  /** The user's raw natural language query */
  queryText: string;

  /** Session / request ID for tracing */
  requestId: string;

  /** The user's permanent profile */
  profile: UserProfile;

  /** Temporary overrides for this search (don't modify profile) */
  overrides?: ProfileOverride[];

  /** If AI interpretation is available, pre-parsed criteria can be provided */
  preInterpretedCriteria?: PreferenceCriterion[];

  /** Skip AI interpretation (use only pre-interpreted criteria) */
  skipAIInterpretation?: boolean;

  /**
   * Explicit language for THIS request (e.g. 'fr', 'en') — highest priority
   * in resolveLanguage()'s chain (i18n.ts): explicit request > session >
   * profile > system default. A French profile writing this one query in
   * English must be answered in English — see resolveLanguage().
   * When absent, the language is detected from queryText (language-detection.ts).
   */
  language?: string;

  /**
   * Per-request international search-language override — e.g. a
   * conversational "cherche aussi en Allemagne" follow-up adds 'de' for
   * just this search. Threaded into DiscoveryCriteria.internationalLanguages
   * (see planToDiscoveryCriteria()), which RealWebDiscoveryStrategy's
   * ALREADY-EXISTING phase-3 (SearchStrategyPlanner.buildInternationalStrategies())
   * consumes — no second international-search mechanism. Distinct from
   * `language` above: that's the RESPONSE language, this is which
   * ADDITIONAL languages phase 3 searches in (see megaprompt Part 9's
   * "ne confonds jamais langue de réponse et langues de recherche").
   */
  additionalSearchLanguages?: SupportedLanguage[];
}

/**
 * Provenance summary — which discovery sources contributed offers.
 * Present on every SearchEngineResult so callers can always trace
 * where ranked results came from, end-to-end.
 */
export interface ProvenanceSummary {
  /** source name → count of ranked offers from that source */
  sourceContributions: Record<string, number>;
  /** total ranked offers considered */
  totalRankedOffers: number;
  /** all unique source names that contributed at least one offer */
  contributingSources: string[];
}

export interface SearchEngineResult {
  requestId: string;
  completedAt: Date;
  durationMs: number;

  /** Final ranking result */
  ranking: RankingResult;

  /** Detailed explanations */
  explanation: FullExplanation;

  /** Deduplication details */
  deduplication: DeduplicationResult;

  /** Admissibility filter details */
  admissibility: AdmissibilityBatch;

  /** Discovery details */
  discovery: DiscoveryResult;

  /** The search plan that drove discovery (with rarity, escalation levels tried) */
  searchPlan: SearchPlan;

  /** Clarification opportunities (if any) */
  clarifications: ClarificationAnalysis;

  /** Criteria actually used for ranking */
  effectiveCriteria: PreferenceCriterion[];

  /** No-results diagnosis (only present if 0 offers ranked) */
  noResultsDiagnosis?: NoResultsDiagnosis;

  /**
   * Provenance summary: which discovery sources contributed offers to the final ranking.
   * Keys are source names (e.g. 'in_memory', 'brave_search').
   * Values are the count of ranked offers from that source.
   * Satisfies MEGAPROMPT invariant: "aucune provenance supprimée lors d'une transformation".
   */
  provenanceSummary: ProvenanceSummary;

  /**
   * If BasicPatternInterpreter was invoked on raw queryText,
   * the interpretation is recorded here for transparency.
   * Absent if preInterpretedCriteria were provided directly.
   */
  interpretedRequest?: InterpretedRequest;

  /**
   * The EFFECTIVE query language for this search, resolved via
   * resolveLanguage() (i18n.ts): explicit request.language > detected from
   * queryText > profile.preferredLanguage > DEFAULT_LANGUAGE. Drives which
   * language(s) RealWebDiscoveryStrategy searches in (see DiscoveryCriteria.
   * language) — kept in the result so the API/response layer can also
   * answer in this language (translate(), i18n.ts) without re-detecting it.
   */
  language: SupportedLanguage;

  /** Pipeline stages timing for debugging */
  timing: PipelineTiming;
}

export interface PipelineTiming {
  interpretationMs: number;
  clarificationMs: number;
  profileMergeMs: number;
  planBuildMs: number;
  discoveryMs: number;
  normalizationMs: number;
  deduplicationMs: number;
  admissibilityMs: number;
  rankingMs: number;
  explanationMs: number;
  totalMs: number;
}

// ============================================================================
// ENGINE OPTIONS
// ============================================================================

export interface CapucineEngineOptions {
  /** Maximum candidates to pass to ranking (prevents O(n²) on large catalogs) */
  maxCandidates?: number;

  /** If true, proceed even if clarifications are recommended */
  proceedDespiteClarifications?: boolean;

  /** AI orchestrator (optional — used to enrich search terms / synonyms) */
  aiOrchestrator?: AIOrchestrator;

  /** Override discovery orchestrator (for testing) */
  discoveryOrchestrator?: DiscoveryOrchestrator;

  /**
   * Tool registry — all tool calls (web search etc.) route through this.
   * Enforces: timeout, rate limiting, audit trail, availability checks.
   * If not provided, one is built automatically from env vars.
   * Pass a pre-built registry from server.ts so both share the same instance
   * (one audit log, one rate-limit counter).
   */
  toolRegistry?: ToolRegistry;

  /**
   * Whether to auto-register RealWebDiscoveryStrategy when env vars are present.
   * Default: true in production, false when discoveryOrchestrator is injected.
   */
  enableWebDiscovery?: boolean;

  /**
   * Whether RealWebDiscoveryStrategy should attempt to enrich top candidates
   * with real page data (JSON-LD) after the snippet-based skeleton is built.
   * Default: true when web discovery is enabled. Independent flag so page
   * enrichment can be disabled (e.g. for latency-sensitive tests) without
   * disabling web search entirely.
   */
  enablePageEnrichment?: boolean;
}

// ============================================================================
// CAPUCINE ENGINE
// ============================================================================

/**
 * The main execution engine for Capucine.
 *
 * This class is the only place where all layers are wired together.
 * Tests can inject mock discovery, mock AI, etc.
 *
 * DETERMINISTIC: Given the same inputs, always produces the same output.
 * (Assuming deterministic AI, which in tests is always the case via mocks.)
 */
export class CapucineEngine {
  private readonly admissibilityEngine: AdmissibilityEngine;
  private readonly profileEngine: ProfileEngine;
  private readonly deduplicationEngine: DeduplicationEngine;
  private readonly normalizationEngine: NormalizationEngine;
  private readonly clarificationEngine: ClarificationEngine;
  private readonly explanationEngine: ExplanationEngine;
  private readonly noResultsAnalyzer: NoResultsAnalyzer;
  private readonly discoveryOrchestrator: DiscoveryOrchestrator;
  private readonly interpreter: BasicPatternInterpreter;
  private readonly planBuilder: SearchPlanBuilder;
  private readonly phaseQueryBuilder: SearchPhaseQueryBuilder;
  private readonly aiOrchestrator?: AIOrchestrator;
  /** Shared ToolRegistry — owns the audit log and rate-limit counters for this engine instance */
  readonly toolRegistry: ToolRegistry;
  private readonly options: Required<Omit<CapucineEngineOptions, 'aiOrchestrator' | 'discoveryOrchestrator' | 'toolRegistry'>>;

  constructor(options: CapucineEngineOptions = {}) {
    this.admissibilityEngine = new AdmissibilityEngine();
    this.profileEngine = new ProfileEngine();
    this.deduplicationEngine = new DeduplicationEngine();
    this.normalizationEngine = new NormalizationEngine();
    this.clarificationEngine = new ClarificationEngine();
    this.explanationEngine = new ExplanationEngine();
    this.noResultsAnalyzer = new NoResultsAnalyzer();
    this.interpreter = new BasicPatternInterpreter();
    this.planBuilder = new SearchPlanBuilder();
    this.phaseQueryBuilder = new SearchPhaseQueryBuilder();
    this.aiOrchestrator = options.aiOrchestrator;

    // ── ToolRegistry ─────────────────────────────────────────────────────────
    // Use the injected registry (shared with server.ts for unified audit log)
    // or build a fresh one from env vars. Either way, ALL tool calls in this
    // engine instance go through this single registry.
    if (options.toolRegistry) {
      this.toolRegistry = options.toolRegistry;
    } else {
      const webAdapters = detectWebSearchAdapters();
      this.toolRegistry = buildDefaultToolRegistry(webAdapters);
    }

    // ── Discovery orchestrator ────────────────────────────────────────────────
    if (options.discoveryOrchestrator) {
      this.discoveryOrchestrator = options.discoveryOrchestrator;
    } else {
      this.discoveryOrchestrator = new DiscoveryOrchestrator();

      // Always register in-memory as primary fallback (REAL implementation — not a mock)
      const inMemory = new InMemoryDiscoveryStrategy();
      this.discoveryOrchestrator.registerStrategy(inMemory, true);

      // Auto-register web discovery routed through ToolRegistry.
      // RealWebDiscoveryStrategy in REGISTRY MODE enforces:
      //   - per-call timeout (default 10s)
      //   - rate limiting (100 calls/min by default)
      //   - audit trail entry on every call
      //   - availability check (listWebSearchTools() — any 'web_search'/'web_search_<name>' source)
      const enableWeb = options.enableWebDiscovery ?? true;
      if (enableWeb && this.toolRegistry.listWebSearchTools().length > 0) {
        // Pass ToolRegistry — strategy routes through it, not the raw adapter.
        // Also pass a ProductPageExtractor so top candidates get real page
        // enrichment (JSON-LD) instead of relying solely on the snippet-regex
        // price heuristic. Independently toggleable via enablePageEnrichment.
        const enrichPages = options.enablePageEnrichment ?? true;
        const pageExtractor = enrichPages ? new ProductPageExtractor() : undefined;
        const webStrategy = new RealWebDiscoveryStrategy(this.toolRegistry, pageExtractor);
        this.discoveryOrchestrator.registerStrategy(webStrategy, true);
      }
    }

    this.options = {
      maxCandidates: options.maxCandidates ?? 100,
      proceedDespiteClarifications: options.proceedDespiteClarifications ?? true,
      enableWebDiscovery: options.enableWebDiscovery ?? true,
      enablePageEnrichment: options.enablePageEnrichment ?? true,
    };
  }

  /**
   * Interpret a short standalone piece of text (e.g. a conversational
   * follow-up like "élargis à 1100€", "uniquement du neuf", "montre-moi les
   * moins chers", "cherche aussi en Allemagne") into criteria + ranking/
   * international-search intent, WITHOUT running a search. Reuses the same
   * BasicPatternInterpreter as search()/searchSync() for criteria, plus the
   * standalone extractRankingPreference()/extractInternationalIntent()
   * functions (request-interpreter.ts) — no parallel NLU logic.
   *
   * Used by ConversationManager.applyFollowUp() (see server.ts POST /clarify)
   * to compute the delta for a refinement turn.
   */
  interpretFollowUp(text: string, userId = 'anonymous', destinationCountry = 'FR'): {
    criteria: PreferenceCriterion[];
    rankingPreference: RankingPreference | null;
    internationalIntent: InternationalIntent | null;
    resultLimit: number | null;
    excludeMerchantName: string | null;
    retryIntent: RetryIntent | null;
  } {
    const interpreted = this.interpreter.interpretSync({
      id: `followup-${Date.now()}`,
      userId,
      text,
      timestamp: new Date(),
    });
    // Free-shipping/deliverability intents are themselves PreferenceCriterion
    // objects (same shape as condition/category) — folded into the same
    // criteria array the caller already merges by id, no separate channel.
    const criteria = [...interpreted.extractedCriteria];
    const freeShipping = extractFreeShippingIntent(text);
    if (freeShipping) criteria.push(freeShipping);
    const deliverability = extractDeliverabilityIntent(text, destinationCountry);
    if (deliverability) criteria.push(deliverability);

    return {
      criteria,
      rankingPreference: extractRankingPreference(text),
      internationalIntent: extractInternationalIntent(text),
      retryIntent: extractRetryIntent(text),
      resultLimit: extractResultLimit(text),
      excludeMerchantName: extractMerchantExclusion(text),
    };
  }

  // ============================================================================
  // MAIN ENTRY POINT
  // ============================================================================

  /**
   * Execute a full search pipeline.
   */
  async search(request: SearchRequest): Promise<SearchEngineResult> {
    const pipelineStart = Date.now();
    const timing: PipelineTiming = {
      interpretationMs: 0,
      clarificationMs: 0,
      profileMergeMs: 0,
      planBuildMs: 0,
      discoveryMs: 0,
      normalizationMs: 0,
      deduplicationMs: 0,
      admissibilityMs: 0,
      rankingMs: 0,
      explanationMs: 0,
      totalMs: 0,
    };

    // ── Language resolution ───────────────────────────────────────────────────
    // Priority: explicit request.language > detected from queryText >
    // profile.preferredLanguage > DEFAULT_LANGUAGE ('fr'). See i18n.ts's
    // resolveLanguage() for why explicit-request always wins (a French
    // profile writing THIS query in English must be answered in English).
    const detected = request.queryText ? defaultLanguageDetector.detectLanguage(request.queryText) : undefined;
    const detectedLanguage = detected && detected.language !== 'unknown' && detected.confidence >= 0.15
      ? detected.language
      : undefined;
    const effectiveLanguage: SupportedLanguage = resolveLanguage({
      requestLanguage: request.language,
      sessionLanguage: detectedLanguage,
      profileLanguage: request.profile.preferredLanguage,
    });

    // ── Stage 0: NL Interpretation (BasicPatternInterpreter) ─────────────────
    let preProfileCriteria = request.preInterpretedCriteria ?? [];
    let interpretedRequest: InterpretedRequest | undefined;

    if (
      preProfileCriteria.length === 0 &&
      request.queryText &&
      !request.skipAIInterpretation
    ) {
      const interpretStart = Date.now();
      interpretedRequest = await this.interpreter.interpret({
        id: `q-${request.requestId}`,
        userId: request.profile.userId,
        text: request.queryText,
        timestamp: new Date(),
      });
      preProfileCriteria = interpretedRequest.extractedCriteria;
      timing.interpretationMs = Date.now() - interpretStart;
    }

    // ── Stage 1: Clarification check ─────────────────────────────────────────
    const clarificationStart = Date.now();
    const clarifications = this.clarificationEngine.analyze(
      preProfileCriteria,
      request.queryText,
      request.requestId
    );
    timing.clarificationMs = Date.now() - clarificationStart;

    // ── Stage 2: Profile merge ────────────────────────────────────────────────
    const profileMergeStart = Date.now();
    const effectiveCriteriaSet = this.profileEngine.resolve(
      request.profile,
      {
        criteria: preProfileCriteria,
        createdAt: new Date(),
        queryText: request.queryText,
        usageContext: interpretedRequest?.usageContext,
      },
      request.overrides ?? [],
      request.requestId
    );
    const effectiveCriteria = [...effectiveCriteriaSet.criteria] as PreferenceCriterion[];
    timing.profileMergeMs = Date.now() - profileMergeStart;

    // ── Stage 3: Build search plan ────────────────────────────────────────────
    const planStart = Date.now();
    let searchPlan = this.buildSearchPlan(
      effectiveCriteria,
      request.queryText,
      request.requestId,
      interpretedRequest,
      effectiveCriteriaSet.usageContext
    );

    // If AI orchestrator available, enrich plan with synonyms / alternative terms
    let aiSynonyms: string[] = [];
    let aiAltSpellings: string[] = [];
    if (this.aiOrchestrator && searchPlan.query.primaryTerms.length > 0) {
      try {
        const termDescription = searchPlan.query.primaryTerms.join(' ');
        const enriched = await this.aiOrchestrator.generateSearchTerms(termDescription, 'fr');
        aiSynonyms = enriched.synonyms;
        aiAltSpellings = enriched.alternativeSpellings;
        if (enriched.synonyms.length > 0 || enriched.alternativeSpellings.length > 0) {
          searchPlan = {
            ...searchPlan,
            query: {
              ...searchPlan.query,
              alternativeTerms: [
                ...(searchPlan.query.alternativeTerms ?? []),
                ...enriched.synonyms,
                ...enriched.alternativeSpellings,
              ],
            },
          };
        }
      } catch {
        // AI term enrichment failure is non-fatal; proceed with basic terms
      }
    }

    // Build phase-specific term sets AFTER AI enrichment so all synonyms are included.
    // phaseTerms drives what keywords are sent at each escalation level.
    const phaseTerms = this.phaseQueryBuilder.buildPhaseTerms(
      searchPlan.query,
      aiSynonyms,
      aiAltSpellings
    );
    timing.planBuildMs = Date.now() - planStart;

    // ── Stage 4: Discovery with auto-escalation ───────────────────────────────
    const discoveryStart = Date.now();
    const { discovery, finalPlan } = await this.discoverWithEscalation(
      searchPlan,
      request.queryText,
      phaseTerms,
      effectiveLanguage,
      request.additionalSearchLanguages
    );
    searchPlan = finalPlan;
    timing.discoveryMs = Date.now() - discoveryStart;

    let candidates = discovery.candidates.map(c => c.offer);
    if (candidates.length > this.options.maxCandidates) {
      candidates = candidates.slice(0, this.options.maxCandidates);
    }

    // ── Stage 5: Normalization ────────────────────────────────────────────────
    const normalizationStart = Date.now();
    candidates = this.normalizeCandidates(candidates);
    timing.normalizationMs = Date.now() - normalizationStart;

    // ── Stage 6: Deduplication + Conflict Resolution ─────────────────────────
    // For groups with multiple offers (same product, multiple sources):
    //   - Agreeing fields → 'verified'
    //   - Disagreeing fields → 'contradictory' (CONFLICTING preserved, never silently resolved)
    // For single-offer groups: pass through unchanged.
    const deduplicationStart = Date.now();
    const deduplication = this.deduplicationEngine.deduplicate(candidates);
    // One group is one PRODUCT; a product legitimately has several competing
    // commercial offers (four merchants, four prices). resolveOffers() merges
    // product-level data across the group while keeping each distinct offer —
    // see deduplication.ts. Collapsing to one offer per group would delete
    // real, often cheaper, prices.
    const deduplicatedOffers: Offer[] = deduplication.groups.flatMap(g =>
      this.deduplicationEngine.resolveOffers(g)
    );
    timing.deduplicationMs = Date.now() - deduplicationStart;

    // ── Stage 7: Admissibility ────────────────────────────────────────────────
    const admissibilityStart = Date.now();
    const admissibility = this.admissibilityEngine.filter(
      deduplicatedOffers,
      effectiveCriteria
    );
    timing.admissibilityMs = Date.now() - admissibilityStart;

    const eligibleOffers = admissibility.eligibleOffers;
    const rejectedForRanking = admissibility.rejectedOffers.map((r: RejectedOffer) => ({
      offer: r.offer,
      reason: r.primaryViolation,
    }));

    // ── Stage 8: Ranking (PriorityEngine) ─────────────────────────────────────
    // AdmissibilityEngine (Stage 7) is the sole source of truth for eligibility;
    // PriorityEngine consumes its verdict (resultsByOfferId) rather than
    // re-deciding "required/forbidden constraint violated?" on its own — see
    // priority-engine.ts's scoreOffer(). Offers here are already the eligible
    // subset, so rankOffers' own rejectedOffers will be empty by construction;
    // ranking.rejectedOffers is set to the full-pipeline rejection list (offers
    // that never reached ranking at all, rejected back at Stage 7) so
    // ExplanationEngine/server.ts still see every rejection, not just none.
    const rankingStart = Date.now();
    const ranking = rankOffers(
      {
        offers: eligibleOffers,
        effectiveCriteria,
        requestId: request.requestId,
        timestamp: new Date(),
      },
      admissibility.resultsByOfferId
    );
    ranking.rejectedOffers = rejectedForRanking;
    timing.rankingMs = Date.now() - rankingStart;

    // ── Stage 9: Explanation ──────────────────────────────────────────────────
    const explanationStart = Date.now();
    const explanation = this.explanationEngine.explain(ranking);
    timing.explanationMs = Date.now() - explanationStart;

    // ── Stage 10: NoResults analysis ──────────────────────────────────────────
    let noResultsDiagnosis: NoResultsDiagnosis | undefined;
    if (ranking.rankedOffers.length === 0) {
      noResultsDiagnosis = this.noResultsAnalyzer.analyze(
        rejectedForRanking,
        effectiveCriteria,
        candidates.length,
        request.requestId
      );
    }

    timing.totalMs = Date.now() - pipelineStart;

    return {
      requestId: request.requestId,
      completedAt: new Date(),
      durationMs: timing.totalMs,
      ranking,
      explanation,
      deduplication,
      admissibility,
      discovery,
      searchPlan,
      clarifications,
      effectiveCriteria,
      noResultsDiagnosis,
      provenanceSummary: this.buildProvenanceSummary(ranking),
      interpretedRequest,
      language: effectiveLanguage,
      timing,
    };
  }

  /**
   * Synchronous search (uses sync discovery path, no escalation, no AI enrichment).
   * Useful for tests where async is not necessary.
   */
  searchSync(request: SearchRequest): SearchEngineResult {
    const pipelineStart = Date.now();
    const timing: PipelineTiming = {
      interpretationMs: 0,
      clarificationMs: 0,
      profileMergeMs: 0,
      planBuildMs: 0,
      discoveryMs: 0,
      normalizationMs: 0,
      deduplicationMs: 0,
      admissibilityMs: 0,
      rankingMs: 0,
      explanationMs: 0,
      totalMs: 0,
    };

    // ── Language resolution (same rule as search() — see there for rationale) ──
    const syncDetected = request.queryText ? defaultLanguageDetector.detectLanguage(request.queryText) : undefined;
    const syncDetectedLanguage = syncDetected && syncDetected.language !== 'unknown' && syncDetected.confidence >= 0.15
      ? syncDetected.language
      : undefined;
    const syncEffectiveLanguage: SupportedLanguage = resolveLanguage({
      requestLanguage: request.language,
      sessionLanguage: syncDetectedLanguage,
      profileLanguage: request.profile.preferredLanguage,
    });

    // ── Stage 0: NL Interpretation ────────────────────────────────────────────
    let preProfileCriteria = request.preInterpretedCriteria ?? [];
    let interpretedRequest: InterpretedRequest | undefined;

    if (
      preProfileCriteria.length === 0 &&
      request.queryText &&
      !request.skipAIInterpretation
    ) {
      const interpretStart = Date.now();
      interpretedRequest = this.interpreter.interpretSync({
        id: `q-${request.requestId}`,
        userId: request.profile.userId,
        text: request.queryText,
        timestamp: new Date(),
      });
      preProfileCriteria = interpretedRequest.extractedCriteria;
      timing.interpretationMs = Date.now() - interpretStart;
    }

    // ── Stage 1: Clarification ────────────────────────────────────────────────
    const clarifications = this.clarificationEngine.analyze(
      preProfileCriteria,
      request.queryText,
      request.requestId
    );

    // ── Stage 2: Profile merge ────────────────────────────────────────────────
    const effectiveCriteriaSet = this.profileEngine.resolve(
      request.profile,
      { criteria: preProfileCriteria, createdAt: new Date(), queryText: request.queryText },
      request.overrides ?? [],
      request.requestId
    );
    const effectiveCriteria = [...effectiveCriteriaSet.criteria] as PreferenceCriterion[];

    // ── Stage 3: Build search plan ────────────────────────────────────────────
    const planStart = Date.now();
    const searchPlan = this.buildSearchPlan(
      effectiveCriteria,
      request.queryText,
      request.requestId,
      interpretedRequest
    );
    // Sync path has no AI enrichment — build phase terms from plan alone
    const syncPhaseTerms = this.phaseQueryBuilder.buildPhaseTerms(searchPlan.query);
    timing.planBuildMs = Date.now() - planStart;

    // ── Stage 4: Discovery (sync, no escalation) ──────────────────────────────
    const discoveryCriteria = this.planToDiscoveryCriteria(searchPlan, request.queryText, syncPhaseTerms, syncEffectiveLanguage);
    const discoveryStart = Date.now();
    const discovery = this.discoveryOrchestrator.discoverSync(discoveryCriteria);
    timing.discoveryMs = Date.now() - discoveryStart;

    let candidates = discovery.candidates.map(c => c.offer);
    if (candidates.length > this.options.maxCandidates) {
      candidates = candidates.slice(0, this.options.maxCandidates);
    }

    // ── Stage 5-10: Normalization → Ranking ───────────────────────────────────
    candidates = this.normalizeCandidates(candidates);

    const deduplication = this.deduplicationEngine.deduplicate(candidates);
    // One group is one PRODUCT; a product legitimately has several competing
    // commercial offers (four merchants, four prices). resolveOffers() merges
    // product-level data across the group while keeping each distinct offer —
    // see deduplication.ts. Collapsing to one offer per group would delete
    // real, often cheaper, prices.
    const deduplicatedOffers: Offer[] = deduplication.groups.flatMap(g =>
      this.deduplicationEngine.resolveOffers(g)
    );

    const admissibility = this.admissibilityEngine.filter(
      deduplicatedOffers,
      effectiveCriteria
    );
    const eligibleOffers = admissibility.eligibleOffers;
    const rejectedForRanking = admissibility.rejectedOffers.map((r: RejectedOffer) => ({
      offer: r.offer,
      reason: r.primaryViolation,
    }));

    const ranking = rankOffers(
      {
        offers: eligibleOffers,
        effectiveCriteria,
        requestId: request.requestId,
        timestamp: new Date(),
      },
      admissibility.resultsByOfferId
    );
    ranking.rejectedOffers = rejectedForRanking;

    const explanation = this.explanationEngine.explain(ranking);

    let noResultsDiagnosis: NoResultsDiagnosis | undefined;
    if (ranking.rankedOffers.length === 0) {
      noResultsDiagnosis = this.noResultsAnalyzer.analyze(
        rejectedForRanking,
        effectiveCriteria,
        candidates.length,
        request.requestId
      );
    }

    timing.totalMs = Date.now() - pipelineStart;

    return {
      requestId: request.requestId,
      completedAt: new Date(),
      durationMs: timing.totalMs,
      ranking,
      explanation,
      deduplication,
      admissibility,
      discovery,
      searchPlan,
      clarifications,
      effectiveCriteria,
      noResultsDiagnosis,
      provenanceSummary: this.buildProvenanceSummary(ranking),
      interpretedRequest,
      language: syncEffectiveLanguage,
      timing,
    };
  }

  // ============================================================================
  // SEARCH PLAN CONSTRUCTION
  // ============================================================================

  /**
   * Build provenance summary from ranked offers.
   * Aggregates offer.provenance.source across all ranked offers.
   * INVARIANT: provenance is never stripped — if an offer has no provenance,
   * it is counted under 'unknown' rather than silently omitted.
   */
  private buildProvenanceSummary(ranking: RankingResult): ProvenanceSummary {
    const contributions: Record<string, number> = {};
    for (const ranked of ranking.rankedOffers) {
      const src = ranked.offer.provenance?.source ?? 'unknown';
      contributions[src] = (contributions[src] ?? 0) + 1;
    }
    return {
      sourceContributions: contributions,
      totalRankedOffers: ranking.rankedOffers.length,
      contributingSources: Object.keys(contributions),
    };
  }

  /**
   * Build a SearchPlan from effective criteria and raw query text.
   *
   * INVARIANT: The SearchPlan captures hard constraints from criteria.
   * These constraints are NEVER weakened by escalation.
   */
  private buildSearchPlan(
    criteria: PreferenceCriterion[],
    queryText: string,
    requestId: string,
    interpreted?: InterpretedRequest,
    usageContext?: UsageContext
  ): SearchPlan {
    // Use interpreter's product terms if available (brand names, model numbers, etc.)
    // Fall back to keyword extraction from raw text.
    const primaryTerms = (interpreted?.suggestedSearchTerms?.length ?? 0) > 0
      ? interpreted!.suggestedSearchTerms!
      : this.extractPrimaryTerms(queryText, criteria);

    // Extract categories from criteria. RequestInterpreter (and inline/
    // profile criteria following the same convention) stores the detected
    // category as `preferredValues: [id]` — see
    // request-interpreter.ts's applyCategoryDetection() doc comment for why
    // (it's what makes AdmissibilityEngine's checkPreferredValues() actually
    // verify it) — never a bespoke `category` key, so reading that key here
    // silently produced an always-empty array; DiscoveryCriteria.categories
    // was therefore dead code for every search.
    //
    // Only DOMAIN category ids (DOMAIN_PRODUCT_CATEGORIES — real catalog
    // categories like 'ordinateur_portable') go into `categories`, which
    // feeds DiscoveryCriteria.categories' HARD pre-filter (see
    // in-memory-discovery.ts): a GENERIC id (e.g. 'electronics') matches no
    // catalog entry, so using it there would silently zero out every
    // candidate instead of narrowing the search — exactly the failure mode
    // that made a naive `preferredValues[0]` fix dangerous. A generic-only
    // detection still isn't lost — planBuilder's categoryTerms folds
    // `categories` into search keywords too, and any category word already
    // reached primaryTerms/suggestedSearchTerms via normal term extraction.
    const categories: string[] = [];
    for (const c of criteria) {
      if (c.id === 'category' || c.id === 'catégorie') {
        const preferredValues = (c.parameters?.preferredValues as string[] | undefined) ?? [];
        for (const value of preferredValues) {
          if (DOMAIN_PRODUCT_CATEGORIES.has(value)) categories.push(value);
        }
      }
    }

    // Extract budget
    let maxPrice: number | undefined;
    let minPrice: number | undefined;
    for (const c of criteria) {
      if (c.id.includes('budget') || c.id.includes('price') || c.name.toLowerCase().includes('budget')) {
        const mb = c.parameters?.maxBudget as number | undefined;
        if (mb !== undefined) maxPrice = mb;
        const lb = c.parameters?.minBudget as number | undefined;
        if (lb !== undefined) minPrice = lb;
      }
    }

    // Extract hard constraints (required + forbidden)
    const hardConstraints = criteria.filter(
      c => c.level === 'forbidden' || c.level === 'required'
    );

    // Detect rarity signal from query text
    const rarityLevel = this.detectRarityFromQuery(queryText);

    return this.planBuilder.build({
      requestId,
      primaryTerms,
      categories: categories.length > 0 ? categories : undefined,
      hardConstraints,
      rarityLevel,
      maxPrice,
      currency: 'EUR',
    });
  }

  /**
   * Extract meaningful search terms from raw query text.
   * Removes stop words, punctuation, and very short tokens.
   */
  private extractPrimaryTerms(queryText: string, criteria: PreferenceCriterion[]): string[] {
    if (!queryText) return [];

    const words = queryText
      .toLowerCase()
      .replace(/[^\w\s\-àâäéèêëïîôùûüç]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    // Prefer meaningful terms first (not budget/constraint words)
    const budgetWords = new Set(['moins', 'budget', 'euros', 'maximum', 'minimum', 'maxi', 'mini']);
    const meaningful = words.filter(w => !budgetWords.has(w));

    // Take up to 6 terms
    const terms = meaningful.length > 0 ? meaningful : words;
    return [...new Set(terms)].slice(0, 6);
  }

  /**
   * Detect rarity level from query text keywords.
   * This affects how aggressively the search escalates when 0 results.
   */
  private detectRarityFromQuery(queryText: string): SearchPlan['rarityLevel'] {
    const q = queryText.toLowerCase();

    const extremelyRareSignals = ['pièce détachée', 'spare part', 'introuvable', 'discontinued'];
    const veryRareSignals = ['collection', 'vintage', 'ancien modèle', 'old model', 'japan', 'japonais', 'rare'];
    const rareSignals = ['occasion', 'used', 'reconditionné', 'refurbished', 'second hand'];
    const uncommonSignals = ['édition limitée', 'limited edition', 'spécial'];

    if (extremelyRareSignals.some(s => q.includes(s))) return 'extremely_rare';
    if (veryRareSignals.some(s => q.includes(s))) return 'very_rare';
    if (rareSignals.some(s => q.includes(s))) return 'rare';
    if (uncommonSignals.some(s => q.includes(s))) return 'uncommon';
    return 'common';
  }

  // ============================================================================
  // DISCOVERY WITH AUTO-ESCALATION
  // ============================================================================

  // ── Quality-based escalation helpers ──────────────────────────────────────

  /**
   * True when EVERY candidate at the current level is semantically weak.
   * Weak candidates are those whose match classification is 'alternative',
   * 'unknown', or unset (undefined). A single 'exact_match' or 'close_match'
   * candidate is enough to stop escalation — the engine has found something
   * genuinely relevant and should not keep broadening the query.
   *
   * INVARIANT: This is a descriptive gate only. It never modifies ranking,
   * constraints, or offer data — it only decides whether to try a wider net.
   */
  private static allLowQuality(candidates: DiscoveryResult['candidates']): boolean {
    return candidates.every(
      c =>
        c.matchQuality === 'alternative' ||
        c.matchQuality === 'unknown' ||
        c.matchQuality === undefined
    );
  }

  /**
   * Merge candidates accumulated across escalation levels into the latest
   * DiscoveryResult.
   *
   * INVARIANT: Candidates from earlier levels are never discarded. When a
   * later level returns nothing new, the accumulated set is still returned
   * so the pipeline can rank everything it found rather than only the last
   * (possibly empty) level.
   */
  private static mergeWithAccumulated(
    latest: DiscoveryResult,
    accumulated: DiscoveryResult['candidates']
  ): DiscoveryResult {
    return {
      ...latest,
      candidates: accumulated,
      statistics: {
        ...latest.statistics,
        candidatesFound: accumulated.length,
      },
    };
  }

  /**
   * Discover offers using the search plan, escalating on low quality.
   *
   * INVARIANT: Hard constraints from SearchPlan.hardConstraints are passed
   * to every discovery call. Escalation only changes search breadth, never
   * weakens constraints.
   *
   * Escalation trigger (§7.1 DECIDED): escalate when ALL candidates at the
   * current level are low quality ('alternative' | 'unknown' | undefined),
   * not merely when the candidate count is zero. This lets the engine widen
   * the net even when a broad first level returned loosely-matching items.
   *
   * Accumulation: candidates from every level are merged into a single set
   * so nothing found at an earlier (narrower) level is lost.
   */
  private async discoverWithEscalation(
    initialPlan: SearchPlan,
    queryText: string,
    phaseTerms?: PhaseTerms,
    language?: SupportedLanguage,
    additionalSearchLanguages?: SupportedLanguage[]
  ): Promise<{ discovery: DiscoveryResult; finalPlan: SearchPlan }> {
    let currentPlan = initialPlan;
    let accumulated: DiscoveryResult['candidates'] = [];
    let lastResult: DiscoveryResult | undefined;

    for (let attempt = 0; attempt <= 4; attempt++) {
      const criteria = this.planToDiscoveryCriteria(currentPlan, queryText, phaseTerms, language, additionalSearchLanguages);
      const result = await this.discoveryOrchestrator.discover(criteria);

      accumulated = [...accumulated, ...result.candidates];

      const hasGoodQuality = accumulated.length > 0 && !CapucineEngine.allLowQuality(accumulated);
      if (hasGoodQuality || !this.planBuilder.canAutoEscalate(currentPlan)) {
        return {
          discovery: CapucineEngine.mergeWithAccumulated(result, accumulated),
          finalPlan: currentPlan,
        };
      }

      const escalated = this.planBuilder.escalate(currentPlan);
      if (!escalated) {
        return {
          discovery: CapucineEngine.mergeWithAccumulated(result, accumulated),
          finalPlan: currentPlan,
        };
      }

      lastResult = result;
      currentPlan = escalated;
    }

    // Exhausted escalation — return accumulated candidates (may be empty)
    return {
      discovery: CapucineEngine.mergeWithAccumulated(
        lastResult ?? {
          id: `discovery-exhausted-${Date.now()}`,
          timestamp: new Date(),
          criteria: this.planToDiscoveryCriteria(currentPlan, queryText, undefined, language, additionalSearchLanguages),
          candidates: [],
          statistics: {
            queriedSources: 0,
            candidatesFound: 0,
            candidatesFiltered: 0,
            searchTimeMs: 0,
            relevanceEstimate: 'low' as const,
          },
          strategy: 'none',
          warnings: ['Escalation exhausted all levels without finding candidates'],
        },
        accumulated
      ),
      finalPlan: currentPlan,
    };
  }

  // ============================================================================
  // SEARCH PLAN → DISCOVERY CRITERIA CONVERSION
  // ============================================================================

  /**
   * Convert a SearchPlan to DiscoveryCriteria.
   * This is the bridge between the plan layer and the discovery layer.
   *
   * The plan carries rich context (rarity, escalation policy, multi-level strategy).
   * DiscoveryCriteria is what individual strategies understand.
   */
  private planToDiscoveryCriteria(
    plan: SearchPlan,
    queryText: string,
    phaseTerms?: PhaseTerms,
    language?: SupportedLanguage,
    additionalSearchLanguages?: SupportedLanguage[]
  ): DiscoveryCriteria {
    const criteria: DiscoveryCriteria = {};
    if (language) criteria.language = language;
    if (additionalSearchLanguages && additionalSearchLanguages.length > 0) {
      criteria.internationalLanguages = additionalSearchLanguages;
    }

    // Keywords: phase-specific term set if we have phaseTerms; otherwise all terms.
    // Phase 1 sends only the most specific refs. Each level adds breadth.
    // This ensures we don't flood discovery engines with broad category terms
    // when an exact model reference would find the product immediately.
    let keywords: string[];
    if (phaseTerms) {
      keywords = this.phaseQueryBuilder.termsForLevel(phaseTerms, plan.expansion.currentLevel);
    } else {
      keywords = [
        ...plan.query.primaryTerms,
        ...(plan.query.alternativeTerms ?? []),
      ].slice(0, 8);
    }
    if (keywords.length > 0) {
      criteria.keywords = keywords;
    }

    // Exact reference terms, when identified, enable strict exact_match
    // classification downstream (see match-quality.ts). Absent for
    // generic/descriptive searches with no identifiable model reference.
    if (phaseTerms && phaseTerms.exactRefs.length > 0) {
      criteria.exactRefs = phaseTerms.exactRefs;
    }

    // Categories
    if (plan.query.categories && plan.query.categories.length > 0) {
      criteria.categories = plan.query.categories;
    }

    // Hard constraints, passed through unchanged so discovery strategies that
    // build multiple complementary queries (SearchStrategyPlanner) can derive
    // a technical-specs query from whatever numeric constraints are present.
    if (plan.hardConstraints.length > 0) {
      criteria.hardConstraints = plan.hardConstraints;
    }

    // Price range
    if (plan.query.priceRange?.max !== undefined) {
      criteria.maxPrice = plan.query.priceRange.max;
    }
    if (plan.query.priceRange?.min !== undefined) {
      criteria.minPrice = plan.query.priceRange.min;
    }
    if (plan.query.priceRange?.currency) {
      criteria.currency = plan.query.priceRange.currency;
    }

    // Geographic / shipping
    if (plan.query.countries && plan.query.countries.length > 0) {
      criteria.shipping = { countries: plan.query.countries };
    }

    // Extract excluded merchants from hard constraints
    for (const constraint of plan.hardConstraints) {
      if (
        constraint.level === 'forbidden' &&
        (constraint.id.includes('merchant') || constraint.id.includes('marchand'))
      ) {
        const merchantId = constraint.parameters?.merchantId as string | undefined;
        if (merchantId) {
          criteria.excludedMerchants = [
            ...(criteria.excludedMerchants ?? []),
            merchantId,
          ];
        }
        // Also handle merchant-X style IDs
        if (constraint.id.startsWith('merchant-')) {
          const extractedId = constraint.id.slice('merchant-'.length);
          criteria.excludedMerchants = [
            ...(criteria.excludedMerchants ?? []),
            extractedId,
          ];
        }
      }
    }

    // At deeper levels (4+), include secondary market
    if (plan.expansion.currentLevel >= 4) {
      criteria.verifiedOnly = false;
    }

    // Copy usage context from plan to discovery criteria (contextual signals, not hard constraints)
    if (plan.usageContext) {
      criteria.usageContext = plan.usageContext;
    }

    criteria.limit = this.options.maxCandidates;

    return criteria;
  }

  // ============================================================================
  // NORMALIZATION
  // ============================================================================

  /**
   * Normalize characteristic values for all candidates.
   * NEVER removes a characteristic — only normalizes values.
   */
  /**
   * Normalize all candidates through the NormalizationEngine.
   *
   * Replaces the previous inline storage-only normalization.
   * NormalizationEngine applies all registered rules (storage, price, country, etc.)
   * and preserves provenance — it never invents values for unknown fields.
   */
  private normalizeCandidates(offers: Offer[]): Offer[] {
    return offers.map(offer => this.normalizationEngine.normalizeOffer(offer));
  }
}

// ============================================================================
// STOP WORDS (for keyword extraction)
// ============================================================================

const STOP_WORDS = new Set([
  // French
  'les', 'des', 'une', 'pour', 'avec', 'que', 'qui', 'dans', 'sur', 'par',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'ses', 'notre', 'votre',
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'est', 'sont', 'ai', 'avoir', 'être', 'fait', 'faire',
  'cherche', 'veux', 'voudrais', 'besoin', 'trouver', 'acheter',
  'impérativement', 'obligatoirement', 'absolument',
  // English
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'need',
  'want', 'looking', 'find', 'buy', 'get',
]);

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Create a CapucineEngine with in-memory discovery (default for testing).
 * Web discovery is disabled to ensure test determinism.
 */
export function createTestEngine(options: CapucineEngineOptions = {}): CapucineEngine {
  return new CapucineEngine({ enableWebDiscovery: false, ...options });
}

/**
 * Create an empty user profile (for tests).
 */
export function createEmptyProfile(userId = 'test-user'): UserProfile {
  return {
    userId,
    preferences: {
      criteria: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Build a minimal SearchRequest for testing.
 */
export function createSearchRequest(
  queryText: string,
  criteria: PreferenceCriterion[] = [],
  profileCriteria: PreferenceCriterion[] = []
): SearchRequest {
  const profile: UserProfile = {
    userId: 'test-user',
    preferences: {
      criteria: profileCriteria,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    queryText,
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    profile,
    preInterpretedCriteria: criteria,
    skipAIInterpretation: true,
  };
}
