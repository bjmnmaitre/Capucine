/**
 * Capucine — Verification Engine
 *
 * Responsible for verifying the correctness of a checkout session:
 * - Price verification (matches snapshot)
 * - Cart verification (items match)
 * - Promotion verification (still applicable)
 * - Offer verification (still available)
 * - Merchant verification (still capable)
 */
import { CartSnapshot, PriceSnapshot, PromotionSnapshot, OfferSnapshot, MerchantSnapshot, DataPoint } from '../domain/types';
import { VerificationState, VerificationDiscrepancy, VerificationIssue } from '../domain/types';
import { Cart, Offer, Merchant, PromotionApplication } from '../domain/types';

export class VerificationEngine {
  /**
   * Verify a checkout session against its snapshots.
   * @param cartSnapshot The cart snapshot from session creation
   * @param priceSnapshot The price snapshot from session creation
   * @param promotionSnapshot The promotion snapshots from session creation
   * @param offerSnapshot The offer snapshot from session creation
   * @param merchantSnapshot The merchant snapshot from session creation
   * @param currentCart The current cart (optional)
   * @param currentOffer The current offer (optional)
   * @param currentMerchant The current merchant (optional)
   * @returns The verification state (to be merged into the session)
   */
  verifySession(
    cartSnapshot: CartSnapshot,
    priceSnapshot: PriceSnapshot,
    promotionSnapshot: PromotionSnapshot[],
    offerSnapshot: OfferSnapshot,
    merchantSnapshot: MerchantSnapshot,
    currentCart?: Cart,
    currentOffer?: Offer,
    currentMerchant?: Merchant
  ): VerificationState {
    const discrepancies: VerificationDiscrepancy[] = [];
    const blockingIssues: VerificationIssue[] = [];
    const warnings: VerificationIssue[] = [];

    // Price verification
    if (currentOffer) {
      const priceDiscrepancy = this.verifyPrice(
        currentOffer.price.value ?? null,
        priceSnapshot.productPrice
      );
      if (priceDiscrepancy) {
        discrepancies.push(priceDiscrepancy);
        if (priceDiscrepancy.severity === 'blocking') {
          blockingIssues.push({
            type: 'price_changed',
            description: priceDiscrepancy.description,
            detectedAt: new Date()
          });
        } else {
          warnings.push({
            type: 'price_changed',
            description: priceDiscrepancy.description,
            detectedAt: new Date()
          });
        }
      }
    }

    // Cart verification
    if (currentCart) {
      const cartDiscrepancy = this.verifyCart(currentCart, cartSnapshot);
      if (cartDiscrepancy) {
        discrepancies.push(cartDiscrepancy);
        if (cartDiscrepancy.severity === 'blocking') {
          blockingIssues.push({
            type: 'cart_changed',
            description: cartDiscrepancy.description,
            detectedAt: new Date()
          });
        } else {
          warnings.push({
            type: 'cart_changed',
            description: cartDiscrepancy.description,
            detectedAt: new Date()
          });
        }
      }
    }

    // Promotion verification
    if (currentOffer && currentCart) {
      const promotionIssues = this.verifyPromotions(
        currentCart.appliedPromotions || [],
        promotionSnapshot,
        currentOffer
      );
      promotionIssues.forEach(issue => {
        if (issue.severity === 'blocking') {
          blockingIssues.push({
            type: 'promotion_changed',
            description: issue.description,
            detectedAt: new Date()
          });
        } else {
          warnings.push({
            type: 'promotion_changed',
            description: issue.description,
            detectedAt: new Date()
          });
        }
      });
    }

    // Offer verification
    if (currentOffer) {
      const offerIssues = this.verifyOffer(currentOffer, offerSnapshot);
      offerIssues.forEach(issue => {
        if (issue.severity === 'blocking') {
          blockingIssues.push({
            type: 'offer_changed',
            description: issue.description,
            detectedAt: new Date()
          });
        } else {
          warnings.push({
            type: 'offer_changed',
            description: issue.description,
            detectedAt: new Date()
          });
        }
      });
    }

    // Merchant verification
    if (currentMerchant) {
      const merchantIssues = this.verifyMerchant(currentMerchant, merchantSnapshot);
      merchantIssues.forEach(issue => {
        if (issue.severity === 'blocking') {
          blockingIssues.push({
            type: 'merchant_changed',
            description: issue.description,
            detectedAt: new Date()
          });
        } else {
          warnings.push({
            type: 'merchant_changed',
            description: issue.description,
            detectedAt: new Date()
          });
        }
      });
    }

    return {
      verified: blockingIssues.length === 0,
      verifiedAt: new Date(),
      discrepancies,
      blockingIssues,
      warnings,
      version: 1
    };
  }

  /**
   * Check if the price has changed since the snapshot.
   */
  private verifyPrice(currentPrice: number | null, snapshotPrice: number | null): VerificationDiscrepancy | null {
    if (currentPrice === null && snapshotPrice === null) {
      return null;
    }
    if (currentPrice === null || snapshotPrice === null) {
      return {
        type: 'price',
        description: 'Price availability has changed',
        severity: 'blocking',
        expected: snapshotPrice,
        actual: currentPrice
      };
    }
    if (currentPrice !== snapshotPrice) {
      return {
        type: 'price',
        description: `Price has changed from ${snapshotPrice} to ${currentPrice}`,
        severity: 'blocking',
        expected: snapshotPrice,
        actual: currentPrice
      };
    }
    return null;
  }

  /**
   * Verify that the cart matches the snapshot.
   */
  private verifyCart(currentCart: Cart, cartSnapshot: CartSnapshot): VerificationDiscrepancy | null {
    // Check item count
    if (currentCart.items.length !== cartSnapshot.items.length) {
      return {
        type: 'cart',
        description: `Cart item count changed from ${cartSnapshot.items.length} to ${currentCart.items.length}`,
        severity: 'blocking',
        expected: cartSnapshot.items.length,
        actual: currentCart.items.length
      };
    }

    // Check each item
    for (const item of currentCart.items) {
      const snapshotItem = cartSnapshot.items.find(i => i.offerId === item.offerId);
      if (!snapshotItem) {
        return {
          type: 'cart',
          description: `New item added to cart: ${item.offerId}`,
          severity: 'blocking',
          expected: null,
          actual: item.offerId
        };
      }

      if (item.quantity !== snapshotItem.quantity) {
        return {
          type: 'cart',
          description: `Quantity changed for item ${item.offerId} from ${snapshotItem.quantity} to ${item.quantity}`,
          severity: 'blocking',
          expected: snapshotItem.quantity,
          actual: item.quantity
        };
      }

      // Check selected variants
      if (item.selectedVariants && snapshotItem.selectedVariants) {
        const variantKeys = Object.keys(item.selectedVariants);
        for (const key of variantKeys) {
          if (item.selectedVariants[key] !== snapshotItem.selectedVariants[key]) {
            return {
              type: 'cart',
              description: `Variant ${key} changed for item ${item.offerId} from ${snapshotItem.selectedVariants[key]} to ${item.selectedVariants[key]}`,
              severity: 'blocking',
              expected: snapshotItem.selectedVariants[key],
              actual: item.selectedVariants[key]
            };
          }
        }
      } else if ((item.selectedVariants && !snapshotItem.selectedVariants) ||
                 (!item.selectedVariants && snapshotItem.selectedVariants)) {
        return {
          type: 'cart',
          description: `Selected variants presence changed for item ${item.offerId}`,
          severity: 'blocking',
          expected: snapshotItem.selectedVariants ?? null,
          actual: item.selectedVariants ?? null
        };
      }
    }

    return null;
  }

  /**
   * Verify that applied promotions are still valid and applicable.
   */
  private verifyPromotions(
    appliedPromotions: PromotionApplication[],
    promotionSnapshots: PromotionSnapshot[],
    currentOffer: Offer
  ): { description: string; severity: 'warning' | 'blocking' }[] {
    const issues: { description: string; severity: 'warning' | 'blocking' }[] = [];

    for (const appliedPromo of appliedPromotions) {
      // Check if promotion still exists in snapshots
      const snapshotPromo = promotionSnapshots.find(p => p.promotionId === appliedPromo.promotion.id);
      if (!snapshotPromo) {
        issues.push({
          description: `Promotion ${appliedPromo.promotion.code} no longer available`,
          severity: 'blocking'
        });
        continue;
      }

      // Check if promotion is still valid (not expired)
      const now = new Date();
      if (now < appliedPromo.promotion.validFrom || now > appliedPromo.promotion.validUntil) {
        issues.push({
          description: `Promotion ${appliedPromo.promotion.code} has expired`,
          severity: 'blocking'
        });
        continue;
      }

      // Check if promotion is still active
      if (!appliedPromo.promotion.isActive) {
        issues.push({
          description: `Promotion ${appliedPromo.promotion.code} is no longer active`,
          severity: 'blocking'
        });
        continue;
      }

      // Verify the discount calculation still matches
      const expectedDiscount = appliedPromo.originalPrice - appliedPromo.discountedPrice;
      const actualDiscount = appliedPromo.savingsAmount;
      if (Math.abs(expectedDiscount - actualDiscount) > 0.01) {
        issues.push({
          description: `Discount calculation mismatch for promotion ${appliedPromo.promotion.code}`,
          severity: 'warning'
        });
      }
    }

    return issues;
  }

  /**
   * Verify that the offer is still available and unchanged in critical ways.
   */
  private verifyOffer(currentOffer: Offer, offerSnapshot: OfferSnapshot): { description: string; severity: 'warning' | 'blocking' }[] {
    const issues: { description: string; severity: 'warning' | 'blocking' }[] = [];

    // Check if offer is still available
    if (!currentOffer.executionUrl) {
      issues.push({
        description: 'Offer no longer has an execution URL',
        severity: 'blocking'
      });
    }

    // Check if price has changed significantly (using percent change to avoid small fluctuations)
    if (currentOffer.price.value !== null && offerSnapshot.price !== null) {
      const priceChange = Math.abs((currentOffer.price.value - offerSnapshot.price) / (offerSnapshot.price || 1));
      if (priceChange > 0.05) { // More than 5% change
        issues.push({
          description: `Offer price has changed significantly: ${offerSnapshot.price} → ${currentOffer.price.value}`,
          severity: 'blocking'
        });
      }
    }

    // Check availability (offer.availability is a DataPoint<string>, so check its value)
    const availabilityDataPoint = currentOffer.characteristics.availability as DataPoint<string> | undefined;
    if (availabilityDataPoint && availabilityDataPoint.value === null) {
      issues.push({
        description: 'Offer availability is unknown',
        severity: 'warning'
      });
    }

    return issues;
  }

  /**
   * Verify that the merchant still has the required execution capabilities.
   */
  private verifyMerchant(currentMerchant: Merchant, merchantSnapshot: MerchantSnapshot): { description: string; severity: 'warning' | 'blocking' }[] {
    const issues: { description: string; severity: 'warning' | 'blocking' }[] = [];

    // Check if merchant still has the required execution capability
    const requiredCapability = merchantSnapshot.executionCapabilities[0]; // Simplified - take first capability
    if (!currentMerchant.executionCapabilities.includes(requiredCapability)) {
      issues.push({
        description: `Merchant no longer supports execution capability: ${requiredCapability}`,
        severity: 'blocking'
      });
    }

    return issues;
  }
}