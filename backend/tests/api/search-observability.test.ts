/**
 * CAPUCINE — une recherche doit être diagnosticable, sans rien exposer.
 *
 * Jusqu'ici une recherche ne laissait AUCUNE trace serveur. Face à un vrai
 * fournisseur, il aurait été impossible de savoir quelle source a répondu,
 * combien d'offres ont survécu, ni pourquoi. Ces tests verrouillent les deux
 * moitiés du contrat : la trace existe, et elle ne contient ni clé ni
 * identifiant personnel.
 */
import { buildApp } from '../../src/api/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.setTimeout(30000);

describe('Observabilité de la recherche', () => {
  let dir: string;
  let lines: string[];
  let realLog: typeof console.log;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-obs-'));
    lines = [];
    realLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  });

  afterEach(async () => {
    console.log = realLog;
    await rm(dir, { recursive: true, force: true });
  });

  function searchLine(): Record<string, unknown> | null {
    const line = lines.find(l => l.includes('[CapucineAPI] search '));
    if (!line) return null;
    return JSON.parse(line.split('[CapucineAPI] search ')[1]) as Record<string, unknown>;
  }

  it('chaque recherche produit une ligne de diagnostic exploitable', async () => {
    const { default: supertest } = await import('supertest');
    const app = buildApp({ profileStoreDir: dir });
    await supertest(app).post('/search').send({ query: 'casque Sony WH-1000XM5', userId: 'u1' });

    const diag = searchLine();
    expect(diag).not.toBeNull();
    // De quoi répondre à « pourquoi ce résultat ? » sans relancer la recherche.
    for (const key of ['requestId', 'query', 'sources', 'offers', 'merchants',
                       'products', 'rejected', 'withUrl', 'cost', 'timingMs']) {
      expect(diag).toHaveProperty(key);
    }
    expect(typeof diag!.offers).toBe('number');
    expect(Array.isArray(diag!.sources)).toBe(true);
  });

  it('une recherche sans résultat est diagnosticable elle aussi', async () => {
    const { default: supertest } = await import('supertest');
    const app = buildApp({ profileStoreDir: dir });
    await supertest(app).post('/search').send({ query: 'zzzqqq objet inexistant 99999', userId: 'u2' });

    const diag = searchLine();
    expect(diag).not.toBeNull();
    // Zéro offre ET zéro source : on distingue « rien trouvé » de « aucune
    // source n'a répondu », ce qui n'appelle pas la même action.
    expect(diag!.offers).toBe(0);
    expect(diag!.sources).toEqual([]);
  });

  it("la trace ne contient JAMAIS l'identifiant utilisateur", async () => {
    const { default: supertest } = await import('supertest');
    const app = buildApp({ profileStoreDir: dir });
    await supertest(app)
      .post('/search')
      .send({ query: 'casque', userId: 'identifiant-personnel-a-ne-pas-tracer' });

    const joined = lines.join('\n');
    expect(joined).not.toContain('identifiant-personnel-a-ne-pas-tracer');
  });

  it("la trace ne contient JAMAIS de clé d'API", async () => {
    const { default: supertest } = await import('supertest');
    const saved = process.env['BRAVE_API_KEY'];
    process.env['BRAVE_API_KEY'] = 'valeur-secrete-de-test';
    try {
      const app = buildApp({ profileStoreDir: dir });
      await supertest(app).post('/search').send({ query: 'casque', userId: 'u3' });
      expect(lines.join('\n')).not.toContain('valeur-secrete-de-test');
    } finally {
      if (saved === undefined) delete process.env['BRAVE_API_KEY'];
      else process.env['BRAVE_API_KEY'] = saved;
    }
  });
});
