/**
 * CAPUCINE — matrice d'honnêteté du coût, au niveau du contrat produit
 *
 * CostEngine est testé unitairement, mais rien ne vérifiait ce que l'API
 * RENVOIE réellement à l'application pour chaque combinaison connu/inconnu/
 * contradictoire. C'est pourtant ce payload qui décide de ce que l'utilisateur
 * lit : « 329 € », « 329 € + livraison inconnue », ou « coût indéterminable ».
 *
 * La règle vérifiée partout ici : une composante absente reste absente. Elle
 * n'est jamais sommée comme 0, jamais appelée « offerte », jamais fondue dans
 * un total présenté comme final.
 */
import { buildApp } from '../../src/api/server';
import type { Application } from 'express';
import type { WebSearchAdapter, WebSearchOutput } from '../../src/application/tools';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(30000);

/** Fournisseur déterministe : un snippet AVEC prix, un snippet SANS prix. */
class CostStubAdapter implements WebSearchAdapter {
  readonly adapterName = 'cost-stub';
  constructor(private readonly snippet: string) {}
  isConfigured(): boolean { return true; }
  async search(): Promise<WebSearchOutput> {
    return {
      searchEngine: 'cost-stub',
      results: [{
        title: 'Sony WH-1000XM5 Noir',
        url: 'https://www.fnac.com/a12345/Sony-WH-1000XM5',
        snippet: this.snippet,
        position: 1,
        domain: 'www.fnac.com',
      }],
    };
  }
}

interface CostShape {
  totalKnown: number | null;
  certainty: 'known' | 'partially_known' | 'unknown';
  unknownComponents: string[];
  componentStates?: Record<string, string>;
  statement?: string | null;
}
interface Offer {
  offerUrl: string | null;
  price: { amount: number | null } | null;
  shipping: { amount: number | null; status: string };
  cost: CostShape;
}

describe('Matrice d’honnêteté du coût, telle que l’API la renvoie', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-cost-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function offersFrom(app: Application): Promise<Offer[]> {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app)
      .post('/search')
      .send({ query: 'casque Sony WH-1000XM5', userId: 'cost-user' });
    expect(res.status).toBe(200);
    return res.body.results as Offer[];
  }

  it('prix connu + livraison inconnue → total JAMAIS présenté comme final', async () => {
    const app = buildApp({
      webAdapters: [new CostStubAdapter('En stock. 329,00 €')],
      profileStoreDir: dir,
    });
    const web = (await offersFrom(app)).find(o => o.offerUrl?.includes('fnac'));
    expect(web).toBeDefined();

    expect(web!.price?.amount).toBe(329);
    expect(web!.shipping.status).toBe('unknown');
    // Le point central : la livraison inconnue n'est pas comptée comme 0.
    expect(web!.shipping.amount).toBeNull();
    expect(web!.cost.certainty).not.toBe('known');
    expect(web!.cost.unknownComponents).toContain('shipping');
    // totalKnown est la somme du CONNU, et la certitude dit qu'il est partiel.
    expect(web!.cost.totalKnown).toBe(329);
  });

  it('prix inconnu → aucun montant inventé, la composante est nommée', async () => {
    const app = buildApp({
      // Snippet sans aucun prix analysable.
      webAdapters: [new CostStubAdapter('Casque Sony WH-1000XM5 sans fil.')],
      profileStoreDir: dir,
    });
    const web = (await offersFrom(app)).find(o => o.offerUrl?.includes('fnac'));

    if (web) {
      // L'API renvoie `price: null` — jamais `amount: 0`.
      expect(web.price === null || web.price.amount === null).toBe(true);
      expect(web.cost.certainty).not.toBe('known');
      expect(web.cost.unknownComponents.length).toBeGreaterThan(0);
    }
  });

  it('toute composante déclarée inconnue est nommée dans unknownComponents', async () => {
    const app = buildApp({ profileStoreDir: dir });
    for (const offer of await offersFrom(app)) {
      const states = offer.cost.componentStates ?? {};
      for (const [name, state] of Object.entries(states)) {
        if (state === 'unknown') {
          // Aucune inconnue silencieuse : l'interface peut toutes les citer.
          expect(offer.cost.unknownComponents).toContain(name);
        }
      }
    }
  });

  it("certainty 'known' n'est jamais annoncée s'il reste une composante inconnue", async () => {
    const app = buildApp({ profileStoreDir: dir });
    for (const offer of await offersFrom(app)) {
      if (offer.cost.certainty === 'known') {
        expect(offer.cost.unknownComponents).toEqual([]);
      } else {
        expect(offer.cost.unknownComponents.length).toBeGreaterThan(0);
      }
    }
  });

  it('la phrase de coût dit ce qui manque au lieu de le taire', async () => {
    const app = buildApp({ profileStoreDir: dir });
    const offers = await offersFrom(app);
    const partial = offers.find(o => o.cost.certainty === 'partially_known');

    if (partial?.cost.statement) {
      // Elle qualifie explicitement le total et ne le donne pas pour final.
      expect(partial.cost.statement.toLowerCase()).toMatch(/partiel|au moins|inconnu/);
    }
  });

  it('livraison connue à 0 : « offerte » est un fait, distinct de « inconnue »', async () => {
    const app = buildApp({ profileStoreDir: dir });
    const offers = await offersFrom(app);
    const free = offers.find(o => o.shipping.amount === 0);

    if (free) {
      // Une gratuité RÉELLE porte le statut 'known' — c'est ce statut, et non
      // le montant, qui autorise l'interface à écrire « livraison offerte ».
      expect(free.shipping.status).not.toBe('unknown');
    }
    // Et réciproquement : aucune livraison 'unknown' ne porte un montant.
    for (const offer of offers) {
      if (offer.shipping.status === 'unknown') {
        expect(offer.shipping.amount).toBeNull();
      }
    }
  });
});
