/**
 * Capucine — Language detection
 *
 * detectLanguage(text) → { language, confidence, script? }. Deterministic
 * heuristic implementation for now (keyword/stopword frequency — the same
 * "controlled, deterministic" spirit as BasicPatternInterpreter's category
 * detection, not a statistical model). The interface is provider-shaped on
 * purpose: a real detector (AIOrchestrator-routed, or a dedicated local
 * library) can replace HeuristicLanguageDetector later without touching any
 * caller, exactly like AIProvider/AIOrchestrator/ModelRouter already
 * decouples "which LLM" from "how CapucineEngine uses one".
 *
 * NO external provider is wired here. This session: heuristic/mock only.
 */

import { SupportedLanguage } from './i18n';

export interface LanguageDetectionResult {
  language: SupportedLanguage | 'unknown';
  /** 0-1. Never fabricated as 1.0 from a weak signal — see scoring below. */
  confidence: number;
  /** Writing system, when it can be determined structurally (e.g. from
   *  Unicode ranges) rather than guessed. Absent when not determinable. */
  script?: 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'cjk';
}

export interface LanguageDetector {
  detectLanguage(text: string): LanguageDetectionResult;
}

// ── Stopword fingerprints — small, deterministic, per-language ──────────────
// Not exhaustive dictionaries; just enough high-frequency function words to
// discriminate between SUPPORTED_LANGUAGES without a model.
const STOPWORDS: Partial<Record<SupportedLanguage, string[]>> = {
  fr: ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'pour', 'avec', 'sous', 'moins', 'sans', 'que', 'qui'],
  en: ['the', 'a', 'an', 'and', 'for', 'with', 'under', 'less', 'without', 'that', 'which', 'is'],
  de: ['der', 'die', 'das', 'ein', 'eine', 'und', 'für', 'mit', 'unter', 'ohne', 'ist', 'nicht', 'sehr', 'auch', 'ich'],
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'y', 'para', 'con', 'por', 'sin', 'que', 'no', 'muy', 'más', 'está', 'del', 'busco', 'quiero'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'e', 'per', 'con', 'sotto', 'senza', 'che', 'non', 'molto', 'più', 'è', 'sono', 'cerco'],
  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'e', 'para', 'com', 'sem', 'que', 'não', 'muito', 'mais', 'está', 'procuro'],
};

// Several Romance languages share short function words verbatim ("un", "la",
// "que", "que"...) — fr/es/it/pt all list "un" or "una"/"un", fr/es both list
// "que"/"la". A shared word is real but WEAK evidence (it can't discriminate
// between the languages that share it); a word appearing in only ONE
// language's list is strong evidence. Precomputed once at module load —
// O(languages × stopwords), trivial and stays correct if STOPWORDS changes.
const EXCLUSIVE_STOPWORDS: Partial<Record<SupportedLanguage, Set<string>>> = (() => {
  const counts = new Map<string, number>();
  for (const words of Object.values(STOPWORDS)) {
    for (const w of words as string[]) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const result: Partial<Record<SupportedLanguage, Set<string>>> = {};
  for (const [lang, words] of Object.entries(STOPWORDS) as [SupportedLanguage, string[]][]) {
    result[lang] = new Set(words.filter(w => counts.get(w) === 1));
  }
  return result;
})();

// Unicode-range-based script detection — structural, not a guess.
function detectScript(text: string): LanguageDetectionResult['script'] | undefined {
  if (/[؀-ۿ]/.test(text)) return 'arabic';
  if (/[֐-׿]/.test(text)) return 'hebrew';
  if (/[Ѐ-ӿ]/.test(text)) return 'cyrillic';
  if (/[Ͱ-Ͽ]/.test(text)) return 'greek';
  if (/[぀-ヿ一-鿿가-힯]/.test(text)) return 'cjk';
  if (/[a-zA-ZÀ-ÿ]/.test(text)) return 'latin';
  return undefined;
}

/**
 * Deterministic heuristic detector: counts stopword hits per language,
 * normalized by how much of the INPUT TEXT they cover (hits / words in the
 * text) — NOT by the stopword list's own length. Normalizing by list length
 * was a real bug: fr's list has 16 entries and es's has 12, so a single word
 * like "un" (present in both) scored fr 1/16=0.0625 but es 1/12=0.0833 —
 * Spanish "won" purely because its reference list happened to be shorter,
 * misclassifying plainly French sentences like "je cherche un casque
 * bluetooth" as Spanish. Normalizing by input length removes that bias (both
 * languages are scored against the same denominator for the same text).
 *
 * A shared word alone (many Romance-language function words overlap
 * verbatim: "un", "la", "que"...) still can't discriminate between the
 * languages that share it, so EXCLUSIVE_STOPWORDS hits are weighted higher
 * than shared ones — real evidence outweighs ambiguous evidence instead of
 * ties being broken arbitrarily by object key order.
 *
 * Never returns confidence 1 — a handful of stopwords is real evidence, not
 * certainty.
 */
export class HeuristicLanguageDetector implements LanguageDetector {
  private static readonly EXCLUSIVE_WEIGHT = 1.0;
  private static readonly SHARED_WEIGHT = 0.3;

  detectLanguage(text: string): LanguageDetectionResult {
    const script = detectScript(text);
    const words = text.toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean);
    if (words.length === 0) return { language: 'unknown', confidence: 0, script };

    let best: SupportedLanguage | null = null;
    let bestScore = 0;

    for (const [lang, stopwords] of Object.entries(STOPWORDS) as [SupportedLanguage, string[]][]) {
      const exclusive = EXCLUSIVE_STOPWORDS[lang] ?? new Set<string>();
      let weightedHits = 0;
      for (const w of words) {
        if (!stopwords.includes(w)) continue;
        weightedHits += exclusive.has(w)
          ? HeuristicLanguageDetector.EXCLUSIVE_WEIGHT
          : HeuristicLanguageDetector.SHARED_WEIGHT;
      }
      if (weightedHits === 0) continue;
      const score = weightedHits / words.length;
      if (score > bestScore) {
        bestScore = score;
        best = lang;
      }
    }

    if (!best) return { language: 'unknown', confidence: 0, script };
    return { language: best, confidence: Math.min(1, bestScore * 2), script };
  }
}

/** Module-level default instance — deterministic, no I/O, safe to share. */
export const defaultLanguageDetector: LanguageDetector = new HeuristicLanguageDetector();
