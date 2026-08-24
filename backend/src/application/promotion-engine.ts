/**
 * Capucine — Promotion Engine
 *
 * Manages promotional codes, discounts, and special offers.
 *
 * INVARIANTS:
 * 1. Promos are NOT automatically applied — must be explicitly configured
 * 2. Expired codes are NOT presented as valid
 * 3. Conditions are checked before applying discount
 * 4. Source of promo is always tracked (from web search, merchant API, affiliate, etc.)
 * 5. Verification status is maintained (verified vs unverified)
 * 6. Discount calculation is transparent and auditable
 *
 * Promo Types:
 * - PERCENTAGE: X% off
 * - FIXED: -X€
 * - SHIPPING: Free shipping
 * - COMBINED: Multiple conditions (e.g., -10% + free shipping if >100€)
 */

import { DataPoint, DataStatus, DataProvenance } from '../domain/types';

// ============================================================================
// PROMOTION TYPES
// ============================================================================

import { PromotionType, PromotionVerificationStatus, PromotionCondition, Promotion, PromotionApplication, PromoSavings } from '../domain/types';

// ============================================================================
// PROMOTION ENGINE
// ============================================================================

export class PromotionEngine {
  private promotions: Map<string, Promotion> = new Map();

  constructor(initialPromos?: Promotion[]) {
    if (initialPromos) {
      for (const promo of initialPromos) {
        this.promotions.set(promo.id, promo);
      }
    }
  }

  /**
   * Register a promotion in the engine.
   */
  registerPromo(promo: Promotion): void {
    this.validatePromo(promo);
    this.promotions.set(promo.id, promo);
  }

  /**
   * Register multiple promotions.
   */
  registerPromos(promos: Promotion[]): void {
    for (const promo of promos) {
      this.registerPromo(promo);
    }
  }

  /**
   * Find applicable promotions for a given offer context.
   *
   * @param price - Current price of the offer
   * @param merchantId - ID of the merchant
   * @param productId - ID of the product
   * @param category - Product category
   * @returns Applicable promotions sorted by best savings first
   */
  findApplicablePromos(
    price: number,
    merchantId?: string,
    productId?: string,
    category?: string
  ): PromotionApplication[] {
    const applicable: PromotionApplication[] = [];

    for (const promo of this.promotions.values()) {
      const applic = this.checkPromoApplicability(
        promo,
        price,
        merchantId,
        productId,
        category
      );

      if (applic.applicabilityStatus === 'applicable') {
        applicable.push(applic);
      }
    }

    // Sort by savings amount (descending)
    applicable.sort((a, b) => b.savingsAmount - a.savingsAmount);

    return applicable;
  }

  /**
   * Apply best applicable promo to a price.
   *
   * @returns Savings or null if no promo applies
   */
  applyBestPromo(
    price: number,
    merchantId?: string,
    productId?: string,
    category?: string
  ): PromoSavings {
    const applicablePromos = this.findApplicablePromos(price, merchantId, productId, category);

    if (applicablePromos.length === 0) {
      return {
        bestPromoAvailable: undefined,
        applicablePromos: [],
        totalSavingsPossible: 0,
        summary: 'No applicable promotions found.',
      };
    }

    const best = applicablePromos[0];
    const totalSavings = applicablePromos.reduce((sum, p) => sum + p.savingsAmount, 0);

    return {
      bestPromoAvailable: best,
      applicablePromos,
      totalSavingsPossible: totalSavings,
      summary: `${best.promotion.code}: Save ${best.savingsAmount.toFixed(2)}€ (${best.savingsPercent.toFixed(1)}%)`,
    };
  }

  /**
   * Check if a specific promo applies to the given context.
   */
  private checkPromoApplicability(
    promo: Promotion,
    price: number,
    merchantId?: string,
    productId?: string,
    category?: string
  ): PromotionApplication {
    const now = new Date();

    // Check if expired
    if (now > promo.validUntil) {
      return {
        promotion: promo,
        applicabilityStatus: 'expired',
        originalPrice: price,
        discountedPrice: price,
        savingsAmount: 0,
        savingsPercent: 0,
        reasoning: `Promo code expired on ${promo.validUntil.toISOString()}`,
      };
    }

    // Check if not yet valid
    if (now < promo.validFrom) {
      return {
        promotion: promo,
        applicabilityStatus: 'not_applicable',
        originalPrice: price,
        discountedPrice: price,
        savingsAmount: 0,
        savingsPercent: 0,
        reasoning: `Promo code valid starting ${promo.validFrom.toISOString()}`,
      };
    }

    // Check if active
    if (!promo.isActive) {
      return {
        promotion: promo,
        applicabilityStatus: 'invalid_conditions',
        originalPrice: price,
        discountedPrice: price,
        savingsAmount: 0,
        savingsPercent: 0,
        reasoning: 'Promo code is not active',
      };
    }

    // Check conditions
    const conditionsMet = this.checkConditions(promo, price, merchantId, productId, category);
    if (!conditionsMet.met) {
      return {
        promotion: promo,
        applicabilityStatus: 'not_applicable',
        originalPrice: price,
        discountedPrice: price,
        savingsAmount: 0,
        savingsPercent: 0,
        reasoning: conditionsMet.reason,
      };
    }

    // Calculate discount
    const { discountedPrice, savingsAmount, savingsPercent } = this.calculateDiscount(
      price,
      promo
    );

    return {
      promotion: promo,
      applicabilityStatus: 'applicable',
      originalPrice: price,
      discountedPrice,
      savingsAmount,
      savingsPercent,
      reasoning: `${promo.code}: ${savingsPercent.toFixed(1)}% off`,
    };
  }

  /**
   * Check if all conditions are met.
   */
  private checkConditions(
    promo: Promotion,
    price: number,
    merchantId?: string,
    productId?: string,
    category?: string
  ): { met: boolean; reason: string } {
    for (const condition of promo.conditions) {
      const conditionMet = this.checkCondition(
        condition,
        price,
        merchantId,
        productId,
        category
      );

      if (!conditionMet) {
        return {
          met: false,
          reason: `Condition not met: ${condition.description || condition.type}`,
        };
      }
    }

    // Check merchant applicability
    if (promo.merchantId && promo.merchantId !== merchantId) {
      return {
        met: false,
        reason: `Promo only applies to merchant ${promo.merchantId}`,
      };
    }

    // Check category applicability
    if (promo.applicableToCategories && category && !promo.applicableToCategories.includes(category)) {
      return {
        met: false,
        reason: `Promo does not apply to category ${category}`,
      };
    }

    // Check product applicability
    if (promo.applicableToProducts && productId && !promo.applicableToProducts.includes(productId)) {
      return {
        met: false,
        reason: `Promo does not apply to this product`,
      };
    }

    return { met: true, reason: 'All conditions met' };
  }

  /**
   * Check a single condition.
   */
  private checkCondition(
    condition: PromotionCondition,
    price: number,
    merchantId?: string,
    productId?: string,
    category?: string
  ): boolean {
    switch (condition.type) {
      case 'minimum_amount': {
        const threshold = condition.value as number;
        switch (condition.operator) {
          case '>=':
            return price >= threshold;
          case '>':
            return price > threshold;
          case '=':
            return price === threshold;
          default:
            return false;
        }
      }

      case 'category':
        return category === (condition.value as string);

      case 'quantity':
        // Would need quantity context from cart/order
        return true; // Placeholder

      case 'customer_type':
        // Would need customer context
        return true; // Placeholder

      case 'validity_date': {
        const dateRange = condition.value as { from: Date; to: Date };
        const now = new Date();
        return now >= dateRange.from && now <= dateRange.to;
      }

      default:
        return false;
    }
  }

  /**
   * Calculate discounted price based on promo type.
   */
  private calculateDiscount(
    price: number,
    promo: Promotion
  ): { discountedPrice: number; savingsAmount: number; savingsPercent: number } {
    let savingsAmount = 0;
    let savingsPercent = 0;

    switch (promo.type) {
      case 'percentage_discount': {
        savingsPercent = promo.discountValue ?? 0;
        savingsAmount = (price * savingsPercent) / 100;
        break;
      }

      case 'fixed_discount': {
        savingsAmount = promo.discountValue ?? 0;
        savingsPercent = (savingsAmount / price) * 100;
        break;
      }

      case 'free_shipping': {
        // Handled separately from price
        // Would need shipping cost in context
        savingsAmount = 0;
        savingsPercent = 0;
        break;
      }

      default:
        savingsAmount = 0;
        savingsPercent = 0;
    }

    const discountedPrice = Math.max(0, price - savingsAmount);

    return {
      discountedPrice,
      savingsAmount,
      savingsPercent: Math.min(100, savingsPercent),
    };
  }

  /**
   * Validate promo structure.
   */
  private validatePromo(promo: Promotion): void {
    if (!promo.code || promo.code.trim().length === 0) {
      throw new Error('Promotion code cannot be empty');
    }

    if (promo.validUntil <= promo.validFrom) {
      throw new Error('Promotion validUntil must be after validFrom');
    }

    if (promo.type.includes('discount') && !promo.discountValue) {
      throw new Error(`Promo type ${promo.type} requires discountValue`);
    }
  }
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Create a promotion from web search result.
 * Source status is marked as 'unverified' until manually verified.
 */
export function createUnverifiedPromo(
  code: string,
  type: PromotionType,
  discountValue: number,
  source: string,
  validUntil: Date
): Promotion {
  return {
    id: `unverified-${code}-${Date.now()}`,
    code,
    type,
    discountValue,
    discountUnit: type.includes('percent') ? 'percent' : 'euro',
    conditions: [],
    validFrom: new Date(),
    validUntil,
    isActive: true,
    source,
    verificationStatus: 'unverified',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Create a default promotion engine.
 */
export function createDefaultPromotionEngine(): PromotionEngine {
  return new PromotionEngine();
}
