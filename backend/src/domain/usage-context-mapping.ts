/**
 * Capucine — Usage Context Mapping
 *
 * THE ONE PLACE that says "for this usage, these product attributes are
 * worth looking at". Explicit, deterministic, auditable, and testable in
 * isolation: same input, same output, no I/O, no AI, no randomness.
 *
 * WHAT THIS TABLE IS NOT
 * ──────────────────────
 * It does NOT define constraints. Nothing here can reject an offer, and
 * nothing here ever becomes a PreferenceCriterion. AdmissibilityEngine never
 * sees a ContextualSignal — that separation is the whole point: Capucine
 * becomes more intelligent (it knows weight matters for a commuter) without
 * becoming less faithful (it never decides the commuter demanded a light one).
 *
 * The signal keys are those of ContextualSignals (domain/types.ts). The
 * spec's names map onto them as: soundQuality → audioQuality,
 * microphoneQuality → microphone, soundstage → spatialAudio.
 */

import {
  UsageContext,
  UsageContextEntry,
  UsageType,
  ContextType,
  ContextualSignals,
  RelevanceLevel,
} from './types';

/** Signal keys, as a runtime-iterable list (the type is compile-time only). */
export const CONTEXTUAL_SIGNAL_KEYS: ReadonlyArray<keyof ContextualSignals> = [
  'portability',
  'weight',
  'batteryLife',
  'noiseCancellation',
  'comfort',
  'audioQuality',
  'microphone',
  'latency',
  'stability',
  'sweatResistance',
  'spatialAudio',
  'foldability',
  'compatibility',
  'codecSupport',
  'frequencyResponse',
];

/**
 * USAGE → relevant attributes. This is the table §7 of the spec asks for.
 * Order inside each list is meaningful: it is the priority order used when a
 * caller can only afford to act on the first few signals (search queries).
 */
const USAGE_SIGNALS: Record<UsageType, ReadonlyArray<keyof ContextualSignals>> = {
  transport: ['portability', 'weight', 'batteryLife', 'noiseCancellation', 'comfort'],
  travel:    ['portability', 'weight', 'batteryLife', 'noiseCancellation', 'comfort', 'foldability'],
  music:     ['audioQuality', 'codecSupport', 'frequencyResponse', 'comfort'],
  sport:     ['stability', 'sweatResistance', 'weight', 'comfort'],
  office:    ['microphone', 'comfort', 'noiseCancellation', 'batteryLife'],
  gaming:    ['latency', 'microphone', 'compatibility', 'spatialAudio'],
  home:      ['comfort', 'audioQuality'],
  outdoor:   ['portability', 'weight', 'batteryLife', 'stability'],
  other:     [],
};

/**
 * ENVIRONMENT → relevant attributes. A context refines a usage; it never
 * replaces it ("music, mostly on the train" is music-in-transport, and both
 * sets of attributes matter).
 */
const CONTEXT_SIGNALS: Record<ContextType, ReadonlyArray<keyof ContextualSignals>> = {
  transport: ['portability', 'weight', 'batteryLife', 'noiseCancellation', 'comfort'],
  travel:    ['portability', 'weight', 'batteryLife', 'noiseCancellation', 'comfort', 'foldability'],
  office:    ['microphone', 'comfort', 'noiseCancellation', 'batteryLife'],
  gym:       ['stability', 'sweatResistance', 'weight', 'comfort'],
  gaming:    ['latency', 'microphone', 'compatibility', 'spatialAudio'],
  studio:    ['audioQuality', 'frequencyResponse', 'microphone', 'latency'],
  classroom: ['microphone', 'comfort', 'batteryLife'],
  outdoor:   ['portability', 'weight', 'batteryLife', 'stability'],
  home:      ['comfort', 'audioQuality'],
  other:     [],
};

/**
 * Signal priority when several usages are in play — the order queries and
 * explanations enumerate them in, so output stays deterministic regardless of
 * the order the user happened to mention their usages in.
 */
const SIGNAL_PRIORITY: ReadonlyArray<keyof ContextualSignals> = CONTEXTUAL_SIGNAL_KEYS;

/** Every entry of a usage context: the dominant one plus any secondary ones. */
export function usageContextEntries(context: UsageContext): UsageContextEntry[] {
  const primary: UsageContextEntry = {
    usage: context.usage,
    context: context.context,
    source: context.source,
    confidence: context.confidence,
    matchedText: context.matchedText,
  };
  return [primary, ...(context.additional ?? [])];
}

/**
 * Map a usage context (including every secondary usage) to the set of
 * attributes that are RELEVANT for it.
 *
 * Multi-context is a UNION, never a collapse: "pour le sport et les voyages"
 * yields the sport attributes AND the travel attributes. Nothing is dropped
 * because two usages were stated instead of one.
 */
export function mapUsageContextToSignals(context: UsageContext): ContextualSignals {
  const signals: ContextualSignals = {};
  for (const entry of usageContextEntries(context)) {
    for (const key of USAGE_SIGNALS[entry.usage] ?? []) signals[key] = 'relevant';
    if (entry.context) {
      for (const key of CONTEXT_SIGNALS[entry.context] ?? []) signals[key] = 'relevant';
    }
  }
  return signals;
}

/** The relevant signals of a context, in deterministic priority order. */
export function relevantSignals(context: UsageContext): Array<keyof ContextualSignals> {
  const signals = mapUsageContextToSignals(context);
  return SIGNAL_PRIORITY.filter(key => signals[key] === 'relevant');
}

/** Relevance of one attribute for one context — 'neutral' when not mapped. */
export function signalRelevance(
  context: UsageContext,
  signal: keyof ContextualSignals
): RelevanceLevel {
  return mapUsageContextToSignals(context)[signal] ?? 'neutral';
}

/**
 * Merge a usage context stated on a LATER conversation turn into what was
 * already known, without losing anything.
 *
 * Rules (spec §8 — a search's context is not a permanent preference, and a
 * new turn must not silently erase an earlier one):
 *  - the newly stated usage becomes the dominant one (it is what the user
 *    just said);
 *  - everything stated before is kept in `additional`, deduplicated by
 *    usage+context so repeating yourself doesn't inflate the list;
 *  - each entry keeps its own source/confidence/matchedText, so provenance
 *    survives the merge.
 *
 * Returns `previous` unchanged when there is nothing new, and never mutates
 * either argument.
 */
export function mergeUsageContexts(
  previous: UsageContext | undefined,
  incoming: UsageContext | undefined
): UsageContext | undefined {
  if (!incoming) return previous;
  if (!previous) return incoming;

  const merged: UsageContextEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...usageContextEntries(incoming), ...usageContextEntries(previous)]) {
    const key = `${entry.usage}|${entry.context ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  const [primary, ...additional] = merged;
  return {
    ...primary,
    timestamp: incoming.timestamp,
    ...(additional.length > 0 ? { additional } : {}),
  };
}

// ============================================================================
// SEARCH VOCABULARY
//
// Words a real search engine understands, per usage and per signal. Used by
// SearchStrategyPlanner to phrase usage/contextual-spec queries. Kept here,
// next to the mapping itself, so "what transport means" is defined once.
// ============================================================================

type Localized = { fr: string; en: string };

const USAGE_TERMS: Record<UsageType, Localized[]> = {
  transport: [{ fr: 'transport', en: 'commuting' }, { fr: 'métro train', en: 'public transport' }],
  travel:    [{ fr: 'voyage', en: 'travel' }],
  music:     [{ fr: 'musique', en: 'music' }],
  sport:     [{ fr: 'sport', en: 'sport' }],
  office:    [{ fr: 'bureau télétravail', en: 'office work' }],
  gaming:    [{ fr: 'gaming', en: 'gaming' }],
  home:      [{ fr: 'maison', en: 'home' }],
  outdoor:   [{ fr: 'extérieur', en: 'outdoor' }],
  other:     [],
};

const CONTEXT_TERMS: Record<ContextType, Localized[]> = {
  transport: [{ fr: 'transport', en: 'commuting' }],
  travel:    [{ fr: 'voyage', en: 'travel' }],
  office:    [{ fr: 'bureau', en: 'office' }],
  gym:       [{ fr: 'salle de sport', en: 'gym' }],
  gaming:    [{ fr: 'gaming', en: 'gaming' }],
  studio:    [{ fr: 'studio', en: 'studio' }],
  classroom: [{ fr: 'cours', en: 'classroom' }],
  outdoor:   [{ fr: 'extérieur', en: 'outdoor' }],
  home:      [{ fr: 'maison', en: 'home' }],
  other:     [],
};

const SIGNAL_TERMS: Record<keyof ContextualSignals, Localized> = {
  portability:       { fr: 'portable', en: 'portable' },
  weight:            { fr: 'poids', en: 'weight' },
  batteryLife:       { fr: 'autonomie', en: 'battery life' },
  noiseCancellation: { fr: 'réduction de bruit', en: 'noise cancelling' },
  comfort:           { fr: 'confort', en: 'comfort' },
  audioQuality:      { fr: 'qualité sonore', en: 'sound quality' },
  microphone:        { fr: 'micro', en: 'microphone' },
  latency:           { fr: 'latence', en: 'latency' },
  stability:         { fr: 'maintien', en: 'secure fit' },
  sweatResistance:   { fr: 'résistant à la transpiration', en: 'sweatproof' },
  spatialAudio:      { fr: 'audio spatial', en: 'spatial audio' },
  foldability:       { fr: 'pliable', en: 'foldable' },
  compatibility:     { fr: 'compatibilité', en: 'compatibility' },
  codecSupport:      { fr: 'codecs aptX LDAC', en: 'aptX LDAC codecs' },
  frequencyResponse: { fr: 'réponse en fréquence', en: 'frequency response' },
};

/** Search words describing the usage itself ("transport", "commuting"). */
export function usageSearchTerms(context: UsageContext, language: string): string[] {
  const lang = language === 'en' ? 'en' : 'fr';
  const terms: string[] = [];
  for (const entry of usageContextEntries(context)) {
    for (const t of USAGE_TERMS[entry.usage] ?? []) terms.push(t[lang]);
    if (entry.context) {
      for (const t of CONTEXT_TERMS[entry.context] ?? []) terms.push(t[lang]);
    }
  }
  return [...new Set(terms)];
}

/** Search words for the technical dimensions the usage makes relevant. */
export function signalSearchTerms(
  context: UsageContext,
  language: string,
  limit = 4
): string[] {
  const lang = language === 'en' ? 'en' : 'fr';
  return relevantSignals(context)
    .slice(0, limit)
    .map(key => SIGNAL_TERMS[key][lang]);
}

// ============================================================================
// EXPLANATION VOCABULARY
// ============================================================================

const USAGE_LABELS: Record<UsageType, Localized> = {
  transport: { fr: 'dans les transports', en: 'for commuting' },
  travel:    { fr: 'en voyage', en: 'for travel' },
  music:     { fr: "pour l'écoute de musique", en: 'for listening to music' },
  sport:     { fr: 'pour le sport', en: 'for sport' },
  office:    { fr: 'au bureau', en: 'at the office' },
  gaming:    { fr: 'pour le gaming', en: 'for gaming' },
  home:      { fr: 'à la maison', en: 'at home' },
  outdoor:   { fr: 'en extérieur', en: 'outdoors' },
  other:     { fr: 'pour cet usage', en: 'for this usage' },
};

const CONTEXT_LABELS: Record<ContextType, Localized> = {
  transport: { fr: 'dans les transports', en: 'on public transport' },
  travel:    { fr: 'en voyage', en: 'while travelling' },
  office:    { fr: 'au bureau', en: 'at the office' },
  gym:       { fr: 'en salle de sport', en: 'at the gym' },
  gaming:    { fr: 'en jeu', en: 'while gaming' },
  studio:    { fr: 'en studio', en: 'in the studio' },
  classroom: { fr: 'en cours', en: 'in class' },
  outdoor:   { fr: 'en extérieur', en: 'outdoors' },
  home:      { fr: 'à la maison', en: 'at home' },
  other:     { fr: 'dans ce contexte', en: 'in this context' },
};

const SIGNAL_LABELS: Record<keyof ContextualSignals, Localized> = {
  portability:       { fr: 'la portabilité', en: 'portability' },
  weight:            { fr: 'le poids', en: 'weight' },
  batteryLife:       { fr: "l'autonomie", en: 'battery life' },
  noiseCancellation: { fr: 'la réduction de bruit', en: 'noise cancellation' },
  comfort:           { fr: 'le confort', en: 'comfort' },
  audioQuality:      { fr: 'la qualité sonore', en: 'sound quality' },
  microphone:        { fr: 'la qualité du micro', en: 'microphone quality' },
  latency:           { fr: 'la latence', en: 'latency' },
  stability:         { fr: 'le maintien', en: 'fit stability' },
  sweatResistance:   { fr: 'la résistance à la transpiration', en: 'sweat resistance' },
  spatialAudio:      { fr: "l'audio spatial", en: 'spatial audio' },
  foldability:       { fr: 'la pliabilité', en: 'foldability' },
  compatibility:     { fr: 'la compatibilité', en: 'compatibility' },
  codecSupport:      { fr: 'les codecs supportés', en: 'codec support' },
  frequencyResponse: { fr: 'la réponse en fréquence', en: 'frequency response' },
};

/** Human label for a usage context, e.g. "pour l'écoute de musique, dans les transports". */
export function describeUsageContext(context: UsageContext, language = 'fr'): string {
  const lang = language === 'en' ? 'en' : 'fr';
  const parts: string[] = [];
  for (const entry of usageContextEntries(context)) {
    const usage = USAGE_LABELS[entry.usage][lang];
    const env = entry.context ? CONTEXT_LABELS[entry.context][lang] : undefined;
    parts.push(env && env !== usage ? `${usage}, ${env}` : usage);
  }
  return [...new Set(parts)].join(' ; ');
}

/** Human label for one signal, e.g. "le poids". */
export function describeSignal(signal: keyof ContextualSignals, language = 'fr'): string {
  return SIGNAL_LABELS[signal][language === 'en' ? 'en' : 'fr'];
}

/**
 * Why an attribute is relevant for a usage — phrased so it can NEVER be read
 * as "the user asked for this".
 *
 * Correct:  "Pour votre usage dans les transports, le poids a été pris en
 *            compte comme signal contextuel."
 * Never:    "Vous avez demandé un casque léger."
 */
export function explainSignalRelevance(
  context: UsageContext,
  signal: keyof ContextualSignals,
  language = 'fr'
): string {
  const lang = language === 'en' ? 'en' : 'fr';
  const usage = describeUsageContext(context, lang);
  const attribute = describeSignal(signal, lang);
  return lang === 'en'
    ? `For your stated usage ${usage}, ${attribute} was taken into account as a contextual signal (not as a requirement you expressed).`
    : `Pour votre usage ${usage}, ${attribute} a été pris en compte comme signal contextuel (ce n'est pas une exigence que vous avez formulée).`;
}
