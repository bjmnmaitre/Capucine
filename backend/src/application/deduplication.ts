/**
 * Capucine — Deduplication Engine
 *
 * Identifies duplicate or same-product offers without merging distinct variants.
 *
 * INVARIANTS:
 * - iPhone 15 128GB ≠ iPhone 15 256GB (different storage = different product)
 * - Japanese edition ≠ European edition (different variant = different product)
 * - Same EAN + same merchant = definite duplicate
 * - Similar title alone ≠ same product
 *
 * Architecture:
 *   Candidates → DeduplicationEngine → DeduplicatedGroups → (per group) best offer or all offers
 *
 * GATE 9 IMPLEMENTATION
 */

import { Offer, Product, DataPoint, DataStatus } from '../domain/types';
import { ConflictResolver } from './conflict-resolver';

// ============================================================================
// DEDUPLICATION RESULT TYPES
// ============================================================================

export type DuplicateConfidence = 'certain' | 'high' | 'medium' | 'low' | 'uncertain';

/**
 * Formal match quality classification for deduplication groups.
 *
 * Mapped from DuplicateConfidence with explicit semantics:
 *
 * EXACT_MATCH        — Guaranteed same product. Hard identifier matched (EAN, ISBN, productId).
 *                      No variant check can override this.
 * HIGH_CONFIDENCE    — Very likely same product. Model + manufacturer + no variant conflicts.
 * PROBABLE           — Probably same product. Model match alone, or multi-signal without conflicts.
 * POSSIBLE           — Some evidence they're the same; some noise. Treat as speculative.
 * UNKNOWN_MATCH      — No reliable signals. Group should be treated as possibly distinct products.
 *
 * INVARIANT: EXACT_MATCH is only assigned when a universally scoped identifier (EAN/ISBN/productId)
 * matches exactly. Model references alone cannot produce EXACT_MATCH because they are
 * manufacturer-scoped and may collide across brands.
 */
export type MatchQuality =
  | 'EXACT_MATCH'
  | 'HIGH_CONFIDENCE'
  | 'PROBABLE'
  | 'POSSIBLE'
  | 'UNKNOWN_MATCH';

/** Map DuplicateConfidence → MatchQuality */
export function toMatchQuality(confidence: DuplicateConfidence): MatchQuality {
  switch (confidence) {
    case 'certain': return 'EXACT_MATCH';
    case 'high':    return 'HIGH_CONFIDENCE';
    case 'medium':  return 'PROBABLE';
    case 'low':     return 'POSSIBLE';
    case 'uncertain': return 'UNKNOWN_MATCH';
  }
}

/** Map MatchQuality → DuplicateConfidence */
export function toDuplicateConfidence(quality: MatchQuality): DuplicateConfidence {
  switch (quality) {
    case 'EXACT_MATCH':     return 'certain';
    case 'HIGH_CONFIDENCE': return 'high';
    case 'PROBABLE':        return 'medium';
    case 'POSSIBLE':        return 'low';
    case 'UNKNOWN_MATCH':   return 'uncertain';
  }
}

/**
 * A group of offers that likely refer to the same product/variant.
 */
export interface DeduplicationGroup {
  /** The canonical product identifier (best match or synthesized) */
  productKey: string;

  /** All offers in this group */
  offers: Offer[];

  /** Confidence that all offers in this group represent the same product */
  confidence: DuplicateConfidence;

  /**
   * Formal match quality classification.
   * Derived from confidence + signal combination. Use this for downstream decisions.
   */
  matchQuality: MatchQuality;

  /**
   * Identity signals used to reach this match quality.
   * Multiple signals → higher confidence than any single one alone.
   */
  identitySignals: IdentitySignal[];

  /** Why were these grouped together? */
  matchReason: MatchReason[];

  /** Were there signals they should NOT be grouped? */
  conflictSignals: string[];
}

/**
 * A single piece of evidence that two offers represent the same product.
 *
 * Multiple signals are combined via weighted scoring:
 * - Any signal with weight = 1.0 alone produces EXACT_MATCH
 * - Signals with weight < 1.0 accumulate: combined score determines quality
 */
export interface IdentitySignal {
  /** The type of signal */
  type: MatchType;
  /** What was matched */
  matchedValue: string;
  /** Signal strength [0, 1] */
  weight: number;
  /** Can this signal alone produce EXACT_MATCH? */
  isDefinitive: boolean;
}

export interface MatchReason {
  type: MatchType;
  description: string;
  weight: number; // 0-1, how much this contributes to confidence
}

export type MatchType =
  | 'identical_ean'          // Same EAN barcode — very strong
  | 'identical_isbn'         // Same ISBN
  | 'identical_sku'          // Same SKU (weaker — vendor-specific)
  | 'identical_model_ref'    // Same model+reference from same manufacturer
  | 'identical_product_id'   // Same internal product ID
  | 'very_similar_title'     // Very similar titles (fuzzy match)
  | 'same_category_specs'    // Same category + same key specs
  | 'url_redirect'           // One URL redirects to another product page
  | 'ai_suggested';          // AI suggested these are same (lower confidence)

/**
 * Result of deduplication on a set of candidates.
 */
export interface DeduplicationResult {
  groups: DeduplicationGroup[];

  /** Offers that could not be grouped (unique products) */
  unique: Offer[];

  /** Total offers input */
  totalInput: number;

  /** Total distinct products/groups output */
  distinctProducts: number;

  /** Offers removed as duplicates */
  duplicatesRemoved: number;

  processingTimeMs?: number;
}

// ============================================================================
// VARIANT SIGNAL
// ============================================================================

/**
 * Signals that indicate two offers are DIFFERENT variants (should NOT be merged).
 */
interface VariantSignal {
  field: string;
  valueA: unknown;
  valueB: unknown;
  description: string;
}

// ============================================================================
// DEDUPLICATION ENGINE
// ============================================================================

/**
 * Deterministic deduplication of candidate offers.
 *
 * Priority of matching signals (strongest first):
 * 1. Identical EAN → certain duplicate
 * 2. Identical ISBN → certain duplicate
 * 3. Identical product ID → certain duplicate
 * 4. Same model + manufacturer reference → high confidence
 * 5. Very similar title + same category + same key specs → medium confidence
 *
 * NEVER merges based on:
 * - Title alone
 * - Price similarity
 * - Merchant proximity
 * - Category alone
 */
export class DeduplicationEngine {
  private readonly VARIANT_FIELDS = [
    'storage', 'color', 'size', 'capacity', 'variant',
    'edition', 'region', 'language', 'version', 'model_suffix',
    'ram', 'cpu', 'gpu', 'resolution', 'memory',
  ];

  /**
   * Deduplicate a set of candidate offers.
   */
  deduplicate(candidates: Offer[]): DeduplicationResult {
    const start = Date.now();

    if (candidates.length === 0) {
      return {
        groups: [],
        unique: [],
        totalInput: 0,
        distinctProducts: 0,
        duplicatesRemoved: 0,
        processingTimeMs: 0,
      };
    }

    const groups: DeduplicationGroup[] = [];
    const assigned = new Set<string>(); // offerId → already grouped

    for (const offer of candidates) {
      if (assigned.has(offer.id)) continue;

      // Find all offers that match this one
      const matchingOffers: Offer[] = [offer];
      const matchReasons: MatchReason[] = [];
      const conflictSignals: string[] = [];
      const allIdentitySignals: IdentitySignal[] = [];

      for (const other of candidates) {
        if (other.id === offer.id || assigned.has(other.id)) continue;

        const match = this.matchOffers(offer, other);

        if (match.shouldGroup) {
          // Verify no variant signals (don't merge different variants)
          const variants = this.detectVariantSignals(offer, other);
          if (variants.length > 0) {
            conflictSignals.push(...variants.map(v => v.description));
            // Variant signals prevent grouping unless we have a certain identifier match
            // (EAN/ISBN/productId override variants; model-name matches do not)
            if (match.quality !== 'EXACT_MATCH') {
              continue;
            }
          }

          matchingOffers.push(other);
          matchReasons.push(...match.reasons);
          allIdentitySignals.push(...match.identitySignals);
          assigned.add(other.id);
        }
      }

      assigned.add(offer.id);

      const confidence = this.computeGroupConfidence(matchReasons, conflictSignals);
      const matchQuality = toMatchQuality(confidence);

      groups.push({
        productKey: this.buildProductKey(offer, matchingOffers),
        offers: matchingOffers,
        confidence,
        matchQuality,
        identitySignals: this.deduplicateSignals(allIdentitySignals),
        matchReason: matchReasons,
        conflictSignals,
      });
    }

    const allGrouped = groups.flatMap(g => g.offers);
    const unique = groups.filter(g => g.offers.length === 1).flatMap(g => g.offers);
    const duplicatesRemoved = candidates.length - groups.length;

    return {
      groups,
      unique,
      totalInput: candidates.length,
      distinctProducts: groups.length,
      duplicatesRemoved,
      processingTimeMs: Date.now() - start,
    };
  }

  /**
   * Select the best offer from a group (the one to present to the user).
   * Other offers in the group are alternatives.
   */
  selectBestOffer(group: DeduplicationGroup): {
    best: Offer;
    alternatives: Offer[];
    selectionReason: string;
  } {
    if (group.offers.length === 1) {
      return {
        best: group.offers[0],
        alternatives: [],
        selectionReason: 'Only offer in group',
      };
    }

    // Sort by: price known + price low + data completeness
    const scored = group.offers.map(offer => ({
      offer,
      score: this.scoreOfferCompleteness(offer),
    }));

    scored.sort((a, b) => b.score - a.score);

    return {
      best: scored[0].offer,
      alternatives: scored.slice(1).map(s => s.offer),
      selectionReason: `Selected by completeness/price score (${scored[0].score})`,
    };
  }

  /**
   * Merge all offers in a group into a single enriched Offer.
   *
   * - Fields where ALL sources AGREE → status: 'verified'
   * - Fields from a SINGLE source → status: 'known'
   * - Fields where sources DISAGREE → status: 'contradictory' (CONFLICTING preserved)
   * - Fields not present in any source → omitted (not injected as unknown)
   *
   * INVARIANT: No information is silently discarded.
   * The best offer is used as the structural base; conflicting fields are
   * overwritten with their resolved DataPoint.
   *
   * INVARIANT: CONFLICTING ≠ UNKNOWN. A contradictory field is distinct from
   * an absent field.
   */
  mergeGroup(group: DeduplicationGroup): {
    merged: Offer;
    conflicts: Array<{ field: string; sources: string[]; values: unknown[] }>;
  } {
    const { best, alternatives } = this.selectBestOffer(group);
    if (alternatives.length === 0) {
      return { merged: best, conflicts: [] };
    }

    const resolver = new ConflictResolver();
    const allOffers = [best, ...alternatives];
    const conflicts: Array<{ field: string; sources: string[]; values: unknown[] }> = [];

    // Collect all characteristic keys across all offers
    const allKeys = new Set<string>();
    for (const offer of allOffers) {
      Object.keys(offer.characteristics).forEach(k => allKeys.add(k));
    }

    const mergedCharacteristics = { ...best.characteristics };

    for (const key of allKeys) {
      // Gather DataPoints for this key from all offers that have it
      const dataPoints = allOffers
        .filter(o => key in o.characteristics)
        .map(o => {
          const dp = o.characteristics[key];
          return {
            ...dp,
            sourceId: o.provenance?.source ?? o.merchant.id,
            sourceName: o.merchant.name,
          };
        });

      if (dataPoints.length <= 1) {
        // Only one source — keep as-is
        continue;
      }

      // Check if all values agree (after normalization to string)
      const nonNullValues = dataPoints
        .filter(dp => dp.status !== 'unknown' && dp.value !== null)
        .map(dp => String(dp.value).toLowerCase().trim());

      const uniqueValues = [...new Set(nonNullValues)];

      if (uniqueValues.length === 0) {
        // All unknown — keep as unknown
        mergedCharacteristics[key] = { value: null, status: 'unknown' };
        continue;
      }

      if (uniqueValues.length === 1) {
        // All sources agree → VERIFIED
        const representative = dataPoints.find(dp => dp.status !== 'unknown' && dp.value !== null)!;
        mergedCharacteristics[key] = {
          ...representative,
          status: 'verified',
          // Merge all provenances into the first one (union of sources)
          provenance: representative.provenance ?? { source: representative.sourceId, retrievedAt: new Date() },
        } as DataPoint<unknown>;
        continue;
      }

      // Sources disagree → CONFLICTING (contradictory)
      // Use ConflictResolver to produce the best single resolution, but mark status as contradictory
      const resolution = resolver.resolve(key, dataPoints);

      conflicts.push({
        field: key,
        sources: dataPoints.map(dp => dp.sourceId),
        values: dataPoints.map(dp => dp.value),
      });

      // Preserve CONFLICTING status — do NOT silently resolve to a single value
      // Resolution may propose a best guess but we keep contradictory status
      // so downstream (Priority Engine, Explanation) knows this field is uncertain
      mergedCharacteristics[key] = {
        value: resolution.resolvedValue,
        status: 'contradictory',  // INVARIANT: don't hide the conflict
        provenance: dataPoints[0].provenance ?? { source: dataPoints[0].sourceId, retrievedAt: new Date() },
      } as DataPoint<unknown>;
    }

    return {
      merged: {
        ...best,
        characteristics: mergedCharacteristics,
        // Annotate that this offer was merged from multiple sources
        provenance: {
          source: allOffers.map(o => o.provenance?.source ?? o.merchant.id).join('+'),
          retrievedAt: best.provenance?.retrievedAt ?? new Date(),
          reliability: conflicts.length === 0 ? 0.95 : 0.75 - conflicts.length * 0.05,
        },
      },
      conflicts,
    };
  }

  // ── Matching ──────────────────────────────────────────────────────────────

  /**
   * Compare two offers and compute a match verdict using ALL available signals.
   *
   * MULTI-SIGNAL ACCUMULATION:
   * Rather than returning on the first match, we collect every signal and
   * compute a combined score. This means:
   *  - model match alone → PROBABLE (0.65)
   *  - model match + same category → PROBABLE/HIGH (0.65 + 0.20 = 0.85)
   *  - model match + same mfg + same category → HIGH (0.80 + 0.20 = 1.0 capped → certain?)
   *    No — we cap multi-signal at HIGH_CONFIDENCE unless a definitive identifier matches.
   *
   * EXACT_MATCH requires a DEFINITIVE identifier (EAN/ISBN/productId).
   * No combination of non-definitive signals can reach EXACT_MATCH.
   *
   * INVARIANT: Confidence only reflects identity; variant conflicts are checked separately.
   */
  private matchOffers(a: Offer, b: Offer): {
    shouldGroup: boolean;
    confidence: DuplicateConfidence;
    quality: MatchQuality;
    reasons: MatchReason[];
    identitySignals: IdentitySignal[];
  } {
    const reasons: MatchReason[] = [];
    const identitySignals: IdentitySignal[] = [];
    let accumulatedWeight = 0;
    let hasDefinitiveSignal = false;

    // ── 1. Definitive identifier signals (weight = 1.0) ──────────────────────

    // Product ID
    if (a.productId && b.productId && a.productId === b.productId) {
      const signal: IdentitySignal = {
        type: 'identical_product_id',
        matchedValue: a.productId,
        weight: 1.0,
        isDefinitive: true,
      };
      identitySignals.push(signal);
      reasons.push({ type: 'identical_product_id', description: `Identical product ID: ${a.productId}`, weight: 1.0 });
      hasDefinitiveSignal = true;
    }

    // EAN
    const eanA = this.getCharValue(a, 'ean');
    const eanB = this.getCharValue(b, 'ean');
    if (eanA && eanB && eanA === eanB) {
      identitySignals.push({ type: 'identical_ean', matchedValue: String(eanA), weight: 1.0, isDefinitive: true });
      reasons.push({ type: 'identical_ean', description: `Identical EAN: ${eanA}`, weight: 1.0 });
      hasDefinitiveSignal = true;
    }

    // ISBN
    const isbnA = this.getCharValue(a, 'isbn');
    const isbnB = this.getCharValue(b, 'isbn');
    if (isbnA && isbnB && isbnA === isbnB) {
      identitySignals.push({ type: 'identical_isbn', matchedValue: String(isbnA), weight: 1.0, isDefinitive: true });
      reasons.push({ type: 'identical_isbn', description: `Identical ISBN: ${isbnA}`, weight: 1.0 });
      hasDefinitiveSignal = true;
    }

    // Definitive → EXACT_MATCH immediately (don't bother accumulating more)
    if (hasDefinitiveSignal) {
      return {
        shouldGroup: true,
        confidence: 'certain',
        quality: 'EXACT_MATCH',
        reasons,
        identitySignals,
      };
    }

    // ── 2. Strong non-definitive signals (accumulate) ────────────────────────

    // SKU — strong but vendor-scoped (only meaningful if same merchant)
    const skuA = this.getCharValue(a, 'sku');
    const skuB = this.getCharValue(b, 'sku');
    if (skuA && skuB && skuA === skuB && a.merchant.id === b.merchant.id) {
      const w = 0.90;
      accumulatedWeight += w;
      identitySignals.push({ type: 'identical_sku', matchedValue: String(skuA), weight: w, isDefinitive: false });
      reasons.push({ type: 'identical_sku', description: `Same SKU "${skuA}" at same merchant "${a.merchant.id}"`, weight: w });
    }

    // Model + manufacturer (0.80 with mfg, 0.65 without)
    const modelA = this.getCharValue(a, 'model') || this.getCharValue(a, 'model_ref');
    const modelB = this.getCharValue(b, 'model') || this.getCharValue(b, 'model_ref');
    const mfgA = this.getCharValue(a, 'manufacturer') || this.getCharValue(a, 'brand');
    const mfgB = this.getCharValue(b, 'manufacturer') || this.getCharValue(b, 'brand');

    if (modelA && modelB && this.isSimilarString(String(modelA), String(modelB))) {
      const bothHaveMfg = mfgA && mfgB && this.isSimilarString(String(mfgA), String(mfgB));
      const w = bothHaveMfg ? 0.80 : 0.65;
      accumulatedWeight += w;
      identitySignals.push({ type: 'identical_model_ref', matchedValue: String(modelA), weight: w, isDefinitive: false });
      reasons.push({
        type: 'identical_model_ref',
        description: bothHaveMfg
          ? `Same model "${modelA}" from same manufacturer "${mfgA}"`
          : `Similar model references: "${modelA}" ≈ "${modelB}"`,
        weight: w,
      });
    }

    // ── 3. Weak corroborating signals (add small weight bonus) ────────────────

    // Same category (minor corroborating signal — not enough alone to group)
    const catA = this.getCharValue(a, 'category');
    const catB = this.getCharValue(b, 'category');
    if (catA && catB && this.isSimilarString(String(catA), String(catB)) && accumulatedWeight > 0) {
      const w = 0.15;
      accumulatedWeight += w;
      identitySignals.push({ type: 'same_category_specs', matchedValue: String(catA), weight: w, isDefinitive: false });
      reasons.push({ type: 'same_category_specs', description: `Same category: "${catA}"`, weight: w });
    }

    // Very similar name (Levenshtein-free approximation: normalized string equality)
    const nameA = a.characteristics['name'] ?? a.characteristics['title'];
    const nameB = b.characteristics['name'] ?? b.characteristics['title'];
    if (nameA?.status !== 'unknown' && nameB?.status !== 'unknown' &&
        nameA?.value && nameB?.value &&
        this.isSimilarString(String(nameA.value), String(nameB.value)) &&
        accumulatedWeight > 0) {
      const w = 0.20;
      accumulatedWeight += w;
      identitySignals.push({ type: 'very_similar_title', matchedValue: String(nameA.value), weight: w, isDefinitive: false });
      reasons.push({ type: 'very_similar_title', description: `Very similar name: "${nameA.value}"`, weight: w });
    }

    // ── 4. Decision ───────────────────────────────────────────────────────────

    if (identitySignals.length === 0 || accumulatedWeight < 0.40) {
      return { shouldGroup: false, confidence: 'uncertain', quality: 'UNKNOWN_MATCH', reasons: [], identitySignals: [] };
    }

    // Cap multi-signal at 'high' (never 'certain' without a definitive identifier)
    // but use the accumulated score to distinguish high/medium/low
    const confidence = this.scoreToConfidence(accumulatedWeight);
    // Multi-signal without definitive identifier: cap at HIGH_CONFIDENCE
    const quality: MatchQuality =
      confidence === 'certain' ? 'HIGH_CONFIDENCE' : toMatchQuality(confidence);

    return { shouldGroup: true, confidence, quality, reasons, identitySignals };
  }

  private deduplicateSignals(signals: IdentitySignal[]): IdentitySignal[] {
    const seen = new Set<string>();
    return signals.filter(s => {
      const key = `${s.type}:${s.matchedValue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private scoreToConfidence(score: number): DuplicateConfidence {
    if (score >= 1.0) return 'certain';
    if (score >= 0.80) return 'high';
    if (score >= 0.60) return 'medium';
    if (score >= 0.40) return 'low';
    return 'uncertain';
  }

  // ── Variant detection ─────────────────────────────────────────────────────

  private detectVariantSignals(a: Offer, b: Offer): VariantSignal[] {
    const signals: VariantSignal[] = [];

    for (const field of this.VARIANT_FIELDS) {
      const valA = this.getCharValue(a, field);
      const valB = this.getCharValue(b, field);

      // If both have values and they differ → variant signal
      if (valA !== null && valB !== null && valA !== undefined && valB !== undefined) {
        if (!this.isSimilarString(String(valA), String(valB))) {
          signals.push({
            field,
            valueA: valA,
            valueB: valB,
            description: `Different ${field}: "${valA}" vs "${valB}"`,
          });
        }
      }
    }

    return signals;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getCharValue(offer: Offer, field: string): unknown {
    const char = offer.characteristics[field];
    if (char && char.status !== 'unknown') {
      return char.value;
    }
    return null;
  }

  private isSimilarString(a: string, b: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
    return normalize(a) === normalize(b);
  }

  private computeGroupConfidence(
    reasons: MatchReason[],
    conflictSignals: string[]
  ): DuplicateConfidence {
    if (reasons.length === 0) return 'uncertain';

    const maxWeight = Math.max(...reasons.map(r => r.weight));

    // Strong identifier → certain
    if (maxWeight >= 1.0) return 'certain';

    // Conflict signals reduce confidence
    const penalty = conflictSignals.length * 0.2;
    const adjustedWeight = maxWeight - penalty;

    if (adjustedWeight >= 0.85) return 'high';
    if (adjustedWeight >= 0.65) return 'medium';
    if (adjustedWeight >= 0.40) return 'low';
    return 'uncertain';
  }

  private buildProductKey(primary: Offer, all: Offer[]): string {
    // Use product ID if shared
    const productIds = [...new Set(all.map(o => o.productId).filter(Boolean))];
    if (productIds.length === 1) return productIds[0];

    // Use EAN if present
    const ean = this.getCharValue(primary, 'ean');
    if (ean) return `ean:${ean}`;

    // Use model reference
    const model = this.getCharValue(primary, 'model');
    if (model) return `model:${model}`;

    // Fallback to primary offer ID
    return `offer:${primary.id}`;
  }

  private scoreOfferCompleteness(offer: Offer): number {
    let score = 0;

    // Known price: strong signal
    if (offer.price.status !== 'unknown' && offer.price.value !== null) {
      score += 40;
      // Prefer lower prices
      if (offer.price.value < 500) score += 10;
    }

    // Number of known characteristics
    const knownChars = Object.values(offer.characteristics).filter(
      c => c.status !== 'unknown' && c.value !== null
    ).length;
    score += Math.min(30, knownChars * 5);

    // Verified data
    const verifiedChars = Object.values(offer.characteristics).filter(
      c => c.status === 'verified'
    ).length;
    score += Math.min(20, verifiedChars * 4);

    // Known shipping
    if (offer.shippingCost.status !== 'unknown') score += 10;

    return score;
  }
}

// ============================================================================
// MATCH TYPE CLASSIFIER (for result presentation)
// ============================================================================

/**
 * Classifies how well an offer matches the user's request.
 * Used in result presentation layer.
 *
 * INVARIANT: An 'exact_match' must actually be exact.
 * A 'similar' result must never be presented as 'exact_match'.
 */
export type OfferMatchClassification =
  | 'exact_match'         // All required criteria met, perfect
  | 'match_with_unknown'  // All known criteria met, some unknown
  | 'partial_match'       // Most criteria met, minor misses
  | 'variant'             // Same product family, different spec
  | 'alternative'         // Different product, same use case
  | 'similar'             // Loosely related
  | 'incompatible';       // Does not meet key requirements

export function classifyMatch(
  satisfiedConstraints: number,
  totalConstraints: number,
  unknownCount: number,
  hasViolations: boolean
): OfferMatchClassification {
  if (hasViolations) return 'incompatible';
  if (totalConstraints === 0) return 'match_with_unknown';

  const ratio = satisfiedConstraints / totalConstraints;

  if (ratio === 1 && unknownCount === 0) return 'exact_match';
  if (ratio === 1 && unknownCount > 0) return 'match_with_unknown';
  if (ratio >= 0.8) return 'partial_match';
  if (ratio >= 0.5) return 'alternative';
  return 'similar';
}
