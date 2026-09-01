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
