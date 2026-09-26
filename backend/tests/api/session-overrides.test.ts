/**
 * MEGAPROMPT #6 — de bout en bout via HTTP.
 * Profil : « Ne pas acheter chez Amazon » (permanent).
 * /clarify « exceptionnellement Amazon ça va » → Amazon réapparaît POUR CETTE
 * CONVERSATION, l'exception est déclarée dans la réponse, elle survit au tour
 * suivant, le profil stocké est intact et une nouvelle recherche exclut de nouveau.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(30000);

const QUERY = 'casque Sony WH-1000XM5';

function fixtureAdapter() {
  const pages = [
    { url: 'https://www.amazon.fr/dp/B09XS7JWHH', snippet: 'Casque Sony WH-1000XM5 — 329 €' },
    { url: 'https://www.fnac.com/p/casque-sony', snippet: 'Casque Sony WH-1000XM5 — 349,00 €' },
    { url: 'https://www.boulanger.com/item/778899', snippet: 'Casque Sony WH-1000XM5 — 339,90 €' },
  ];
  return {
    adapterName: 'fixture',
    isConfigured: () => true,
    async search() {
      return {
        searchEngine: 'fixture',
        results: pages.map((p, i) => ({
          title: 'Casque Sony WH-1000XM5', url: p.url, snippet: p.snippet,
          domain: new URL(p.url).hostname, position: i + 1,
        })),
      };
    },
  } as never;
}

describe('Exception temporaire à une préférence permanente (MEGAPROMPT #6)', () => {
  let dir: string;
  let app: Application;
  const USER = 'u-override';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-override-'));
    app = buildApp({ profileStoreDir: dir, webAdapters: [fixtureAdapter()], enablePageEnrichment: false });
    const { default: st } = await import('supertest');
    const put = await st(app).put(`/profile/${USER}/criterion`).send({
      id: 'merchant-exclude-amazon', name: 'Ne pas acheter chez Amazon',
      level: 'forbidden', parameters: { merchantName: 'amazon' },
    });
    expect(put.status).toBeLessThan(400);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const hasAmazon = (body: { results: Array<{ merchant: { name: string } }> }) =>
    body.results.some((o) => o.merchant.name.toLowerCase().includes('amazon'));

  async function search() {
    const { default: st } = await import('supertest');
    const res = await st(app).post('/search').send({ query: QUERY, userId: USER });
    expect(res.status).toBe(200);
    return res.body;
  }
  async function clarify(sessionId: string, answer: string) {
    const { default: st } = await import('supertest');
    const res = await st(app).post('/clarify').send({ sessionId, questionId: '__followup__', answer });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('le parcours complet : exclu → réautorisé pour la session → profil intact → exclu à nouveau', async () => {
    const first = await search();
    expect(hasAmazon(first)).toBe(false);
    const sessionId = first.session.sessionId as string;

    const relaxed = await clarify(sessionId, 'exceptionnellement Amazon ça va');
    expect(hasAmazon(relaxed)).toBe(true);
    expect(relaxed.temporaryOverrides).toEqual([
      expect.objectContaining({ criterionId: 'merchant-exclude-amazon', temporaryLevel: 'disabled', originalLevel: 'forbidden' }),
    ]);

    // Le tour suivant de la MÊME conversation garde l'exception.
    const next = await clarify(sessionId, 'le moins cher');
    expect(hasAmazon(next)).toBe(true);
    expect(next.temporaryOverrides).toHaveLength(1);

    // Le profil stocké n'a pas bougé.
    const { default: st } = await import('supertest');
    const prof = await st(app).get(`/profile/${USER}`);
    expect(JSON.stringify(prof.body)).toContain('merchant-exclude-amazon');

    // Nouvelle recherche = nouvelle conversation : l'exclusion permanente s'applique de nouveau.
    const fresh = await search();
    expect(hasAmazon(fresh)).toBe(false);
    expect(fresh.temporaryOverrides ?? []).toEqual([]);
  });

  it('sans signal temporel, rien n’est réautorisé', async () => {
    const first = await search();
    const body = await clarify(first.session.sessionId, 'Amazon ça va');
    expect(hasAmazon(body)).toBe(false);
    expect(body.temporaryOverrides).toEqual([]);
  });
});
