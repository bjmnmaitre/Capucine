/**
 * Capucine — InMemoryDiscoveryStrategy
 *
 * REAL IMPLEMENTATION: A fully searchable in-memory catalog of offers.
 *
 * This is NOT just a mock — it supports:
 * - Keyword matching (title, brand, model, category)
 * - Category filtering
 * - Price range filtering
 * - Merchant filtering
 * - Relevance scoring
 * - Multiple product categories (smartphones, headphones, laptops, books)
 *
 * DETERMINISTIC: Same criteria always return the same offers in the same order.
 * This enables property tests and invariance checks.
 *
 * The catalog is seeded with realistic offers that cover:
 * - Multiple merchants for the same product (price comparison)
 * - Variant products (128GB vs 256GB, different colors)
 * - Products with contradictory data (different sources disagree)
 * - Products with unknown fields (DataStatus: 'unknown')
 * - Products across price ranges (budget to premium)
 */

import { Offer, DataPoint, DataProvenance, Merchant } from '../domain/types';
import { IDiscoveryStrategy, DiscoveryResult, DiscoveryCriteria } from './discovery';

// ============================================================================
// CATALOG ENTRY (internal representation)
// ============================================================================

interface CatalogEntry {
  offer: Offer;
  /** Text corpus for keyword matching */
  searchCorpus: string;
  /** Primary product category */
  category: string;
  /** Tags for secondary matching */
  tags: string[];
}

// ============================================================================
// HELPERS
// ============================================================================

const PROV = (source: string): DataProvenance => ({
  source,
  retrievedAt: new Date('2026-01-15'),
  reliability: source === 'manufacturer' ? 1.0 : source === 'verified_retailer' ? 0.95 : 0.8,
});

function known<T>(value: T, source = 'verified_retailer'): DataPoint<T> {
  return { value, status: 'known', provenance: PROV(source) };
}

function verified<T>(value: T, source = 'manufacturer'): DataPoint<T> {
  return { value, status: 'verified', provenance: PROV(source) };
}

function unknown_dp(): DataPoint<never> {
  return { value: null, status: 'unknown' };
}

function contradictory<T>(values: T[]): DataPoint<T> {
  return {
    value: values[0],
    status: 'contradictory',
    conflictingValues: values,
    provenance: PROV('multiple_sources'),
  };
}

function merchant(
  id: string,
  name: string,
  country: string
): Merchant {
  return { id, name, country, executionCapabilities: ['web_redirect'] };
}

// ============================================================================
// MERCHANTS
// ============================================================================

const MERCHANTS = {
  amazon_fr: merchant('amazon-fr', 'Amazon France', 'FR'),
  fnac: merchant('fnac', 'Fnac', 'FR'),
  darty: merchant('darty', 'Darty', 'FR'),
  boulanger: merchant('boulanger', 'Boulanger', 'FR'),
  ldlc: merchant('ldlc', 'LDLC', 'FR'),
  cdiscount: merchant('cdiscount', 'Cdiscount', 'FR'),
  backmarket: merchant('backmarket', 'Back Market', 'FR'),
  rakuten: merchant('rakuten', 'Rakuten', 'FR'),
  apple_store: merchant('apple-store', 'Apple Store', 'US'),
  samsung_shop: merchant('samsung-shop', 'Samsung Shop', 'KR'),
  sony_shop: merchant('sony-shop', 'Sony Store', 'JP'),
  microsoft_store: merchant('microsoft-store', 'Microsoft Store', 'US'),
  ebay_fr: merchant('ebay-fr', 'eBay France', 'FR'),
  cultura: merchant('cultura', 'Cultura', 'FR'),
  amazon_de: merchant('amazon-de', 'Amazon Germany', 'DE'),
};

const NOW = new Date('2026-01-15');

// ============================================================================
// OFFER FACTORY
// ============================================================================

let offerIdCounter = 0;

function makeOffer(params: {
  productId: string;
  merchant: Merchant;
  price: number | null;
  currency?: string;
  shippingCost?: number;
  characteristics: Record<string, DataPoint<unknown>>;
  currency_str?: string;
}): Offer {
  const id = `offer-${++offerIdCounter}`;
  return {
    id,
    productId: params.productId,
    merchant: params.merchant,
    price: params.price !== null
      ? known(params.price, params.merchant.id)
      : unknown_dp() as DataPoint<number>,
    currency: params.currency ?? 'EUR',
    shippingCost: known(params.shippingCost ?? 0, params.merchant.id),
    characteristics: params.characteristics,
    createdAt: NOW,
    retrievedAt: NOW,
    provenance: PROV(params.merchant.id),
  };
}

// ============================================================================
// THE CATALOG
// ============================================================================

function buildCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  // SMARTPHONES
  // ─────────────────────────────────────────────────────────────────────────

  // iPhone 15 128GB
  const iphone15_128_pid = 'prod-iphone15-128gb';
  const iphone15_128_chars = {
    brand: verified('Apple', 'manufacturer'),
    model: verified('iPhone 15', 'manufacturer'),
    storage: verified('128GB', 'manufacturer'),
    color: known('Noir'),
    ram: verified('6GB', 'manufacturer'),
    os: verified('iOS 17', 'manufacturer'),
    screen_size: verified('6.1', 'manufacturer'),
    battery: verified('3279', 'manufacturer'), // mAh
    weight: verified('171', 'manufacturer'), // grams
    warranty: known('2 ans', 'fnac'),
    ean: verified('0194253705123', 'manufacturer'),
    category: verified('smartphone', 'manufacturer'),
    country_of_origin: known('CN', 'manufacturer'),
    repairability_index: known('6.1', 'repairability.eu'), // /10
  };

  entries.push({
    offer: makeOffer({
      productId: iphone15_128_pid,
      merchant: MERCHANTS.fnac,
      price: 799,
      shippingCost: 0,
      characteristics: iphone15_128_chars,
    }),
    searchCorpus: 'iphone 15 128gb apple smartphone ios noir black',
    category: 'smartphone',
    tags: ['apple', 'iphone', 'ios', '5g'],
  });

  entries.push({
    offer: makeOffer({
      productId: iphone15_128_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 789,
      shippingCost: 0,
      characteristics: iphone15_128_chars,
    }),
    searchCorpus: 'iphone 15 128gb apple smartphone ios',
    category: 'smartphone',
    tags: ['apple', 'iphone', 'ios', '5g'],
  });

  entries.push({
    offer: makeOffer({
      productId: iphone15_128_pid,
      merchant: MERCHANTS.darty,
      price: 819,
      shippingCost: 0,
      characteristics: iphone15_128_chars,
    }),
    searchCorpus: 'iphone 15 128gb apple smartphone ios',
    category: 'smartphone',
    tags: ['apple', 'iphone', 'ios', '5g'],
  });

  // iPhone 15 256GB — DIFFERENT VARIANT
  const iphone15_256_pid = 'prod-iphone15-256gb';
  const iphone15_256_chars = {
    ...iphone15_128_chars,
    storage: verified('256GB', 'manufacturer'),
    ean: verified('0194253705130', 'manufacturer'),
  };

  entries.push({
    offer: makeOffer({
      productId: iphone15_256_pid,
      merchant: MERCHANTS.fnac,
      price: 929,
      shippingCost: 0,
      characteristics: iphone15_256_chars,
    }),
    searchCorpus: 'iphone 15 256gb apple smartphone ios',
    category: 'smartphone',
    tags: ['apple', 'iphone', 'ios', '5g'],
  });

  // iPhone 15 Pro 256GB
  const iphone15pro_256_pid = 'prod-iphone15pro-256gb';
  entries.push({
    offer: makeOffer({
      productId: iphone15pro_256_pid,
      merchant: MERCHANTS.apple_store,
      price: 1229,
      currency: 'EUR',
      shippingCost: 0,
      characteristics: {
        brand: verified('Apple', 'manufacturer'),
        model: verified('iPhone 15 Pro', 'manufacturer'),
        storage: verified('256GB', 'manufacturer'),
        ram: verified('8GB', 'manufacturer'),
        os: verified('iOS 17', 'manufacturer'),
        screen_size: verified('6.1', 'manufacturer'),
        ean: verified('0194253921348', 'manufacturer'),
        category: verified('smartphone', 'manufacturer'),
        repairability_index: known('6.4', 'repairability.eu'),
        country_of_origin: known('CN', 'manufacturer'),
        titanium: verified('true', 'manufacturer'),
      },
    }),
    searchCorpus: 'iphone 15 pro 256gb apple smartphone ios titanium',
    category: 'smartphone',
    tags: ['apple', 'iphone', 'ios', '5g', 'pro'],
  });

  // Samsung Galaxy S24 128GB
  const s24_128_pid = 'prod-samsung-s24-128gb';
  const s24_128_chars = {
    brand: verified('Samsung', 'manufacturer'),
    model: verified('Galaxy S24', 'manufacturer'),
    storage: verified('128GB', 'manufacturer'),
    ram: verified('8GB', 'manufacturer'),
    os: verified('Android 14', 'manufacturer'),
    screen_size: verified('6.2', 'manufacturer'),
    ean: verified('8806095123827', 'manufacturer'),
    category: verified('smartphone', 'manufacturer'),
    country_of_origin: known('KR', 'manufacturer'),
    repairability_index: known('8.0', 'repairability.eu'),
    warranty: known('2 ans', 'samsung-shop'),
  };

  entries.push({
    offer: makeOffer({
      productId: s24_128_pid,
      merchant: MERCHANTS.samsung_shop,
      price: 899,
      shippingCost: 0,
      characteristics: s24_128_chars,
    }),
    searchCorpus: 'samsung galaxy s24 128gb android smartphone',
    category: 'smartphone',
    tags: ['samsung', 'android', '5g', 'galaxy'],
  });

  entries.push({
    offer: makeOffer({
      productId: s24_128_pid,
      merchant: MERCHANTS.boulanger,
      price: 879,
      shippingCost: 0,
      characteristics: s24_128_chars,
    }),
    searchCorpus: 'samsung galaxy s24 128gb android smartphone',
    category: 'smartphone',
    tags: ['samsung', 'android', '5g', 'galaxy'],
  });

  // Fairphone 5 256GB — repairability champion
  const fairphone5_pid = 'prod-fairphone5-256gb';
  entries.push({
    offer: makeOffer({
      productId: fairphone5_pid,
      merchant: MERCHANTS.fnac,
      price: 699,
      shippingCost: 5.99,
      characteristics: {
        brand: verified('Fairphone', 'manufacturer'),
        model: verified('Fairphone 5', 'manufacturer'),
        storage: verified('256GB', 'manufacturer'),
        ram: verified('8GB', 'manufacturer'),
        os: verified('Android 13', 'manufacturer'),
        screen_size: verified('6.46', 'manufacturer'),
        ean: verified('8719689872069', 'manufacturer'),
        category: verified('smartphone', 'manufacturer'),
        country_of_origin: known('EE', 'manufacturer'), // assembled in Tallinn, Estonia (EU)
        repairability_index: verified('9.3', 'repairability.eu'), // très réparable
        warranty: verified('5 ans', 'manufacturer'),
        ethical_score: known('excellent', 'fairphone.com'),
      },
    }),
    searchCorpus: 'fairphone 5 256gb android smartphone réparable durable éthique',
    category: 'smartphone',
    tags: ['fairphone', 'android', 'réparable', 'durable', 'éthique'],
  });

  // Refurbished iPhone 14 — Back Market
  const iphone14_refurb_pid = 'prod-iphone14-128gb-refurb';
  entries.push({
    offer: makeOffer({
      productId: iphone14_refurb_pid,
      merchant: MERCHANTS.backmarket,
      price: 499,
      shippingCost: 0,
      characteristics: {
        brand: known('Apple', 'backmarket'),
        model: known('iPhone 14', 'backmarket'),
        storage: known('128GB', 'backmarket'),
        condition: known('Très bon état', 'backmarket'),
        refurbished: known('true', 'backmarket'),
        os: known('iOS 17', 'backmarket'),
        warranty: known('12 mois', 'backmarket'),
        category: known('smartphone', 'backmarket'),
        repairability_index: known('7.4', 'repairability.eu'),
      },
    }),
    searchCorpus: 'iphone 14 128gb apple reconditionné reconditionnée refurbished',
    category: 'smartphone',
    tags: ['apple', 'iphone', 'reconditionné', 'refurbished'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // HEADPHONES / CASQUES
  // ─────────────────────────────────────────────────────────────────────────

  // Sony WH-1000XM5
  const sony_xm5_pid = 'prod-sony-wh1000xm5';
  const sony_xm5_chars = {
    brand: verified('Sony', 'manufacturer'),
    model: verified('WH-1000XM5', 'manufacturer'),
    type: verified('over-ear', 'manufacturer'),
    anc: verified('true', 'manufacturer'), // active noise cancellation
    bluetooth: verified('5.2', 'manufacturer'),
    battery_life: verified('30', 'manufacturer'), // hours
    weight: verified('250', 'manufacturer'), // grams
    foldable: verified('false', 'manufacturer'),
    ean: verified('4548736132276', 'manufacturer'),
    category: verified('casque', 'manufacturer'),
    color: known('Noir'),
    country_of_origin: known('CN', 'manufacturer'),
    warranty: known('2 ans', 'sony-shop'),
  };

  entries.push({
    offer: makeOffer({
      productId: sony_xm5_pid,
      merchant: MERCHANTS.sony_shop,
      price: 349,
      shippingCost: 0,
      characteristics: sony_xm5_chars,
    }),
    searchCorpus: 'sony wh-1000xm5 casque bluetooth anc noise cancelling over ear',
    category: 'casque',
    tags: ['sony', 'bluetooth', 'anc', 'over-ear'],
  });

  entries.push({
    offer: makeOffer({
      productId: sony_xm5_pid,
      merchant: MERCHANTS.fnac,
      price: 329,
      shippingCost: 0,
      characteristics: sony_xm5_chars,
    }),
    searchCorpus: 'sony wh-1000xm5 casque bluetooth anc noise cancelling',
    category: 'casque',
    tags: ['sony', 'bluetooth', 'anc', 'over-ear'],
  });

  entries.push({
    offer: makeOffer({
      productId: sony_xm5_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 319,
      shippingCost: 0,
      characteristics: sony_xm5_chars,
    }),
    searchCorpus: 'sony wh-1000xm5 casque bluetooth anc noise cancelling',
    category: 'casque',
    tags: ['sony', 'bluetooth', 'anc', 'over-ear'],
  });

  // Sony WH-1000XM5 — Boulanger with CONFLICTING weight (260g vs 250g from manufacturer)
  // This is intentional: Boulanger lists 260g (including cable), Sony official says 250g.
  // Purpose: triggers mergeGroup() CONFLICTING path on the 'weight' field.
  entries.push({
    offer: makeOffer({
      productId: sony_xm5_pid,
      merchant: MERCHANTS.boulanger,
      price: 335,
      shippingCost: 0,
      characteristics: {
        ...sony_xm5_chars,
        // CONFLICTING: Boulanger reports 260g (includes cable pouch), Sony says 250g
        weight: known('260', 'boulanger'),
        // CONFLICTING: Boulanger lists 1 year (local warranty), Sony Shop lists 2 years
        warranty: known('1 an', 'boulanger'),
      },
    }),
    searchCorpus: 'sony wh-1000xm5 casque bluetooth anc noise cancelling boulanger',
    category: 'casque',
    tags: ['sony', 'bluetooth', 'anc', 'over-ear'],
  });

  // Bose QuietComfort 45
  const bose_qc45_pid = 'prod-bose-qc45';
  entries.push({
    offer: makeOffer({
      productId: bose_qc45_pid,
      merchant: MERCHANTS.fnac,
      price: 329,
      shippingCost: 0,
      characteristics: {
        brand: verified('Bose', 'manufacturer'),
        model: verified('QuietComfort 45', 'manufacturer'),
        type: verified('over-ear', 'manufacturer'),
        anc: verified('true', 'manufacturer'),
        bluetooth: verified('5.1', 'manufacturer'),
        battery_life: verified('24', 'manufacturer'),
        weight: verified('238', 'manufacturer'),
        foldable: verified('true', 'manufacturer'),
        ean: verified('017817826150', 'manufacturer'),
        category: verified('casque', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        warranty: known('1 an', 'fnac'),
      },
    }),
    searchCorpus: 'bose quietcomfort 45 qc45 casque bluetooth anc noise cancelling pliable',
    category: 'casque',
    tags: ['bose', 'bluetooth', 'anc', 'over-ear', 'pliable'],
  });

  // Apple AirPods Max
  const airpods_max_pid = 'prod-apple-airpods-max';
  entries.push({
    offer: makeOffer({
      productId: airpods_max_pid,
      merchant: MERCHANTS.apple_store,
      price: 579,
      currency: 'EUR',
      shippingCost: 0,
      characteristics: {
        brand: verified('Apple', 'manufacturer'),
        model: verified('AirPods Max', 'manufacturer'),
        type: verified('over-ear', 'manufacturer'),
        anc: verified('true', 'manufacturer'),
        bluetooth: verified('5.0', 'manufacturer'),
        battery_life: verified('20', 'manufacturer'),
        weight: verified('385', 'manufacturer'),
        foldable: verified('false', 'manufacturer'),
        ean: verified('0194252069400', 'manufacturer'),
        category: verified('casque', 'manufacturer'),
        color: known('Minuit'),
        country_of_origin: known('CN', 'manufacturer'),
      },
    }),
    searchCorpus: 'apple airpods max casque bluetooth anc noise cancelling',
    category: 'casque',
    tags: ['apple', 'bluetooth', 'anc', 'over-ear'],
  });

  // Jabra Evolve2 65 — professional headset
  const jabra_evolve2_pid = 'prod-jabra-evolve2-65';
  entries.push({
    offer: makeOffer({
      productId: jabra_evolve2_pid,
      merchant: MERCHANTS.ldlc,
      price: 249,
      shippingCost: 0,
      characteristics: {
        brand: verified('Jabra', 'manufacturer'),
        model: verified('Evolve2 65', 'manufacturer'),
        type: verified('on-ear', 'manufacturer'),
        anc: verified('true', 'manufacturer'),
        bluetooth: verified('5.0', 'manufacturer'),
        battery_life: verified('37', 'manufacturer'),
        professional_use: verified('true', 'manufacturer'),
        ean: verified('5706991022827', 'manufacturer'),
        category: verified('casque', 'manufacturer'),
        warranty: known('2 ans', 'jabra'),
      },
    }),
    searchCorpus: 'jabra evolve2 65 casque bluetooth professionnel télétravail',
    category: 'casque',
    tags: ['jabra', 'bluetooth', 'anc', 'professionnel'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LAPTOPS / ORDINATEURS PORTABLES
  // ─────────────────────────────────────────────────────────────────────────

  // MacBook Air M2 256GB
  const macbook_air_m2_pid = 'prod-macbook-air-m2-256';
  const macbook_air_m2_chars = {
    brand: verified('Apple', 'manufacturer'),
    model: verified('MacBook Air M2', 'manufacturer'),
    processor: verified('Apple M2', 'manufacturer'),
    ram: verified('8GB', 'manufacturer'),
    storage: verified('256GB', 'manufacturer'),
    screen_size: verified('13.6', 'manufacturer'),
    os: verified('macOS', 'manufacturer'),
    battery_life: verified('18', 'manufacturer'), // hours
    weight: verified('1240', 'manufacturer'), // grams
    ean: verified('0194253638681', 'manufacturer'),
    category: verified('ordinateur_portable', 'manufacturer'),
    country_of_origin: known('CN', 'manufacturer'),
    warranty: known('1 an', 'apple-store'),
    repairability_index: known('3.0', 'repairability.eu'),
  };

  entries.push({
    offer: makeOffer({
      productId: macbook_air_m2_pid,
      merchant: MERCHANTS.apple_store,
      price: 1299,
      currency: 'EUR',
      shippingCost: 0,
      characteristics: macbook_air_m2_chars,
    }),
    searchCorpus: 'macbook air m2 256gb apple ordinateur portable laptop macos',
    category: 'ordinateur_portable',
    tags: ['apple', 'macos', 'arm', 'ultrabook'],
  });

  entries.push({
    offer: makeOffer({
      productId: macbook_air_m2_pid,
      merchant: MERCHANTS.fnac,
      price: 1249,
      shippingCost: 0,
      characteristics: macbook_air_m2_chars,
    }),
    searchCorpus: 'macbook air m2 256gb apple ordinateur portable macos',
    category: 'ordinateur_portable',
    tags: ['apple', 'macos', 'arm', 'ultrabook'],
  });

  // MacBook Air M2 512GB
  const macbook_air_m2_512_pid = 'prod-macbook-air-m2-512';
  entries.push({
    offer: makeOffer({
      productId: macbook_air_m2_512_pid,
      merchant: MERCHANTS.apple_store,
      price: 1529,
      currency: 'EUR',
      shippingCost: 0,
      characteristics: {
        ...macbook_air_m2_chars,
        storage: verified('512GB', 'manufacturer'),
        ean: verified('0194253638698', 'manufacturer'),
      },
    }),
    searchCorpus: 'macbook air m2 512gb apple ordinateur portable laptop macos',
    category: 'ordinateur_portable',
    tags: ['apple', 'macos', 'arm', 'ultrabook'],
  });

  // Dell XPS 13 Plus
  const dell_xps13_pid = 'prod-dell-xps13-plus';
  entries.push({
    offer: makeOffer({
      productId: dell_xps13_pid,
      merchant: MERCHANTS.ldlc,
      price: 1449,
      shippingCost: 0,
      characteristics: {
        brand: verified('Dell', 'manufacturer'),
        model: verified('XPS 13 Plus', 'manufacturer'),
        processor: verified('Intel Core i7-1260P', 'manufacturer'),
        ram: verified('16GB', 'manufacturer'),
        storage: verified('512GB', 'manufacturer'),
        screen_size: verified('13.4', 'manufacturer'),
        os: verified('Windows 11', 'manufacturer'),
        battery_life: known('12', 'ldlc'), // hours — source is retailer
        weight: verified('1240', 'manufacturer'),
        ean: verified('5397184758220', 'manufacturer'),
        category: verified('ordinateur_portable', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        warranty: known('1 an', 'dell'),
        repairability_index: known('5.0', 'repairability.eu'),
      },
    }),
    searchCorpus: 'dell xps 13 plus i7 512gb windows ordinateur portable ultrabook',
    category: 'ordinateur_portable',
    tags: ['dell', 'windows', 'intel', 'ultrabook'],
  });

  // Lenovo ThinkPad X1 Carbon — CONTRADICTORY warranty data
  const thinkpad_x1_pid = 'prod-lenovo-thinkpad-x1-carbon-gen11';
  entries.push({
    offer: makeOffer({
      productId: thinkpad_x1_pid,
      merchant: MERCHANTS.ldlc,
      price: 1699,
      shippingCost: 0,
      characteristics: {
        brand: verified('Lenovo', 'manufacturer'),
        model: verified('ThinkPad X1 Carbon Gen 11', 'manufacturer'),
        processor: verified('Intel Core i7-1365U', 'manufacturer'),
        ram: verified('16GB', 'manufacturer'),
        storage: verified('512GB', 'manufacturer'),
        screen_size: verified('14', 'manufacturer'),
        os: verified('Windows 11 Pro', 'manufacturer'),
        weight: verified('1120', 'manufacturer'),
        ean: verified('0196804272152', 'manufacturer'),
        category: verified('ordinateur_portable', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        // CONTRADICTORY: Lenovo claims 3 years, LDLC lists 1 year
        warranty: contradictory(['3 ans', '1 an']),
        repairability_index: known('7.0', 'repairability.eu'),
        military_grade: verified('true', 'manufacturer'),
      },
    }),
    searchCorpus: 'lenovo thinkpad x1 carbon gen11 i7 512gb windows ordinateur portable professionnel',
    category: 'ordinateur_portable',
    tags: ['lenovo', 'windows', 'intel', 'professionnel', 'business'],
  });

  // Framework Laptop 13 — modular, highly repairable
  const framework_13_pid = 'prod-framework-laptop-13-amd';
  entries.push({
    offer: makeOffer({
      productId: framework_13_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 1049,
      shippingCost: 0,
      characteristics: {
        brand: verified('Framework', 'manufacturer'),
        model: verified('Laptop 13 AMD', 'manufacturer'),
        processor: verified('AMD Ryzen 7 7840U', 'manufacturer'),
        ram: verified('16GB', 'manufacturer'),
        storage: verified('512GB', 'manufacturer'),
        screen_size: verified('13.5', 'manufacturer'),
        os: verified('Windows 11', 'manufacturer'),
        weight: verified('1300', 'manufacturer'),
        ean: verified('0860012471245', 'manufacturer'),
        category: verified('ordinateur_portable', 'manufacturer'),
        repairability_index: verified('10', 'repairability.eu'), // parfaitement réparable
        modular: verified('true', 'manufacturer'),
        warranty: verified('1 an', 'manufacturer'),
        country_of_origin: known('TW', 'manufacturer'),
      },
    }),
    searchCorpus: 'framework laptop 13 amd ryzen 7 modulaire réparable ordinateur portable',
    category: 'ordinateur_portable',
    tags: ['framework', 'windows', 'amd', 'réparable', 'modulaire'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LIVRES / BOOKS
  // ─────────────────────────────────────────────────────────────────────────

  // Le Petit Prince
  const petit_prince_pid = 'prod-petit-prince-gallimard';
  entries.push({
    offer: makeOffer({
      productId: petit_prince_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 7.5,
      shippingCost: 2.99,
      characteristics: {
        author: verified('Antoine de Saint-Exupéry', 'manufacturer'),
        title: verified('Le Petit Prince', 'manufacturer'),
        isbn: verified('9782070612758', 'manufacturer'),
        language: verified('fr', 'manufacturer'),
        pages: verified('96', 'manufacturer'),
        publisher: verified('Gallimard', 'manufacturer'),
        category: verified('livre', 'manufacturer'),
        year: verified('1943', 'manufacturer'),
      },
    }),
    searchCorpus: 'le petit prince antoine de saint-exupéry gallimard livre roman',
    category: 'livre',
    tags: ['classique', 'roman', 'français'],
  });

  entries.push({
    offer: makeOffer({
      productId: petit_prince_pid,
      merchant: MERCHANTS.cultura,
      price: 7.5,
      shippingCost: 0, // free in-store pickup
      characteristics: {
        author: verified('Antoine de Saint-Exupéry', 'manufacturer'),
        title: verified('Le Petit Prince', 'manufacturer'),
        isbn: verified('9782070612758', 'manufacturer'),
        language: verified('fr', 'manufacturer'),
        pages: verified('96', 'manufacturer'),
        publisher: verified('Gallimard', 'manufacturer'),
        category: verified('livre', 'manufacturer'),
        year: verified('1943', 'manufacturer'),
      },
    }),
    searchCorpus: 'le petit prince antoine de saint-exupéry gallimard livre roman',
    category: 'livre',
    tags: ['classique', 'roman', 'français'],
  });

  // L'Étranger - Camus
  const etranger_pid = 'prod-letranger-camus';
  entries.push({
    offer: makeOffer({
      productId: etranger_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 6.9,
      shippingCost: 2.99,
      characteristics: {
        author: verified('Albert Camus', 'manufacturer'),
        title: verified("L'Étranger", 'manufacturer'),
        isbn: verified('9782070360024', 'manufacturer'),
        language: verified('fr', 'manufacturer'),
        pages: verified('186', 'manufacturer'),
        publisher: verified('Gallimard', 'manufacturer'),
        category: verified('livre', 'manufacturer'),
        year: verified('1942', 'manufacturer'),
      },
    }),
    searchCorpus: "l'étranger albert camus gallimard livre roman absurde",
    category: 'livre',
    tags: ['classique', 'roman', 'philosophie'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ASPIRATEURS ROBOTS / ROBOT VACUUMS
  // ─────────────────────────────────────────────────────────────────────────

  // Roomba j7+
  const roomba_j7_pid = 'prod-irobot-roomba-j7plus';
  entries.push({
    offer: makeOffer({
      productId: roomba_j7_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 599,
      shippingCost: 0,
      characteristics: {
        brand: verified('iRobot', 'manufacturer'),
        model: verified('Roomba j7+', 'manufacturer'),
        category: verified('aspirateur_robot', 'manufacturer'),
        ean: verified('0885155028082', 'manufacturer'),
        obstacle_avoidance: verified('true', 'manufacturer'),
        self_emptying: verified('true', 'manufacturer'),
        suction_power: verified('10x', 'manufacturer'),
        battery_life: verified('75', 'manufacturer'), // minutes
        warranty: known('2 ans', 'irobot'),
        country_of_origin: known('CN', 'manufacturer'),
      },
    }),
    searchCorpus: 'irobot roomba j7+ aspirateur robot auto-vidage obstacle évitement',
    category: 'aspirateur_robot',
    tags: ['irobot', 'roomba', 'auto-vidage'],
  });

  // Dyson 360 Vis Nav
  const dyson_360_pid = 'prod-dyson-360-vis-nav';
  entries.push({
    offer: makeOffer({
      productId: dyson_360_pid,
      merchant: MERCHANTS.fnac,
      price: 999,
      shippingCost: 0,
      characteristics: {
        brand: verified('Dyson', 'manufacturer'),
        model: verified('360 Vis Nav', 'manufacturer'),
        category: verified('aspirateur_robot', 'manufacturer'),
        suction_power: verified('2600Pa', 'manufacturer'),
        self_emptying: verified('false', 'manufacturer'),
        battery_life: verified('50', 'manufacturer'),
        warranty: known('2 ans', 'dyson'),
        country_of_origin: known('MY', 'manufacturer'), // Malaysia
        ean: verified('0885155028099', 'manufacturer'),
      },
    }),
    searchCorpus: 'dyson 360 vis nav aspirateur robot puissant',
    category: 'aspirateur_robot',
    tags: ['dyson', 'puissant'],
  });

  // Roborock S8 Pro Ultra — unknown repairability
  const roborock_s8_pid = 'prod-roborock-s8-pro-ultra';
  entries.push({
    offer: makeOffer({
      productId: roborock_s8_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 1199,
      shippingCost: 0,
      characteristics: {
        brand: verified('Roborock', 'manufacturer'),
        model: verified('S8 Pro Ultra', 'manufacturer'),
        category: verified('aspirateur_robot', 'manufacturer'),
        self_emptying: verified('true', 'manufacturer'),
        self_washing: verified('true', 'manufacturer'),
        suction_power: verified('6000Pa', 'manufacturer'),
        battery_life: verified('180', 'manufacturer'),
        ean: verified('6970995785018', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        warranty: known('1 an', 'amazon-fr'),
        // repairability_index: UNKNOWN
        repairability_index: unknown_dp() as DataPoint<unknown>,
      },
    }),
    searchCorpus: 'roborock s8 pro ultra aspirateur robot laveur auto-vidage',
    category: 'aspirateur_robot',
    tags: ['roborock', 'laveur', 'auto-vidage'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // OFFER WITH UNKNOWN PRICE (tests DataPoint handling)
  // ─────────────────────────────────────────────────────────────────────────

  const mystery_keyboard_pid = 'prod-keychron-k3-pro';
  entries.push({
    offer: makeOffer({
      productId: mystery_keyboard_pid,
      merchant: MERCHANTS.amazon_de,
      price: null, // price not yet known
      currency: 'EUR',
      characteristics: {
        brand: verified('Keychron', 'manufacturer'),
        model: verified('K3 Pro', 'manufacturer'),
        category: verified('clavier', 'manufacturer'),
        layout: verified('75%', 'manufacturer'),
        wireless: verified('true', 'manufacturer'),
        bluetooth: verified('5.1', 'manufacturer'),
        ean: verified('6935280812361', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
      },
    }),
    searchCorpus: 'keychron k3 pro clavier mécanique bluetooth sans fil compact',
    category: 'clavier',
    tags: ['keychron', 'mécanique', 'bluetooth'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CHAUSSURES / SNEAKERS
  // ─────────────────────────────────────────────────────────────────────────

  // Nike Air Max 90 — available at multiple price points, tests budget scenarios
  const nike_am90_pid = 'prod-nike-air-max-90-blanc-44';
  const nike_am90_chars = {
    brand: verified('Nike', 'manufacturer'),
    model: verified('Air Max 90', 'manufacturer'),
    category: verified('chaussures', 'manufacturer'),
    size: verified('44', 'manufacturer'),
    color: verified('Blanc', 'manufacturer'),
    gender: verified('homme', 'manufacturer'),
    ean: verified('0195870698641', 'manufacturer'),
    country_of_origin: known('VN', 'manufacturer'), // Vietnam
    // repairability_index: not applicable for shoes → unknown
    repairability_index: unknown_dp() as DataPoint<unknown>,
    warranty: known('2 ans', 'manufacturer'),
  };

  entries.push({
    offer: makeOffer({
      productId: nike_am90_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 109,
      shippingCost: 0,
      characteristics: nike_am90_chars,
    }),
    searchCorpus: 'nike air max 90 chaussures baskets sneakers blanc homme taille 44',
    category: 'chaussures',
    tags: ['nike', 'sneakers', 'running', 'lifestyle'],
  });

  entries.push({
    offer: makeOffer({
      productId: nike_am90_pid,
      merchant: MERCHANTS.fnac,
      price: 119,
      shippingCost: 0,
      characteristics: nike_am90_chars,
    }),
    searchCorpus: 'nike air max 90 chaussures baskets sneakers blanc homme',
    category: 'chaussures',
    tags: ['nike', 'sneakers', 'running', 'lifestyle'],
  });

  entries.push({
    offer: makeOffer({
      productId: nike_am90_pid,
      merchant: MERCHANTS.cdiscount,
      price: 99,
      shippingCost: 4.99,
      characteristics: nike_am90_chars,
    }),
    searchCorpus: 'nike air max 90 chaussures sneakers blanc homme 44 pas cher',
    category: 'chaussures',
    tags: ['nike', 'sneakers', 'lifestyle'],
  });

  // Adidas Stan Smith — another sneaker for comparison
  const adidas_stan_smith_pid = 'prod-adidas-stan-smith-blanc-43';
  entries.push({
    offer: makeOffer({
      productId: adidas_stan_smith_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 89,
      shippingCost: 0,
      characteristics: {
        brand: verified('Adidas', 'manufacturer'),
        model: verified('Stan Smith', 'manufacturer'),
        category: verified('chaussures', 'manufacturer'),
        size: verified('43', 'manufacturer'),
        color: verified('Blanc', 'manufacturer'),
        gender: verified('unisexe', 'manufacturer'),
        ean: verified('4066759637597', 'manufacturer'),
        country_of_origin: known('VN', 'manufacturer'),
        warranty: known('2 ans', 'manufacturer'),
        repairability_index: unknown_dp() as DataPoint<unknown>,
      },
    }),
    searchCorpus: 'adidas stan smith chaussures baskets sneakers blanc unisexe taille 43',
    category: 'chaussures',
    tags: ['adidas', 'sneakers', 'lifestyle', 'classique'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUITS RARES / OCCASION
  // ─────────────────────────────────────────────────────────────────────────

  // Sony Walkman NW-A306 — niche product, single source, many unknown fields
  // Scenario: rare product test — la rareté ne diminue pas la pertinence (INVARIANT 2)
  const walkman_nwa306_pid = 'prod-sony-walkman-nwa306';
  entries.push({
    offer: makeOffer({
      productId: walkman_nwa306_pid,
      merchant: MERCHANTS.sony_shop,
      price: 399,
      shippingCost: 0,
      characteristics: {
        brand: verified('Sony', 'manufacturer'),
        model: verified('NW-A306', 'manufacturer'),
        category: verified('lecteur_audio', 'manufacturer'),
        storage: verified('32GB', 'manufacturer'),
        ean: verified('4548736146020', 'manufacturer'),
        battery_life: verified('36', 'manufacturer'), // hours
        bluetooth: verified('5.0', 'manufacturer'),
        high_res_audio: verified('true', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        warranty: known('1 an', 'sony-shop'),
        // Fields unknown for niche product
        repairability_index: unknown_dp() as DataPoint<unknown>,
        resale_value: unknown_dp() as DataPoint<unknown>,
      },
    }),
    searchCorpus: 'sony walkman nw-a306 lecteur audio haute résolution bluetooth dap',
    category: 'lecteur_audio',
    tags: ['sony', 'walkman', 'hifi', 'portable', 'rare'],
  });

  // Audio-Technica ATH-M50xBT2 — well-known headphone, used in refurb scenario
  const ath_m50x_pid = 'prod-audio-technica-ath-m50xbt2';
  entries.push({
    offer: makeOffer({
      productId: ath_m50x_pid,
      merchant: MERCHANTS.amazon_fr,
      price: 199,
      shippingCost: 0,
      characteristics: {
        brand: verified('Audio-Technica', 'manufacturer'),
        model: verified('ATH-M50xBT2', 'manufacturer'),
        type: verified('over-ear', 'manufacturer'),
        category: verified('casque', 'manufacturer'),
        anc: verified('false', 'manufacturer'), // NO ANC — important for filtering
        bluetooth: verified('5.0', 'manufacturer'),
        battery_life: verified('50', 'manufacturer'),
        weight: verified('307', 'manufacturer'),
        foldable: verified('true', 'manufacturer'),
        ean: verified('4961310149604', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        warranty: known('1 an', 'amazon-fr'),
        repairability_index: unknown_dp() as DataPoint<unknown>,
      },
    }),
    searchCorpus: 'audio technica ath m50x bt2 casque bluetooth studio monitoring',
    category: 'casque',
    tags: ['audio-technica', 'bluetooth', 'studio', 'monitoring'],
  });

  // ATH-M50xBT2 — Back Market refurb, CONFLICTING battery_life data
  // Tests: refurb source should not get special treatment (SOURCE INVARIANT)
  entries.push({
    offer: makeOffer({
      productId: ath_m50x_pid,
      merchant: MERCHANTS.backmarket,
      price: 139,
      shippingCost: 0,
      characteristics: {
        brand: verified('Audio-Technica', 'manufacturer'),
        model: verified('ATH-M50xBT2', 'manufacturer'),
        type: verified('over-ear', 'manufacturer'),
        category: verified('casque', 'manufacturer'),
        anc: verified('false', 'manufacturer'),
        bluetooth: verified('5.0', 'manufacturer'),
        // CONFLICTING: Back Market lists 40h (measured refurb), manufacturer says 50h
        battery_life: known('40', 'backmarket'),
        weight: verified('307', 'manufacturer'),
        foldable: verified('true', 'manufacturer'),
        ean: verified('4961310149604', 'manufacturer'),
        country_of_origin: known('CN', 'manufacturer'),
        warranty: known('1 an', 'backmarket'), // Back Market's own warranty
        condition: known('reconditionné', 'backmarket'),
        repairability_index: unknown_dp() as DataPoint<unknown>,
      },
    }),
    searchCorpus: 'audio technica ath m50x bt2 casque bluetooth reconditionné occasion',
    category: 'casque',
    tags: ['audio-technica', 'bluetooth', 'reconditionné', 'occasion'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // APPAREILS PHOTO
  // ─────────────────────────────────────────────────────────────────────────

  // Sony Alpha 7 IV — premium, tests "no budget limit" scenario
  const sony_a7iv_pid = 'prod-sony-alpha7iv';
  entries.push({
    offer: makeOffer({
      productId: sony_a7iv_pid,
      merchant: MERCHANTS.fnac,
      price: 2499,
      shippingCost: 0,
      characteristics: {
        brand: verified('Sony', 'manufacturer'),
        model: verified('Alpha 7 IV', 'manufacturer'),
        category: verified('appareil_photo', 'manufacturer'),
        sensor: verified('full_frame', 'manufacturer'),
        megapixels: verified('33', 'manufacturer'),
        video: verified('4K 60fps', 'manufacturer'),
        stabilization: verified('true', 'manufacturer'),
        ean: verified('4548736133747', 'manufacturer'),
        country_of_origin: known('JP', 'manufacturer'),
        warranty: known('2 ans', 'fnac'),
        weight: verified('659', 'manufacturer'), // grams body only
        repairability_index: unknown_dp() as DataPoint<unknown>,
      },
    }),
    searchCorpus: 'sony alpha 7 iv a7iv appareil photo hybride full frame 4k',
    category: 'appareil_photo',
    tags: ['sony', 'hybride', 'full-frame', 'pro'],
  });

  return entries;
}

// ============================================================================
// IN-MEMORY DISCOVERY STRATEGY
// ============================================================================

/**
 * A fully searchable in-memory strategy.
 *
 * Supports:
 * - Keyword search (multi-term, all terms must match)
 * - Category filtering
 * - Price range filtering
 * - Merchant allow/deny lists
 * - Relevance scoring (0-1)
 * - Deterministic ordering (score DESC, then offer ID ASC)
 */
export class InMemoryDiscoveryStrategy implements IDiscoveryStrategy {
  readonly name = 'in-memory';
  readonly version = '1.0.0';
  readonly isReady = true;

  private catalog: CatalogEntry[];

  constructor(catalog?: CatalogEntry[]) {
    this.catalog = catalog ?? buildCatalog();
  }

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const start = Date.now();
    const result = this.discoverSync(criteria);
    return {
      ...result,
      statistics: {
        ...result.statistics,
        searchTimeMs: Date.now() - start,
      },
    };
  }

  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    const start = Date.now();
    const allMatched: Array<{ offer: Offer; matchScore: number; matchReason: string }> = [];

    for (const entry of this.catalog) {
      // 1. Category filter — underscore/space-agnostic (accepts 'ordinateur_portable'
      // or 'ordinateur portable' as the same id, since callers may pass
      // either the raw catalog id or a human-normalized form).
      if (criteria.categories && criteria.categories.length > 0) {
        const normalize = (s: string) => s.replace(/[_\s]+/g, ' ').trim().toLowerCase();
        const wanted = criteria.categories.map(normalize);
        if (!wanted.includes(normalize(entry.category))) continue;
      }

      // 2. Keyword filter (all keywords must appear). Matches a keyword
      // that's a simple French/English plural of a corpus word too (e.g.
      // "casques" against a corpus that only says "casque") — the fixture
      // corpora are hand-written in singular form, but a real user query
      // naturally says "montre-moi des casques". A REAL search engine
      // (Brave/Serper — see RealWebDiscoveryStrategy) already stems this
      // itself, so this only matters for the local demo catalog's simple
      // substring matcher, never the real Web path.
      if (criteria.keywords && criteria.keywords.length > 0) {
        const corpus = (entry.searchCorpus + ' ' + entry.tags.join(' ')).toLowerCase();
        const allMatch = criteria.keywords.every(kw => {
          const k = kw.toLowerCase();
          if (corpus.includes(k)) return true;
          const singular = k.replace(/s$/, '');
          return singular.length >= 3 && singular !== k && corpus.includes(singular);
        });
        if (!allMatch) continue;
      }

      // 3. Price filter
      const price = entry.offer.price.value;
      if (price !== null) {
        if (criteria.minPrice !== undefined && price < criteria.minPrice) continue;
        if (criteria.maxPrice !== undefined && price > criteria.maxPrice) continue;
      } else {
        // Unknown price: only include if no price constraint
        if (criteria.maxPrice !== undefined || criteria.minPrice !== undefined) continue;
      }

      // 4. Merchant filter
      if (criteria.allowedMerchants && criteria.allowedMerchants.length > 0) {
        if (!criteria.allowedMerchants.includes(entry.offer.merchant.id)) continue;
      }
      if (criteria.excludedMerchants && criteria.excludedMerchants.length > 0) {
        if (criteria.excludedMerchants.includes(entry.offer.merchant.id)) continue;
      }

      // 5. Product ID filter
      if (criteria.productIds && criteria.productIds.length > 0) {
        if (!criteria.productIds.includes(entry.offer.productId)) continue;
      }

      // Compute relevance score
      const score = this.computeRelevance(entry, criteria);
      const reason = this.buildMatchReason(entry, criteria);

      allMatched.push({ offer: entry.offer, matchScore: score, matchReason: reason });
    }

    // Deterministic sort: score DESC, then offer.id ASC (stable)
    allMatched.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.offer.id.localeCompare(b.offer.id);
    });

    // Apply offset + limit
    const offset = criteria.offset ?? 0;
    const limit = criteria.limit ?? 50;
    const paged = allMatched.slice(offset, offset + limit);

    return {
      id: `discovery-inmem-${Date.now()}`,
      timestamp: new Date(),
      criteria,
      candidates: paged.map(m => ({
        offer: m.offer,
        matchScore: m.matchScore,
        matchReason: m.matchReason,
      })),
      statistics: {
        queriedSources: 1,
        candidatesFound: allMatched.length,
        candidatesFiltered: allMatched.length - paged.length,
        searchTimeMs: Date.now() - start,
        relevanceEstimate: allMatched.length > 5 ? 'high' : allMatched.length > 0 ? 'medium' : 'low',
      },
      strategy: 'in-memory',
      warnings: allMatched.length === 0 ? ['No offers matched criteria'] : undefined,
    };
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unavailable' }> {
    return { status: 'healthy' };
  }

  /**
   * Returns total number of offers in the catalog.
   */
  catalogSize(): number {
    return this.catalog.length;
  }

  /**
   * Returns all unique categories in the catalog.
   */
  categories(): string[] {
    return [...new Set(this.catalog.map(e => e.category))];
  }

  /**
   * Returns all product IDs in a category.
   */
  productIdsInCategory(category: string): string[] {
    return [...new Set(
      this.catalog
        .filter(e => e.category === category)
        .map(e => e.offer.productId)
    )];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private computeRelevance(entry: CatalogEntry, criteria: DiscoveryCriteria): number {
    let score = 0.5; // base

    // Keyword match quality
    if (criteria.keywords && criteria.keywords.length > 0) {
      const corpus = entry.searchCorpus;
      let kwMatches = 0;
      for (const kw of criteria.keywords) {
        if (corpus.toLowerCase().includes(kw.toLowerCase())) kwMatches++;
      }
      score += (kwMatches / criteria.keywords.length) * 0.3;
    }

    // Price proximity to max budget
    if (criteria.maxPrice && entry.offer.price.value) {
      const ratio = entry.offer.price.value / criteria.maxPrice;
      // Prefer offers that use most of the budget (better quality)
      score += (1 - Math.abs(ratio - 0.8)) * 0.1;
    }

    // Verified data increases relevance
    const chars = Object.values(entry.offer.characteristics);
    const verifiedCount = chars.filter(c => c.status === 'verified').length;
    if (chars.length > 0) {
      score += (verifiedCount / chars.length) * 0.1;
    }

    return Math.min(1, Math.max(0, score));
  }

  private buildMatchReason(entry: CatalogEntry, criteria: DiscoveryCriteria): string {
    const parts: string[] = [];

    if (criteria.categories?.includes(entry.category)) {
      parts.push(`category=${entry.category}`);
    }

    if (criteria.keywords) {
      const matched = criteria.keywords.filter(kw =>
        entry.searchCorpus.toLowerCase().includes(kw.toLowerCase())
      );
      if (matched.length > 0) {
        parts.push(`keywords=[${matched.join(',')}]`);
      }
    }

    return parts.join(', ') || 'general match';
  }
}

// ============================================================================
// CATALOG BUILDER (public, for test customization)
// ============================================================================

export { buildCatalog, CatalogEntry };
