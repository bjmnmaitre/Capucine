/**
 * CAPUCINE — Cart Preparation Engine (§7.3, execution layer)
 *
 * WHY THIS EXISTS
 * ───────────────
 * This module coordinates the last mile — taking a chosen offer and getting
 * the user to a place where they can actually buy it — and it had no test at
 * all. That is the worst place in the pipeline to be uncovered: it is the
 * only part that hands the user something they will act on.
 *
 * INVARIANTS COVERED
 * - DATA_DISCIPLINE: a purchase URL is either the offer's real, verified
 *   executionUrl or it is 'unavailable'. Never synthesized, never guessed.
 * - No personal data (email, name) is ever placed in a URL.
 * - MERCHANT_INDEPENDENCE: no merchant gets special treatment; routing
 *   depends only on declared execution capabilities.
 * - EXECUTION_INDEPENDENCE: preparing (or failing to prepare) a cart never
 *   changes an offer's ranking score.
 * - NO_SILENT_MODIFICATION: Capucine never completes a purchase — it always
 *   stops at the point where the user must confirm.
 * - A stub never claims a capability it cannot honour.
 */

import {
  CartPreparationEngine,
  WebRedirectHandler,
  OAuthRedirectHandler,
  MerchantAPIHandler,
  createDefaultCartPreparationEngine,
  CartPreparationRequest,
} from '../../src/application/cart-preparation-engine';
import { PromotionApplication } from '../../src/application/promotion-engine';
import { rankOffers } from '../../src/decision/priority-engine';
import {
  Offer,
  Merchant,
  DataPoint,
  ExecutionCapabilityType,
  PreferenceCriterion,
} from '../../src/domain/types';

// ============================================================================
// HELPERS
// ============================================================================

function dp<T>(value: T): DataPoint<T> {
  return { value, status: 'known', provenance: { source: 'test', retrievedAt: new Date() } };
}

function merchant(id: string, capabilities: ExecutionCapabilityType[]): Merchant {
  return { id, name: id, country: 'FR', executionCapabilities: capabilities };
}

function offer(params: {
  id?: string;
  merchant: Merchant;
  price?: number;
  executionUrl?: string;
}): Offer {
  return {
    id: params.id ?? 'offer-1',
    productId: 'prod-1',
    merchant: params.merchant,
    price: dp(params.price ?? 199),
    currency: 'EUR',
    shippingCost: { value: null, status: 'unknown' },
    characteristics: {},
    executionUrl: params.executionUrl,
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
  };
}

function request(over: Partial<CartPreparationRequest> & { offer: Offer }): CartPreparationRequest {
  return { quantity: 1, ...over };
}

function promoApplication(code: string): PromotionApplication {
  return {
    promotion: {
      id: 'promo-1',
      code,
      type: 'percentage_discount',
      discountValue: 10,
      discountUnit: 'percent',
      conditions: [],
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2027-01-01'),
      isActive: true,
      source: 'test',
      verificationStatus: 'verified',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    applicabilityStatus: 'applicable',
    originalPrice: 199,
    discountedPrice: 179.1,
    savingsAmount: 19.9,
    savingsPercent: 10,
    reasoning: 'test',
  };
}

// ============================================================================
// WEB REDIRECT HANDLER — la seule voie réellement fonctionnelle aujourd'hui
// ============================================================================

describe('WebRedirectHandler — jamais d\'URL inventée', () => {
  const handler = new WebRedirectHandler();

  it("rend l'URL réelle de l'offre, verbatim", async () => {
    const url = 'https://www.fnac.com/a12345/Sony-WH-1000XM5';
    const result = await handler.prepareCart(
      request({ offer: offer({ merchant: merchant('fnac', ['web_redirect']), executionUrl: url }) })
    );

    expect(result.checkoutUrl).toBe(url);
    expect(result.cart?.merchantCheckoutUrl).toBe(url);
  });

  it("répond 'unavailable' — sans URL — quand aucune URL vérifiée n'est connue", async () => {
    const result = await handler.prepareCart(
      request({ offer: offer({ merchant: merchant('fnac', ['web_redirect']) }) }) // pas d'executionUrl
    );

    expect(result.status).toBe('unavailable');
    expect(result.checkoutUrl).toBeUndefined();
    expect(result.cart).toBeUndefined();
  });

  it("ne fabrique JAMAIS une URL à partir de l'identifiant du marchand", async () => {
    const result = await handler.prepareCart(
      request({ offer: offer({ merchant: merchant('amazon', ['web_redirect']) }) })
    );

    // L'ancienne implémentation produisait https://amazon.com/checkout?product_id=…
    expect(result.checkoutUrl).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('amazon.com');
    expect(JSON.stringify(result)).not.toContain('/checkout');
  });

  it("ne place JAMAIS de données personnelles dans l'URL", async () => {
    const url = 'https://www.fnac.com/a12345/Sony-WH-1000XM5';
    const result = await handler.prepareCart(
      request({
        offer: offer({ merchant: merchant('fnac', ['web_redirect']), executionUrl: url }),
        userEmail: 'benjamin@example.com',
        userFirstName: 'Benjamin',
        userLastName: 'Durand',
        shippingCountry: 'FR',
      })
    );

    expect(result.checkoutUrl).toBe(url);
    expect(result.checkoutUrl).not.toContain('benjamin');
    expect(result.checkoutUrl).not.toContain('example.com');
    expect(result.checkoutUrl).not.toContain('Durand');
  });

  it("n'ajoute pas le code promo à l'URL : il est donné comme instruction", async () => {
    const url = 'https://www.fnac.com/a12345/Sony-WH-1000XM5';
    const result = await handler.prepareCart(
      request({
        offer: offer({ merchant: merchant('fnac', ['web_redirect']), executionUrl: url }),
        appliedPromo: promoApplication('CAPUCINE10'),
      })
    );

    expect(result.checkoutUrl).toBe(url);
    expect(result.checkoutUrl).not.toContain('CAPUCINE10');
    expect(result.nextAction).toContain('CAPUCINE10');
  });

  it("annonce 'partially_prepared' et non 'prepared' : rien n'a été créé chez le marchand", async () => {
    const result = await handler.prepareCart(
      request({
        offer: offer({ merchant: merchant('fnac', ['web_redirect']), executionUrl: 'https://x.fr/p' }),
      })
    );

    expect(result.cart?.status).toBe('partially_prepared');
    expect(result.status).toBe('partial');
  });

  it("indique toujours que le paiement se fait chez le marchand (NO_SILENT_MODIFICATION)", async () => {
    const result = await handler.prepareCart(
      request({
        offer: offer({ merchant: merchant('fnac', ['web_redirect']), executionUrl: 'https://x.fr/p' }),
      })
    );

    expect(result.status).not.toBe('success'); // aucun achat n'a été effectué
    expect(result.nextAction?.toLowerCase()).toContain('payment');
  });

  it('reporte la quantité demandée comme instruction explicite', async () => {
    const result = await handler.prepareCart(
      request({
        offer: offer({ merchant: merchant('fnac', ['web_redirect']), executionUrl: 'https://x.fr/p' }),
        quantity: 3,
      })
    );

    expect(result.cart?.quantity).toBe(3);
    expect(result.nextAction).toContain('3');
  });
});

// ============================================================================
// STUBS — ne jamais revendiquer une capacité qu'on ne sait pas honorer
// ============================================================================

describe('stubs d\'exécution', () => {
  it("OAuthRedirectHandler décline : il n'a aucun client OAuth enregistré", () => {
    const handler = new OAuthRedirectHandler();
    expect(handler.canHandle(merchant('fnac', ['oauth_redirect']))).toBe(false);
  });

  it("MerchantAPIHandler décline en l'absence d'identifiants", () => {
    const handler = new MerchantAPIHandler();
    delete process.env.FNAC_API_KEY;
    expect(handler.canHandle(merchant('fnac', ['merchant_api']))).toBe(false);
  });

  it("un marchand annonçant oauth_redirect obtient quand même son URL réelle via web_redirect", async () => {
    // Le piège corrigé : le stub OAuth est préféré à web_redirect dans l'ordre
    // de sélection. S'il revendiquait la capacité, l'utilisateur ne recevrait
    // aucune URL alors qu'une URL réelle existe.
    const engine = createDefaultCartPreparationEngine();
    const url = 'https://www.fnac.com/a12345/Sony-WH-1000XM5';
    const result = await engine.prepare(
      request({
        offer: offer({
          merchant: merchant('fnac', ['oauth_redirect', 'web_redirect']),
          executionUrl: url,
        }),
      })
    );

    expect(result.checkoutUrl).toBe(url);
  });
});

// ============================================================================
// ENGINE — sélection, indisponibilité, indépendance marchand
// ============================================================================

describe('CartPreparationEngine', () => {
  it("répond 'unavailable' quand le marchand ne déclare aucune capacité utilisable", async () => {
    const engine = createDefaultCartPreparationEngine();
    const result = await engine.prepare(
      request({ offer: offer({ merchant: merchant('petit-vendeur', []), executionUrl: 'https://x.fr/p' }) })
    );

    expect(result.status).toBe('unavailable');
    expect(result.checkoutUrl).toBeUndefined();
  });

  it('canPrepareCart reflète ce qui est réellement faisable', () => {
    const engine = createDefaultCartPreparationEngine();
    expect(engine.canPrepareCart(merchant('a', ['web_redirect']))).toBe(true);
    expect(engine.canPrepareCart(merchant('b', ['oauth_redirect']))).toBe(false);
    expect(engine.canPrepareCart(merchant('c', []))).toBe(false);
  });

  it('MERCHANT_INDEPENDENCE : deux marchands aux mêmes capacités sont traités identiquement', async () => {
    const engine = createDefaultCartPreparationEngine();
    const urlA = 'https://merchant-a.example/product/1';
    const urlB = 'https://merchant-b.example/product/1';

    const a = await engine.prepare(
      request({ offer: offer({ id: 'a', merchant: merchant('amazon', ['web_redirect']), executionUrl: urlA }) })
    );
    const b = await engine.prepare(
      request({ offer: offer({ id: 'b', merchant: merchant('un-inconnu', ['web_redirect']), executionUrl: urlB }) })
    );

    expect(a.status).toBe(b.status);
    expect(a.checkoutUrl).toBe(urlA);
    expect(b.checkoutUrl).toBe(urlB);
    expect(a.nextAction).toBe(b.nextAction);
    expect(a.cart?.executionCapability).toBe(b.cart?.executionCapability);
  });

  it("propage une erreur de handler en 'failed' sans inventer d'URL", async () => {
    const engine = new CartPreparationEngine();
    engine.registerHandler({
      capability: 'web_redirect',
      canHandle: () => true,
      prepareCart: async () => {
        throw new Error('merchant unreachable');
      },
    });

    const result = await engine.prepare(
      request({ offer: offer({ merchant: merchant('fnac', ['web_redirect']) }) })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('merchant unreachable');
    expect(result.checkoutUrl).toBeUndefined();
  });

  it('getExecutionCapabilities rapporte les capacités déclarées, sans en inventer', () => {
    const engine = createDefaultCartPreparationEngine();
    expect(engine.getExecutionCapabilities(merchant('a', ['web_redirect']))).toEqual(['web_redirect']);
    expect(engine.getExecutionCapabilities(merchant('b', []))).toEqual([]);
  });
});

// ============================================================================
// NON-RÉGRESSION ARCHITECTURALE (§22) — EXECUTION_INDEPENDENCE
// ============================================================================

describe('EXECUTION_INDEPENDENCE', () => {
  const criteria: PreferenceCriterion[] = [
    { id: 'price', name: 'Prix', level: 'important', evaluationType: 'price-ascending' },
  ];

  it('la même offre avec ou sans executionUrl obtient le MÊME score', () => {
    const m = merchant('fnac', ['web_redirect']);
    const withUrl = offer({ id: 'with-url', merchant: m, price: 199, executionUrl: 'https://x.fr/p' });
    const withoutUrl = offer({ id: 'without-url', merchant: m, price: 199 });

    const ranking = rankOffers({
      offers: [withUrl, withoutUrl],
      effectiveCriteria: criteria,
      requestId: 'exec-independence-url',
      timestamp: new Date(),
    });

    const scores = ranking.rankedOffers.map(r => r.overallScore);
    expect(new Set(scores).size).toBe(1);
  });

  it("la richesse des capacités d'exécution du marchand ne change pas le score", () => {
    // Un marchand « facile à acheter » (UCP + API) ne doit obtenir aucun bonus
    // face à un marchand chez qui il faut tout faire à la main.
    const easy = offer({
      id: 'easy',
      merchant: merchant('easy-shop', ['ucp', 'merchant_api', 'web_redirect']),
      price: 199,
      executionUrl: 'https://easy.example/p',
    });
    const hard = offer({ id: 'hard', merchant: merchant('hard-shop', []), price: 199 });

    const ranking = rankOffers({
      offers: [easy, hard],
      effectiveCriteria: criteria,
      requestId: 'exec-independence-capabilities',
      timestamp: new Date(),
    });

    const scores = ranking.rankedOffers.map(r => r.overallScore);
    expect(new Set(scores).size).toBe(1);
  });

  it("une offre non préparable automatiquement reste parfaitement classable", async () => {
    const engine = createDefaultCartPreparationEngine();
    const notPreparable = offer({ id: 'cheapest', merchant: merchant('brocante', []), price: 99 });
    const preparable = offer({
      id: 'pricier',
      merchant: merchant('fnac', ['web_redirect']),
      price: 199,
      executionUrl: 'https://x.fr/p',
    });

    const prep = await engine.prepare(request({ offer: notPreparable }));
    expect(prep.status).toBe('unavailable');

    const ranking = rankOffers({
      offers: [preparable, notPreparable],
      effectiveCriteria: criteria,
      requestId: 'exec-independence-eligibility',
      timestamp: new Date(),
    });

    // Moins chère → première, malgré l'impossibilité de préparer le panier.
    expect(ranking.rankedOffers[0].offer.id).toBe('cheapest');
  });
});
