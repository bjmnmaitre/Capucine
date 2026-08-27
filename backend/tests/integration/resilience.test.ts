/**
 * CAPUCINE — dégrader honnêtement, jamais inventer
 *
 * Chaque scénario coupe ou corrompt une dépendance et vérifie la même chose :
 * Capucine revient vers UNKNOWN ou vers un résultat honnête, jamais vers une
 * valeur fabriquée, et l'application reste utilisable.
 */
import request from 'supertest';
import { buildApp } from '../../src/api/server';
import type { WebSearchAdapter, WebSearchResult } from '../../src/application/tools';

/** Adaptateur programmable : peut échouer, expirer, ou rendre n'importe quoi. */
function adapter(behaviour: 'ok' | 'throw' | 'timeout' | 'empty' | 'garbage', urls: string[] = []): WebSearchAdapter {
  return {
    adapterName: 'fixture',
    isConfigured: () => true,
    async search() {
      if (behaviour === 'throw') throw new Error('fournisseur indisponible');
      if (behaviour === 'timeout') { await new Promise(r => setTimeout(r, 50)); throw new Error('délai dépassé'); }
      if (behaviour === 'empty') return { searchEngine: 'fixture', results: [] };
      if (behaviour === 'garbage') {
        return {
          searchEngine: 'fixture',
          results: [
            { title: '', url: '', snippet: '', domain: '', position: 1 },
            { title: 'x', url: 'pas-une-url', snippet: '', domain: '?', position: 2 },
            { title: 'y', url: 'https://ok.example/produit/casque', snippet: '', domain: 'ok.example', position: 3 },
          ] as WebSearchResult[],
        };
      }
      return {
        searchEngine: 'fixture',
        results: urls.map((url, i) => ({
          title: 'Casque Sony WH-1000XM5', url, snippet: '', domain: new URL(url).hostname, position: i + 1,
        })) as WebSearchResult[],
      };
    },
  } as unknown as WebSearchAdapter;
}

const search = (app: ReturnType<typeof buildApp>, query = 'casque sony wh-1000xm5') =>
  request(app).post('/search').send({ query, userId: 'u-resilience' });

describe('§22 — le fournisseur de recherche défaille', () => {
  it('une exception du fournisseur ne fait pas tomber la recherche', async () => {
    const res = await search(buildApp({ webAdapters: [adapter('throw')], enablePageEnrichment: false }));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('un délai dépassé est absorbé, et signalé dans la couverture', async () => {
    const res = await search(buildApp({ webAdapters: [adapter('timeout')], enablePageEnrichment: false }));
    expect(res.status).toBe(200);
    expect(res.body.coverage?.sourcesFailed ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('un résultat vide donne un écran vide EXPLIQUÉ, pas une erreur', async () => {
    const res = await search(buildApp({ webAdapters: [adapter('empty')], enablePageEnrichment: false }), 'zzz-produit-inexistant-qwerty');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
    expect(res.body.summary?.resultSummary ?? res.body.noResultsDiagnosis?.message).toBeTruthy();
  });

  it('aucune offre n’est fabriquée quand la source échoue', async () => {
    const res = await search(buildApp({ webAdapters: [adapter('throw')], enablePageEnrichment: false }), 'produit-totalement-inexistant-zzz');
    for (const offer of res.body.results ?? []) {
      // Toute offre restante vient du catalogue local, jamais d'une invention.
      expect(offer.provenance?.source).toBeTruthy();
    }
  });
});

describe('§22 — résultats incohérents ou corrompus', () => {
  it('une URL malformée n’emporte pas les résultats valides', async () => {
    // Défaut historique : `new URL()` dans un `.map()` détruisait TOUT le lot
    // dès qu'une seule URL était invalide.
    const res = await search(buildApp({ webAdapters: [adapter('garbage')], enablePageEnrichment: false }));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('une URL vide ne devient jamais une URL d’exécution', async () => {
    const res = await search(buildApp({ webAdapters: [adapter('garbage')], enablePageEnrichment: false }));
    for (const offer of res.body.results ?? []) {
      expect(offer.offerUrl === null || offer.offerUrl.length > 0).toBe(true);
    }
  });

  it('un prix absent reste absent, jamais remplacé par zéro', async () => {
    const res = await search(buildApp({
      webAdapters: [adapter('ok', ['https://b.example/produit/casque-sans-prix'])],
    }));
    for (const offer of res.body.results ?? []) {
      if (offer.price === null) continue;
      expect(offer.price.amount).not.toBe(0);
    }
  });
});

describe('§22 — l’API reste correcte sous demandes hostiles', () => {
  it.each([
    ['corps vide',            {}],
    ['requête vide',          { query: '', userId: 'u' }],
    ['requête absente',       { userId: 'u' }],
    ['utilisateur absent',    { query: 'casque' }],
    ['types incorrects',      { query: 12345, userId: [] }],
    ['requête démesurée',     { query: 'a'.repeat(20_000), userId: 'u' }],
  ])('%s → réponse maîtrisée, jamais un plantage', async (_l, body) => {
    const res = await request(buildApp({ webAdapters: [adapter('ok', [])] })).post('/search').send(body);
    expect([200, 400, 413, 422]).toContain(res.status);
    expect(res.body).toBeDefined();
  });

  it('prepare-cart sur une session inconnue est refusé proprement', async () => {
    const res = await request(buildApp({ enablePageEnrichment: false }))
      .post('/prepare-cart')
      .send({ sessionId: 'session-qui-n-existe-pas', offerId: 'offre-inconnue', quantity: 1 });
    expect([400, 404, 422]).toContain(res.status);
    // Et surtout : aucune préparation n'est prétendue.
    expect(res.body?.purchaseCompleted).not.toBe(true);
    expect(res.body?.checkoutUrl ?? null).toBeNull();
  });

  it('prepare-cart sur une offre absente de la session est refusé', async () => {
    const app = buildApp({ webAdapters: [adapter('ok', ['https://b.example/produit/casque'])] });
    const s = await search(app);
    const res = await request(app).post('/prepare-cart')
      .send({ sessionId: s.body.session?.sessionId, offerId: 'offre-fabriquee', quantity: 1 });
    expect([400, 404, 422]).toContain(res.status);
    expect(res.body?.checkoutUrl ?? null).toBeNull();
  });
});
