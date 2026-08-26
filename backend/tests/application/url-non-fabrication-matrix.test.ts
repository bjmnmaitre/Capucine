/**
 * CAPUCINE — matrice de non-fabrication d'URL (§4)
 *
 * L'invariant le plus dur du produit : une URL n'est JAMAIS construite. Elle
 * est soit celle réellement retrouvée, verbatim, soit absente. Une URL
 * plausible fabriquée à partir d'un identifiant ou d'un slug mènerait
 * l'utilisateur vers une page qui n'existe pas — en prétendant l'avoir vue.
 *
 * 32 cas, éprouvés sur les trois couches qui manipulent des URL :
 * l'adaptateur de recherche, le récupérateur de pages, et la préparation
 * d'achat.
 */
import { BraveSearchAdapter } from '../../src/application/web-search-adapters';
import { HttpPageFetcher } from '../../src/application/product-page-extractor';
import { WebRedirectHandler } from '../../src/application/cart-preparation-engine';
import type { Offer, Merchant, DataStatus, DataPoint } from '../../src/domain/types';

const merchant: Merchant =
  { id: 'fnac', name: 'Fnac', country: 'FR', executionCapabilities: ['web_redirect'] };

const dp = (v: number | null, s: DataStatus): DataPoint<number> => ({ value: v, status: s });

function offerWithUrl(url: string | undefined): Offer {
  return {
    id: 'offer-12345', productId: 'prod-sony-xm5', merchant,
    price: dp(329, 'known'), currency: 'EUR', shippingCost: dp(0, 'known'),
    characteristics: {}, executionUrl: url,
    createdAt: new Date(), retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
  } as Offer;
}

// ── Couche 1 : ce que l'adaptateur accepte de renvoyer ──────────────────────
const realFetch = global.fetch;
function mockProvider(results: Array<Record<string, unknown>>) {
  global.fetch = (async () => ({
    ok: true, status: 200, statusText: '', json: async () => ({ web: { results } }),
  })) as unknown as typeof fetch;
}

describe('Couche fournisseur — une URL inutilisable est écartée, jamais réparée', () => {
  const KEY = 'BRAVE_API_KEY';
  let saved: string | undefined;

  beforeEach(() => { saved = process.env[KEY]; process.env[KEY] = 'test-not-a-real-key'; });
  afterEach(() => {
    global.fetch = realFetch;
    if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
  });

  const CASES: Array<{ label: string; url: unknown; kept: boolean }> = [
    { label: '1. HTTPS valide', url: 'https://www.fnac.com/a12345/xm5', kept: true },
    { label: '2. HTTP valide', url: 'http://www.fnac.com/a12345/xm5', kept: true },
    { label: '3. URL avec paramètres', url: 'https://www.fnac.com/p?ref=abc&utm=x', kept: true },
    { label: '4. URL avec fragment', url: 'https://www.fnac.com/p#avis', kept: true },
    { label: '5. URL avec accents encodés', url: 'https://www.fnac.com/casque-r%C3%A9duction', kept: true },
    { label: '6. domaine inconnu mais valide', url: 'https://boutique-inconnue.xyz/p', kept: true },
    { label: '7. URL absente', url: undefined, kept: false },
    { label: '8. URL vide', url: '', kept: false },
    { label: '9. URL malformée', url: 'ht!tp://cassé', kept: false },
    { label: '10. slug seul', url: '/casque-sony-wh1000xm5', kept: false },
    { label: '11. identifiant produit seul', url: 'prod-sony-xm5', kept: false },
    { label: '12. identifiant marchand seul', url: 'fnac', kept: false },
    { label: '13. protocole javascript', url: 'javascript:alert(1)', kept: false },
    { label: '14. protocole data', url: 'data:text/html,<h1>x</h1>', kept: false },
    { label: '15. protocole file', url: 'file:///etc/passwd', kept: false },
    { label: '16. protocole ftp', url: 'ftp://serveur/fichier', kept: false },
    { label: '17. url non-chaîne (nombre)', url: 12345, kept: false },
    { label: '18. url null', url: null, kept: false },
  ];

  for (const c of CASES) {
    it(`${c.label} → ${c.kept ? 'conservée verbatim' : 'écartée'}`, async () => {
      mockProvider([{ title: 'T', url: c.url, description: '329 €' }]);
      const out = await new BraveSearchAdapter().search({ query: 'x' });

      if (!c.kept) {
        expect(out.results).toEqual([]);
        return;
      }
      expect(out.results.length).toBe(1);
      // Verbatim : aucune normalisation, aucun nettoyage, aucun ajout.
      expect(out.results[0].url).toBe(c.url);
    });
  }

  it('un lot mixte ne conserve QUE les URL utilisables, sans en réparer aucune', async () => {
    mockProvider([
      { title: 'ok1', url: 'https://a.fr/p' },
      { title: 'slug', url: '/produit-42' },
      { title: 'ok2', url: 'https://b.fr/p' },
      { title: 'id', url: 'ref-99' },
    ]);
    const out = await new BraveSearchAdapter().search({ query: 'x' });
    expect(out.results.map(r => r.url)).toEqual(['https://a.fr/p', 'https://b.fr/p']);
  });
});

// ── Couche 2 : ce que le récupérateur accepte d'aller chercher ──────────────
describe('Couche récupération — aucune cible interne n’est requêtée', () => {
  const realF = global.fetch;
  let attempted: string[];

  beforeEach(() => {
    attempted = [];
    global.fetch = (async (u: string) => {
      attempted.push(String(u));
      return { ok: true, headers: { get: () => 'text/html' }, body: null, text: async () => '<html></html>' };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realF; });

  const BLOCKED = [
    ['19. localhost', 'http://localhost/admin'],
    ['20. 127.0.0.1', 'http://127.0.0.1:8080/'],
    ['21. 0.0.0.0', 'http://0.0.0.0/'],
    ['22. métadonnées cloud', 'http://169.254.169.254/latest/meta-data/'],
    ['23. IPv6 loopback', 'http://[::1]/'],
    ['24. IPv6 unique-local', 'http://[fd00::1]/'],
    ['25. privé 10.x', 'http://10.1.2.3/'],
    ['26. privé 172.16-31', 'http://172.20.0.1/'],
    ['27. privé 192.168', 'http://192.168.0.1/'],
    ['28. protocole invalide', 'gopher://serveur/'],
  ] as const;

  for (const [label, url] of BLOCKED) {
    it(`${label} → refusée sans aucun appel réseau`, async () => {
      expect(await new HttpPageFetcher().fetch(url)).toBeNull();
      expect(attempted).toEqual([]);
    });
  }

  it('29. une URL marchande publique est bien requêtée', async () => {
    await new HttpPageFetcher().fetch('https://www.fnac.com/a12345/xm5');
    expect(attempted).toEqual(['https://www.fnac.com/a12345/xm5']);
  });
});

// ── Couche 3 : ce que la préparation d'achat expose à l'utilisateur ─────────
describe('Couche préparation — l’URL remise est celle de l’offre, ou rien', () => {
  const handler = new WebRedirectHandler();

  it('30. URL réelle : restituée verbatim comme checkoutUrl', async () => {
    const url = 'https://www.fnac.com/a12345/Sony-WH-1000XM5?origin=recherche';
    const r = await handler.prepareCart({ offer: offerWithUrl(url), quantity: 1 });
    expect(r.status).toBe('partial');
    expect(r.checkoutUrl).toBe(url);
  });

  it('31. URL absente : aucune URL n’est fabriquée depuis l’id ou le marchand', async () => {
    const r = await handler.prepareCart({ offer: offerWithUrl(undefined), quantity: 1 });
    expect(r.status).toBe('unavailable');
    expect(r.checkoutUrl).toBeUndefined();
    // Ni l'offerId, ni le productId, ni le domaine du marchand ne doivent
    // apparaître comme une URL plausible dans la réponse.
    const payload = JSON.stringify(r);
    expect(payload).not.toMatch(/https?:\/\//);
  });

  it('32. aucune donnée personnelle n’est jamais placée dans l’URL', async () => {
    const url = 'https://www.fnac.com/a12345/xm5';
    const r = await handler.prepareCart({
      offer: offerWithUrl(url), quantity: 1,
      userEmail: 'benjamin@example.com', userFirstName: 'Benjamin', userLastName: 'M',
      shippingCountry: 'FR',
    });
    expect(r.checkoutUrl).toBe(url);
    for (const personal of ['benjamin@example.com', 'Benjamin', 'benjamin']) {
      expect(r.checkoutUrl!).not.toContain(personal);
    }
  });

  it('deux URL différentes pour le même produit restent deux offres distinctes', async () => {
    const a = await handler.prepareCart({ offer: offerWithUrl('https://a.fr/p'), quantity: 1 });
    const b = await handler.prepareCart({ offer: offerWithUrl('https://b.fr/p'), quantity: 1 });
    expect(a.checkoutUrl).toBe('https://a.fr/p');
    expect(b.checkoutUrl).toBe('https://b.fr/p');
  });
});
