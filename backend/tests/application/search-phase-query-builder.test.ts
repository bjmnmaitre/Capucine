/**
 * Tests for SearchPhaseQueryBuilder
 *
 * Verifies phased escalation: each level broadens the keyword set without
 * weakening hard constraints, and never re-orders results.
 *
 * KEY INVARIANTS:
 * - Phase 1 is ALWAYS the narrowest query (exact refs only)
 * - Each higher phase ADDS terms (never removes phase-1 terms)
 * - Phases never modify or weaken hard constraints
 * - "La rareté ne diminue pas la pertinence" — escalation only affects discovery
 *   breadth, not ranking weights
 * - Deduplication within each phase's term list
 */

import { SearchPhaseQueryBuilder, SearchQuery } from '../../src/application/search-plan';

describe('SearchPhaseQueryBuilder', () => {
  let builder: SearchPhaseQueryBuilder;

  beforeEach(() => {
    builder = new SearchPhaseQueryBuilder();
  });

  // ── buildPhaseTerms ────────────────────────────────────────────────────────

  describe('buildPhaseTerms', () => {
    const xm5Query: SearchQuery = {
      primaryTerms: ['wh-1000xm5', 'sony'],
      alternativeTerms: ['casque bluetooth'],
      categories: ['casque'],
      languages: ['fr'],
      countries: ['FR'],
    };

    it('identifies model ref correctly (has digits, length >= 4)', () => {
      const terms = builder.buildPhaseTerms(xm5Query);
      expect(terms.exactRefs).toContain('wh-1000xm5');
      expect(terms.exactRefs).not.toContain('sony'); // "sony" has no digits
    });

    it('builds brand+model combos from non-ref + ref terms', () => {
      const terms = builder.buildPhaseTerms(xm5Query);
      expect(terms.brandModelCombos).toContain('sony wh-1000xm5');
    });

    it('builds model variants (no-dash form)', () => {
      const terms = builder.buildPhaseTerms(xm5Query);
      expect(terms.modelVariants).toContain('wh1000xm5');
    });

    it('builds model variants (space-dash form)', () => {
      const terms = builder.buildPhaseTerms(xm5Query);
      expect(terms.modelVariants).toContain('wh 1000xm5');
    });

    it('incorporates AI synonyms into synonyms bucket', () => {
      const terms = builder.buildPhaseTerms(xm5Query, ['xm5', 'casque noise cancelling']);
      expect(terms.synonyms).toContain('xm5');
      expect(terms.synonyms).toContain('casque noise cancelling');
    });

    it('incorporates AI alternativeSpellings into modelVariants', () => {
      const terms = builder.buildPhaseTerms(xm5Query, [], ['wh1000-xm5', '1000xm5']);
      expect(terms.modelVariants).toContain('wh1000-xm5');
      expect(terms.modelVariants).toContain('1000xm5');
    });

    it('uses category + non-model primary terms as categoryTerms', () => {
      const terms = builder.buildPhaseTerms(xm5Query);
      // "sony" is a non-model primary term (no digits)
      expect(terms.categoryTerms).toContain('sony');
      // The category from the query should also be included
      expect(terms.categoryTerms).toContain('casque');
    });

    it('deduplicates terms within each bucket', () => {
      const dupeQuery: SearchQuery = {
        primaryTerms: ['wh-1000xm5', 'wh-1000xm5'],
        alternativeTerms: ['sony', 'sony'],
        countries: ['FR'],
      };
      const terms = builder.buildPhaseTerms(dupeQuery);
      // Each ref appears only once
      expect(terms.exactRefs.filter(t => t === 'wh-1000xm5')).toHaveLength(1);
    });

    it('falls back to primaryTerms as exactRefs when no model ref found', () => {
      const noRefQuery: SearchQuery = {
        primaryTerms: ['casque', 'bluetooth'],
        countries: ['FR'],
      };
      const terms = builder.buildPhaseTerms(noRefQuery);
      // No digits → falls back to first 2 primary terms
      expect(terms.exactRefs.length).toBeGreaterThan(0);
    });

    it('handles empty query gracefully', () => {
      const empty: SearchQuery = { primaryTerms: [], countries: ['FR'] };
      expect(() => builder.buildPhaseTerms(empty)).not.toThrow();
      const terms = builder.buildPhaseTerms(empty);
      expect(terms.exactRefs).toEqual([]);
      expect(terms.brandModelCombos).toEqual([]);
    });
  });

  // ── termsForLevel ──────────────────────────────────────────────────────────

  describe('termsForLevel', () => {
    const xm5Query: SearchQuery = {
      primaryTerms: ['wh-1000xm5', 'sony'],
      alternativeTerms: [],
      countries: ['FR'],
    };

    it('Level 1: contains only exactRefs (no synonyms, no category terms)', () => {
      const phaseTerms = builder.buildPhaseTerms(xm5Query, ['casque bluetooth'], ['wh1000xm5']);
      const level1 = builder.termsForLevel(phaseTerms, 1);
      expect(level1).toContain('wh-1000xm5');
      expect(level1).not.toContain('casque bluetooth'); // synonyms only appear at level 4+
    });

    it('Level 2: adds brand+model combos to Level 1', () => {
      const phaseTerms = builder.buildPhaseTerms(xm5Query);
      const level1 = builder.termsForLevel(phaseTerms, 1);
      const level2 = builder.termsForLevel(phaseTerms, 2);
      expect(level2.length).toBeGreaterThanOrEqual(level1.length);
      expect(level2).toContain('sony wh-1000xm5');
    });

    it('Level 3: adds model variants to Level 2', () => {
      const phaseTerms = builder.buildPhaseTerms(xm5Query);
      const level2 = builder.termsForLevel(phaseTerms, 2);
      const level3 = builder.termsForLevel(phaseTerms, 3);
      expect(level3.length).toBeGreaterThanOrEqual(level2.length);
      expect(level3).toContain('wh1000xm5');
    });

    it('Level 4: adds AI synonyms', () => {
      const phaseTerms = builder.buildPhaseTerms(xm5Query, ['casque noise cancelling'], []);
      const level3 = builder.termsForLevel(phaseTerms, 3);
      const level4 = builder.termsForLevel(phaseTerms, 4);
      expect(level4.length).toBeGreaterThanOrEqual(level3.length);
      expect(level4).toContain('casque noise cancelling');
    });

    it('Level 5: adds category terms', () => {
      const queryWithCat: SearchQuery = {
        primaryTerms: ['wh-1000xm5', 'sony'],
        categories: ['audio'],
        countries: ['FR'],
      };
      const phaseTerms = builder.buildPhaseTerms(queryWithCat);
      const level5 = builder.termsForLevel(phaseTerms, 5);
      expect(level5).toContain('audio');
    });

    it('Level 6: adds multilingual terms', () => {
      const multiLangQuery: SearchQuery = {
        primaryTerms: ['wh-1000xm5', 'sony'],
        alternativeTerms: ['noise cancelling headphones'], // English
        countries: ['FR', 'GB'],
        languages: ['fr', 'en'],
      };
      const phaseTerms = builder.buildPhaseTerms(multiLangQuery, [], []);
      const level6 = builder.termsForLevel(phaseTerms, 6);
      // With >1 language, alternativeTerms that aren't synonyms go to multilingual
      expect(level6).toContain('wh-1000xm5'); // exact ref always present
    });

    it('INVARIANT: Level N terms are always a superset of Level N-1 terms', () => {
      const phaseTerms = builder.buildPhaseTerms(xm5Query, ['synonym'], ['variant']);
      for (let level = 1; level < 6; level++) {
        const thisLevel = new Set(builder.termsForLevel(phaseTerms, level as 1 | 2 | 3 | 4 | 5 | 6));
        const nextLevel = new Set(builder.termsForLevel(phaseTerms, (level + 1) as 1 | 2 | 3 | 4 | 5 | 6));
        for (const term of thisLevel) {
          expect(nextLevel.has(term)).toBe(true);
        }
      }
    });

    it('INVARIANT: terms are deduplicated at every level', () => {
      const phaseTerms = builder.buildPhaseTerms(xm5Query);
      for (let level = 1; level <= 6; level++) {
        const terms = builder.termsForLevel(phaseTerms, level as 1 | 2 | 3 | 4 | 5 | 6);
        const unique = new Set(terms);
        expect(unique.size).toBe(terms.length);
      }
    });

    it('caps total term list at 12', () => {
      // Build a query with many synonyms
      const many = Array.from({ length: 20 }, (_, i) => `synonym-${i}`);
      const phaseTerms = builder.buildPhaseTerms(xm5Query, many, []);
      const level6 = builder.termsForLevel(phaseTerms, 6);
      expect(level6.length).toBeLessThanOrEqual(12);
    });
  });

  // ── Model variant generation ───────────────────────────────────────────────

  describe('model variant generation', () => {
    it('wh-1000xm5 → wh1000xm5 (no-dash)', () => {
      const q: SearchQuery = { primaryTerms: ['wh-1000xm5'], countries: ['FR'] };
      const terms = builder.buildPhaseTerms(q);
      expect(terms.modelVariants).toContain('wh1000xm5');
    });

    it('iphone-15-pro → iphone15pro (no-dash)', () => {
      const q: SearchQuery = { primaryTerms: ['iphone-15-pro', 'apple'], countries: ['FR'] };
      const terms = builder.buildPhaseTerms(q);
      expect(terms.modelVariants).toContain('iphone15pro');
    });

    it('rtx4080 generates digit-spaced variant: rtx 4080', () => {
      const q: SearchQuery = { primaryTerms: ['rtx4080', 'nvidia'], countries: ['FR'] };
      const terms = builder.buildPhaseTerms(q);
      // "rtx4080" → "rtx 4080"
      expect(terms.modelVariants).toContain('rtx 4080');
    });

    it('does not generate variants for non-ref terms', () => {
      const q: SearchQuery = { primaryTerms: ['sony', 'casque'], countries: ['FR'] };
      const terms = builder.buildPhaseTerms(q);
      // No model refs → no variants from the ref path
      expect(terms.modelVariants.filter(t => t.includes('sony'))).toHaveLength(0);
    });
  });

  // ── Escalation invariant (MEGAPROMPT §2) ──────────────────────────────────

  describe('Escalation invariant — rarity does not reduce relevance', () => {
    it('a term found at level 1 remains in the term set at level 6', () => {
      const q: SearchQuery = { primaryTerms: ['wh-1000xm5', 'sony'], countries: ['FR'] };
      const phaseTerms = builder.buildPhaseTerms(q);
      const exactRef = phaseTerms.exactRefs[0];
      const level6 = builder.termsForLevel(phaseTerms, 6);
      expect(level6).toContain(exactRef);
    });

    it('level 1 query is strictly narrower than level 4 query for a product with synonyms', () => {
      const q: SearchQuery = { primaryTerms: ['wh-1000xm5', 'sony'], countries: ['FR'] };
      const phaseTerms = builder.buildPhaseTerms(q, ['casque bluetooth premium'], []);
      const l1 = builder.termsForLevel(phaseTerms, 1);
      const l4 = builder.termsForLevel(phaseTerms, 4);
      expect(l4.length).toBeGreaterThan(l1.length);
      expect(l4).toContain('casque bluetooth premium');
      expect(l1).not.toContain('casque bluetooth premium');
    });
  });
});
