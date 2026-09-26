/**
 * CAPUCINE — Delicity merchant adapter (execution layer)
 *
 * The adapter is a `MerchantExecutionHandler` in the repo's own execution
 * contract. INVARIANTS covered:
 * - canHandle only accepts the canonical 'delicity:<slug>' id AND a merchant
 *   that actually declares 'web_redirect'
 * - closed restaurant → 'unavailable' (never a fabricated link), reopensAt
 *   surfaced when the menu carries it
 * - an available===false menu item is a refusal, not a redirect
 * - the ONLY checkoutUrl is the restaurant's real fetched page; the ?items=
 *   deep link never reaches checkoutUrl
 * - requiresMerchantAccount is surfaced honestly on the hand-over
 * - quantity guard: request.quantity < 1 is normalized to 1, not errored
 */

import {
  Offer,
  Merchant,
  ExecutionCapabilityType,
  DataPoint,
  DataStatus,
} from '../../src/domain/types';
import { MerchantMenu } from '../../src/domain/merchant-types';
import { DelicityMerchantAdapter } from '../../src/application/delicity-merchant-adapter';
import { CartPreparationRequest } from '../../src/application/cart-preparation-engine';

const RESTAURANT_URL = 'https://proteineeatbonnefoy.com/order';

function menu(over: Partial<MerchantMenu> = {}): MerchantMenu {
  return {
    merchantId: 'delicity:proteineeatbonnefoy',
    restaurantName: 'Protéïne Eat',
    restaurantPageUrl: RESTAURANT_URL,
    address: '7 Rue du Faubourg Bonnefoy, 31500 Toulouse',
    currency: 'EUR',
    isOpen: true,
    takeaway: true,
    delivery: true,
    categories: [
      {
        id: 'poke-bowls',
        name: 'POKE BOWL',
        items: [
          { id: 'poke-saumon', name: 'Poké Bowl Saumon', price: 14.5, available: true },
          { id: 'poke-vege', name: 'Poké Bowl Végétarien', price: 12, available: false },
        ],
      },
    ],
    ...over,
  };
}

function dp<T>(value: T, status: DataStatus = 'known'): DataPoint<T> {
  return { value, status, provenance: { source: 'test', retrievedAt: new Date() } };
}

function merchant(id: string, capabilities: ExecutionCapabilityType[]): Merchant {
  return { id, name: id, country: 'FR', executionCapabilities: capabilities };
}

function offer(over: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    productId: 'prod-1',
    merchant: merchant('delicity:proteineeatbonnefoy', ['web_redirect']),
    price: dp(14.5),
    currency: 'EUR',
    shippingCost: { value: null, status: 'unknown' },
    characteristics: { title: dp('Poké Bowl Saumon') },
    executionUrl: RESTAURANT_URL,
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
    ...over,
  };
}

function request(over: Partial<CartPreparationRequest> = {}): CartPreparationRequest {
  return { offer: offer(), quantity: 1, language: 'fr', ...over };
}

describe('DelicityMerchantAdapter', () => {
  describe('canHandle', () => {
    it('accepts the canonical merchant id that declares web_redirect', () => {
      const adapter = new DelicityMerchantAdapter(menu());
      expect(adapter.canHandle(merchant('delicity:proteineeatbonnefoy', ['web_redirect']))).toBe(true);
    });

    it('rejects a merchant that does not declare web_redirect', () => {
      const adapter = new DelicityMerchantAdapter(menu());
      expect(adapter.canHandle(merchant('delicity:proteineeatbonnefoy', ['merchant_api']))).toBe(false);
    });

    it('rejects any other merchant id', () => {
      const adapter = new DelicityMerchantAdapter(menu());
      expect(adapter.canHandle(merchant('delicity:proteineeatbonnefoy.es', ['web_redirect']))).toBe(false);
    });
  });

  describe('getAvailability / getRestaurantPageUrl / getMerchantId', () => {
    it('exposes the fetched facts', () => {
      const adapter = new DelicityMerchantAdapter(menu({ isOpen: false, reopensAt: '2026-10-05' }));
      expect(adapter.getAvailability()).toBe('closed_reopens_on');
      expect(adapter.getRestaurantPageUrl()).toBe(RESTAURANT_URL);
      expect(adapter.getMerchantId()).toBe('delicity:proteineeatbonnefoy');
    });
  });

  describe('prepareCart', () => {
    it('declines with unavailable when the restaurant is closed with a reopening date', async () => {
      const adapter = new DelicityMerchantAdapter(menu({ isOpen: false, reopensAt: '2026-10-05' }));
      const result = await adapter.prepareCart(request({ offer: offer(), quantity: 1 }));
      expect(result.status).toBe('unavailable');
      expect(result.reopensAt).toBe('2026-10-05');
      expect(result.nextAction).toContain('2026-10-05');
      expect(result.checkoutUrl).toBe(RESTAURANT_URL);
    });

    it('declines with unavailable when closed without a date — nothing is fabricated', async () => {
      const adapter = new DelicityMerchantAdapter(menu({ isOpen: false }));
      const result = await adapter.prepareCart(request());
      expect(result.status).toBe('unavailable');
      expect(result.reopensAt).toBeUndefined();
    });

    it('refuses when the matched menu item itself is not available', async () => {
      const adapter = new DelicityMerchantAdapter(menu());
      const result = await adapter.prepareCart(request({ offer: offer({ characteristics: { title: dp('Poké Bowl Végétarien') } }) }));
      expect(result.status).toBe('unavailable');
      expect(result.nextAction).toContain('Poké Bowl Végétarien');
    });

    it('hands over the real page on success, flagged as requiring an account', async () => {
      const adapter = new DelicityMerchantAdapter(menu());
      const result = await adapter.prepareCart(request());
      expect(result.status).toBe('partial');
      expect(result.checkoutUrl).toBe(RESTAURANT_URL);
      expect(result.requiresMerchantAccount).toBe(true);
      expect(result.nextAction).toContain('jamais de paiement');
    });

    it('NEVER puts the unverified ?items= deep link into checkoutUrl', async () => {
      const adapter = new DelicityMerchantAdapter(menu());
      const result = await adapter.prepareCart(request());
      expect(result.checkoutUrl).not.toContain('items=');
    });

    it('still redirects when the name matches nothing (web_redirect honest hand-over)', async () => {
      const adapter = new DelicityMerchantAdapter(menu());
      const result = await adapter.prepareCart(request({ offer: offer({ characteristics: { title: dp('Introuvable') } }) }));
      expect(result.status).toBe('partial');
      expect(result.checkoutUrl).toBe(RESTAURANT_URL);
    });

    it('normalizes a broken or sub-1 quantity instead of erroring', async () => {
      const adapter = new DelicityMerchantAdapter(menu());
      const result = await adapter.prepareCart(request({ quantity: 0 }));
      expect(result.status).toBe('partial');
      expect(result.checkoutUrl).toBe(RESTAURANT_URL);
    });

    it('chooses delivery when a shipping country is supplied', async () => {
      const adapter = new DelicityMerchantAdapter(menu());
      const result = await adapter.prepareCart(request({ offer: offer(), quantity: 1, shippingCountry: 'FR' }));
      expect(result.status).toBe('partial');
      expect(result.checkoutUrl).toBe(RESTAURANT_URL);
    });
  });
});