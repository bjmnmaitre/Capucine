/**
 * CAPUCINE — helpers purs pour le wizard de création de profil.
 *
 * Séparés de l'écran pour être testables sans React Native. Ne font AUCUN
 * appel réseau : ils préparent seulement le corps JSON envoyé à
 * POST /profile/:userId/onboarding.
 */

import { OnboardingAnswers, ShippingProfile } from './types';

/**
 * Nombre saisi librement (virgule ou point) → number | null. Une entrée
 * illisible est traitée comme « non renseigné », jamais comme 0 (un budget à
 * zéro exclurait tout au classement — CAPUCINE ne crée jamais ça).
 */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface OnboardingDraft {
  budgetRaw: string;
  condition: OnboardingAnswers['condition'];
  freeShipping: OnboardingAnswers['freeShipping'];
  origin: OnboardingAnswers['origin'];
  shipping: ShippingProfile;
  sharedAccounts: string[];
  sharedExtra: string;
  excluded: string[];
}

/**
 * Assemble le corps complet de POST /profile/:userId/onboarding à partir du
 * brouillon du wizard. Toutes les réponses sont optionnelles ; « décliner »
 * une question (ou tout) reste un profil valide.
 */
export function buildOnboardingAnswers(draft: OnboardingDraft): OnboardingAnswers {
  const budgetAmount = parseAmount(draft.budgetRaw);

  const accounts: Array<{ merchantName: string }> = [];
  for (const name of KNOWN_MERCHANT_NAMES) {
    if (draft.sharedAccounts.includes(name)) accounts.push({ merchantName: name });
  }
  const extra = draft.sharedExtra.trim();
  if (extra.length > 0) accounts.push({ merchantName: extra });

  const shippingKeys = Object.keys(draft.shipping);
  const hasShipping = shippingKeys.some((k) => {
    const v = draft.shipping[k as keyof ShippingProfile];
    return typeof v === 'string' ? (v as string).trim().length > 0 : v !== undefined;
  });

  return {
    preferredLanguage: 'fr',
    budget: budgetAmount ? { maxAmount: budgetAmount, currency: 'EUR' } : null,
    condition: draft.condition ?? null,
    freeShipping: draft.freeShipping ?? 'off',
    origin: draft.origin ?? null,
    excludedMerchants: draft.excluded,
    shipping: hasShipping ? draft.shipping : null,
    merchantAccounts: accounts.length > 0 ? accounts : null,
  };
}

/** Marchands connus proposés pour le partage de compte (pré-remplissage). */
export const KNOWN_MERCHANT_NAMES = ['Amazon', 'Fnac', 'Boulanger', 'Cdiscount', 'Darty'];