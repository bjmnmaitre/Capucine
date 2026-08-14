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

// ============================================================================
// EXPLANATION TYPES
// ============================================================================

export interface OfferExplanation {
  offerId: string;
  rank: number;
  overallScore: number;

  /** One-sentence summary of why this offer ranks here */
  headline: string;

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

    const resultSummary = this.buildResultSummary(result);

    return {
      requestId: result.requestId,
      generatedAt: new Date(),
      totalOffersRanked: result.rankedOffers.length,
      totalOffersRejected: (result.rejectedOffers ?? []).length,
      rankedExplanations,
      rejectionExplanations,
      topComparison,
      resultSummary,
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
      headline,
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

  private buildHeadline(
    rank: number,
    rankedOffer: RankedOffer,
    breakdown: CriterionBreakdown[]
  ): string {
    const merchantName = rankedOffer.offer.merchant.name;
    const score = rankedOffer.overallScore.toFixed(0);

    if (rank === 1) {
      const topStrength = breakdown.find(c => c.sentiment === 'positive');
      return topStrength
        ? `Meilleur résultat (${score} pts) — ${merchantName}. Point fort : ${topStrength.criterionName}.`
        : `Meilleur résultat (${score} pts) — ${merchantName}.`;
    }

    if (!rankedOffer.satisfiesAllConstraints) {
      return `Non retenu — ne satisfait pas toutes les contraintes.`;
    }

    return `Résultat #${rank} (${score} pts) — ${merchantName}.`;
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

  private buildResultSummary(result: RankingResult): string {
    const total = result.rankedOffers.length;
    const rejected = (result.rejectedOffers ?? []).length;

    if (total === 0 && rejected === 0) {
      return 'Aucun candidat trouvé pour cette recherche.';
    }

    if (total === 0) {
      return `${rejected} candidat(s) trouvé(s), tous rejetés par AdmissibilityEngine (contraintes required/forbidden non satisfaites).`;
    }

    const topOffer = result.rankedOffers[0];
    const merchantName = topOffer.offer.merchant.name;
    const score = topOffer.overallScore.toFixed(0);

    let summary = `${total} offre(s) classée(s)`;
    if (rejected > 0) summary += `, ${rejected} rejetée(s)`;
    summary += `. Meilleure offre : ${merchantName} (${score} pts)`;

    if (total >= 2) {
      const delta = (result.rankedOffers[0].overallScore - result.rankedOffers[1].overallScore).toFixed(0);
      summary += `. Écart avec #2 : ${delta} pts.`;
    } else {
      summary += '.';
    }

    return summary;
  }
}
