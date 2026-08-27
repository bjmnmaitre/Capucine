/**
 * Le nombre annoncé doit désigner les offres réellement présentées.
 *
 * `totalFound` et `results` étaient calculés depuis deux tableaux différents.
 * Ils coïncidaient, mais par coïncidence : rien n'empêchait une future étape
 * de filtrage de faire mentir le compteur.
 */
import request from 'supertest';
import { buildApp } from '../../src/api/server';

describe('Cohérence du nombre d’offres annoncé', () => {
  it('totalFound est exactement le nombre d’offres rendues', async () => {
    const app = buildApp({ enablePageEnrichment: false });
    const res = await request(app)
      .post('/search')
      .send({ query: 'casque bluetooth', userId: 'u-count' });

    expect(res.status).toBe(200);
    expect(res.body.summary.totalFound).toBe(res.body.results.length);
  });

  it('reste vrai quand aucune offre n’est trouvée', async () => {
    const app = buildApp({ enablePageEnrichment: false });
    const res = await request(app)
      .post('/search')
      .send({ query: 'zzz-produit-inexistant-qwerty', userId: 'u-count-2' });

    expect(res.status).toBe(200);
    expect(res.body.summary.totalFound).toBe(res.body.results.length);
  });
});
