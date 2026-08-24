/**
 * CAPUCINE — POST /prepare-cart (HTTP)
 *
 * The last mile: turning a ranked offer into something the user can act on.
 *
 * INVARIANTS COVERED
 * - Capucine never completes a purchase (NO_SILENT_MODIFICATION).
 * - The purchase URL always comes from Capucine's own recorded result,
 *   never from the client, and is never invented (DATA_DISCIPLINE).
 * - Only offers that were actually RANKED can be prepared — an offer
 *   rejected by admissibility cannot re-enter through this route.
 * - Preparing a cart never changes the ranking (EXECUTION_INDEPENDENCE).
 *
 * Runs against InMemoryDiscovery + MockAI — no API keys, no network.
 */

import { buildApp } from '../../src/api/server';
import type { Application } from 'express';

let app: Application;

beforeAll(() => {
  app = buildApp();
});

async function post(path: string, body: object) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post(path).send(body).set('Content-Type', 'application/json');
}

/** Runs a real search and returns its sessionId + first ranked offerId. */
async function searchAndPick(query: string): Promise<{ sessionId: string; offerId: string; body: any }> {
  const res = await post('/search', { query, userId: 'prepare-cart-test' });
  expect(res.status).toBe(200);
  expect(res.body.results.length).toBeGreaterThan(0);
  return {
    sessionId: res.body.session.sessionId,
    offerId: res.body.results[0].offerId,
    body: res.body,
  };
}

describe('POST /prepare-cart — validation', () => {
  it('rejette une requête sans sessionId', async () => {
    const res = await post('/prepare-cart', { offerId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_SESSION_ID');
  });

  it('rejette une requête sans offerId', async () => {
    const res = await post('/prepare-cart', { sessionId: 'sess-x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_OFFER_ID');
  });

  it('rejette une session inconnue', async () => {
    const res = await post('/prepare-cart', { sessionId: 'sess-inexistante', offerId: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SESSION_NOT_FOUND');
  });

  it('rejette une quantité invalide au lieu de la corriger silencieusement', async () => {
    const { sessionId, offerId } = await searchAndPick('casque bluetooth');

    for (const quantity of [0, -3, 1.5, 'deux']) {
      const res = await post('/prepare-cart', { sessionId, offerId, quantity });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_QUANTITY');
    }
  });
});

describe('POST /prepare-cart — préparation', () => {
  it("prépare une offre réellement classée de la session", async () => {
    const { sessionId, offerId } = await searchAndPick('casque bluetooth');

    const res = await post('/prepare-cart', { sessionId, offerId });

    expect(res.status).toBe(200);
    expect(res.body.offerId).toBe(offerId);
    expect(res.body.quantity).toBe(1);
    expect(['success', 'partial', 'unavailable', 'failed']).toContain(res.body.status);
    // New fields should be present (may be null)
    expect(res.body).toHaveProperty('merchantCartId');
    expect(res.body).toHaveProperty('webhookUrl');
    expect(res.body).toHaveProperty('purchaseInitiatedAt');
  });

  it("n'achète JAMAIS : la réponse dit explicitement qu'aucun achat n'a eu lieu", async () => {
    const { sessionId, offerId } = await searchAndPick('casque bluetooth');
    const res = await post('/prepare-cart', { sessionId, offerId });

    expect(res.body.purchaseCompleted).toBe(false);
    expect(res.body.status).not.toBe('success');
  });

  it("n'invente aucune URL quand l'offre n'en a pas de vérifiée", async () => {
    // Les offres du catalogue InMemory n'ont pas d'executionUrl : le bon
    // comportement est de le dire, pas de fabriquer un lien plausible.
    const { sessionId, offerId } = await searchAndPick('casque bluetooth');
    const res = await post('/prepare-cart', { sessionId, offerId });

    expect(res.body.checkoutUrl).toBeNull();
    expect(res.body.status).toBe('unavailable');
    expect(res.body.nextAction).toBeTruthy();
  });

  it('refuse un offerId qui ne fait pas partie des résultats de la session', async () => {
    const { sessionId } = await searchAndPick('casque bluetooth');

    const res = await post('/prepare-cart', { sessionId, offerId: 'offre-fabriquee-par-le-client' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('OFFER_NOT_FOUND');
  });

  it("n'accepte pas d'offre fournie par le client (l'URL vient toujours de Capucine)", async () => {
    const { sessionId } = await searchAndPick('casque bluetooth');

    // Un client malveillant tente d'injecter sa propre offre et son URL.
    const res = await post('/prepare-cart', {
      sessionId,
      offerId: 'offre-piegee',
      offer: {
        id: 'offre-piegee',
        executionUrl: 'https://site-malveillant.example/paiement',
        merchant: { id: 'faux', name: 'Faux marchand' },
      },
    });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('site-malveillant');
  });

  it("ne permet pas de préparer une offre écartée par l'admissibilité", async () => {
    // Recherche contrainte : certaines offres du catalogue sont exclues.
    const cheap = await post('/search', { query: 'casque bluetooth moins de 100 euros', userId: 'prepare-cart-test' });
    expect(cheap.status).toBe(200);
    const sessionId = cheap.body.session.sessionId;
    const rankedIds: string[] = cheap.body.results.map((r: any) => r.offerId);

    // Une offre connue du catalogue mais bien au-dessus du budget.
    const all = await post('/search', { query: 'casque bluetooth', userId: 'prepare-cart-test' });
    const expensive = all.body.results.find((r: any) => !rankedIds.includes(r.offerId));

    if (expensive) {
      const res = await post('/prepare-cart', { sessionId, offerId: expensive.offerId });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('OFFER_NOT_FOUND');
    }
  });

  it('reporte la quantité demandée sans la modifier', async () => {
    const { sessionId, offerId } = await searchAndPick('casque bluetooth');
    const res = await post('/prepare-cart', { sessionId, offerId, quantity: 4 });

    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(4);
  });
});

describe('POST /prepare-cart — EXECUTION_INDEPENDENCE', () => {
  it('préparer un panier ne change pas le classement de la session', async () => {
    const { sessionId, offerId, body } = await searchAndPick('casque bluetooth');
    const orderBefore = body.results.map((r: any) => r.offerId);

    await post('/prepare-cart', { sessionId, offerId });

    // Même requête, même ordre : la préparation n'a rien réordonné.
    const after = await post('/search', { query: 'casque bluetooth', userId: 'prepare-cart-test' });
    const orderAfter = after.body.results.map((r: any) => r.offerId);

    expect(orderAfter).toEqual(orderBefore);
  });
});
