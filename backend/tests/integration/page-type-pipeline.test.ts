/**
 * CAPUCINE — la nature de la page traverse le pipeline
 *
 * Vérifie la conséquence qui compte : une page qui n'est pas une offre ne
 * devient pas une offre, et ne peut donc ni être classée, ni chiffrée, ni
 * préparée à l'achat.
 *
 * Les scénarios utilisent un adaptateur de recherche contrôlé — aucune requête
 * réseau — pour que le comportement soit reproductible. Les URLs et les formes
 * de page proviennent, elles, du corpus réel (30 recherches, 297 pages).
 */
import request from 'supertest';
import { buildApp } from '../../src/api/server';
import type { WebSearchAdapter, WebSearchResult } from '../../src/application/tools';

/** Adaptateur déterministe : rend exactement les résultats qu'on lui donne. */
function fixedAdapter(results: Array<Partial<WebSearchResult> & { url: string }>): WebSearchAdapter {
  return {
    adapterName: 'fixture',
    isConfigured: () => true,
    async search() {
      return {
        searchEngine: 'fixture',
        results: results.map((r, i) => ({
          title: r.title ?? 'Purificateur d’air Levoit Core 300S',
          url: r.url,
          snippet: r.snippet ?? '',
          domain: new URL(r.url).hostname,
          position: i + 1,
        })) as WebSearchResult[],
      };
    },
  } as unknown as WebSearchAdapter;
}

/**
 * Requête volontairement hors du catalogue local (aspirateur, casque,
 * smartphone… y figurent) : sans cela, les offres de démonstration se
 * mélangeraient aux offres issues du Web et le test ne mesurerait plus rien.
 */
const QUERY = 'purificateur air levoit';

const search = (app: ReturnType<typeof buildApp>, query = QUERY) =>
  request(app).post('/search').send({ query, userId: 'u-pagetype' });

describe('§13 — une page non-offre n’entre jamais dans la collection d’offres', () => {
  it('une rubrique marchande ne produit aucune offre', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/produits/aspirateur-robot' },
      { url: 'https://boutique.example/c/casques' },
      { url: 'https://boutique.example/collections/casques-sans-fil' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it('une page de recherche interne ne produit aucune offre, même avec des prix', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/search?q=casque', snippet: 'Sony 329 € · Bose 299 € · JBL 129 €' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it('un comparatif citant dix prix ne produit pas dix offres', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://media.example/audio/comparatif', snippet: 'Sony 329 € · Bose 299 € · JBL 129 € · Sennheiser 249 €' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it('une vraie fiche marchande produit bien une offre', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/produit/casque-sony-wh-1000xm5', snippet: '329 € — en stock' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('les pages non-offres n’apparaissent pas dans le décompte annoncé', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/produits/aspirateur-robot' },
      { url: 'https://boutique.example/produit/casque-sony-wh-1000xm5', snippet: '329 €' },
      { url: 'https://video.example/watch?v=abc' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    // §19 — le nombre annoncé désigne les offres réellement présentées.
    expect(res.body.summary.totalFound).toBe(res.body.results.length);
    expect(res.body.results.length).toBe(1);
  });
});

describe('§18 — la classification est conservée et explicable', () => {
  it('chaque offre retenue porte son type de page et la preuve qui l’a produit', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/produit/casque-sony-wh-1000xm5', snippet: '329 € — en stock' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    const offer = res.body.results[0];
    expect(offer).toBeDefined();
    // La preuve voyage avec l'offre, pas dans un journal volatil.
    expect(offer.provenance.pageType).toBeTruthy();
    expect(offer.provenance.pageTypeEvidence).toBeTruthy();
  });
});

describe('§15 — le coût n’est jamais emprunté à une page qui n’est pas l’offre', () => {
  it('une rubrique affichant un prix ne transmet ce prix à aucune offre', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/produits/aspirateur-robot', snippet: 'À partir de 199 €' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    // Le prix de la rubrique appartenait à un produit arbitraire de la liste.
    // Aucune offre ne doit en hériter — parce qu'aucune offre n'existe.
    expect(res.body.results).toHaveLength(0);
  });
});

describe('§16 — prepare-cart', () => {
  it('impossible sur une rubrique : elle n’a jamais produit d’offre à préparer', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter([
      { url: 'https://boutique.example/produits/aspirateur-robot', snippet: 'À partir de 199 €' },
    ])], enablePageEnrichment: false });
    const res = await search(app);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);

    // Aucune offre n'existant, la préparation ne peut pas aboutir. On le
    // vérifie explicitement plutôt que de le déduire.
    const prep = await request(app)
      .post('/prepare-cart')
      .send({ offerId: 'web-boutique.example-1', userId: 'u-pagetype' });
    expect([400, 404, 422]).toContain(prep.status);
  });
});

describe('§11 — protection contre les faux négatifs, bout en bout', () => {
  it.each([
    ['fiche avec prix',        'https://b.example/produit/casque-sony', '329 € en stock'],
    ['fiche sans prix',        'https://b.example/produit/casque-sony', ''],
    ['fiche sous /dp/',        'https://b.example/dp/B08XYZ1234', ''],
    ['fiche sous /ref/',       'https://b.example/ref/1193303', ''],
    ['fiche Shopify',          'https://b.example/products/levoit-purificateur-dair-everestair', ''],
    ['boutique minimale',      'https://petite-boutique.example/casque-sony-noir', ''],
    ['sous-domaine boutique',  'https://shop.example.com/casque-sony', ''],
  ])('%s → produit bien une offre', async (_r, url, snippet) => {
    const app = buildApp({ webAdapters: [fixedAdapter([{ url, snippet }])], enablePageEnrichment: false });
    const res = await search(app);
    // Diagnostic explicite : un statut inattendu doit dire lequel et pourquoi,
    // pas se manifester par un `results` indéfini plus loin.
    if (res.status !== 200) {
      throw new Error(`statut ${res.status} — corps : ${JSON.stringify(res.body).slice(0, 300)}`);
    }
    expect(res.body.results.length).toBeGreaterThan(0);
  });
});
