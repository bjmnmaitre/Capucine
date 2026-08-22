/**
 * CAPUCINE — MatchQuality for InMemoryDiscoveryStrategy (§7.5)
 *
 * WHY THIS EXISTS
 * ───────────────
 * Before this, only RealWebDiscoveryStrategy classified its candidates.
 * InMemory candidates carried matchQuality === undefined, and
 * CapucineEngine.allLowQuality() treats undefined as "low quality" — so an
 * in-memory search that had ALREADY found the exact product still escalated
 * to a broader search level and re-queried the same catalog, accumulating
 * duplicated candidates. These tests pin the classification itself and the
 * escalation behaviour that depends on it.
 *
 * INVARIANTS COVERED
 * - matchQuality is NEVER undefined on a candidate that was actually produced.
 * - Classification is deterministic and comes from classifyMatchQuality() —
 *   never from an AI decision.
 * - Classification is descriptive metadata: it NEVER changes ranking scores
 *   (PRIORITY_INDEPENDENCE).
 * - An unknown classification stays 'unknown' — it is never guessed
 *   (DATA_DISCIPLINE).
 */

import { InMemoryDiscoveryStrategy } from '../../src/application/in-memory-discovery';
import { DiscoveryCriteria, DiscoveryOrchestrator, IDiscoveryStrategy, DiscoveryResult } from '../../src/application/discovery';
import { createTestEngine, createSearchRequest } from '../../src/application/capucine-engine';
import { rankOffers } from '../../src/decision/priority-engine';
import { Offer, PreferenceCriterion, SearchMatchQuality } from '../../src/domain/types';

const strategy = new InMemoryDiscoveryStrategy();

describe('InMemoryDiscoveryStrategy — matchQuality classification', () => {
  it('classe exact_match quand la référence exacte demandée est présente dans le candidat', () => {
    const result = strategy.discoverSync({
      keywords: ['wh-1000xm5'],
      exactRefs: ['wh-1000xm5'],
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.matchQuality).toBe('exact_match');
      // La classification est portée à la fois par le candidat et par l'offre,
      // exactement comme dans RealWebDiscoveryStrategy.
      expect(candidate.offer.matchQuality).toBe('exact_match');
    }
  });

  it('reconnaît la référence exacte malgré une variation de tirets/espaces', () => {
    // Le corpus catalogue écrit "wh-1000xm5" ; l'utilisateur peut écrire "wh 1000 xm5".
    const result = strategy.discoverSync({
      keywords: ['casque'],
      exactRefs: ['wh 1000 xm5'],
    });

    const xm5 = result.candidates.filter(c => c.offer.productId === 'prod-sony-wh1000xm5');
    expect(xm5.length).toBeGreaterThan(0);
    for (const candidate of xm5) {
      expect(candidate.matchQuality).toBe('exact_match');
    }
  });

  it('classe close_match une recherche générique sans référence exacte', () => {
    const result = strategy.discoverSync({
      keywords: ['casque', 'bluetooth'],
      exactRefs: [],
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.matchQuality).toBe('close_match');
    }
  });

  it("une référence exacte cherchée mais absente d'un candidat ne produit JAMAIS exact_match pour ce candidat", () => {
    // On cherche le XM5 par référence, mais avec un mot-clé assez large pour
    // ramener aussi d'autres casques qui, eux, ne contiennent pas la référence.
    const result = strategy.discoverSync({
      keywords: ['casque'],
      exactRefs: ['wh-1000xm5'],
    });

    const others = result.candidates.filter(c => c.offer.productId !== 'prod-sony-wh1000xm5');
    expect(others.length).toBeGreaterThan(0);
    for (const candidate of others) {
      expect(candidate.matchQuality).not.toBe('exact_match');
      expect(candidate.matchQuality).toBe('close_match');
    }
  });

  it("classe 'unknown' — et jamais undefined — quand aucun mot-clé ne permet de mesurer la correspondance", () => {
    // Recherche par catégorie seule : il n'y a rien à mesurer. On ne devine pas.
    const result = strategy.discoverSync({ categories: ['casque'] });

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.matchQuality).toBe('unknown');
      expect(candidate.matchQuality).toBeDefined();
    }
  });

  it('un produit hors sujet n\'est pas classé "alternative" : il n\'est pas candidat du tout', () => {
    // Le filtre par mots-clés est un ET logique : un produit qui ne correspond
    // que partiellement est exclu, il n'est jamais présenté comme une
    // correspondance dégradée.
    const result = strategy.discoverSync({
      keywords: ['casque', 'bluetooth'],
      exactRefs: [],
    });

    const offTopic = result.candidates.filter(c => c.offer.productId.includes('iphone'));
    expect(offTopic).toHaveLength(0);
  });

  it('matchQuality est TOUJOURS défini sur tout candidat réellement produit', () => {
    const criteriaSet: DiscoveryCriteria[] = [
      { keywords: ['wh-1000xm5'], exactRefs: ['wh-1000xm5'] },
      { keywords: ['casque'] },
      { keywords: ['casque', 'bluetooth'], maxPrice: 500 },
      { categories: ['casque'] },
      { categories: ['smartphone'] },
      { keywords: ['iphone'] },
      {},
    ];

    const seen = new Set<SearchMatchQuality>();
    let totalCandidates = 0;

    for (const criteria of criteriaSet) {
      const result = strategy.discoverSync(criteria);
      for (const candidate of result.candidates) {
        totalCandidates++;
        expect(candidate.matchQuality).toBeDefined();
        expect(candidate.offer.matchQuality).toBeDefined();
        expect(candidate.matchQuality).toBe(candidate.offer.matchQuality);
        seen.add(candidate.matchQuality as SearchMatchQuality);
      }
    }

    expect(totalCandidates).toBeGreaterThan(0);
    // Bandes réellement atteignables pour ce moteur (voir le commentaire dans
    // in-memory-discovery.ts) : on ne fabrique pas de bande impossible.
    for (const quality of seen) {
      expect(['exact_match', 'close_match', 'unknown']).toContain(quality);
    }
  });

  it('est déterministe : deux recherches identiques produisent les mêmes classifications', () => {
    const criteria: DiscoveryCriteria = { keywords: ['casque'], exactRefs: ['wh-1000xm5'] };
    const first = strategy.discoverSync(criteria);
    const second = strategy.discoverSync(criteria);

    expect(first.candidates.map(c => [c.offer.id, c.matchQuality])).toEqual(
      second.candidates.map(c => [c.offer.id, c.matchQuality])
    );
  });

  it("n'écrit jamais la classification d'une recherche dans le catalogue partagé", () => {
    // matchQuality dépend des critères : elle ne doit pas fuir d'une recherche
    // à l'autre via l'objet Offer du catalogue.
    const exact = strategy.discoverSync({ keywords: ['casque'], exactRefs: ['wh-1000xm5'] });
    const exactXm5 = exact.candidates.find(c => c.offer.productId === 'prod-sony-wh1000xm5');
    expect(exactXm5?.matchQuality).toBe('exact_match');

    const generic = strategy.discoverSync({ categories: ['casque'] });
    const genericXm5 = generic.candidates.find(c => c.offer.productId === 'prod-sony-wh1000xm5');
    expect(genericXm5?.matchQuality).toBe('unknown');

    // Et la première recherche n'a pas été rétro-modifiée.
    expect(exactXm5?.offer.matchQuality).toBe('exact_match');
  });
});

// ============================================================================
// NON-RÉGRESSION ARCHITECTURALE (§22)
// ============================================================================

describe('matchQuality — indépendance du classement (PRIORITY_INDEPENDENCE)', () => {
  it('deux offres identiques avec des matchQuality différentes obtiennent le MÊME score', () => {
    const base = strategy.discoverSync({ keywords: ['casque', 'bluetooth'] }).candidates[0].offer;

    const withExact: Offer = { ...base, id: 'offer-a', matchQuality: 'exact_match' };
    const withAlternative: Offer = { ...base, id: 'offer-b', matchQuality: 'alternative' };
    const withUndefined: Offer = { ...base, id: 'offer-c', matchQuality: undefined };

    const effectiveCriteria: PreferenceCriterion[] = [
      { id: 'price', name: 'Prix', level: 'important', evaluationType: 'price-ascending' },
    ];

    const ranking = rankOffers({
      offers: [withExact, withAlternative, withUndefined],
      effectiveCriteria,
      requestId: 'test-mq-independence',
      timestamp: new Date(),
    });

    const scores = ranking.rankedOffers.map(r => r.overallScore);
    expect(new Set(scores).size).toBe(1);
  });
});

// ============================================================================
// COMPORTEMENT D'ESCALADE (le bug que ce chantier corrige)
// ============================================================================

class CountingStrategy implements IDiscoveryStrategy {
  readonly name = 'counting-in-memory';
  readonly version = '1.0.0';
  readonly isReady = true;
  readonly calls: DiscoveryCriteria[] = [];
  private inner = new InMemoryDiscoveryStrategy();

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    this.calls.push(criteria);
    return this.inner.discover(criteria);
  }

  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    this.calls.push(criteria);
    return this.inner.discoverSync(criteria);
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unavailable' }> {
    return { status: 'healthy' };
  }
}

describe('escalade — un exact_match trouvé au niveau 1 arrête la recherche', () => {
  function engineWith(strategy: CountingStrategy) {
    const orchestrator = new DiscoveryOrchestrator();
    orchestrator.registerStrategy(strategy, true);
    return createTestEngine({ discoveryOrchestrator: orchestrator });
  }

  it("n'escalade plus quand le catalogue a déjà rendu la référence exacte", async () => {
    const strat = new CountingStrategy();
    const result = await engineWith(strat).search(createSearchRequest('Sony WH-1000XM5'));

    // Un seul appel : le niveau 1 a trouvé des exact_match, inutile d'élargir.
    expect(strat.calls).toHaveLength(1);
    expect(result.discovery.candidates.length).toBeGreaterThan(0);
    expect(result.discovery.candidates.every(c => c.matchQuality === 'exact_match')).toBe(true);
  });

  it("n'accumule plus le même candidat plusieurs fois (effet de bord de l'escalade inutile)", async () => {
    const strat = new CountingStrategy();
    const result = await engineWith(strat).search(createSearchRequest('Sony WH-1000XM5'));

    const ids = result.discovery.candidates.map(c => c.offer.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('escalade toujours quand rien de pertinent n\'a été trouvé (comportement préservé)', async () => {
    const strat = new CountingStrategy();
    await engineWith(strat).search(createSearchRequest('zzzzz produit totalement inexistant xyzzy'));

    // Aucun candidat trouvé → l'escalade doit bien avoir été tentée.
    expect(strat.calls.length).toBeGreaterThan(1);
  });
});
