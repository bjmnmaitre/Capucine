/**
 * Capucine — ExplanationEngine
 *
 * DETERMINISTIC: Generates structured explanations of ranking results
 * from DATA only. No AI generation here.
 *
 * What this engine produces:
 * - Per-offer explanation: why did this offer rank where it did?
 * - Per-criterion explanation: what value was found, how was it scored?
 * - Why was an offer rejected by AdmissibilityEngine?
 * - Comparative explanation: why is offer A better than offer B?
 *
 * AI may consume the output of this engine to produce prose explanations,
 * but the CONTENT of the explanation is computed from data here.
 *
 * INVARIANT: ExplanationEngine never invents reasons.
 * If a score is unknown, the explanation says so explicitly.
 */

import {
  RankedOffer,
  RankingResult,
  CriterionScore,
  PreferenceLevel,
  DataStatus,
  ContextualSignalScore,
} from '../domain/types';
import {
  describeSignal,
  describeUsageContext,
} from '../domain/usage-context-mapping';
import { OfferReadiness } from '../domain/purchase-readiness';
import { OfferDataQuality } from '../domain/data-quality';
import { CostBreakdown } from './cost-engine';
import { translate, registerCatalog } from './i18n';

// ============================================================================
// MESSAGE CATALOGS — headline text lives here (i18n.ts's translate()
// consumes it), never as literal strings scattered through buildHeadline().
// ============================================================================

registerCatalog('fr', {
  BEST_RESULT_WITH_STRENGTH: 'Meilleur résultat ({score} pts) — {merchantName}. Point fort : {strength}.',
  BEST_RESULT: 'Meilleur résultat ({score} pts) — {merchantName}.',
  NOT_SELECTED_CONSTRAINTS: 'Non retenu — ne satisfait pas toutes les contraintes.',
  RESULT_RANKED: 'Résultat #{rank} ({score} pts) — {merchantName}.',
  RESULT_SUMMARY_EMPTY_NO_REJECTED: 'Aucun candidat trouvé pour cette recherche.',
  RESULT_SUMMARY_EMPTY_ALL_REJECTED: '{rejected} candidat(s) trouvé(s), tous rejetés par AdmissibilityEngine (contraintes required/forbidden non satisfaites).',
  RESULT_SUMMARY_MAIN_REJ_DELTA: '{total} offre(s) classée(s), {rejected} rejetée(s). Meilleure offre : {merchantName} ({score} pts). Écart avec #2 : {delta} pts.',
  RESULT_SUMMARY_MAIN_REJ: '{total} offre(s) classée(s), {rejected} rejetée(s). Meilleure offre : {merchantName} ({score} pts).',
  RESULT_SUMMARY_MAIN_DELTA: '{total} offre(s) classée(s). Meilleure offre : {merchantName} ({score} pts). Écart avec #2 : {delta} pts.',
  RESULT_SUMMARY_MAIN: '{total} offre(s) classée(s). Meilleure offre : {merchantName} ({score} pts).',
  MATCH_EXACT: 'Correspondance exacte',
  MATCH_CLOSE: 'Très bonne correspondance',
  MATCH_PARTIAL: 'Correspondance partielle',
  MATCH_ALTERNATIVE: 'Alternative',
  MATCH_UNKNOWN: 'Informations insuffisantes',
});

registerCatalog('en', {
  BEST_RESULT_WITH_STRENGTH: 'Best result ({score} pts) — {merchantName}. Strength: {strength}.',
  BEST_RESULT: 'Best result ({score} pts) — {merchantName}.',
  NOT_SELECTED_CONSTRAINTS: 'Not selected — does not satisfy all constraints.',
  RESULT_RANKED: 'Result #{rank} ({score} pts) — {merchantName}.',
  RESULT_SUMMARY_EMPTY_NO_REJECTED: 'No candidates found for this search.',
  RESULT_SUMMARY_EMPTY_ALL_REJECTED: '{rejected} candidate(s) found, all rejected by AdmissibilityEngine (required/forbidden constraints not satisfied).',
  RESULT_SUMMARY_MAIN_REJ_DELTA: '{total} offer(s) ranked, {rejected} rejected. Best offer: {merchantName} ({score} pts). Gap with #2: {delta} pts.',
  RESULT_SUMMARY_MAIN_REJ: '{total} offer(s) ranked, {rejected} rejected. Best offer: {merchantName} ({score} pts).',
  RESULT_SUMMARY_MAIN_DELTA: '{total} offer(s) ranked. Best offer: {merchantName} ({score} pts). Gap with #2: {delta} pts.',
  RESULT_SUMMARY_MAIN: '{total} offer(s) ranked. Best offer: {merchantName} ({score} pts).',
  MATCH_EXACT: 'Exact match',
  MATCH_CLOSE: 'Very close match',
  MATCH_PARTIAL: 'Partial match',
  MATCH_ALTERNATIVE: 'Alternative',
  MATCH_UNKNOWN: 'Insufficient information',
});

// ============================================================================
// EXPLANATION TYPES
// ============================================================================

export interface OfferExplanation {
  offerId: string;
  rank: number;
  overallScore: number;

  /** One-sentence summary of why this offer ranks here, in French (kept for
   *  backward compatibility — existing consumers read this field directly).
   *  New code should prefer headlineCode + headlineParams and translate()
   *  (i18n.ts) so the same explanation can be rendered in any supported
   *  language without ExplanationEngine itself knowing about languages —
   *  see buildHeadline() below for the producer side of this split. */
  headline: string;

  /** Language-independent identifier for `headline` — e.g. 'BEST_RESULT',
   *  'NOT_SELECTED_CONSTRAINTS'. Pass to translate(code, language, params). */
  headlineCode: string;

  /** Structured params for headlineCode's {placeholders} (merchant name,
   *  score, top strength...) — never baked into a language-specific string here. */
  headlineParams: Record<string, string | number>;

  /** Strongest positive factors */
  strengths: ExplanationFactor[];

  /** Weaknesses or missing data */
  weaknesses: ExplanationFactor[];

  /** How unknown data affected the score */
  unknownDataImpact: string;

  /**
   * Usage-context contribution, present only when a usage context was part of
   * this search AND produced signals. Absent → the offer was ranked purely on
   * the user's own criteria, and no sentence about usage is generated.
   */
  contextual?: ContextualExplanation;

  /** What it really costs, and what part of that is unknown. */
  cost?: CostExplanation;

  /** Whether it can actually be bought, dimension by dimension. */
  readiness?: ReadinessExplanation;

  /** How solid the underlying data is. Never a reason to accept or reject. */
  dataQuality?: DataQualityExplanation;

  /** Per-criterion breakdown */
  criterionBreakdown: CriterionBreakdown[];

  /** Provenance summary */
  dataSources: string[];
}

export interface CriterionBreakdown {
  criterionId: string;
  criterionName: string;
  level: PreferenceLevel;
  score: number;
  maxPossible: number;

  /** What value was found */
  foundValue: unknown;
  foundValueStatus: DataStatus;

  /** What was expected / what would score 100 */
  expectedValue?: unknown;

  /** Human-readable verdict */
  verdict: string;

  /** 'positive' | 'neutral' | 'negative' | 'unknown' */
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
}

/**
 * How the usage context — and ONLY the usage context — affected this offer.
 *
 * Kept as its own block, never merged into `strengths`, because the two are
 * epistemically different and the user is entitled to tell them apart:
 * `strengths` are things measured against what the user ASKED FOR;
 * this is what Capucine INFERRED was relevant. `attributedTo` names which of
 * the two it is, and the generated prose is worded accordingly — an
 * inference is never phrased as "vous avez demandé".
 */
export interface ContextualExplanation {
  /** e.g. "pour l'écoute de musique, dans les transports" */
  usageDescription: string;
  /**
   * 'user'     — the user stated this usage themselves
   * 'inferred' — Capucine deduced it
   * 'profile'  — it came from the permanent profile
   */
  usageSource: 'user' | 'inferred' | 'profile';
  /** Points the contextual signals added to this offer's score (>= 0). */
  bonusApplied: number;
  /** Signals that actually scored, with the value that was read. */
  appliedSignals: Array<{ signal: string; label: string; detail: string; points: number }>;
  /** Signals whose data was missing — explicitly reported as neutral. */
  unknownSignals: string[];
  /** Signals dropped because the user set an explicit criterion on them. */
  supersededSignals: string[];
  /**
   * One honest sentence, safe to show as-is. Always attributes contextual
   * factors to the usage, never to a request the user did not make.
   */
  statement: string;
}

export interface ExplanationFactor {
  criterionId: string;
  criterionName: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * What this offer will really cost, and how much of that is actually known.
 *
 * Deliberately separate from the headline: "299 €" and "299 € plus unknown
 * shipping" are different statements, and only one of them is a price.
 */
export interface CostExplanation {
  /** Sum of the components that ARE known. Never called "the price". */
  totalKnown: number;
  currency: string;
  certainty: 'known' | 'partially_known' | 'unknown';
  /** Components with no published value — named, not hidden. */
  unknownComponents: string[];
  /** Components that provably cannot apply (e.g. duties inside a customs union). */
  notApplicableComponents: string[];
  /** True when part of the total was derived rather than published. */
  containsEstimate: boolean;
  /** One honest sentence. */
  statement: string;
  /**
   * Set when the user stated a budget AND the known total exceeds it even
   * though the product price alone did not. The offer stays admissible — the
   * user's budget criterion is about the price they were shown — but pretending
   * the total is within budget would be misleading.
   */
  budgetWarning?: string;
}

/** Can it be bought, and what is still unknown. */
export interface ReadinessExplanation {
  ready: boolean;
  /** Dimensions not yet confirmed. */
  pending: string[];
  /** Dimensions positively unavailable. */
  blocked: string[];
  /** Per-dimension plain-language state. */
  details: Array<{ dimension: string; state: string; reason: string }>;
  /** Points this offer earned for CONFIRMED availability facts (>= 0). */
  bonusApplied: number;
  statement: string;
}

/** How solid the evidence behind this offer is. */
export interface DataQualityExplanation {
  overall: string;
  priceConfidence: string;
  priceRationale: string;
  /** Constraint-bearing fields the merchant does not publish. */
  missingForConstraints: string[];
  statement: string;
}

export interface RejectionExplanation {
  offerId: string;
  rejectedBy: string; // which criterion caused rejection
  reason: string;
  detail: string;
}

export interface ComparativeExplanation {
  betterOfferId: string;
  worseOfferId: string;
  scoreDelta: number;
  decisiveFactor: string;
  factorBreakdown: Array<{
    criterionName: string;
    betterScore: number;
    worseScore: number;
    delta: number;
  }>;
}

/**
 * Everything the explanation needs that the RankingResult does not carry.
 * All optional: an explanation of a ranking computed without them is simply
 * quieter, never wrong.
 */
export interface ExplanationContext {
  costs?: Map<string, CostBreakdown>;
  dataQuality?: Map<string, OfferDataQuality>;
  /** The budget the user actually stated, for the total-cost warning. */
  maxBudget?: number;
}

export interface FullExplanation {
  requestId: string;
  generatedAt: Date;
  totalOffersRanked: number;
  totalOffersRejected: number;

  /** Explanation per ranked offer */
  rankedExplanations: OfferExplanation[];

  /** Why rejected offers were rejected */
  rejectionExplanations: RejectionExplanation[];

  /** Why #1 beats #2 */
  topComparison?: ComparativeExplanation;

  /** Global summary for this result set */
  resultSummary: string;

  /** Language-independent identifier for `resultSummary` — pass to
   *  translate(code, language, params). See buildResultSummary(). */
  resultSummaryCode: string;
  resultSummaryParams: Record<string, string | number>;
}

// ============================================================================
// EXPLANATION ENGINE
// ============================================================================

export class ExplanationEngine {
  /**
   * Generate full explanations for a RankingResult.
   * Completely deterministic — no randomness, no AI.
   */
  explain(result: RankingResult, context: ExplanationContext = {}): FullExplanation {
    const rankedExplanations = result.rankedOffers.map((ro, idx) =>
      this.explainOffer(ro, idx + 1, context)
    );

    const rejectionExplanations = (result.rejectedOffers ?? []).map(r =>
      this.explainRejection(r)
    );

    const topComparison =
      result.rankedOffers.length >= 2
        ? this.compareOffers(result.rankedOffers[0], result.rankedOffers[1])
        : undefined;

    const summary = this.buildResultSummary(result);

    return {
      requestId: result.requestId,
      generatedAt: new Date(),
      totalOffersRanked: result.rankedOffers.length,
      totalOffersRejected: (result.rejectedOffers ?? []).length,
      rankedExplanations,
      rejectionExplanations,
      topComparison,
      resultSummary: summary.text,
      resultSummaryCode: summary.code,
      resultSummaryParams: summary.params,
    };
  }

  /**
   * Explain a single ranked offer.
   */
  explainOffer(rankedOffer: RankedOffer, rank: number, context: ExplanationContext = {}): OfferExplanation {
    const criterionBreakdown = rankedOffer.criterionScores.map(cs =>
      this.explainCriterion(cs)
    );

    const strengths = this.extractStrengths(criterionBreakdown);
    const weaknesses = this.extractWeaknesses(criterionBreakdown);

    const unknownFields = criterionBreakdown.filter(c => c.sentiment === 'unknown');
    const unknownDataImpact = unknownFields.length === 0
      ? 'Toutes les données pertinentes sont connues.'
      : `${unknownFields.length} donnée(s) inconnue(s) : ${unknownFields.map(f => f.criterionName).join(', ')}. L'inconnue n'est pas traitée comme un défaut.`;

    const headline = this.buildHeadline(rank, rankedOffer, criterionBreakdown);

    const dataSources = this.extractSources(rankedOffer);

    const contextual = this.explainContextualRelevance(rankedOffer);
    const cost = this.explainCost(context.costs?.get(rankedOffer.offer.id), context.maxBudget);
    const readiness = this.explainReadiness(rankedOffer);
    const dataQuality = this.explainDataQuality(context.dataQuality?.get(rankedOffer.offer.id));

    return {
      offerId: rankedOffer.offer.id,
      rank,
      overallScore: rankedOffer.overallScore,
      headline: headline.text,
      headlineCode: headline.code,
      headlineParams: headline.params,
      strengths,
      weaknesses,
      unknownDataImpact,
      criterionBreakdown,
      dataSources,
      ...(contextual ? { contextual } : {}),
      ...(cost ? { cost } : {}),
      ...(readiness ? { readiness } : {}),
      ...(dataQuality ? { dataQuality } : {}),
    };
  }

  /**
   * Turn the ranking's ContextualRelevance into prose that cannot mislead.
   *
   * Three separations are enforced here:
   *  - what the user ASKED (criterionBreakdown) vs what Capucine INFERRED
   *    was relevant (this block) — never merged;
   *  - a usage the user STATED ("source: user") vs one Capucine deduced
   *    ("source: inferred") — the sentence says which;
   *  - data that was read vs data that was missing — missing signals are
   *    named and declared neutral rather than quietly omitted.
   */
  private explainContextualRelevance(rankedOffer: RankedOffer): ContextualExplanation | undefined {
    const relevance = rankedOffer.contextualRelevance;
    if (!relevance) return undefined;

    const usageDescription = describeUsageContext(relevance.usageContext);
    const applied = relevance.signals.filter(s => s.outcome === 'applied');
    const unknown = relevance.signals.filter(s => s.outcome === 'unknown');
    const superseded = relevance.signals.filter(s => s.outcome === 'superseded');

    const appliedSignals = applied.map((s: ContextualSignalScore) => ({
      signal: String(s.signal),
      label: describeSignal(s.signal),
      detail: s.reasoning,
      points: s.contribution,
    }));

    // The usage itself: stated by the user, or deduced by Capucine? The
    // ATTRIBUTES are inferred either way — that is said explicitly below.
    const origin = relevance.usageContext.source === 'user'
      ? "que vous avez indiqué"
      : relevance.usageContext.source === 'profile'
        ? 'issu de votre profil'
        : 'déduit de votre demande';

    let statement: string;
    if (appliedSignals.length > 0) {
      const names = appliedSignals.map(s => s.label).join(', ');
      statement =
        `Pour votre usage ${usageDescription} (${origin}), ${names} ` +
        `${appliedSignals.length > 1 ? 'ont été pris' : 'a été pris'} en compte comme signaux contextuels ` +
        `(+${relevance.bonus} pts). Ce ne sont pas des exigences que vous avez formulées.`;
    } else {
      statement =
        `Pour votre usage ${usageDescription} (${origin}), aucune donnée contextuelle exploitable ` +
        `n'était disponible pour cette offre : elle n'a été ni valorisée ni pénalisée à ce titre.`;
    }
    if (superseded.length > 0) {
      statement += ` ${superseded.length} dimension(s) laissée(s) à vos critères explicites.`;
    }

    return {
      usageDescription,
      usageSource: relevance.usageContext.source,
      bonusApplied: relevance.bonus,
      appliedSignals,
      unknownSignals: unknown.map(s => describeSignal(s.signal)),
      supersededSignals: superseded.map(s => describeSignal(s.signal)),
      statement,
    };
  }

  /**
   * Turn a CostBreakdown into a statement that never overstates what is known.
   *
   * The rule enforced here: a total with unknown components is described as
   * "au moins X" — never as "X". The user must be able to tell a confirmed
   * total from a partial one at a glance.
   */
  private explainCost(cost: CostBreakdown | undefined, maxBudget?: number): CostExplanation | undefined {
    if (!cost) return undefined;

    const notApplicable = Object.entries(cost.componentStates)
      .filter(([, state]) => state === 'not_applicable')
      .map(([name]) => name);

    let statement: string;
    if (cost.certainty === 'known') {
      statement = `Coût total confirmé : ${cost.totalKnown} ${cost.currency} (toutes les composantes sont connues).`;
    } else if (cost.certainty === 'partially_known') {
      statement =
        `Coût total partiellement connu : au moins ${cost.totalKnown} ${cost.currency}. ` +
        `Composantes encore inconnues : ${cost.unknownComponents.join(', ')} — non estimées, non ignorées.`;
    } else {
      statement = "Coût inconnu : aucun prix exploitable n'a été relevé pour cette offre.";
    }
    if (cost.containsEstimate) {
      statement += ' Une partie du total résulte d’une conversion de devise à taux non contractuel — montant indicatif.';
    }

    // The budget criterion is checked against the PRICE by
    // AdmissibilityEngine, which is what the user was shown and what they
    // meant. When the KNOWN extras push the real total past that budget, the
    // offer stays admissible but saying nothing would mislead.
    let budgetWarning: string | undefined;
    if (maxBudget !== undefined && cost.totalKnown > maxBudget) {
      const price = cost.productPrice.value;
      if (price !== null && price <= maxBudget) {
        budgetWarning =
          `Le prix affiché (${price} ${cost.currency}) respecte votre budget de ${maxBudget} ${cost.currency}, ` +
          `mais le coût total connu atteint ${cost.totalKnown} ${cost.currency} une fois les frais connus ajoutés.`;
      }
    }

    return {
      totalKnown: cost.totalKnown,
      currency: cost.currency,
      certainty: cost.certainty,
      unknownComponents: cost.unknownComponents,
      notApplicableComponents: notApplicable,
      containsEstimate: cost.containsEstimate,
      statement,
      ...(budgetWarning ? { budgetWarning } : {}),
    };
  }

  /**
   * Report readiness dimension by dimension.
   *
   * 'unknown' is always worded as unknown. Turning "le marchand ne publie pas
   * son stock" into "indisponible" is exactly the fabrication INVARIANT 2 and
   * INVARIANT 9 forbid, so the two states get visibly different sentences.
   */
  private explainReadiness(rankedOffer: RankedOffer): ReadinessExplanation | undefined {
    const readiness = rankedOffer.readiness as OfferReadiness | undefined;
    if (!readiness) return undefined;

    const details = ([
      ['verified', readiness.verified],
      ['purchasable', readiness.purchasable],
      ['inStock', readiness.inStock],
      ['deliverable', readiness.deliverable],
    ] as const).map(([dimension, assessment]) => ({
      dimension,
      state: assessment.state,
      reason: assessment.reason,
    }));

    return {
      ready: readiness.ready,
      pending: [...readiness.pending],
      blocked: [...readiness.blocked],
      details,
      bonusApplied: rankedOffer.readinessBonus ?? 0,
      statement: readiness.summary,
    };
  }

  private explainDataQuality(quality: OfferDataQuality | undefined): DataQualityExplanation | undefined {
    if (!quality) return undefined;

    const LEVELS: Record<string, string> = {
      high: 'élevée', medium: 'moyenne', low: 'faible', none: 'aucune donnée',
    };

    let statement = `Confiance dans les données : ${LEVELS[quality.overall] ?? quality.overall} — prix ${quality.price.rationale}.`;
    if (quality.missingForConstraints.length > 0) {
      statement +=
        ` ${quality.missingForConstraints.length} critère(s) que vous avez exprimé(s) ne peuvent pas être vérifiés ` +
        `sur cette offre (${quality.missingForConstraints.join(', ')}) : information inconnue, pas information contraire.`;
    }

    return {
      overall: quality.overall,
      priceConfidence: quality.price.level,
      priceRationale: quality.price.rationale,
      missingForConstraints: quality.missingForConstraints,
      statement,
    };
  }

  /**
   * Explain a single criterion score.
   */
  explainCriterion(cs: CriterionScore): CriterionBreakdown {
    const { score, dataUsed } = cs;
    const maxPossible = 100;

    const sentiment = this.computeSentiment(score, maxPossible, dataUsed.status);

    const foundValue = dataUsed.value;
    const verdict = this.buildCriterionVerdict(cs, sentiment);

    return {
      criterionId: cs.criterionId,
      criterionName: cs.criterionName,
      level: cs.level,
      score,
      maxPossible,
      foundValue,
      foundValueStatus: dataUsed.status,
      verdict,
      sentiment,
    };
  }

  /**
   * Explain why an offer was rejected.
   */
  explainRejection(rejected: { offer: { id: string }; reason: string }): RejectionExplanation {
    // Parse the rejection reason to extract criterion info
    const criterionMatch = rejected.reason.match(/criterion[:\s]+([^\s.]+)/i);
    const rejectedBy = criterionMatch?.[1] ?? 'unknown criterion';

    return {
      offerId: rejected.offer.id,
      rejectedBy,
      reason: 'Rejeté par AdmissibilityEngine (contrainte required/forbidden)',
      detail: rejected.reason,
    };
  }

  /**
   * Compare two ranked offers and explain why one beats the other.
   */
  compareOffers(
    better: RankedOffer,
    worse: RankedOffer
  ): ComparativeExplanation {
    const scoreDelta = better.overallScore - worse.overallScore;

    // Find the criterion with the biggest delta
    const factorBreakdown: ComparativeExplanation['factorBreakdown'] = [];

    // Match criteria by ID
    for (const betterCs of better.criterionScores) {
      const worseCs = worse.criterionScores.find(
        cs => cs.criterionId === betterCs.criterionId
      );
      if (!worseCs) continue;

      const delta = betterCs.score - worseCs.score;
      if (Math.abs(delta) < 1) continue; // Ignore negligible differences

      factorBreakdown.push({
        criterionName: betterCs.criterionName,
        betterScore: betterCs.score,
        worseScore: worseCs.score,
        delta,
      });
    }

    // Sort by absolute delta, most decisive first
    factorBreakdown.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const decisiveFactor = factorBreakdown.length > 0
      ? `${factorBreakdown[0].criterionName} (Δ${factorBreakdown[0].delta > 0 ? '+' : ''}${factorBreakdown[0].delta.toFixed(0)} pts)`
      : 'Score global légèrement différent';

    return {
      betterOfferId: better.offer.id,
      worseOfferId: worse.offer.id,
      scoreDelta,
      decisiveFactor,
      factorBreakdown,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private computeSentiment(
    score: number,
    maxPossible: number,
    dataStatus: DataStatus
  ): 'positive' | 'neutral' | 'negative' | 'unknown' {
    if (dataStatus === 'unknown') return 'unknown';

    const ratio = score / maxPossible;
    if (ratio >= 0.75) return 'positive';
    if (ratio >= 0.4) return 'neutral';
    return 'negative';
  }

  private buildCriterionVerdict(cs: CriterionScore, sentiment: string): string {
    if (cs.dataUsed.status === 'unknown') {
      return `Information non disponible. Score neutre appliqué (UNKNOWN ≠ négatif).`;
    }

    if (cs.dataUsed.status === 'contradictory') {
      return `Données contradictoires entre sources. Valeur conservatrice utilisée.`;
    }

    const scoreStr = `${cs.score.toFixed(0)}/100`;

    if (sentiment === 'positive') {
      return `${scoreStr} — ${cs.reasoning}`;
    } else if (sentiment === 'negative') {
      return `${scoreStr} (faible) — ${cs.reasoning}`;
    } else {
      return `${scoreStr} (moyen) — ${cs.reasoning}`;
    }
  }

  private extractStrengths(breakdown: CriterionBreakdown[]): ExplanationFactor[] {
    return breakdown
      .filter(c => c.sentiment === 'positive')
      .sort((a, b) => {
        // Very important/important first
        const priorityOf = (level: PreferenceLevel) =>
          level === 'very_important' ? 0
          : level === 'important' ? 1
          : level === 'preference' ? 2
          : 3;
        return priorityOf(a.level) - priorityOf(b.level);
      })
      .slice(0, 3)
      .map(c => ({
        criterionId: c.criterionId,
        criterionName: c.criterionName,
        description: c.verdict,
        impact: c.level === 'very_important' ? 'high'
          : c.level === 'important' ? 'medium'
          : 'low',
      }));
  }

  private extractWeaknesses(breakdown: CriterionBreakdown[]): ExplanationFactor[] {
    return breakdown
      .filter(c => c.sentiment === 'negative' || c.sentiment === 'unknown')
      .sort((a, b) => {
        const priorityOf = (level: PreferenceLevel) =>
          level === 'very_important' ? 0
          : level === 'important' ? 1
          : 3;
        return priorityOf(a.level) - priorityOf(b.level);
      })
      .slice(0, 3)
      .map(c => ({
        criterionId: c.criterionId,
        criterionName: c.criterionName,
        description: c.verdict,
        impact: c.level === 'very_important' ? 'high'
          : c.level === 'important' ? 'medium'
          : 'low',
      }));
  }

  /**
   * Builds BOTH the backward-compatible French `text` and the
   * language-independent (code, params) pair — see OfferExplanation for why.
   * The French templates here are ALSO registered in EXPLANATION_MESSAGES_FR
   * (bottom of file) so `text` and translate(code, 'fr', params) agree.
   */
  private buildHeadline(
    rank: number,
    rankedOffer: RankedOffer,
    breakdown: CriterionBreakdown[]
  ): { text: string; code: string; params: Record<string, string | number> } {
    const merchantName = rankedOffer.offer.merchant.name;
    const score = rankedOffer.overallScore.toFixed(0);

    if (rank === 1) {
      const topStrength = breakdown.find(c => c.sentiment === 'positive');
      if (topStrength) {
        const params = { score, merchantName, strength: topStrength.criterionName };
        return { text: translate('BEST_RESULT_WITH_STRENGTH', 'fr', params), code: 'BEST_RESULT_WITH_STRENGTH', params };
      }
      const params = { score, merchantName };
      return { text: translate('BEST_RESULT', 'fr', params), code: 'BEST_RESULT', params };
    }

    if (!rankedOffer.satisfiesAllConstraints) {
      return { text: translate('NOT_SELECTED_CONSTRAINTS', 'fr'), code: 'NOT_SELECTED_CONSTRAINTS', params: {} };
    }

    const params = { rank, score, merchantName };
    return { text: translate('RESULT_RANKED', 'fr', params), code: 'RESULT_RANKED', params };
  }

  private extractSources(rankedOffer: RankedOffer): string[] {
    const sources = new Set<string>();
    sources.add(rankedOffer.offer.provenance.source);

    for (const [, char] of Object.entries(rankedOffer.offer.characteristics)) {
      if (char.provenance?.source) {
        sources.add(char.provenance.source);
      }
    }

    return [...sources];
  }

  /**
   * Builds BOTH the backward-compatible French `text` and the
   * language-independent (code, params) pair — same split as buildHeadline().
   */
  private buildResultSummary(
    result: RankingResult
  ): { text: string; code: string; params: Record<string, string | number> } {
    const total = result.rankedOffers.length;
    const rejected = (result.rejectedOffers ?? []).length;

    if (total === 0 && rejected === 0) {
      return { text: translate('RESULT_SUMMARY_EMPTY_NO_REJECTED', 'fr'), code: 'RESULT_SUMMARY_EMPTY_NO_REJECTED', params: {} };
    }

    if (total === 0) {
      const params = { rejected };
      return { text: translate('RESULT_SUMMARY_EMPTY_ALL_REJECTED', 'fr', params), code: 'RESULT_SUMMARY_EMPTY_ALL_REJECTED', params };
    }

    const topOffer = result.rankedOffers[0];
    const merchantName = topOffer.offer.merchant.name;
    const score = topOffer.overallScore.toFixed(0);
    const hasDelta = total >= 2;
    const delta = hasDelta
      ? (result.rankedOffers[0].overallScore - result.rankedOffers[1].overallScore).toFixed(0)
      : undefined;

    if (rejected > 0 && hasDelta) {
      const params = { total, rejected, merchantName, score, delta: delta! };
      return { text: translate('RESULT_SUMMARY_MAIN_REJ_DELTA', 'fr', params), code: 'RESULT_SUMMARY_MAIN_REJ_DELTA', params };
    }
    if (rejected > 0) {
      const params = { total, rejected, merchantName, score };
      return { text: translate('RESULT_SUMMARY_MAIN_REJ', 'fr', params), code: 'RESULT_SUMMARY_MAIN_REJ', params };
    }
    if (hasDelta) {
      const params = { total, merchantName, score, delta: delta! };
      return { text: translate('RESULT_SUMMARY_MAIN_DELTA', 'fr', params), code: 'RESULT_SUMMARY_MAIN_DELTA', params };
    }
    const params = { total, merchantName, score };
    return { text: translate('RESULT_SUMMARY_MAIN', 'fr', params), code: 'RESULT_SUMMARY_MAIN', params };
  }
}
