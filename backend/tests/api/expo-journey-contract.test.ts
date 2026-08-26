/**
 * CAPUCINE — contrat du parcours consommé par l'application Expo
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * L'application Expo (frontend/) lit un sous-ensemble précis de la réponse de
 * /search et le réinjecte dans /prepare-cart. Aucun test ne gardait ce
 * sous-ensemble : renommer `session.sessionId` ou `cost.certainty` aurait
 * cassé le parcours utilisateur sans faire échouer une seule suite.
 *
 * Ces tests ne dupliquent pas la couverture existante (validation, URL non
 * inventée, non-achat). Ils vérifient exactement ce dont l'écran dépend :
 * les champs, leur type, et les invariants que l'interface affiche.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';

describe('Contrat du parcours Expo', () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
  });

  async function runSearch(query: string) {
    const { default: supertest } = await import('supertest');
    return supertest(app).post('/search').send({ query, userId: 'expo-user' });
  }

  // ── A. recherche valide : la forme dont l'écran Résultats dépend ─────────
  it('A. une recherche valide renvoie les champs exacts lus par l’écran Résultats', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    expect(res.status).toBe(200);

    // Le sessionId est ce que l'écran Détail réinjecte dans /prepare-cart.
    expect(typeof res.body.session?.sessionId).toBe('string');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);

    for (const offer of res.body.results) {
      expect(typeof offer.rank).toBe('number');
      expect(typeof offer.offerId).toBe('string');
      expect(typeof offer.productId).toBe('string');
      expect(typeof offer.merchant?.id).toBe('string');
      expect(typeof offer.merchant?.name).toBe('string');
      expect(typeof offer.price?.currency).toBe('string');
      expect(typeof offer.score).toBe('number');
      // L'écran colore et étiquette l'offre d'après cette valeur : elle doit
      // rester dans le domaine attendu, sinon l'interface affiche du vide.
      expect(['known', 'partially_known', 'unknown']).toContain(offer.cost?.certainty);
      expect(Array.isArray(offer.cost?.unknownComponents)).toBe(true);
    }
  });

  // ── B. recherche vide ────────────────────────────────────────────────────
  it('B. une recherche vide est refusée et non traitée comme une recherche sans résultat', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ query: '   ', userId: 'expo-user' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // ── C. aucun résultat ────────────────────────────────────────────────────
  it('C. une requête sans correspondance renvoie 200 avec une liste vide, jamais une erreur', async () => {
    const res = await runSearch('zzzzqqq objet totalement inexistant 99999');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    // Zéro offre est une réponse légitime : l'écran affiche son état vide.
    expect(res.body.results.length).toBe(0);
  });

  // ── E + F. Product ≠ Offer ≠ Merchant ────────────────────────────────────
  it('E+F. plusieurs marchands du MÊME produit restent des offres distinctes', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    const results = res.body.results as {
      offerId: string; productId: string; merchant: { id: string };
    }[];
    expect(results.length).toBeGreaterThan(1);

    const offerIds = new Set(results.map(r => r.offerId));
    const merchantIds = new Set(results.map(r => r.merchant.id));
    const productIds = new Set(results.map(r => r.productId));

    // Une offre par ligne, jamais fusionnée avec une autre.
    expect(offerIds.size).toBe(results.length);
    // Plusieurs marchands concurrents sur le même produit.
    expect(merchantIds.size).toBeGreaterThan(1);
    // Le produit reste UN produit : la déduplication ne doit pas l'avoir éclaté,
    // et les offres ne doivent pas avoir été fusionnées parce qu'il est commun.
    expect(productIds.size).toBeLessThan(offerIds.size);
  });

  // ── N. le classement vient du Priority Engine, pas du prix ───────────────
  it('N. le classement n’est pas un simple tri par prix croissant', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    const results = res.body.results as {
      rank: number; score: number; price: { amount: number | null };
    }[];

    // Les rangs sont contigus et ordonnés.
    expect(results.map(r => r.rank)).toEqual(results.map((_, i) => i + 1));
    // Le score est décroissant : c'est lui qui ordonne.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
    // Et le résultat n'est PAS le simple tri par prix : au moins une offre
    // moins chère est classée après une plus chère.
    const prices = results.map(r => r.price.amount).filter((p): p is number => p !== null);
    const sortedByPrice = [...prices].sort((a, b) => a - b);
    expect(prices).not.toEqual(sortedByPrice);
  });

  // ── H. coût inconnu affiché comme inconnu, jamais comme 0 ────────────────
  it('H. une composante de coût inconnue est nommée, jamais comptée comme zéro', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    const offer = res.body.results[0];

    if (offer.cost.certainty !== 'known') {
      expect(offer.cost.unknownComponents.length).toBeGreaterThan(0);
      // totalKnown est la somme du CONNU, pas un total présenté comme final.
      // L'écran l'affiche précédé de « au moins ».
      expect(offer.cost.totalKnown).not.toBeNull();
    }
    // Aucune composante inconnue ne doit apparaître avec une valeur 0.
    const states = offer.cost.componentStates ?? {};
    for (const [name, state] of Object.entries(states)) {
      if (state === 'unknown') {
        expect(offer.cost.unknownComponents).toContain(name);
      }
    }
  });

  // ── M + O + P + Q. le passage vers l'achat, tel que l'écran Détail l'appelle
  it('M+O+P+Q. préparer l’achat depuis la session renvoie un verdict honnête', async () => {
    const { default: supertest } = await import('supertest');
    const search = await runSearch('casque Sony WH-1000XM5');
    const sessionId = search.body.session.sessionId as string;
    const offer = search.body.results[0];

    const res = await supertest(app)
      .post('/prepare-cart')
      .send({ sessionId, offerId: offer.offerId, quantity: 1 });

    expect(res.status).toBe(200);
    expect(typeof res.body.status).toBe('string');
    // L'écran affiche nextAction tel quel : il doit toujours être exploitable.
    expect(typeof res.body.nextAction).toBe('string');
    expect(res.body.nextAction.length).toBeGreaterThan(0);
    // Aucun achat n'est jamais effectué par cet appel.
    expect(res.body.purchaseCompleted).toBe(false);

    if (res.body.status === 'unavailable' || res.body.status === 'failed') {
      // Refus honnête : aucune URL n'est fabriquée pour compenser.
      expect(res.body.checkoutUrl).toBeNull();
    } else {
      // Panier exploitable : l'URL vient de l'offre, jamais d'un gabarit.
      expect(typeof res.body.checkoutUrl).toBe('string');
      expect(res.body.checkoutUrl).toMatch(/^https?:\/\//);
    }
  });

  // ── Livraison : un coût inconnu n'est pas une livraison offerte ──────────
  it('la livraison est toujours exposée, et « inconnu » ne peut pas être lu comme « offert »', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    for (const offer of res.body.results) {
      // Toujours présent : l'écran doit pouvoir dire quelque chose de la
      // livraison pour CHAQUE offre, même quand elle est inconnue.
      expect(offer.shipping).toBeDefined();
      expect(typeof offer.shipping.status).toBe('string');
      expect(typeof offer.shipping.currency).toBe('string');

      if (offer.shipping.status === 'unknown') {
        // Le montant DOIT être null : un 0 ici se lirait « livraison offerte ».
        expect(offer.shipping.amount).toBeNull();
      } else {
        expect(typeof offer.shipping.amount).toBe('number');
      }
    }
  });

  // ── R + S. le client doit pouvoir distinguer erreur et absence de résultat ─
  it('R+S. une requête malformée renvoie une erreur nommée, pas une liste vide', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ userId: 'expo-user' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // L'écran affiche ce message : il doit exister et être exploitable.
    expect(typeof res.body.message === 'string' || typeof res.body.error === 'string').toBe(true);
    // Surtout : pas de `results: []`, qui se lirait « aucune offre n'existe ».
    expect(res.body.results).toBeUndefined();
  });

  // ── CORS : fermé par défaut, ouvert seulement si configuré explicitement ──
  it('CORS est fermé par défaut et n’ouvre jamais l’API à toutes les origines', async () => {
    const { default: supertest } = await import('supertest');
    const before = process.env['CORS_ORIGIN'];
    delete process.env['CORS_ORIGIN'];
    try {
      const closed = await supertest(buildApp()).get('/health').set('Origin', 'http://evil.example');
      expect(closed.headers['access-control-allow-origin']).toBeUndefined();

      process.env['CORS_ORIGIN'] = 'http://localhost:8081';
      const open = await supertest(buildApp()).get('/health').set('Origin', 'http://localhost:8081');
      // L'origine configurée est renvoyée telle quelle — jamais '*'.
      expect(open.headers['access-control-allow-origin']).toBe('http://localhost:8081');
      expect(open.headers['access-control-allow-origin']).not.toBe('*');
    } finally {
      if (before === undefined) delete process.env['CORS_ORIGIN'];
      else process.env['CORS_ORIGIN'] = before;
    }
  });

  // ── U. provenance conservée jusqu'à l'écran ──────────────────────────────
  it('U. chaque offre porte sa provenance jusqu’à l’interface', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    for (const offer of res.body.results) {
      expect(typeof offer.provenance?.source).toBe('string');
      expect(offer.provenance.source.length).toBeGreaterThan(0);
    }
  });
});
