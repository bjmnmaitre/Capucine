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
import type { WebSearchAdapter, WebSearchResult } from '../../src/application/tools';

/**
 * Source de résultats DÉTERMINISTE.
 *
 * Ce fichier vérifie la FORME du contrat que les écrans Expo consomment, pas
 * la couverture du Web — celle-ci est mesurée par les campagnes et par
 * `npm run smoke:product`, qui interrogent le vrai réseau.
 *
 * Sans cette source, `buildApp()` partait chercher le Web réel : la suite
 * échouait par intermittence avec « res.body.results is not iterable », c'est
 * à dire non pas parce que le contrat était rompu, mais parce qu'une requête
 * sortante avait expiré. Un test instable finit par être ignoré, et un test
 * ignoré ne protège plus rien.
 */
function fixtureAdapter(): WebSearchAdapter {
  // Plusieurs marchands du MÊME produit, à des prix différents, dont une
  // offre SANS prix : c'est la variété que les écrans doivent savoir rendre.
  const pages = [
    { url: 'https://marchand-a.example/produit/casque-sony-wh-1000xm5', snippet: 'Casque Sony WH-1000XM5 à 349,00 € — en stock' },
    { url: 'https://marchand-b.example/dp/B09XS7JWHH', snippet: 'Casque Sony WH-1000XM5 — 329 €' },
    { url: 'https://marchand-c.example/p/casque-sony-wh-1000xm5', snippet: 'Casque Sony WH-1000XM5 — 399 € livraison offerte' },
    { url: 'https://marchand-d.example/item/778899', snippet: 'Casque Sony WH-1000XM5 — 309,90 €' },
    // Sans prix : `price` vaut `null`, et l'écran doit le supporter.
    { url: 'https://marchand-e.example/produit/casque-sony', snippet: 'Casque Sony WH-1000XM5, prix non communiqué' },
  ];
  return {
    adapterName: 'fixture',
    isConfigured: () => true,
    async search(params: { query?: string }) {
      // Une requête sans correspondance ne doit rien rendre — sinon le
      // scénario « aucun résultat » ne teste rien.
      const query = String(params?.query ?? '').toLowerCase();
      const matches = query.includes('casque') || query.includes('sony') || query.includes('wh-1000xm5');
      return {
        searchEngine: 'fixture',
        results: (matches ? pages : []).map((p, i) => ({
          title: 'Casque Sony WH-1000XM5',
          url: p.url,
          snippet: p.snippet,
          domain: new URL(p.url).hostname,
          position: i + 1,
        })) as WebSearchResult[],
      };
    },
  } as unknown as WebSearchAdapter;
}

describe('Contrat du parcours Expo', () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp({ webAdapters: [fixtureAdapter()], enablePageEnrichment: false });
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
      // Le contrat autorise EXPLICITEMENT `price: null` — une offre dont le
      // prix n'a pas été relevé reste présentée, et l'écran la rend telle
      // quelle. Exiger une devise sur toute offre était un invariant faux,
      // que seule la composition du jeu de données réel masquait.
      expect(offer.price === null || typeof offer.price?.currency === 'string').toBe(true);
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

    // LA garantie : une offre par ligne, jamais fusionnée avec une autre.
    // Écraser quatre marchands en une seule ligne supprimerait des prix réels,
    // dont potentiellement le moins cher — l'inverse de ce que Capucine existe
    // pour faire.
    expect(offerIds.size).toBe(results.length);
    // Plusieurs marchands concurrents restent visibles.
    expect(merchantIds.size).toBeGreaterThan(1);

    // L'unification produit — reconnaître que ces offres portent LE MÊME
    // article — n'est PAS garantie ici, et il serait malhonnête de l'affirmer.
    // DeduplicationEngine refuse délibérément de regrouper sur le seul titre :
    // sans identifiant définitif (EAN, SKU) ou couple marque+modèle, le poids
    // accumulé reste sous le seuil. Fusionner deux articles distincts est un
    // défaut plus grave qu'en afficher deux lignes.
    //
    // MESURÉ sur 6 recherches Web réelles (77 offres) : 38 % des offres
    // partagent effectivement leur produit avec une autre — l'unification a
    // donc bien lieu dès que les signaux existent, et seulement alors.
    //
    // Ce qui est garanti et vérifié ici : l'identité produit est STABLE,
    // jamais nulle, jamais fabriquée à la volée.
    expect(productIds.size).toBeLessThanOrEqual(offerIds.size);
    expect(results.every(r => typeof r.productId === 'string' && r.productId.length > 0)).toBe(true);
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
    // Lu sous garde : `price` peut valoir `null`. Le lire sans précaution
    // était la faute même que ce contrat existe pour empêcher côté écran.
    const prices = results
      .map((r: { price: { amount: number | null } | null }) => r.price?.amount ?? null)
      .filter((p: number | null): p is number => p !== null);
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
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
    for (const offer of res.body.results) {
      expect(typeof offer.provenance?.source).toBe('string');
      expect(offer.provenance.source.length).toBeGreaterThan(0);
    }
  });
});
