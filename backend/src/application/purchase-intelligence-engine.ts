/**
 * Capucine — Purchase Intelligence Engine
 *
 * Evaluates offers for actual purchase worthiness, going beyond basic readiness
 * to calculate true cost, trust, and purchase feasibility.
 *
 * This engine answers: "Should we actually recommend this offer for purchase?"
 * considering real costs, risks, and user constraints.
 */

import { Offer, Merchant, PromotionApplication, Promotion, ExecutionCapabilityType } from '../domain/types';
import { assessPurchaseReadiness, OfferReadiness, ReadinessInput } from './purchase-readiness';
import { PromotionEngine } from './promotion-engine';
import { CostEngine } from './cost-engine';

/**
 * Represents the true cost of an offer including all fees and savings.
 */
export interface TrueCost {
  /** Base price of the offer */
  basePrice: number;
  /** Currency of the price */
  currency: string;
  /** Shipping costs */
  shippingCost: number | null;
  /** Tax costs */
  taxCost: number | null;
  /** Import/duty costs */
  importCost: number | null;
  /** Additional fees */
  additionalFees: number;
  /** Total savings from promotions */
  promotionSavings: number;
  /** Final total cost to user */
  finalTotal: number;
  /** Confidence in the cost calculation (0-1) */
  confidence: number;
  /** Timestamp when cost was calculated */
  calculatedAt: Date;
  /** Source of the cost data */
  source: string;
}

/**
 * Represents the trustworthiness of an offer based on data quality and provenance.
 */
export interface OfferTrust {
  /** Overall trust score (0-1) */
  score: number;
  /** Confidence in price data */
  priceConfidence: number;
  /** Confidence in availability data */
  availabilityConfidence: number;
  /** Confidence in seller/merchant data */
  sellerConfidence: number;
  /** Data freshness score (how recent the data is) */
  freshness: number;
  /** Consistency checks across data sources */
  consistency: number;
  /** Known issues or warnings */
  warnings: string[];
  /** Last verification timestamp */
  lastVerified: Date;
}

/**
 * Represents the purchase feasibility of an offer.
 */
export interface PurchaseFeasibility {
  /** Whether the offer can actually be purchased */
  purchasable: boolean;
  /** Execution capability needed */
  requiredCapability: ExecutionCapabilityType | null;
  /** Estimated time to complete purchase */
  estimatedTimeMinutes: number | null;
  /** Known obstacles or requirements */
  requirements: string[];
  /** Alternative options if primary fails */
  alternatives: string[];
  /** Risk assessment */
  riskLevel: 'low' | 'medium' | 'high';
  /** Fallback options available */
  hasFallback: boolean;
}

/**
 * Comprehensive purchase intelligence for an offer.
 */
export interface PurchaseIntelligence {
  /** Unique identifier for this intelligence assessment */
  id: string;
  /** The offer being assessed */
  offer: Offer;
  /** True cost breakdown */
  trueCost: TrueCost;
  /** Trustworthiness assessment */
  trust: OfferTrust;
  /** Purchase feasibility */
  feasibility: PurchaseFeasibility;
  /** Applicable promotions */
  promotions: PromotionApplication[];
  /** Readiness assessment */
  readiness: OfferReadiness;
  /** Overall purchase recommendation score (0-100) */
  recommendationScore: number;
  /** Confidence in the recommendation */
  recommendationConfidence: number;
  /** Plain-language explanation */
  explanation: string;
  /** Warnings or considerations */
  considerations: string[];
  /** Timestamp of assessment */
  assessedAt: Date;
  /** Expires at - after this time, intelligence should be refreshed */
  expiresAt: Date;
}

/**
 * Input parameters for purchase intelligence assessment.
 */
export interface PurchaseIntelligenceInput {
  /** User's desired delivery country for shipping calculations */
  destinationCountry?: string;
  /** Minimum confidence level for price to be considered reliable */
  minimumPriceConfidence?: 'low' | 'medium' | 'high';
  /** Whether to include promotional savings in calculations */
  includePromotions?: boolean;
  /** Maximum acceptable risk level */
  maxRiskLevel?: 'low' | 'medium' | 'high';
  /** User's urgency level affecting time sensitivity */
  urgency?: 'low' | 'medium' | 'high';
}

/**
 * Main purchase intelligence engine that evaluates offers for purchase worthiness.
 */
export class PurchaseIntelligenceEngine {
  private promotionEngine: PromotionEngine;
  private costEngine: CostEngine;

  constructor(
    promotionEngine: PromotionEngine,
    costEngine: CostEngine
  ) {
    this.promotionEngine = promotionEngine;
    this.costEngine = costEngine;
  }

  /**
   * Assess purchase intelligence for a single offer.
   */
  async assessOffer(
    offer: Offer,
    input: PurchaseIntelligenceInput = {}
  ): Promise<PurchaseIntelligence> {
    const assessmentId = `pi-${offer.id}-${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (30 * 60 * 1000)); // 30 minute expiry

    // Set defaults
    const {
      destinationCountry,
      minimumPriceConfidence = 'medium',
      includePromotions = true,
      maxRiskLevel = 'medium',
      urgency = 'medium'
    } = input;

    // 1. Calculate true cost
    const trueCost = await this.calculateTrueCost(offer, {
      destinationCountry,
      includePromotions
    });

    // 2. Assess trustworthiness
    const trust = this.assessTrust(offer);

    // 3. Evaluate feasibility
    const feasibility = this.assessFeasibility(offer);

    // 4. Get promotions (if requested)
    const promotions = includePromotions
      ? await this.getApplicablePromotions(offer)
      : [];

    // 5. Assess readiness
    const readinessInput: ReadinessInput = {
      destinationCountry,
      minimumPriceConfidence
    };
    const readiness = assessPurchaseReadiness(offer, readinessInput);

    // 6. Calculate overall recommendation
    const { recommendationScore, recommendationConfidence, explanation, considerations } =
      this.calculateRecommendation(trueCost, trust, feasibility, promotions, readiness, {
        maxRiskLevel,
        urgency
      });

    return {
      id: assessmentId,
      offer,
      trueCost,
      trust,
      feasibility,
      promotions,
      readiness,
      recommendationScore,
      recommendationConfidence,
      explanation,
      considerations,
      assessedAt: now,
      expiresAt
    };
  }

  /**
   * Calculate the true total cost of an offer including all fees and savings.
   */
  private async calculateTrueCost(
    offer: Offer,
    input: { destinationCountry?: string; includePromotions: boolean }
  ): Promise<TrueCost> {
    const { destinationCountry, includePromotions } = input;

    // Extract base price
    const basePrice = offer.price.value !== null ? offer.price.value : 0;
    const currency = offer.currency ?? 'EUR';

    // Calculate shipping cost
    let shippingCost: number | null = 0;
    if (offer.shippingCost.value !== null) {
      shippingCost = offer.shippingCost.value;
    } else {
      shippingCost = null;
    }

    // Calculate tax cost
    let taxCost: number | null = 0;
    if (offer.taxes && offer.taxes.value !== null) {
      taxCost = offer.taxes.value;
    } else {
      taxCost = null;
    }

    // Calculate import cost
    let importCost: number | null = 0;
    if (offer.importDuties && offer.importDuties.value !== null) {
      importCost = offer.importDuties.value;
    } else {
      importCost = null;
    }

    // Calculate additional fees
    let additionalFees = 0;
    if (offer.fees && offer.fees.value !== null) {
      additionalFees += offer.fees.value;
    }

    // Calculate promotion savings
    let promotionSavings = 0;
    if (includePromotions) {
      const category = offer.characteristics.category ?
        (offer.characteristics.category.value as string) : undefined;
      // Apply promotions to subtotal before promo (base price + shipping + taxes + import duties)
      const shippingValue = shippingCost !== null ? shippingCost : 0;
      const taxValue = taxCost !== null ? taxCost : 0;
      const importValue = importCost !== null ? importCost : 0;
      const promoResult = this.promotionEngine.applyBestPromo(
        basePrice + shippingValue + taxValue + importValue,
        offer.merchant.id,
        offer.productId,
        category
      );
      promotionSavings = promoResult.totalSavingsPossible;
    }

    // Calculate final total
    const shippingValue = shippingCost !== null ? shippingCost : 0;
    const taxValue = taxCost !== null ? taxCost : 0;
    const importValue = importCost !== null ? importCost : 0;
    const subtotal = basePrice + shippingValue + taxValue + importValue + additionalFees;
    const finalTotal = Math.max(0, subtotal - promotionSavings);

    // Calculate confidence based on data availability
    const priceConfidence = offer.price.status === 'known' || offer.price.status === 'verified' ? 0.9 :
                          offer.price.status === 'unknown' ? 0.3 : 0.5;
    const shippingConfidence = offer.shippingCost.status === 'known' || offer.shippingCost.status === 'verified' ? 0.9 :
                              offer.shippingCost.status === 'unknown' ? 0.5 : 0.7;
    const taxConfidence = offer.taxes ? (offer.taxes.status === 'known' || offer.taxes.status === 'verified' ? 0.9 :
                                        offer.taxes.status === 'unknown' ? 0.3 : 0.5) : 0.8; // Assume good if not present

    const confidence = (priceConfidence + shippingConfidence + taxConfidence) / 3;

    return {
      basePrice,
      currency,
      shippingCost,
      taxCost,
      importCost,
      additionalFees,
      promotionSavings,
      finalTotal,
      confidence,
      calculatedAt: new Date(),
      source: offer.provenance?.source ?? 'unknown'
    };
  }

  /**
   * Assess the trustworthiness of an offer based on data quality and provenance.
   */
  private assessTrust(offer: Offer): OfferTrust {
    // Price confidence
    let priceConfidence = 0;
    switch (offer.price.status) {
      case 'verified': priceConfidence = 0.95; break;
      case 'known': priceConfidence = 0.8; break;
      case 'unknown': priceConfidence = 0.2; break;
      case 'contradictory': priceConfidence = 0.1; break;
      case 'unverifiable': priceConfidence = 0.3; break;
    }

    // Availability confidence
    let availabilityConfidence = 0.5; // Default
    const availabilityChars = ['availability', 'stock', 'in_stock'];
    for (const char of availabilityChars) {
      if (offer.characteristics[char]) {
        const dp = offer.characteristics[char];
        if (dp.status === 'verified' || dp.status === 'known') {
          availabilityConfidence = 0.9;
          break;
        } else if (dp.status === 'unknown') {
          availabilityConfidence = 0.3;
          break;
        }
      }
    }

    // Seller/merchant confidence (based on known data)
    let sellerConfidence = 0.7; // Default reasonable trust
    if (offer.merchant.name && offer.merchant.name.length > 0) {
      sellerConfidence += 0.1;
    }
    if (offer.merchant.country && offer.merchant.country.length === 2) {
      sellerConfidence += 0.1;
    }
    if (offer.provenance?.source && offer.provenance.source !== 'unknown') {
      sellerConfidence += 0.1;
    }
    sellerConfidence = Math.min(0.95, sellerConfidence);

    // Data freshness (simplified - in reality would check timestamps)
    const freshness = 0.8; // Assume reasonably fresh data

    // Consistency check (simplified)
    let consistency = 0.8;
    if (offer.price.status === 'contradictory') {
      consistency = 0.3;
    }

    // Warnings
    const warnings: string[] = [];
    if (offer.price.status === 'unknown') {
      warnings.push('Prix inconnu - impossible de calculer le coût total');
    }
    if (offer.price.status === 'contradictory') {
      warnings.push('Sources discordantes sur le prix');
    }
    if (!offer.executionUrl) {
      warnings.push('aucun lien d\'achat connu');
    }

    // Overall trust score (weighted average)
    const score = (
      priceConfidence * 0.3 +
      availabilityConfidence * 0.25 +
      sellerConfidence * 0.25 +
      freshness * 0.1 +
      consistency * 0.1
    );

    return {
      score: Math.min(0.95, Math.max(0.05, score)),
      priceConfidence,
      availabilityConfidence,
      sellerConfidence,
      freshness,
      consistency,
      warnings,
      lastVerified: offer.provenance?.retrievedAt ?? new Date()
    };
  }

  /**
   * Assess the purchase feasibility of an offer.
   */
  private assessFeasibility(offer: Offer): PurchaseFeasibility {
    // Check if purchasable at all
    const purchasable = !!offer.executionUrl;

    // Determine required capability
    let requiredCapability: ExecutionCapabilityType | null = null;
    if (offer.merchant.executionCapabilities?.length) {
      // Prefer more capable execution methods
      const preferredOrder: ExecutionCapabilityType[] = [
        'ucp',
        'merchant_api',
        'oauth_redirect',
        'web_redirect',
        'browser_automation'
      ];

      for (const cap of preferredOrder) {
        if (offer.merchant.executionCapabilities.includes(cap)) {
          requiredCapability = cap;
          break;
        }
      }
    }

    // Estimate time to complete purchase
    let estimatedTimeMinutes: number | null = null;
    if (requiredCapability) {
      switch (requiredCapability) {
        case 'ucp': estimatedTimeMinutes = 2; break;
        case 'merchant_api': estimatedTimeMinutes = 3; break;
        case 'oauth_redirect': estimatedTimeMinutes = 4; break;
        case 'web_redirect': estimatedTimeMinutes = 5; break;
        case 'browser_automation': estimatedTimeMinutes = 15; break;
      }
    }

    // Requirements
    const requirements: string[] = [];
    if (!offer.executionUrl) {
      requirements.push('Lien d\'achat nécessaire');
    }
    if (!offer.merchant.executionCapabilities?.length) {
      requirements.push('Aucune capacité d\'exécution connue');
    }

    // Alternatives
    const alternatives: string[] = [];
    if (offer.executionUrl) {
      alternatives.push('Achat direct sur le site marchand');
    }

    // Risk assessment
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    const riskFactors = [];
    if (!offer.executionUrl) riskFactors.push('no_url');
    if (offer.price.status === 'unknown' || offer.price.status === 'contradictory') riskFactors.push('price_uncertain');
    if (!offer.merchant.executionCapabilities?.length) riskFactors.push('no_execution');

    if (riskFactors.length >= 2) riskLevel = 'high';
    else if (riskFactors.length === 1) riskLevel = 'medium';

    // Fallback options
    const hasFallback = alternatives.length > 0 || !!offer.executionUrl;

    return {
      purchasable,
      requiredCapability,
      estimatedTimeMinutes,
      requirements,
      alternatives,
      riskLevel,
      hasFallback
    };
  }

  /**
   * Get applicable promotions for an offer.
   */
  private async getApplicablePromotions(offer: Offer): Promise<PromotionApplication[]> {
    // Extract price for promotion checking
    const price = offer.price.value !== null ? offer.price.value : 0;

    // Try to get category from offer characteristics
    const categoryDataPoint = offer.characteristics.category;
    const category = categoryDataPoint && categoryDataPoint.value !== null
      ? (categoryDataPoint.value as string)
      : undefined;

    return this.promotionEngine.findApplicablePromos(
      price,
      offer.merchant.id,
      offer.productId,
      category
    );
  }

  /**
   * Calculate the overall purchase recommendation based on all factors.
   */
  private calculateRecommendation(
    trueCost: TrueCost,
    trust: OfferTrust,
    feasibility: PurchaseFeasibility,
    promotions: PromotionApplication[],
    readiness: OfferReadiness,
    input: { maxRiskLevel: 'low' | 'medium' | 'high'; urgency: 'low' | 'medium' | 'high' }
  ): {
    recommendationScore: number;
    recommendationConfidence: number;
    explanation: string;
    considerations: string[];
  } {
    const { maxRiskLevel, urgency } = input;

    // Convert risk level to numeric score (lower risk = higher score)
    let riskScore = 1.0;
    switch (feasibility.riskLevel) {
      case 'low': riskScore = 1.0; break;
      case 'medium': riskScore = 0.7; break;
      case 'high': riskScore = 0.3; break;
    }

    // Apply risk tolerance
    const riskTolerance: Record<'low' | 'medium' | 'high', number> = {
      low: 0.8,
      medium: 0.5,
      high: 0.2
    };
    const riskAcceptance = riskTolerance[maxRiskLevel];
    const riskFactor = riskScore >= riskAcceptance ? 1.0 : 0.5;

    // Base score from trust and cost feasibility
    let baseScore = trust.score * 0.4; // Trust is important

    // Cost factor - lower final total relative to value is better
    // For now, we'll use a simple heuristic based on confidence and readiness
    const costFactor = readiness.ready ? 0.3 : readiness.pending.length === 0 ? 0.2 : 0.1;
    baseScore += costFactor;

    // Feasibility factor
    const feasibilityFactor = feasibility.purchasable ? 0.2 : 0.0;
    baseScore += feasibilityFactor;

    // Promotion bonus
    const promotionBonus = promotions.length > 0 ? Math.min(0.1, promotions.length * 0.02) : 0;
    baseScore += promotionBonus;

    // Urgency factor - if user is urgent, we might accept lower scores
    const urgencyFactor: Record<'low' | 'medium' | 'high', number> = {
      low: 0.9,
      medium: 0.7,
      high: 0.5
    };
    const urgencyThreshold = urgencyFactor[urgency];

    // Final score adjustment
    let finalScore = baseScore * 100; // Convert to 0-100 scale
    finalScore *= riskFactor;

    // Confidence in recommendation
    const confidenceFactors = [
      trust.score,
      readiness.ready ? 1.0 : 0.5,
      feasibility.purchasable ? 1.0 : 0.0,
      trueCost.confidence
    ];
    const recommendationConfidence =
      confidenceFactors.reduce((sum, val) => sum + val, 0) / confidenceFactors.length;

    // Generate explanation
    const explanationParts = [];

    if (readiness.ready) {
      explanationParts.push("Toutes les vérifications de base sont passées");
    } else if (readiness.blocked.length > 0) {
      explanationParts.push(`Blocants: ${readiness.blocked.join(', ')}`);
    } else {
      explanationParts.push(`Informations manquantes: ${readiness.pending.join(', ')}`);
    }

    if (promotions.length > 0) {
      const bestPromo = promotions[0];
      explanationParts.push(
        `Promotion applicable: ${bestPromo.promotion.code} (-${bestPromo.savingsAmount.toFixed(2)}€)`
      );
    }

    if (!feasibility.purchasable) {
      explanationParts.push("Impossible d'acheter cette offre actuellement");
    } else {
      explanationParts.push(`Achat faisable via ${feasibility.requiredCapability}`);
    }

    explanationParts.push(`Score de confiance: ${(trust.score * 100).toFixed(0)}%`);
    explanationParts.push(`Coût total estimé: ${trueCost.finalTotal.toFixed(2)} ${trueCost.currency}`);

    const explanation = explanationParts.join('. ');

    // Considerations
    const considerations: string[] = [];

    if (trueCost.confidence < 0.7) {
      considerations.push("Confiance moyenne dans le calcul du coût total");
    }

    if (trust.warnings.length > 0) {
      considerations.push(...trust.warnings);
    }

    if (feasibility.requirements.length > 0) {
      considerations.push(...feasibility.requirements);
    }

    if (!readiness.ready && readiness.pending.length > 0) {
      considerations.push(`En attente de: ${readiness.pending.join(', ')}`);
    }

    if (feasibility.riskLevel === 'high') {
      considerations.push("Niveau de risque élevé détecté");
    }

    return {
      recommendationScore: Math.max(0, Math.min(100, finalScore)),
      recommendationConfidence: Math.max(0, Math.min(1, recommendationConfidence)),
      explanation,
      considerations
    };
  }
}

/**
 * Create a default purchase intelligence engine.
 */
export function createDefaultPurchaseIntelligenceEngine(): PurchaseIntelligenceEngine {
  const promotionEngine = /* import and create */ require('./promotion-engine').createDefaultPromotionEngine();
  const costEngine = /* import and create */ require('./cost-engine').createDefaultCostEngine();
  return new PurchaseIntelligenceEngine(promotionEngine, costEngine);
}