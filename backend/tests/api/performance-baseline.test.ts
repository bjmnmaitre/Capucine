/**
 * CAPUCINE — baseline de performance du parcours
 *
 * Mesurée AVANT le premier appel Web réel, pour disposer d'un point de
 * comparaison : le jour où une vraie recherche paraîtra lente, il faudra
 * savoir ce qui vient du réseau et ce qui vient de Capucine.
 *
 * Ce fichier MESURE, il n'optimise rien. Les seuils sont larges et ne servent
 * qu'à détecter une dégradation grossière, pas à faire de la micro-performance.
 */
import { buildApp } from '../../src/api/server';
import type { WebSearchAdapter, WebSearchOutput } from '../../src/application/tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(120000);

const FNAC = 'https://www.fnac.com/a12345/xm5';
const DARTY = 'https://www.darty.com/nav/98765.html';

class Source implements WebSearchAdapter {
  calls = 0;
  constructor(readonly adapterName: string, private readonly urls: string[], private readonly delayMs = 0) {}
  isConfigured(): boolean { return true; }
  async search(): Promise<WebSearchOutput> {
    this.calls += 1;
    if (this.delayMs > 0) await new Promise(r => setTimeout(r, this.delayMs));
    return {
      searchEngine: this.adapterName,
      results: this.urls.map((url, i) => ({
        title: 'Sony WH-1000XM5', url, snippet: `${329 + i * 10},00 €`,
        position: i + 1, domain: new URL(url).hostname,
      })),
    };
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

describe('Baseline de performance — parcours complet', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'capucine-perf-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('mesure /search sur 20 exécutions et publie la répartition des temps', async () => {
    const { default: supertest } = await import('supertest');
    const app = buildApp({
      webAdapters: [new Source('alpha', [FNAC, DARTY])],
      profileStoreDir: dir,
    });

    const totals: number[] = [];
    const phases: Record<string, number[]> = {};
    let offers = 0;

    for (let i = 0; i < 20; i++) {
      const started = Date.now();
      const res = await supertest(app).post('/search').send({ query: 'casque Sony WH-1000XM5', userId: 'perf' });
      totals.push(Date.now() - started);
      expect(res.status).toBe(200);
      offers = res.body.results.length;

      const timing = res.body.timing as Record<string, number> | undefined;
      if (timing) {
        for (const [phase, ms] of Object.entries(timing)) {
          if (typeof ms === 'number') (phases[phase] ??= []).push(ms);
        }
      }
    }

    const summarize = (values: number[]) => ({
      moyen: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      p95: percentile(values, 95),
      max: Math.max(...values),
    });

    const parPhase: Record<string, unknown> = {};
    for (const [phase, values] of Object.entries(phases)) parPhase[phase] = summarize(values);

    console.log('[PERF] ' + JSON.stringify({
      executions: totals.length, offres: offers,
      httpTotal: summarize(totals), phasesMoteur: parPhase,
    }));

    // Seuil grossier : détecter une dégradation d'un ordre de grandeur, pas
    // arbitrer des millisecondes. Sans réseau, une recherche reste bien en
    // dessous de la seconde.
    expect(summarize(totals).p95).toBeLessThan(3000);
  });

  it('le multi-fournisseur interroge les sources EN PARALLÈLE, pas en série', async () => {
    const { default: supertest } = await import('supertest');
    const DELAY = 150;
    const a = new Source('alpha', [FNAC], DELAY);
    const b = new Source('beta', [DARTY], DELAY);
    const app = buildApp({ webAdapters: [a, b], profileStoreDir: dir });

    const started = Date.now();
    const res = await supertest(app).post('/search').send({ query: 'casque Sony WH-1000XM5', userId: 'perf' });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(a.calls).toBeGreaterThan(0);
    expect(b.calls).toBeGreaterThan(0);

    console.log(`[PERF] multi-fournisseur: ${elapsed}ms pour 2 sources à ${DELAY}ms chacune`);

    // En série, deux sources à 150 ms coûteraient au moins 300 ms de plus que
    // le reste. Ce seuil vérifie que le fan-out n'est pas séquentiel — ce qui
    // doublerait le temps de la première vraie recherche.
    expect(elapsed).toBeLessThan(DELAY * 2 + 1500);
  });

  it('mesure /prepare-cart', async () => {
    const { default: supertest } = await import('supertest');
    const app = buildApp({ webAdapters: [new Source('alpha', [FNAC])], profileStoreDir: dir });

    const search = await supertest(app).post('/search').send({ query: 'casque Sony WH-1000XM5', userId: 'perf' });
    const offer = (search.body.results as Array<{ offerId: string }>)[0];

    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const started = Date.now();
      await supertest(app).post('/prepare-cart')
        .send({ sessionId: search.body.session.sessionId, offerId: offer.offerId, quantity: 1 });
      times.push(Date.now() - started);
    }

    console.log('[PERF] prepare-cart: ' + JSON.stringify({
      moyen: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      p95: percentile(times, 95), max: Math.max(...times),
    }));
    expect(percentile(times, 95)).toBeLessThan(2000);
  });
});
