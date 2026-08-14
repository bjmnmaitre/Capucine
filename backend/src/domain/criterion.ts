/**
 * Capucine — Generic Criterion Model
 *
 * Represents any evaluation criterion without knowing the product category.
 * This abstraction is the cornerstone of Capucine's flexibility.
 *
 * DESIGN PRINCIPLES:
 * - One generic type covers: price, RAM, country, year, color, weight, etc.
 * - No product-category-specific types at this level
 * - All criteria are first-class: user-defined criteria work identically to built-in ones
 * - UNKNOWN/CONFLICTING status preserved at criterion level
 *
 * GATE 3 IMPLEMENTATION
 */

import { PreferenceLevel, DataStatus } from './types';

// ============================================================================
// CRITERION OPERATORS
// ============================================================================

/**
 * Comparison operator for a criterion value.
 *
 * Examples:
 *   RAM >= 16 GB          → operator: 'gte', value: 16, unit: 'GB'
 *   year = 1998           → operator: 'eq', value: 1998
 *   color in [black, navy]→ operator: 'in', values: ['black', 'navy']
 *   origin not France     → operator: 'neq', value: 'France'
 *   price <= 900          → operator: 'lte', value: 900
 *   weight <= 1.5 kg      → operator: 'lte', value: 1.5, unit: 'kg'
 */
export type CriterionOperator =
  | 'eq'        // equal
  | 'neq'       // not equal
  | 'gt'        // greater than
  | 'gte'       // greater than or equal
  | 'lt'        // less than
  | 'lte'       // less than or equal
  | 'in'        // value in set of accepted values
  | 'not_in'    // value not in set (all excluded)
  | 'contains'  // string contains substring
  | 'exists'    // field must be present (not null/unknown)
  | 'boolean'   // value must match true/false
  | 'any';      // any value is acceptable (just present it)

// ============================================================================
// CRITERION VALUE TYPES
// ============================================================================

export type CriterionValueType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'range'
  | 'duration'
  | 'price'
  | 'unknown';

// ============================================================================
// GENERIC CRITERION DEFINITION
// ============================================================================

/**
 * GenericCriterion — the universal criterion representation.
 *
 * Replaces the need for dozens of category-specific criterion types.
 * Works for any product attribute that Capucine evaluates.
 *
 * INVARIANT: A criterion with level='required' that is violated ALWAYS rejects
 * the offer — no secondary score can compensate.
 */
export interface GenericCriterion {
  // ── Identity ──────────────────────────────────────────────────────────────
  id: string;                    // Unique identifier: 'ram', 'price', 'country-origin'
  name: string;                  // Human-readable: 'RAM minimum', 'Prix maximum'
  description?: string;          // Optional explanation

  // ── Importance ────────────────────────────────────────────────────────────
  level: PreferenceLevel;        // required | forbidden | very_important | ...

  // ── Evaluation definition ─────────────────────────────────────────────────
  operator: CriterionOperator;
  valueType: CriterionValueType;

  // The expected / target value(s)
  targetValue?: CriterionValue;  // For eq, neq, gt, gte, lt, lte, boolean
  acceptedValues?: CriterionValue[]; // For 'in' operator
  rejectedValues?: CriterionValue[]; // For 'not_in' operator

  // Optional tolerance (e.g., price ±5%)
  tolerance?: {
    value: number;
    unit: 'absolute' | 'percent';
  };

  // Unit for numeric values (e.g., 'EUR', 'kg', 'GB', 'mm')
  unit?: string;

  // ── Data quality ──────────────────────────────────────────────────────────
  status: CriterionStatus;

  // ── Origin tracing ────────────────────────────────────────────────────────
  origin: CriterionOrigin;

  // ── Scoring hints ─────────────────────────────────────────────────────────
  /**
   * For preference-level criteria: how to score values that partially match.
   * 'linear'  → score scales linearly with distance from target
   * 'step'    → score jumps at thresholds
   * 'binary'  → either matches (100) or doesn't (0)
   */
  scoringMode?: 'linear' | 'step' | 'binary';

  /**
   * For range-type criteria: define scoring curve
   * e.g., price: ideal=500, acceptable_max=900 → 500=100 pts, 900=70 pts, 901+ = 0
   */
  scoringCurve?: {
    ideal?: number;        // Score = 100
    acceptable?: number;   // Score = 70
    minimum?: number;      // Score = 40 (below this = fail for required)
  };
}

// ============================================================================
// CRITERION VALUE
// ============================================================================

/**
 * A typed value for criterion comparison.
 * Deliberately simple — avoids complex type gymnastics.
 */
export type CriterionValue =
  | number
  | string
  | boolean
  | Date
  | { min: number; max: number; unit?: string };  // Range

// ============================================================================
// CRITERION STATUS
// ============================================================================

/**
 * The epistemic status of this criterion in the current context.
 * Separate from PreferenceCriterion.level (which is importance).
 */
export interface CriterionStatus {
  dataAvailable: DataStatus; // KNOWN | UNKNOWN | CONTRADICTORY | ESTIMATED
  confidence: number;        // 0-1: how confident are we in the criterion definition
  ambiguous: boolean;        // Is the criterion definition itself ambiguous?
  ambiguityDescription?: string;
}

// ============================================================================
// CRITERION ORIGIN
// ============================================================================

/**
 * Where did this criterion come from?
 * Critical for override resolution and profile traceability.
 */
export type CriterionOrigin =
  | 'explicit_user'       // User stated it explicitly in this request
  | 'profile_permanent'   // From permanent user profile
  | 'profile_exception'   // Explicit temporary override to profile
  | 'ai_inferred'         // AI deduced it from context
  | 'ai_suggested'        // AI suggested it (pending user validation)
  | 'system_default';     // System-level default

// ============================================================================
// CRITERION EVALUATION RESULT
// ============================================================================

/**
 * Result of evaluating a single criterion against an offer's data.
 */
export interface CriterionEvaluation {
  criterion: GenericCriterion;

  // Raw value found in the offer (before scoring)
  foundValue: {
    value: CriterionValue | null;
    status: DataStatus;
    source?: string;
  };

  // Scoring result
  score: number;               // 0–100
  passes: boolean;             // For required/forbidden: does it pass?
  reasoning: string;           // Human-readable explanation

  // For debugging
  operatorApplied: CriterionOperator;
  comparisonResult?: 'match' | 'no_match' | 'partial' | 'unknown' | 'not_applicable';
}

// ============================================================================
// CRITERION EVALUATION ENGINE
// ============================================================================

/**
 * Evaluates a GenericCriterion against an offer value.
 *
 * DETERMINISTIC: Same inputs always produce same output.
 * NO SIDE EFFECTS.
 */
export class CriterionEvaluator {

  /**
   * Evaluate one criterion against a value.
   */
  evaluate(
    criterion: GenericCriterion,
    foundValue: CriterionValue | null,
    foundStatus: DataStatus
  ): CriterionEvaluation {

    // Handle unknown/missing data
    if (foundStatus === 'unknown' || foundValue === null) {
      return this.evaluateUnknown(criterion, foundStatus);
    }

    if (foundStatus === 'contradictory') {
      return this.evaluateContradictory(criterion);
    }

    // Evaluate based on operator
    return this.applyOperator(criterion, foundValue, foundStatus);
  }

  // ── Operator application ──────────────────────────────────────────────────

  private applyOperator(
    criterion: GenericCriterion,
    value: CriterionValue,
    status: DataStatus
  ): CriterionEvaluation {

    const { operator, targetValue, acceptedValues, rejectedValues, level } = criterion;
    const isConstraint = level === 'required' || level === 'forbidden';

    switch (operator) {
      case 'eq':
        return this.evalEqual(criterion, value, status);
      case 'neq':
        return this.evalNotEqual(criterion, value, status);
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return this.evalNumericComparison(criterion, value, status);
      case 'in':
        return this.evalIn(criterion, value, status);
      case 'not_in':
        return this.evalNotIn(criterion, value, status);
      case 'boolean':
        return this.evalBoolean(criterion, value, status);
      case 'contains':
        return this.evalContains(criterion, value, status);
      case 'exists':
        return this.evalExists(criterion, value, status);
      case 'any':
        return this.evalAny(criterion, value, status);
      default:
        return this.makeResult(criterion, value, status, 50, `Operator '${operator}' not handled`, 'unknown');
    }
  }

  private evalEqual(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const matches = this.valuesEqual(value, c.targetValue);
    // Check tolerance for numeric
    const withinTolerance = !matches && typeof value === 'number' && typeof c.targetValue === 'number'
      ? this.withinTolerance(value, c.targetValue as number, c.tolerance)
      : false;

    const pass = matches || withinTolerance;
    const score = pass ? 100 : (c.level === 'required' || c.level === 'forbidden' ? 0 : 20);
    const reason = pass
      ? `${c.name}: ${value} matches target ${c.targetValue}`
      : `${c.name}: ${value} ≠ ${c.targetValue}`;
    return this.makeResult(c, value, status, score, reason, pass ? 'match' : 'no_match');
  }

  private evalNotEqual(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const isEqual = this.valuesEqual(value, c.targetValue);
    const pass = !isEqual;
    const score = pass ? 100 : 0;
    const reason = pass
      ? `${c.name}: ${value} correctly differs from ${c.targetValue}`
      : `${c.name}: ${value} equals forbidden value ${c.targetValue}`;
    return this.makeResult(c, value, status, score, reason, pass ? 'match' : 'no_match');
  }

  private evalNumericComparison(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    if (typeof value !== 'number' || typeof c.targetValue !== 'number') {
      return this.makeResult(c, value, status, 50, `${c.name}: cannot compare non-numeric values`, 'not_applicable');
    }

    const { operator, scoringCurve } = c;
    const target = c.targetValue as number;
    let passes = false;

    switch (operator) {
      case 'gt':  passes = value > target; break;
      case 'gte': passes = value >= target; break;
      case 'lt':  passes = value < target; break;
      case 'lte': passes = value <= target; break;
    }

    // If it fails a constraint, score = 0
    if (!passes && (c.level === 'required' || c.level === 'forbidden')) {
      return this.makeResult(c, value, status, 0, `${c.name}: ${value}${c.unit || ''} fails constraint (${operator} ${target}${c.unit || ''})`, 'no_match');
    }

    // Score based on how well it matches
    let score: number;
    if (!passes) {
      score = 20; // Fails preference but not constraint
    } else if (scoringCurve && typeof scoringCurve.ideal === 'number') {
      // Use scoring curve for fine-grained preference scoring
      score = this.curveScore(value, target, operator, scoringCurve);
    } else {
      // Linear gradient for preference criteria (lte = cheaper is better; gte = more is better)
      if (operator === 'lte' || operator === 'lt') {
        const ratio = value / target;
        score = Math.round(100 - ratio * 20); // At target → 80pts; far below → 100pts
      } else {
        const ratio = target / value;
        score = Math.round(100 - ratio * 20);
      }
      score = Math.max(0, Math.min(100, score));
    }

    const direction = operator === 'lte' || operator === 'lt' ? '≤' : '≥';
    const reason = `${c.name}: ${value}${c.unit || ''} ${passes ? 'satisfies' : 'exceeds'} ${direction} ${target}${c.unit || ''}`;
    return this.makeResult(c, value, status, score, reason, passes ? 'match' : 'no_match');
  }

  private evalIn(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const accepted = c.acceptedValues || [];
    const found = accepted.some(a => this.valuesEqual(value, a));
    const score = found ? 100 : (c.level === 'required' ? 0 : 20);
    const reason = found
      ? `${c.name}: "${value}" is in accepted set`
      : `${c.name}: "${value}" is not in accepted set [${accepted.join(', ')}]`;
    return this.makeResult(c, value, status, score, reason, found ? 'match' : 'no_match');
  }

  private evalNotIn(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const rejected = c.rejectedValues || [];
    const isRejected = rejected.some(r => this.valuesEqual(value, r));
    const score = isRejected ? 0 : 100;
    const reason = isRejected
      ? `${c.name}: "${value}" is in forbidden set`
      : `${c.name}: "${value}" is not in forbidden set`;
    return this.makeResult(c, value, status, score, reason, isRejected ? 'no_match' : 'match');
  }

  private evalBoolean(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const expected = c.targetValue as boolean;
    const actual = value as boolean;
    const matches = actual === expected;
    const score = matches ? 100 : 0;
    const reason = matches
      ? `${c.name}: ${actual} matches expected ${expected}`
      : `${c.name}: ${actual} does not match expected ${expected}`;
    return this.makeResult(c, value, status, score, reason, matches ? 'match' : 'no_match');
  }

  private evalContains(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const str = String(value).toLowerCase();
    const target = String(c.targetValue || '').toLowerCase();
    const found = str.includes(target);
    const score = found ? 100 : (c.level === 'required' ? 0 : 30);
    const reason = found
      ? `${c.name}: contains "${c.targetValue}"`
      : `${c.name}: does not contain "${c.targetValue}"`;
    return this.makeResult(c, value, status, score, reason, found ? 'match' : 'no_match');
  }

  private evalExists(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    const exists = value !== null && status !== 'unknown';
    const score = exists ? 100 : 0;
    const reason = exists
      ? `${c.name}: data is present`
      : `${c.name}: data is absent or unknown`;
    return this.makeResult(c, value, status, score, reason, exists ? 'match' : 'no_match');
  }

  private evalAny(c: GenericCriterion, value: CriterionValue, status: DataStatus): CriterionEvaluation {
    return this.makeResult(c, value, status, 100, `${c.name}: any value accepted`, 'match');
  }

  // ── Unknown/Contradictory handling ───────────────────────────────────────

  private evaluateUnknown(c: GenericCriterion, status: DataStatus): CriterionEvaluation {
    // INVARIANT: UNKNOWN ≠ NEGATIVE
    let score: number;
    let reason: string;

    switch (c.level) {
      case 'required':
        score = 25; // Cannot verify — low score but not zero (zero = explicit failure)
        reason = `${c.name}: data unknown — cannot verify required criterion`;
        break;
      case 'forbidden':
        score = 40; // Unknown if violated
        reason = `${c.name}: data unknown — cannot verify forbidden criterion`;
        break;
      default:
        score = 50; // Neutral for preferences
        reason = `${c.name}: data unknown — treated as neutral`;
    }

    return {
      criterion: c,
      foundValue: { value: null, status, source: undefined },
      score,
      passes: c.level !== 'required', // Required fails if unknown; forbidden is risky
      reasoning: reason,
      operatorApplied: c.operator,
      comparisonResult: 'unknown',
    };
  }

  private evaluateContradictory(c: GenericCriterion): CriterionEvaluation {
    const score = (c.level === 'required' || c.level === 'forbidden') ? 35 : 50;
    return {
      criterion: c,
      foundValue: { value: null, status: 'contradictory' },
      score,
      passes: c.level !== 'required',
      reasoning: `${c.name}: contradictory data from multiple sources — preserved as conflict`,
      operatorApplied: c.operator,
      comparisonResult: 'unknown',
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private valuesEqual(a: CriterionValue | undefined, b: CriterionValue | undefined): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    // Case-insensitive string comparison
    if (typeof a === 'string' && typeof b === 'string') {
      return a.toLowerCase() === b.toLowerCase();
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private withinTolerance(value: number, target: number, tolerance?: GenericCriterion['tolerance']): boolean {
    if (!tolerance) return false;
    const diff = Math.abs(value - target);
    if (tolerance.unit === 'percent') {
      return diff / target * 100 <= tolerance.value;
    }
    return diff <= tolerance.value;
  }

  private curveScore(
    value: number,
    target: number,
    operator: CriterionOperator,
    curve: NonNullable<GenericCriterion['scoringCurve']>
  ): number {
    if (curve.ideal !== undefined && value === curve.ideal) return 100;
    if (curve.acceptable !== undefined && value <= curve.acceptable) return 70;
    if (curve.minimum !== undefined && value <= curve.minimum) return 40;
    const ratio = value / target;
    return Math.max(0, Math.round(100 - ratio * 20));
  }

  private makeResult(
    criterion: GenericCriterion,
    foundValue: CriterionValue | null,
    status: DataStatus,
    score: number,
    reasoning: string,
    comparisonResult: CriterionEvaluation['comparisonResult']
  ): CriterionEvaluation {
    return {
      criterion,
      foundValue: { value: foundValue, status, source: undefined },
      score: Math.max(0, Math.min(100, score)),
      passes: score > 0 || (criterion.level !== 'required' && criterion.level !== 'forbidden'),
      reasoning,
      operatorApplied: criterion.operator,
      comparisonResult,
    };
  }
}

// ============================================================================
// CRITERION FACTORY HELPERS
// ============================================================================

/**
 * Factory functions for common criterion patterns.
 * Reduces boilerplate when constructing criteria.
 */
export const CriterionFactory = {

  price(maxBudget: number, currency: string = 'EUR', level: PreferenceLevel = 'required'): GenericCriterion {
    return {
      id: 'price',
      name: `Prix maximum ${maxBudget} ${currency}`,
      level,
      operator: 'lte',
      valueType: 'price',
      targetValue: maxBudget,
      unit: currency,
      status: { dataAvailable: 'known', confidence: 1, ambiguous: false },
      origin: 'explicit_user',
    };
  },

  minSpec(id: string, name: string, minValue: number, unit: string, level: PreferenceLevel = 'required'): GenericCriterion {
    return {
      id,
      name: `${name} ≥ ${minValue} ${unit}`,
      level,
      operator: 'gte',
      valueType: 'number',
      targetValue: minValue,
      unit,
      status: { dataAvailable: 'known', confidence: 1, ambiguous: false },
      origin: 'explicit_user',
    };
  },

  exact(id: string, name: string, value: CriterionValue, level: PreferenceLevel = 'required'): GenericCriterion {
    return {
      id,
      name: `${name} = ${value}`,
      level,
      operator: 'eq',
      valueType: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
      targetValue: value,
      status: { dataAvailable: 'known', confidence: 1, ambiguous: false },
      origin: 'explicit_user',
    };
  },

  oneOf(id: string, name: string, accepted: CriterionValue[], level: PreferenceLevel = 'important'): GenericCriterion {
    return {
      id,
      name: `${name} in [${accepted.join(', ')}]`,
      level,
      operator: 'in',
      valueType: 'enum',
      acceptedValues: accepted,
      status: { dataAvailable: 'known', confidence: 1, ambiguous: false },
      origin: 'explicit_user',
    };
  },

  noneOf(id: string, name: string, rejected: CriterionValue[], level: PreferenceLevel = 'forbidden'): GenericCriterion {
    return {
      id,
      name: `${name} not in [${rejected.join(', ')}]`,
      level,
      operator: 'not_in',
      valueType: 'enum',
      rejectedValues: rejected,
      status: { dataAvailable: 'known', confidence: 1, ambiguous: false },
      origin: 'explicit_user',
    };
  },

  mustExist(id: string, name: string, level: PreferenceLevel = 'required'): GenericCriterion {
    return {
      id,
      name: `${name} must be present`,
      level,
      operator: 'exists',
      valueType: 'unknown',
      status: { dataAvailable: 'known', confidence: 1, ambiguous: false },
      origin: 'explicit_user',
    };
  },
};
