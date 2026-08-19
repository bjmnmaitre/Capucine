/**
 * Tests d'intégration — première interface utilisable.
 *
 * Vérifie deux choses qui n'étaient couvertes par aucun test existant :
 * 1. Le frontend statique (public/) est réellement servi par le même
 *    serveur Express que l'API (pas un second serveur, pas de CORS requis).
 * 2. Les champs matchQuality (libellé traduit, jamais la valeur technique
 *    brute) et offerUrl (null si aucune URL vérifiée — jamais inventée)
 *    sont réellement présents dans la réponse POST /search.
 */

import { buildApp } from '../../src/api/server';
import type { Application } from 'express';

async function postSearch(app: Application, body: Record<string, unknown>) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/search').send(body).set('Content-Type', 'application/json');
}

async function getPath(app: Application, p: string) {
  const { default: supertest } = await import('supertest');
  return supertest(app).get(p);
}

describe('Première interface — fichiers statiques', () => {
  let app: Application;

  beforeAll(() => {
    app = buildApp();
  });

  it('sert index.html à la racine', async () => {
    const res = await getPath(app, '/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Capucine');
  });

  it('sert app.js', async () => {
    const res = await getPath(app, '/app.js');
    expect(res.status).toBe(200);
  });

  it('sert style.css', async () => {
    const res = await getPath(app, '/style.css');
    expect(res.status).toBe(200);
  });

  it("les routes API restent prioritaires sur le statique (pas de collision)", async () => {
    const res = await getPath(app, '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Première interface — champs matchQuality et offerUrl dans /search', () => {
  let app: Application;

  beforeAll(() => {
    app = buildApp();
  });

  it('chaque résultat porte un matchQuality en langage utilisateur, jamais la valeur technique brute', async () => {
    const res = await postSearch(app, { query: 'casque audio bluetooth' });
    expect(res.status).toBe(200);

    if (res.body.results.length > 0) {
      for (const r of res.body.results) {
        expect(r).toHaveProperty('matchQuality');
        expect(typeof r.matchQuality).toBe('string');
        // Jamais la valeur technique brute exposée à l'utilisateur (§9 du mégaprompt)
        expect(r.matchQuality).not.toMatch(/^(exact_match|close_match|partial_match|alternative|unknown)$/);
      }
    }
  });

  it("chaque résultat porte un offerUrl (string ou null — jamais une URL inventée)", async () => {
    const res = await postSearch(app, { query: 'ordinateur portable' });
    expect(res.status).toBe(200);

    for (const r of res.body.results) {
      expect(r).toHaveProperty('offerUrl');
      expect(r.offerUrl === null || typeof r.offerUrl === 'string').toBe(true);
    }
  });
});
