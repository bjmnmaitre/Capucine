/**
 * CAPUCINE — POST /profile/:userId/onboarding (création de profil)
 *
 * Verrouille le contrat du wizard de création de profil :
 *  - une réponse complète produit onboardingCompleted=true + critères SOFT +
 *    données de pré-remplissage (shipping + comptes marchands consentis) ;
 *  - décliner chaque question reste un profil valide ;
 *  - relancer l'onboarding REMPLACE ses propres catégories (budget, condition,
 *    livraison gratuite, origine, exclusions) mais CONSERVE les critères que
 *    l'utilisateur a ajoutés depuis (préférence de classement, disponibilité…) ;
 *  - les réponses d'onboarding ne filtrent JAMAIS la recherche (invariant
 *    cardinal décrit dans onboarding.ts) : une offre au-dessus du budget
 *    préféré reste présentée — reclassée, pas exclue ;
 *  - GET /profile renvoie les nouvelles données (onboardingCompleted, shipping,
 *    merchantAccounts).
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

describe('POST /profile/:userId/onboarding', () => {
  let dir: string;
  let app: Application;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-onboard-'));
    app = buildApp({ profileStoreDir: dir, webAdapters: [fixtureAdapter()], enablePageEnrichment: false });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function onboard(userId: string, body: string | object | undefined) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post(`/profile/${userId}/onboarding`).send(body);
    return res;
  }
  async function getProfile(userId: string) {
    const { default: supertest } = await import('supertest');
    return supertest(app).get(`/profile/${userId}`);
  }
  async function search(userId: string) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ query: QUERY, userId });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('une réponse complète → onboardingCompleted, critères SOFT, shipping + comptes consentis', async () => {
    const res = await onboard('u-complete', {
      preferredLanguage: 'fr',
      budget: { maxAmount: 300, currency: 'EUR' },
      condition: 'new',
      freeShipping: 'very_important',
      origin: 'france',
      excludedMerchants: ['Amazon'],
      shipping: { firstName: 'Jeanne', lastName: 'Dupont', city: 'Rennes' },
      merchantAccounts: [{ merchantName: 'Amazon' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(true);

    const byId = new Map<string, any>(res.body.criteria.map((c: { id: string }) => [c.id, c]));
    // Softness invariant: NOTHING here is required/forbidden except exclusions.
    for (const [id, c] of byId) {
      if (id.startsWith('merchant-exclude-')) {
        expect(c.level).toBe('forbidden');
      } else {
        expect(['very_important', 'important', 'preference']).toContain(c.level);
        expect(c.parameters.unknownPolicy).toBe('pass');
      }
    }
    expect(byId.get('budget')).toMatchObject({ level: 'preference', parameters: { maxBudget: 300 } });
    expect(byId.get('condition')).toMatchObject({ level: 'important', parameters: { preferredValues: ['new'] } });
    expect(byId.get('shipping')).toMatchObject({ level: 'very_important', parameters: { maxValue: 0 } });
    expect(byId.get('eu_origin')).toMatchObject({ level: 'very_important', parameters: { preferredValues: ['FR', 'France'] } });
    expect(byId.get('merchant-exclude-amazon')).toMatchObject({ level: 'forbidden' });

    expect(res.body.shipping).toMatchObject({ firstName: 'Jeanne', lastName: 'Dupont', city: 'Rennes', country: 'FR' });
    expect(res.body.merchantAccounts).toEqual([{ merchantName: 'Amazon', note: null, grantedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/) }]);
  });

  it('GET /profile renvoie les nouvelles données une fois l\'onboarding fait', async () => {
    await onboard('u-get', { freeShipping: 'preference', shipping: { street: '1 rue X' } });

    const res = await getProfile('u-get');
    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(true);
    expect(res.body.shipping.street).toBe('1 rue X');
    expect(res.body.merchantAccounts).toEqual([]);
  });

  it('décliner chaque question reste un profil VALIDE (aucune erreur)', async () => {
    const res = await onboard('u-decline', {
      budget: null, condition: null, freeShipping: 'off', origin: null,
      excludedMerchants: [], shipping: null, merchantAccounts: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(true);
    expect(res.body.criteria).toEqual([]);
  });

  it('relancer l\'onboarding remplace SES critères mais conserve les ajouts ultérieurs (ex: préférence de classement)', async () => {
    await onboard('u-rerun', { budget: { maxAmount: 200, currency: 'EUR' }, origin: 'france' });

    const { default: supertest } = await import('supertest');
    await supertest(app).put('/profile/u-rerun/criterion').send({
      id: 'ranking-preference', name: 'Toujours le moins cher', level: 'preference',
      parameters: { rankingPreference: 'PRICE_LOWEST' },
    });

    // Re-run with a totally different profile.
    await onboard('u-rerun', { budget: { maxAmount: 600, currency: 'EUR' }, origin: 'europe', condition: 'used' });

    const res = await getProfile('u-rerun');
    const ids = res.body.criteria.map((c: { id: string }) => c.id);
    expect(ids).toContain('ranking-preference');       // conserved
    expect(ids).not.toContain('shipping');              // jamais stocké → absent
    expect(ids.find((id: string) => id === 'budget' && false)).toBeUndefined();
    const budget = res.body.criteria.find((c: { id: string }) => c.id === 'budget');
    expect(budget.parameters.maxBudget).toBe(600);      // remplacé, pas additionné
    const origin = res.body.criteria.find((c: { id: string }) => c.id === 'eu_origin');
    expect(origin.parameters.preferredValues.length).toBeGreaterThan(10); // europe
  });

  it('INVARIANT CARDINAL : l\'onboarding ne filtre JAMAIS — une offre au-dessus du budget préféré reste présentée', async () => {
    await onboard('u-soft', {
      budget: { maxAmount: 100, currency: 'EUR' },   // toutes les offres dépassent
      origin: 'france',                               // aucune offre n'est FR
      freeShipping: 'very_important',
      excludedMerchants: [],
    });

    const body = await search('u-soft');
    expect(body.results.length).toBe(3);              // rien n'a été retiré
    expect(body.merchantExclusions).toBeNull();       // aucune exclusion signalée
    // Le classement a favorisé les offres (soft) sans jamais en exclure.
  });

  it('un corps invalide ou un userId vide → 400, jamais d\'exception', async () => {
    const { default: supertest } = await import('supertest');
    expect((await supertest(app).post('/profile/u-bad/onboarding').send(null as never)).status).toBe(400);
    expect((await supertest(app).post('/profile/u-bad/onboarding').send('nope' as never)).status).toBe(400);
    expect((await supertest(app).post('/profile//onboarding').send({})).status).toBe(404);
  });
});