/**
 * Capucine — Purchase readiness
 *
 * "Can this actually be bought?" — which is a different question from "does it
 * match what you asked for?" (admissibility) and from "is it the best one?"
 * (ranking).
 *
 * WHY THE DIMENSIONS ARE KEPT SEPARATE
 * ────────────────────────────────────
 * Collapsing them into one boolean is the mistake this module exists to
 * prevent. An offer can be perfectly well described and out of stock; in stock
 * and undeliverable to the user's country; deliverable and lacking any usable
 * purchase link. Each of those is a different thing to tell the user, and each
 * is separately unknown. So every dimension carries its own tri-state:
 *
 *   'confirmed'     we have positive evidence
 *   'unknown'       we have no evidence — NOT evidence of absence (INVARIANT 2)
 *   'not_available' we have positive evidence to the contrary
 *
 * 'unknown' is never rendered as 'not_available'. That distinction is the
 * whole point: "je ne sais pas si c'est en stock" is honest, "ce n'est pas en
 * stock" would be fabrication (INVARIANT 9).
 *
 * READINESS NEVER DECIDES ADMISSIBILITY. An offer with unknown stock is still
 * a perfectly admissible answer to the user's criteria; it is simply an answer
 * Capucine cannot yet promise to buy. Admissibility stays sovereign
 * (INVARIANT 4).
 *
 * Deterministic: derived from the offer's own data points, no clock, no I/O.
 */

import { DataPoint, Offer } from './types';
import { assessDataPoint, ConfidenceLevel } from './data-quality';

export type ReadinessState = 'confirmed' | 'unknown' | 'not_available';

export type ReadinessDimension = 'verified' | 'purchasable' | 'inStock' | 'deliverable';

export interface ReadinessAssessment {
  state: ReadinessState;
  /** Plain-language justification, safe to show as-is. */
  reason: string;
  /** Where the evidence came from, when there is any. */
  source?: string;
}

export interface OfferReadiness {
  /**
   * Always true by construction: an offer only exists here because discovery
   * found it. Kept explicit so the ladder reads completely.
   */
  discovered: true;
  /** Is the offer's core data (price, identity) solid enough to act on? */
  verified: ReadinessAssessment;
  /** Is there a usable way to actually buy it? */
  purchasable: ReadinessAssessment;
  /** Is it in stock? */
  inStock: ReadinessAssessment;
  /** Does it ship to where the user wants it? */
  deliverable: ReadinessAssessment;
  /**
   * True only when EVERY dimension is 'confirmed'. Deliberately strict: this
   * is the flag that says "Capucine has everything it needs to prepare this
   * purchase", so a single unknown must keep it false.
   */
  ready: boolean;
  /** Dimensions that are not 'confirmed', in ladder order. What is still missing. */
  pending: ReadinessDimension[];
  /** Dimensions that are positively 'not_available'. Real obstacles, not gaps. */
  blocked: ReadinessDimension[];
  /** One honest sentence summarising the state. */
  summary: string;
}

export interface ReadinessInput {
  /** ISO country code the user wants the product delivered to, when stated. */
  destinationCountry?: string;
  /**
   * Minimum confidence in the PRICE for the offer to count as 'verified'.
   * A price read out of a search snippet is not something to act on.
   */
  minimumPriceConfidence?: ConfidenceLevel;
}

const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** Read a characteristic, treating unknown/null as genuinely absent. */
function readCharacteristic(offer: Offer, keys: string[]): { key: string; dp: DataPoint<unknown> } | null {
  for (const key of keys) {
    const dp = offer.characteristics[key];
    if (!dp || dp.value === null || dp.status === 'unknown') continue;
    return { key, dp };
  }
  return null;
}

/**
 * Compute readiness for one offer.
 *
 * Every 'not_available' below is backed by a positive statement in the data.
 * Everything else that is not confirmed stays 'unknown'.
 */
export function assessPurchaseReadiness(offer: Offer, input: ReadinessInput = {}): OfferReadiness {
  const minimumPriceConfidence = input.minimumPriceConfidence ?? 'medium';

  // ── verified ─────────────────────────────────────────────────────────────
  const priceConfidence = assessDataPoint(offer.price);
  let verified: ReadinessAssessment;
  if (priceConfidence.level === 'none') {
    verified = { state: 'unknown', reason: 'aucun prix connu pour cette offre' };
  } else if (offer.price.status === 'contradictory') {
    verified = {
      state: 'not_available',
      reason: 'les sources ne s’accordent pas sur le prix — aucune valeur ne peut être retenue',
      source: priceConfidence.source,
    };
  } else if (CONFIDENCE_ORDER[priceConfidence.level] >= CONFIDENCE_ORDER[minimumPriceConfidence]) {
    verified = {
      state: 'confirmed',
      reason: `prix ${priceConfidence.rationale}`,
      source: priceConfidence.source,
    };
  } else {
    verified = {
      state: 'unknown',
      reason: `prix de confiance insuffisante pour être engageant (${priceConfidence.rationale})`,
      source: priceConfidence.source,
    };
  }

  // ── purchasable ──────────────────────────────────────────────────────────
  // A purchase link Capucine actually recorded. Never invented — an offer with
  // no URL is 'unknown', not 'not_available': the merchant surely sells it
  // somewhere, we just have no address to send the user to.
  const purchasable: ReadinessAssessment = offer.executionUrl
    ? {
        state: 'confirmed',
        reason: `lien d'achat enregistré (${offer.executionCapability ?? 'web_redirect'})`,
        source: offer.provenance?.source,
      }
    : {
        state: 'unknown',
        reason: "aucun lien d'achat n'a été relevé pour cette offre",
      };

  // ── inStock ──────────────────────────────────────────────────────────────
  const availability = readCharacteristic(offer, ['availability', 'stock', 'in_stock']);
  let inStock: ReadinessAssessment;
  if (!availability) {
    inStock = { state: 'unknown', reason: "le marchand ne publie pas d'information de stock" };
  } else {
    const raw = String(availability.dp.value).toLowerCase();
    if (/in_?stock|en\s*stock|disponible|available|true/.test(raw)) {
      inStock = { state: 'confirmed', reason: 'stock annoncé disponible', source: availability.dp.provenance?.source };
    } else if (/out_?of_?stock|rupture|indisponible|unavailable|false/.test(raw)) {
      inStock = { state: 'not_available', reason: 'stock annoncé épuisé', source: availability.dp.provenance?.source };
    } else if (/preorder|pré-?commande|precommande/.test(raw)) {
      inStock = { state: 'not_available', reason: 'disponible en précommande uniquement', source: availability.dp.provenance?.source };
    } else {
      inStock = { state: 'unknown', reason: `statut de stock non interprétable ("${raw}")`, source: availability.dp.provenance?.source };
    }
  }

  // ── deliverable ──────────────────────────────────────────────────────────
  let deliverable: ReadinessAssessment;
  if (!input.destinationCountry) {
    deliverable = { state: 'unknown', reason: 'aucune destination de livraison précisée' };
  } else {
    const ships = readCharacteristic(offer, ['deliversTo', 'shipsTo', 'shipping_countries']);
    if (!ships) {
      deliverable = { state: 'unknown', reason: `le marchand ne publie pas ses destinations de livraison (${input.destinationCountry} non vérifiable)` };
    } else {
      const countries = String(ships.dp.value).toUpperCase().split(/[,;/\s]+/).filter(Boolean);
      deliverable = countries.includes(input.destinationCountry.toUpperCase())
        ? { state: 'confirmed', reason: `livraison vers ${input.destinationCountry} annoncée par le marchand`, source: ships.dp.provenance?.source }
        : { state: 'not_available', reason: `le marchand annonce livrer vers ${countries.join(', ')}, pas vers ${input.destinationCountry}`, source: ships.dp.provenance?.source };
    }
  }

  const dimensions: Array<[ReadinessDimension, ReadinessAssessment]> = [
    ['verified', verified],
    ['purchasable', purchasable],
    ['inStock', inStock],
    ['deliverable', deliverable],
  ];

  const pending = dimensions.filter(([, a]) => a.state !== 'confirmed').map(([d]) => d);
  const blocked = dimensions.filter(([, a]) => a.state === 'not_available').map(([d]) => d);
  const ready = pending.length === 0;

  return {
    discovered: true,
    verified,
    purchasable,
    inStock,
    deliverable,
    ready,
    pending,
    blocked,
    summary: buildSummary(ready, blocked, pending, dimensions),
  };
}

const DIMENSION_LABELS: Record<ReadinessDimension, string> = {
  verified: 'vérification des informations',
  purchasable: "lien d'achat",
  inStock: 'stock',
  deliverable: 'livraison',
};

function buildSummary(
  ready: boolean,
  blocked: ReadinessDimension[],
  pending: ReadinessDimension[],
  dimensions: Array<[ReadinessDimension, ReadinessAssessment]>
): string {
  if (ready) return "Achat préparable : informations vérifiées, stock et livraison confirmés, lien d'achat disponible.";

  if (blocked.length > 0) {
    const reasons = dimensions
      .filter(([d]) => blocked.includes(d))
      .map(([, a]) => a.reason)
      .join(' ; ');
    return `Achat impossible en l'état — ${reasons}.`;
  }

  const missing = pending.map(d => DIMENSION_LABELS[d]).join(', ');
  return `Offre trouvée, mais tout n'est pas confirmé : ${missing} — information inconnue, ce qui ne veut pas dire indisponible.`;
}

/**
 * Points a CONFIRMED readiness fact is worth in the ranking.
 *
 * Bonus-only, exactly like the contextual-relevance bonus: a confirmed fact
 * earns points, an unknown earns nothing, and nothing is ever subtracted. An
 * offer whose merchant publishes no stock data therefore scores exactly what
 * it would have scored if readiness did not exist (INVARIANT 2). Small on
 * purpose — availability is a tie-breaker, never a reason to overturn what the
 * user actually asked for.
 */
export const READINESS_BONUS_MAX = 5;

export interface ReadinessScore {
  bonus: number;
  maxBonus: number;
  awarded: Array<{ dimension: ReadinessDimension; points: number; reason: string }>;
}

export function scoreReadiness(readiness: OfferReadiness): ReadinessScore {
  // Only the two dimensions that describe the WORLD (is it in stock, does it
  // ship here) are scored. 'verified' and 'purchasable' describe how well
  // CAPUCINE managed to read the page — rewarding those would rank merchants
  // by how machine-readable their site is, which has nothing to do with
  // whether the offer is good for the user.
  const scored: Array<[ReadinessDimension, ReadinessAssessment]> = [
    ['inStock', readiness.inStock],
    ['deliverable', readiness.deliverable],
  ];

  const share = READINESS_BONUS_MAX / scored.length;
  const awarded: ReadinessScore['awarded'] = [];
  let bonus = 0;

  for (const [dimension, assessment] of scored) {
    if (assessment.state !== 'confirmed') continue;
    const points = Math.round(share * 10) / 10;
    awarded.push({ dimension, points, reason: assessment.reason });
    bonus += points;
  }

  return { bonus: Math.round(bonus * 10) / 10, maxBonus: READINESS_BONUS_MAX, awarded };
}
