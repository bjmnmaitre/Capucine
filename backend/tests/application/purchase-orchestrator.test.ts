/**
 * CAPUCINE — Purchase Orchestrator Tests
 *
 * Tests the purchase orchestrator which coordinates the full purchase flow.
 */

import { PurchaseOrchestrator, PurchaseRequest, PurchaseResult, PurchaseExecutionHandler } from '../../src/application/purchase-orchestrator';
import { createDefaultCartPreparationEngine } from '../../src/application/cart-preparation-engine';
import { Offer, Merchant, ExecutionCapabilityType, CartItem, Cart, UserInfo } from '../../src/domain/types';

// Mock purchase execution handler for testing
class MockPurchaseHandler implements PurchaseExecutionHandler {
  readonly capability: ExecutionCapabilityType = 'web_redirect';
  private shouldFail = false;
  private webhookResults: Map<string, boolean> = new Map();

  canHandle(merchant: Merchant): boolean {
    return merchant.executionCapabilities.includes(this.capability);
  }

  async preparePurchase(request: PurchaseRequest): Promise<PurchaseResult> {
    if (this.shouldFail) {
      throw new Error('Mock handler failure');
    }

    // Build a cart from the request
    const cart: Cart = {
      id: `test-cart-${request.offer.id}-${Date.now()}`,
      items: [{
        offerId: request.offer.id,
        quantity: request.quantity,
        selectedVariants: request.selectedVariants
      }],
      appliedPromotions: request.appliedPromo ? [request.appliedPromo] : [],
      userInfo: request.userInfo,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return {
      status: 'cart_prepared',
      cart,
      checkoutUrl: `https://merchant.example.com/checkout/${request.offer.id}`,
      nextAction: 'Complete payment on merchant site',
      auditEntry: {
        timestamp: new Date(),
        action: 'mock_purchase_prepared',
        result: 'success',
        details: 'Mock purchase prepared successfully'
      },
      isRetry: request.isRetry || false
    };
  }

  async handleWebhook(merchantId: string, payload: Record<string, unknown>): Promise<boolean> {
    return this.webhookResults.get(merchantId) ?? false;
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  setWebhookResult(merchantId: string, result: boolean): void {
    this.webhookResults.set(merchantId, result);
  }
}

describe('PurchaseOrchestrator', () => {
  let orchestrator: PurchaseOrchestrator;
  let mockHandler: MockPurchaseHandler;
  const testMerchant: Merchant = {
    id: 'test-merchant',
    name: 'Test Merchant',
    country: 'FR',
    executionCapabilities: ['web_redirect']
  };
  const testOffer: Offer = {
    id: 'test-offer-1',
    productId: 'test-product-1',
    merchant: testMerchant,
    price: { value: 100, status: 'known' },
    currency: 'EUR',
    shippingCost: { value: null, status: 'unknown' },
    characteristics: {},
    createdAt: new Date(),
    retrievedAt: new Date(),
    executionUrl: 'https://merchant.example.com/product/test-offer-1',
    provenance: { source: 'test', retrievedAt: new Date() }
  };

  beforeEach(() => {
    const cartPreparationEngine = createDefaultCartPreparationEngine();
    orchestrator = new PurchaseOrchestrator(cartPreparationEngine);
    mockHandler = new MockPurchaseHandler();
    orchestrator.registerPurchaseHandler(mockHandler);
  });

  describe('orchestratePurchase', () => {
    it('should successfully orchestrate a purchase', async () => {
      const request: PurchaseRequest = {
        offer: testOffer,
        quantity: 2,
        selectedVariants: { color: 'black', size: 'large' }
      };

      const result: PurchaseResult = await orchestrator.orchestratePurchase(request);

      expect(result.status).toBe('cart_prepared');
      expect(result.cart!!.items.length).toBe(1);
      expect(result.cart!!.items[0].offerId).toBe(testOffer.id);
      expect(result.cart!!.items[0].quantity).toBe(2);
      expect(result.cart!!.items[0].selectedVariants).toEqual({ color: 'black', size: 'large' });
      expect(result.checkoutUrl).toBeDefined();
      expect(result.auditEntry.result).toBe('success');
    });

    it('should handle user info correctly', async () => {
      const userInfo: UserInfo = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        shippingAddress: {
          street: '123 Main St',
          city: 'Paris',
          postalCode: '75001',
          country: 'FR'
        }
      };

      const request: PurchaseRequest = {
        offer: testOffer,
        quantity: 1,
        selectedVariants: {},
        userInfo
      };

      const result: PurchaseResult = await orchestrator.orchestratePurchase(request);

      expect(result.cart!!.userInfo).toEqual(userInfo);
    });

    it('should fail when offer cannot be purchased', async () => {
      // Offer with merchant that has no capabilities
      const invalidOffer: Offer = {
        ...testOffer,
        merchant: {
          ...testMerchant,
          executionCapabilities: [] // No capabilities
        }
      };

      const request: PurchaseRequest = {
        offer: invalidOffer,
        quantity: 1,
        selectedVariants: {}
      };

      const result: PurchaseResult = await orchestrator.orchestratePurchase(request);

      expect(result.status).toBe('failed');
      expect(result.auditEntry.result).toBe('failure');
      expect(result.auditEntry.error).toContain('cannot be purchased');
    });

    it('should handle handler failures gracefully', async () => {
      mockHandler.setShouldFail(true);

      const request: PurchaseRequest = {
        offer: testOffer,
        quantity: 1,
        selectedVariants: {}
      };

      const result: PurchaseResult = await orchestrator.orchestratePurchase(request);

      // Should fall back to basic cart preparation result
      expect(result.auditEntry.result).toBe('failure');
      // Also verify that we have the enhancement failure details
      expect(result.auditEntry.details).toContain('Purchase enhancement failed');
    });

    it('should mark retry attempts correctly', async () => {
      const request: PurchaseRequest = {
        offer: testOffer,
        quantity: 1,
        selectedVariants: {},
        isRetry: true
      };

      const result: PurchaseResult = await orchestrator.orchestratePurchase(request);

      expect(result.isRetry).toBe(true);
    });
  });

  describe('canPurchaseOffer', () => {
    it('should return true when merchant has compatible capabilities', () => {
      const canPurchase = orchestrator.canPurchaseOffer(testOffer);
      expect(canPurchase).toBe(true);
    });

    it('should return false when merchant has no capabilities', () => {
      const invalidOffer: Offer = {
        ...testOffer,
        merchant: {
          ...testMerchant,
          executionCapabilities: []
        }
      };

      const canPurchase = orchestrator.canPurchaseOffer(invalidOffer);
      expect(canPurchase).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    it('should delegate webhook handling to registered handlers', async () => {
      mockHandler.setWebhookResult(testMerchant.id, true);

      const result = await orchestrator.handleWebhook(testMerchant.id, { test: 'data' });

      expect(result).toBe(true);
    });

    it('should return false when no handler can handle webhook', async () => {
      const result = await orchestrator.handleWebhook('unknown-merchant', { test: 'data' });

      expect(result).toBe(false);
    });
  });
});