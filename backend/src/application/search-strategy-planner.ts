/**
 * Capucine — Search Strategy Planner
 *
 * Turns a single SearchPlan/DiscoveryCriteria into several COMPLEMENTARY
 * search queries — different angles on the same need — instead of a single
 * flat keyword string. This is the piece that lets Web discovery approach
 * "search broadly" rather than "fire one query and stop".
 *
 * Every strategy is DERIVED deterministically from what's actually present
 * in the criteria/hardConstraints — nothing is hardcoded to any particular
 * example query. A query with no budget produces no 'budget' strategy; a
 * query with no technical constraints produces no 'technical_specs' strategy.
 *
 * Strategies are grouped into PHASES so callers (RealWebDiscoveryStrategy)
 * can run the cheapest/most-general phase first, check search coverage, and
 * only spend more queries on later phases if genuinely needed — see
 * search-coverage.ts.
 */

import { DiscoveryCriteria } from './discovery';
import { PreferenceCriterion, UsageContext } from '../domain/types';
import { usageSearchTerms, signalSearchTerms } from '../domain/usage-context-mapping';
import { SupportedLanguage, DEFAULT_LANGUAGE } from './i18n';

// ============================================================================
// TYPES
// ============================================================================

export type SearchChannel =
  | 'general'          // keywords + category, the broadest single query
  | 'category'         // category-focused ("acheter <category> comparatif")
  | 'technical_specs'  // derived from numeric hardConstraints (ram/screen_size/storage/...)
  | 'brand_model'      // the exact product reference ("sony wh-1000xm5 acheter")
  | 'compatibility'    // "casque compatible ps5"
  | 'availability'     // "sony wh-1000xm5 stock disponible"
  | 'usage_context'    // the USAGE itself ("sony xm5 transport") — see buildStrategies()
  | 'contextual_specs' // technical dimensions the usage makes relevant ("sony xm5 autonomie poids")
  | 'budget'           // price-anchored query
  | 'synonym'          // complementary "buy/compare/reviews" framing, wider recall
  | 'international';   // same need, phrased in another language — see buildInternationalStrategies()

export interface SearchStrategy {
  channel: SearchChannel;
  query: string;
  /** 1 = run first (cheapest/most general), 2 = only if phase 1 wasn't enough. */
  phase: 1 | 2;
  /** Which language this query is phrased in — search language is a
   *  SEPARATE dimension from the user's own language (see megaprompt Part
   *  10): a French user's phase-1 queries are 'fr', but buildInternational
   *  Strategies() can add e.g. 'en' queries for wider Web coverage without
   *  ever claiming the user asked in English. */
  language: SupportedLanguage;
}

/**
 * Small, controlled category-name dictionary — NOT a general translation
 * engine. Only covers the category vocabulary Capucine's own
 * BasicPatternInterpreter already recognizes (request-interpreter.ts
 * categoryPatterns), so an international query stays grounded in categories
 * the rest of the pipeline actually understands. Missing entries simply
 * don't get an international category query — never guessed.
 */
const CATEGORY_TRANSLATIONS: Partial<Record<string, Partial<Record<SupportedLanguage, string>>>> = {
  ordinateur_portable: { en: 'laptop', de: 'Laptop', es: 'portátil', it: 'portatile' },
  smartphone: { en: 'smartphone', de: 'Smartphone', es: 'smartphone', it: 'smartphone' },
  casque: { en: 'headphones', de: 'Kopfhörer', es: 'auriculares', it: 'cuffie' },
  aspirateur_robot: { en: 'robot vacuum', de: 'Saugroboter', es: 'aspiradora robot', it: 'robot aspirapolvere' },
  clavier: { en: 'keyboard', de: 'Tastatur', es: 'teclado', it: 'tastiera' },
  livre: { en: 'book', de: 'Buch', es: 'libro', it: 'libro' },
};

// ============================================================================
// PLANNER
// ============================================================================

export class SearchStrategyPlanner {
  /**
   * Build the full set of complementary strategies for a criteria set.
   * `hardConstraints` (SearchPlan.hardConstraints) is optional — when
   * provided, its numeric criteria (minValue/exactValue + unit, e.g. ram,
   * screen_size, storage) drive the 'technical_specs' strategy generically,
   * whatever their criterion id happens to be.
   */
  buildStrategies(
    criteria: DiscoveryCriteria,
    hardConstraints: PreferenceCriterion[] = [],
    queryLanguage: SupportedLanguage = DEFAULT_LANGUAGE
  ): SearchStrategy[] {
    const strategies: SearchStrategy[] = [];
    const keywords = criteria.keywords ?? [];
    // criteria.categories holds Capucine's internal snake_case id (e.g.
    // 'ordinateur_portable' — see CapucineEngine.buildSearchPlan(), which
    // only ever puts DOMAIN category ids here). Sent literally to a real Web
    // search engine that's a near-useless token — normalized to words at the
    // point it becomes a query string, same fix as SearchPlanBuilder's
    // categoryTerms (search-plan.ts).
    const category = criteria.categories?.[0]?.replace(/_/g, ' ');
    const base = [...keywords, category].filter(Boolean).join(' ').trim();

    // ── Phase 1: broad, cheap, most likely to already be enough ──────────────
    if (base) {
      strategies.push({ channel: 'general', query: base, phase: 1, language: queryLanguage });
    }

    // The exact product reference, when the user named one. This belongs in
    // phase 1: for a targeted request ("Sony WH-1000XM5") it is by far the
    // query most likely to land on real product pages, and it costs nothing to
    // ask first. Derived from the brand/model CRITERIA — the request's own
    // explicit attributes — never from a guessed token.
    const productReference = this.buildProductReference(hardConstraints);
    if (productReference) {
      strategies.push({
        channel: 'brand_model',
        query: `${productReference} prix acheter`,
        phase: 1,
        language: queryLanguage,
      });
    }

    if (category) {
      strategies.push({ channel: 'category', query: `${category} acheter comparatif`, phase: 1, language: queryLanguage });
    }

    // ── Phase 2: only spent if phase 1 doesn't reach coverage ────────────────
    // technical_specs stays what it has always been: derived from the user's
    // NUMERIC HARD CONSTRAINTS. Usage-derived vocabulary used to be folded in
    // here, which mixed two different things — a constraint the user stated
    // and a dimension Capucine inferred — into one over-long query. They are
    // now two separate, individually skippable channels below.
    const specTerms = this.buildSpecTerms(hardConstraints);
    if (specTerms.length > 0) {
      strategies.push({
        channel: 'technical_specs',
        query: [...keywords, ...specTerms].filter(Boolean).join(' ').trim(),
        phase: 2,
        language: queryLanguage,
      });
    }

    // ── Usage-derived channels ───────────────────────────────────────────────
    // Present ONLY when the user actually expressed a usage. At most TWO extra
    // queries, both in phase 2 — so they are governed by exactly the same
    // SearchCoverage gate, maxPhases and maxTotalTimeMs budget as every other
    // phase-2 query (search-coverage.ts / RealWebDiscoveryStrategy). No second
    // budget system, and no unbounded family explosion: the contextual-spec
    // query takes the top few dimensions of the mapping, not all of them.
    if (criteria.usageContext && keywords.length > 0) {
      const usageTerms = usageSearchTerms(criteria.usageContext, queryLanguage);
      if (usageTerms.length > 0) {
        strategies.push({
          channel: 'usage_context',
          query: [...keywords, ...usageTerms].join(' ').trim(),
          phase: 2,
          language: queryLanguage,
        });
      }

      const contextualDimensions = signalSearchTerms(criteria.usageContext, queryLanguage, 4);
      if (contextualDimensions.length > 0) {
        strategies.push({
          channel: 'contextual_specs',
          query: [...keywords, ...contextualDimensions].join(' ').trim(),
          phase: 2,
          language: queryLanguage,
        });
      }
    }
    if (criteria.maxPrice !== undefined) {
      strategies.push({
        channel: 'budget',
        query: `${base} prix moins de ${criteria.maxPrice}€`.trim(),
        phase: 2,
        language: queryLanguage,
      });
    }
    if (keywords.length > 0) {
      strategies.push({
        channel: 'synonym',
        query: `acheter ${keywords.join(' ')} comparatif prix avis`,
        phase: 2,
        language: queryLanguage,
      });
    }

    // Compatibility — only when the user actually demanded one. A single
    // query covering every demanded target, not one per target: the point is
    // to reach pages that discuss compatibility, not to multiply requests.
    const compatibilityTargets = this.buildCompatibilityTerms(hardConstraints);
    if (compatibilityTargets.length > 0 && keywords.length > 0) {
      strategies.push({
        channel: 'compatibility',
        query: [...keywords, 'compatible', ...compatibilityTargets].join(' ').trim(),
        phase: 2,
        language: queryLanguage,
      });
    }

    // Availability / delivery — the words that actually appear on pages
    // carrying stock and shipping information, which is what
    // purchase-readiness needs and what a bare product query rarely surfaces.
    // Phase 2, so the existing SearchCoverage gate decides whether it is worth
    // spending at all.
    if (productReference || keywords.length > 0) {
      const subject = productReference || keywords.join(' ');
      strategies.push({
        channel: 'availability',
        query: `${subject} ${queryLanguage === 'en' ? 'in stock delivery' : 'stock disponible livraison'}`.trim(),
        phase: 2,
        language: queryLanguage,
      });
    }

    // De-dup identical query strings across channels (e.g. no category → base === general).
    const seen = new Set<string>();
    return strategies.filter(s => {
      const key = s.query.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Build additional phase-2 strategies phrased in OTHER languages —
   * "recherche Web multilingue" (megaprompt Part 10/11). Deliberately NOT
   * called by default from buildStrategies(): systematically searching every
   * supported language on every query would be far too costly (Part 24).
   * Callers (RealWebDiscoveryStrategy) decide WHEN to spend this — e.g. only
   * after phase 1's own-language coverage is insufficient — using the exact
   * same SearchCoverage/maxPhases/maxTotalTimeMs budget already governing
   * every other phase; no second budget system.
   *
   * Only produces a query for a target language when there's real,
   * non-guessed vocabulary to use: numeric/technical terms (16GB, 14inch)
   * are language-agnostic and always included; the category term is only
   * added when CATEGORY_TRANSLATIONS actually has it — an unknown category
   * silently gets no international category query rather than a fabricated
   * translation.
   */
  buildInternationalStrategies(
    criteria: DiscoveryCriteria,
    hardConstraints: PreferenceCriterion[] = [],
    targetLanguages: SupportedLanguage[] = []
  ): SearchStrategy[] {
    const strategies: SearchStrategy[] = [];
    const category = criteria.categories?.[0];
    const specTerms = this.buildSpecTerms(hardConstraints); // language-agnostic (numbers + units)

    for (const lang of targetLanguages) {
      const localizedCategory = category ? CATEGORY_TRANSLATIONS[category]?.[lang] : undefined;
      const terms = [localizedCategory, ...specTerms].filter(Boolean);
      if (terms.length === 0) continue; // nothing usable in this language — don't fabricate a query
      if (criteria.maxPrice !== undefined) {
        terms.push(`under €${criteria.maxPrice}`);
      }
      strategies.push({ channel: 'international', query: terms.join(' '), phase: 2, language: lang });
    }

    return strategies;
  }

  /**
   * "sony wh-1000xm5" from the brand/model criteria the interpreter produced.
   *
   * Reads `preferredValues[0]` — the value the user actually wrote — so the
   * query stays grounded in their words. Returns null when neither a brand nor
   * a model was identified with enough confidence to become a criterion, which
   * is exactly when a product-reference query would be guesswork.
   */
  private buildProductReference(hardConstraints: PreferenceCriterion[]): string | null {
    const valueOf = (id: string): string | null => {
      const criterion = hardConstraints.find(c => c.id === id);
      const values = criterion?.parameters?.preferredValues as string[] | undefined;
      return values?.[0] ?? null;
    };
    const parts = [valueOf('brand'), valueOf('model')].filter((p): p is string => !!p);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  /** Compatibility targets the user explicitly demanded, e.g. ['ps5']. */
  private buildCompatibilityTerms(hardConstraints: PreferenceCriterion[]): string[] {
    const terms: string[] = [];
    for (const criterion of hardConstraints) {
      if (!criterion.id.startsWith('compatible_')) continue;
      const values = criterion.parameters?.preferredValues as string[] | undefined;
      if (values?.[0]) terms.push(values[0]);
    }
    return [...new Set(terms)];
  }

  /** Derive "16GB" / "14pouces" style terms from any numeric hard constraint present. */
  private buildSpecTerms(hardConstraints: PreferenceCriterion[]): string[] {
    const terms: string[] = [];
    for (const c of hardConstraints) {
      const p = c.parameters ?? {};
      const unit = (p['unit'] as string | undefined) ?? '';
      if (p['exactValue'] !== undefined) terms.push(`${p['exactValue']}${unit}`);
      else if (p['minValue'] !== undefined) terms.push(`${p['minValue']}${unit}`);
    }
    return terms;
  }

}
