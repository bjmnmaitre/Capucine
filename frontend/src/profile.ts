/**
 * CAPUCINE — helpers purs pour les préférences permanentes
 *
 * Séparés de l'écran pour être testables sans React Native. Ne font AUCUN
 * appel réseau : ils préparent seulement ce qui sera envoyé à /profile.
 */

/** Hash déterministe court (djb2). Même entrée ⇒ même sortie. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Identifiant stable et lisible pour une préférence, dérivé de son nom.
 *
 * Le backend clé sur cet id : ré-ajouter « Livraison en France » met à jour
 * l'entrée existante au lieu d'en créer une seconde. Un nom composé
 * uniquement d'accents ou de symboles ne produit aucun slug ascii — on
 * bascule alors sur un hash du nom (toujours non vide, toujours le même pour
 * le même nom), car le backend rejette un id vide.
 */
export function criterionId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : `pref-${djb2(name.trim())}`;
}

// ── Exclusions de marchand (préférence permanente) ──────────────────────────

/**
 * Une exclusion de marchand est un PreferenceCriterion suivant une convention
 * que le backend reconnaît (domain/profile.ts) : id `merchant-exclude-<slug>`,
 * niveau `forbidden`, `parameters.merchantName` = le nom tel que saisi.
 * On la modèle ainsi plutôt qu'avec un nouveau type pour réutiliser la
 * plomberie /profile existante (persistance, PUT/DELETE, GET).
 */
export const MERCHANT_EXCLUSION_ID_PREFIX = 'merchant-exclude-';

export function merchantExclusionId(merchantName: string): string {
  const slug = merchantName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${MERCHANT_EXCLUSION_ID_PREFIX}${slug.length > 0 ? slug : djb2(merchantName.trim())}`;
}

export interface ProfileCriterionLike {
  id: string;
  level?: string;
  parameters?: Record<string, unknown> | null;
}

export function isMerchantExclusion(c: ProfileCriterionLike): boolean {
  return c.level === 'forbidden' && c.id.startsWith(MERCHANT_EXCLUSION_ID_PREFIX);
}

/** Nom lisible du marchand ciblé par une exclusion (parameters d'abord,
 *  sinon le slug de l'id). `null` si le critère n'est pas une exclusion. */
export function merchantNameOf(c: ProfileCriterionLike): string | null {
  if (!isMerchantExclusion(c)) return null;
  const fromParams = c.parameters?.['merchantName'];
  if (typeof fromParams === 'string' && fromParams.trim().length > 0) return fromParams.trim();
  const slug = c.id.slice(MERCHANT_EXCLUSION_ID_PREFIX.length).replace(/-+/g, ' ').trim();
  return slug.length > 0 ? slug : null;
}

/** Le corps à envoyer à PUT /profile/:userId/criterion pour exclure un marchand. */
export function merchantExclusionCriterion(merchantName: string): {
  id: string; name: string; level: 'forbidden'; parameters: { merchantName: string };
} {
  const trimmed = merchantName.trim();
  return {
    id: merchantExclusionId(trimmed),
    name: `Ne pas acheter chez ${trimmed}`,
    level: 'forbidden',
    parameters: { merchantName: trimmed },
  };
}
