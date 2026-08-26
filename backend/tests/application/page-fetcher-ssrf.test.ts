/**
 * CAPUCINE — le récupérateur de pages ne doit pas devenir un relais SSRF.
 *
 * ProductPageExtractor est pointé sur des URL venues d'un fournisseur de
 * recherche, donc de l'extérieur. Si le serveur récupère tout ce qu'on lui
 * donne, une URL nommant une adresse interne le fait requêter DEPUIS le
 * réseau interne. Ces tests vérifient qu'aucun appel n'est même tenté.
 */
import { HttpPageFetcher } from '../../src/application/product-page-extractor';

describe('HttpPageFetcher — cibles refusées avant tout appel réseau', () => {
  const realFetch = global.fetch;
  let attempted: string[];

  beforeEach(() => {
    attempted = [];
    // Si fetch est appelé, le test le verra : l'URL est enregistrée.
    global.fetch = (async (url: string) => {
      attempted.push(String(url));
      return {
        ok: true,
        headers: { get: () => 'text/html' },
        body: null,
        text: async () => '<html></html>',
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it.each([
    ['loopback IPv4', 'http://127.0.0.1/admin'],
    ['loopback nommé', 'http://localhost:8080/'],
    ['loopback IPv6', 'http://[::1]/'],
    ['métadonnées cloud', 'http://169.254.169.254/latest/meta-data/'],
    ['privé 10.x', 'http://10.0.0.5/'],
    ['privé 172.16-31', 'http://172.20.1.1/'],
    ['privé 192.168', 'http://192.168.1.1/'],
    ['adresse nulle', 'http://0.0.0.0/'],
    ['IPv6 unique-local', 'http://[fd00::1]/'],
    ['schéma file', 'file:///etc/passwd'],
    ['schéma javascript', 'javascript:alert(1)'],
    ['URL illisible', 'pas-une-url'],
  ])('%s : refusé, et AUCUN appel réseau n’est tenté', async (_label, url) => {
    const result = await new HttpPageFetcher().fetch(url);
    expect(result).toBeNull();
    // Le point essentiel : la requête n'a pas eu lieu du tout.
    expect(attempted).toEqual([]);
  });

  it('une URL marchande publique reste évidemment autorisée', async () => {
    await new HttpPageFetcher().fetch('https://www.fnac.com/a12345/Sony-WH-1000XM5');
    expect(attempted).toEqual(['https://www.fnac.com/a12345/Sony-WH-1000XM5']);
  });
});
