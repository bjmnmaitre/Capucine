/**
 * Capucine — Match Quality Classification
 *
 * REAL IMPLEMENTATION: deterministic, testable classification of how a
 * discovery candidate relates to what the user actually asked for.
 *
 * WHY THIS EXISTS
 * ────────────────
 * Before this module, discovery candidates only carried a continuous
 * matchScore (0-1) used to sort results. A 0.4 score doesn't tell anyone
 * — user or downstream code — whether a candidate is the exact product
 * requested, a close variant, or an unrelated alternative that merely
 * shares a few keywords. That distinction matters most exactly when it's
 * hardest to get right: rare-product searches, where a handful of loosely
 * related results can crowd out (or be mistaken for) the real thing.
 *
 * This is classification, not ranking — it does NOT touch PriorityEngine
 * or influence the deterministic ranking in any way. It is descriptive
 * metadata attached to a candidate, exactly like provenance.
 *
 * INVARIANT: "exact_match" is only ever assigned when an explicit exact
 * reference term (typically a model number/SKU already identified upstream
 * by SearchPhaseQueryBuilder) is found, verbatim (modulo spacing/dashes),
 * in the candidate's own text. Keyword overlap alone — however high —
 * can never produce "exact_match". This mirrors the same discipline
 * already applied to EXACT_MATCH in deduplication.ts (EAN/ISBN/productId
 * only, never a fuzzy signal).
 */

import { SearchMatchQuality } from '../domain/types';

export interface MatchQualityInput {
  /** Combined searchable text for this candidate (title + snippet, typically). */
  text: string;
  /**
   * Exact reference terms that were searched for (e.g. a model number).
   * Comes from SearchPhaseQueryBuilder's phaseTerms.exactRefs when available.
   * Empty when the search had no identifiable exact reference (e.g. a
   * generic descriptive request like "casque audio silencieux").
   */
  exactRefs: string[];
  keywordsMatched: number;
  keywordsTotal: number;
}

/** Normalizes a reference for comparison: lowercase, strip spaces/dashes. */
function normalizeRef(value: string): string {
  return value.toLowerCase().replace(/[-\s]/g, '');
}

export function classifyMatchQuality(input: MatchQualityInput): SearchMatchQuality {
  const normalizedText = normalizeRef(input.text);

  if (input.exactRefs.length > 0) {
    const hasExactRef = input.exactRefs.some((ref) => normalizedText.includes(normalizeRef(ref)));
    if (hasExactRef) return 'exact_match';
    // An exact reference was searched for but this candidate doesn't
    // contain it — it can never be "exact_match", fall through to the
    // keyword-overlap bands below (it may still be a reasonable close/
    // partial match, or a pure alternative).
  }

  if (input.keywordsTotal === 0) return 'unknown';

  const ratio = input.keywordsMatched / input.keywordsTotal;
  if (ratio >= 0.75) return 'close_match';
  if (ratio >= 0.4) return 'partial_match';
  if (ratio > 0) return 'alternative';
  return 'unknown';
}
