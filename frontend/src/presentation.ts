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
import type { RankedOffer, RankingPreferenceState, SearchResponse } from './types';

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

/**
 * Ce que l'écran dit de l'ordre courant de la liste.
 *
 * `null` quand il n'y a rien d'utile à afficher : ordre par défaut
 * (BEST_MATCH), ou préférence comprise mais SANS effet réel (`applied: false`
 * pour BEST_VALUE / FASTEST_DELIVERY / BEST_RATED). Ne jamais prétendre que
 * la liste est triée d'une façon dont elle ne l'est pas.
 */
const RANKING_PREFERENCE_LABEL: Record<string, string> = {
  PRICE_LOWEST: 'Trié par coût total le plus bas',
  BEST_VALUE: 'Meilleur rapport qualité-prix demandé',
  FASTEST_DELIVERY: 'Livraison la plus rapide demandée',
  BEST_RATED: 'Mieux notés demandés',
};

export function rankingPreferenceLabel(
  state: RankingPreferenceState | null | undefined
): string | null {
  if (!state || state.preference === 'BEST_MATCH') return null;
  if (!state.applied) return null;
  return RANKING_PREFERENCE_LABEL[state.preference] ?? null;
}

/**
 * Ce que l'écran dit de la préférence « privilégier la disponibilité
 * immédiate », quand elle est active. `null` sinon — rien à afficher. Le texte
 * reste honnête : le bonus ne s'applique QU'aux offres dont le stock/la
 * livraison sont confirmés, et ne renverse jamais une bien meilleure
 * correspondance.
 */
export function availabilityEmphasisLabel(
  active: boolean | null | undefined
): string | null {
  return active
    ? 'Disponibilité immédiate privilégiée — à correspondance proche, une offre en stock confirmé passe devant.'
    : null;
}

/**
 * Ce que l'écran dit de l'usage compris. `null` si rien d'exploitable, ou si
 * le backend n'a pas fourni de phrase toute faite (on n'en recompose jamais
 * une à partir des codes). Le préfixe dépend de la SOURCE : « Vous avez
 * indiqué » seulement quand l'utilisateur l'a réellement dit — sinon
 * « Capucine a supposé », qui n'engage pas l'utilisateur.
 */
export function usageContextLabel(
  uc: SearchResponse['usageContext'] | null | undefined
): string | null {
  const summary = uc?.summary?.trim();
  if (!summary) return null;
  const prefix = uc?.source === 'user'
    ? 'Vous avez indiqué un usage'
    : uc?.source === 'profile'
      ? 'D’après vos préférences, usage'
      : 'Capucine a supposé un usage';
  return `${prefix} : ${summary}.`;
}

/**
 * Ce que chaque statut de POST /prepare-cart veut RÉELLEMENT dire — aligné
 * sur backend/cart-preparation-engine.ts, qui distingue soigneusement « page
 * remise » de « panier créé ». Un web redirect ne crée PAS de panier chez le
 * marchand : dire « panier préparé » sur un `partial` surévaluerait l'action.
 */
const PREP_STATUS_LABEL: Record<string, string> = {
  success: 'Panier préparé chez le marchand',
  partial: 'Page du marchand prête',
  unavailable: 'Achat non préparable',
  failed: 'La préparation a échoué',
};

export function prepStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Statut inconnu';
  return PREP_STATUS_LABEL[status] ?? `Statut : ${status}`;
}

/** Message d'état de la liste de résultats. */
export function resultsSummary(count: number, merchants: number): string {
  if (count === 0) return 'Aucune offre trouvée';
  const o = count > 1 ? 'offres' : 'offre';
  const m = merchants > 1 ? 'marchands' : 'marchand';
  return `${count} ${o} · ${merchants} ${m}`;
}

/**
 * Index(es) de l'offre — ou des offres EX ÆQUO — au coût total connu le plus
 * bas parmi celles fournies. Tableau vide quand la comparaison ne peut pas
 * être faite honnêtement : une offre a un coût inconnu, ou les devises
 * diffèrent. Peut renvoyer PLUSIEURS index (deux offres au même coût exact)
 * — jamais un seul gagnant arbitraire là où les données n'en désignent pas.
 * Sert à mettre en gras la ou les cellules gagnantes en comparaison, jamais
 * à reclasser.
 */
export function lowestKnownCostIndex(
  offers: Array<Pick<RankedOffer, 'cost'>>
): number[] {
  if (offers.length === 0) return [];
  const costs = offers.map((o) =>
    o.cost && o.cost.certainty !== 'unknown'
      && typeof o.cost.totalKnown === 'number' && Number.isFinite(o.cost.totalKnown)
      ? { amount: o.cost.totalKnown, currency: o.cost.currency || 'EUR' }
      : null
  );
  if (costs.some((c) => c === null)) return [];
  const known = costs as Array<{ amount: number; currency: string }>;
  if (new Set(known.map((c) => c.currency)).size > 1) return [];
  const min = Math.min(...known.map((c) => c.amount));
  // Tolérance d'un centime : deux montants extraits de pages différentes qui
  // s'écrivent tous deux "205,61 €" ne doivent pas diverger sur un résidu
  // flottant et priver l'un des deux de son égalité méritée.
  return known.reduce<number[]>((acc, c, i) => {
    if (Math.abs(c.amount - min) < 0.005) acc.push(i);
    return acc;
  }, []);
}

/** Index de l'offre la mieux classée (rang le plus petit) parmi celles
 *  fournies. `-1` si la liste est vide. */
export function bestRankedIndex(offers: Array<Pick<RankedOffer, 'rank'>>): number {
  if (offers.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < offers.length; i++) {
    if (offers[i].rank < offers[best].rank) best = i;
  }
  return best;
}

/**
 * Une phrase de synthèse pour l'écran de comparaison, construite uniquement
 * à partir de faits vérifiables : quelle offre Capucine classe en tête, et si
 * elle est AUSSI la moins chère (coût connu) ou seulement mieux classée
 * malgré un coût supérieur — le cas « moins cher ≠ meilleur choix ». Jamais
 * d'affirmation que les données ne soutiennent pas.
 */
export function compareTakeaway(
  offers: Array<Pick<RankedOffer, 'rank' | 'merchant' | 'cost'>>
): string | null {
  if (offers.length < 2) return null;
  const topIdx = bestRankedIndex(offers);
  if (topIdx < 0) return null;
  const top = offers[topIdx];
  const name = merchantLabel(top);
  const cheapestIdxs = lowestKnownCostIndex(offers);

  if (cheapestIdxs.length === 0) {
    return `Capucine classe ${name} en tête. Les coûts totaux ne sont pas tous connus : comparez les composantes affichées.`;
  }
  if (cheapestIdxs.length > 1 && cheapestIdxs.includes(topIdx)) {
    return `Capucine classe ${name} en tête : elle est à égalité du coût total connu le plus bas avec une autre offre comparée.`;
  }
  if (cheapestIdxs.includes(topIdx)) {
    return `Capucine classe ${name} en tête : c'est aussi le coût total connu le plus bas.`;
  }
  return `Capucine classe ${name} en tête bien qu'elle ne soit pas la moins chère — regardez la ligne « pourquoi » de chaque offre pour la raison.`;
}

// ============================================================================
// EXPLICATION DU CLASSEMENT — pourquoi cette offre est là où elle est
// ============================================================================

/**
 * Ce que le backend nous donne déjà pour une offre : sa position, son coût,
 * l'état de préparation d'achat, la qualité de correspondance. Aucune de ces
 * données n'est recalculée ici — on les MET EN RELATION avec les autres
 * offres AFFICHÉES pour produire des phrases factuelles.
 */
type ExplainableOffer = Pick<
  RankedOffer,
  'rank' | 'merchant' | 'price' | 'shipping' | 'cost' | 'matchQuality'
  | 'rankingReasonCode' | 'readiness' | 'score' | 'offerId'
>;

const READINESS_PENDING_LABEL: Record<string, string> = {
  verified: 'prix à vérifier sur la page marchand',
  purchasable: 'lien d’achat à confirmer',
  inStock: 'disponibilité en stock non confirmée',
  deliverable: 'livraison vers la France à confirmer',
};

const MATCH_QUALITY_NOTE: Record<string, string> = {
  'Correspondance exacte': 'Correspond exactement au produit demandé.',
  'Très bonne correspondance': 'Très proche du produit demandé.',
  'Correspondance partielle': 'Ne correspond que partiellement à la demande.',
  'Alternative': 'Proposé comme alternative au produit demandé.',
};

/** Coût comparable : montant connu, devise identique, certitude non nulle. */
function comparableCost(
  offer: ExplainableOffer
): { amount: number; currency: string } | null {
  const c = offer.cost;
  if (!c || c.certainty === 'unknown' || c.totalKnown === null || c.totalKnown === undefined) {
    return null;
  }
  if (!Number.isFinite(c.totalKnown)) return null;
  return { amount: c.totalKnown, currency: c.currency || 'EUR' };
}

/**
 * Phrases expliquant la position d'une offre, la plus décisive en tête.
 * Vide n'arrive jamais : au minimum la position est rendue.
 *
 * `others` = TOUTES les offres actuellement affichées (celle-ci incluse ou
 * non, peu importe) ; sert uniquement à situer le coût.
 */
export function explainOfferRanking(
  offer: ExplainableOffer,
  others: ExplainableOffer[],
  ranking?: RankingPreferenceState | null
): string[] {
  const points: string[] = [];
  const self = comparableCost(offer);

  // ── 1. Pourquoi cette position ──────────────────────────────────────────
  const orderedByLowestCost = ranking?.applied && ranking.preference === 'PRICE_LOWEST';
  // Un ex æquo (même score de correspondance qu'une autre offre) ne doit pas
  // être présenté comme « la meilleure » : le rang n'est alors qu'un
  // départage. On ne le dit que si un rival A un score comparable ET connu.
  const rivalScores = others
    .filter((o) => (o.offerId ? o.offerId !== offer.offerId : o !== offer))
    .map((o) => o.score)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  const tiedTop = typeof offer.score === 'number'
    && rivalScores.some((s) => Math.abs(s - offer.score!) < 1);

  if (offer.rank === 1) {
    if (orderedByLowestCost) {
      points.push(
        offer.rankingReasonCode === 'RANKED_LOWEST_KNOWN_COST'
          ? 'Recommandée : coût total connu le plus bas des offres comparées.'
          : 'Recommandée : coût le plus bas parmi les composantes connues — certains frais restent inconnus et pourraient changer ce classement.'
      );
    } else if (tiedTop) {
      points.push('En tête, à égalité de correspondance avec l’offre suivante — comparez le coût et la disponibilité pour départager.');
    } else {
      points.push('Recommandée : meilleure correspondance avec votre recherche.');
    }
  } else {
    points.push(
      orderedByLowestCost
        ? `Classée #${offer.rank} par coût total croissant.`
        : `Classée #${offer.rank} par correspondance avec votre recherche.`
    );
  }

  // ── 2. Situer le coût par rapport aux autres offres affichées ────────────
  if (!offer.price) {
    points.push('Prix non communiqué : le coût total ne peut pas être comparé.');
  } else if (self) {
    const rivals = others
      .map(comparableCost)
      .filter((c): c is { amount: number; currency: string } => c !== null && c.currency === self.currency);
    const cheapest = rivals.length > 0 ? Math.min(...rivals.map((c) => c.amount)) : self.amount;
    const isCheapest = self.amount <= cheapest + 0.005;
    const certain = offer.cost.certainty === 'known';

    if (isCheapest && certain) {
      points.push(`Coût total le plus bas : ${formatMoney(self.amount, self.currency)}.`);
    } else if (isCheapest) {
      points.push(
        `Coût le plus bas parmi ce qui est connu (${formatMoney(self.amount, self.currency)}) ; `
        + `composantes inconnues : ${offer.cost.unknownComponents.join(', ') || '—'}.`
      );
    } else {
      const delta = self.amount - cheapest;
      points.push(
        `${formatMoney(delta, self.currency)} de plus que l’offre la moins chère`
        + (certain ? '.' : ' (hors composantes de coût encore inconnues).')
      );
    }
  }

  // ── 3. Livraison — jamais « offerte » quand elle est inconnue ────────────
  const shipping = shippingValueLabel(offer);
  if (shipping === 'offerte') points.push('Livraison offerte.');
  else if (shipping === 'inconnue') points.push('Coût de livraison non communiqué.');
  else if (shipping === 'information contradictoire') points.push('Coût de livraison : les sources ne concordent pas.');
  else points.push(`Livraison ${shipping}.`);

  // ── 4. Prêt à l'achat ? ─────────────────────────────────────────────────
  const readiness = offer.readiness;
  if (readiness?.ready) {
    points.push('Achat prêt : prix vérifié, stock et lien d’achat confirmés.');
  } else if (readiness) {
    const pending = (readiness.pending ?? []).map((p) => READINESS_PENDING_LABEL[p] ?? p);
    const blocked = (readiness.blocked ?? []).map((p) => READINESS_PENDING_LABEL[p] ?? p);
    if (blocked.length > 0) points.push(`Bloquant avant achat : ${blocked.join(', ')}.`);
    else if (pending.length > 0) points.push(`À confirmer avant d’acheter : ${pending.join(', ')}.`);
  }

  // ── 5. Qualité de correspondance ────────────────────────────────────────
  const note = offer.matchQuality ? MATCH_QUALITY_NOTE[offer.matchQuality] : null;
  if (note) points.push(note);

  return points;
}
