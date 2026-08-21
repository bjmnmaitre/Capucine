/**
 * Capucine — Admissibility Engine
 *
 * Strict separation of concerns:
 *   ADMISSIBILITY: Does this offer even qualify? (hard gate)
 *   RANKING: Among qualifying offers, which is best? (soft scoring)
 *
 * INVARIANT: No secondary score can compensate for a violated hard constraint.
 * An offer that exceeds the mandatory budget is ALWAYS rejected, regardless of
 * how excellent its quality score is.
 *
 * Architecture:
 *   Candidates → AdmissibilityEngine → EligibleOffers + RejectedOffers → PriorityEngine
 *
 * GATE 2 / GATE 5 IMPLEMENTATION (separating admissibility from ranking)
 */

import { Offer, PreferenceCriterion, DataStatus } from './types';
import { CriterionEvaluator, GenericCriterion } from './criterion';

// ============================================================================
// ADMISSIBILITY RESULT
// ============================================================================

/**
 * Result of checking a single offer's admissibility.
 */
export interface AdmissibilityResult {
  offer: Offer;
  eligible: boolean;

  // Why was it rejected (if eligible = false)?
  violations: ConstraintViolation[];

  // Why was it accepted (for audit trail)?
  satisfiedConstraints: string[];

  // Warnings (eligible but with caveats)
  warnings: AdmissibilityWarning[];
}

export interface ConstraintViolation {
  criterionId: string;
  criterionName: string;
  level: 'required' | 'forbidden';
  violation: string;                // Human-readable explanation
  foundValue: unknown;
  expectedCondition: string;
}

export interface AdmissibilityWarning {
  criterionId: string;
  message: string;
  severity: 'low' | 'medium';
}

/**
 * Batch admissibility result for a set of candidates.
 */
export interface AdmissibilityBatch {
  eligibleOffers: Offer[];
  rejectedOffers: RejectedOffer[];
  total: number;
  eligibleCount: number;
  rejectedCount: number;
  processingTimeMs?: number;

  /**
   * Full per-offer admissibility verdict (eligible + rejected alike), keyed by
   * offer.id — the same AdmissibilityResult already computed by checkOffer()
   * for this batch, exposed rather than discarded.
   *
   * Lets downstream consumers (PriorityEngine.rankOffers, via CapucineEngine)
   * reuse THIS engine's verdict as the sole source of truth for "is this offer
   * admissible?" instead of re-deriving it independently — see priority-engine.ts.
   */
  resultsByOfferId: Map<string, AdmissibilityResult>;
}

export interface RejectedOffer {
  offer: Offer;
  violations: ConstraintViolation[];
  primaryViolation: string; // The most important reason for rejection
}

// ============================================================================
// ADMISSIBILITY ENGINE
// ============================================================================

/**
 * Determines which offers are admissible (eligible for ranking).
 *
 * Handles:
 * - required constraints: offer MUST satisfy
 * - forbidden constraints: offer MUST NOT violate
 * - Unknown data handling: UNKNOWN does not automatically fail
 *
 * DOES NOT RANK. Does not produce preference scores.
 * Simply answers: "Can this offer be considered at all?"
 */
export class AdmissibilityEngine {

  /**
   * Filter a set of candidates into eligible and rejected offers.
   */
  filter(candidates: Offer[], constraints: PreferenceCriterion[]): AdmissibilityBatch {
    const start = Date.now();

    // Extract only hard constraints (required + forbidden)
    const hardConstraints = constraints.filter(
      c => c.level === 'required' || c.level === 'forbidden'
    );

    // If no hard constraints, everything is eligible
    if (hardConstraints.length === 0) {
      const resultsByOfferId = new Map<string, AdmissibilityResult>();
      for (const offer of candidates) {
        resultsByOfferId.set(offer.id, { offer, eligible: true, violations: [], satisfiedConstraints: [], warnings: [] });
      }
      return {
        eligibleOffers: [...candidates],
        rejectedOffers: [],
        total: candidates.length,
        eligibleCount: candidates.length,
        rejectedCount: 0,
        processingTimeMs: Date.now() - start,
        resultsByOfferId,
      };
    }

    const eligibleOffers: Offer[] = [];
    const rejectedOffers: RejectedOffer[] = [];
    const resultsByOfferId = new Map<string, AdmissibilityResult>();

    for (const offer of candidates) {
      const result = this.checkOffer(offer, hardConstraints);
      resultsByOfferId.set(offer.id, result);

      if (result.eligible) {
        eligibleOffers.push(offer);
      } else {
        rejectedOffers.push({
          offer,
          violations: result.violations,
          primaryViolation: result.violations[0]?.violation || 'Unknown violation',
        });
      }
    }

    return {
      eligibleOffers,
      rejectedOffers,
      total: candidates.length,
      eligibleCount: eligibleOffers.length,
      rejectedCount: rejectedOffers.length,
      processingTimeMs: Date.now() - start,
      resultsByOfferId,
    };
  }

  /**
   * Check a single offer's admissibility against hard constraints.
   */
  checkOffer(offer: Offer, constraints: PreferenceCriterion[]): AdmissibilityResult {
    const violations: ConstraintViolation[] = [];
    const satisfiedConstraints: string[] = [];
    const warnings: AdmissibilityWarning[] = [];

    for (const constraint of constraints) {
      if (constraint.level !== 'required' && constraint.level !== 'forbidden') continue;

      const checkResult = this.checkConstraint(offer, constraint);

      if (checkResult.violated) {
        violations.push({
          criterionId: constraint.id,
          criterionName: constraint.name,
          level: constraint.level as 'required' | 'forbidden',
          violation: checkResult.reason,
          foundValue: checkResult.foundValue,
          expectedCondition: checkResult.expectedCondition,
        });
      } else if (checkResult.warning) {
        warnings.push({
          criterionId: constraint.id,
          message: checkResult.warning,
          severity: 'medium',
        });
        satisfiedConstraints.push(constraint.name);
      } else {
        satisfiedConstraints.push(constraint.name);
      }
    }

    return {
      offer,
      eligible: violations.length === 0,
      violations,
      satisfiedConstraints,
      warnings,
    };
  }

  // ── Internal constraint checking ─────────────────────────────────────────

  private checkConstraint(
    offer: Offer,
    constraint: PreferenceCriterion
  ): { violated: boolean; reason: string; foundValue?: unknown; expectedCondition: string; warning?: string } {

    const id = constraint.id;
    const level = constraint.level;

    // Retrieve the relevant data point
    const dataPoint = this.extractDataPoint(offer, id, constraint);

    if (!dataPoint) {
      return this.resolveUnknownData(
        constraint,
        level,
        `Required criterion '${constraint.name}' has no data in this offer`,
        `Data must be present and satisfying`,
        `Forbidden criterion '${constraint.name}' has no data — cannot verify`,
        `Must not violate '${constraint.name}'`
      );
    }

    const { value, status } = dataPoint;

    // Unknown data
    if (status === 'unknown' || value === null) {
      return this.resolveUnknownData(
        constraint,
        level,
        `Required criterion '${constraint.name}' is unknown — cannot confirm satisfaction`,
        'Data must be known and satisfying',
        `Forbidden criterion '${constraint.name}' is unknown — possible risk`,
        ''
      );
    }

    // Check price constraint
    if (id === 'price' || id === 'budget') {
      return this.checkPriceConstraint(constraint, value as number, status);
    }

    // Check boolean constraints
    if (typeof value === 'boolean') {
      return this.checkBooleanConstraint(constraint, value, status);
    }

    // Generic numeric characteristic constraint (screen_size, ram, storage, ...).
    // Reuses the same offer.characteristics[id] lookup as every other criterion —
    // any criterion carrying minValue/maxValue/exactValue in its parameters is
    // checked numerically, whatever its id. Values may already be numbers
    // (e.g. screen_size, normalized to inches by NormalizationEngine) or unit-suffixed
    // strings (e.g. ram/storage normalized to "16GB") — parseNumericCharacteristic
    // extracts the leading number either way.
    const minValue = constraint.parameters?.minValue as number | undefined;
    const maxValue = constraint.parameters?.maxValue as number | undefined;
    const exactValue = constraint.parameters?.exactValue as number | undefined;

    if (minValue !== undefined || maxValue !== undefined || exactValue !== undefined) {
      return this.checkNumericConstraint(constraint, value, level, minValue, maxValue, exactValue);
    }

    // Check preferredValues string constraint
    const preferredValues = constraint.parameters?.preferredValues as string[] | undefined;
    const maxBudget = constraint.parameters?.maxBudget as number | undefined;

    if (maxBudget !== undefined && typeof value === 'number') {
      return this.checkPriceConstraint(constraint, value, status);
    }

    if (preferredValues && typeof value === 'string') {
      return this.checkPreferredValues(constraint, value, preferredValues, level);
    }

    // For required: if no specific check, treat as satisfied if data exists
    if (level === 'required') {
      if (value !== null && value !== false && value !== 0 && value !== '') {
        return {
          violated: false,
          reason: '',
          foundValue: value,
          expectedCondition: `${constraint.name} must be present`,
        };
      }
      return {
        violated: true,
        reason: `Required criterion '${constraint.name}' has falsy value: ${JSON.stringify(value)}`,
        foundValue: value,
        expectedCondition: `${constraint.name} must have a positive value`,
      };
    }

    // forbidden: if data is truthy, it's a violation
    if (level === 'forbidden') {
      if (value === true || (typeof value === 'string' && value.length > 0 && value !== 'false')) {
        return {
          violated: true,
          reason: `Forbidden criterion '${constraint.name}' is present: ${JSON.stringify(value)}`,
          foundValue: value,
          expectedCondition: `${constraint.name} must not be present or truthy`,
        };
      }
    }

    return {
      violated: false,
      reason: '',
      foundValue: value,
      expectedCondition: '',
    };
  }

  /**
   * Resolve a constraint check when the relevant data point is absent or unknown.
   *
   * Makes the SATISFIED / VIOLATED / UNKNOWN distinction explicit and generic
   * (works for any criterion id — no per-id special-casing here):
   *
   * - required, default policy (unchanged from before — budget, ram,
   *   screen_size, storage, boolean flags, ...): UNKNOWN still blocks. For a
   *   verifiable spec value, "we don't know" cannot be told apart from "it
   *   fails" without inventing data, so the offer is rejected.
   * - required, `parameters.unknownPolicy === 'pass'` (opt-in — e.g. category,
   *   a best-effort classification hint rather than a strictly verifiable
   *   spec value): UNKNOWN passes through as eligible, flagged with a
   *   warning — never silently reported as VIOLATED, never silently
   *   upgraded to SATISFIED either.
   * - forbidden + unknown, any criterion: never blocks (can't prove the
   *   forbidden thing is present), always flagged with a warning.
   *
   * Both outcomes below share the same (violated: false, warning: ...) shape
   * already used elsewhere in this engine for "can't verify" — UNKNOWN is not
   * a new concept, just applied consistently to the required side too.
   */
  private resolveUnknownData(
    constraint: PreferenceCriterion,
    level: PreferenceCriterion['level'],
    requiredRejectReason: string,
    requiredExpectedCondition: string,
    forbiddenWarning: string,
    forbiddenExpectedCondition: string
  ): ReturnType<AdmissibilityEngine['checkConstraint']> {
    if (level === 'required') {
      const unknownPolicy = (constraint.parameters?.unknownPolicy as 'reject' | 'pass' | undefined) ?? 'reject';
      if (unknownPolicy === 'pass') {
        return {
          violated: false,
          reason: '',
          foundValue: null,
          expectedCondition: requiredExpectedCondition,
          warning: `Required criterion '${constraint.name}' is UNKNOWN (unknownPolicy: 'pass') — not rejected absent contradicting evidence`,
        };
      }
      return {
        violated: true,
        reason: requiredRejectReason,
        foundValue: null,
        expectedCondition: requiredExpectedCondition,
      };
    }

    // forbidden + unknown → not a violation (could be OK either way)
    return {
      violated: false,
      reason: '',
      foundValue: null,
      expectedCondition: forbiddenExpectedCondition,
      warning: forbiddenWarning,
    };
  }

  /**
   * Generic min/max/exact(±tolerance) numeric check against a characteristic value.
   * Used for screen_size, ram, storage, and any future numeric technical constraint —
   * shares the exact same eligible/rejected/warning contract as every other
   * constraint check (required → violated, forbidden → warning-only if unparseable).
   */
  private checkNumericConstraint(
    constraint: PreferenceCriterion,
    value: unknown,
    level: PreferenceCriterion['level'],
    minValue: number | undefined,
    maxValue: number | undefined,
    exactValue: number | undefined
  ): ReturnType<AdmissibilityEngine['checkConstraint']> {
    const expectedCondition = this.describeNumericExpectation(constraint, minValue, maxValue, exactValue);
    const numericValue = this.parseNumericCharacteristic(value);

    if (numericValue === null) {
      // Present but not parseable as a number — cannot verify numerically.
      if (level === 'required') {
        return {
          violated: true,
          reason: `Required criterion '${constraint.name}' has a non-numeric value: ${JSON.stringify(value)}`,
          foundValue: value,
          expectedCondition,
        };
      }
      return { violated: false, reason: '', foundValue: value, expectedCondition };
    }

    const tolerance = (constraint.parameters?.tolerance as number | undefined) ?? 0;
    const satisfies =
      (minValue === undefined || numericValue >= minValue) &&
      (maxValue === undefined || numericValue <= maxValue) &&
      (exactValue === undefined || Math.abs(numericValue - exactValue) <= tolerance);

    if (level === 'required' && !satisfies) {
      return {
        violated: true,
        reason: `Required criterion '${constraint.name}': found ${numericValue}, expected ${expectedCondition}`,
        foundValue: numericValue,
        expectedCondition,
      };
    }

    if (level === 'forbidden' && satisfies) {
      return {
        violated: true,
        reason: `Forbidden criterion '${constraint.name}': found ${numericValue}, which matches the forbidden condition (${expectedCondition})`,
        foundValue: numericValue,
        expectedCondition,
      };
    }

    return { violated: false, reason: '', foundValue: numericValue, expectedCondition };
  }

  /** Extract a leading number from a raw or unit-suffixed characteristic value ("16GB" → 16). */
  private parseNumericCharacteristic(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const match = value.match(/-?\d+(?:[.,]\d+)?/);
      if (match) return parseFloat(match[0].replace(',', '.'));
    }
    return null;
  }

  private describeNumericExpectation(
    constraint: PreferenceCriterion,
    minValue: number | undefined,
    maxValue: number | undefined,
    exactValue: number | undefined
  ): string {
    const unit = (constraint.parameters?.unit as string | undefined) ?? '';
    if (exactValue !== undefined) {
      const tolerance = (constraint.parameters?.tolerance as number | undefined) ?? 0;
      return `${constraint.name} ≈ ${exactValue}${unit} (±${tolerance})`;
    }
    if (minValue !== undefined && maxValue !== undefined) {
      return `${minValue}${unit} ≤ ${constraint.name} ≤ ${maxValue}${unit}`;
    }
    if (minValue !== undefined) return `${constraint.name} ≥ ${minValue}${unit}`;
    if (maxValue !== undefined) return `${constraint.name} ≤ ${maxValue}${unit}`;
    return constraint.name;
  }

  private checkPriceConstraint(
    constraint: PreferenceCriterion,
    price: number,
    status: DataStatus
  ): ReturnType<AdmissibilityEngine['checkConstraint']> {
    const maxBudget = (constraint.parameters?.maxBudget as number) ?? Infinity;

    if (price > maxBudget) {
      return {
        violated: true,
        reason: `Price ${price} exceeds maximum budget ${maxBudget}`,
        foundValue: price,
        expectedCondition: `Price ≤ ${maxBudget}`,
      };
    }

    return {
      violated: false,
      reason: '',
      foundValue: price,
      expectedCondition: `Price ≤ ${maxBudget}`,
    };
  }

  private checkBooleanConstraint(
    constraint: PreferenceCriterion,
    value: boolean,
    status: DataStatus
  ): ReturnType<AdmissibilityEngine['checkConstraint']> {
    const level = constraint.level;
    const desiredValue = constraint.parameters?.desiredValue as boolean | undefined;

    if (desiredValue !== undefined) {
      const passes = value === desiredValue;
      return {
        violated: !passes,
        reason: passes ? '' : `${constraint.name}: expected ${desiredValue}, found ${value}`,
        foundValue: value,
        expectedCondition: `${constraint.name} = ${desiredValue}`,
      };
    }

    // "Avoid X" / "forbidden" semantics: true = present = violation
    if (level === 'forbidden') {
      const violated = value === true;
      return {
        violated,
        reason: violated ? `Forbidden: ${constraint.name} is present (true)` : '',
        foundValue: value,
        expectedCondition: `${constraint.name} must be false or absent`,
      };
    }

    // "required" semantics: true = satisfied
    const violated = value !== true;
    return {
      violated: level === 'required' ? violated : false,
      reason: violated && level === 'required' ? `Required: ${constraint.name} must be true` : '',
      foundValue: value,
      expectedCondition: `${constraint.name} must be true`,
    };
  }

  private checkPreferredValues(
    constraint: PreferenceCriterion,
    value: string,
    preferredValues: string[],
    level: string
  ): ReturnType<AdmissibilityEngine['checkConstraint']> {
    const matches = preferredValues.some(
      v => v.toLowerCase() === value.toLowerCase()
    );

    if (level === 'required' && !matches) {
      return {
        violated: true,
        reason: `Required: ${constraint.name} "${value}" not in accepted values [${preferredValues.join(', ')}]`,
        foundValue: value,
        expectedCondition: `${constraint.name} ∈ [${preferredValues.join(', ')}]`,
      };
    }

    if (level === 'forbidden' && matches) {
      return {
        violated: true,
        reason: `Forbidden: ${constraint.name} "${value}" is in rejected values`,
        foundValue: value,
        expectedCondition: `${constraint.name} ∉ [${preferredValues.join(', ')}]`,
      };
    }

    return {
      violated: false,
      reason: '',
      foundValue: value,
      expectedCondition: '',
    };
  }

  private extractDataPoint(offer: Offer, id: string, constraint?: PreferenceCriterion): { value: unknown; status: DataStatus } | null {
    // Direct offer fields
    if (id === 'price' || id === 'budget') {
      if (offer.price) {
        return { value: offer.price.value, status: offer.price.status };
      }
    }

    if (id === 'shipping' || id === 'shippingCost') {
      if (offer.shippingCost) {
        return { value: offer.shippingCost.value, status: offer.shippingCost.status };
      }
    }

    // Merchant ID check: criterion has merchantId parameter
    // Used to forbid or require offers from a specific merchant
    const merchantId = constraint?.parameters?.merchantId as string | undefined;
    if (merchantId) {
      const matches = offer.merchant.id === merchantId;
      return { value: matches, status: 'known' };
    }

    // Criterion ID starts with 'merchant-': treat the suffix as the merchant ID
    if (id.startsWith('merchant-')) {
      const extractedMerchantId = id.slice('merchant-'.length);
      const matches = offer.merchant.id === extractedMerchantId;
      return { value: matches, status: 'known' };
    }

    // Characteristics
    const char = offer.characteristics[id];
    if (char !== undefined) {
      return { value: char.value, status: char.status };
    }

    return null;
  }
}
