/**
 * Capucine Priority Engine
 *
 * Deterministic ranking engine independent of:
 * - AI models (Claude, OpenAI, etc.)
 * - Data sources (merchants, APIs, etc.)
 * - Execution mechanisms (automation, redirection, etc.)
 * - Merchant relationships or partnerships
 *
 * This engine implements the 20 architectural invariants.
 */

import {
  RankingRequest,
  RankingResult,
  RankedOffer,
  CriterionScore,
  PreferenceCriterion,
  PreferenceLevel,
  Offer,
  DataStatus,
} from '../domain/types';
import { AdmissibilityResult } from '../domain/admissibility';
import { scoreContextualRelevance } from './contextual-relevance';
import { OfferReadiness, scoreReadiness } from '../domain/purchase-readiness';

// ============================================================================
// CORE RANKING LOGIC
// ============================================================================

/**
 * Score a single offer against the effective criteria.
 * Returns per-criterion breakdown + overall score.
 *
 * Eligibility (satisfiesAllConstraints/violatedConstraints):
 * - When `admissibilityResult` is provided (the real Capucine pipeline always
 *   provides it — see rankOffers()/CapucineEngine), it is the SOLE source of
 *   truth: this function reports exactly what AdmissibilityEngine already
 *   decided, instead of re-deriving eligibility from criterion scores. This
 *   is what closes the divergence risk between the two engines — required/
 *   forbidden pass-fail is decided in exactly one place.
 * - When omitted (every existing direct caller of rankOffers()/scoreOffer()
 *   that doesn't run offers through AdmissibilityEngine first — e.g. the
 *   ~100 call sites across the test suite that use PriorityEngine as a
 *   standalone scorer), this function falls back to its own self-contained
 *   evaluation, unchanged from before. Backward compatible by construction.
 *
 * Per-criterion scoring (criterionScores/overallScore) is unaffected either
 * way — that's a ranking-quality dimension (e.g. "how far under budget"),
 * not an eligibility decision, and stays PriorityEngine's responsibility.
 */
function scoreOffer(
  offer: Offer,
  effectiveCriteria: PreferenceCriterion[],
  admissibilityResult?: AdmissibilityResult
): {
  criterionScores: CriterionScore[];
  overallScore: number;
  /** Unrounded score — ordering uses this. See RankedOffer.overallScoreExact. */
  overallScoreExact: number;
  satisfiesAllConstraints: boolean;
  violatedConstraints: Array<{criterionId: string; criterionName: string; reason: string}>;
} {
  const criterionScores: CriterionScore[] = [];
  let totalScore = 0;
  let constraintCount = 0;
  let satisfiesAllConstraints = true;
  const violatedConstraints: Array<{criterionId: string; criterionName: string; reason: string}> = [];

  for (const criterion of effectiveCriteria) {
    const score = scoreCriterion(offer, criterion);

    criterionScores.push(score);

    if (!admissibilityResult) {
      // No admissibility verdict supplied — self-contained fallback (see doc above).
      if (criterion.level === 'forbidden' && score.score > 0) {
        violatedConstraints.push({
          criterionId: criterion.id,
          criterionName: criterion.name,
          reason: score.reasoning, // Use detailed reasoning from score
        });
        satisfiesAllConstraints = false;
      }

      if (criterion.level === 'required' && score.score < 50) {
        violatedConstraints.push({
          criterionId: criterion.id,
          criterionName: criterion.name,
          reason: score.reasoning, // Use detailed reasoning from score
        });
        satisfiesAllConstraints = false;
      }
    }

    // Weight scoring by preference level
    const weight = getLevelWeight(criterion.level);
    // Aggregate the UNROUNDED sub-score — see CriterionScore.scoreExact.
    totalScore += (score.scoreExact ?? score.score) * weight;
    constraintCount += weight;
  }

  // Normalize to 0-100 scale
  const overallScore = constraintCount > 0 ? totalScore / constraintCount : 0;

  if (admissibilityResult) {
    // Trust AdmissibilityEngine's verdict verbatim — no re-derivation.
    satisfiesAllConstraints = admissibilityResult.eligible;
    for (const v of admissibilityResult.violations) {
      violatedConstraints.push({
        criterionId: v.criterionId,
        criterionName: v.criterionName,
        reason: v.violation,
      });
    }
  }

  return {
    criterionScores,
    overallScore: Math.round(overallScore),
    // Kept unrounded so ordering can use the real difference — see
    // RankedOffer.overallScoreExact.
    overallScoreExact: overallScore,
    satisfiesAllConstraints,
    violatedConstraints,
  };
}

/**
 * Score an offer on a single criterion.
 * Handles known, unknown, contradictory data carefully.
 *
 * CRITICAL: Unknown data does NOT automatically mean negative score.
 */
function scoreCriterion(offer: Offer, criterion: PreferenceCriterion): CriterionScore {
  const id = criterion.id;
  const name = criterion.name;
  const level = criterion.level;

  // Try to find the relevant data in the offer
  const offerData = offer.characteristics[id] || extractSpecialCriterion(offer, id, criterion);

  // Criteria opted into unknownPolicy: 'pass' (e.g. category — a best-effort
  // classification hint, not a strictly verifiable spec value) score missing/
  // unknown data as neutral (50) rather than a sub-50 "likely fails" score.
  // This mirrors AdmissibilityEngine.resolveUnknownData() so a criterion that
  // passes the admissibility gate as UNKNOWN isn't silently re-rejected here
  // by ranking's own (separate) hard-constraint check — see scoreOffer().
  const unknownPolicy = criterion.parameters?.unknownPolicy as 'reject' | 'pass' | undefined;

  // CRITICAL LOGIC: Handle data status properly
  if (!offerData) {
    // Criterion data not found in this offer
    // Don't assume negative; indicate missing data
    return {
      criterionId: id,
      criterionName: name,
      level,
      score: handleMissingData(level, unknownPolicy),
      reasoning: `No data available for criterion '${name}'`,
      dataUsed: {
        status: 'unknown',
      },
    };
  }

  switch (offerData.status) {
    case 'verified':
    case 'known': {
      // Data is known; evaluate it
      const exactScore = evaluateDataValue(offerData.value, criterion);
      return {
        criterionId: id,
        criterionName: name,
        level,
        // Rounded for display; the exact value below is what aggregation uses.
        score: Math.round(exactScore),
        scoreExact: exactScore,
        reasoning: `Criterion '${name}' evaluated: ${formatValue(offerData.value)}`,
        dataUsed: {
          value: offerData.value,
          status: offerData.status,
          source: offerData.provenance?.source,
        },
      };
    }

    case 'unknown':
      // Critical: Unknown is NOT negative
      return {
        criterionId: id,
        criterionName: name,
        level,
        score: handleUnknownData(level, unknownPolicy),
        reasoning: `Criterion '${name}' cannot be verified (data unknown)`,
        dataUsed: {
          status: 'unknown',
          source: offerData.provenance?.source,
        },
      };

    case 'contradictory':
      // Contradictory data exists; handle carefully
      return {
        criterionId: id,
        criterionName: name,
        level,
        score: handleContradictoryData(level, offerData.conflictingValues),
        reasoning: `Criterion '${name}' has contradictory data from multiple sources: ${
          offerData.conflictingValues?.map(formatValue).join(', ') || 'unknown'
        }`,
        dataUsed: {
          status: 'contradictory',
          source: offerData.provenance?.source,
        },
      };

    case 'unverifiable':
      // Information exists but cannot be verified
      return {
        criterionId: id,
        criterionName: name,
        level,
        score: handleUnverifiableData(level),
        reasoning: `Criterion '${name}' exists but cannot be verified`,
        dataUsed: {
          status: 'unverifiable',
          source: offerData.provenance?.source,
        },
      };

    default:
      // Fallback
      return {
        criterionId: id,
        criterionName: name,
        level,
        score: 50, // Neutral
        reasoning: `Criterion '${name}' could not be evaluated`,
        dataUsed: {
          status: 'unknown',
        },
      };
  }
}

/**
 * Extract criteria that apply to special offer fields.
 * E.g., price criterion uses offer.price DataPoint
 */
function extractSpecialCriterion(offer: Offer, criterionId: string, criterion?: PreferenceCriterion) {
  // Standard offer fields
  if (criterionId === 'price' || criterionId === 'budget') {
    return offer.price;
  }
  if (criterionId === 'shipping' || criterionId === 'shipping-cost') {
    return offer.shippingCost;
  }

  // Merchant ID check: criterion has merchantId parameter
  // Used to score forbidden/required constraints on merchant identity
  // Returns boolean DataPoint: true = this offer IS from that merchant
  const merchantId = criterion?.parameters?.merchantId as string | undefined;
  if (merchantId) {
    const matches = offer.merchant.id === merchantId;
    return { value: matches, status: 'known' as const };
  }

  // Criterion ID starts with 'merchant-': suffix is the merchant ID to check
  if (criterionId.startsWith('merchant-')) {
    const extractedMerchantId = criterionId.slice('merchant-'.length);
    const matches = offer.merchant.id === extractedMerchantId;
    return { value: matches, status: 'known' as const };
  }

  // Field redirect: criterion.parameters.field points to a different characteristics key.
  // Allows criteria like { id: 'eu_origin', parameters: { field: 'country_of_origin', ... } }
  // to look up offer.characteristics['country_of_origin'] instead of 'eu_origin'.
  const fieldRedirect = criterion?.parameters?.field as string | undefined;
  if (fieldRedirect && offer.characteristics[fieldRedirect] !== undefined) {
    return offer.characteristics[fieldRedirect];
  }

  // Not found
  return null;
}

/**
 * Evaluate a data value against a criterion.
 * Example: Is price 599€ good for a criterion "budget: 600€"?
 *
 * For CONSTRAINTS (required, forbidden): 0-100 pass/fail
 * For PREFERENCES (important, preference): 0-100 gradual scale
 */
/**
 * NOTE — returns FULL PRECISION on purpose. It used to round each result to an
 * integer, which made two offers 10 € apart score identically (319 € and 329 €
 * against a 400 € budget both became 84) and destroyed the difference before
 * the weighted total was even computed. Callers round for display; the value
 * that feeds aggregation must not be rounded here.
 */
function evaluateDataValue(rawValue: unknown, criterion: PreferenceCriterion): number {
  // Defensive coercion: catalog entries may store typed values as strings.
  // The NormalizationEngine is the canonical place to do this, but scoring must
  // be robust to both representations.
  //
  // Rules (applied in order, first match wins):
  //   'true' / 'false'  → boolean  (e.g., foldable: 'true')
  //   numeric string     → number   (e.g., repairability_index: '10')
  //   everything else    → original value
  let value: unknown = rawValue;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (trimmed === 'true') value = true;
    else if (trimmed === 'false') value = false;
    else if (trimmed !== '' && !isNaN(Number(trimmed))) value = Number(trimmed);
  }

  const isConstraint = criterion.level === 'required' || criterion.level === 'forbidden';

  // For price criteria
  if (criterion.id === 'price' || criterion.id === 'budget') {
    const maxBudget = (criterion.parameters?.maxBudget as number) ?? Infinity;
    const actualPrice = value as number;

    // Use same scoring formula for both constraints and preferences.
    // This allows ranking differentiation even after constraint admissibility is established.
    // Constraint pass/fail is determined elsewhere (score >= 50 threshold); here we score the quality.
    const ratio = actualPrice / maxBudget;
    if (ratio > 1) {
      // Price exceeds budget: fail hard gate
      return 0;
    } else {
      // Price is under/at budget: score based on how far under budget
      // Cheaper (lower ratio) = higher score
      return 100 - ratio * 20;
    }
  }

  // For boolean criteria
  if (typeof value === 'boolean') {
    // Check if criterion specifies a desired value
    const desiredValue = (criterion.parameters?.desiredValue as boolean) ?? undefined;

    if (desiredValue !== undefined) {
      // Explicit desired value: score based on match
      return value === desiredValue ? 100 : 0;
    }

    // Heuristic: if criterion name contains "avoid/exclude/not", invert semantics
    // For forbidden/required constraints with "avoid" names:
    // - true (thing is present) = bad/violation
    // - false (thing is absent) = good/satisfied
    const lowerName = criterion.name.toLowerCase();
    const isAvoid = lowerName.includes('avoid') || lowerName.includes('exclude') || lowerName.includes('not');

    if (isAvoid) {
      // For "avoid X" criteria:
      // - value=true (X is present) should score high when forbidden (violation indicator)
      // - value=false (X is absent) should score low when forbidden (OK indicator)
      // This works because forbidden constraint checks: score.score > 0 = violation
      if (criterion.level === 'forbidden') {
        return value ? 100 : 0; // True = violation present, False = OK
      } else {
        return value ? 0 : 100; // True = thing present (bad for avoid), False = thing absent (good)
      }
    }

    // Default: true = criterion satisfied
    return value ? 100 : 0;
  }

  // For string criteria (countries, warranty, etc.)
  if (typeof value === 'string') {
    // Treat literal 'unknown' as neutral (will be handled as missing data)
    if (value.toLowerCase() === 'unknown' || value === '' || value.toLowerCase() === 'n/a') {
      return 50; // Neutral
    }

    // requiredValue: single string that must match exactly (alternative to preferredValues)
    // e.g., { requiredValue: 'EE' } → Fairphone (EE) matches, Apple (CN) doesn't
    const requiredValue = criterion.parameters?.requiredValue as string | undefined;
    if (requiredValue !== undefined) {
      if (value === requiredValue) {
        return 100; // Exact match
      } else if (isConstraint) {
        return 0; // Hard violation for required/forbidden constraints
      } else {
        return 0; // Preference not met: penalize (vs neutral 50 for unknown)
      }
    }

    const preferredValues = criterion.parameters?.preferredValues as string[] | undefined;
    if (preferredValues) {
      if (preferredValues.includes(value)) {
        return 100; // Exact match to preference
      } else if (isConstraint) {
        // For required constraints with preferredValues, non-matching value must fail
        // Return 0 to trigger the score < 50 violation check
        return 0;
      } else {
        // For preferences, non-matching values are neutral
        return 50;
      }
    }

    // For warranty/duration criteria, longer is better
    if (criterion.id === 'warranty' && isConstraint === false) {
      // Try years first
      const yearMatch = value.match(/(\d+)\s*year/i);
      if (yearMatch) {
        const years = parseInt(yearMatch[1], 10);
        return Math.min(100, 40 + years * 15); // 1yr→50, 3yr→90, 5yr→100
      }
      // Try months (convert to year equivalent)
      const monthMatch = value.match(/(\d+)\s*month/i);
      if (monthMatch) {
        const months = parseInt(monthMatch[1], 10);
        const years = months / 12;
        return Math.min(100, 40 + years * 15); // 12mo→50, 24mo→65, 36mo→80
      }
      // Try days (very short warranty)
      const dayMatch = value.match(/(\d+)\s*day/i);
      if (dayMatch) {
        const days = parseInt(dayMatch[1], 10);
        const years = days / 365;
        return Math.max(10, 40 + years * 15); // Very low score for day-based warranty
      }
      // Unknown duration format: treat as unspecified
      return 50;
    }

    // For service/condition/maintenance criteria: known value > unknown
    if (
      criterion.id === 'serviceHistory' ||
      criterion.id === 'maintenance' ||
      criterion.id === 'condition' ||
      criterion.id === 'authenticity'
    ) {
      if (value.length > 0) {
        return 75; // Known information is better than unknown
      }
    }

    // For relevance/match quality criteria: score quality levels
    if (criterion.id === 'relevance' || criterion.id === 'matchQuality' || criterion.id === 'matchLevel') {
      const quality = value.toLowerCase();
      if (quality.includes('excellent') || quality.includes('perfect')) return 95;
      if (quality.includes('good') || quality.includes('strong')) return 75;
      if (quality.includes('moderate') || quality.includes('fair')) return 55;
      if (quality.includes('poor') || quality.includes('weak')) return 20;
      // Fallback for unknown quality levels
      return 50;
    }

    // For custom criteria without preferredValues: score based on specificity
    // Longer, more specific values suggest better information
    if (value.length > 3) {
      return 65; // Specific value (better than neutral but not preferred)
    }

    return 50; // Neutral/generic value
  }

  // ── Generic numeric criteria ──────────────────────────────────────────────
  // Handles: targetValue, minValue, maxValue parameters on any numeric field.
  // This covers real-world criteria like repairability, battery, weight, etc.
  if (typeof value === 'number') {
    const targetValue = criterion.parameters?.targetValue as number | undefined;
    const minValue = criterion.parameters?.minValue as number | undefined;
    const maxValue = criterion.parameters?.maxValue as number | undefined;

    // targetValue: score = how close is the value to the target?
    // Equal or above → 100. Below → linear decay.
    if (targetValue !== undefined) {
      if (value >= targetValue) return 100;
      // Below target: score proportionally (0 at 0, up to 100 at targetValue)
      const ratio = targetValue > 0 ? value / targetValue : 0;
      return Math.max(0, ratio * 100);
    }

    // minValue: value must be at least minValue to score well
    if (minValue !== undefined) {
      if (value >= minValue) {
        // Meets minimum — bonus for exceeding it (up to 100)
        const bonus = Math.min(10, ((value - minValue) / minValue) * 10);
        return Math.min(100, 85 + bonus);
      }
      // Below minimum: hard failure (score proportional to deficit)
      const ratio = minValue > 0 ? value / minValue : 0;
      return Math.max(0, ratio * 50); // Max 50 if below min
    }

    // maxValue: lower is better (e.g., weight, price for non-budget criteria)
    if (maxValue !== undefined) {
      if (value <= maxValue) {
        // Under max — better the lower the value
        const ratio = maxValue > 0 ? value / maxValue : 0;
        return 100 - ratio * 20; // Max 100, min 80 at the limit
      }
      // Over max: score 0
      return 0;
    }

    // Numeric value but no guidance parameter — neutral
    return 50;
  }

  // Default: neutral score
  return 50;
}

/**
 * Scoring logic for hard constraints depends on whether data is available.
 * For 'required': Unknown data = cannot satisfy constraint (low score).
 * For 'forbidden': Unknown data = possibly dangerous, lower score.
 * For preferences: Unknown = neutral, doesn't help or hurt.
 */
function handleUnknownData(level: PreferenceLevel, unknownPolicy?: 'reject' | 'pass'): number {
  switch (level) {
    case 'required':
      // Can't verify requirement without data.
      // unknownPolicy: 'pass' (opt-in, e.g. category) → neutral: no contradicting
      // evidence, don't score it as a likely failure.
      if (unknownPolicy === 'pass') return 50;
      return 25; // Low score, constraint may be violated
    case 'forbidden':
      // Forbidden criterion with unknown data = risky
      return 40; // Lower score, possibly violates constraint
    case 'very_important':
    case 'important':
    case 'preference':
      // Can't optimize for this, but doesn't harm
      return 50; // Neutral
    case 'low':
    case 'none':
      // Doesn't matter
      return 50;
    default:
      return 50;
  }
}

/**
 * Scoring logic for contradictory data.
 * Multiple sources disagree; we can't resolve it automatically.
 */
function handleContradictoryData(level: PreferenceLevel, conflictingValues?: unknown[]): number {
  // For hard constraints, contradiction is problematic
  if (level === 'required' || level === 'forbidden') {
    return 35; // Lower score due to uncertainty
  }

  // For preferences, contradiction means neutral
  return 50; // Neutral; ambiguous
}

/**
 * Scoring logic for unverifiable data.
 * Information exists but cannot be verified.
 */
function handleUnverifiableData(level: PreferenceLevel): number {
  // Similar to unknown, but slightly more risky
  // because we can't even check it
  return handleUnknownData(level) - 5;
}

/**
 * Scoring logic when criterion data is completely missing from offer.
 */
function handleMissingData(level: PreferenceLevel, unknownPolicy?: 'reject' | 'pass'): number {
  // If it's a hard constraint, missing data is bad by default.
  // unknownPolicy: 'pass' (opt-in, e.g. category) → neutral instead, same
  // rationale as handleUnknownData() above.
  if (level === 'required') {
    return unknownPolicy === 'pass' ? 50 : 30;
  }
  if (level === 'forbidden') {
    // No data → no evidence of the forbidden thing being present → score 0 (not violated)
    // Score 0 means "no violation" because forbidden checks: score > 0 → violation
    return 0;
  }
  // For preferences, missing data is neutral
  return 50;
}

/**
 * Weight to apply to a criterion's score based on its level.
 */
function getLevelWeight(level: PreferenceLevel): number {
  switch (level) {
    case 'forbidden':
      return 10; // Heavy penalty if violated
    case 'required':
      return 8; // Must be satisfied
    case 'very_important':
      return 5;
    case 'important':
      return 3;
    case 'preference':
      return 1.5;
    case 'low':
      return 0.5;
    case 'none':
      return 0;
    default:
      return 1;
  }
}

/**
 * Format a value for display in reasoning.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '(unknown)';
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return JSON.stringify(value);
}

// ============================================================================
// PUBLIC API: Priority Engine
// ============================================================================

/**
 * Rank a set of offers according to effective criteria.
 * This is the main entry point to the Priority Engine.
 *
 * PROPERTIES:
 * - Deterministic: Same input always produces same output
 * - Independent: No AI, no network, no merchant influence
 * - Testable: Can test without external dependencies
 * - Transparent: Full reasoning for every score
 *
 * @param admissibilityByOfferId Optional — the AdmissibilityResult already
 *   computed for each offer (keyed by offer.id), from
 *   AdmissibilityEngine.filter()'s `resultsByOfferId`. CapucineEngine always
 *   passes this, so the real search pipeline has exactly ONE place deciding
 *   "is this offer admissible?" — see scoreOffer() for the fallback behavior
 *   when it's omitted (every other existing caller/test).
 */
export function rankOffers(
  request: RankingRequest,
  admissibilityByOfferId?: Map<string, AdmissibilityResult>,
  /**
   * Purchase readiness per offer, when the caller computed it (CapucineEngine
   * always does). Same contract as `admissibilityByOfferId`: this engine reads
   * a verdict someone else owns, it never recomputes one. Only CONFIRMED facts
   * add points, so omitting this map changes no score.
   */
  readinessByOfferId?: Map<string, OfferReadiness>
): RankingResult {
  const rankedOffers: RankedOffer[] = [];
  const rejectedOffers: RankingResult['rejectedOffers'] = [];

  // Score all offers
  for (const offer of request.offers) {
    const { criterionScores, overallScore, overallScoreExact, satisfiesAllConstraints, violatedConstraints } =
      scoreOffer(offer, request.effectiveCriteria, admissibilityByOfferId?.get(offer.id));

    if (!satisfiesAllConstraints) {
      // Offer violates hard constraints; reject it.
      // NOTE the ordering: this happens BEFORE any contextual bonus is even
      // computed. A usage context cannot rescue an inadmissible offer — there
      // is no branch here in which it could.
      rejectedOffers.push({
        offer,
        reason: violatedConstraints.map((c) => c.reason).join('; '),
      });
    } else {
      // Offer is acceptable. Only now may the usage context (if any) add a
      // bounded, non-negative bonus on top of the criteria score.
      // `bonus >= 0` by construction (see contextual-relevance.ts), so an
      // offer whose contextual attributes are all UNKNOWN scores exactly what
      // it would have scored with no usage context at all.
      const contextualRelevance = request.usageContext
        ? scoreContextualRelevance(offer, request.usageContext, request.effectiveCriteria)
        : undefined;
      // Readiness adds points for CONFIRMED availability facts only — never
      // subtracts for unknown ones, exactly like the contextual bonus.
      const readiness = readinessByOfferId?.get(offer.id);
      const readinessScore = readiness ? scoreReadiness(readiness) : undefined;

      const bonus = (contextualRelevance?.bonus ?? 0) + (readinessScore?.bonus ?? 0);
      const finalScore = bonus > 0
        ? Math.min(100, Math.round(overallScore + bonus))
        : overallScore;
      // The exact counterpart of finalScore, kept unrounded for ordering. The
      // bonus is added at full precision here for the same reason the base
      // score is: rounding before comparing loses real differences.
      const finalScoreExact = bonus > 0
        ? Math.min(100, overallScoreExact + bonus)
        : overallScoreExact;

      rankedOffers.push({
        offer,
        overallScore: finalScore,
        overallScoreExact: finalScoreExact,
        criterionScores,
        summary: generateSummary(offer, criterionScores, finalScore),
        satisfiesAllConstraints: true,
        ...(contextualRelevance ? { contextualRelevance } : {}),
        ...(readiness ? { readiness, readinessBonus: readinessScore!.bonus } : {}),
      });
    }
  }

  // Sort by overall score (descending).
  // INVARIANT: sort must be deterministic regardless of input array order.
  // When scores are equal, use offer.id as a lexicographic tiebreaker so that
  // identical inputs always produce identical output regardless of discovery order.
  rankedOffers.sort((a, b) => {
    // Compare the UNROUNDED scores: rounding first made offers that differ by
    // a fraction of a point compare as equal, handing the order to the id
    // tiebreaker and putting worse offers above better ones.
    const exactDiff = (b.overallScoreExact ?? b.overallScore) - (a.overallScoreExact ?? a.overallScore);
    if (Math.abs(exactDiff) > 1e-9) return exactDiff;
    // Genuinely equal scores: deterministic tiebreaker on offer ID (stable,
    // source-neutral) so identical inputs always produce identical output.
    return a.offer.id < b.offer.id ? -1 : a.offer.id > b.offer.id ? 1 : 0;
  });

  return {
    requestId: request.requestId,
    rankedOffers,
    rejectedOffers: rejectedOffers.length > 0 ? rejectedOffers : undefined,
    generatedAt: new Date(),
  };
}

/**
 * Generate a human-readable summary of why an offer scored this way.
 */
function generateSummary(offer: Offer, scores: CriterionScore[], overallScore: number): string {
  const topCriteria = scores
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => `${c.criterionName} (${c.score}/100)`)
    .join(', ');

  return `${offer.merchant.name}: ${offer.price.value}${offer.currency}. Score: ${overallScore}/100. Strengths: ${topCriteria}`;
}

/**
 * Utility: Merge a permanent profile with temporary search requirements.
 * Returns the effective criteria to use for ranking.
 * Does NOT modify the original profile.
 */
export function mergeProfileAndRequirements(
  profileCriteria: PreferenceCriterion[],
  searchRequirements: PreferenceCriterion[],
  exceptions?: Array<{ criterionId: string; temporaryLevel: PreferenceLevel }>
): PreferenceCriterion[] {
  // Start with search requirements
  const merged = [...searchRequirements];

  // Add profile criteria not already in search
  for (const profileCriterion of profileCriteria) {
    const alreadyInSearch = searchRequirements.some((r) => r.id === profileCriterion.id);
    if (!alreadyInSearch) {
      merged.push(profileCriterion);
    }
  }

  // Apply exceptions (temporary overrides)
  if (exceptions) {
    for (const exception of exceptions) {
      const criterionIndex = merged.findIndex((c) => c.id === exception.criterionId);
      if (criterionIndex >= 0) {
        // Modify the level for this search only
        merged[criterionIndex] = {
          ...merged[criterionIndex],
          level: exception.temporaryLevel,
        };
      }
    }
  }

  return merged;
}

/**
 * Filter offers that violate hard constraints (forbidden, required).
 */
export function filterEligible(
  offers: Offer[],
  effectiveCriteria: PreferenceCriterion[]
): {
  eligible: Offer[];
  rejected: Array<{ offer: Offer; reason: string }>;
} {
  const eligible: Offer[] = [];
  const rejected: Array<{ offer: Offer; reason: string }> = [];

  for (const offer of offers) {
    const { satisfiesAllConstraints, violatedConstraints } = scoreOffer(
      offer,
      effectiveCriteria
    );

    if (satisfiesAllConstraints) {
      eligible.push(offer);
    } else {
      rejected.push({
        offer,
        reason: violatedConstraints.map((c) => c.reason).join('; '),
      });
    }
  }

  return { eligible, rejected };
}
