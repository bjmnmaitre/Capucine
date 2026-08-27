/**
 * CAPUCINE — la garde SSRF doit survivre aux redirections
 *
 * FAILLE RÉELLE CORRIGÉE ICI.
 *
 * Le récupérateur utilisait `redirect: 'follow'` et n'appliquait sa garde
 * qu'à l'URL de DÉPART. Or cette URL vient d'un moteur de recherche, donc de
 * l'extérieur, et la page qu'elle désigne n'a qu'à répondre :
 *
 *     302 Location: http://169.254.169.254/latest/meta-data/
 *
 * pour que le processus aille chercher lui-même une ressource interne. La
 * protection était intégralement contournable par une simple redirection.
 *
 * Les redirections sont désormais suivies À LA MAIN, chaque saut revalidé.
 */
import { HttpPageFetcher } from '../../src/application/product-page-extractor';

/** Réponse minimale, suffisante pour le contrat lu par le récupérateur. */
function htmlResponse(body = '<html><head></head><body>ok</body></html>') {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
    body: null,
    text: async () => body,
  } as unknown as Response;
}

function redirectTo(location: string, status = 302) {
  return {
    ok: false,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location : null) },
    body: null,
    text: async () => '',
  } as unknown as Response;
}

/** Installe un faux réseau et retourne la liste des URL réellement demandées. */
function installNetwork(routes: Record<string, () => Response>) {
  const attempted: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    attempted.push(url);
    const route = routes[url];
    if (!route) throw new Error(`route absente : ${url}`);
    return route();
  }) as typeof globalThis.fetch;
  return { attempted, restore: () => { globalThis.fetch = original; } };
}

describe('§4 — une redirection ne contourne jamais la garde SSRF', () => {
  let net: ReturnType<typeof installNetwork>;
  afterEach(() => net?.restore());

  const START = 'https://boutique.example/produit/casque';

  it.each([
    ['métadonnées cloud',   'http://169.254.169.254/latest/meta-data/'],
    ['boucle locale',       'http://127.0.0.1:8080/admin'],
    ['localhost nommé',     'http://localhost:3001/profile/expo-user'],
    ['réseau privé 10.x',   'http://10.0.0.5/interne'],
    ['réseau privé 192.168','http://192.168.1.1/routeur'],
    ['réseau privé 172.16', 'http://172.16.0.9/interne'],
    ['IPv6 unique-local',   'http://[fd00::1]/interne'],
    ['schéma fichier',      'file:///etc/passwd'],
    ['schéma gopher',       'gopher://interne/1'],
  ])('redirection vers %s → refusée, cible jamais requêtée', async (_label, target) => {
    net = installNetwork({ [START]: () => redirectTo(target) });

    const result = await new HttpPageFetcher().fetchPage(START);

    expect(result).toBeNull();
    // La preuve qui compte : la cible interne n'a JAMAIS été demandée.
    expect(net.attempted).toEqual([START]);
  });

  it('une redirection vers un hôte public légitime est suivie', async () => {
    const HOP = 'https://boutique.example/fr/produit/casque';
    net = installNetwork({
      [START]: () => redirectTo(HOP),
      [HOP]: () => htmlResponse(),
    });

    const result = await new HttpPageFetcher().fetchPage(START);

    expect(result).not.toBeNull();
    expect(result!.requestedUrl).toBe(START);
    expect(result!.finalUrl).toBe(HOP);
    expect(result!.redirectChain).toEqual([HOP]);
  });

  it('un changement de domaine est suivi, et tracé', async () => {
    const HOP = 'https://autre-marchand.example/p/casque';
    net = installNetwork({ [START]: () => redirectTo(HOP), [HOP]: () => htmlResponse() });
    const result = await new HttpPageFetcher().fetchPage(START);
    expect(result!.finalUrl).toBe(HOP);
  });

  it('HTTP → HTTPS est suivi', async () => {
    const A = 'http://boutique.example/p';
    const B = 'https://boutique.example/p';
    net = installNetwork({ [A]: () => redirectTo(B), [B]: () => htmlResponse() });
    expect((await new HttpPageFetcher().fetchPage(A))!.finalUrl).toBe(B);
  });

  it('HTTPS → HTTP est suivi, mais reste tracé comme tel', async () => {
    // Rétrogradation de sécurité : non bloquée ici — le récupérateur ne lit
    // que du HTML public et n'envoie aucun secret — mais la chaîne la rend
    // visible en provenance plutôt que silencieuse.
    const A = 'https://boutique.example/p';
    const B = 'http://boutique.example/p';
    net = installNetwork({ [A]: () => redirectTo(B), [B]: () => htmlResponse() });
    const r = await new HttpPageFetcher().fetchPage(A);
    expect(r!.redirectChain).toEqual([B]);
  });

  it('une redirection circulaire est abandonnée, jamais poursuivie', async () => {
    const A = 'https://boutique.example/a';
    const B = 'https://boutique.example/b';
    net = installNetwork({ [A]: () => redirectTo(B), [B]: () => redirectTo(A) });
    expect(await new HttpPageFetcher().fetchPage(A)).toBeNull();
    // A et B chacun une fois : la boucle est coupée dès le retour sur A.
    expect(net.attempted).toEqual([A, B]);
  });

  it('une redirection sur elle-même est abandonnée', async () => {
    const A = 'https://boutique.example/a';
    net = installNetwork({ [A]: () => redirectTo(A) });
    expect(await new HttpPageFetcher().fetchPage(A)).toBeNull();
    expect(net.attempted).toEqual([A]);
  });

  it('une chaîne trop longue est abandonnée', async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 12; i++) {
      routes[`https://b.example/${i}`] = () => redirectTo(`https://b.example/${i + 1}`);
    }
    routes['https://b.example/12'] = () => htmlResponse();
    net = installNetwork(routes);
    expect(await new HttpPageFetcher().fetchPage('https://b.example/0')).toBeNull();
    // Bornée : on n'a pas parcouru les douze sauts.
    expect(net.attempted.length).toBeLessThanOrEqual(6);
  });

  it('un 3xx sans en-tête Location est abandonné', async () => {
    net = installNetwork({
      [START]: () => ({
        ok: false, status: 302, headers: { get: () => null }, body: null, text: async () => '',
      }) as unknown as Response,
    });
    expect(await new HttpPageFetcher().fetchPage(START)).toBeNull();
  });

  it('une Location relative est résolue contre le saut courant', async () => {
    const HOP = 'https://boutique.example/fr/casque';
    net = installNetwork({
      [START]: () => redirectTo('/fr/casque'),
      [HOP]: () => htmlResponse(),
    });
    const r = await new HttpPageFetcher().fetchPage(START);
    expect(r!.finalUrl).toBe(HOP);
  });

  it('une Location relative vers une cible interne est refusée après résolution', async () => {
    // La garde s'applique à l'URL RÉSOLUE, pas à la chaîne brute.
    net = installNetwork({ ['http://boutique.example/p']: () => redirectTo('//127.0.0.1/admin') });
    const r = await new HttpPageFetcher().fetchPage('http://boutique.example/p');
    expect(r).toBeNull();
    expect(net.attempted).toEqual(['http://boutique.example/p']);
  });

  it('une Location illisible est abandonnée sans rien fabriquer', async () => {
    net = installNetwork({ [START]: () => redirectTo('http://[malforme') });
    expect(await new HttpPageFetcher().fetchPage(START)).toBeNull();
  });

  it.each([[301], [302], [303], [307], [308]])(
    'le statut %i est traité comme une redirection',
    async (status) => {
      const HOP = 'https://boutique.example/final';
      net = installNetwork({ [START]: () => redirectTo(HOP, status), [HOP]: () => htmlResponse() });
      expect((await new HttpPageFetcher().fetchPage(START))!.finalUrl).toBe(HOP);
    }
  );

  it('un statut hors 3xx n’est jamais interprété comme une redirection', async () => {
    net = installNetwork({ [START]: () => htmlResponse() });
    const r = await new HttpPageFetcher().fetchPage(START);
    expect(r!.finalUrl).toBe(START);
    expect(r!.redirectChain).toEqual([]);
  });
});
