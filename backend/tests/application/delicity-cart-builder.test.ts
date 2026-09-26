/**
 * CAPUCINE — Delicity cart builder
 *
 * The builder translates generic Capucine cart lines (name + quantity) into a
 * Delicity cart. INVARIANTS covered here:
 * - accent-insensitive matching ("poke bowl" → "Poké Bowl")
 * - a no-match line is REPORTED, never silently dropped or guessed
 * - totalEstimate sums only matched lines; quantity multiplies the unit price
 * - fulfillment mode falls back to a supported mode (allow-path), never errors
 * - a broken quantity is 'unmatched' rather than a cart line
 */

import {
  MerchantMenu,
} from '../../src/domain/merchant-types';
import {
  buildDelicityCart,
  buildItemsDeepLink,
  normalizeMenuText,
  resolveFulfillmentMode,
} from '../../src/application/delicity-cart-builder';

function menu(over: Partial<MerchantMenu> = {}): MerchantMenu {
  return {
    merchantId: 'delicity:proteineeatbonnefoy',
    restaurantName: 'Protéïne Eat',
    restaurantPageUrl: 'https://proteineeatbonnefoy.com/order',
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
          { id: 'poke-saumon', name: 'Poké Bowl Saumon', price: 14.5 },
          { id: 'poke-vege', name: 'Poké Bowl Végétarien', price: 12 },
        ],
      },
      {
        id: 'boissons',
        name: 'BOISSONS',
        items: [{ id: 'jus-detox', name: 'Jus Détok Vert', price: 5 }],
      },
    ],
    ...over,
  };
}

describe('normalizeMenuText', () => {
  it('strips accents, case and surrounding whitespace (not punctuation)', () => {
    expect(normalizeMenuText('  Poké Bowl  ')).toBe('poke bowl');
    expect(normalizeMenuText('Dét-ï')).toBe('det-i');
  });
});

describe('buildDelicityCart', () => {
  it('matches lines accent-insensitively and keeps the menu typography', () => {
    const cart = buildDelicityCart([{ name: 'poke bowl saumon', quantity: 1 }], menu(), 'both');
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      menuItemId: 'poke-saumon',
      menuItemName: 'Poké Bowl Saumon',
      quantity: 1,
      unitPrice: 14.5,
    });
    expect(cart.unmatchedLines).toEqual([]);
  });

  it('multiplies the unit price by the quantity', () => {
    const cart = buildDelicityCart([{ name: 'Jus Détok Vert', quantity: 3 }], menu(), 'both');
    expect(cart.totalEstimate).toBe(15);
  });

  it('reports unmatched lines instead of guessing them', () => {
    const cart = buildDelicityCart(
      [
        { name: 'Poké Bowl Saumon', quantity: 1 },
        { name: 'Burger Inconnu', quantity: 2 },
      ],
      menu(),
      'both'
    );
    expect(cart.items).toHaveLength(1);
    expect(cart.unmatchedLines).toEqual([{ name: 'Burger Inconnu', quantity: 2 }]);
    expect(cart.totalEstimate).toBe(14.5);
  });

  it('signale une quantité invalide comme non appariée', () => {
    const cart = buildDelicityCart([{ name: 'Poké Bowl Saumon', quantity: 0 }], menu(), 'both');
    expect(cart.items).toEqual([]);
    expect(cart.unmatchedLines).toEqual([{ name: 'Poké Bowl Saumon', quantity: 0 }]);
    expect(cart.totalEstimate).toBe(0);
  });

  it('a single matched item produces a deep link; no matches keep the plain page', () => {
    const withItem = buildDelicityCart([{ name: 'Poké Bowl Saumon', quantity: 1 }], menu(), 'both');
    expect(withItem.deepLinkUrl).toBe('https://proteineeatbonnefoy.com/order?items=poke-saumon');

    const noItem = buildDelicityCart([{ name: 'Inconnu', quantity: 1 }], menu(), 'both');
    expect(noItem.deepLinkUrl).toBe('https://proteineeatbonnefoy.com/order');
  });

  it('ships the resolved fulfillment mode on the cart', () => {
    const takeawayOnly = menu({ delivery: false });
    const cart = buildDelicityCart([{ name: 'Poké Bowl Saumon', quantity: 1 }], takeawayOnly, 'delivery');
    expect(cart.fulfillmentMode).toBe('takeaway');
  });
});

describe('resolveFulfillmentMode', () => {
  it('keeps a requested mode the restaurant supports', () => {
    expect(resolveFulfillmentMode('delivery', menu())).toBe('delivery');
    expect(resolveFulfillmentMode('both', menu())).toBe('both');
  });

  it('falls back to the supported mode (allow-path, never an error)', () => {
    const takeawayOnly = menu({ delivery: false });
    expect(resolveFulfillmentMode('delivery', takeawayOnly)).toBe('takeaway');

    const deliveryOnly = menu({ takeaway: false });
    expect(resolveFulfillmentMode('takeaway', deliveryOnly)).toBe('delivery');
  });
});

describe('buildItemsDeepLink', () => {
  it('appends encoded ids when items exist', () => {
    expect(buildItemsDeepLink('https://x.com/order', ['a-1', 'b-2'])).toContain('items=a-1%2Cb-2');
  });

  it('returns the plain URL when there is nothing to deep-link', () => {
    expect(buildItemsDeepLink('https://x.com/order', [])).toBe('https://x.com/order');
  });
});