/**
 * Capucine — Data quality / confidence
 *
 * "How much do we actually know?" — asked about one data point, and about an
 * offer as a whole.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS EMPHATICALLY NOT FOR
 * ────────────────────────────────────────────────────
 * It is for telling the user how solid a number is: a price read from the
 * merchant's own structured product data is not the same claim as a price
 * scraped out of a search-engine snippet, and presenting them identically is a
 * quiet lie.
 *
 * It is NOT a second admissibility engine. Confidence NEVER decides whether an
 * offer qualifies (INVARIANT 4: admissibility is sovereign, and it is
 * deterministic). Low confidence downgrades what Capucine CLAIMS, never what
 * Capucine ACCEPTS. Nothing in this module can reject an offer, and nothing
 * here may be used to.
 *
 * Deterministic: same DataPoint in, same assessment out.
 */

import { DataPoint, DataStatus, DataProvenance, Offer } from './types';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

export interface DataConfidence {
  level: ConfidenceLevel;
  /** 0-1. Comparable across data points; never presented as a probability. */
  score: number;
  /** The source string this was derived from, verbatim. */
  source?: string;
  status: DataStatus;
  /** Plain-language justification, safe to show. */
  rationale: string;
}

/**
 * How much a source is worth.
 *
 * Ordered from the most direct evidence to the most indirect. A source not
 * listed here is NOT assumed bad — it lands on 'medium' with an explicit
 * "unrecognised source" rationale, because an unknown provenance is a gap in
 * our knowledge about the source, not proof the data is wrong.
 */
const SOURCE_TIERS: Array<{ level: ConfidenceLevel; score: number; test: RegExp; rationale: string }> = [
  { level: 'high', score: 0.95, test: /^manufacturer$/i, rationale: 'donnée publiée par le fabricant' },
  { level: 'high', score: 0.9, test: /^json_ld$/i, rationale: 'donnée structurée publiée par la page produit du marchand' },
  { level: 'high', score: 0.88, test: /repairability|official|gs1/i, rationale: 'source de référence officielle' },
  { level: 'low', score: 0.4, test: /snippet|serp|search_result|web_search/i, rationale: "donnée lue dans un extrait de moteur de recherche, pas sur la page produit" },
  { level: 'medium', score: 0.7, test: /.+/, rationale: 'donnée publiée par le marchand' },
];

/** Confidence for a single data point. */
export function assessDataPoint(dp: DataPoint<unknown> | undefined): DataConfidence {
  if (!dp || dp.value === null || dp.status === 'unknown') {
    return {
      level: 'none',
      score: 0,
      status: 'unknown',
      rationale: 'information non disponible — inconnue, ce qui ne veut pas dire absente',
    };
  }

  if (dp.status === 'contradictory') {
    return {
      level: 'low',
      score: 0.3,
      source: dp.provenance?.source,
      status: 'contradictory',
      rationale: `sources en désaccord (${(dp.conflictingValues ?? []).map(String).join(' / ') || 'valeurs divergentes'}) — aucune valeur retenue`,
    };
  }

  if (dp.status === 'unverifiable') {
    return {
      level: 'low',
      score: 0.35,
      source: dp.provenance?.source,
      status: 'unverifiable',
      rationale: 'information présente mais invérifiable',
    };
  }

  const source = dp.provenance?.source ?? '';
  const tier = SOURCE_TIERS.find(t => t.test.test(source)) ?? {
    level: 'medium' as ConfidenceLevel,
    score: 0.6,
    rationale: 'source non identifiée',
  };

  // A cross-source agreement ('verified') is stronger evidence than a single
  // report of the same value, whatever the source — see DeduplicationEngine,
  // which is the only thing that ever sets 'verified' on a merged field.
  const verifiedBoost = dp.status === 'verified' ? 0.05 : 0;
  const score = Math.min(1, tier.score + verifiedBoost);

  return {
    level: score >= 0.8 ? 'high' : score >= 0.55 ? 'medium' : 'low',
    score: Math.round(score * 100) / 100,
    source: source || undefined,
    status: dp.status,
    rationale: dp.status === 'verified'
      ? `${tier.rationale}, confirmée par plusieurs sources`
      : tier.rationale,
  };
}

export interface OfferDataQuality {
  /** Confidence in the price — the number everything else is compared on. */
  price: DataConfidence;
  /** Weakest confidence among the fields the user's hard constraints depend on. */
  constraintEvidence: ConfidenceLevel;
  /** Fields a hard constraint needs but the offer does not publish. */
  missingForConstraints: string[];
  /** Overall, deliberately conservative: never better than the price evidence. */
  overall: ConfidenceLevel;
}

const LEVEL_ORDER: Record<ConfidenceLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

function weakest(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce<ConfidenceLevel>((worst, level) =>
    LEVEL_ORDER[level] < LEVEL_ORDER[worst] ? level : worst, 'high');
}

/**
 * Assess an offer against the characteristic keys the user's hard constraints
 * actually depend on.
 *
 * `overall` is capped by the price evidence on purpose: an offer whose specs
 * are impeccably documented but whose price came from a search snippet is not
 * a well-known offer, because the price is what the user will pay.
 */
export function assessOfferQuality(offer: Offer, constraintFields: string[] = []): OfferDataQuality {
  const price = assessDataPoint(offer.price);

  const evidence: ConfidenceLevel[] = [];
  const missing: string[] = [];
  for (const field of constraintFields) {
    const dp = offer.characteristics[field];
    const assessment = assessDataPoint(dp);
    if (assessment.level === 'none') missing.push(field);
    else evidence.push(assessment.level);
  }

  const constraintEvidence = evidence.length > 0 ? weakest(evidence) : 'none';
  const overall = constraintFields.length === 0
    ? price.level
    : weakest([price.level, constraintEvidence === 'none' ? 'low' : constraintEvidence]);

  return { price, constraintEvidence, missingForConstraints: missing, overall };
}

/** Convenience: is this provenance one we can name to the user? */
export function describeProvenance(provenance: DataProvenance | undefined): string {
  if (!provenance?.source) return 'provenance non enregistrée';
  return `source : ${provenance.source}${provenance.retrievedAt ? `, relevée le ${provenance.retrievedAt.toISOString().slice(0, 10)}` : ''}`;
}
