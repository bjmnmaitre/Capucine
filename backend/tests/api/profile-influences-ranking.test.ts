/**
 * CAPUCINE — une préférence permanente change-t-elle RÉELLEMENT le résultat ?
 *
 * La persistance du profil et la fusion profil/demande courante existent et
 * sont testées séparément. Rien ne prouvait en revanche le maillon qui donne
 * son sens à la personnalisation : qu'une préférence enregistrée modifie
 * l'ordre des offres proposées. Sans cette preuve, le profil pouvait être
 * parfaitement persisté, parfaitement fusionné, et sans effet.
 *
 * Le test central compare DEUX recherches identiques, sur la même requête et
 * le même catalogue, qui ne diffèrent que par une préférence stockée.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(30000);

const QUERY = 'casque Sony WH-1000XM5';

interface Ranked {
  rank: number;
  offerId: string;
  merchant: { name: string };
  price: { amount: number | null } | null;
  score: number;
  criteria?: { id: string; name: string; level?: string; status: string }[];
}

describe('Une préférence permanente influence réellement le classement', () => {
  let dir: string;
  let app: Application;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-rank-profile-'));
    app = buildApp({ profileStoreDir: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function search(userId: string): Promise<Ranked[]> {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ query: QUERY, userId });
    expect(res.status).toBe(200);
    return res.body.results as Ranked[];
  }

  async function saveCriterion(userId: string, body: Record<string, unknown>) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).put(`/profile/${userId}/criterion`).send(body);
    expect(res.status).toBeLessThan(400);
  }

  it('LE TEST CENTRAL : une préférence enregistrée modifie réellement les scores', async () => {
    // Référence : aucun profil.
    const neutral = await search('sans-profil');
    expect(neutral.length).toBeGreaterThan(1);
    const neutralScores = neutral.map(o => o.score);

    // Même requête, même catalogue — seule une préférence permanente change.
    await saveCriterion('avec-profil', {
      id: 'price',
      name: 'Prix',
      level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const personalized = await search('avec-profil');

    // La préférence est réellement évaluée et pondérée : les scores bougent.
    expect(personalized.map(o => o.score)).not.toEqual(neutralScores);
    for (let i = 0; i < personalized.length; i++) {
      expect(personalized[i].score).toBeGreaterThan(neutralScores[i]);
    }
  });

  /**
   * CONSTAT MIS À JOUR — le classement suit désormais la préférence.
   *
   * Mesure précédente : les 4 offres obtenaient le même score ET le même
   * ordre, l'offre la plus chère restant première. La cause n'était pas le
   * poids du prix mais un défaut : `overallScore` était arrondi à l'entier
   * avant le tri, si bien que des écarts réels inférieurs au demi-point
   * comparaient comme nuls et l'ordre retombait sur le départage par id.
   * Corrigé (voir tests/decision/ranking-precision.test.ts).
   *
   * Mesure actuelle, même requête et même catalogue :
   *   sans profil                     → Sony 349 € · Fnac 329 € · Amazon 319 € · Boulanger 335 €
   *   avec préférence prix (required) → Fnac 329 € · Amazon 319 € · Sony 349 € · Boulanger 335 €
   *
   * Les scores AFFICHÉS restent identiques (arrondis), mais l'ordre reflète
   * la différence réelle. Le poids à donner au prix reste une question
   * ouverte (OD-109) : ce test ne la tranche pas, il vérifie seulement que
   * la préférence produit un effet observable.
   */
  it('une préférence de prix fait reculer l’offre la plus chère', async () => {
    const neutral = await search('ordre-sans');
    await saveCriterion('ordre-avec', {
      id: 'price', name: 'Prix', level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const personalized = await search('ordre-avec');

    const identity = (o: Ranked) => `${o.merchant.name}|${o.price?.amount}`;
    // L'ordre change réellement.
    expect(personalized.map(identity)).not.toEqual(neutral.map(identity));

    const priceAt = (list: Ranked[], rank: number) => list[rank - 1].price?.amount;
    const dearest = Math.max(
      ...neutral.map(o => o.price?.amount).filter((p): p is number => typeof p === 'number')
    );
    // L'offre la plus chère était première sans profil ; elle ne l'est plus.
    expect(priceAt(neutral, 1)).toBe(dearest);
    expect(priceAt(personalized, 1)).not.toBe(dearest);
  });

  it('la préférence enregistrée apparaît dans les critères évalués de l’offre', async () => {
    await saveCriterion('u-critere', {
      id: 'price', name: 'Prix', level: 'very_important',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const results = await search('u-critere');

    // Le critère issu du profil est réellement pris en compte et rendu
    // visible à l'interface — elle n'a rien à recalculer.
    const ids = (results[0].criteria ?? []).map(c => c.id);
    expect(ids).toContain('price');
  });

  it('un utilisateur SANS profil n’est pas affecté par la préférence d’un autre', async () => {
    await saveCriterion('alice', {
      id: 'price', name: 'Prix', level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });

    const alice = await search('alice');
    const bob = await search('bob');

    // Isolation : deux classements produits par le même processus, distincts.
    const aliceIds = (alice[0].criteria ?? []).map(c => c.id);
    const bobIds = (bob[0].criteria ?? []).map(c => c.id);
    expect(aliceIds).toContain('price');
    expect(bobIds).not.toEqual(aliceIds);
  });

  it("supprimer la préférence rétablit les scores de référence", async () => {
    const { default: supertest } = await import('supertest');
    const neutral = await search('temoin');

    await saveCriterion('bascule', {
      id: 'price', name: 'Prix', level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const withPref = await search('bascule');
    expect(withPref.map(o => o.score)).not.toEqual(neutral.map(o => o.score));

    await supertest(app).delete('/profile/bascule/criterion/price');
    const restored = await search('bascule');

    // La préférence n'a rien laissé derrière elle : on retrouve exactement le
    // résultat d'un utilisateur sans profil.
    expect(restored.map(o => o.offerId)).toEqual(neutral.map(o => o.offerId));
    expect(restored.map(o => o.score)).toEqual(neutral.map(o => o.score));
  });

  it('le classement reste déterministe : deux recherches identiques donnent le même ordre', async () => {
    await saveCriterion('determinisme', {
      id: 'price', name: 'Prix', level: 'important',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const first = await search('determinisme');
    const second = await search('determinisme');

    expect(second.map(o => o.offerId)).toEqual(first.map(o => o.offerId));
    expect(second.map(o => o.score)).toEqual(first.map(o => o.score));
  });

  it('une préférence persistée survit à la reconstruction de l’app et agit encore', async () => {
    await saveCriterion('persistant', {
      id: 'price', name: 'Prix', level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const before = await search('persistant');

    // Instance entièrement neuve : équivalent d'un redémarrage backend.
    app = buildApp({ profileStoreDir: dir });
    const after = await search('persistant');

    // Les offerId du catalogue local sont régénérés à chaque instance : on
    // compare donc sur ce qui identifie réellement une offre pour l'utilisateur.
    const identity = (o: Ranked) => `${o.merchant.name}|${o.price?.amount}`;
    expect(after.map(identity)).toEqual(before.map(identity));
    expect(after.map(o => o.score)).toEqual(before.map(o => o.score));
    expect((after[0].criteria ?? []).map(c => c.id)).toContain('price');
  });
});
