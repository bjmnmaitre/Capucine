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

  /** Human-readable diagnosis */
  diagnosis: string;

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
    const diagnosis = this.buildDiagnosis(primaryCause, patterns, discoveredCount);
    const recoveryOptions = this.buildRecoveryOptions(primaryCause, patterns, criteria);

    return {
      requestId,
      analyzedAt: new Date(),
      totalCandidatesDiscovered: discoveredCount,
      totalRejectedByAdmissibility: rejectedOffers.length,
      rootCauses: patterns,
      primaryCause,
      diagnosis,
      recoveryOptions,
      theoreticallyPossible: discoveredCount > 0 && patterns.length > 0,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private extractRejectionPatterns(
    rejectedOffers: Array<{ offer: Offer; reason: string }>,
    criteria: PreferenceCriterion[]
  ): RejectionPattern[] {
    // Count how many times each criterion caused a rejection
    const criterionCounts = new Map<string, number>();
    const criterionViolations = new Map<string, string>();

    for (const { reason } of rejectedOffers) {
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
  ): string {
    const topCriteria = patterns.slice(0, 3).map(p => p.criterionName).join(', ');

    switch (cause) {
      case 'budget_too_strict':
        return `${totalCandidates} offre(s) trouvée(s), mais toutes dépassent le budget. Critère bloquant : ${topCriteria}.`;

      case 'forbidden_violated':
        return `${totalCandidates} offre(s) trouvée(s), mais toutes violent une contrainte interdite. Critère bloquant : ${topCriteria}.`;

      case 'geographic_restriction':
        return `${totalCandidates} offre(s) trouvée(s), mais la livraison n'est pas disponible pour la zone requise.`;

      case 'combination_impossible':
        return `${totalCandidates} offre(s) trouvée(s), mais aucune ne satisfait simultanément tous les critères requis : ${topCriteria}.`;

      case 'required_criterion_missing':
        return `${totalCandidates} offre(s) trouvée(s), mais aucune ne satisfait le critère requis : ${topCriteria}.`;

      case 'no_candidates_discovered':
        return 'La phase de découverte n\'a trouvé aucun candidat pour cette recherche.';

      default:
        return `${totalCandidates} offre(s) trouvée(s) mais rejetées. Cause inconnue.`;
    }
  }

  private buildRecoveryOptions(
    cause: NoResultsCause,
    patterns: RejectionPattern[],
    criteria: PreferenceCriterion[]
  ): RecoveryOption[] {
    const options: RecoveryOption[] = [];

    switch (cause) {
      case 'budget_too_strict':
        options.push({
          id: 'relax-budget',
          type: 'relax_budget',
          description: 'Augmenter le budget maximum',
          impact: 'Les offres dépassant légèrement le budget deviendront éligibles',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.85,
          targetCriterionId: patterns[0]?.criterionId,
        });
        options.push({
          id: 'accept-refurbished',
          type: 'accept_refurbished',
          description: 'Considérer les offres reconditionnées',
          impact: 'Les produits reconditionnés sont souvent 30-40% moins chers',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.7,
        });
        break;

      case 'required_criterion_missing':
        for (const pattern of patterns.slice(0, 2)) {
          const criterion = criteria.find(c => c.id === pattern.criterionId);
          if (criterion) {
            options.push({
              id: `lower-level-${criterion.id}`,
              type: 'lower_preference_level',
              description: `Passer "${criterion.name}" de "required" à "very_important"`,
              impact: 'Le critère influencera le classement mais ne bloquera plus les offres',
              requiresUserConfirmation: true,
              estimatedSuccessChance: 0.75,
              targetCriterionId: criterion.id,
            });
          }
        }
        break;

      case 'combination_impossible':
        options.push({
          id: 'remove-least-important',
          type: 'remove_criterion',
          description: 'Supprimer le critère le moins prioritaire',
          impact: 'Davantage d\'offres deviendront éligibles',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.8,
        });
        break;

      case 'geographic_restriction':
        options.push({
          id: 'expand-geography',
          type: 'expand_geography',
          description: 'Accepter la livraison depuis un autre pays',
          impact: 'Accès à davantage de marchands et d\'offres',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.9,
        });
        break;

      case 'no_candidates_discovered':
        options.push({
          id: 'expand-search',
          type: 'expand_search_terms',
          description: 'Élargir les termes de recherche',
          impact: 'La découverte explorera des catégories ou termes connexes',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.65,
        });
        options.push({
          id: 'widen-category',
          type: 'widen_category',
          description: 'Élargir la catégorie de produit',
          impact: 'La recherche inclura des produits alternatifs proches',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.6,
        });
        break;
    }

    // Always available: start fresh
    if (options.length > 0) {
      options.push({
        id: 'new-search',
        type: 'expand_search_terms',
        description: 'Reformuler la recherche',
        impact: 'Nouvelle interprétation de la demande',
        requiresUserConfirmation: true,
        estimatedSuccessChance: 0.5,
      });
    }

    return options;
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
      diagnosis: 'La phase de découverte n\'a trouvé aucun candidat. Les termes de recherche ou la catégorie sont peut-être trop spécifiques.',
      recoveryOptions: [
        {
          id: 'expand-search',
          type: 'expand_search_terms',
          description: 'Élargir les termes de recherche',
          impact: 'La découverte explorera des termes connexes et synonymes',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.7,
        },
        {
          id: 'widen-category',
          type: 'widen_category',
          description: 'Élargir la catégorie de produit',
          impact: 'Produits alternatifs inclus dans la recherche',
          requiresUserConfirmation: true,
          estimatedSuccessChance: 0.6,
        },
      ],
      theoreticallyPossible: false,
    };
  }
}
