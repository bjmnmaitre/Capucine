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
} from '../domain/types';
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

export interface ExplanationFactor {
  criterionId: string;
  criterionName: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
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
  explain(result: RankingResult): FullExplanation {
    const rankedExplanations = result.rankedOffers.map((ro, idx) =>
      this.explainOffer(ro, idx + 1)
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
  explainOffer(rankedOffer: RankedOffer, rank: number): OfferExplanation {
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
