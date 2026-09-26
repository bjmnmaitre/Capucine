/**
 * Capucine — Onboarding profile answers → structured criteria
 *
 * The onboarding ("création de profil") turns the user's answers into
 * PERMANENT profile criteria + profile data.
 *
 * CARDINAL RULE — "Capucine ne limite jamais ses recherches."
 * Every criterion built here uses a SOFT level (very_important / important /
 * preference): it FAVOURS matching offers at ranking time, never removes an
 * option at admissibility time (AdmissibilityEngine only ever processes
 * `required` / `forbidden` — see admissibility.ts). An onboarding answer is a
 * wish to be weighed, NOT a filter. A hard constraint can only ever come from
 * an explicit request or a session follow-up ("pas plus de 100 €", "uniquement
 * du neuf"), never from a profile answer.
 *
 * Second rule — UNKNOWN is not penalised: every criterion carries
 * `unknownPolicy: 'pass'` and the SOFT levels already score missing/unknown
 * data as neutral (50) in the priority engine — see handleMissingData() /
 * handleUnknownData() in priority-engine.ts.
 */

import { PreferenceCriterion, ShippingProfile, MerchantAccount } from './types';

// ============================================================================
// CRITERION ID CONSTANTS — shared with the SLOT families the request
// interpreter already uses, so a request- or follow-up criterion with the
// same id correctly OVERRIDES the profile one for that search (the engine's
// resolution chain: profile < request < override).
// ============================================================================

export const ONBOARDING_BUDGET_ID = 'budget';
export const ONBOARDING_CONDITION_ID = 'condition';
export const ONBOARDING_FREE_SHIPPING_ID = 'shipping';
export const ONBOARDING_ORIGIN_ID = 'eu_origin';

/** Soft levels only — see CARDINAL RULE above. Never required/forbidden here. */
export type OnboardingPreferenceLevel = 'very_important' | 'important' | 'preference';

/** EU countries for the "Europe" origin answer — a controlled, explicit list,
 *  never an unbounded "everywhere". */
export const EU_COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

// ============================================================================
// ANSWER SHAPES
// ============================================================================

export type BudgetAnswer = { maxAmount: number; currency: string } | null;
export type ConditionAnswer = 'new' | 'used' | 'any' | null;
export type OriginsAnswer = 'france' | 'europe' | 'any' | null;

/**
 * The full set of answers the onboarding wizard collects. Every field is
 * optional and nullable — "décliner" every question is a valid profile.
 */
export interface OnboardingAnswers {
  preferredLanguage?: string;
  /** Preferred budget cap — FAVOURS, never excludes (see module doc). */
  budget?: BudgetAnswer;
  /** neuf / occasion / peu importe — soft preference. */
  condition?: ConditionAnswer;
  /** Intensity of the "livraison gratuite" preference. 'off' = don't store it. */
  freeShipping?: OnboardingPreferenceLevel | 'off';
  /** Made in France / Europe / aucune préférence — soft preference. */
  origin?: OriginsAnswer;
  /** Merchants to permanently avoid — the ONE hard-leaning answer, applied at
   *  presentation time (masked + reported), never a silent discovery filter. */
  excludedMerchants?: string[];
  /** Shipping prefill data (never mandatory). */
  shipping?: ShippingProfile | null;
  /** Existing merchant accounts the user consents to share. Presence in this
   *  list IS the consent — nothing is stored otherwise. */
  merchantAccounts?: Array<{ merchantName: string }> | null;
}

// ============================================================================
// CRITERION BUILDERS (soft levels, unknownPolicy pass)
// ============================================================================

/** "Budget préféré" — maxAmount favouritism. `budget` maps to offer.price in
 *  both engines. level: preference → weight 1.5, explicit requests override. */
export function budgetCriterion(answer: BudgetAnswer): PreferenceCriterion | null {
  if (!answer || !answer.maxAmount || answer.maxAmount <= 0) return null;
  return {
    id: ONBOARDING_BUDGET_ID,
    name: 'Budget préféré',
    description: 'Budget maximal de référence, sans jamais écarter les offres au-dessus.',
    level: 'preference',
    parameters: {
      maxBudget: answer.maxAmount,
      currency: answer.currency || 'EUR',
      unknownPolicy: 'pass',
    },
  };
}

/** "Neuf / occasion" preference. `condition` vocabulary matches the request
 *  interpreter's extractCondition() ('new' | 'used' | 'refurbished'). */
export function conditionCriterion(answer: ConditionAnswer): PreferenceCriterion | null {
  if (!answer || answer === 'any') return null;
  return {
    id: ONBOARDING_CONDITION_ID,
    name: answer === 'new' ? 'Produit neuf' : 'Produit en occasion',
    level: 'important',
    parameters: { preferredValues: [answer], unknownPolicy: 'pass' },
  };
}

/** "Livraison gratuite préférée". Uses the `shipping` id — the ONLY one both
 *  engines map to offer.shippingCost (admissibility.extractDataPoint and
 *  priority-engine.extractSpecialCriterion). maxValue: 0 → known-free=100,
 *  paid shipping=0 (soft, so never excluding), unknown=50. */
export function freeShippingCriterion(
  level: OnboardingPreferenceLevel
): PreferenceCriterion | null {
  if (!['very_important', 'important', 'preference'].includes(level)) return null;
  return {
    id: ONBOARDING_FREE_SHIPPING_ID,
    name: 'Livraison gratuite préférée',
    level,
    parameters: { maxValue: 0, unit: 'EUR', unknownPolicy: 'pass' },
  };
}

/** Made in France / Europe. `eu_origin` with a field redirect reads
 *  offer.characteristics['country_of_origin'] (catalog + merchant pages). FR
 *  and EU are both concrete: 'france' = ['FR'], 'europe' = the controlled
 *  EU_COUNTRY_CODES list. A non-matching KNOWN origin scores 50 (neutral, soft)
 *  — an offer made in China is kept, just not boosted. */
export function originCriterion(answer: OriginsAnswer): PreferenceCriterion | null {
  if (!answer || answer === 'any') return null;
  const preferredValues = answer === 'france' ? ['FR', 'France'] : EU_COUNTRY_CODES;
  return {
    id: ONBOARDING_ORIGIN_ID,
    name: answer === 'france' ? 'Fabriqué en France' : 'Fabriqué en Europe',
    level: 'very_important',
    parameters: {
      field: 'country_of_origin',
      preferredValues,
      originScope: answer,
      unknownPolicy: 'pass',
    },
  };
}

// ============================================================================
// PROFILE DATA BUILDERS
// ============================================================================

export function merchantAccountCriterion(merchantName: string): PreferenceCriterion {
  const slug = merchantName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id: `merchant-exclude-${slug}`,
    name: `Ne pas acheter chez ${merchantName.trim()}`,
    level: 'forbidden',
    parameters: { merchantName: merchantName.trim() },
  };
}

/** Build the full ordered list of profile criteria from onboarding answers.
 *  Deterministic, pure, testable. Null-producing answers are skipped. */
export function buildOnboardingCriteria(answers: OnboardingAnswers): PreferenceCriterion[] {
  const criteria: PreferenceCriterion[] = [];

  const budget = budgetCriterion(answers.budget ?? null);
  if (budget) criteria.push(budget);

  const condition = conditionCriterion(answers.condition ?? null);
  if (condition) criteria.push(condition);

  const freeShipping =
    answers.freeShipping && answers.freeShipping !== 'off'
      ? freeShippingCriterion(answers.freeShipping)
      : null;
  if (freeShipping) criteria.push(freeShipping);

  const origin = originCriterion(answers.origin ?? null);
  if (origin) criteria.push(origin);

  for (const name of answers.excludedMerchants ?? []) {
    const trimmed = name.trim();
    if (trimmed.length > 0) criteria.push(merchantAccountCriterion(trimmed));
  }

  return criteria;
}

/** MerchantAccount list from the onboarding answer — each entry IS the consent
 *  to share it with Capucine (stored, used to prefill the merchant step). */
export function buildMerchantAccounts(
  accounts: Array<{ merchantName: string }> | null | undefined
): MerchantAccount[] {
  if (!accounts) return [];
  const seen = new Set<string>();
  const out: MerchantAccount[] = [];
  for (const a of accounts) {
    const name = a.merchantName.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ merchantName: name, grantedAt: new Date() });
  }
  return out;
}

/** Normalize a raw shipping answer into a stored ShippingProfile (trimmed,
 *  empty strings dropped, country defaulting to the live destination ONLY when
 *  the user actually filled at least one field — a blank shipping section is
 *  stored as nothing). */
export function normalizeShippingProfile(
  raw: ShippingProfile | null | undefined
): ShippingProfile | null {
  if (!raw) return null;
  const pick = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t && t.length > 0 ? t : undefined;
  };
  const firstName = pick(raw.firstName);
  const lastName = pick(raw.lastName);
  const email = pick(raw.email);
  const street = pick(raw.street);
  const city = pick(raw.city);
  const postalCode = pick(raw.postalCode);
  const country = pick(raw.country);
  const preferredDeliveryMode = raw.preferredDeliveryMode;

  // Only USER-SUPPLIED fields count — the FR country default is a convenience
  // for a REAL answer, never the reason to keep an empty one.
  const hasAnyKey = [
    firstName, lastName, email, street, city, postalCode, preferredDeliveryMode,
  ].some((v) => (typeof v === 'string' ? (v as string).length > 0 : v !== undefined));
  if (!hasAnyKey) return null;

  return {
    firstName,
    lastName,
    email,
    street,
    city,
    postalCode,
    country: country ?? 'FR',
    preferredDeliveryMode,
  };
}