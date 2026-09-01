/**
 * CAPUCINE — « ne jamais acheter chez ce marchand » comme préférence PERMANENTE
 *
 * Jusqu'ici, exclure un marchand n'était possible qu'au sein d'une session
 * ("sans Amazon" en affinage). Une préférence permanente équivalente
 * ("Ne pas acheter chez Amazon", stockée dans le profil) était conservée
 * mais SANS effet sur le classement — exactement ce que la règle d'honnêteté
 * interdit.
 *
 * Ces tests prouvent le maillon manquant :
 *  - dès la PREMIÈRE recherche, les offres du marchand exclu sont absentes ;
 *  - la réponse le dit explicitement (merchantExclusions), la liste n'est
 *    pas seulement plus courte en silence ;
 *  - l'exclusion survit à un affinage de session ;
 *  - retirer la préférence rétablit les offres.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(30000);

const QUERY = 'casque Sony WH-1000XM5';

/** Source d'offres déterministe : deux "amazon", deux autres marchands. */
function fixtureAdapter() {
  const pages = [
    { url: 'https://www.amazon.fr/dp/B09XS7JWHH', snippet: 'Casque Sony WH-1000XM5 — 329 €' },
    { url: 'https://www.amazon.com.be/dp/B09XS7JWHH', snippet: 'Casque Sony WH-1000XM5 — 319 €' },
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

describe('Préférence permanente « marchand exclu »', () => {
  let dir: string;
  let app: Application;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-merchex-'));
    app = buildApp({ profileStoreDir: dir, webAdapters: [fixtureAdapter()], enablePageEnrichment: false });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function search(userId: string) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ query: QUERY, userId });
    expect(res.status).toBe(200);
    return res.body;
  }
  async function excludeMerchant(userId: string, merchantName: string) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).put(`/profile/${userId}/criterion`).send({
      id: `merchant-exclude-${merchantName}`,
      name: `Ne pas acheter chez ${merchantName}`,
      level: 'forbidden',
      parameters: { merchantName },
    });
    expect(res.status).toBeLessThan(400);
  }

  const merchants = (body: { results: Array<{ merchant: { name: string } }> }) =>
    body.results.map((o) => o.merchant.name.toLowerCase());

  it('sans préférence : les offres du marchand sont présentes, aucune exclusion signalée', async () => {
    const body = await search('u-neutre');
    expect(merchants(body).some((m) => m.includes('amazon'))).toBe(true);
    expect(body.merchantExclusions).toBeNull();
  });

  it('avec la préférence : dès la 1re recherche, plus aucune offre du marchand', async () => {
    await excludeMerchant('u-excl', 'amazon');
    const body = await search('u-excl');

    expect(merchants(body).some((m) => m.includes('amazon'))).toBe(false);
    expect(body.results.length).toBeGreaterThan(0); // les autres marchands restent
    expect(body.merchantExclusions).toMatchObject({
      requested: ['amazon'],
      hiddenOfferCount: 2,
    });
    expect(body.merchantExclusions.hiddenMerchants.sort())
      .toEqual(['www.amazon.com.be', 'www.amazon.fr']);
  });

  it('l\'exclusion survit à un affinage de session', async () => {
    await excludeMerchant('u-refine', 'amazon');
    const first = await search('u-refine');
    const sessionId = first.session.sessionId as string;

    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/clarify').send({
      sessionId, questionId: '__followup__', answer: 'le moins cher',
    });
    expect(res.status).toBe(200);
    expect(merchants(res.body).some((m) => m.includes('amazon'))).toBe(false);
  });

  it('retirer la préférence rétablit les offres du marchand', async () => {
    await excludeMerchant('u-toggle', 'amazon');
    expect(merchants(await search('u-toggle')).some((m) => m.includes('amazon'))).toBe(false);

    const { default: supertest } = await import('supertest');
    const del = await supertest(app)
      .delete('/profile/u-toggle/criterion/merchant-exclude-amazon');
    expect(del.status).toBeLessThan(400);

    const after = await search('u-toggle');
    expect(merchants(after).some((m) => m.includes('amazon'))).toBe(true);
    expect(after.merchantExclusions).toBeNull();
  });
});

describe('Préférence permanente « toujours trier par coût total le plus bas »', () => {
  let dir: string;
  let app: Application;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-rankpref-'));
    app = buildApp({ profileStoreDir: dir, webAdapters: [fixtureAdapter()], enablePageEnrichment: false });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function search(userId: string) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ query: QUERY, userId });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('sans préférence : ordre BEST_MATCH', async () => {
    expect((await search('rp-neutre')).rankingPreference.preference).toBe('BEST_MATCH');
  });

  it('avec la préférence : PRICE_LOWEST dès la 1re recherche, offres triées par coût', async () => {
    const { default: supertest } = await import('supertest');
    const put = await supertest(app).put('/profile/rp-cheap/criterion').send({
      id: 'ranking-preference', name: 'Toujours le moins cher', level: 'preference',
      parameters: { rankingPreference: 'PRICE_LOWEST' },
    });
    expect(put.status).toBeLessThan(400);

    const body = await search('rp-cheap');
    expect(body.rankingPreference).toMatchObject({ preference: 'PRICE_LOWEST', applied: true });

    // Les offres à coût connu sont en ordre croissant.
    const knownCosts = body.results
      .filter((o: { cost: { certainty: string; totalKnown: number } }) => o.cost.certainty !== 'unknown')
      .map((o: { cost: { totalKnown: number } }) => o.cost.totalKnown);
    const sorted = [...knownCosts].sort((a, b) => a - b);
    expect(knownCosts).toEqual(sorted);
  });

  it('une valeur stockée invalide est ignorée (retour à BEST_MATCH), jamais d\'erreur', async () => {
    const { default: supertest } = await import('supertest');
    await supertest(app).put('/profile/rp-bad/criterion').send({
      id: 'ranking-preference', name: 'x', level: 'preference',
      parameters: { rankingPreference: 'NOT_A_REAL_PREFERENCE' },
    });
    const body = await search('rp-bad');
    expect(body.rankingPreference.preference).toBe('BEST_MATCH');
  });
});

describe('Préférence permanente « privilégier la disponibilité immédiate »', () => {
  let dir: string;
  let app: Application;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-avail-'));
    app = buildApp({ profileStoreDir: dir, webAdapters: [fixtureAdapter()], enablePageEnrichment: false });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function search(userId: string) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/search').send({ query: QUERY, userId });
    expect(res.status).toBe(200);
    return res.body;
  }
  async function setAvailabilityPref(userId: string, value: unknown) {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).put(`/profile/${userId}/criterion`).send({
      id: 'availability-preference', name: 'Privilégier la disponibilité immédiate',
      level: 'preference', parameters: { prioritizeAvailability: value },
    });
    expect(res.status).toBeLessThan(400);
  }

  it('sans préférence : availabilityEmphasis = false', async () => {
    expect((await search('av-off')).availabilityEmphasis).toBe(false);
  });

  it('avec la préférence : availabilityEmphasis = true dès la 1re recherche', async () => {
    await setAvailabilityPref('av-on', true);
    expect((await search('av-on')).availabilityEmphasis).toBe(true);
  });

  it('la préférence survit à un affinage de session', async () => {
    await setAvailabilityPref('av-refine', true);
    const first = await search('av-refine');
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).post('/clarify').send({
      sessionId: first.session.sessionId, questionId: '__followup__', answer: 'le moins cher',
    });
    expect(res.status).toBe(200);
    expect(res.body.availabilityEmphasis).toBe(true);
  });

  it('une valeur non booléenne est traitée comme OFF, jamais d\'erreur', async () => {
    await setAvailabilityPref('av-bad', 'oui');
    expect((await search('av-bad')).availabilityEmphasis).toBe(false);
  });

  it('retrait de la préférence → availabilityEmphasis repasse à false', async () => {
    await setAvailabilityPref('av-toggle', true);
    expect((await search('av-toggle')).availabilityEmphasis).toBe(true);
    const { default: supertest } = await import('supertest');
    await supertest(app).delete('/profile/av-toggle/criterion/availability-preference');
    expect((await search('av-toggle')).availabilityEmphasis).toBe(false);
  });
});
