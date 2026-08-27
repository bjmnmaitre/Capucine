/**
 * Capucine — NoResultsAnalyzer
 *
 * When 0 offers pass AdmissibilityEngine, this module explains WHY
 * and suggests actionable next steps.
 *
 * INVARIANT 5: Never silently relaxes the user's constraints.
 * The analyzer SUGGESTS options. The user must confirm any relaxation.
 *
 * Input: rejected offers with their rejection reasons
 * Output: structured diagnosis and ranked recovery options
 */

import { Offer, PreferenceCriterion, PreferenceLevel } from '../domain/types';
import { translate, registerCatalog } from './i18n';

// ============================================================================
// MESSAGE CATALOGS — same (code, params) + backward-compatible French `text`
// split as explanation-engine.ts's buildHeadline()/buildResultSummary().
// ============================================================================

registerCatalog('fr', {
  DIAG_BUDGET_TOO_STRICT: '{totalCandidates} offre(s) trouvée(s), mais toutes dépassent le budget. Critère bloquant : {topCriteria}.',
  DIAG_FORBIDDEN_VIOLATED: '{totalCandidates} offre(s) trouvée(s), mais toutes violent une contrainte interdite. Critère bloquant : {topCriteria}.',
  DIAG_GEOGRAPHIC_RESTRICTION: '{totalCandidates} offre(s) trouvée(s), mais la livraison n\'est pas disponible pour la zone requise.',
  DIAG_COMBINATION_IMPOSSIBLE: '{totalCandidates} offre(s) trouvée(s), mais aucune ne satisfait simultanément tous les critères requis : {topCriteria}.',
  DIAG_REQUIRED_CRITERION_MISSING: '{totalCandidates} offre(s) trouvée(s), mais aucune ne satisfait le critère requis : {topCriteria}.',
  DIAG_NO_CANDIDATES_DISCOVERED: 'La phase de découverte n\'a trouvé aucun candidat pour cette recherche.',
  DIAG_UNKNOWN: '{totalCandidates} offre(s) trouvée(s) mais rejetées. Cause inconnue.',
  DIAG_DISCOVERY_FAILURE: 'La phase de découverte n\'a trouvé aucun candidat. Les termes de recherche ou la catégorie sont peut-être trop spécifiques.',

  RECOVERY_RELAX_BUDGET_DESC: 'Augmenter le budget maximum',
  RECOVERY_RELAX_BUDGET_IMPACT: 'Les offres dépassant légèrement le budget deviendront éligibles',
  RECOVERY_ACCEPT_REFURBISHED_DESC: 'Considérer les offres reconditionnées',
  RECOVERY_ACCEPT_REFURBISHED_IMPACT: 'Les produits reconditionnés sont souvent 30-40% moins chers',
  RECOVERY_LOWER_LEVEL_DESC: 'Passer "{criterionName}" de "required" à "very_important"',
  RECOVERY_LOWER_LEVEL_IMPACT: 'Le critère influencera le classement mais ne bloquera plus les offres',
  RECOVERY_REMOVE_LEAST_IMPORTANT_DESC: 'Supprimer le critère le moins prioritaire',
  RECOVERY_REMOVE_LEAST_IMPORTANT_IMPACT: 'Davantage d\'offres deviendront éligibles',
  RECOVERY_EXPAND_GEOGRAPHY_DESC: 'Accepter la livraison depuis un autre pays',
  RECOVERY_EXPAND_GEOGRAPHY_IMPACT: 'Accès à davantage de marchands et d\'offres',
  RECOVERY_EXPAND_SEARCH_DESC: 'Élargir les termes de recherche',
  RECOVERY_EXPAND_SEARCH_IMPACT: 'La découverte explorera des catégories ou termes connexes',
  RECOVERY_EXPAND_SEARCH_DISCOVERY_IMPACT: 'La découverte explorera des termes connexes et synonymes',
  RECOVERY_WIDEN_CATEGORY_DESC: 'Élargir la catégorie de produit',
  RECOVERY_WIDEN_CATEGORY_IMPACT: 'La recherche inclura des produits alternatifs proches',
  RECOVERY_WIDEN_CATEGORY_DISCOVERY_IMPACT: 'Produits alternatifs inclus dans la recherche',
  RECOVERY_NEW_SEARCH_DESC: 'Reformuler la recherche',
  RECOVERY_NEW_SEARCH_IMPACT: 'Nouvelle interprétation de la demande',
});

registerCatalog('en', {
  DIAG_BUDGET_TOO_STRICT: '{totalCandidates} offer(s) found, but all exceed the budget. Blocking criterion: {topCriteria}.',
  DIAG_FORBIDDEN_VIOLATED: '{totalCandidates} offer(s) found, but all violate a forbidden constraint. Blocking criterion: {topCriteria}.',
  DIAG_GEOGRAPHIC_RESTRICTION: '{totalCandidates} offer(s) found, but shipping is not available for the required area.',
  DIAG_COMBINATION_IMPOSSIBLE: '{totalCandidates} offer(s) found, but none satisfies all required criteria at once: {topCriteria}.',
  DIAG_REQUIRED_CRITERION_MISSING: '{totalCandidates} offer(s) found, but none satisfies the required criterion: {topCriteria}.',
  DIAG_NO_CANDIDATES_DISCOVERED: 'The discovery phase found no candidates for this search.',
  DIAG_UNKNOWN: '{totalCandidates} offer(s) found but rejected. Unknown cause.',
  DIAG_DISCOVERY_FAILURE: 'The discovery phase found no candidates. The search terms or category may be too specific.',

  RECOVERY_RELAX_BUDGET_DESC: 'Increase the maximum budget',
  RECOVERY_RELAX_BUDGET_IMPACT: 'Offers slightly above budget will become eligible',
  RECOVERY_ACCEPT_REFURBISHED_DESC: 'Consider refurbished offers',
  RECOVERY_ACCEPT_REFURBISHED_IMPACT: 'Refurbished products are often 30-40% cheaper',
  RECOVERY_LOWER_LEVEL_DESC: 'Change "{criterionName}" from "required" to "very_important"',
  RECOVERY_LOWER_LEVEL_IMPACT: 'The criterion will influence ranking but no longer block offers',
  RECOVERY_REMOVE_LEAST_IMPORTANT_DESC: 'Remove the lowest-priority criterion',
  RECOVERY_REMOVE_LEAST_IMPORTANT_IMPACT: 'More offers will become eligible',
  RECOVERY_EXPAND_GEOGRAPHY_DESC: 'Accept shipping from another country',
  RECOVERY_EXPAND_GEOGRAPHY_IMPACT: 'Access to more merchants and offers',
  RECOVERY_EXPAND_SEARCH_DESC: 'Broaden the search terms',
  RECOVERY_EXPAND_SEARCH_IMPACT: 'Discovery will explore related categories or terms',
  RECOVERY_EXPAND_SEARCH_DISCOVERY_IMPACT: 'Discovery will explore related terms and synonyms',
  RECOVERY_WIDEN_CATEGORY_DESC: 'Broaden the product category',
  RECOVERY_WIDEN_CATEGORY_IMPACT: 'The search will include close alternative products',
  RECOVERY_WIDEN_CATEGORY_DISCOVERY_IMPACT: 'Alternative products included in the search',
  RECOVERY_NEW_SEARCH_DESC: 'Rephrase the search',
  RECOVERY_NEW_SEARCH_IMPACT: 'New interpretation of the request',
});

// ============================================================================
// TYPES
// ============================================================================

export type NoResultsCause =
  | 'budget_too_strict'          // All offers exceed budget
  | 'required_criterion_missing' // A required characteristic not found in any offer
  | 'forbidden_violated'         // All offers violate a forbidden criterion
  | 'geographic_restriction'     // Shipping to required country not available
  | 'no_candidates_discovered'   // Discovery found nothing (not an admissibility issue)
  | 'combination_impossible'     // Criteria individually OK, but no offer satisfies all
  | 'unknown';

export interface RejectionPattern {
  criterionId: string;
  criterionName: string;
  level: PreferenceLevel;
  affectedOfferCount: number; // How many offers were rejected because of this
  affectedOfferFraction: number; // 0-1: what fraction of total candidates
  sampleViolation?: string; // Example of what was found vs expected
}

export interface RecoveryOption {
  id: string;
  type:
    | 'relax_budget'
    | 'remove_criterion'
    | 'lower_preference_level'
    | 'expand_geography'
    | 'accept_refurbished'
    | 'expand_search_terms'
    | 'widen_category';

  description: string;

  /** What would change if the user accepts this */
  impact: string;

  /** Language-independent identifiers for `description`/`impact` — pass to
   *  translate(code, language, params). See buildRecoveryOptions(). */
  descriptionCode: string;
  descriptionParams: Record<string, string | number>;
  impactCode: string;

  /** The user must explicitly confirm this — NEVER auto-apply */
  requiresUserConfirmation: true;

  /** Estimated chance of finding results (0-1) */
  estimatedSuccessChance: number;

  /** The criterion to relax (if applicable) */
  targetCriterionId?: string;
}

export interface NoResultsDiagnosis {
  requestId: string;
  analyzedAt: Date;

  totalCandidatesDiscovered: number;
  totalRejectedByAdmissibility: number;

  /** Root causes ranked by impact (most constraining first) */
  rootCauses: RejectionPattern[];

  /** Primary cause (the one blocking most offers) */
  primaryCause: NoResultsCause;

  /** Human-readable diagnosis (French — backward-compatible; see diagnosisCode) */
  diagnosis: string;

  /** Language-independent identifier for `diagnosis` — pass to
   *  translate(code, language, params). See buildDiagnosis(). */
  diagnosisCode: string;
  diagnosisParams: Record<string, string | number>;

  /** Suggested next steps (user must confirm each) */
  recoveryOptions: RecoveryOption[];

  /** Whether ANY combination of criteria could theoretically produce results */
  theoreticallyPossible: boolean;
}

// ============================================================================
// NO RESULTS ANALYZER
// ============================================================================

export class NoResultsAnalyzer {
  /**
   * Analyze why no results passed admissibility.
   *
   * @param rejectedOffers - Offers with their rejection reasons
   * @param criteria - The effective criteria that were applied
   * @param discoveredCount - Total candidates found by discovery (before admissibility)
   */
  analyze(
    rejectedOffers: Array<{ offer: Offer; reason: string }>,
    criteria: PreferenceCriterion[],
    discoveredCount: number,
    requestId = 'unknown'
  ): NoResultsDiagnosis {
    // Case 1: Discovery found nothing
    if (discoveredCount === 0) {
      return this.buildDiscoveryFailureDiagnosis(criteria, requestId);
    }

    // Case 2: Admissibility rejected everything
    const patterns = this.extractRejectionPatterns(rejectedOffers, criteria);
    const primaryCause = this.classifyPrimaryCause(patterns, criteria);
    const diag = this.buildDiagnosis(primaryCause, patterns, discoveredCount);
    const recoveryOptions = this.buildRecoveryOptions(primaryCause, patterns, criteria);

    return {
      requestId,
      analyzedAt: new Date(),
      totalCandidatesDiscovered: discoveredCount,
      totalRejectedByAdmissibility: rejectedOffers.length,
      rootCauses: patterns,
      primaryCause,
      diagnosis: diag.text,
      diagnosisCode: diag.code,
      diagnosisParams: diag.params,
      recoveryOptions,
      theoreticallyPossible: discoveredCount > 0 && patterns.length > 0,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private extractRejectionPatterns(
    rejectedOffers: Array<{ offer: Offer; reason: string; violatedCriterionIds?: string[] }>,
    criteria: PreferenceCriterion[]
  ): RejectionPattern[] {
    // Count how many times each criterion caused a rejection
    const criterionCounts = new Map<string, number>();
    const criterionViolations = new Map<string, string>();

    for (const rejection of rejectedOffers) {
      const { reason } = rejection;

      // Voie sûre : le moteur de priorité rapporte désormais les identifiants
      // des critères violés. On ne devine plus rien.
      if (rejection.violatedCriterionIds && rejection.violatedCriterionIds.length > 0) {
        for (const id of rejection.violatedCriterionIds) {
          criterionCounts.set(id, (criterionCounts.get(id) ?? 0) + 1);
          if (!criterionViolations.has(id)) criterionViolations.set(id, reason);
        }
        continue;
      }

      // Repli pour les appelants qui ne fournissent pas encore les
      // identifiants. Analyse de prose, donc faillible : conservée comme
      // filet, jamais comme voie principale.
      {
      // Parse rejection reason to find which criterion ID was violated.
      // AdmissibilityEngine produces reasons like:
      //   "Price 250 exceeds maximum budget 200"
      //   "Required criterion 'quality' has no data..."
      //   "Forbidden criterion 'merchant-x' is present..."
      let criterionId: string;

      // Budget/price pattern
      if (/price.*exceeds.*budget|budget.*exceeded|prix.*dépasse/i.test(reason)) {
        criterionId = 'budget';
      }
      // "Required criterion 'X'" or "Forbidden criterion 'X'" pattern
      else {
        const requiredMatch = reason.match(/criterion[:\s]*['"]?([^'".\s,]+)['"]?/i);
        criterionId = requiredMatch?.[1] ?? 'unknown';
      }

      criterionCounts.set(criterionId, (criterionCounts.get(criterionId) ?? 0) + 1);
      if (!criterionViolations.has(criterionId)) {
        criterionViolations.set(criterionId, reason);
      }
      }
    }

    const totalRejected = rejectedOffers.length || 1;

    const patterns: RejectionPattern[] = [];

    for (const [criterionId, count] of criterionCounts.entries()) {
      const criterion = criteria.find(c => c.id === criterionId);
      patterns.push({
        criterionId,
        criterionName: criterion?.name ?? criterionId,
        level: criterion?.level ?? 'required',
        affectedOfferCount: count,
        affectedOfferFraction: count / totalRejected,
        sampleViolation: criterionViolations.get(criterionId),
      });
    }

    // Sort by affectedOfferFraction DESC
    patterns.sort((a, b) => b.affectedOfferFraction - a.affectedOfferFraction);

    return patterns;
  }

  private classifyPrimaryCause(
    patterns: RejectionPattern[],
    criteria: PreferenceCriterion[]
  ): NoResultsCause {
    if (patterns.length === 0) return 'unknown';

    const topPattern = patterns[0];

    // Budget criterion
    if (topPattern.criterionId.includes('budget') ||
        topPattern.criterionId.includes('price') ||
        topPattern.criterionName.toLowerCase().includes('budget')) {
      return 'budget_too_strict';
    }

    // Forbidden criterion
    if (topPattern.level === 'forbidden') {
      return 'forbidden_violated';
    }

    // Geographic
    if (topPattern.criterionId.includes('country') ||
        topPattern.criterionId.includes('shipping') ||
        topPattern.criterionId.includes('geo')) {
      return 'geographic_restriction';
    }

    // Multiple criteria all failing = combination impossible
    if (patterns.length >= 3 && patterns.every(p => p.affectedOfferFraction > 0.5)) {
      return 'combination_impossible';
    }

    // Default: required criterion not satisfied
    return 'required_criterion_missing';
  }

  private buildDiagnosis(
    cause: NoResultsCause,
    patterns: RejectionPattern[],
    totalCandidates: number
  ): { text: string; code: string; params: Record<string, string | number> } {
    const topCriteria = patterns.slice(0, 3).map(p => p.criterionName).join(', ');
    const withCriteria = { totalCandidates, topCriteria };

    let code: string;
    let params: Record<string, string | number>;
    switch (cause) {
      case 'budget_too_strict':
        code = 'DIAG_BUDGET_TOO_STRICT'; params = withCriteria; break;
      case 'forbidden_violated':
        code = 'DIAG_FORBIDDEN_VIOLATED'; params = withCriteria; break;
      case 'geographic_restriction':
        code = 'DIAG_GEOGRAPHIC_RESTRICTION'; params = { totalCandidates }; break;
      case 'combination_impossible':
        code = 'DIAG_COMBINATION_IMPOSSIBLE'; params = withCriteria; break;
      case 'required_criterion_missing':
        code = 'DIAG_REQUIRED_CRITERION_MISSING'; params = withCriteria; break;
      case 'no_candidates_discovered':
        code = 'DIAG_NO_CANDIDATES_DISCOVERED'; params = {}; break;
      default:
        code = 'DIAG_UNKNOWN'; params = { totalCandidates }; break;
    }

    return { text: translate(code, 'fr', params), code, params };
  }

  private buildRecoveryOptions(
    cause: NoResultsCause,
    patterns: RejectionPattern[],
    criteria: PreferenceCriterion[]
  ): RecoveryOption[] {
    const options: RecoveryOption[] = [];

    switch (cause) {
      case 'budget_too_strict':
        options.push(this.recoveryOption('relax-budget', 'relax_budget', 'RECOVERY_RELAX_BUDGET_DESC', {}, 'RECOVERY_RELAX_BUDGET_IMPACT', 0.85, patterns[0]?.criterionId));
        options.push(this.recoveryOption('accept-refurbished', 'accept_refurbished', 'RECOVERY_ACCEPT_REFURBISHED_DESC', {}, 'RECOVERY_ACCEPT_REFURBISHED_IMPACT', 0.7));
        break;

      case 'required_criterion_missing':
        for (const pattern of patterns.slice(0, 2)) {
          const criterion = criteria.find(c => c.id === pattern.criterionId);
          if (criterion) {
            options.push(this.recoveryOption(
              `lower-level-${criterion.id}`, 'lower_preference_level',
              'RECOVERY_LOWER_LEVEL_DESC', { criterionName: criterion.name }, 'RECOVERY_LOWER_LEVEL_IMPACT',
              0.75, criterion.id
            ));
          }
        }
        break;

      case 'combination_impossible':
        options.push(this.recoveryOption('remove-least-important', 'remove_criterion', 'RECOVERY_REMOVE_LEAST_IMPORTANT_DESC', {}, 'RECOVERY_REMOVE_LEAST_IMPORTANT_IMPACT', 0.8));
        break;

      case 'geographic_restriction':
        options.push(this.recoveryOption('expand-geography', 'expand_geography', 'RECOVERY_EXPAND_GEOGRAPHY_DESC', {}, 'RECOVERY_EXPAND_GEOGRAPHY_IMPACT', 0.9));
        break;

      case 'no_candidates_discovered':
        options.push(this.recoveryOption('expand-search', 'expand_search_terms', 'RECOVERY_EXPAND_SEARCH_DESC', {}, 'RECOVERY_EXPAND_SEARCH_IMPACT', 0.65));
        options.push(this.recoveryOption('widen-category', 'widen_category', 'RECOVERY_WIDEN_CATEGORY_DESC', {}, 'RECOVERY_WIDEN_CATEGORY_IMPACT', 0.6));
        break;
    }

    // Always available: start fresh
    if (options.length > 0) {
      options.push(this.recoveryOption('new-search', 'expand_search_terms', 'RECOVERY_NEW_SEARCH_DESC', {}, 'RECOVERY_NEW_SEARCH_IMPACT', 0.5));
    }

    return options;
  }

  /** Builds one RecoveryOption with both the French text and the (code, params) pair. */
  private recoveryOption(
    id: string,
    type: RecoveryOption['type'],
    descriptionCode: string,
    descriptionParams: Record<string, string | number>,
    impactCode: string,
    estimatedSuccessChance: number,
    targetCriterionId?: string
  ): RecoveryOption {
    return {
      id,
      type,
      description: translate(descriptionCode, 'fr', descriptionParams),
      impact: translate(impactCode, 'fr'),
      descriptionCode,
      descriptionParams,
      impactCode,
      requiresUserConfirmation: true,
      estimatedSuccessChance,
      targetCriterionId,
    };
  }

  private buildDiscoveryFailureDiagnosis(
    criteria: PreferenceCriterion[],
    requestId: string
  ): NoResultsDiagnosis {
    return {
      requestId,
      analyzedAt: new Date(),
      totalCandidatesDiscovered: 0,
      totalRejectedByAdmissibility: 0,
      rootCauses: [],
      primaryCause: 'no_candidates_discovered',
      diagnosis: translate('DIAG_DISCOVERY_FAILURE', 'fr'),
      diagnosisCode: 'DIAG_DISCOVERY_FAILURE',
      diagnosisParams: {},
      recoveryOptions: [
        this.recoveryOption('expand-search', 'expand_search_terms', 'RECOVERY_EXPAND_SEARCH_DESC', {}, 'RECOVERY_EXPAND_SEARCH_DISCOVERY_IMPACT', 0.7),
        this.recoveryOption('widen-category', 'widen_category', 'RECOVERY_WIDEN_CATEGORY_DESC', {}, 'RECOVERY_WIDEN_CATEGORY_DISCOVERY_IMPACT', 0.6),
      ],
      theoreticallyPossible: false,
    };
  }
}
