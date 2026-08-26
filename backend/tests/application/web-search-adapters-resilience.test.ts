/**
 * CAPUCINE — résilience des adaptateurs de recherche sur des réponses réelles
 *
 * Ces tests remplacent `fetch` par une réponse contrôlée : ils n'appellent
 * aucun réseau et ne demandent aucune clé réelle. Ce qu'ils protègent, ce sont
 * les comportements qui ne se manifestent que sur de VRAIES réponses de
 * fournisseur — entrées malformées, quotas, indisponibilité — et qui étaient
 * jusqu'ici invisibles parce que toutes les fixtures étaient parfaites.
 */
import { BraveSearchAdapter, SerperAdapter } from '../../src/application/web-search-adapters';

const realFetch = global.fetch;

function mockFetch(status: number, payload: unknown, statusText = '') {
  global.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe('Adaptateurs de recherche — réponses réelles et dégradées', () => {
  const KEY_BRAVE = 'BRAVE_API_KEY';
  const KEY_SERPER = 'SERPER_API_KEY';
  let savedBrave: string | undefined;
  let savedSerper: string | undefined;

  beforeEach(() => {
    savedBrave = process.env[KEY_BRAVE];
    savedSerper = process.env[KEY_SERPER];
    // Valeur factice UNIQUEMENT pour franchir le contrôle de présence : aucun
    // appel réseau n'a lieu, `fetch` étant remplacé ci-dessous.
    process.env[KEY_BRAVE] = 'test-not-a-real-key';
    process.env[KEY_SERPER] = 'test-not-a-real-key';
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (savedBrave === undefined) delete process.env[KEY_BRAVE]; else process.env[KEY_BRAVE] = savedBrave;
    if (savedSerper === undefined) delete process.env[KEY_SERPER]; else process.env[KEY_SERPER] = savedSerper;
  });

  it('sans clé, l’adaptateur refuse explicitement au lieu d’appeler le réseau', async () => {
    delete process.env[KEY_BRAVE];
    await expect(new BraveSearchAdapter().search({ query: 'x' })).rejects.toThrow(/NOT_EXECUTABLE/);
    expect(new BraveSearchAdapter().isConfigured()).toBe(false);
  });

  it('UNE URL malformée ne détruit plus TOUS les résultats de la recherche', async () => {
    mockFetch(200, {
      web: {
        results: [
          { title: 'Bon résultat', url: 'https://www.fnac.com/a1', description: '329 €' },
          { title: 'URL cassée', url: 'ht!tp://pas-une-url', description: 'x' },
          { title: 'Autre bon résultat', url: 'https://www.darty.com/a2', description: '339 €' },
        ],
      },
    });

    const out = await new BraveSearchAdapter().search({ query: 'casque' });
    // Auparavant : `new URL()` levait dans le .map() et la recherche entière
    // était perdue. Désormais, seule l'entrée inutilisable est écartée.
    expect(out.results.map(r => r.url)).toEqual([
      'https://www.fnac.com/a1',
      'https://www.darty.com/a2',
    ]);
    expect(out.results.every(r => r.domain.length > 0)).toBe(true);
  });

  it('un résultat sans URL est écarté, jamais émis avec une URL vide', async () => {
    mockFetch(200, {
      web: { results: [{ title: 'Sans lien', description: 'x' }, { title: 'Avec lien', url: 'https://a.fr/p' }] },
    });

    const out = await new BraveSearchAdapter().search({ query: 'x' });
    // Une URL vide voyagerait jusqu'à executionUrl : une offre annoncerait un
    // lien d'achat qu'elle n'a pas.
    expect(out.results.length).toBe(1);
    expect(out.results[0].url).toBe('https://a.fr/p');
    expect(out.results.some(r => r.url === '')).toBe(false);
  });

  it('un schéma non http(s) est refusé (javascript:, data:, file:)', async () => {
    mockFetch(200, {
      web: {
        results: [
          { title: 'js', url: 'javascript:alert(1)' },
          { title: 'data', url: 'data:text/html,<h1>x</h1>' },
          { title: 'file', url: 'file:///etc/passwd' },
          { title: 'ok', url: 'https://ok.fr/p' },
        ],
      },
    });

    const out = await new BraveSearchAdapter().search({ query: 'x' });
    expect(out.results.map(r => r.url)).toEqual(['https://ok.fr/p']);
  });

  it('un quota dépassé produit un message actionnable, sans exposer la clé', async () => {
    mockFetch(429, {}, 'Too Many Requests');
    const promise = new BraveSearchAdapter().search({ query: 'x' });
    await expect(promise).rejects.toThrow(/quota|rate limit/i);
    await expect(promise).rejects.not.toThrow(/test-not-a-real-key/);
  });

  it('une clé refusée est nommée comme telle (401/403)', async () => {
    mockFetch(403, {}, 'Forbidden');
    await expect(new BraveSearchAdapter().search({ query: 'x' })).rejects.toThrow(/API key/i);
  });

  it('une panne du fournisseur est attribuée au fournisseur (5xx)', async () => {
    mockFetch(503, {}, 'Service Unavailable');
    await expect(new BraveSearchAdapter().search({ query: 'x' })).rejects.toThrow(/unavailable/i);
  });

  it('une réponse vide donne zéro résultat, jamais une invention', async () => {
    mockFetch(200, {});
    const out = await new BraveSearchAdapter().search({ query: 'x' });
    expect(out.results).toEqual([]);
  });

  it('Serper applique exactement les mêmes garanties', async () => {
    mockFetch(200, {
      organic: [
        { title: 'ok', link: 'https://www.boulanger.com/p', snippet: '299 €', position: 1 },
        { title: 'cassé', link: 'pas-une-url', snippet: 'x', position: 2 },
        { title: 'sans lien', snippet: 'x', position: 3 },
      ],
    });

    const out = await new SerperAdapter().search({ query: 'x' });
    expect(out.results.map(r => r.url)).toEqual(['https://www.boulanger.com/p']);
    expect(out.results[0].domain).toBe('www.boulanger.com');

    mockFetch(429, {}, 'Too Many Requests');
    await expect(new SerperAdapter().search({ query: 'x' })).rejects.toThrow(/quota|rate limit/i);
  });
});
