/**
 * CAPUCINE — règles de présentation pures
 *
 * Extraites des écrans pour être testables sans monter React Native. Ce sont
 * elles qui décident du TEXTE que l'utilisateur lit face à une donnée absente,
 * partielle ou contradictoire — l'endroit exact où une inconnue pourrait se
 * transformer en affirmation.
 *
 * Le frontend ne décide de rien d'autre : les valeurs, les statuts et le
 * classement viennent du backend et ne sont jamais recalculés ici.
 */
import { displayText, formatMoney } from './theme';
import type { RankedOffer } from './types';

/** Libellé de livraison. « inconnue » et « offerte » ne se confondent jamais. */
/**
 * Valeur seule, pour un tableau déjà intitulé « Livraison ».
 *
 * L'écran de détail en portait une COPIE, qui avait divergé : elle ne traitait
 * pas la contradiction et affichait donc un montant disputé comme un fait.
 * Deux implémentations d'une même règle d'honnêteté finissent toujours par
 * diverger — il n'y en a plus qu'une.
 */
export function shippingValueLabel(offer: Pick<RankedOffer, 'shipping'>): string {
  const s = offer.shipping;
  if (!s) return 'inconnue';
  // La contradiction est testée AVANT l'absence de montant : elle en a un
  // aussi, mais dire « inconnue » perdrait l'information la plus utile —
  // que les sources annoncent deux tarifs différents.
  if (s.status === 'contradictory') return 'information contradictoire';
  if (s.status === 'unknown' || s.amount === null) return 'inconnue';
  if (s.amount === 0) return 'offerte';
  return formatMoney(s.amount, s.currency);
}

/** Phrase complète, pour une lecture continue (résumé, accessibilité). */
export function shippingLabel(offer: Pick<RankedOffer, 'shipping'>): string {
  const value = shippingValueLabel(offer);
  return value === 'information contradictoire'
    ? 'livraison : information contradictoire'
    : `livraison ${value}`;
}

/** Le tarif de livraison est-il une donnée établie ? */
export function isShippingKnown(offer: Pick<RankedOffer, 'shipping'>): boolean {
  const s = offer.shipping;
  if (!s || s.amount === null) return false;
  return s.status === 'known' || s.status === 'verified';
}

/** Libellé du coût. Un total partiel est toujours préfixé « au moins ». */
export function costLabel(offer: Pick<RankedOffer, 'cost'>): string {
  const c = offer.cost;
  if (!c) return 'coût inconnu';
  if (c.certainty === 'unknown' || c.totalKnown === null) return 'coût inconnu';
  const amount = formatMoney(c.totalKnown, c.currency);
  return c.certainty === 'known' ? amount : `au moins ${amount}`;
}

export function priceLabel(offer: Pick<RankedOffer, 'price'>): string {
  return offer.price ? formatMoney(offer.price.amount, offer.price.currency) : 'prix inconnu';
}

export function merchantLabel(offer: Pick<RankedOffer, 'merchant'>): string {
  return displayText(offer.merchant?.name, 'Marchand inconnu');
}

/** Ce que l'écran dit du lien d'achat. Aucune URL n'est jamais construite. */
export function offerUrlLabel(offer: Pick<RankedOffer, 'offerUrl'>): string | null {
  const url = offer.offerUrl;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  return url;
}

/** Une phrase parlée complète par offre, pour les lecteurs d'écran. */
export function offerAccessibilityLabel(
  offer: Pick<RankedOffer, 'rank' | 'merchant' | 'price' | 'shipping' | 'cost'>
): string {
  return `Offre numéro ${offer.rank}. ${merchantLabel(offer)}. `
    + `Prix ${priceLabel(offer)}, ${shippingLabel(offer)}. ${costLabel(offer)}.`;
}

/** Message d'état de la liste de résultats. */
export function resultsSummary(count: number, merchants: number): string {
  if (count === 0) return 'Aucune offre trouvée';
  const o = count > 1 ? 'offres' : 'offre';
  const m = merchants > 1 ? 'marchands' : 'marchand';
  return `${count} ${o} · ${merchants} ${m}`;
}
