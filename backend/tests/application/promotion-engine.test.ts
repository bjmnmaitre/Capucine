/**
 * Tests for PromotionEngine
 *
 * Covers promo code discovery, validation, applicability, and discount calculation.
 */

import { PromotionEngine, Promotion, createUnverifiedPromo } from '../../src/application/promotion-engine';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestPromo(overrides: Partial<Promotion> = {}): Promotion {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return {
    id: 'test-promo-1',
    code: 'TESTCODE',
    type: 'percentage_discount',
    discountValue: 10,
    discountUnit: 'percent',
    conditions: [],
    validFrom: yesterday,
    validUntil: tomorrow,
    isActive: true,
    source: 'test',
    verificationStatus: 'verified',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('PromotionEngine', () => {
  describe('registration and lookup', () => {
    it('should register a single promotion', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo();

      engine.registerPromo(promo);

      // No error thrown
      expect(engine).toBeDefined();
    });

    it('should register multiple promotions', () => {
      const engine = new PromotionEngine();
      const promo1 = createTestPromo({ id: 'promo1', code: 'CODE1' });
      const promo2 = createTestPromo({ id: 'promo2', code: 'CODE2' });

      engine.registerPromos([promo1, promo2]);

      expect(engine).toBeDefined();
    });

    it('should initialize with seed promotions', () => {
      const promo = createTestPromo();
      const engine = new PromotionEngine([promo]);

      expect(engine).toBeDefined();
    });

    it('should reject invalid promo (missing code)', () => {
      const engine = new PromotionEngine();
      const invalidPromo = createTestPromo({ code: '' });

      expect(() => engine.registerPromo(invalidPromo)).toThrow();
    });

    it('should reject invalid promo (validUntil before validFrom)', () => {
      const engine = new PromotionEngine();
      const now = new Date();
      const invalidPromo = createTestPromo({
        validFrom: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        validUntil: now,
      });

      expect(() => engine.registerPromo(invalidPromo)).toThrow();
    });
  });

  describe('applicability checking', () => {
    it('should find applicable promos', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({ code: 'SUMMER10' });

      engine.registerPromo(promo);

      const applicable = engine.findApplicablePromos(100);

      expect(applicable).toHaveLength(1);
      expect(applicable[0].promotion.code).toBe('SUMMER10');
    });

    it('should exclude expired promos', () => {
      const engine = new PromotionEngine();
      const twoDaysAgo = new Date(new Date().getTime() - 2 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
      const expiredPromo = createTestPromo({
        validFrom: twoDaysAgo,
        validUntil: yesterday,
      });

      engine.registerPromo(expiredPromo);

      const applicable = engine.findApplicablePromos(100);

      expect(applicable).toHaveLength(0);
    });

    it('should exclude future promos', () => {
      const engine = new PromotionEngine();
      const tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
      const twoDaysFromNow = new Date(new Date().getTime() + 2 * 24 * 60 * 60 * 1000);
      const futurePromo = createTestPromo({
        validFrom: tomorrow,
        validUntil: twoDaysFromNow,
      });

      engine.registerPromo(futurePromo);

      const applicable = engine.findApplicablePromos(100);

      expect(applicable).toHaveLength(0);
    });

    it('should exclude inactive promos', () => {
      const engine = new PromotionEngine();
      const inactivePromo = createTestPromo({ isActive: false });

      engine.registerPromo(inactivePromo);

      const applicable = engine.findApplicablePromos(100);

      expect(applicable).toHaveLength(0);
    });

    it('should check minimum amount conditions', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({
        conditions: [
          {
            type: 'minimum_amount',
            operator: '>=',
            value: 150,
            description: 'Minimum 150€',
          },
        ],
      });

      engine.registerPromo(promo);

      // Below minimum
      expect(engine.findApplicablePromos(100)).toHaveLength(0);

      // At minimum
      expect(engine.findApplicablePromos(150)).toHaveLength(1);

      // Above minimum
      expect(engine.findApplicablePromos(200)).toHaveLength(1);
    });

    it('should check merchant-specific applicability', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({ merchantId: 'amazon' });

      engine.registerPromo(promo);

      // Different merchant
      expect(engine.findApplicablePromos(100, 'fnac')).toHaveLength(0);

      // Same merchant
      expect(engine.findApplicablePromos(100, 'amazon')).toHaveLength(1);
    });

    it('should check category applicability', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({
        applicableToCategories: ['electronics'],
      });

      engine.registerPromo(promo);

      // Wrong category
      expect(engine.findApplicablePromos(100, undefined, undefined, 'books')).toHaveLength(0);

      // Right category
      expect(engine.findApplicablePromos(100, undefined, undefined, 'electronics')).toHaveLength(1);
    });
  });

  describe('discount calculation', () => {
    it('should calculate percentage discount', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({
        type: 'percentage_discount',
        discountValue: 20,
      });

      engine.registerPromo(promo);

      const result = engine.applyBestPromo(100);

      expect(result.bestPromoAvailable).toBeDefined();
      expect(result.bestPromoAvailable!.originalPrice).toBe(100);
      expect(result.bestPromoAvailable!.discountedPrice).toBe(80);
      expect(result.bestPromoAvailable!.savingsAmount).toBe(20);
      expect(result.bestPromoAvailable!.savingsPercent).toBe(20);
    });

    it('should calculate fixed discount', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({
        type: 'fixed_discount',
        discountValue: 15,
      });

      engine.registerPromo(promo);

      const result = engine.applyBestPromo(100);

      expect(result.bestPromoAvailable!.discountedPrice).toBe(85);
      expect(result.bestPromoAvailable!.savingsAmount).toBe(15);
    });

    it('should not discount below zero', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({
        type: 'fixed_discount',
        discountValue: 200, // More than price
      });

      engine.registerPromo(promo);

      const result = engine.applyBestPromo(100);

      expect(result.bestPromoAvailable!.discountedPrice).toBe(0);
    });
  });

  describe('best promo selection', () => {
    it('should select best promo by savings amount', () => {
      const engine = new PromotionEngine();
      const promo1 = createTestPromo({
        id: 'promo1',
        code: 'CODE1',
        type: 'percentage_discount',
        discountValue: 10,
      });
      const promo2 = createTestPromo({
        id: 'promo2',
        code: 'CODE2',
        type: 'percentage_discount',
        discountValue: 20,
      });

      engine.registerPromos([promo1, promo2]);

      const result = engine.applyBestPromo(100);

      expect(result.bestPromoAvailable!.promotion.code).toBe('CODE2');
      expect(result.bestPromoAvailable!.savingsAmount).toBe(20);
    });

    it('should return empty result if no promos apply', () => {
      const engine = new PromotionEngine();
      const expiredPromo = createTestPromo({
        validUntil: new Date(new Date().getTime() - 1000),
      });

      engine.registerPromo(expiredPromo);

      const result = engine.applyBestPromo(100);

      expect(result.bestPromoAvailable).toBeUndefined();
      expect(result.applicablePromos).toHaveLength(0);
      expect(result.totalSavingsPossible).toBe(0);
    });

    it('should list all applicable promos', () => {
      const engine = new PromotionEngine();
      const promo1 = createTestPromo({
        id: 'promo1',
        code: 'CODE1',
        type: 'percentage_discount',
        discountValue: 5,
      });
      const promo2 = createTestPromo({
        id: 'promo2',
        code: 'CODE2',
        type: 'percentage_discount',
        discountValue: 10,
      });

      engine.registerPromos([promo1, promo2]);

      const result = engine.applyBestPromo(100);

      expect(result.applicablePromos).toHaveLength(2);
      // Sorted by savings (descending)
      expect(result.applicablePromos[0].savingsAmount).toBeGreaterThanOrEqual(
        result.applicablePromos[1].savingsAmount
      );
    });
  });

  describe('promo creation helpers', () => {
    it('should create unverified promo from web search', () => {
      const promo = createUnverifiedPromo(
        'SUMMER20',
        'percentage_discount',
        20,
        'web_search',
        new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000)
      );

      expect(promo.code).toBe('SUMMER20');
      expect(promo.verificationStatus).toBe('unverified');
      expect(promo.source).toBe('web_search');
      expect(promo.discountValue).toBe(20);
    });
  });

  describe('edge cases', () => {
    it('should handle promo with no conditions', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({ conditions: [] });

      engine.registerPromo(promo);

      const result = engine.applyBestPromo(100);

      expect(result.bestPromoAvailable).toBeDefined();
    });

    it('should handle multiple conditions (all must pass)', () => {
      const engine = new PromotionEngine();
      const promo = createTestPromo({
        conditions: [
          {
            type: 'minimum_amount',
            operator: '>=',
            value: 100,
          },
          {
            type: 'category',
            operator: '=',
            value: 'electronics',
          },
        ],
      });

      engine.registerPromo(promo);

      // Meets amount but not category
      expect(engine.findApplicablePromos(150, undefined, undefined, 'books')).toHaveLength(0);

      // Meets both
      expect(
        engine.findApplicablePromos(150, undefined, undefined, 'electronics')
      ).toHaveLength(1);
    });

    it('should compute correct total savings when multiple promos apply', () => {
      const engine = new PromotionEngine();
      const promo1 = createTestPromo({
        id: 'p1',
        code: 'CODE1',
        type: 'percentage_discount',
        discountValue: 10,
      });
      const promo2 = createTestPromo({
        id: 'p2',
        code: 'CODE2',
        type: 'fixed_discount',
        discountValue: 5,
      });

      engine.registerPromos([promo1, promo2]);

      const result = engine.applyBestPromo(100);

      // Total possible savings = 10% of 100 + 5 = 15
      expect(result.totalSavingsPossible).toBe(15);
    });
  });
});
