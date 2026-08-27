/**
 * CAPUCINE — un écran vide doit toujours dire POURQUOI, et proposer une issue
 *
 * Défaut réel, mesuré en parcourant l'application : un profil « livrable en
 * France » ramenait ZÉRO offre. Le diagnostic existait, mais :
 *
 *   1. il nommait le critère « Livrable, unknown » au lieu de « deliversTo » —
 *      parce que l'identifiant était retrouvé en analysant à l'expression
 *      régulière une PHRASE destinée à être lue ;
 *   2. faute de retrouver le critère, aucune option de sortie n'était
 *      proposée : l'utilisateur apprenait qu'une contrainte l'avait bloqué,
 *      sans jamais pouvoir l'assouplir.
 *
 * Les identifiants voyagent désormais structurellement, de l'admissibilité
 * jusqu'au diagnostic.
 */
import request from 'supertest';
import { buildApp } from '../../src/api/server';
import type { WebSearchAdapter, WebSearchResult } from '../../src/application/tools';

function fixedAdapter(urls: string[]): WebSearchAdapter {
  return {
    adapterName: 'fixture',
    isConfigured: () => true,
    async search() {
      return {
        searchEngine: 'fixture',
        results: urls.map((url, i) => ({
          title: 'Casque Sony WH-1000XM5',
          url, snippet: '329 € en stock',
          domain: new URL(url).hostname, position: i + 1,
        })) as WebSearchResult[],
      };
    },
  } as unknown as WebSearchAdapter;
}

const URLS = [
  'https://a.example/produit/casque-sony',
  'https://b.example/produit/casque-sony',
  'https://c.example/produit/casque-sony',
];

/** Critère requis portant sur une donnée que les marchands publient rarement. */
const CRITERE_RARE = {
  id: 'deliversTo',
  name: 'Livrable en France',
  level: 'required' as const,
  parameters: { preferredValues: ['FR'] },
};

describe('Diagnostic d’absence de résultats', () => {
  async function searchWithProfile(userId: string) {
    const app = buildApp({ webAdapters: [fixedAdapter(URLS)], enablePageEnrichment: false });
    await request(app).put(`/profile/${userId}/criterion`).send(CRITERE_RARE);
    return request(app).post('/search').send({ query: 'casque sony wh-1000xm5', userId });
  }

  it('un critère requis sur une donnée absente écarte tout — et le dit', async () => {
    const res = await searchWithProfile('u-diag-1');
    expect(res.body.results).toHaveLength(0);
    expect(res.body.noResultsDiagnosis).not.toBeNull();
    expect(res.body.noResultsDiagnosis.primaryCause).toBe('required_criterion_missing');
  });

  it('le critère est nommé correctement, pas déduit d’une phrase', () => {
    // Régression protégée : « Livrable, unknown » était le résultat d'une
    // analyse de prose. Le nom doit venir du critère lui-même.
    return searchWithProfile('u-diag-2').then((res) => {
      expect(res.body.noResultsDiagnosis.message).toContain('Livrable en France');
      expect(res.body.noResultsDiagnosis.message).not.toContain('unknown');
    });
  });

  it('au moins une issue concrète est proposée', async () => {
    const res = await searchWithProfile('u-diag-3');
    const options = res.body.noResultsDiagnosis.recoveryOptions;
    expect(options.length).toBeGreaterThan(0);
    // L'option doit désigner LE critère bloquant, pas un critère quelconque.
    expect(options.some((o: { description: string }) => o.description.includes('Livrable en France'))).toBe(true);
  });

  it('chaque issue demande confirmation — Capucine n’assouplit jamais toute seule', async () => {
    const res = await searchWithProfile('u-diag-4');
    for (const option of res.body.noResultsDiagnosis.recoveryOptions) {
      expect(option.requiresConfirmation).toBe(true);
    }
  });

  it('chaque issue annonce son effet, pour un choix éclairé', async () => {
    const res = await searchWithProfile('u-diag-5');
    for (const option of res.body.noResultsDiagnosis.recoveryOptions) {
      expect(typeof option.impact).toBe('string');
      expect(option.impact.length).toBeGreaterThan(0);
    }
  });

  it('le compte annoncé reste cohérent avec l’écran vide', async () => {
    const res = await searchWithProfile('u-diag-6');
    expect(res.body.summary.totalFound).toBe(0);
    expect(res.body.summary.totalRejected).toBeGreaterThan(0);
  });

  it('sans critère bloquant, aucun diagnostic n’est fabriqué', async () => {
    const app = buildApp({ webAdapters: [fixedAdapter(URLS)], enablePageEnrichment: false });
    const res = await request(app).post('/search').send({ query: 'casque sony wh-1000xm5', userId: 'u-diag-7' });
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.noResultsDiagnosis).toBeNull();
  });
});
