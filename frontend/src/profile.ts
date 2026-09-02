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

/**
 * Corps d'une préférence en TEXTE LIBRE pour PUT /profile/:userId/criterion.
 *
 * `unknownPolicy: 'pass'` est délibéré : une formulation libre est un indice
 * « au mieux », pas une spec strictement vérifiable. Sans ce drapeau, une
 * préférence libre marquée « obligatoire » deviendrait une barrière
 * d'admissibilité — et comme presque aucune offre ne publie la donnée
 * correspondante, chaque recherche renverrait ZÉRO résultat (UNKNOWN traité
 * comme BAD, l'invariant que Capucine refuse). Avec `'pass'`, une donnée
 * inconnue laisse l'offre passer ; une donnée qui CONTREDIT la préférence la
 * disqualifie toujours. C'est exactement le comportement décrit à l'écran
 * (« Capucine les applique quand elle sait relier votre formulation à un
 * critère — sinon elle les conserve sans pouvoir les appliquer »), et le même
 * correctif que celui déjà appliqué aux specs techniques extraites de la
 * requête (backend : spec-criteria-unknown-policy).
 */
export function freeTextPreferenceCriterion<L extends string>(
  name: string,
  level: L
): { id: string; name: string; level: L; parameters: { unknownPolicy: 'pass' } } {
  const trimmed = name.trim();
  return {
    id: criterionId(trimmed),
    name: trimmed,
    level,
    parameters: { unknownPolicy: 'pass' },
  };
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

// ── Préférence de tri permanente ───────────────────────────────────────────

/** Un seul critère porte la préférence de tri permanente (le ré-ajouter la
 *  remplace). Convention reconnue par le backend (domain/profile.ts). */
export const RANKING_PREFERENCE_CRITERION_ID = 'ranking-preference';

export function rankingPreferenceOf(
  criteria: ProfileCriterionLike[]
): string | null {
  const c = criteria.find((x) => x.id === RANKING_PREFERENCE_CRITERION_ID);
  const value = c?.parameters?.['rankingPreference'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function rankingPreferenceCriterion(pref: string): {
  id: string; name: string; level: 'preference'; parameters: { rankingPreference: string };
} {
  const label = pref === 'PRICE_LOWEST'
    ? 'Toujours trier par coût total le plus bas'
    : `Ordre par défaut : ${pref}`;
  return {
    id: RANKING_PREFERENCE_CRITERION_ID,
    name: label,
    level: 'preference',
    parameters: { rankingPreference: pref },
  };
}

// ── Préférence « privilégier la disponibilité immédiate » ───────────────────

/**
 * Axe INDÉPENDANT de la préférence de tri (les deux se composent : on peut
 * vouloir « le moins cher » ET « ce qui est en stock »). Un seul critère porte
 * le choix ; sa présence avec `prioritizeAvailability === true` est
 * l'interrupteur. Convention reconnue par le backend (domain/profile.ts) :
 * elle relève le plafond du bonus de disponibilité au classement, sans jamais
 * pénaliser une disponibilité inconnue ni renverser une bien meilleure
 * correspondance.
 */
export const AVAILABILITY_PREFERENCE_CRITERION_ID = 'availability-preference';

export function availabilityPreferenceOf(criteria: ProfileCriterionLike[]): boolean {
  const c = criteria.find((x) => x.id === AVAILABILITY_PREFERENCE_CRITERION_ID);
  return c?.parameters?.['prioritizeAvailability'] === true;
}

export function availabilityPreferenceCriterion(): {
  id: string; name: string; level: 'preference'; parameters: { prioritizeAvailability: true };
} {
  return {
    id: AVAILABILITY_PREFERENCE_CRITERION_ID,
    name: 'Privilégier la disponibilité immédiate',
    level: 'preference',
    parameters: { prioritizeAvailability: true },
  };
}
