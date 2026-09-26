/**
 * Capucine — Override Extractor
 *
 * Extracts temporary session-scoped overrides from clarification answers.
 * Pure function module — no class, no state, no external dependencies.
 */

import { ProfileOverride } from '../domain/profile';
import { PreferenceLevel } from '../domain/types';
import { TemporarinessLevel, detectTemporariness, PreferencePromotionEngine } from './preference-promotion-engine';

export interface OverrideExtractionResult {
  overrides: ProfileOverride[];
  extractionLog: string[];
}

interface DetectedOverride {
  criterionId: string;
  temporaryLevel: PreferenceLevel | 'disabled';
  reason: string;
  source: ProfileOverride['source'];
  originalLevel?: PreferenceLevel;
}

const EXPLICIT_TEMPORAL_SIGNALS = [
  'aujourd\'hui',
  'ce soir',
  'cette fois',
  'cette fois-ci',
  'juste pour',
  'juste cette fois',
  'pour l\'instant',
  'exceptionnellement',
  'just this time',
  'just this once',
  'for now',
  'today only',
  'one time',
  'one-time',
  'ponctuellement',
  'uniquement aujourd\'hui',
];

const LIKELY_TEMPORAL_SIGNALS = [
  'aujourd\'hui',
  'ce soir',
  'cette fois',
  'just this time',
  'for now',
  'today',
];

const PERMANENT_SIGNALS = [
  'toujours',
  'always',
  'définitivement',
  'permanently',
  'permanent',
  'définitif',
  'permanentement',
  'en permanence',
  'pour toujours',
  'forever',
];

const BUDGET_PATTERN = /(?:sous|moins de|under|max|maximum|pas plus de)\s*(?:€\s*)?(\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur)?/i;
const EXCLUSION_PATTERN = /(?:sans|no|pas de|aucun|aucune)\s+([a-zéèêàâùûç\-]+(?:\s+[a-zéèêààâùûç\-]+)*)/i;

const KNOWN_CATEGORIES = [
  'livraison', 'delivery', 'shipping',
  'saumon', 'salmon',
  'burger', 'pizza', 'pâtes', 'pates', 'pasta',
  'gluten', 'viande', 'meat', 'poisson', 'fish',
  'végétarien', 'vegetarien', 'vegan', 'végétalien',
  'bio', 'bio', 'organic',
  'glace', 'ice cream', 'dessert',
  'boisson', 'drink', 'jus', 'juice',
];

/**
 * Extracts temporary overrides from a clarification answer.
 *
 * Pure function — no side effects, no external dependencies.
 */
export function extractOverridesFromAnswer(
  answerText: string,
  questionContext: string,
  detectTemporarinessFn: (text: string) => 'explicit' | 'likely' | 'unlikely' | 'unknown' = detectTemporariness
): { overrides: ProfileOverride[]; extractionLog: string[] } {
  const overrides: ProfileOverride[] = [];
  const extractionLog: string[] = [];

  if (!answerText || typeof answerText !== 'string') {
    extractionLog.push('Empty or invalid answer text');
    return { overrides: [], extractionLog };
  }

  const trimmedAnswer = answerText.trim();
  if (!trimmedAnswer) {
    extractionLog.push('Empty answer after trim');
    return { overrides: [], extractionLog };
  }

  const normalized = trimmedAnswer.toLowerCase().trim();

  // Check for explicit temporal signals
  const hasExplicitTemporal = EXPLICIT_TEMPORAL_SIGNALS.some(s => normalized.includes(s));
  const hasLikelyTemporal = LIKELY_TEMPORAL_SIGNALS.some(s => normalized.includes(s));
  const hasPermanentSignal = PERMANENT_SIGNALS.some(s => normalized.includes(s));

  // Determine temporariness using the injected function
  const temporariness = detectTemporarinessFn(trimmedAnswer);
  extractionLog.push(`Temporariness detected: ${temporariness}`);

  // If no temporal signal and not a budget/exclusion pattern, likely no override
  const hasBudgetPattern = BUDGET_PATTERN.test(trimmedAnswer);
  const hasExclusionPattern = EXCLUSION_PATTERN.test(trimmedAnswer);

  if (!hasExplicitTemporal && !hasLikelyTemporal && !hasBudgetPattern && !hasExclusionPattern) {
    extractionLog.push('No temporal signal, budget pattern, or exclusion pattern detected');
    return { overrides: [], extractionLog };
  }

  // Determine if we should create overrides
  // Exclusion patterns are inherently temporary (user wants to exclude something for this search)
  // Budget patterns with temporal signals are temporary
  const isExplicitOrLikely = temporariness === 'explicit' || temporariness === 'likely';
  const isUnlikely = temporariness === 'unlikely';

  const shouldCreateOverride = 
    isExplicitOrLikely ||
    (hasExclusionPattern && (hasExplicitTemporal || hasLikelyTemporal || !isUnlikely)) ||
    (hasBudgetPattern && !isUnlikely);

  if (!shouldCreateOverride) {
    extractionLog.push('Temporariness suggests permanent preference or no clear override signal');
    return { overrides: [], extractionLog };
  }

  const now = new Date();
  const detectedOverrides: DetectedOverride[] = [];

  // 1. Budget override detection
  if (hasBudgetPattern) {
    const match = trimmedAnswer.match(BUDGET_PATTERN);
    if (match && match[1]) {
      const limit = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(limit) && limit > 0) {
        detectedOverrides.push({
          criterionId: '_budget_temp',
          temporaryLevel: 'required',
          reason: `Budget temporaire: ${trimmedAnswer}`,
          source: 'ai_detected',
          originalLevel: undefined,
        });
        extractionLog.push(`Budget override detected: ${limit} (from "${trimmedAnswer}")`);
      }
    }
  }

  // 2. Exclusion override detection
  if (hasExclusionPattern) {
    const match = trimmedAnswer.match(EXCLUSION_PATTERN);
    if (match && match[1]) {
      const excludedTerm = match[1].trim();
      // Check if it's a known category or just a term
      const isKnownCategory = KNOWN_CATEGORIES.some(cat =>
        excludedTerm.toLowerCase().includes(cat.toLowerCase())
      );

      detectedOverrides.push({
        criterionId: `_exclusion_temp_${excludedTerm.replace(/\s+/g, '_')}`,
        temporaryLevel: 'forbidden',
        reason: `Exclusion temporaire: ${trimmedAnswer}`,
        source: 'ai_detected',
        originalLevel: undefined,
      });
      extractionLog.push(`Exclusion override detected: "${excludedTerm}" (from "${trimmedAnswer}")`);
    }
  }

  // If we have temporal signal but no specific pattern, log and don't create override
  if ((hasExplicitTemporal || hasLikelyTemporal) && !hasBudgetPattern && !hasExclusionPattern) {
    extractionLog.push(`Temporal signal detected but no extractable constraint pattern`);
  }

  // Convert to ProfileOverride with timestamps
  for (const detected of detectedOverrides) {
    overrides.push({
      criterionId: detected.criterionId,
      temporaryLevel: detected.temporaryLevel,
      reason: detected.reason,
      source: detected.source,
      createdAt: new Date(),
      originalLevel: detected.originalLevel,
    });
  }

  if (overrides.length === 0) {
    extractionLog.push('No overrides created');
  } else {
    extractionLog.push(`${overrides.length} override(s) created`);
  }

  return { overrides, extractionLog };
}