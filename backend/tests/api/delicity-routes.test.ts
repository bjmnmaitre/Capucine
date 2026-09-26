/**
 * CAPUCINE — Delicity HTTP routes
 *
 * End-to-end tests over the real Express app (supertest + buildApp), same
 * pattern as http-integration.test.ts. The menu route is exercised with a
 * stubbed DelicityMenuFetcher (prototype spy — the route still constructs one
 * fetcher per request, but no network ever happens). The cart route is pure:
 * the menu comes from the request body, exactly as the API contract says.
 */

import { buildApp } from '../../src/api/server';
import { DelicityMenuFetcher } from '../../src/infrastructure/delicity-menu-fetcher';
import { MerchantMenu } from '../../src/domain/merchant-types';
import type { Application } from 'express';

const RESTAURANT_URL = 'https://proteineeatbonnefoy.com/order';

const MENU_FIXTURE: MerchantMenu = {
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
  lastUpdatedAt: new Date().toISOString(),
};

const CLOSED_MENU_FIXTURE: MerchantMenu = {
  ...MENU_FIXTURE,
  isOpen: false,
  reopensAt: '2026-10-05',
};

// ============================================================================
// SUPERTEST HELPERS (same dynamic-import pattern as the HTTP integration file)
// ============================================================================

let app: Application;

beforeAll(() => {
  app = buildApp();
});

async function postMenu(body: object) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/merchant/delicity/menu').send(body).set('Content-Type', 'application/json');
}

async function postCart(body: object) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/merchant/delicity/cart').send(body).set('Content-Type', 'application/json');
}

// ============================================================================
// FETCHER STUB — the route constructs `new DelicityMenuFetcher()` per request
// (no singleton). Stubbing the shared prototype method keeps that contract
// while guaranteeing zero network. Reset to the happy-path fixture each test.
// ============================================================================

const fetchMenuSpy = jest.spyOn(DelicityMenuFetcher.prototype, 'fetchMenu');

beforeEach(() => {
  fetchMenuSpy.mockReset().mockResolvedValue(MENU_FIXTURE);
});

// ============================================================================
// POST /merchant/delicity/menu
// ============================================================================

describe('POST /merchant/delicity/menu', () => {
  test('returns 400 when restaurantUrl is missing', async () => {
    const res = await postMenu({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('MISSING_RESTAURANT_URL');
  });

  test('returns 400 when restaurantUrl is not a string', async () => {
    const res = await postMenu({ restaurantUrl: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_RESTAURANT_URL');
  });

  test('returns 422 when the fetcher returns null (menu not fetchable)', async () => {
    fetchMenuSpy.mockResolvedValue(null);
    const res = await postMenu({ restaurantUrl: RESTAURANT_URL });
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('MENU_FETCH_FAILED');
    expect(res.body.restaurantUrl).toBe(RESTAURANT_URL);
  });

  test('returns 200 with the menu object on success', async () => {
    const res = await postMenu({ restaurantUrl: RESTAURANT_URL });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.menu).toBeDefined();
    expect(res.body.menu.restaurantName).toBe('Protéïne Eat');
  });

  test('response menu.merchantId starts with delicity:', async () => {
    const res = await postMenu({ restaurantUrl: RESTAURANT_URL });
    expect(res.status).toBe(200);
    expect(res.body.menu.merchantId).toMatch(/^delicity:/);
  });

  test('response ok: true on success', async () => {
    const res = await postMenu({ restaurantUrl: RESTAURANT_URL });
    expect(res.body.ok).toBe(true);
  });

  test('response ok: false on 422', async () => {
    fetchMenuSpy.mockResolvedValue(null);
    const res = await postMenu({ restaurantUrl: RESTAURANT_URL });
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
  });
});

// ============================================================================
// POST /merchant/delicity/cart
// ============================================================================

function cartBody(over: object = {}): object {
  return {
    restaurantUrl: RESTAURANT_URL,
    menu: MENU_FIXTURE,
    items: [
      { name: 'Poké Bowl Saumon', quantity: 1 },
      { name: 'Jus Détok Vert', quantity: 1 },
    ],
    fulfillmentMode: 'takeaway',
    ...over,
  };
}

describe('POST /merchant/delicity/cart', () => {
  test('returns 400 when restaurantUrl is missing', async () => {
    const res = await postCart({ ...cartBody(), restaurantUrl: undefined });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('MISSING_FIELD');
    expect(res.body.field).toBe('restaurantUrl');
  });

  test('returns 400 when menu is missing', async () => {
    const res = await postCart({ ...cartBody(), menu: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FIELD');
    expect(res.body.field).toBe('menu');
  });

  test('returns 400 when items is missing or not an array', async () => {
    const noItems = await postCart({ ...cartBody(), items: undefined });
    expect(noItems.status).toBe(400);
    expect(noItems.body.field).toBe('items');

    const notArray = await postCart({ ...cartBody(), items: 'nope' });
    expect(notArray.status).toBe(400);
    expect(notArray.body.field).toBe('items');
  });

  test('returns 400 when fulfillmentMode is not a valid value', async () => {
    const res = await postCart({ ...cartBody(), fulfillmentMode: 'teleport' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('INVALID_FULFILLMENT_MODE');
  });

  test('returns 200 with the cart when the merchant is open', async () => {
    const res = await postCart(cartBody());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cart).toBeDefined();
    expect(res.body.cart.items.length).toBe(2);
    expect(res.body.adapter.isOpen).toBe(true);
  });

  test('returns 200 with cart: null and adapter.isOpen: false when the merchant is closed', async () => {
    const res = await postCart(cartBody({ menu: CLOSED_MENU_FIXTURE }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cart).toBeNull();
    expect(res.body.adapter.isOpen).toBe(false);
    expect(res.body.adapter.reopensAt).toBe('2026-10-05');
  });

  test('adapter.requiresMerchantAccount is always true', async () => {
    const open = await postCart(cartBody());
    expect(open.body.adapter.requiresMerchantAccount).toBe(true);
    const closed = await postCart(cartBody({ menu: CLOSED_MENU_FIXTURE }));
    expect(closed.body.adapter.requiresMerchantAccount).toBe(true);
  });

  test('adapter.redirectUrl equals the input restaurantUrl', async () => {
    const res = await postCart(cartBody());
    expect(res.body.adapter.redirectUrl).toBe(RESTAURANT_URL);
  });

  test('cart.totalEstimate matches the sum of matched items', async () => {
    // Saumon 14.5 × 2 + Détok 5 × 1 = 34; an unmatched line contributes 0.
    const res = await postCart(
      cartBody({
        items: [
          { name: 'Poké Bowl Saumon', quantity: 2 },
          { name: 'Jus Détok Vert', quantity: 1 },
          { name: 'Introuvable', quantity: 1 },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(res.body.cart.totalEstimate).toBe(34);
  });

  test('unmatched item names are skipped without error', async () => {
    const res = await postCart(
      cartBody({
        items: [
          { name: 'Poké Bowl Saumon', quantity: 1 },
          { name: 'Burger Inconnu', quantity: 2 },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(res.body.cart.items.map((i: { menuItemName: string }) => i.menuItemName)).toEqual([
      'Poké Bowl Saumon',
    ]);
    expect(res.body.cart.unmatchedLines).toEqual([{ name: 'Burger Inconnu', quantity: 2 }]);
  });

  test('cart.fulfillmentMode matches the input fulfillmentMode', async () => {
    const res = await postCart(cartBody({ fulfillmentMode: 'delivery' }));
    expect(res.status).toBe(200);
    expect(res.body.cart.fulfillmentMode).toBe('delivery');
  });
});