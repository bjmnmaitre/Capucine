/**
 * CAPUCINE — Delicity merchant domain types
 *
 * Covers the pure helpers around MerchantMenu: the guard-rail validator
 * (allow-path: empty error list IS the happy path) and the availability
 * derivation that the execution adapter depends on.
 */

import {
  MerchantMenu,
  deriveMerchantAvailability,
  validateMerchantMenu,
} from '../../src/domain/merchant-types';

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
        items: [{ id: 'poke-1', name: 'Poké Bowl Saumon', price: 14.5 }],
      },
    ],
    ...over,
  };
}

describe('validateMerchantMenu', () => {
  it('returns an empty list for a well-formed menu (allow-path)', () => {
    expect(validateMerchantMenu(menu())).toEqual([]);
  });

  it('rejects an empty merchantId', () => {
    expect(validateMerchantMenu(menu({ merchantId: '  ' }))).toEqual(
      expect.arrayContaining(['merchantId must not be empty'])
    );
  });

  it('rejects a restaurant without any fulfillment mode', () => {
    expect(validateMerchantMenu(menu({ takeaway: false, delivery: false }))).toEqual(
      expect.arrayContaining(['at least one fulfillment mode (takeaway or delivery) must be available'])
    );
  });

  it('rejects a menu without categories', () => {
    expect(validateMerchantMenu(menu({ categories: [] }))).toEqual(
      expect.arrayContaining(['menu must contain at least one category'])
    );
  });

  it('rejects a category without items', () => {
    expect(
      validateMerchantMenu(
        menu({
          categories: [
            { id: 'c', name: 'BOISSONS', items: [] },
          ],
        })
      )
    ).toEqual(expect.arrayContaining(['category "BOISSONS" has no items']));
  });

  it('rejects an item with a negative or non-finite price, never defaulting to 0', () => {
    const errors = validateMerchantMenu(
      menu({
        categories: [
          {
            id: 'c',
            name: 'BOWLS',
            items: [
              { id: 'neg', name: 'Négatif', price: -1 },
              { id: 'nan', name: 'NaN', price: NaN },
            ],
          },
        ],
      })
    );
    expect(errors).toEqual(
      expect.arrayContaining(['item "Négatif" has an invalid price', 'item "NaN" has an invalid price'])
    );
  });
});

describe('deriveMerchantAvailability', () => {
  it('is open when the menu says so', () => {
    expect(deriveMerchantAvailability(menu())).toBe('open');
  });

  it('is closed_reopens_on when closed with a reopening date', () => {
    const closed = menu({ isOpen: false, reopensAt: '2026-10-05' });
    expect(deriveMerchantAvailability(closed)).toBe('closed_reopens_on');
  });

  it('is closed_unknown when closed without a date — a date is never invented', () => {
    expect(deriveMerchantAvailability(menu({ isOpen: false }))).toBe('closed_unknown');
  });
});