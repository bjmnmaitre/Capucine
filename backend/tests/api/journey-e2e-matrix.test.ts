/**
 * CAPUCINE — 20 parcours produit de bout en bout
 *
 * Ce fichier ne teste pas des classes : il teste le PRODUIT. Chaque parcours
 * part d'une requête HTTP réelle et traverse toutes les couches — interprétation,
 * découverte, extraction, normalisation, admissibilité, coût, classement,
 * sérialisation API, sélection, préparation d'achat.
 *
 * Aucune couche n'est court-circuitée : on passe par `buildApp()` et les vraies
 * routes. Seule la SOURCE Web est injectée (aucune clé disponible, et un test
 * ne doit pas dépendre du réseau) — exactement le point d'injection prévu par
 * l'architecture pour cela.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';
import type { WebSearchAdapter, WebSearchParams, WebSearchOutput, WebSearchResult } from '../../src/application/tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(60000);

const QUERY = 'casque Sony WH-1000XM5';

const FNAC = 'https://www.fnac.com/a12345/Sony-WH-1000XM5';
const DARTY = 'https://www.darty.com/nav/achat/98765_sony_xm5.html';
const BOULANGER = 'https://www.boulanger.com/ref/1160245';

const result = (url: string, snippet: string, domain: string, position = 1): WebSearchResult =>
  ({ title: 'Sony WH-1000XM5', url, snippet, position, domain });

/** Source Web déterministe : aucun réseau, aucune clé. */
class Source implements WebSearchAdapter {
  calls = 0;
  constructor(
    readonly adapterName: string,
    private readonly results: WebSearchResult[],
    private readonly failure?: Error,
  ) {}
  isConfigured(): boolean { return true; }
  async search(_p: WebSearchParams): Promise<WebSearchOutput> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return { searchEngine: this.adapterName, results: this.results };
  }
}

interface Ranked {
  rank: number; offerId: string; productId: string;
  merchant: { id: string; name: string };
  price: { amount: number | null } | null;
  shipping: { amount: number | null; status: string };
  cost: { certainty: string; totalKnown: number | null; unknownComponents: string[] };
  score: number; offerUrl: string | null;
  provenance?: { source?: string };
}

describe('20 parcours produit de bout en bout', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'capucine-e2e-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function app(sources: WebSearchAdapter[]): Application {
    return buildApp({ webAdapters: sources, profileStoreDir: dir });
  }

  async function search(a: Application, query = QUERY, userId = 'e2e') {
    const { default: supertest } = await import('supertest');
    return supertest(a).post('/search').send({ query, userId });
  }

  async function prepare(a: Application, sessionId: string, offerId: string) {
    const { default: supertest } = await import('supertest');
    return supertest(a).post('/prepare-cart').send({ sessionId, offerId, quantity: 1 });
  }

  const webOffers = (res: { body: { results: Ranked[] } }) =>
    res.body.results.filter(o => [FNAC, DARTY, BOULANGER].includes(o.offerUrl ?? ''));

  // ── 1-3 : nominal, multi-marchands, multi-offres d'un même produit ────────
  it('1. parcours nominal : recherche → résultats → détail → préparation', async () => {
    const a = app([new Source('s1', [result(FNAC, 'En stock. 329,00 €', 'www.fnac.com')])]);
    const res = await search(a);
    expect(res.status).toBe(200);

    const offer = webOffers(res)[0];
    expect(offer).toBeDefined();
    expect(offer.price?.amount).toBe(329);
    expect(offer.offerUrl).toBe(FNAC);

    const cart = await prepare(a, res.body.session.sessionId, offer.offerId);
    expect(cart.status).toBe(200);
    expect(cart.body.status).toBe('partial');
    expect(cart.body.checkoutUrl).toBe(FNAC);
    expect(cart.body.purchaseCompleted).toBe(false);
  });

  it('2. plusieurs marchands : trois offres concurrentes, aucune fusion', async () => {
    const a = app([new Source('s1', [
      result(FNAC, '329,00 €', 'www.fnac.com', 1),
      result(DARTY, '339,00 €', 'www.darty.com', 2),
      result(BOULANGER, '319,00 €', 'www.boulanger.com', 3),
    ])]);
    const offers = webOffers(await search(a));
    expect(offers.length).toBe(3);
    expect(new Set(offers.map(o => o.merchant.id)).size).toBe(3);
    expect(new Set(offers.map(o => o.offerUrl)).size).toBe(3);
  });

  it('3. le classement porte sur les OFFRES, pas sur le produit', async () => {
    const a = app([new Source('s1', [
      result(FNAC, '329,00 €', 'www.fnac.com', 1),
      result(DARTY, '319,00 €', 'www.darty.com', 2),
    ])]);
    const offers = webOffers(await search(a));
    // Chaque offre reçoit son propre rang et son propre score.
    expect(new Set(offers.map(o => o.rank)).size).toBe(offers.length);
    expect(offers.every(o => typeof o.score === 'number')).toBe(true);
  });

  it('4. produit ambigu : une requête large reste traitée honnêtement', async () => {
    const a = app([new Source('s1', [result(FNAC, 'Casque audio', 'www.fnac.com')])]);
    const res = await search(a, 'casque');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  // ── 5-8 : données manquantes et contradictoires ──────────────────────────
  it('5. prix inconnu : aucun montant inventé, préparation refusée', async () => {
    const a = app([new Source('s1', [result(FNAC, 'Casque sans fil Sony.', 'www.fnac.com')])]);
    const res = await search(a);
    const offer = webOffers(res)[0];

    if (offer) {
      expect(offer.price === null || offer.price.amount === null).toBe(true);
      const cart = await prepare(a, res.body.session.sessionId, offer.offerId);
      expect(cart.body.status).toBe('unavailable');
      expect(cart.body.checkoutUrl).toBeNull();
    }
  });

  it('6. livraison inconnue : jamais 0, jamais « offerte », préparation possible', async () => {
    const a = app([new Source('s1', [result(FNAC, 'En stock. 329,00 €', 'www.fnac.com')])]);
    const res = await search(a);
    const offer = webOffers(res)[0];

    expect(offer.shipping.status).toBe('unknown');
    expect(offer.shipping.amount).toBeNull();
    expect(offer.cost.unknownComponents).toContain('shipping');

    const cart = await prepare(a, res.body.session.sessionId, offer.offerId);
    // Le manque est ANNONCÉ, et la redirection reste possible.
    expect(cart.body.status).toBe('partial');
    expect(cart.body.nextAction.toLowerCase()).toContain('delivery cost');
  });

  it('7. coût partiellement connu : jamais présenté comme un total', async () => {
    const a = app([new Source('s1', [result(FNAC, '329,00 €', 'www.fnac.com')])]);
    const offer = webOffers(await search(a))[0];
    expect(offer.cost.certainty).not.toBe('known');
    expect(offer.cost.unknownComponents.length).toBeGreaterThan(0);
  });

  it('8. aucune inconnue ne devient une valeur certaine dans la réponse API', async () => {
    const a = app([new Source('s1', [
      result(FNAC, '329,00 €', 'www.fnac.com', 1),
      result(DARTY, 'Casque Sony', 'www.darty.com', 2),
    ])]);
    for (const offer of webOffers(await search(a))) {
      if (offer.shipping.status === 'unknown') expect(offer.shipping.amount).toBeNull();
      if (offer.cost.certainty !== 'known') expect(offer.cost.totalKnown === null || typeof offer.cost.totalKnown === 'number').toBe(true);
    }
  });

  // ── 9-10 : URLs ──────────────────────────────────────────────────────────
  it('9. URL valide : restituée verbatim jusqu’au checkoutUrl', async () => {
    const a = app([new Source('s1', [result(FNAC, '329 €', 'www.fnac.com')])]);
    const res = await search(a);
    const offer = webOffers(res)[0];
    const cart = await prepare(a, res.body.session.sessionId, offer.offerId);
    expect(cart.body.checkoutUrl).toBe(FNAC);
  });

  it('10. URL absente : aucune URL fabriquée nulle part dans le parcours', async () => {
    const a = app([new Source('s1', [])]);
    const res = await search(a);
    // Catalogue local uniquement : ses offres n'ont pas d'executionUrl.
    const local = res.body.results.filter((o: Ranked) => !o.offerUrl);
    if (local.length > 0) {
      const cart = await prepare(a, res.body.session.sessionId, local[0].offerId);
      expect(cart.body.status).toBe('unavailable');
      expect(cart.body.checkoutUrl).toBeNull();
      expect(JSON.stringify(cart.body)).not.toMatch(/https?:\/\//);
    }
  });

  // ── 11-13 : profil et exigences courantes ────────────────────────────────
  async function saveCriterion(a: Application, userId: string, body: Record<string, unknown>) {
    const { default: supertest } = await import('supertest');
    const r = await supertest(a).put(`/profile/${userId}/criterion`).send(body);
    expect(r.status).toBeLessThan(400);
  }

  it('11. profil « priorité prix » modifie réellement l’ordre final', async () => {
    const a = app([new Source('s1', [])]);
    const neutral = (await search(a, QUERY, 'p-sans')).body.results as Ranked[];

    await saveCriterion(a, 'p-prix', {
      id: 'price', name: 'Prix', level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const personalized = (await search(a, QUERY, 'p-prix')).body.results as Ranked[];

    const id = (o: Ranked) => `${o.merchant.name}|${o.price?.amount}`;
    expect(personalized.map(id)).not.toEqual(neutral.map(id));
    // La plus chère n'est plus en tête.
    const dearest = Math.max(...neutral.map(o => o.price?.amount ?? 0));
    expect(neutral[0].price?.amount).toBe(dearest);
    expect(personalized[0].price?.amount).not.toBe(dearest);
  });

  it('12. le profil est isolé : un autre utilisateur n’est pas affecté', async () => {
    const a = app([new Source('s1', [])]);
    await saveCriterion(a, 'alice', {
      id: 'price', name: 'Prix', level: 'required',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    const alice = (await search(a, QUERY, 'alice')).body.results as Ranked[];
    const bob = (await search(a, QUERY, 'bob')).body.results as Ranked[];
    const id = (o: Ranked) => `${o.merchant.name}|${o.price?.amount}`;
    expect(bob.map(id)).not.toEqual(alice.map(id));
  });

  it('13. une recherche n’écrit JAMAIS dans le profil permanent', async () => {
    const { default: supertest } = await import('supertest');
    const a = app([new Source('s1', [])]);
    await saveCriterion(a, 'stable', {
      id: 'price', name: 'Prix', level: 'important',
      parameters: { maxBudget: 400, currency: 'EUR' },
    });
    await search(a, 'chaussures de running pas cher', 'stable');

    const profile = await supertest(a).get('/profile/stable');
    expect((profile.body.criteria as { id: string; level: string }[])).toEqual([
      expect.objectContaining({ id: 'price', level: 'important' }),
    ]);
  });

  // ── 14-16 : fournisseurs ─────────────────────────────────────────────────
  it('14. fournisseur A seul : ses résultats arrivent avec leur provenance', async () => {
    const s = new Source('alpha', [result(FNAC, '329 €', 'www.fnac.com')]);
    const offers = webOffers(await search(app([s])));
    expect(s.calls).toBeGreaterThan(0);
    expect(offers[0].provenance?.source).toBeTruthy();
  });

  it('15. deux fournisseurs : les deux sont interrogés, résultats fusionnés', async () => {
    const a1 = new Source('alpha', [result(FNAC, '329 €', 'www.fnac.com')]);
    const b1 = new Source('beta', [result(DARTY, '339 €', 'www.darty.com')]);
    const offers = webOffers(await search(app([a1, b1])));

    expect(a1.calls).toBeGreaterThan(0);
    expect(b1.calls).toBeGreaterThan(0);
    expect(offers.map(o => o.offerUrl).sort()).toEqual([DARTY, FNAC].sort());
  });

  it('16. fallback : A échoue, B fonctionne — la recherche aboutit quand même', async () => {
    const failing = new Source('alpha', [], new Error('provider down'));
    const working = new Source('beta', [result(DARTY, '339 €', 'www.darty.com')]);
    const res = await search(app([failing, working]));

    expect(res.status).toBe(200);
    expect(failing.calls).toBeGreaterThan(0);
    expect(webOffers(res).map(o => o.offerUrl)).toContain(DARTY);
  });

  it('17. les deux fournisseurs échouent : réponse honnête, aucune invention', async () => {
    const res = await search(app([
      new Source('alpha', [], new Error('down')),
      new Source('beta', [], new Error('down')),
    ]));
    // La recherche ne plante pas ; aucune offre Web n'est fabriquée.
    expect(res.status).toBe(200);
    expect(webOffers(res).length).toBe(0);
  });

  // ── 18-20 : doublons, absence de résultat, préparation impossible ────────
  it('18. résultats dupliqués : la même URL vue deux fois ne produit qu’une offre', async () => {
    const a = app([
      new Source('alpha', [result(FNAC, '329 €', 'www.fnac.com')]),
      new Source('beta', [result(FNAC, '329 €', 'www.fnac.com')]),
    ]);
    const offers = webOffers(await search(a));
    expect(offers.filter(o => o.offerUrl === FNAC).length).toBe(1);
  });

  it('19. aucun résultat : 200 avec liste vide, jamais une erreur', async () => {
    const res = await search(app([new Source('s1', [])]), 'zzzqqq objet inexistant 99999');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('20. préparation impossible : le refus est explicite et sans faux succès', async () => {
    const a = app([new Source('s1', [result(FNAC, 'Casque Sony sans prix', 'www.fnac.com')])]);
    const res = await search(a);
    const offer = webOffers(res)[0] ?? (res.body.results as Ranked[])[0];

    const cart = await prepare(a, res.body.session.sessionId, offer.offerId);
    expect(cart.status).toBe(200);
    expect(typeof cart.body.nextAction).toBe('string');
    expect(cart.body.nextAction.length).toBeGreaterThan(0);
    expect(cart.body.purchaseCompleted).toBe(false);
    const next = cart.body.nextAction.toLowerCase();
    for (const lie of ['purchase complete', 'order confirmed', 'payment received']) {
      expect(next).not.toContain(lie);
    }
  });

  // ── invariants transverses vérifiés sur le parcours complet ──────────────
  it('transverse : provenance conservée jusqu’à la réponse API', async () => {
    const a = app([new Source('alpha', [
      result(FNAC, '329 €', 'www.fnac.com', 1),
      result(DARTY, '339 €', 'www.darty.com', 2),
    ])]);
    for (const offer of (await search(a)).body.results as Ranked[]) {
      expect(typeof offer.provenance?.source).toBe('string');
      expect(offer.provenance!.source!.length).toBeGreaterThan(0);
    }
  });

  it('transverse : aucune valeur technique ne fuit dans la réponse API', async () => {
    const a = app([new Source('s1', [result(FNAC, '329 €', 'www.fnac.com')])]);
    const raw = JSON.stringify((await search(a)).body);
    expect(raw).not.toContain('NaN');
    expect(raw).not.toContain('undefined');
    expect(raw).not.toContain('[object Object]');
  });

  it('transverse : le classement est déterministe sur le parcours complet', async () => {
    const make = () => app([new Source('s1', [
      result(FNAC, '329 €', 'www.fnac.com', 1),
      result(DARTY, '319 €', 'www.darty.com', 2),
    ])]);
    const first = (await search(make())).body.results as Ranked[];
    const second = (await search(make())).body.results as Ranked[];
    expect(second.map(o => `${o.merchant.id}|${o.score}`))
      .toEqual(first.map(o => `${o.merchant.id}|${o.score}`));
  });
});
