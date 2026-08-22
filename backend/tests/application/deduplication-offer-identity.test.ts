/**
 * CAPUCINE — Product identity vs Offer identity in DeduplicationEngine
 *
 * THE DISTINCTION THIS FILE PROTECTS
 * ──────────────────────────────────
 *   product identity ≠ offer identity
 *
 * A shared EAN / ISBN / productId proves two rows describe the same PRODUCT.
 * It does NOT prove they are the same OFFER. Four merchants selling the Sony
 * WH-1000XM5 at 319 / 329 / 335 / 349 € are one product and four competing
 * offers — and comparing them is the entire purpose of Capucine.
 *
 * REGRESSION GUARDED
 * ──────────────────
 * The pipeline used to collapse each product group into a single Offer
 * (`groups.map(g => mergeGroup(g).merged)`), which silently deleted three of
 * those four prices — keeping, in the XM5 case, the MOST EXPENSIVE (349 €,
 * Sony Store) and discarding the cheapest (319 €, Amazon).
 *
 * WHAT MUST STILL BE DEDUPLICATED
 * ───────────────────────────────
 * Genuine duplicates — one listing reported by several search sources — must
 * still collapse into one offer. Keeping the two levels apart is the point:
 * grouping by product is what allows cross-merchant data conflicts to be
 * detected at all (see the CONFLICTING tests in data-integrity.test.ts).
 */

import { DeduplicationEngine } from '../../src/application/deduplication';
import { createTestEngine, createSearchRequest } from '../../src/application/capucine-engine';
import { Offer, DataPoint, Merchant, PreferenceCriterion } from '../../src/domain/types';

// ============================================================================
// HELPERS
// ============================================================================

function dp<T>(value: T, status: 'verified' | 'known' = 'known'): DataPoint<T> {
  return { value, status, provenance: { source: 'test', retrievedAt: new Date() } };
}

function merchant(id: string): Merchant {
  return { id, name: id, country: 'FR', executionCapabilities: ['web_redirect'] };
}

function offer(
  id: string,
  merchantId: string,
  price: number,
  opts: {
    productId?: string;
    chars?: Record<string, DataPoint<unknown>>;
    url?: string;
    source?: string;
  } = {}
): Offer {
  return {
    id,
    productId: opts.productId ?? 'P1',
    merchant: merchant(merchantId),
    price: dp(price),
    currency: 'EUR',
    shippingCost: { value: null, status: 'unknown' },
    characteristics: opts.chars ?? {},
    executionUrl: opts.url,
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: opts.source ?? merchantId, retrievedAt: new Date() },
  };
}

/** Product-level characteristics shared by every XM5 listing. */
const XM5 = {
  model: dp('WH-1000XM5', 'verified'),
  brand: dp('Sony', 'verified'),
  category: dp('casque'),
  name: dp('Sony WH-1000XM5'),
};

const engine = new DeduplicationEngine();

/** Runs the engine end-to-end: group by product, then resolve to offers. */
function resolve(offers: Offer[]): Offer[] {
  return engine.deduplicate(offers).groups.flatMap(g => engine.resolveOffers(g));
}

// ============================================================================
// SCÉNARIOS A–F
// ============================================================================

describe('scénario A — même produit, marchands différents', () => {
  it('conserve les deux offres concurrentes', () => {
    const resolved = resolve([offer('a', 'A', 319), offer('b', 'B', 329)]);

    expect(resolved).toHaveLength(2);
    expect(resolved.map(o => o.price.value).sort()).toEqual([319, 329]);
  });

  it('les conserve aussi quand tous les signaux produit concordent', () => {
    // Même productId, même modèle, même marque, même catégorie, même nom :
    // tout indique le même PRODUIT — et ce sont deux OFFRES.
    const resolved = resolve([
      offer('a', 'A', 319, { chars: XM5 }),
      offer('b', 'B', 329, { chars: XM5 }),
    ]);

    expect(resolved).toHaveLength(2);
  });

  it("les conserve quand les productId diffèrent mais que le modèle est identique", () => {
    // Cas réel du Web : chaque page produit reçoit son propre identifiant,
    // seul le modèle extrait coïncide. C'est le chemin non-définitif du
    // moteur de correspondance (modèle + marque + catégorie + titre).
    const resolved = resolve([
      offer('a', 'fnac', 329, { productId: 'web-fnac-1', chars: XM5 }),
      offer('b', 'amazon', 319, { productId: 'web-amazon-1', chars: XM5 }),
    ]);

    expect(resolved).toHaveLength(2);
    expect(new Set(resolved.map(o => o.merchant.id))).toEqual(new Set(['fnac', 'amazon']));
  });
});

describe('scénario B — même produit, quatre marchands', () => {
  const offers = [
    offer('o1', 'sony-shop', 349, { chars: XM5 }),
    offer('o2', 'fnac', 329, { chars: XM5 }),
    offer('o3', 'amazon-fr', 319, { chars: XM5 }),
    offer('o4', 'boulanger', 335, { chars: XM5 }),
  ];

  it('conserve les quatre offres, aucune supprimée', () => {
    const resolved = resolve(offers);

    expect(resolved).toHaveLength(4);
    expect(resolved.map(o => o.price.value).sort((a, b) => Number(a) - Number(b)))
      .toEqual([319, 329, 335, 349]);
    expect(new Set(resolved.map(o => o.merchant.id)))
      .toEqual(new Set(['sony-shop', 'fnac', 'amazon-fr', 'boulanger']));
  });

  it("conserve en particulier l'offre la MOINS chère", () => {
    // La régression corrigée gardait la plus chère (349 €) et supprimait 319 €.
    const resolved = resolve(offers);
    const cheapest = resolved.find(o => o.price.value === 319);

    expect(cheapest).toBeDefined();
    expect(cheapest!.merchant.id).toBe('amazon-fr');
  });

  it('les reconnaît malgré tout comme UN SEUL produit', () => {
    // L'identité produit n'est pas perdue : c'est elle qui permettra au client
    // de regrouper les offres à l'affichage, et au moteur de détecter les
    // contradictions de données entre marchands.
    const result = engine.deduplicate(offers);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].offers).toHaveLength(4);
  });
});

describe('scénario C — même offre vue par deux sources', () => {
  it('fusionne deux relevés de la même annonce en une seule offre', () => {
    const resolved = resolve([
      offer('brave', 'sony-shop', 319, { chars: XM5, url: 'https://sony.fr/p/xm5', source: 'brave' }),
      offer('serper', 'sony-shop', 319, { chars: XM5, url: 'https://sony.fr/p/xm5', source: 'serper' }),
    ]);

    expect(resolved).toHaveLength(1);
    // Le '+' garde ici son sens exact : deux MOTEURS DE RECHERCHE ont trouvé
    // la même annonce — jamais deux marchands.
    expect(resolved[0].provenance.source).toContain('+');
    expect(resolved[0].provenance.source).toContain('brave');
    expect(resolved[0].provenance.source).toContain('serper');
  });

  it("fusionne aussi sans URL lorsque le marchand est le même", () => {
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: XM5, source: 'brave' }),
      offer('b', 'fnac', 329, { chars: XM5, source: 'serper' }),
    ]);

    expect(resolved).toHaveLength(1);
  });

  it("ne fusionne pas deux URL différentes chez le même marchand", () => {
    // Deux annonces distinctes du même marchand restent deux offres.
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: XM5, url: 'https://fnac.com/a1' }),
      offer('b', 'fnac', 299, { chars: XM5, url: 'https://fnac.com/a2' }),
    ]);

    expect(resolved).toHaveLength(2);
  });

  it("ignore casse, slash final et fragment dans l'URL", () => {
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: XM5, url: 'https://Fnac.com/A1/' }),
      offer('b', 'fnac', 329, { chars: XM5, url: 'https://fnac.com/a1#avis' }),
    ]);

    expect(resolved).toHaveLength(1);
  });
});

describe('scénario D — même produit, même marchand, conditions différentes', () => {
  it('neuf et reconditionné sont deux offres distinctes', () => {
    const resolved = resolve([
      offer('new', 'fnac', 329, { chars: { ...XM5, condition: dp('neuf') } }),
      offer('refurb', 'fnac', 249, { chars: { ...XM5, condition: dp('reconditionné') } }),
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved.map(o => o.price.value).sort((a, b) => Number(a) - Number(b))).toEqual([249, 329]);
  });

  it("une condition INCONNUE ne suffit pas à séparer deux offres", () => {
    // DATA_DISCIPLINE : une donnée absente n'est pas la preuve d'une différence.
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: { ...XM5, condition: dp('neuf') } }),
      offer('b', 'fnac', 329, { chars: XM5 }), // condition inconnue
    ]);

    expect(resolved).toHaveLength(1);
  });
});

describe('scénario E — aucun identifiant produit', () => {
  it('deux marchands sans identifiant restent deux offres', () => {
    const resolved = resolve([
      offer('a', 'A', 319, { productId: '' }),
      offer('b', 'B', 329, { productId: '' }),
    ]);

    expect(resolved).toHaveLength(2);
  });
});

describe('scénario F — URL identique', () => {
  it("déduplique sur l'URL même quand le marchand est inconnu", () => {
    // L'URL est une identité d'offre plus forte qu'un identifiant produit :
    // une URL, c'est une annonce, chez un marchand.
    const resolved = resolve([
      offer('a', '', 319, { productId: '', url: 'https://shop.example/p/1' }),
      offer('b', '', 319, { productId: '', url: 'https://shop.example/p/1' }),
    ]);

    expect(resolved).toHaveLength(1);
  });

  it("sans URL ni marchand connus, aucune fusion n'est devinée", () => {
    const resolved = resolve([
      offer('a', '', 319, { productId: '' }),
      offer('b', '', 329, { productId: '' }),
    ]);

    expect(resolved).toHaveLength(2);
  });
});

// ============================================================================
// INVARIANTS
// ============================================================================

describe('invariants', () => {
  it("NO_SILENT_MODIFICATION : aucune offre ne disparaît pour cause d'identifiant produit partagé", () => {
    const offers = [
      offer('o1', 'm1', 100, { chars: XM5 }),
      offer('o2', 'm2', 110, { chars: XM5 }),
      offer('o3', 'm3', 120, { chars: XM5 }),
      offer('o4', 'm4', 130, { chars: XM5 }),
      offer('o5', 'm5', 140, { chars: XM5 }),
    ];

    expect(resolve(offers)).toHaveLength(5);
  });

  it("DATA_DISCIPLINE : le prix d'une offre n'est jamais écrasé par celui d'un concurrent", () => {
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: XM5 }),
      offer('b', 'amazon', 319, { chars: XM5 }),
    ]);

    const fnac = resolved.find(o => o.merchant.id === 'fnac');
    const amazon = resolved.find(o => o.merchant.id === 'amazon');
    expect(fnac!.price.value).toBe(329);
    expect(amazon!.price.value).toBe(319);
  });

  it("DATA_DISCIPLINE : la provenance d'une offre ne nomme que ses propres sources", () => {
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: XM5, source: 'fnac' }),
      offer('b', 'amazon', 319, { chars: XM5, source: 'amazon' }),
    ]);

    for (const o of resolved) {
      expect(o.provenance.source).toBe(o.merchant.id);
    }
  });

  it("EXECUTION_INDEPENDENCE : la présence d'une executionUrl ne fait disparaître aucune offre", () => {
    const resolved = resolve([
      offer('a', 'fnac', 329, { chars: XM5, url: 'https://fnac.com/p' }),
      offer('b', 'amazon', 319, { chars: XM5 }), // aucune URL
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved.find(o => o.merchant.id === 'amazon')).toBeDefined();
  });

  it('MERCHANT_INDEPENDENCE : le traitement ne dépend pas de quel marchand est présent', () => {
    const withSony = resolve([
      offer('a', 'sony-shop', 349, { chars: XM5 }),
      offer('b', 'petit-vendeur', 319, { chars: XM5 }),
    ]);
    const withoutSony = resolve([
      offer('a', 'marchand-x', 349, { chars: XM5 }),
      offer('b', 'marchand-y', 319, { chars: XM5 }),
    ]);

    expect(withSony).toHaveLength(withoutSony.length);
  });
});

// ============================================================================
// INTÉGRATION — le scénario qui a déclenché la correction
// ============================================================================

describe('intégration — Sony WH-1000XM5, quatre marchands, pipeline complet', () => {
  it('conserve les quatre offres jusqu\'au résultat final', () => {
    const result = createTestEngine().searchSync(createSearchRequest('sony wh-1000xm5'));

    const xm5 = result.ranking.rankedOffers.filter(
      ro => ro.offer.characteristics.model?.value === 'WH-1000XM5'
    );

    expect(xm5).toHaveLength(4);
    expect(xm5.map(ro => ro.offer.price.value).sort((a, b) => Number(a) - Number(b)))
      .toEqual([319, 329, 335, 349]);
    expect(new Set(xm5.map(ro => ro.offer.merchant.id)))
      .toEqual(new Set(['sony-shop', 'fnac', 'amazon-fr', 'boulanger']));
  });

  it('les quatre offres traversent admissibilité puis PriorityEngine', () => {
    const result = createTestEngine().searchSync(createSearchRequest('sony wh-1000xm5'));

    // Admissibilité AVANT classement (ordre du pipeline).
    const admissibleXm5 = result.admissibility.eligibleOffers.filter(
      o => o.characteristics.model?.value === 'WH-1000XM5'
    );
    expect(admissibleXm5).toHaveLength(4);

    const rankedXm5 = result.ranking.rankedOffers.filter(
      ro => ro.offer.characteristics.model?.value === 'WH-1000XM5'
    );
    expect(rankedXm5).toHaveLength(4);
  });

  it('PriorityEngine classe réellement les quatre offres selon ses règles existantes', () => {
    // Critère prix : PriorityEngine (inchangé) doit ordonner les 4 concurrentes.
    // maxBudget est requis : PriorityEngine note le prix comme un ratio au
    // budget (100 - ratio*20) et, sans budget, toutes les offres obtiennent
    // 100 et sont ex æquo. PriorityEngine n'est PAS modifié ici.
    const priceCriterion: PreferenceCriterion[] = [
      { id: 'price', name: 'Prix', level: 'important', parameters: { maxBudget: 500 } },
    ];
    const result = createTestEngine().searchSync(
      createSearchRequest('sony wh-1000xm5', priceCriterion)
    );

    const xm5 = result.ranking.rankedOffers.filter(
      ro => ro.offer.characteristics.model?.value === 'WH-1000XM5'
    );
    expect(xm5).toHaveLength(4);

    // La moins chère est mieux classée que la plus chère.
    const cheapestRank = xm5.findIndex(ro => ro.offer.price.value === 319);
    const dearestRank = xm5.findIndex(ro => ro.offer.price.value === 349);
    expect(cheapestRank).toBeLessThan(dearestRank);
  });

  it("le client dispose de tout le nécessaire pour regrouper par produit", () => {
    // public/js/product-grouping.js regroupe côté client via productId :
    // le backend doit donc livrer des offres à plat, chacune portant son
    // productId. Le regroupement produit ne doit PAS remonter dans le backend.
    const result = createTestEngine().searchSync(createSearchRequest('sony wh-1000xm5'));

    const xm5 = result.ranking.rankedOffers.filter(
      ro => ro.offer.characteristics.model?.value === 'WH-1000XM5'
    );

    for (const ro of xm5) {
      expect(ro.offer.productId).toBe('prod-sony-wh1000xm5');
    }
    // Un seul productId partagé → le client formera un groupe de 4 offres.
    expect(new Set(xm5.map(ro => ro.offer.productId)).size).toBe(1);
  });
});
