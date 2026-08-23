/**
 * Capucine — Search Plan
 *
 * A SearchPlan defines HOW to discover offers for a request.
 * It is produced from a structured request and drives the DiscoveryOrchestrator.
 *
 * KEY INVARIANTS:
 * - A SearchPlan can EXPAND discovery (find more sources)
 * - A SearchPlan can NEVER WEAKEN user constraints
 * - Expansion must be explicitly authorized (expansion_allowed flag)
 * - Rare products trigger progressive expansion automatically
 * - Geographic expansion requires explicit authorization
 *
 * Progressive expansion levels (§16 GATE):
 * LEVEL 1 → exact match
 * LEVEL 2 → lexical variants
 * LEVEL 3 → manufacturer identifiers
 * LEVEL 4 → specialized sources
 * LEVEL 5 → secondary market
 * LEVEL 6 → geographic expansion
 *
 * GATE 14 + GATE 15 + GATE 16 IMPLEMENTATION
 */

import { PreferenceCriterion, UsageContext } from '../domain/types';

// ============================================================================
// SEARCH LEVEL
// ============================================================================

export type SearchLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface SearchLevelConfig {
  level: SearchLevel;
  name: string;
  description: string;

  /** Can this level be triggered automatically on no-results? */
  autoEscalate: boolean;

  /** Does this level require explicit user permission? */
  requiresPermission: boolean;

  /** What sources/strategies to use at this level */
  strategyTypes: SearchStrategyType[];
}

export type SearchStrategyType =
  | 'exact_term'           // Exact keyword search
  | 'lexical_variant'      // Synonyms, alternative spellings
  | 'manufacturer_ref'     // By manufacturer reference/EAN/ISBN
  | 'specialist_source'    // Domain-specific merchants/sources
  | 'secondary_market'     // Used goods, vintage, resellers
  | 'geographic_expansion' // Cross-border search
  | 'broad_category'       // Category-wide search (fallback)
  | 'ai_rephrase';         // AI-generated alternative queries

export const SEARCH_LEVEL_CONFIGS: Record<SearchLevel, SearchLevelConfig> = {
  1: {
    level: 1,
    name: 'Exact Match',
    description: 'Search for exact product name and identifiers',
    autoEscalate: true,
    requiresPermission: false,
    strategyTypes: ['exact_term', 'manufacturer_ref'],
  },
  2: {
    level: 2,
    name: 'Lexical Variants',
    description: 'Include synonyms and alternative names',
    autoEscalate: true,
    requiresPermission: false,
    strategyTypes: ['lexical_variant', 'exact_term'],
  },
  3: {
    level: 3,
    name: 'Manufacturer Identifiers',
    description: 'Search by EAN, ISBN, SKU, reference numbers',
    autoEscalate: true,
    requiresPermission: false,
    strategyTypes: ['manufacturer_ref', 'exact_term'],
  },
  4: {
    level: 4,
    name: 'Specialist Sources',
    description: 'Include niche and specialist merchants',
    autoEscalate: true,
    requiresPermission: false,
    strategyTypes: ['specialist_source', 'manufacturer_ref'],
  },
  5: {
    level: 5,
    name: 'Secondary Market',
    description: 'Include used goods, vintage, second-hand sellers',
    autoEscalate: false,
    requiresPermission: false,  // But should warn user
    strategyTypes: ['secondary_market', 'specialist_source'],
  },
  6: {
    level: 6,
    name: 'Geographic Expansion',
    description: 'Search cross-border merchants in other countries',
    autoEscalate: false,
    requiresPermission: true,   // Must be explicitly authorized
    strategyTypes: ['geographic_expansion', 'specialist_source'],
  },
};

// ============================================================================
// SEARCH QUERY
// ============================================================================

export interface SearchQuery {
  /** Primary search term(s) */
  primaryTerms: string[];

  /** Alternative search terms (synonyms, variants) */
  alternativeTerms?: string[];

  /** Product identifiers to search by */
  identifiers?: {
    ean?: string;
    isbn?: string;
    sku?: string;
    manufacturerRef?: string;
    modelNumber?: string;
  };

  /** Language(s) to search in */
  languages?: string[];   // ISO 639-1 codes: 'fr', 'en', 'de', 'ja', ...

  /** Countries/regions to search */
  countries?: string[];   // ISO 3166 codes: 'FR', 'DE', 'US', 'JP', ...

  /** Product category hints */
  categories?: string[];

  /** Price range for pre-filtering (not a constraint on ranking) */
  priceRange?: {
    min?: number;
    max?: number;
    currency?: string;
  };
}

// ============================================================================
// EXPANSION POLICY
// ============================================================================

/**
 * Controls when and how the search can expand.
 * INVARIANT: Expansion can add more candidates but NEVER weakens constraints.
 */
export interface ExpansionPolicy {
  /** Is ANY expansion allowed? */
  expansionAllowed: boolean;

  /** Current search level (starts at 1) */
  currentLevel: SearchLevel;

  /** Maximum level allowed to auto-escalate to */
  maxAutoLevel: SearchLevel;

  /** Levels requiring explicit user confirmation */
  requiresConfirmation: SearchLevel[];

  /** Geographic expansion explicitly authorized? */
  geographicExpansionAllowed: boolean;

  /** Secondary market included? */
  secondaryMarketIncluded: boolean;

  /** What was already tried (to avoid repetition) */
  attemptedLevels: SearchLevel[];
}

// ============================================================================
// SEARCH PLAN
// ============================================================================

/**
 * A complete, deterministic plan for discovering offers.
 *
 * Produced from: structured user request + profile + constraints
 * Consumed by: DiscoveryOrchestrator
 *
 * INVARIANT: SearchPlan contains constraints. Discovery MUST respect them.
 * The plan specifies WHAT to search for, not WHAT to return — results are still
 * filtered through AdmissibilityEngine.
 */
export interface SearchPlan {
  id: string;
  requestId: string;
  createdAt: Date;

  // ── What to search ────────────────────────────────────────────────────────
  query: SearchQuery;

  // ── Rarity assessment ─────────────────────────────────────────────────────
  rarityLevel: 'common' | 'uncommon' | 'rare' | 'very_rare' | 'extremely_rare';

  /**
   * Estimated availability:
   * - 'abundant': Many sources, many offers
   * - 'limited': Few sources or limited stock
   * - 'scarce': Likely only 1-2 sources, may require level 4+
   */
  estimatedAvailability: 'abundant' | 'limited' | 'scarce' | 'unknown';

  // ── Source selection ──────────────────────────────────────────────────────
  prioritizedSourceTypes: SearchStrategyType[];
  excludedSourceTypes?: SearchStrategyType[];

  // ── Expansion policy ──────────────────────────────────────────────────────
  expansion: ExpansionPolicy;

  // ── Hard constraints (must be respected by discovery, cannot be relaxed) ─
  hardConstraints: PreferenceCriterion[];

  // ── Soft hints for discovery (not constraints, just guidance) ─────────────
  discoveryHints?: {
    preferNewCondition?: boolean;
    preferVerifiedSellers?: boolean;
    maxResults?: number;
    searchDepth?: 'shallow' | 'normal' | 'deep';
  };

  // Usage context for contextual signals (not hard constraints)
  usageContext?: UsageContext;

  // ── Fallback strategy ─────────────────────────────────────────────────────
  /**
   * If the search returns 0 eligible results, what should happen?
   * 'report_empty': Return empty with analysis of why
   * 'expand_and_report': Try next level and report what was tried
   * 'ask_user': Pause and ask user what to do
   */
  onNoResults: 'report_empty' | 'expand_and_report' | 'ask_user';
}

// ============================================================================
// SEARCH PHASE QUERY BUILDER
// ============================================================================

/**
 * Enriched query terms grouped by phase.
 *
 * These are the inputs for building phase-specific DiscoveryCriteria.
 * Produced once (from AI enrichment + request parsing), then used at each
 * escalation level to generate progressively broader term sets.
 */
export interface PhaseTerms {
  /** Most specific identifier(s): exact model number/reference, EAN, ISBN, SKU */
  exactRefs: string[];

  /** Brand + model name combos: "sony wh-1000xm5", "apple macbook pro m3" */
  brandModelCombos: string[];

  /** Alternative model spellings / spacing variants: "wh1000xm5", "1000 xm5" */
  modelVariants: string[];

  /** AI-generated synonyms: "casque bluetooth premium", "xm5" */
  synonyms: string[];

  /** Category + feature terms: "casque bluetooth", "casque ANC" */
  categoryTerms: string[];

  /** Multilingual equivalents: "noise cancelling headphones", "kopfhörer bluetooth" */
  multilingualTerms: string[];
}

/**
 * Builds phase-specific search term sets from a SearchQuery.
 *
 * INVARIANT: Each phase ADDS breadth but NEVER removes exact refs.
 * Phase 1 is always the narrowest query possible. Each subsequent phase
 * expands outward. The ranker sees the same constraints regardless of phase —
 * only the discovery scope changes.
 *
 * Phase → Term set:
 * 1 (EXACT)        → exactRefs only
 * 2 (BRAND+NAME)   → exactRefs + brandModelCombos
 * 3 (VARIANTS)     → exactRefs + brandModelCombos + modelVariants
 * 4 (SYNONYMS)     → all above + synonyms
 * 5 (CATEGORY)     → all above + categoryTerms
 * 6 (MULTILINGUAL) → all above + multilingualTerms
 *
 * This matches the escalation levels 1-6 in SearchLevel / SEARCH_LEVEL_CONFIGS.
 */
export class SearchPhaseQueryBuilder {

  /**
   * Extract PhaseTerms from a SearchQuery + AI-enriched synonyms.
   *
   * The caller provides what it knows; this method organises terms into phases.
   * Never throws — always returns a valid PhaseTerms object.
   */
  buildPhaseTerms(
    query: SearchQuery,
    aiSynonyms: string[] = [],
    aiAlternativeSpellings: string[] = []
  ): PhaseTerms {
    const primary = query.primaryTerms.map(t => t.toLowerCase().trim()).filter(Boolean);
    const alternatives = (query.alternativeTerms ?? []).map(t => t.toLowerCase().trim()).filter(Boolean);

    // Exact refs: anything that looks like a model number (contains digits, often dashes)
    const exactRefs = primary.filter(t => this.looksLikeModelRef(t));

    // If no explicit model refs, use all primary terms as "exact" for Phase 1
    const phase1Terms = exactRefs.length > 0 ? exactRefs : primary.slice(0, 2);

    // Brand+model combos: pairs like "brand modelref"
    const brandModelCombos = this.buildBrandModelCombos(primary, exactRefs);

    // Model variants: spacing/punctuation variants of model refs
    const modelVariants = [
      ...aiAlternativeSpellings.map(t => t.toLowerCase().trim()).filter(Boolean),
      ...exactRefs.map(ref => this.modelVariantsOf(ref)).flat(),
    ].filter(t => t.length > 0 && !phase1Terms.includes(t) && !brandModelCombos.includes(t));

    // Synonyms: from AI enrichment + alternative terms
    const synonyms = [
      ...aiSynonyms.map(t => t.toLowerCase().trim()).filter(Boolean),
      ...alternatives.filter(t => !exactRefs.includes(t) && !brandModelCombos.includes(t)),
    ];

    // Category terms: non-model primary terms (brand names, category words).
    // query.categories holds internal catalog ids (e.g. 'ordinateur_portable'
    // — underscored, matching DiscoveryCriteria's exact-match filter) — sent
    // literally to a real Web search engine that'd be a near-useless token,
    // so it's turned into words here, at the point it becomes a search term,
    // rather than carrying two different formats through SearchPlan.
    const categoryTerms = primary
      .filter(t => !this.looksLikeModelRef(t) && t.length > 2)
      .concat((query.categories ?? []).map(c => c.replace(/_/g, ' ')));

    // Multilingual: explicit languages from query (populated externally)
    const multilingualTerms = query.languages && query.languages.length > 1
      ? alternatives.filter(t => !synonyms.includes(t))
      : [];

    return {
      exactRefs: dedup(phase1Terms),
      brandModelCombos: dedup(brandModelCombos),
      modelVariants: dedup(modelVariants),
      synonyms: dedup(synonyms),
      categoryTerms: dedup(categoryTerms),
      multilingualTerms: dedup(multilingualTerms),
    };
  }

  /**
   * Build the keyword list for a given escalation level.
   *
   * Level 1: narrowest — exact refs only
   * Level 6: broadest — everything
   *
   * INVARIANT: Phase 1 terms are ALWAYS included in every subsequent phase
   * (we never drop the exact ref once we have it — it helps discovery engines
   * do exact-match boosts alongside the broader fallback query).
   */
  termsForLevel(phaseTerms: PhaseTerms, level: SearchLevel): string[] {
    const terms: string[] = [];

    // Always include exact refs if we have them
    if (level >= 1) terms.push(...phaseTerms.exactRefs);
    if (level >= 2) terms.push(...phaseTerms.brandModelCombos);
    if (level >= 3) terms.push(...phaseTerms.modelVariants);
    if (level >= 4) terms.push(...phaseTerms.synonyms);
    if (level >= 5) terms.push(...phaseTerms.categoryTerms);
    if (level >= 6) terms.push(...phaseTerms.multilingualTerms);

    // Deduplicate and cap at a reasonable limit
    return dedup(terms).slice(0, 12);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** True if the term looks like a product model reference (has digits, may have dashes) */
  private looksLikeModelRef(term: string): boolean {
    // Must have at least one digit + at least 4 chars total
    // Examples: "wh-1000xm5", "iphone-15-pro", "gtx-4080", "macbook-pro-m3"
    // Not: "sony", "casque", "bluetooth"
    return /\d/.test(term) && term.length >= 4;
  }

  /** Generate brand+model combos from primary terms + exact refs */
  private buildBrandModelCombos(primary: string[], exactRefs: string[]): string[] {
    if (exactRefs.length === 0) return [];

    const nonRefTerms = primary.filter(t => !exactRefs.includes(t) && t.length >= 2);
    const combos: string[] = [];

    for (const ref of exactRefs) {
      for (const brand of nonRefTerms) {
        combos.push(`${brand} ${ref}`);
      }
    }

    return combos;
  }

  /** Generate spacing/punctuation variants of a model ref */
  private modelVariantsOf(ref: string): string[] {
    const variants: string[] = [];

    // Remove all dashes: "wh-1000xm5" → "wh1000xm5"
    const noDashes = ref.replace(/-/g, '');
    if (noDashes !== ref) variants.push(noDashes);

    // Replace dashes with spaces: "wh-1000xm5" → "wh 1000xm5"
    const spacedDashes = ref.replace(/-/g, ' ');
    if (spacedDashes !== ref) variants.push(spacedDashes);

    // Add space before trailing digit runs: "xm5" → "xm 5"
    const digitSpaced = ref.replace(/([a-z])(\d)/g, '$1 $2');
    if (digitSpaced !== ref) variants.push(digitSpaced);

    return variants;
  }
}

/** Deduplicate an array while preserving order */
function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter(t => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

// ============================================================================
// SEARCH PLAN BUILDER
// ============================================================================

/**
 * Builds a SearchPlan from a structured request.
 */
export class SearchPlanBuilder {

  /**
   * Build a SearchPlan from request criteria.
   */
  build(config: {
    requestId: string;
    primaryTerms: string[];
    alternativeTerms?: string[];
    identifiers?: SearchQuery['identifiers'];
    countries?: string[];
    languages?: string[];
    categories?: string[];
    hardConstraints?: PreferenceCriterion[];
    rarityLevel?: SearchPlan['rarityLevel'];
    expansionAllowed?: boolean;
    geographicExpansionAllowed?: boolean;
    secondaryMarketIncluded?: boolean;
    maxPrice?: number;
    currency?: string;
    usageContext?: UsageContext;
  }): SearchPlan {

    const rarityLevel = config.rarityLevel || 'common';
    const expansionAllowed = config.expansionAllowed ?? true;

    // Determine max auto-escalation level based on rarity
    const maxAutoLevel = this.maxLevelForRarity(rarityLevel);

    const plan: SearchPlan = {
      id: `plan-${config.requestId}-${Date.now()}`,
      requestId: config.requestId,
      createdAt: new Date(),

      query: {
        primaryTerms: config.primaryTerms,
        alternativeTerms: config.alternativeTerms,
        identifiers: config.identifiers,
        countries: config.countries || ['FR'],
        languages: config.languages || ['fr'],
        categories: config.categories,
        priceRange: config.maxPrice !== undefined
          ? { max: config.maxPrice, currency: config.currency || 'EUR' }
          : undefined,
      },

      rarityLevel,
      estimatedAvailability: this.estimateAvailability(rarityLevel),

      prioritizedSourceTypes: this.sourcesForRarity(rarityLevel),
      excludedSourceTypes: [],

      expansion: {
        expansionAllowed,
        currentLevel: 1,
        maxAutoLevel,
        requiresConfirmation: expansionAllowed ? [6] : [2, 3, 4, 5, 6],
        geographicExpansionAllowed: config.geographicExpansionAllowed ?? false,
        secondaryMarketIncluded: config.secondaryMarketIncluded ?? false,
        attemptedLevels: [],
      },

      hardConstraints: config.hardConstraints || [],

      discoveryHints: {
        preferNewCondition: !config.secondaryMarketIncluded,
        preferVerifiedSellers: true,
        maxResults: 50,
        searchDepth: rarityLevel === 'common' ? 'shallow' : 'deep',
      },

      usageContext: config.usageContext,

      onNoResults: 'expand_and_report',
    };

    return plan;
  }

  /**
   * Escalate a plan to the next level (when no results at current level).
   * Returns null if cannot escalate further.
   *
   * INVARIANT: Escalation NEVER modifies hard constraints.
   */
  escalate(plan: SearchPlan): SearchPlan | null {
    const nextLevel = (plan.expansion.currentLevel + 1) as SearchLevel;

    if (nextLevel > plan.expansion.maxAutoLevel) return null;
    if (nextLevel > 6) return null;

    const config = SEARCH_LEVEL_CONFIGS[nextLevel];

    // Check if requires permission
    if (config.requiresPermission && !plan.expansion.geographicExpansionAllowed) {
      return null; // Cannot auto-escalate; needs user confirmation
    }

    return {
      ...plan,
      id: `${plan.id}-l${nextLevel}`,
      expansion: {
        ...plan.expansion,
        currentLevel: nextLevel,
        attemptedLevels: [...plan.expansion.attemptedLevels, plan.expansion.currentLevel],
      },
      prioritizedSourceTypes: [...new Set([
        ...config.strategyTypes,
        ...plan.prioritizedSourceTypes,
      ])],
    };
  }

  /**
   * Check if a plan can expand further without user permission.
   */
  canAutoEscalate(plan: SearchPlan): boolean {
    if (!plan.expansion.expansionAllowed) return false;
    const nextLevel = (plan.expansion.currentLevel + 1) as SearchLevel;
    if (nextLevel > plan.expansion.maxAutoLevel) return false;
    if (nextLevel > 6) return false;

    const config = SEARCH_LEVEL_CONFIGS[nextLevel];
    if (config.requiresPermission) {
      return plan.expansion.geographicExpansionAllowed;
    }
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private maxLevelForRarity(rarity: SearchPlan['rarityLevel']): SearchLevel {
    switch (rarity) {
      case 'common': return 2;
      case 'uncommon': return 3;
      case 'rare': return 4;
      case 'very_rare': return 5;
      case 'extremely_rare': return 5; // 6 requires explicit permission
    }
  }

  private estimateAvailability(rarity: SearchPlan['rarityLevel']): SearchPlan['estimatedAvailability'] {
    switch (rarity) {
      case 'common': return 'abundant';
      case 'uncommon': return 'limited';
      case 'rare': return 'scarce';
      case 'very_rare': return 'scarce';
      case 'extremely_rare': return 'unknown';
    }
  }

  private sourcesForRarity(rarity: SearchPlan['rarityLevel']): SearchStrategyType[] {
    switch (rarity) {
      case 'common':
        return ['exact_term', 'lexical_variant'];
      case 'uncommon':
        return ['exact_term', 'manufacturer_ref', 'lexical_variant'];
      case 'rare':
        return ['manufacturer_ref', 'specialist_source', 'exact_term'];
      case 'very_rare':
        return ['specialist_source', 'manufacturer_ref', 'secondary_market'];
      case 'extremely_rare':
        return ['specialist_source', 'secondary_market', 'geographic_expansion'];
    }
  }
}
