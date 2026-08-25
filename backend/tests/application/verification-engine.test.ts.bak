import { VerificationEngine } from '../../src/application/verification-engine';
import { Cart, Offer, Merchant, Promotion, PromotionApplication, CartSnapshot, PriceSnapshot, PromotionSnapshot, OfferSnapshot, MerchantSnapshot } from '../../src/domain/types';

describe('VerificationEngine', () => {
  let verificationEngine: VerificationEngine;

  beforeEach(() => {
    verificationEngine = new VerificationEngine();
  });

  describe('verifySession', () => {
    const baseOffer: Offer = {
      id: 'offer-1',
      productId: 'product-1',
      merchant: {
        id: 'merchant-1',
        name: 'Test Merchant',
        country: 'FR',
        executionCapabilities: ['web_redirect']
      },
      price: { value: 100, status: 'known' },
      currency: 'EUR',
      shippingCost: { value: 10, status: 'known' },
      characteristics: {},
      executionUrl: 'https://merchant.com/checkout',
      createdAt: new Date(),
      retrievedAt: new Date(),
      provenance: { source: 'test', retrievedAt: new Date() }
    };

    const baseCart: Cart = {
      id: 'cart-1',
      items: [{ offerId: 'offer-1', quantity: 1 }],
      appliedPromotions: [],
      userInfo: undefined,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const baseMerchant: Merchant = {
      id: 'merchant-1',
      name: 'Test Merchant',
      country: 'FR',
      executionCapabilities: ['web_redirect']
    };

    const basePromotion: Promotion = {
      id: 'promo-1',
      code: 'TEST10',
      type: 'percentage_discount',
      discountValue: 10,
      discountUnit: 'percent',
      conditions: [],
      validFrom: new Date(Date.now() - 86400000), // yesterday
      validUntil: new Date(Date.now() + 86400000), // tomorrow
      isActive: true,
      source: 'test',
      verificationStatus: 'verified',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const basePromoApplication: PromotionApplication = {
      promotion: basePromotion,
      applicabilityStatus: 'applicable',
      originalPrice: 100,
      discountedPrice: 90,
      savingsAmount: 10,
      savingsPercent: 10,
      reasoning: '10% discount applied'
    };

    it('should return verified true when no discrepancies', () => {
      const cartSnapshot: CartSnapshot = {
        items: baseCart.items,
        quantities: { 'offer-1': 1 },
        selectedVariants: {},
        destinationCountry: undefined,
        capturedAt: new Date()
      };

      const priceSnapshot: PriceSnapshot = {
        productPrice: 100,
        shippingCost: 10,
        tax: 0,
        importDuty: 0,
        customsFees: 0,
        serviceFees: 0,
        promotionSavings: 0,
        totalCost: 110,
        currency: 'EUR',
        confidence: 1,
        source: 'test',
        capturedAt: new Date()
      };

      const promotionSnapshot: PromotionSnapshot[] = [{
        promotionId: basePromotion.id,
        code: basePromotion.code,
        type: basePromotion.type,
        discountValue: basePromotion.discountValue ?? null,
        discountUnit: basePromotion.discountUnit ?? null,
        conditions: basePromotion.conditions,
        savingsAmount: 10,
        savingsPercent: 10,
        verificationStatus: basePromotion.verificationStatus,
        capturedAt: new Date()
      }];

      const offerSnapshot: OfferSnapshot = {
        offerId: baseOffer.id,
        productId: baseOffer.productId,
        merchantId: baseOffer.merchant.id,
        title: baseOffer.merchant.name,
        brand: null,
        model: null,
        condition: null,
        seller: null,
        availability: 'in_stock',
        price: baseOffer.price.value,
        currency: baseOffer.currency ?? 'EUR',
        productUrl: null,
        executionUrl: null,
        capturedAt: new Date()
      };

      const merchantSnapshot: MerchantSnapshot = {
        merchantId: baseMerchant.id,
        name: baseMerchant.name,
        country: baseMerchant.country,
        executionCapabilities: baseMerchant.executionCapabilities,
        capturedAt: new Date()
      };

      const result = verificationEngine.verifySession(
        cartSnapshot,
        priceSnapshot,
        promotionSnapshot,
        offerSnapshot,
        merchantSnapshot,
        baseCart,
        baseOffer,
        baseMerchant
      );

      expect(result.verified).toBe(true);
      expect(result.discrepancies.length).toBe(0);
      expect(result.blockingIssues.length).toBe(0);
    });

    it('should detect price changes', () => {
      const cartSnapshot: CartSnapshot = {
        items: baseCart.items,
        quantities: { 'offer-1': 1 },
        selectedVariants: {},
        destinationCountry: undefined,
        capturedAt: new Date()
      };

      const priceSnapshot: PriceSnapshot = {
        productPrice: 100,
        shippingCost: 10,
        tax: 0,
        importDuty: 0,
        customsFees: 0,
        serviceFees: 0,
        promotionSavings: 0,
        totalCost: 110,
        currency: 'EUR',
        confidence: 1,
        source: 'test',
        capturedAt: new Date()
      };

      const promotionSnapshot: PromotionSnapshot[] = [];

      const offerSnapshot: OfferSnapshot = {
        offerId: baseOffer.id,
        productId: baseOffer.productId,
        merchantId: baseOffer.merchant.id,
        title: baseOffer.merchant.name,
        brand: null,
        model: null,
        condition: null,
        seller: null,
        availability: 'in_stock',
        price: baseOffer.price.value,
        currency: baseOffer.currency ?? 'EUR',
        productUrl: null,
        executionUrl: null,
        capturedAt: new Date()
      };

      const merchantSnapshot: MerchantSnapshot = {
        merchantId: baseMerchant.id,
        name: baseMerchant.name,
        country: baseMerchant.country,
        executionCapabilities: baseMerchant.executionCapabilities,
        capturedAt: new Date()
      };

      // Modify offer price
      const modifiedOffer: Offer = {
        ...baseOffer,
        price: { value: 120, status: 'known' } // Price increased
      };

      const result = verificationEngine.verifySession(
        cartSnapshot,
        priceSnapshot,
        promotionSnapshot,
        offerSnapshot,
        merchantSnapshot,
        baseCart,
        modifiedOffer,
        baseMerchant
      );

      expect(result.verified).toBe(false);
      expect(result.blockingIssues.length).toBe(1);
      expect(result.blockingIssues[0].type).toBe('price_changed');
    });

    it('should detect cart changes', () => {
      const cartSnapshot: CartSnapshot = {
        items: baseCart.items,
        quantities: { 'offer-1': 1 },
        selectedVariants: {},
        destinationCountry: undefined,
        capturedAt: new Date()
      };

      const priceSnapshot: PriceSnapshot = {
        productPrice: 100,
        shippingCost: 10,
        tax: 0,
        importDuty: 0,
        customsFees: 0,
        serviceFees: 0,
        promotionSavings: 0,
        totalCost: 110,
        currency: 'EUR',
        confidence: 1,
        source: 'test',
        capturedAt: new Date()
      };

      const promotionSnapshot: PromotionSnapshot[] = [];

      const offerSnapshot: OfferSnapshot = {
        offerId: baseOffer.id,
        productId: baseOffer.productId,
        merchantId: baseOffer.merchant.id,
        title: baseOffer.merchant.name,
        brand: null,
        model: null,
        condition: null,
        seller: null,
        availability: 'in_stock',
        price: baseOffer.price.value,
        currency: baseOffer.currency ?? 'EUR',
        productUrl: null,
        executionUrl: null,
        capturedAt: new Date()
      };

      const merchantSnapshot: MerchantSnapshot = {
        merchantId: baseMerchant.id,
        name: baseMerchant.name,
        country: baseMerchant.country,
        executionCapabilities: baseMerchant.executionCapabilities,
        capturedAt: new Date()
      };

      // Modify cart quantity
      const modifiedCart: Cart = {
        ...baseCart,
        items: [{ offerId: 'offer-1', quantity: 2 }] // Quantity changed
      };

      const result = verificationEngine.verifySession(
        cartSnapshot,
        priceSnapshot,
        promotionSnapshot,
        offerSnapshot,
        merchantSnapshot,
        modifiedCart,
        baseOffer,
        baseMerchant
      );

      expect(result.verified).toBe(false);
      expect(result.blockingIssues.length).toBe(1);
      expect(result.blockingIssues[0].type).toBe('cart_changed');
    });

    it('should detect promotion changes', () => {
      const cartSnapshot: CartSnapshot = {
        items: baseCart.items,
        quantities: { 'offer-1': 1 },
        selectedVariants: {},
        destinationCountry: undefined,
        capturedAt: new Date()
      };

      const priceSnapshot: PriceSnapshot = {
        productPrice: 100,
        shippingCost: 10,
        tax: 0,
        importDuty: 0,
        customsFees: 0,
        serviceFees: 0,
        promotionSavings: 0,
        totalCost: 110,
        currency: 'EUR',
        confidence: 1,
        source: 'test',
        capturedAt: new Date()
      };

      // Create promotion snapshot with different discount
      const promotionSnapshot: PromotionSnapshot[] = [{
        promotionId: basePromotion.id,
        code: basePromotion.code,
        type: basePromotion.type,
        discountValue: basePromotion.discountValue ?? null,
        discountUnit: basePromotion.discountUnit ?? null,
        conditions: basePromotion.conditions,
        savingsAmount: basePromotion.discountValue !== null ? 5 : 0,
        savingsPercent: 5,
        verificationStatus: basePromotion.verificationStatus,
        capturedAt: new Date()
      }];

      const offerSnapshot: OfferSnapshot = {
        offerId: baseOffer.id,
        productId: baseOffer.productId,
        merchantId: baseOffer.merchant.id,
        title: baseOffer.merchant.name,
        brand: null,
        model: null,
        condition: null,
        seller: null,
        availability: 'in_stock',
        price: baseOffer.price.value,
        currency: baseOffer.currency ?? 'EUR',
        productUrl: null,
        executionUrl: null,
        capturedAt: new Date()
      };

      const merchantSnapshot: MerchantSnapshot = {
        merchantId: baseMerchant.id,
        name: baseMerchant.name,
        country: baseMerchant.country,
        executionCapabilities: baseMerchant.executionCapabilities,
        capturedAt: new Date()
      };

      const result = verificationEngine.verifySession(
        cartSnapshot,
        priceSnapshot,
        promotionSnapshot,
        offerSnapshot,
        merchantSnapshot,
        baseCart,
        baseOffer,
        baseMerchant
      );

      expect(result.verified).toBe(false);
      // Should have blocking issue due to promotion mismatch
      expect(result.blockingIssues.length).toBeGreaterThan(0);
    });

    it('should detect offer unavailability', () => {
      const cartSnapshot: CartSnapshot = {
        items: baseCart.items,
        quantities: { 'offer-1': 1 },
        selectedVariants: {},
        destinationCountry: undefined,
        capturedAt: new Date()
      };

      const priceSnapshot: PriceSnapshot = {
        productPrice: 100,
        shippingCost: 10,
        tax: 0,
        importDuty: 0,
        customsFees: 0,
        serviceFees: 0,
        promotionSavings: 0,
        totalCost: 110,
        currency: 'EUR',
        confidence: 1,
        source: 'test',
        capturedAt: new Date()
      };

      const promotionSnapshot: PromotionSnapshot[] = [];

      const offerSnapshot: OfferSnapshot = {
        offerId: baseOffer.id,
        productId: baseOffer.productId,
        merchantId: baseOffer.merchant.id,
        title: baseOffer.merchant.name,
        brand: null,
        model: null,
        condition: null,
        seller: null,
        availability: 'in_stock',
        price: baseOffer.price.value,
        currency: baseOffer.currency ?? 'EUR',
        productUrl: null,
        executionUrl: null,
        capturedAt: new Date()
      };

      const merchantSnapshot: MerchantSnapshot = {
        merchantId: baseMerchant.id,
        name: baseMerchant.name,
        country: baseMerchant.country,
        executionCapabilities: baseMerchant.executionCapabilities,
        capturedAt: new Date()
      };

      // Modify offer to be unavailable (no executionUrl)
      const modifiedOffer: Offer = {
        ...baseOffer,
        executionUrl: undefined
      };

      const result = verificationEngine.verifySession(
        cartSnapshot,
        priceSnapshot,
        promotionSnapshot,
        offerSnapshot,
        merchantSnapshot,
        baseCart,
        modifiedOffer,
        baseMerchant
      );

      expect(result.verified).toBe(false);
      expect(result.blockingIssues.length).toBe(1);
      expect(result.blockingIssues[0].type).toBe('offer_changed');
    });

    it('should detect merchant capability changes', () => {
      const cartSnapshot: CartSnapshot = {
        items: baseCart.items,
        quantities: { 'offer-1': 1 },
        selectedVariants: {},
        destinationCountry: undefined,
        capturedAt: new Date()
      };

      const priceSnapshot: PriceSnapshot = {
        productPrice: 100,
        shippingCost: 10,
        tax: 0,
        importDuty: 0,
        customsFees: 0,
        serviceFees: 0,
        promotionSavings: 0,
        totalCost: 110,
        currency: 'EUR',
        confidence: 1,
        source: 'test',
        capturedAt: new Date()
      };

      const promotionSnapshot: PromotionSnapshot[] = [];

      const offerSnapshot: OfferSnapshot = {
        offerId: baseOffer.id,
        productId: baseOffer.productId,
        merchantId: baseOffer.merchant.id,
        title: baseOffer.merchant.name,
        brand: null,
        model: null,
        condition: null,
        seller: null,
        availability: 'in_stock',
        price: baseOffer.price.value,
        currency: baseOffer.currency ?? 'EUR',
        productUrl: null,
        executionUrl: null,
        capturedAt: new Date()
      };

      // Merchant snapshot shows web_redirect capability
      const merchantSnapshot: MerchantSnapshot = {
        merchantId: baseMerchant.id,
        name: baseMerchant.name,
        country: baseMerchant.country,
        executionCapabilities: ['web_redirect'],
        capturedAt: new Date()
      };

      // Modify merchant to lose web_redirect capability
      const modifiedMerchant: Merchant = {
        ...baseMerchant,
        executionCapabilities: [] // No capabilities
      };

      const result = verificationEngine.verifySession(
        cartSnapshot,
        priceSnapshot,
        promotionSnapshot,
        offerSnapshot,
        merchantSnapshot,
        baseCart,
        baseOffer,
        modifiedMerchant
      );

      expect(result.verified).toBe(false);
      expect(result.blockingIssues.length).toBe(1);
      expect(result.blockingIssues[0].type).toBe('merchant_changed');
    });
  });
});