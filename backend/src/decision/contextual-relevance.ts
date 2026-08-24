/**
 * Capucine — Contextual Relevance
 *
 * Scores an offer against the DERIVED CONTEXTUAL SIGNALS of a usage context
 * ("for commuting" → weight, battery life, noise cancellation matter).
 *
 * THREE RULES, NON-NEGOTIABLE
 * ───────────────────────────
 * 1. AFTER ADMISSIBILITY, NEVER INSTEAD OF IT. This module never decides
 *    whether an offer may be shown. It only adds points to offers that
 *    AdmissibilityEngine already accepted. There is no code path by which a
 *    contextual signal rescues a rejected offer.
 *
 * 2. UNKNOWN != FALSE. An offer with no weight data contributes nothing and
 *    LOSES nothing: its contribution is 0, never negative. The formal
 *    guarantee is `bonus >= 0`, i.e. an offer's score with a usage context is
 *    always >= its score without one. Absence of evidence is never evidence
 *    of a bad product.
 *
 * 3. EXPLICIT BEATS INFERRED. If the user set a real criterion on the same
 *    attribute ("absolument moins de 300 g"), the contextual signal stands
 *    down entirely ('superseded'): the user's own criterion already decides
 *    that attribute, at its own weight, and it must not be double-counted or
 *    diluted by an inference.
 *
 * Fully deterministic: no I/O, no clock, no AI, no randomness.
 */

import {
  Offer,
  DataStatus,
  PreferenceCriterion,
  ContextualSignals,
  ContextualSignalScore,
  ContextualRelevance,
  UsageContext,
} from '../domain/types';
import {
  relevantSignals,
  describeSignal,
  describeUsageContext,
} from '../domain/usage-context-mapping';

/**
 * Maximum number of points a usage context can ever add to an offer's score.
 *
 * Deliberately small relative to the 0-100 criteria score: a contextual
 * signal is a tie-breaker between offers the user's real criteria rate
 * similarly, not something that can overturn an explicit preference. Ten
 * points cannot bridge the gap a 'required' criterion (weight 8) opens.
 */
export const CONTEXTUAL_BONUS_MAX = 10;

// ============================================================================
// SIGNAL → OFFER ATTRIBUTE
// ============================================================================

type Evaluator = (value: unknown) => { fraction: number; description: string } | null;

/** Truthy-boolean attribute: present and true earns the point; false earns nothing. */
function booleanSignal(trueLabel: string, falseLabel: string): Evaluator {
  return (value) => {
    const s = String(value).trim().toLowerCase();
    if (['true', 'oui', 'yes', '1'].includes(s)) return { fraction: 1, description: trueLabel };
    if (['false', 'non', 'no', '0'].includes(s)) return { fraction: 0, description: falseLabel };
    // A non-boolean string ("aptX, LDAC") counts as present-and-informative.
    return s.length > 0 ? { fraction: 1, description: `${trueLabel} (${s})` } : null;
  };
}

/** Numeric attribute where LOWER is better for this usage (weight, latency). */
function lowerIsBetter(best: number, worst: number, unit: string): Evaluator {
  return (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(n)) return null;
    const clamped = Math.min(Math.max(n, best), worst);
    const fraction = (worst - clamped) / (worst - best);
    return { fraction, description: `${n}${unit}` };
  };
}

/** Numeric attribute where HIGHER is better for this usage (battery life). */
function higherIsBetter(worst: number, best: number, unit: string): Evaluator {
  return (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(n)) return null;
    const clamped = Math.min(Math.max(n, worst), best);
    const fraction = (clamped - worst) / (best - worst);
    return { fraction, description: `${n}${unit}` };
  };
}

interface SignalSource {
  /** Offer characteristic keys to look for, in order. First KNOWN one wins. */
  attributes: string[];
  evaluate: Evaluator;
}

/**
 * Which offer characteristic actually carries each signal.
 *
 * The numeric ranges are read AFTER NormalizationEngine has run, which
 * canonicalizes `weight` to grams and `battery_life` to hours — so the
 * thresholds below are in those canonical units, never in whatever unit a
 * merchant happened to publish.
 */
const SIGNAL_SOURCES: Record<keyof ContextualSignals, SignalSource> = {
  weight:            { attributes: ['weight'], evaluate: lowerIsBetter(200, 400, 'g') },
  batteryLife:       { attributes: ['battery_life', 'battery'], evaluate: higherIsBetter(10, 40, 'h') },
  latency:           { attributes: ['latency'], evaluate: lowerIsBetter(20, 200, 'ms') },
  portability:       { attributes: ['portable', 'foldable'], evaluate: booleanSignal('portable', 'peu portable') },
  foldability:       { attributes: ['foldable'], evaluate: booleanSignal('pliable', 'non pliable') },
  noiseCancellation: { attributes: ['anc', 'noise_cancelling', 'noise_cancellation'], evaluate: booleanSignal('réduction de bruit active', 'pas de réduction de bruit') },
  comfort:           { attributes: ['comfort', 'confort'], evaluate: booleanSignal('confort documenté', 'confort limité') },
  audioQuality:      { attributes: ['audio_quality', 'sound_quality', 'hi_res'], evaluate: booleanSignal('qualité audio documentée', 'qualité audio limitée') },
  microphone:        { attributes: ['microphone', 'mic', 'professional_use'], evaluate: booleanSignal('micro documenté', 'pas de micro') },
  stability:         { attributes: ['stability', 'secure_fit'], evaluate: booleanSignal('maintien documenté', 'maintien limité') },
  sweatResistance:   { attributes: ['sweat_resistant', 'water_resistance', 'ip_rating'], evaluate: booleanSignal('résistance documentée', 'pas de résistance') },
  spatialAudio:      { attributes: ['spatial_audio', 'soundstage'], evaluate: booleanSignal('audio spatial', 'pas d\'audio spatial') },
  compatibility:     { attributes: ['compatibility', 'compatible'], evaluate: booleanSignal('compatibilité documentée', 'compatibilité limitée') },
  codecSupport:      { attributes: ['codecs', 'codec_support', 'aptx', 'ldac'], evaluate: booleanSignal('codecs documentés', 'codecs limités') },
  frequencyResponse: { attributes: ['frequency_response'], evaluate: booleanSignal('réponse en fréquence documentée', 'non documentée') },
};

/**
 * Criterion ids that mean "the user themselves spoke about this attribute".
 * Matching one suppresses the corresponding contextual signal — see rule 3.
 * Compared case-insensitively against `PreferenceCriterion.id`.
 */
const EXPLICIT_CRITERION_IDS: Record<keyof ContextualSignals, string[]> = {
  weight:            ['weight', 'poids'],
  batteryLife:       ['battery_life', 'battery', 'autonomie'],
  latency:           ['latency', 'latence'],
  portability:       ['portable', 'portability', 'portabilite', 'portabilité'],
  foldability:       ['foldable', 'pliable'],
  noiseCancellation: ['anc', 'noise_cancelling', 'noise_cancellation', 'reduction_bruit', 'réduction_bruit'],
  comfort:           ['comfort', 'confort'],
  audioQuality:      ['audio_quality', 'sound_quality', 'qualite_audio'],
  microphone:        ['microphone', 'mic', 'micro'],
  stability:         ['stability', 'maintien'],
  sweatResistance:   ['sweat_resistant', 'water_resistance', 'ip_rating', 'etancheite'],
  spatialAudio:      ['spatial_audio', 'soundstage'],
  compatibility:     ['compatibility', 'compatible', 'compatibilite', 'compatibilité'],
  codecSupport:      ['codecs', 'codec_support', 'aptx', 'ldac'],
  frequencyResponse: ['frequency_response'],
};

// ============================================================================
// SCORING
// ============================================================================

/**
 * Score one offer against one usage context.
 *
 * @param effectiveCriteria the user's real criteria — used ONLY to detect
 *   which attributes the user already spoke about, so those signals stand down.
 * @returns undefined when the context makes no attribute relevant at all
 *   (e.g. usage 'other'), so callers can leave the offer untouched.
 */
export function scoreContextualRelevance(
  offer: Offer,
  usageContext: UsageContext,
  effectiveCriteria: PreferenceCriterion[] = []
): ContextualRelevance | undefined {
  const applicable = relevantSignals(usageContext);
  if (applicable.length === 0) return undefined;

  const explicitIds = new Set(
    effectiveCriteria.filter(c => c.level !== 'none').map(c => c.id.toLowerCase())
  );

  const signals: ContextualSignalScore[] = [];
  let considered = 0;
  let earnedFraction = 0;

  for (const signal of applicable) {
    // Rule 3 — the user's own criterion decides this attribute.
    const supersededBy = EXPLICIT_CRITERION_IDS[signal].find(id => explicitIds.has(id));
    if (supersededBy) {
      signals.push({
        signal,
        outcome: 'superseded',
        contribution: 0,
        maxContribution: 0,
        reasoning: `${describeSignal(signal)} : critère explicite « ${supersededBy} » exprimé par l'utilisateur — le signal contextuel s'efface, la demande explicite décide.`,
      });
      continue;
    }

    const source = SIGNAL_SOURCES[signal];
    const found = readAttribute(offer, source.attributes);

    if (!found) {
      // Rule 2 — no data is not bad data.
      considered += 1;
      signals.push({
        signal,
        outcome: 'unknown',
        contribution: 0,
        maxContribution: 0,
        reasoning: `${describeSignal(signal)} : donnée inconnue pour cette offre — aucun point ajouté, aucune pénalité (inconnu ≠ défavorable).`,
      });
      continue;
    }

    const evaluated = source.evaluate(found.value);
    if (!evaluated) {
      considered += 1;
      signals.push({
        signal,
        attribute: found.attribute,
        outcome: 'unknown',
        foundValue: found.value,
        foundStatus: found.status,
        contribution: 0,
        maxContribution: 0,
        reasoning: `${describeSignal(signal)} : valeur « ${String(found.value)} » non interprétable — traitée comme inconnue, sans pénalité.`,
      });
      continue;
    }

    considered += 1;
    earnedFraction += evaluated.fraction;
    signals.push({
      signal,
      attribute: found.attribute,
      outcome: 'applied',
      foundValue: found.value,
      foundStatus: found.status,
      contribution: 0, // filled in below, once the per-signal share is known
      maxContribution: 0,
      reasoning: `${describeSignal(signal)} : ${evaluated.description} (source ${found.attribute}, donnée ${found.status}).`,
    });
  }

  if (considered === 0) {
    // Every relevant attribute was superseded by an explicit criterion.
    return {
      usageContext,
      bonus: 0,
      maxBonus: 0,
      signals,
    };
  }

  const share = CONTEXTUAL_BONUS_MAX / considered;
  let bonus = 0;
  for (const scored of signals) {
    if (scored.outcome === 'superseded') continue;
    scored.maxContribution = round1(share);
    if (scored.outcome === 'applied') {
      const source = SIGNAL_SOURCES[scored.signal];
      const evaluated = source.evaluate(scored.foundValue);
      const contribution = round1(share * (evaluated?.fraction ?? 0));
      scored.contribution = contribution;
      bonus += contribution;
    }
  }

  return {
    usageContext,
    bonus: round1(Math.min(bonus, CONTEXTUAL_BONUS_MAX)),
    maxBonus: round1(share * considered),
    signals,
  };
}

/** First characteristic in `keys` that carries usable (non-unknown) data. */
function readAttribute(
  offer: Offer,
  keys: string[]
): { attribute: string; value: unknown; status: DataStatus } | null {
  for (const key of keys) {
    const dp = offer.characteristics[key];
    if (!dp) continue;
    // 'unknown' and null are the literal absence of evidence — skip, never punish.
    if (dp.status === 'unknown' || dp.value === null || dp.value === undefined) continue;
    return { attribute: key, value: dp.value, status: dp.status };
  }
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * One-line, honest summary of what the context contributed to this offer.
 * Says "signal contextuel", never "vous avez demandé".
 */
export function summarizeContextualRelevance(
  relevance: ContextualRelevance,
  language = 'fr'
): string {
  const applied = relevance.signals.filter(s => s.outcome === 'applied');
  const usage = describeUsageContext(relevance.usageContext, language);
  if (applied.length === 0) {
    return language === 'en'
      ? `No contextual data available for your stated usage ${usage} — this offer was neither rewarded nor penalised for it.`
      : `Aucune donnée contextuelle disponible pour votre usage ${usage} — cette offre n'a été ni valorisée ni pénalisée à ce titre.`;
  }
  const names = applied.map(s => describeSignal(s.signal, language)).join(', ');
  return language === 'en'
    ? `Relevant for your stated usage ${usage}: ${names} (+${relevance.bonus} pts as contextual signals, not as requirements you expressed).`
    : `Pertinent pour votre usage ${usage} : ${names} (+${relevance.bonus} pts au titre de signaux contextuels, pas d'exigences que vous avez formulées).`;
}
