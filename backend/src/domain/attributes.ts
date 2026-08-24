/**
 * Capucine — Attribute model
 *
 * The layer between "what the user typed" and "a PreferenceCriterion the
 * admissibility engine can check".
 *
 * WHY THIS EXISTS
 * ───────────────
 * Before this module, everything the interpreter found was one of two things:
 * a criterion (checkable, but with no record of HOW sure we were or WHERE it
 * came from), or a free search term (rich in information, but invisible to
 * every layer after discovery). "Sony WH-1000XM5" fell in the second bucket:
 * the pipeline searched for it and then had no idea it had been asked for.
 *
 * An ExtractedAttribute keeps both halves together: the interpreted VALUE and
 * the epistemic METADATA — where it came from, how confident we are, and, the
 * decisive one, how strongly the user meant it:
 *
 *   'hard'    the user stated it; it may filter offers (admissibility)
 *   'soft'    the user leaned that way; it may only influence ranking
 *   'context' Capucine inferred it; it may only influence relevance
 *
 * Only 'hard' attributes ever become required criteria, and only when their
 * confidence clears an explicit threshold. Nothing here can promote itself.
 */

import { PreferenceCriterion, PreferenceLevel } from './types';

// ============================================================================
// KINDS
// ============================================================================

export type AttributeKind =
  | 'brand'
  | 'model'
  | 'color'
  | 'condition'
  | 'compatibility'
  | 'connectivity'
  | 'material'
  | 'quantity'
  | 'weight'
  | 'dimension'
  | 'capacity'
  | 'battery_life'
  | 'price'
  | 'destination'
  | 'delivery_deadline';

/**
 * How strongly the user meant it.
 *
 * The whole point of the three-way split (spec §3 of the usage-context
 * chantier, §7 of this one): a stated brand is not the same kind of fact as
 * an inferred relevance signal, and the pipeline must never blur them.
 */
export type ConstraintClass = 'hard' | 'soft' | 'context';

/** Comparison operators for quantitative constraints. */
export type QuantityOperator = 'lte' | 'gte' | 'eq' | 'between';

/**
 * Canonical units. Every quantity is normalised to exactly one of these so
 * two values can be compared without re-parsing their original spelling.
 */
export type CanonicalUnit =
  | 'g'      // mass
  | 'mm'     // length
  | 'ml'     // volume
  | 'h'      // duration
  | 'GB'     // digital capacity
  | 'EUR'    // money
  | 'unit';  // countable items

export interface QuantitativeValue {
  operator: QuantityOperator;
  /** Value as the user expressed it, in `unit`. */
  value: number;
  /** Upper bound — only for operator 'between'. */
  maxValue?: number;
  /** The unit the user used, verbatim ("kg", "€", "h"). */
  rawUnit: string;
  /** Canonical unit `normalized` / `normalizedMax` are expressed in. */
  unit: CanonicalUnit;
  normalized: number;
  normalizedMax?: number;
}

export interface AttributeProvenance {
  /** 'user_explicit' — the user wrote it. 'inferred' — Capucine derived it. */
  origin: 'user_explicit' | 'inferred';
  /** The exact substring it was read from. The evidence, kept verbatim. */
  matchedText: string;
  /** 0-1. Below CRITERION_CONFIDENCE_THRESHOLD an attribute never becomes a hard criterion. */
  confidence: number;
}

export interface ExtractedAttribute {
  kind: AttributeKind;
  /** Criterion id this maps to — the key AdmissibilityEngine looks up in offer.characteristics. */
  criterionId: string;
  /** Human-readable name, used in explanations. */
  label: string;
  classification: ConstraintClass;
  provenance: AttributeProvenance;
  /**
   * Accepted values for a categorical attribute, e.g. ['noir','black'] or
   * ['ps5','playstation 5']. Several spellings of ONE value — never several
   * different demands.
   */
  values?: string[];
  quantity?: QuantitativeValue;
  /**
   * How `values` is matched against the offer's own value:
   *  'equals'       exact (case-insensitive) equality — colours, condition
   *  'contains_any' the offer's value CONTAINS one of ours — model references
   *                 ("XM5" inside "WH-1000XM5"), multi-value fields
   *                 ("PS5, Xbox, PC")
   */
  matchMode?: 'equals' | 'contains_any';
  /**
   * What to do when the offer says nothing about this attribute.
   * 'pass' is the honest default for anything a merchant may legitimately not
   * publish: silence is not a mismatch (INVARIANT 2). 'reject' is reserved for
   * strictly verifiable specs where "we cannot check" must not be sold as
   * "it complies".
   */
  unknownPolicy: 'pass' | 'reject';
}

/**
 * Minimum confidence for an attribute to become a HARD (required) criterion.
 *
 * Below it the attribute is still extracted, still reported, still usable as a
 * search term — it simply is not allowed to reject anybody's offer. Guessing
 * that an unknown token is a model number and then filtering the whole Web on
 * it is precisely the failure mode this threshold prevents.
 */
export const CRITERION_CONFIDENCE_THRESHOLD = 0.75;

// ============================================================================
// UNIT NORMALISATION
// ============================================================================

interface UnitDefinition {
  canonical: CanonicalUnit;
  /** Multiplier from the raw unit to the canonical one. */
  factor: number;
}

const UNITS: Record<string, UnitDefinition> = {
  // mass
  mg: { canonical: 'g', factor: 0.001 },
  g: { canonical: 'g', factor: 1 },
  gr: { canonical: 'g', factor: 1 },
  grammes: { canonical: 'g', factor: 1 },
  grammes_: { canonical: 'g', factor: 1 },
  kg: { canonical: 'g', factor: 1000 },
  kilos: { canonical: 'g', factor: 1000 },
  kilogrammes: { canonical: 'g', factor: 1000 },
  // length
  mm: { canonical: 'mm', factor: 1 },
  cm: { canonical: 'mm', factor: 10 },
  m: { canonical: 'mm', factor: 1000 },
  // volume
  ml: { canonical: 'ml', factor: 1 },
  cl: { canonical: 'ml', factor: 10 },
  l: { canonical: 'ml', factor: 1000 },
  litres: { canonical: 'ml', factor: 1000 },
  // duration
  min: { canonical: 'h', factor: 1 / 60 },
  minutes: { canonical: 'h', factor: 1 / 60 },
  h: { canonical: 'h', factor: 1 },
  heures: { canonical: 'h', factor: 1 },
  hours: { canonical: 'h', factor: 1 },
  // digital capacity
  mo: { canonical: 'GB', factor: 1 / 1000 },
  mb: { canonical: 'GB', factor: 1 / 1000 },
  go: { canonical: 'GB', factor: 1 },
  gb: { canonical: 'GB', factor: 1 },
  to: { canonical: 'GB', factor: 1000 },
  tb: { canonical: 'GB', factor: 1000 },
  // money
  '€': { canonical: 'EUR', factor: 1 },
  eur: { canonical: 'EUR', factor: 1 },
  euros: { canonical: 'EUR', factor: 1 },
  euro: { canonical: 'EUR', factor: 1 },
  // countable
  '': { canonical: 'unit', factor: 1 },
};

/**
 * Normalise a raw (value, unit) pair to its canonical unit.
 * Returns null for a unit we do not know — never a guessed conversion.
 */
export function normalizeUnit(value: number, rawUnit: string): { unit: CanonicalUnit; normalized: number } | null {
  const key = rawUnit.trim().toLowerCase().replace(/\.$/, '');
  const definition = UNITS[key];
  if (!definition) return null;
  return {
    unit: definition.canonical,
    // Rounded to 4 decimals so 45 min → 0.75 h is exact rather than 0.7499999.
    normalized: Math.round(value * definition.factor * 10000) / 10000,
  };
}

/** Build a QuantitativeValue, or null when the unit is not one we can normalise. */
export function makeQuantity(
  operator: QuantityOperator,
  value: number,
  rawUnit: string,
  maxValue?: number
): QuantitativeValue | null {
  const normalized = normalizeUnit(value, rawUnit);
  if (!normalized) return null;
  const normalizedMax = maxValue !== undefined ? normalizeUnit(maxValue, rawUnit) : undefined;
  if (maxValue !== undefined && !normalizedMax) return null;
  return {
    operator,
    value,
    ...(maxValue !== undefined ? { maxValue } : {}),
    rawUnit,
    unit: normalized.unit,
    normalized: normalized.normalized,
    ...(normalizedMax ? { normalizedMax: normalizedMax.normalized } : {}),
  };
}

// ============================================================================
// ATTRIBUTE → CRITERION
// ============================================================================

/**
 * Turn an attribute into the criterion the rest of the pipeline already
 * understands.
 *
 * Returns null when the attribute must NOT become a criterion:
 *  - it is contextual (a usage signal is not a demand);
 *  - its confidence is below CRITERION_CONFIDENCE_THRESHOLD;
 *  - it carries no checkable value.
 *
 * The mapping is the ONLY place an attribute acquires the power to reject an
 * offer, and it is deliberately narrow.
 */
export function attributeToCriterion(attribute: ExtractedAttribute): PreferenceCriterion | null {
  if (attribute.classification === 'context') return null;

  const level: PreferenceLevel =
    attribute.classification === 'hard'
      ? attribute.provenance.confidence >= CRITERION_CONFIDENCE_THRESHOLD
        ? 'required'
        : 'very_important'
      : 'important';

  const parameters: Record<string, unknown> = {
    unknownPolicy: attribute.unknownPolicy,
    // Provenance travels WITH the criterion: an explanation must be able to
    // quote the words the user actually used (INVARIANT 7).
    attributeKind: attribute.kind,
    matchedText: attribute.provenance.matchedText,
    confidence: attribute.provenance.confidence,
  };

  if (attribute.values && attribute.values.length > 0) {
    parameters['preferredValues'] = attribute.values;
    if (attribute.matchMode) parameters['matchMode'] = attribute.matchMode;
  }

  if (attribute.quantity) {
    const q = attribute.quantity;
    parameters['unit'] = q.unit;
    parameters['rawUnit'] = q.rawUnit;
    switch (q.operator) {
      case 'lte':
        parameters['maxValue'] = q.normalized;
        break;
      case 'gte':
        parameters['minValue'] = q.normalized;
        break;
      case 'eq':
        parameters['exactValue'] = q.normalized;
        break;
      case 'between':
        parameters['minValue'] = q.normalized;
        parameters['maxValue'] = q.normalizedMax;
        break;
    }
  }

  if (!parameters['preferredValues'] && attribute.quantity === undefined) return null;

  return {
    id: attribute.criterionId,
    name: attribute.label,
    level,
    parameters,
  };
}
