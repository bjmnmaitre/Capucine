/**
 * Capucine — Preference Promotion Engine
 *
 * Detects the temporariness level of user-provided constraints in conversational
 * follow-ups. Determines whether a constraint should be a permanent profile
 * preference or a temporary session-scoped override.
 *
 * This is a pure function module — no class, no state, no external dependencies.
 */

import { PreferenceLevel } from '../domain/types';

/**
 * How temporary/permanent a user-expressed constraint is.
 *
 * - 'explicit' — User explicitly stated it's temporary ("just today", "just this time",
 *   "for now", "exceptionnellement", "just this time"). Override is created.
 * - 'likely' — Constraint strongly suggests temporary intent ("aujourd'hui", "ce soir",
 *   "cette fois", "just this time", "for now"). Override is created.
 * - 'unlikely' — Constraint suggests permanent preference ("always", "toujours",
 *   "définitivement", "permanently"). No override — should be saved to profile.
 * - 'unknown' — No clear temporal signal. Default to no override; let the user
 *   decide via profile if they want it permanent.
 */
export type TemporarinessLevel = 'explicit' | 'likely' | 'unlikely' | 'unknown';

/**
 * Detects the temporariness level of a user-provided constraint text.
 *
 * Pure function — no side effects, no external dependencies. Can be stubbed in tests.
 */
export function detectTemporariness(text: string): TemporarinessLevel {
  const normalized = text.toLowerCase().trim();

  if (!normalized) {
    return 'unknown';
  }

  // Explicit temporal signals — user explicitly states temporary intent
  const explicitSignals = [
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

  for (const signal of explicitSignals) {
    if (normalized.includes(signal)) {
      return 'explicit';
    }
  }

  // Likely temporal signals — strongly suggests temporary but not explicitly stated
  const likelySignals = [
    'aujourd\'hui',
    'ce soir',
    'cette fois',
    'just this time',
    'for now',
    'today',
  ];

  for (const signal of likelySignals) {
    if (normalized.includes(signal)) {
      return 'likely';
    }
  }

  // Unlikely / permanent signals — user wants this permanently
  const permanentSignals = [
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

  for (const signal of permanentSignals) {
    if (normalized.includes(signal)) {
      return 'unlikely';
    }
  }

  return 'unknown';
}

/**
 * Preference Promotion Engine — determines whether a user constraint should
 * be a permanent profile preference or a temporary session-scoped override.
 *
 * This is a pure function module — no state, no external dependencies.
 */
export const PreferencePromotionEngine = {
  detectTemporariness,

  /**
   * Determines whether a constraint should be promoted to a permanent profile
   * preference or kept as a temporary session-scoped override.
   *
   * @param constraintText - The user's constraint text (e.g., "aujourd'hui sous 20€")
   * @param temporariness - The detected temporariness level from detectTemporariness()
   * @returns true if the constraint should be a permanent profile preference,
   *          false if it should be a temporary session-scoped override
   */
  shouldPromoteToProfile(constraintText: string, temporariness: TemporarinessLevel): boolean {
    // Explicit or likely temporary → do NOT promote to profile
    if (temporariness === 'explicit' || temporariness === 'likely') {
      return false;
    }

    // Explicitly permanent → promote to profile
    if (temporariness === 'unlikely') {
      return true;
    }

    // Unknown — default to NOT promoting (safer; user can always save to profile explicitly)
    return false;
  },
};