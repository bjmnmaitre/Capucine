/**
 * Capucine — Override Extractor (MEGAPROMPT #6)
 *
 * Turns a clarification answer into TEMPORARY, session-scoped exceptions to
 * the user's PERMANENT profile preferences:
 *
 *   profile: "Ne pas acheter chez Amazon" (forbidden)
 *   answer : "exceptionnellement Amazon ça va"
 *   → ProfileOverride { criterionId: 'merchant-exclude-amazon', temporaryLevel: 'disabled' }
 *
 * Rules (PROVISIONAL, 2026-09-26):
 *  - Deterministic, no AI. Pure function.
 *  - An override ONLY targets a criterion that really exists in the profile
 *    (real id). No synthetic ids, nothing that would be silently ignored.
 *  - It requires BOTH a relaxation cue ("ça va", "peu importe", "accepte"…)
 *    AND a clear temporal signal (detectTemporariness = explicit | likely).
 *    "toujours" / no signal → no override: a permanent change belongs in the
 *    profile, edited by the user, never written behind their back.
 *  - The permanent profile is never modified here.
 *
 * New CONSTRAINTS in an answer ("sans Amazon", "sous 500 €") are not this
 * module's job: CapucineEngine.interpretFollowUp() already turns them into
 * session criteria.
 */

import { ProfileOverride, merchantNameOfExclusion } from '../domain/profile';
import { PreferenceCriterion } from '../domain/types';
import { TemporarinessLevel, detectTemporariness } from './preference-promotion-engine';

export interface OverrideExtractionResult {
  overrides: ProfileOverride[];
  extractionLog: string[];
}

/** Lowercase, accents stripped, apostrophes unified. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .trim();
}

/** "ça va", "peu importe", "accepte"… — the user loosens something. */
const RELAXATION_CUE = /\b(?:peu importe|n'importe|accepte|autorise|reautorise|inclus|inclue|garde|remets?|oublie|ignore|laisse tomber|tant pis pour|pas grave|pas besoin d[e']|pas oblige|ca (?:me )?va|c'?est (?:bon|ok)|ok pour|fine|whatever|allow|include|ignore|don'?t care about)\b/;

const STOPWORDS = new Set([
  'pour', 'avec', 'sans', 'chez', 'dans', 'plus', 'moins', 'tres', 'toujours',
  'jamais', 'acheter', 'produit', 'produits', 'preference', 'critere', 'the', 'and',
]);

/** Words that identify a criterion in free text. */
function keywordsOf(c: PreferenceCriterion): string[] {
  const merchant = merchantNameOfExclusion(c);
  if (merchant) return [normalize(merchant)];
  return normalize(c.name ?? '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(haystack);
}

export function extractOverridesFromAnswer(
  answerText: string,
  profileCriteria: ReadonlyArray<PreferenceCriterion>,
  detectTemporarinessFn: (text: string) => TemporarinessLevel = detectTemporariness
): OverrideExtractionResult {
  const extractionLog: string[] = [];
  if (typeof answerText !== 'string' || answerText.trim().length === 0) {
    return { overrides: [], extractionLog: ['Empty answer'] };
  }
  if (profileCriteria.length === 0) {
    return { overrides: [], extractionLog: ['Profile has no permanent criterion to relax'] };
  }

  const text = normalize(answerText);
  const temporariness = detectTemporarinessFn(answerText);
  extractionLog.push(`Temporariness: ${temporariness}`);

  if (!RELAXATION_CUE.test(text)) {
    extractionLog.push('No relaxation cue');
    return { overrides: [], extractionLog };
  }
  if (temporariness !== 'explicit' && temporariness !== 'likely') {
    extractionLog.push(
      temporariness === 'unlikely'
        ? 'Permanent wording: not a session exception (the profile is edited by the user, not here)'
        : 'No temporal signal: ambiguous, no override'
    );
    return { overrides: [], extractionLog };
  }

  const overrides: ProfileOverride[] = [];
  for (const c of profileCriteria) {
    const keywords = keywordsOf(c);
    if (keywords.length === 0 || !keywords.some((k) => containsWord(text, k))) continue;
    overrides.push({
      criterionId: c.id,
      temporaryLevel: 'disabled',
      reason: `Exception pour cette recherche : « ${answerText.trim()} »`,
      source: 'explicit_user',
      createdAt: new Date(),
      originalLevel: c.level,
    });
    extractionLog.push(`Override: ${c.id} (${c.level} → disabled)`);
  }
  if (overrides.length === 0) extractionLog.push('No profile criterion matched the answer');
  return { overrides, extractionLog };
}
