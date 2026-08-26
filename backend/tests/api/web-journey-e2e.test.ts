/**
 * CAPUCINE — parcours complet sur une offre issue du WEB (sans réseau, sans clé)
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * Sans BRAVE_API_KEY / SERPER_API_KEY, `detectWebSearchAdapters()` renvoie le
 * NoOp : la découverte Web s'exécute mais ne reçoit jamais rien, et toutes les
 * offres viennent du catalogue local — lequel n'a AUCUN executionUrl, si bien
 * que /prepare-cart répond systématiquement 'unavailable'. La moitié du
 * parcours produit n'était donc jamais exercée.
 *
 * Ce test injecte un adaptateur de recherche déterministe (fixture locale,
 * aucun appel réseau) pour parcourir la chaîne réelle de bout en bout :
 *   /search → RealWebDiscoveryStrategy → normalisation → admissibilité
 *           → coût → ranking → /prepare-cart → checkoutUrl
 *
 * Il ne fabrique aucune donnée de production : la fixture est une entrée de
 * test, exactement comme les pages HTML de product-page-extractor.test.ts. Ce
 * qu'il prouve, c'est que le jour où une clé est fournie, le parcours aboutit.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';
import type { WebSearchAdapter, WebSearchParams, WebSearchOutput } from '../../src/application/tools';

const MERCHANT_A_URL = 'https://www.fnac.com/a12345/Sony-WH-1000XM5-Noir';
const MERCHANT_B_URL = 'https://www.boulanger.com/ref/1160245';

/**
 * Adaptateur déterministe. Il renvoie deux pages produit de DEUX marchands
 * différents pour le MÊME produit — le cas qui distingue Capucine d'un moteur
 * de recherche : deux offres concurrentes, jamais fusionnées.
 */
class StubWebSearchAdapter implements WebSearchAdapter {
  readonly adapterName = 'stub-test';
  calls: WebSearchParams[] = [];

  isConfigured(): boolean {
    return true;
  }

  async search(params: WebSearchParams): Promise<WebSearchOutput> {
    this.calls.push(params);
    return {
      searchEngine: 'stub-test',
      results: [
        {
          title: 'Sony WH-1000XM5 Casque Bluetooth à réduction de bruit — Noir',
          url: MERCHANT_A_URL,
          snippet: 'Casque Sony WH-1000XM5 sans fil, réduction de bruit. En stock. 329,00 €',
          position: 1,
          domain: 'www.fnac.com',
        },
        {
          title: 'Casque Sony WH-1000XM5 Noir',
          url: MERCHANT_B_URL,
          snippet: 'Sony WH-1000XM5, casque arceau Bluetooth. 335,00 €',
          position: 2,
          domain: 'www.boulanger.com',
        },
      ],
    };
  }
}

// Ce fichier exécute le moteur complet (interprétation, découverte,
// normalisation, admissibilité, coût, classement) plusieurs fois par test.
// Le défaut de 5 s de Jest suffit isolément, mais pas quand toute la suite
// tourne en parallèle sur la même machine — d'où un plafond explicite.
jest.setTimeout(30000);

describe('Parcours produit complet sur des offres issues du Web', () => {
  let app: Application;
  let adapter: StubWebSearchAdapter;

  beforeEach(() => {
    adapter = new StubWebSearchAdapter();
    // Le seam d'injection : la production continue d'utiliser
    // detectWebSearchAdapters(), le test fournit sa propre source.
    app = buildApp({ webAdapters: [adapter] });
  });

  async function runSearch(query: string) {
    const { default: supertest } = await import('supertest');
    return supertest(app).post('/search').send({ query, userId: 'e2e-user' });
  }

  it('la source Web est réellement interrogée (elle n’est pas court-circuitée)', async () => {
    await runSearch('casque Sony WH-1000XM5');
    expect(adapter.calls.length).toBeGreaterThan(0);
    // La requête envoyée au fournisseur doit porter les termes de l'utilisateur.
    const joined = JSON.stringify(adapter.calls).toLowerCase();
    expect(joined).toContain('sony');
  });

  it('les offres du Web arrivent dans les résultats avec leur URL réelle, jamais fabriquée', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    expect(res.status).toBe(200);

    const webOffers = (res.body.results as { offerUrl: string | null }[]).filter(
      o => o.offerUrl === MERCHANT_A_URL || o.offerUrl === MERCHANT_B_URL
    );
    expect(webOffers.length).toBeGreaterThan(0);

    // Toute URL présente est soit une des URL réellement fournies, soit null.
    for (const offer of res.body.results as { offerUrl: string | null }[]) {
      if (offer.offerUrl !== null && offer.offerUrl !== undefined) {
        expect([MERCHANT_A_URL, MERCHANT_B_URL]).toContain(offer.offerUrl);
      }
    }
  });

  it('deux marchands du même produit restent deux offres concurrentes', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    const urls = (res.body.results as { offerUrl: string | null }[])
      .map(o => o.offerUrl)
      .filter((u): u is string => u !== null && u !== undefined);

    expect(urls).toContain(MERCHANT_A_URL);
    expect(urls).toContain(MERCHANT_B_URL);
    // Aucune fusion : deux URL distinctes = deux offres distinctes.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('chaque offre du Web conserve une provenance exploitable', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    for (const offer of res.body.results as { provenance?: { source?: string } }[]) {
      expect(typeof offer.provenance?.source).toBe('string');
      expect(offer.provenance!.source!.length).toBeGreaterThan(0);
    }
  });

  it('le coût reste honnête : rien d’inconnu n’est compté comme zéro', async () => {
    const res = await runSearch('casque Sony WH-1000XM5');
    for (const offer of res.body.results as {
      cost: { certainty: string; unknownComponents: string[]; componentStates?: Record<string, string> };
      shipping: { amount: number | null; status: string };
    }[]) {
      if (offer.cost.certainty !== 'known') {
        expect(offer.cost.unknownComponents.length).toBeGreaterThan(0);
      }
      // Une livraison inconnue ne devient jamais 0 (= offerte).
      if (offer.shipping.status === 'unknown') {
        expect(offer.shipping.amount).toBeNull();
      }
    }
  });

  it("LE PARCOURS ABOUTIT : une offre du Web mène à une vraie redirection marchand", async () => {
    const { default: supertest } = await import('supertest');
    const search = await runSearch('casque Sony WH-1000XM5');
    const sessionId = search.body.session.sessionId as string;

    const webOffer = (search.body.results as {
      offerId: string; offerUrl: string | null; shipping: { status: string; amount: number | null };
    }[]).find(o => o.offerUrl === MERCHANT_A_URL || o.offerUrl === MERCHANT_B_URL);
    expect(webOffer).toBeDefined();

    // La livraison reste inconnue : un snippet n'en publie pas.
    expect(webOffer!.shipping.status).toBe('unknown');
    expect(webOffer!.shipping.amount).toBeNull();

    const res = await supertest(app)
      .post('/prepare-cart')
      .send({ sessionId, offerId: webOffer!.offerId, quantity: 1 });

    expect(res.status).toBe(200);
    // Ce que le catalogue local ne permettait pas : un panier réellement
    // exploitable, avec l'URL du marchand telle qu'elle a été découverte.
    expect(res.body.status).toBe('partial');
    expect(res.body.checkoutUrl).toBe(webOffer!.offerUrl);

    // Et la livraison inconnue est DITE, jamais transformée en gratuité.
    const next = (res.body.nextAction as string).toLowerCase();
    expect(next).toContain('delivery cost');
    expect(next).toContain('not reported');
    expect(next).not.toContain('free delivery');

    // Malgré la redirection : aucun achat, aucun paiement.
    expect(res.body.purchaseCompleted).toBe(false);
    expect(next).toContain('merchant');
  });

  it("un prix inconnu ferme le parcours même sur une offre du Web avec URL réelle", async () => {
    const { default: supertest } = await import('supertest');
    // Un snippet sans prix analysable : l'offre existe, son prix reste inconnu.
    const priceless = new (class extends StubWebSearchAdapter {
      async search(params: WebSearchParams): Promise<WebSearchOutput> {
        const base = await super.search(params);
        return {
          ...base,
          results: [{ ...base.results[0], snippet: 'Casque Sony WH-1000XM5 sans fil.' }],
        };
      }
    })();
    const priceApp = buildApp({ webAdapters: [priceless] });

    const search = await supertest(priceApp)
      .post('/search')
      .send({ query: 'casque Sony WH-1000XM5', userId: 'e2e-user' });

    const offer = (search.body.results as {
      offerId: string; offerUrl: string | null; price: { amount: number | null } | null;
    }[]).find(o => o.offerUrl === MERCHANT_A_URL);

    if (offer) {
      // Prix inconnu : l'API renvoie `price: null` — jamais un montant à 0.
      // Le client DOIT donc traiter ce champ comme nullable (voir
      // frontend/src/types.ts, RankedOffer.price).
      expect(offer.price === null || offer.price.amount === null).toBe(true);
      const res = await supertest(priceApp)
        .post('/prepare-cart')
        .send({ sessionId: search.body.session.sessionId, offerId: offer.offerId, quantity: 1 });
      expect(res.body.status).toBe('unavailable');
      expect(res.body.checkoutUrl).toBeNull();
      expect(res.body.nextAction.toLowerCase()).toContain('price');
    }
  });

  it('préparer un panier ne prétend jamais avoir payé', async () => {
    const { default: supertest } = await import('supertest');
    const search = await runSearch('casque Sony WH-1000XM5');
    const sessionId = search.body.session.sessionId as string;
    const offer = search.body.results[0];

    const res = await supertest(app)
      .post('/prepare-cart')
      .send({ sessionId, offerId: offer.offerId, quantity: 1 });

    expect(res.body.purchaseCompleted).toBe(false);
    // Le message rendu à l'utilisateur doit dire que le paiement se fait chez
    // le marchand — jamais qu'il a été effectué.
    expect(res.body.nextAction.toLowerCase()).not.toContain('purchase complete');
    expect(res.body.nextAction.toLowerCase()).not.toContain('order confirmed');
  });

  it('MULTI-FOURNISSEUR : deux sources sont interrogées et leurs offres fusionnées', async () => {
    const { default: supertest } = await import('supertest');

    // Un second fournisseur, distinct, avec un marchand que le premier ne
    // renvoie pas. Capucine ne doit dépendre conceptuellement d'aucun moteur.
    const THIRD_URL = 'https://www.darty.com/nav/achat/12345_sony_wh1000xm5.html';
    class SecondAdapter implements WebSearchAdapter {
      readonly adapterName = 'stub-second';
      calls = 0;
      isConfigured(): boolean { return true; }
      async search(): Promise<WebSearchOutput> {
        this.calls += 1;
        return {
          searchEngine: 'stub-second',
          results: [{
            title: 'Sony WH-1000XM5 — Darty',
            url: THIRD_URL,
            snippet: 'Casque Sony WH-1000XM5 Bluetooth. 339,00 €',
            position: 1,
            domain: 'www.darty.com',
          }],
        };
      }
    }

    const first = new StubWebSearchAdapter();
    const second = new SecondAdapter();
    const multiApp = buildApp({ webAdapters: [first, second] });

    const res = await supertest(multiApp)
      .post('/search')
      .send({ query: 'casque Sony WH-1000XM5', userId: 'multi-user' });

    // Les DEUX sources ont réellement été appelées.
    expect(first.calls.length).toBeGreaterThan(0);
    expect(second.calls).toBeGreaterThan(0);

    const urls = (res.body.results as { offerUrl: string | null }[])
      .map(o => o.offerUrl)
      .filter((u): u is string => typeof u === 'string');

    // Les résultats des deux fournisseurs coexistent, sans fusion abusive.
    expect(urls).toContain(MERCHANT_A_URL);
    expect(urls).toContain(THIRD_URL);

    // Chaque offre garde la provenance de la source qui l'a produite.
    const sources = new Set(
      (res.body.results as { provenance?: { source?: string } }[])
        .map(o => o.provenance?.source)
        .filter(Boolean)
    );
    expect(sources.size).toBeGreaterThan(0);
  });

  it('PROFIL ≠ RECHERCHE COURANTE : une préférence permanente survit à la recherche', async () => {
    const { default: supertest } = await import('supertest');
    const userId = 'profil-user';

    // Préférence permanente, stockée hors de toute recherche.
    const put = await supertest(app)
      .put(`/profile/${userId}/criterion`)
      .send({ id: 'livraison-fr', name: 'Livraison en France', level: 'important' });
    expect(put.status).toBeLessThan(400);

    // Une recherche courante s'exécute sans effacer ni modifier le profil.
    await supertest(app).post('/search').send({ query: 'casque Sony WH-1000XM5', userId });

    const profile = await supertest(app).get(`/profile/${userId}`);
    expect(profile.status).toBe(200);
    const ids = (profile.body.criteria as { id: string }[]).map(c => c.id);
    expect(ids).toContain('livraison-fr');

    // Et la recherche d'un AUTRE utilisateur ne voit pas cette préférence :
    // le profil est permanent, personnel, et distinct de la demande courante.
    const other = await supertest(app).get('/profile/autre-user');
    expect((other.body.criteria as unknown[]).length).toBe(0);
  });

  it('PERSISTANCE HTTP : une préférence survit à la reconstruction complète de l’app', async () => {
    const { default: supertest } = await import('supertest');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const nodePath = await import('node:path');

    const dir = await mkdtemp(nodePath.join(tmpdir(), 'capucine-e2e-profiles-'));
    try {
      // App n°1 : l'utilisateur enregistre une préférence.
      const app1 = buildApp({ webAdapters: [new StubWebSearchAdapter()], profileStoreDir: dir });
      const put = await supertest(app1)
        .put('/profile/benjamin/criterion')
        .send({ id: 'livraison-fr', name: 'Livraison en France', level: 'important' });
      expect(put.status).toBeLessThan(400);

      // App n°2 : instance entièrement neuve — équivalent d'un redémarrage du
      // backend. Rien n'est partagé en mémoire avec app1.
      const app2 = buildApp({ webAdapters: [new StubWebSearchAdapter()], profileStoreDir: dir });
      const get = await supertest(app2).get('/profile/benjamin');
      expect(get.status).toBe(200);
      expect((get.body.criteria as { id: string; level: string }[])).toEqual([
        expect.objectContaining({ id: 'livraison-fr', level: 'important' }),
      ]);

      // Et /search continue de charger ce profil après redémarrage.
      const search = await supertest(app2)
        .post('/search')
        .send({ query: 'casque Sony WH-1000XM5', userId: 'benjamin' });
      expect(search.status).toBe(200);

      // La recherche n'a pas altéré la préférence permanente : une demande
      // ponctuelle n'écrit jamais dans le profil.
      const after = await supertest(app2).get('/profile/benjamin');
      expect((after.body.criteria as { id: string }[]).map(c => c.id)).toEqual(['livraison-fr']);

      // La suppression est durable elle aussi, à travers une 3e instance.
      await supertest(app2).delete('/profile/benjamin/criterion/livraison-fr');
      const app3 = buildApp({ webAdapters: [new StubWebSearchAdapter()], profileStoreDir: dir });
      const final = await supertest(app3).get('/profile/benjamin');
      expect((final.body.criteria as unknown[]).length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('/health distingue une vraie source Web d’un serveur qui ne peut rien chercher', async () => {
    const { default: supertest } = await import('supertest');
    const withSource = await supertest(app).get('/health');
    expect(withSource.body.capabilities.webSearch.status).toBe('configured');
    expect(withSource.body.capabilities.webSearch.providers).toContain('stub-test');

    // Sans adaptateur réel, le statut ne doit PAS dire « configured ».
    const { NoOpWebSearchAdapter } = await import('../../src/application/web-search-adapters');
    const noSource = await supertest(buildApp({ webAdapters: [new NoOpWebSearchAdapter()] })).get('/health');
    expect(noSource.body.capabilities.webSearch.status).toBe('no_real_source');
    expect(noSource.body.capabilities.webSearch.providers).toEqual([]);
  });
});
