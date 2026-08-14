/**
 * Capucine Application Layer — Results/Explanation Executor
 *
 * REAL IMPLEMENTATION: Compiles discovery, normalization, and ranking into
 * structured results and human-readable explanations.
 *
 * This layer bridges:
 * - Machine-readable decisions (ranking)
 * - Human-understandable explanations
 * - Actionable next steps
 */

import { RankedOffer, RankingResult } from '../domain/types';
import { DiscoveryResult } from './discovery';
import { ProvenanceAuditTrail } from './provenance';

// ============================================================================
// RESULT PACKAGING
// ============================================================================

/**
 * Structured explanation for why an offer scored as it did.
 */
export interface OfferExplanation {
  offerId: string;
  productName: string;
  merchantName: string;

  // Why this rank?
  overallScore: number; // 0-100
  rankPosition: number; // 1st, 2nd, etc.
  scoreBreakdown: {
    criterion: string;
    weight: string; // "required", "very important", etc.
    score: number;
    reasoning: string;
  }[];

  // Key facts about this offer
  highlights: string[];
  concerns?: string[];

  // Data quality issues
  dataQualityIssues?: {
    field: string;
    issue: string;
    impact: string; // "might_affect_ranking", "informational"
  }[];

  // Execution information
  howtoBuy?: {
    merchant: string;
    method: string; // "direct", "oauth", "browser", etc.
    url?: string;
  };
}

/**
 * Results of a complete shopping search.
 */
export interface ShoppingResults {
  requestId: string;
  timestamp: Date;

  // Summary
  summary: string; // E.g., "Found 23 headphones, ranked by price and quality"

  // Top recommendations
  topRecommendations: OfferExplanation[];

  // Full list (if user wants to see alternatives)
  allOptions?: OfferExplanation[];

  // Statistics
  statistics: {
    totalOffersDiscovered: number;
    offersAfterFiltering: number;
    offersExamined: number;
    ransomWalks?: number; // How many offers failed ranking due to constraints
  };

  // Data quality assessment
  dataQualityAssessment: {
    overallConfidence: 'high' | 'medium' | 'low';
    missingData?: string[];
    conflictingData?: string[];
    recommendations?: string[];
  };

  // Execution context
  executionContext: {
    timeoutOccurred: boolean;
    sourcesQueried: number;
    cacheHit: boolean;
  };

  // Next steps
  nextSteps?: {
    action: string; // "view_details", "purchase", "request_clarification"
    offerId?: string;
    url?: string;
  }[];
}

// ============================================================================
// RESULTS EXECUTOR
// ============================================================================

/**
 * Compiles search results into structured output.
 *
 * DETERMINISTIC: Same input always produces same output
 * (though human-readable text may vary slightly).
 */
export class ResultsExecutor {
  private rankingResults?: RankingResult;
  private discoveryResults?: DiscoveryResult;
  private provenanceTrails: Map<string, ProvenanceAuditTrail> = new Map();

  /**
   * Set ranking results.
   */
  setRankingResults(results: RankingResult): void {
    this.rankingResults = results;
  }

  /**
   * Set discovery results.
   */
  setDiscoveryResults(results: DiscoveryResult): void {
    this.discoveryResults = results;
  }

  /**
   * Register provenance trail for an offer.
   */
  registerProvenanceTrail(offerId: string, trail: ProvenanceAuditTrail): void {
    this.provenanceTrails.set(offerId, trail);
  }

  /**
   * Execute result compilation.
   */
  execute(): ShoppingResults {
    if (!this.rankingResults) {
      return this.emptyResults();
    }

    const topCount = Math.min(5, this.rankingResults.rankedOffers.length);
    const topOffers = this.rankingResults.rankedOffers.slice(0, topCount);

    const topExplanations = topOffers.map((ro, index) =>
      this.buildOfferExplanation(ro, index + 1)
    );

    // All options (if there are more than top 5)
    const allExplanations =
      this.rankingResults.rankedOffers.length > 5
        ? this.rankingResults.rankedOffers.map((ro, index) =>
            this.buildOfferExplanation(ro, index + 1)
          )
        : undefined;

    return {
      requestId: this.rankingResults.requestId,
      timestamp: new Date(),
      summary: this.buildSummary(topOffers.length),
      topRecommendations: topExplanations,
      allOptions: allExplanations,
      statistics: {
        totalOffersDiscovered: this.discoveryResults?.candidates.length || 0,
        offersAfterFiltering: this.rankingResults.rankedOffers.length,
        offersExamined: this.rankingResults.rankedOffers.length,
        ransomWalks: this.rankingResults.rejectedOffers?.length || 0,
      },
      dataQualityAssessment: this.assessDataQuality(),
      executionContext: {
        timeoutOccurred: false,
        sourcesQueried: this.discoveryResults?.statistics.queriedSources || 0,
        cacheHit: this.discoveryResults?.strategy === 'cache' || false,
      },
      nextSteps: topOffers.slice(0, 3).map((ro, idx) => ({
        action: idx === 0 ? 'purchase' : 'view_details',
        offerId: ro.offer.id,
      })),
    };
  }

  /**
   * Build explanation for a ranked offer.
   */
  private buildOfferExplanation(rankedOffer: RankedOffer, position: number): OfferExplanation {
    const offer = rankedOffer.offer;
    const trail = this.provenanceTrails.get(offer.id);

    // Extract top criteria
    const topCriteria = rankedOffer.criterionScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      offerId: offer.id,
      productName: `Product ${offer.productId}`,
      merchantName: offer.merchant.name,
      overallScore: rankedOffer.overallScore,
      rankPosition: position,
      scoreBreakdown: topCriteria.map(cs => ({
        criterion: cs.criterionName,
        weight: cs.level,
        score: cs.score,
        reasoning: cs.reasoning,
      })),
      highlights: this.extractHighlights(rankedOffer),
      concerns: rankedOffer.violatedConstraints?.map(vc => vc.reason),
      dataQualityIssues: trail?.warnings?.map((w: string) => ({
        field: 'offer',
        issue: w,
        impact: 'informational',
      })),
      howtoBuy: {
        merchant: offer.merchant.name,
        method: offer.executionCapability || 'direct',
        url: offer.executionUrl,
      },
    };
  }

  /**
   * Extract key highlights for an offer.
   */
  private extractHighlights(rankedOffer: RankedOffer): string[] {
    const highlights: string[] = [];

    // Top scoring criteria
    const topScore = rankedOffer.criterionScores
      .sort((a, b) => b.score - a.score)[0];

    if (topScore) {
      highlights.push(`Excellent ${topScore.criterionName}`);
    }

    // Price
    if (rankedOffer.offer.price.value) {
      highlights.push(
        `€${(rankedOffer.offer.price.value).toFixed(2)}`
      );
    }

    // Shipping
    if (rankedOffer.offer.shippingCost.value === 0) {
      highlights.push('Free shipping');
    }

    return highlights;
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(offerCount: number): string {
    if (offerCount === 0) {
      return 'No offers found matching your criteria.';
    }

    if (offerCount === 1) {
      return `Found 1 perfect match for your search.`;
    }

    return `Found ${offerCount} top recommendations ranked by your preferences.`;
  }

  /**
   * Assess data quality across results.
   */
  private assessDataQuality(): ShoppingResults['dataQualityAssessment'] {
    const missingData: string[] = [];
    const conflictingData: string[] = [];

    // Check trails for issues
    for (const [offerId, trail] of this.provenanceTrails) {
      if (trail.warnings && trail.warnings.length > 0) {
        missingData.push(...trail.warnings);
      }
    }

    let confidence: 'high' | 'medium' | 'low' = 'high';
    if (missingData.length > 5) {
      confidence = 'low';
    } else if (missingData.length > 0) {
      confidence = 'medium';
    }

    return {
      overallConfidence: confidence,
      missingData: [...new Set(missingData)],
      conflictingData,
      recommendations: [],
    };
  }

  /**
   * Return empty results when no ranking available.
   */
  private emptyResults(): ShoppingResults {
    return {
      requestId: `results-${Date.now()}`,
      timestamp: new Date(),
      summary: 'No results to display.',
      topRecommendations: [],
      statistics: {
        totalOffersDiscovered: 0,
        offersAfterFiltering: 0,
        offersExamined: 0,
      },
      dataQualityAssessment: {
        overallConfidence: 'low',
        missingData: ['No ranking results available'],
      },
      executionContext: {
        timeoutOccurred: false,
        sourcesQueried: 0,
        cacheHit: false,
      },
    };
  }
}

// ============================================================================
// RESULTS FORMATTER
// ============================================================================

/**
 * Formats results for different output channels.
 */
export class ResultsFormatter {
  /**
   * Format as JSON for API responses.
   */
  static toJSON(results: ShoppingResults): string {
    return JSON.stringify(results, null, 2);
  }

  /**
   * Format as markdown for display.
   */
  static toMarkdown(results: ShoppingResults): string {
    let md = `# Shopping Results\n\n`;
    md += `${results.summary}\n\n`;

    md += `## Top Recommendations\n\n`;
    for (const offer of results.topRecommendations) {
      md += `### ${offer.rankPosition}. ${offer.productName}\n`;
      md += `**${offer.merchantName}** | Score: ${offer.overallScore}/100\n\n`;

      if (offer.highlights.length > 0) {
        md += `**Highlights:** ${offer.highlights.join(', ')}\n\n`;
      }

      if (offer.concerns && offer.concerns.length > 0) {
        md += `**Concerns:** ${offer.concerns.join(', ')}\n\n`;
      }
    }

    md += `\n## Summary\n`;
    md += `- Total offers found: ${results.statistics.totalOffersDiscovered}\n`;
    md += `- Offers examined: ${results.statistics.offersExamined}\n`;
    md += `- Data confidence: ${results.dataQualityAssessment.overallConfidence}\n`;

    return md;
  }

  /**
   * Format as plain text.
   */
  static toText(results: ShoppingResults): string {
    let text = `SHOPPING RESULTS\n`;
    text += `================\n\n`;
    text += `${results.summary}\n\n`;

    for (const offer of results.topRecommendations) {
      text += `${offer.rankPosition}. ${offer.productName}\n`;
      text += `   Merchant: ${offer.merchantName}\n`;
      text += `   Score: ${offer.overallScore}/100\n`;
      if (offer.highlights.length > 0) {
        text += `   Highlights: ${offer.highlights.join(', ')}\n`;
      }
      text += `\n`;
    }

    return text;
  }
}
