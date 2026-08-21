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
import { PreferenceCriterion } from '../domain/types';
import { SupportedLanguage, DEFAULT_LANGUAGE } from './i18n';

// ============================================================================
// TYPES
// ============================================================================

export type SearchChannel =
  | 'general'          // keywords + category, the broadest single query
  | 'category'         // category-focused ("acheter <category> comparatif")
  | 'technical_specs'  // derived from numeric hardConstraints (ram/screen_size/storage/...)
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
    if (category) {
      strategies.push({ channel: 'category', query: `${category} acheter comparatif`, phase: 1, language: queryLanguage });
    }

    // ── Phase 2: only spent if phase 1 doesn't reach coverage ────────────────
    const specTerms = this.buildSpecTerms(hardConstraints);
    if (specTerms.length > 0) {
      strategies.push({
        channel: 'technical_specs',
        query: [...keywords, ...specTerms].filter(Boolean).join(' ').trim(),
        phase: 2,
        language: queryLanguage,
      });
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
