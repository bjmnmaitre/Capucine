/**
 * CAPUCINE — Delicity menu fetcher (infrastructure)
 *
 * The fetcher NEVER throws: every network/parse failure is a silent `null`,
 * and the caller treats null as "no verified menu" ('unavailable'). Covers:
 * - slug extraction from a restaurant URL (host label, www. stripped, path ok)
 * - API-first parsing (assumed public schema, guarded)
 * - closed → isOpen/reopensAt preserved; fetched URL is the hand-over URL
 * - allow-path parsing: a malformed item is SKIPPED, the menu survives
 * - HTML / JSON-LD fallback (Menu node, Restaurant > hasMenu)
 * - all failures → null
 */

import {
  DelicityMenuFetcher,
  extractSlug,
  merchantIdFor,
  DELICITY_API_BASE,
} from '../../src/infrastructure/delicity-menu-fetcher';
import { deriveMerchantAvailability } from '../../src/domain/merchant-types';

const RESTAURANT_URL = 'https://proteineeatbonnefoy.com/order';
const API_URL = `${DELICITY_API_BASE}/proteineeatbonnefoy`;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function fetcherReturning(responses: Map<string, Response>): typeof fetch {
  const impl: FetchLike = async (input) => {
    const url = String(input);
    const response = responses.get(url);
    return response ?? new Response('not found', { status: 404 });
  };
  return impl as typeof fetch;
}

const API_RESTAURANT_JSON = JSON.stringify({
  slug: 'proteineeatbonnefoy',
  name: 'Protéïne Eat',
  address: '7 Rue du Faubourg Bonnefoy, 31500 Toulouse',
  isOpen: false,
  reopensAt: '2026-10-05',
  takeaway: true,
  delivery: true,
  categories: [
    {
      name: 'POKE BOWL',
      items: [
        { name: 'Poké Bowl Saumon', description: 'Saumon mariné', price: 14.5, available: true },
        { name: 'Poké Bowl Végétarien', price: 12 },
      ],
    },
  ],
});

const JSONLD_MENU_HTML = `
<!doctype html><html><head>
<script type="application/ld+json">
{"@type":"Menu","name":"Carte Protéïne Eat","hasMenuSection":[
  {"name":"POKE BOWL","hasMenuItem":[
    {"name":"Poké Bowl Saumon","description":"Saumon mariné","offers":{"@type":"Offer","price":14.5}},
    {"name":"Non chiffré","offers":{"@type":"Offer","price":"14,5"}}
  ]}
]}
</script>
</head><body></body></html>`;

describe('extractSlug', () => {
  it('takes the hostname label whatever the path', () => {
    expect(extractSlug('https://proteineeatbonnefoy.com/order')).toBe('proteineeatbonnefoy');
  });

  it('strips www.', () => {
    expect(extractSlug('https://www.proteineeatbonnefoy.com/order')).toBe('proteineeatbonnefoy');
  });

  it('returns null for an unparseable URL — never a guessed slug', () => {
    expect(extractSlug('not-a-url')).toBeNull();
  });

  it('builds the canonical merchant id from the slug', () => {
    expect(merchantIdFor('proteineeatbonnefoy')).toBe('delicity:proteineeatbonnefoy');
  });
});

describe('DelicityMenuFetcher', () => {
  it('parses the API payload and keeps the fetched URL as the hand-over URL', async () => {
    const responses = new Map<string, Response>([
      [API_URL, new Response(API_RESTAURANT_JSON, { status: 200, headers: { 'content-type': 'application/json' } })],
    ]);
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(responses) });

    const menu = await fetcher.fetchMenu(RESTAURANT_URL);

    expect(menu).not.toBeNull();
    expect(menu!.merchantId).toBe('delicity:proteineeatbonnefoy');
    expect(menu!.restaurantName).toBe('Protéïne Eat');
    expect(menu!.restaurantPageUrl).toBe(RESTAURANT_URL);
    expect(menu!.currency).toBe('EUR');
    expect(menu!.address).toContain('Toulouse');
    expect(menu!.categories).toHaveLength(1);
    expect(menu!.categories[0].items).toHaveLength(2);
    expect(menu!.categories[0].items[0].id).toBe('proteineeatbonnefoy-cat-0-item-0');
    expect(menu!.categories[0].items[0].price).toBe(14.5);
  });

  it('preserves the closed state and the scheduled reopening date', async () => {
    const responses = new Map<string, Response>([
      [API_URL, new Response(API_RESTAURANT_JSON, { status: 200 })],
    ]);
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(responses) });

    const menu = (await fetcher.fetchMenu(RESTAURANT_URL))!;
    expect(menu.isOpen).toBe(false);
    expect(menu.reopensAt).toBe('2026-10-05');
    expect(deriveMerchantAvailability(menu)).toBe('closed_reopens_on');
  });

  it('skips a malformed item (missing price) instead of killing the menu', async () => {
    const json = JSON.stringify({
      name: 'Protéïne Eat',
      categories: [
        {
          name: 'BOWLS',
          items: [
            { name: 'Bon', price: 10 },
            { name: 'Prix manquant' },
            { name: 'Prix invalide', price: '14,5' },
          ],
        },
      ],
    });
    const responses = new Map<string, Response>([[API_URL, new Response(json, { status: 200 })]]);
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(responses) });

    const menu = (await fetcher.fetchMenu(RESTAURANT_URL))!;
    expect(menu.categories[0].items.map((i) => i.name)).toEqual(['Bon']);
  });

  it('falls back to HTML JSON-LD when the API answers 500', async () => {
    const responses = new Map<string, Response>([
      [API_URL, new Response('oops', { status: 500 })],
      [RESTAURANT_URL, new Response(JSONLD_MENU_HTML, { status: 200 })],
    ]);
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(responses) });

    const menu = await fetcher.fetchMenu(RESTAURANT_URL);

    expect(menu).not.toBeNull();
    expect(menu!.restaurantName).toBe('Carte Protéïne Eat');
    expect(menu!.categories[0].name).toBe('POKE BOWL');
    expect(menu!.categories[0].items[0]).toMatchObject({ name: 'Poké Bowl Saumon', price: 14.5 });
  });

  it('returns null when the network throws — it NEVER throws itself', async () => {
    const impl: FetchLike = async () => {
      throw new Error('réseau injoignable');
    };
    const fetcher = new DelicityMenuFetcher({ fetchImpl: impl as typeof fetch });

    await expect(fetcher.fetchMenu(RESTAURANT_URL)).resolves.toBeNull();
  });

  it('returns null on an invalid order URL', async () => {
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(new Map()) });
    await expect(fetcher.fetchMenu('pas-une-url')).resolves.toBeNull();
  });

  it('returns null on unparseable API JSON', async () => {
    const responses = new Map<string, Response>([[API_URL, new Response('{pas du json', { status: 200 })]]);
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(responses) });
    await expect(fetcher.fetchMenu(RESTAURANT_URL)).resolves.toBeNull();
  });

  it('returns null on HTML without any JSON-LD menu', async () => {
    const responses = new Map<string, Response>([
      [API_URL, new Response('nope', { status: 404 })],
      [RESTAURANT_URL, new Response('<html><body>Bienvenue</body></html>', { status: 200 })],
    ]);
    const fetcher = new DelicityMenuFetcher({ fetchImpl: fetcherReturning(responses) });
    await expect(fetcher.fetchMenu(RESTAURANT_URL)).resolves.toBeNull();
  });
});