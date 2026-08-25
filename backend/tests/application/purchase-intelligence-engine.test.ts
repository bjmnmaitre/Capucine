/**
 * Tests for PurchaseIntelligenceEngine
 *
 * Covers purchase intelligence assessment including cost calculation,
 * trust evaluation, feasibility analysis, and recommendation scoring.
 */

import { PurchaseIntelligenceEngine, createDefaultPurchaseIntelligenceEngine } from '../../src/application/purchase-intelligence-engine';
import { PromotionEngine } from '../../src/application/promotion-engine';
import { CostEngine, CostBreakdown } from '../../src/application/cost-engine';
import { Offer, Merchant, DataPoint, DataProvenance, ExecutionCapabilityType, PromotionApplication, PromotionType, PromotionVerificationStatus } from '../../src/domain/types';

// Mock engines for testing
class MockPromotionEngine extends PromotionEngine {
  findApplicablePromos(_price: number, _merchantId?: string, _productId?: string, _category?: string): PromotionApplication[] {
    return [];
  }

  applyBestPromo(_price: number, _merchantId?: string, _productId?: string, _category?: string): import('../../src/domain/types').PromoSavings {
    return {
      bestPromoAvailable: undefined,
      applicablePromos: [],
      totalSavingsPossible: 0,
      summary: 'No applicable promotions found.',
    };
  }
}

class MockCostEngine implements CostEngine {
  computeCost(_offer: Offer, _context: {} = {}): CostBreakdown {
    // Return a mock CostBreakdown
    return {
      productPrice: { value: 0, status: 'unknown' },
      shipping: { value: null, status: 'unknown' },
      taxes: { value: null, status: 'unknown' },
      importDuties: { value: null, status: 'unknown' },
      fees: { value: null, status: 'unknown' },
      discount: { value: null, status: 'unknown' },
      currency: 'EUR',
      totalKnown: 0,
      certainty: 'unknown',
      unknownComponents: ['productPrice', 'shipping', 'taxes', 'importDuties', 'fees', 'discount'],
      componentStates: {
        productPrice: 'unknown',
        shipping: 'unknown',
        taxes: 'unknown',
        importDuties: 'unknown',
        fees: 'unknown',
        discount: 'unknown'
      },
      containsEstimate: false
    };
  }

  convertBreakdown(_breakdown: any, _targetCurrency: any, _provider: any): any {
    return _breakdown;
  }

  compareCost(_a: any, _b: any): number {
    return 0;
  }
}

function createTestOffer(overrides: Partial<Offer> = {}): Offer {
  const now = new Date();
  const provenance: DataProvenance = {
    source: 'test',
    retrievedAt: now
  };

  const defaultOffer: Offer = {
    id: 'test-offer-1',
    productId: 'test-prod-1',
    merchant: {
      id: 'test-merchant',
      name: 'Test Merchant',
      country: 'FR',
      executionCapabilities: ['web_redirect']
    },
    price: { value: 100, status: 'known', provenance },
    currency: 'EUR',
    shippingCost: { value: 10, status: 'known', provenance },
    characteristics: {
      brand: { value: 'TestBrand', status: 'known', provenance },
      model: { value: 'TestModel', status: 'known', provenance },
      category: { value: 'electronics', status: 'known', provenance }
    },
    executionUrl: 'https://example.com/product',
    createdAt: now,
    retrievedAt: now,
    provenance
  };

  return { ...defaultOffer, ...overrides } as Offer;
}

describe('PurchaseIntelligenceEngine', () => {
  let engine: PurchaseIntelligenceEngine;

  beforeEach(() => {
    const promotionEngine = new MockPromotionEngine();
    const costEngine = new MockCostEngine();
    engine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);
  });

  describe('assessOffer', () => {
    it('should return purchase intelligence for a valid offer', async () => {
      const offer = createTestOffer();
      const input = { destinationCountry: 'FR' };

      const result = await engine.assessOffer(offer, input);

      expect(result).toBeDefined();
      expect(result.id).toContain('pi-');
      expect(result.offer).toBe(offer);
      expect(result.trueCost).toBeDefined();
      expect(result.trust).toBeDefined();
      expect(result.feasibility).toBeDefined();
      expect(result.promotions).toEqual([]); // No promos in mock
      expect(result.readiness).toBeDefined();
      expect(result.recommendationScore).toBeGreaterThanOrEqual(0);
      expect(result.recommendationScore).toBeLessThanOrEqual(100);
      expect(result.recommendationConfidence).toBeGreaterThanOrEqual(0);
      expect(result.recommendationConfidence).toBeLessThanOrEqual(1);
      expect(typeof result.explanation).toBe('string');
      expect(Array.isArray(result.considerations)).toBe(true);
      expect(result.assessedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should handle offers with missing price data', async () => {
      const offer = createTestOffer({
        price: { value: null, status: 'unknown', provenance: { source: 'test', retrievedAt: new Date() } }
      });

      const result = await engine.assessOffer(offer);

      expect(result.readiness.ready).toBe(false);
      expect(result.readiness.blocked).toContain('Prix inconnu');
      // Trust score with unknown price: priceConfidence=0.2, availabilityConfidence=0.5 (default),
      // sellerConfidence=0.9 (has name and country), freshness=0.8, consistency=0.8
      // score = 0.2*0.3 + 0.5*0.25 + 0.9*0.25 + 0.8*0.1 + 0.8*0.1 = 0.06 + 0.125 + 0.225 + 0.08 + 0.08 = 0.57
      expect(result.trust.score).toBeCloseTo(0.57, 0.01);
      expect(result.feasibility.purchasable).toBe(true); // Still has execution URL
    });

    it('should handle offers without execution URL', async () => {
      const offer = createTestOffer({
        executionUrl: undefined
      });

      const result = await engine.assessOffer(offer);

      expect(result.readiness.ready).toBe(false);
      expect(result.readiness.blocked).toContain('aucun lien d\'achat connu');
      expect(result.feasibility.purchasable).toBe(false);
      // When no execution URL, it should still check merchant capabilities
      // Merchant has web_redirect, so requiredCapability should be web_redirect
      expect(result.feasibility.requiredCapability).toBe('web_redirect');
    });

    it('should apply promotions when available', async () => {
      // Create a mock promotion engine that returns a promo
      class PromoReturningPromotionEngine extends PromotionEngine {
        findApplicablePromos(_price: number, _merchantId?: string, _productId?: string, _category?: string): PromotionApplication[] {
          return [{
            promotion: {
              id: 'test-promo-1',
              code: 'TEST10',
              type: 'percentage_discount' as PromotionType,
              discountValue: 10,
              discountUnit: 'percent' as const,
              conditions: [],
              validFrom: new Date(Date.now() - 86400000), // Yesterday
              validUntil: new Date(Date.now() + 86400000), // Tomorrow
              isActive: true,
              source: 'test',
              verificationStatus: 'verified' as PromotionVerificationStatus,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            applicabilityStatus: 'applicable' as const,
            originalPrice: 100,
            discountedPrice: 90,
            savingsAmount: 10,
            savingsPercent: 10,
            reasoning: 'test'
          }];
        }

        applyBestPromo(price: number, _merchantId?: string, _productId?: string, _category?: string): import('../../src/domain/types').PromoSavings {
          const promoApp: PromotionApplication = {
            promotion: {
              id: 'test-promo-1',
              code: 'TEST10',
              type: 'percentage_discount' as PromotionType,
              discountValue: 10,
              discountUnit: 'percent' as const,
              conditions: [],
              validFrom: new Date(Date.now() - 86400000),
              validUntil: new Date(Date.now() + 86400000),
              isActive: true,
              source: 'test',
              verificationStatus: 'verified' as PromotionVerificationStatus,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            applicabilityStatus: 'applicable' as const,
            originalPrice: price,
            discountedPrice: price * 0.9,
            savingsAmount: price * 0.1,
            savingsPercent: 10,
            reasoning: 'TEST10: 10.0% off'
          };

          return {
            bestPromoAvailable: promoApp,
            applicablePromos: [promoApp],
            totalSavingsPossible: price * 0.1,
            summary: `TEST10: Save ${(price * 0.1).toFixed(2)}€ (${10}%)`
          };
        }
      }

      const promoEngine = new PromoReturningPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promoEngine, costEngine);

      const offer = createTestOffer({
        price: { value: 100, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } }
      });

      const result = await testEngine.assessOffer(offer, { includePromotions: true });

      expect(result.promotions.length).toBe(1);
      expect(result.promotions[0].promotion.code).toBe('TEST10');
      expect(result.trueCost.promotionSavings).toBeCloseTo(11, 0.01);
      // Base: 100, Shipping: 10 => Subtotal: 110
      // Promo: 10% of 110 = 11
      // Final: 110 - 11 = 99
      expect(result.trueCost.finalTotal).toBeCloseTo(99, 0.01);
    });
  });

  describe('calculateTrueCost', () => {
    it('should calculate true cost with all components', async () => {
      const offer = createTestOffer({
        price: { value: 100, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } },
        shippingCost: { value: 15, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } },
        taxes: { value: 20, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } },
        importDuties: { value: 5, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } },
        fees: { value: 3, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } }
      });

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      const cost = await (testEngine as any)['calculateTrueCost'](offer, { includePromotions: false });

      expect(cost.basePrice).toBe(100);
      expect(cost.currency).toBe('EUR');
      expect(cost.shippingCost).toBe(15);
      expect(cost.taxCost).toBe(20);
      expect(cost.importCost).toBe(5);
      expect(cost.additionalFees).toBe(3);
      expect(cost.promotionSavings).toBe(0);
      expect(cost.finalTotal).toBeCloseTo(143, 0.01); // 100 + 15 + 20 + 5 + 3
      expect(cost.confidence).toBeCloseTo(0.9, 0.1); // High confidence for known data
    });

    it('should handle optional cost components as undefined', async () => {
      const offer = createTestOffer({
        price: { value: 100, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } },
        shippingCost: { value: null, status: 'unknown', provenance: { source: 'test', retrievedAt: new Date() } },
        taxes: { value: null, status: 'unknown', provenance: { source: 'test', retrievedAt: new Date() } },
        importDuties: { value: null, status: 'unknown', provenance: { source: 'test', retrievedAt: new Date() } },
        fees: { value: null, status: 'unknown', provenance: { source: 'test', retrievedAt: new Date() } }
      });

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      const cost = await (testEngine as any)['calculateTrueCost'](offer, { includePromotions: false });

      expect(cost.basePrice).toBe(100);
      expect(cost.currency).toBe('EUR');
      expect(cost.shippingCost).toBeNull(); // Should be null when undefined
      expect(cost.taxCost).toBeNull();
      expect(cost.importCost).toBeNull();
      expect(cost.additionalFees).toBe(0);
      expect(cost.finalTotal).toBeCloseTo(100, 0.01); // Just base price
    });
  });

  describe('assessTrust', () => {
    it('should calculate trust score based on data quality', () => {
      const offer = createTestOffer({
        price: { value: 100, status: 'verified', provenance: { source: 'test', retrievedAt: new Date() } },
        executionUrl: 'https://example.com/product'
      });

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      const trust = (testEngine as any)['assessTrust'](offer);

      // Verified price: priceConfidence=0.95, availabilityConfidence=0.5 (default),
      // sellerConfidence=0.9 (has name and country), freshness=0.8, consistency=0.8
      // score = 0.95*0.3 + 0.5*0.25 + 0.9*0.25 + 0.8*0.1 + 0.8*0.1 = 0.285 + 0.125 + 0.225 + 0.08 + 0.08 = 0.795
      expect(trust.score).toBeCloseTo(0.795, 0.01);
      expect(trust.priceConfidence).toBe(0.95); // Verified price
      expect(trust.availabilityConfidence).toBe(0.5); // Default (no availability data)
      expect(trust.sellerConfidence).toBeGreaterThan(0.7); // Has merchant info
      expect(trust.warnings.length).toBe(0); // No warnings for good data
    });

    it('should reduce trust for questionable data', () => {
      const offer = createTestOffer({
        price: { value: null, status: 'unknown', provenance: { source: 'test', retrievedAt: new Date() } },
        executionUrl: undefined
      });

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      const trust = (testEngine as any)['assessTrust'](offer);

      // Unknown price: priceConfidence=0.2, availabilityConfidence=0.5 (default),
      // sellerConfidence=0.9 (has name and country), freshness=0.8, consistency=0.8
      // score = 0.2*0.3 + 0.5*0.25 + 0.9*0.25 + 0.8*0.1 + 0.8*0.1 = 0.06 + 0.125 + 0.225 + 0.08 + 0.08 = 0.57
      expect(trust.score).toBeCloseTo(0.57, 0.01);
      expect(trust.priceConfidence).toBe(0.2); // Unknown price
      expect(trust.warnings).toContain('Prix inconnu - impossible de calculer le coût total');
      expect(trust.warnings).toContain('aucun lien d\'achat connu');
    });
  });

  describe('assessFeasibility', () => {
    it('should determine feasibility based on execution capability', () => {
      const offer = createTestOffer({
        executionUrl: 'https://example.com/product',
        merchant: {
          id: 'test-merchant',
          name: 'Test Merchant',
          country: 'FR',
          executionCapabilities: ['web_redirect', 'oauth_redirect']
        }
      });

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      const feasibility = (testEngine as any)['assessFeasibility'](offer);

      expect(feasibility.purchasable).toBe(true);
      // With both web_redirect and oauth_redirect, it should pick oauth_redirect
      // based on the preferred order: ['ucp', 'merchant_api', 'oauth_redirect', 'web_redirect', 'browser_automation']
      expect(feasibility.requiredCapability).toBe('oauth_redirect');
      expect(feasibility.estimatedTimeMinutes).toBe(4); // oauth_redirect = 4 minutes
      expect(feasibility.requirements.length).toBe(0);
      expect(feasibility.hasFallback).toBe(true);
    });

    it('should mark as not purchasable without execution URL', () => {
      const offer = createTestOffer({
        executionUrl: undefined
      });

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      const feasibility = (testEngine as any)['assessFeasibility'](offer);

      expect(feasibility.purchasable).toBe(false);
      // When no execution URL, it should still check merchant capabilities
      // Merchant has web_redirect, so requiredCapability should be web_redirect
      expect(feasibility.requiredCapability).toBe('web_redirect');
      expect(feasibility.requirements).toContain('Lien d\'achat nécessaire');
    });
  });

  describe('calculateRecommendation', () => {
    it('should calculate recommendation score based on all factors', () => {
      const trueCost = {
        basePrice: 100,
        currency: 'EUR',
        shippingCost: 10,
        taxCost: null,
        importCost: null,
        additionalFees: 0,
        promotionSavings: 0,
        finalTotal: 110,
        confidence: 0.9,
        calculatedAt: new Date(),
        source: 'test'
      };

      const trust = {
        score: 0.8,
        priceConfidence: 0.9,
        availabilityConfidence: 0.8,
        sellerConfidence: 0.8,
        freshness: 0.8,
        consistency: 0.8,
        warnings: [],
        lastVerified: new Date()
      };

      const feasibility = {
        purchasable: true,
        requiredCapability: 'web_redirect',
        estimatedTimeMinutes: 5,
        requirements: [],
        alternatives: ['Direct purchase'],
        riskLevel: 'low',
        hasFallback: true
      };

      const promotions: PromotionApplication[] = [];

      const readiness = {
        ready: true,
        pending: [],
        blocked: [],
        confidence: 0.95
      };

      const input = { maxRiskLevel: 'medium', urgency: 'medium' };

      const promotionEngine = new MockPromotionEngine();
      const costEngine = new MockCostEngine();
      const testEngine = new PurchaseIntelligenceEngine(promotionEngine, costEngine);

      // Access private method via type assertion
      // @ts-ignore - accessing private method for testing
      const result = (testEngine as any)['calculateRecommendation'](trueCost, trust, feasibility, promotions, readiness, input);

      expect(result.recommendationScore).toBeGreaterThan(0);
      expect(result.recommendationScore).toBeLessThanOrEqual(100);
      expect(result.recommendationConfidence).toBeGreaterThan(0);
      expect(result.recommendationConfidence).toBeLessThanOrEqual(1);
      expect(typeof result.explanation).toBe('string');
      expect(Array.isArray(result.considerations)).toBe(true);
    });
  });
});