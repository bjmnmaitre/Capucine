/**
 * Capucine — RankingPreference
 *
 * "montre-moi les moins chers" changes how already-ranked offers are
 * PRESENTED — it does NOT change whether they satisfy the user's criteria.
 * PriorityEngine (decision/priority-engine.ts) stays the single source of
 * truth for admissibility-aware relevance scoring; this module only
 * RE-ORDERS its output for a specific presentation preference, exactly the
 * same "extend, don't replace" relationship RequestInterpreter has with
 * NormalizationEngine. No second ranking engine is created.
 *
 * Only PRICE_LOWEST has real reordering logic today. BEST_VALUE/
 * FASTEST_DELIVERY/BEST_RATED are accepted, stored, and round-tripped
 * end-to-end (conversation → API), but produce NO reordering — see
 * sortByPreference()'s switch. Claiming otherwise would be exactly the kind
 * of "architecture prête" presented as "fonctionnalité opérationnelle" the
 * megaprompt forbids.
 */

import { RankedOffer } from '../domain/types';
import { CostEngine, CostBreakdown, defaultCostEngine } from './cost-engine';
import { registerCatalog } from './i18n';

// Same (code, params) + translate() pattern as explanation-engine.ts and
// no-results-analyzer.ts — one message catalog, never a hardcoded sentence
// in the ranking logic itself.
registerCatalog('fr', {
  RANKED_LOWEST_KNOWN_COST: 'Coût total le plus bas parmi les offres comparées (produit, livraison et frais connus inclus).',
  RANKED_LOWEST_PARTIAL_COST: 'Coût le plus bas parmi les composantes connues — certains frais (livraison, taxes ou douane) restent inconnus et pourraient changer ce classement.',
  RANKED_BEST_MATCH: 'Meilleure correspondance avec vos critères.',
});
registerCatalog('en', {
  RANKED_LOWEST_KNOWN_COST: 'Lowest total cost among the compared offers (product, shipping, and known fees included).',
  RANKED_LOWEST_PARTIAL_COST: 'Lowest cost among known components — some fees (shipping, taxes, or duties) remain unknown and could change this ranking.',
  RANKED_BEST_MATCH: 'Best match for your criteria.',
});

export type RankingPreference =
  | 'BEST_MATCH'        // default — PriorityEngine's own order, untouched
  | 'PRICE_LOWEST'       // real: re-sorted by CostEngine's totalKnown cost
  | 'BEST_VALUE'         // accepted, NOT reordered — see module doc comment
  | 'FASTEST_DELIVERY'   // accepted, NOT reordered
  | 'BEST_RATED';        // accepted, NOT reordered

export const DEFAULT_RANKING_PREFERENCE: RankingPreference = 'BEST_MATCH';

/** Every value the union accepts — the single source both the type and this
 *  runtime guard stay in sync with. */
export const RANKING_PREFERENCES: readonly RankingPreference[] = [
  'BEST_MATCH', 'PRICE_LOWEST', 'BEST_VALUE', 'FASTEST_DELIVERY', 'BEST_RATED',
] as const;

/** Runtime check for a value that came from outside the type system
 *  (a stored profile, an HTTP body). */
export function isRankingPreference(value: unknown): value is RankingPreference {
  return typeof value === 'string' && (RANKING_PREFERENCES as readonly string[]).includes(value);
}

export interface RankedOfferWithCost extends RankedOffer {
  cost: CostBreakdown;
}

export interface RankingPreferenceResult {
  preference: RankingPreference;
  /** Ranked offers, each carrying its CostBreakdown, in the FINAL
   *  presentation order for `preference`. */
  offers: RankedOfferWithCost[];
  /** True only when `preference` actually changed the order (i.e. a real,
   *  implemented preference) — BEST_VALUE/FASTEST_DELIVERY/BEST_RATED
   *  always report false here since they don't reorder anything yet. */
  applied: boolean;
}

/**
 * Language-independent identifier for WHY an offer is #1 under a given
 * preference — pairs with i18n.ts's translate() exactly like
 * ExplanationEngine's headlineCode, never a hardcoded French sentence here.
 */
export function reasonCodeFor(preference: RankingPreference, offer: RankedOfferWithCost, rank: number): string {
  if (preference === 'PRICE_LOWEST' && rank === 1) {
    // A partially-known/unknown-cost offer landing first is NOT "the
    // cheapest" — it's the cheapest AMONG WHAT'S KNOWN, with components
    // that could still change the outcome. Never conflate the two.
    return offer.cost.certainty === 'known'
      ? 'RANKED_LOWEST_KNOWN_COST'
      : 'RANKED_LOWEST_PARTIAL_COST';
  }
  return 'RANKED_BEST_MATCH';
}

/**
 * Re-orders already-ranked offers for `preference`. `rankedOffers` MUST
 * already be the output of PriorityEngine (admissibility-filtered,
 * relevance-scored) — this never re-evaluates admissibility or criteria.
 */
export function sortByPreference(
  rankedOffers: RankedOffer[],
  preference: RankingPreference,
  costEngine: CostEngine = defaultCostEngine
): RankingPreferenceResult {
  const withCost: RankedOfferWithCost[] = rankedOffers.map(ro => ({
    ...ro,
    cost: costEngine.computeCost(ro.offer),
  }));

  if (preference === 'PRICE_LOWEST') {
    const sorted = [...withCost].sort((a, b) => {
      if (a.cost.currency !== b.cost.currency) return 0; // never compare incompatible currencies — see CostEngine.compareCost
      return a.cost.totalKnown - b.cost.totalKnown;
    });
    return { preference, offers: sorted, applied: true };
  }

  // BEST_MATCH and every not-yet-implemented preference: PriorityEngine's
  // own order is preserved untouched.
  return { preference, offers: withCost, applied: preference === 'BEST_MATCH' };
}
