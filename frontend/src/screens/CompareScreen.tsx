import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RankedOffer } from '../types';
import {
  bestRankedIndex, compareTakeaway, costLabel, lowestKnownCostIndex,
  priceLabel, shippingValueLabel, stockConfirmedIndexes, stockLabel,
} from '../presentation';
import { displayText, formatMoney, theme, cardStyle, textStyle } from '../theme';

interface Props {
  offers: RankedOffer[];
  onBack: () => void;
  onClear: () => void;
}

/**
 * Comparaison côte à côte de 2 ou 3 offres — basé sur des CARTES, pas un tableau.
 * Chaque offre est une carte verticale, facile à lire sur mobile.
 * L'oeil compare naturellement : coût total, prix, livraison, dispo.
 */

type CompareRow = {
  label: string;
  value: (o: RankedOffer) => string;
  best?: (offers: RankedOffer[]) => number[];
};

function readyIndexes(offers: RankedOffer[]): number[] {
  return offers.reduce<number[]>((acc, o, i) => {
    if (o.readiness?.ready) acc.push(i);
    return acc;
  }, []);
}

function mostReliableIndexes(offers: RankedOffer[]): number[] {
  const known = offers
    .map((o, i) => ({ i, r: o.provenance?.reliability }))
    .filter((x): x is { i: number; r: number } => typeof x.r === 'number' && Number.isFinite(x.r));
  if (known.length === 0) return [];
  const max = Math.max(...known.map((k) => k.r));
  return known.filter((k) => Math.abs(k.r - max) < 0.005).map((k) => k.i);
}

const CERTAINTY_SHORT: Record<string, string> = {
  known: 'connu',
  partially_known: 'partiel',
  unknown: 'inconnu',
};

const ROWS: CompareRow[] = [
  { label: 'Rang', value: (o) => `#${o.rank}` },
  { label: 'Prix produit', value: priceLabel },
  { label: 'Livraison', value: (o) => shippingValueLabel(o) },
  { label: 'Coût total', value: costLabel, best: lowestKnownCostIndex },
  {
    label: "Certitude du coût",
    value: (o) => CERTAINTY_SHORT[o.cost?.certainty] ?? 'inconnu',
  },
  {
    label: "Disponibilité (stock)",
    value: stockLabel,
    best: stockConfirmedIndexes,
  },
  {
    label: "Prêt à l'achat",
    value: (o) =>
      o.readiness?.ready ? 'oui' : o.readiness ? 'à confirmer' : 'inconnu',
    best: readyIndexes,
  },
  {
    label: "Fiabilité source",
    value: (o) =>
      typeof o.provenance?.reliability === 'number'
        ? `${Math.round(o.provenance.reliability * 100)} %`
        : 'inconnue',
    best: mostReliableIndexes,
  },
  {
    label: "Correspondance",
    value: (o) => displayText(o.matchQuality, 'non évaluée'),
  },
  {
    label: "Lien d'achat",
    value: (o) => (o.offerUrl ? 'disponible' : 'non vérifié'),
  },
];

export function CompareScreen({ offers, onBack, onClear }: Props) {
  const topIdx = bestRankedIndex(offers);
  const takeaway = compareTakeaway(offers);

  if (offers.length < 2) {
    return (
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.emptyState} accessible accessibilityLiveRegion="polite">
          <Text style={styles.emptyTitle}>Aucune comparaison en cours</Text>
          <Text style={styles.emptyBody}>
            Depuis vos résultats, touchez « Comparer », choisissez 2 ou 3 offres,
            et elles s'afficheront ici côte à côte.
          </Text>
          {offers.length === 1 && (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Revoir les résultats"
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
              hitSlop={8}
            >
              <Text style={styles.actionButtonText}>Voir les résultats</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Revenir aux résultats"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Text style={styles.backText}>‹ Retour aux résultats</Text>
        </Pressable>
        <Text style={styles.title}>Comparer {offers.length} offres</Text>
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Vider la comparaison"
          hitSlop={8}
        >
          <Text style={styles.clear}>Vider</Text>
        </Pressable>
      </View>

      {/* Takeaway — honest, not promotional */}
      {takeaway ? (
        <View style={styles.takeaway} accessible accessibilityLabel={takeaway}>
          <Text style={styles.takeawayText}>{takeaway}</Text>
        </View>
      ) : null}

      <Text style={styles.note}>
        Valeurs issues du classement de Capucine, non recalculées ici : une donnée
        inconnue reste affichée comme inconnue.
      </Text>

      {/* Offer cards — vertical, side-by-side on wide screens, stacked on mobile */}
      <View style={styles.cardsContainer}>
        {offers.map((offer, i) => (
          <View key={offer.offerId} style={styles.offerCard} accessible accessibilityLabel={`${displayText(offer.merchant?.name, 'Marchand inconnu')}, offre n°${offer.rank}`}>
            {/* Card header — merchant + rank */}
            <View style={styles.offerCardHead}>
              <View style={styles.rankPill}>
                <Text style={styles.rankPillText}>#{offer.rank}</Text>
              </View>
              <Text style={styles.offerMerchant} numberOfLines={2}>
                {displayText(offer.merchant?.name, 'Marchand inconnu')}
              </Text>
              {i === topIdx ? (
                <View style={styles.recommendedBadge}>
                  <Text style={styles.recommendedBadgeText}>★ Recommandée</Text>
                </View>
              ) : null}
            </View>

            {/* Cost total — THE dominant number */}
            <View style={styles.offerCostHero}>
              <Text style={styles.offerCostLabel}>Coût total</Text>
              <Text style={[styles.offerCostValue, offer.cost.certainty !== 'known' && styles.offerCostUnknown]}>
                {offer.cost.certainty === 'unknown' || offer.cost.totalKnown == null ? 'inconnu' : costLabel(offer)}
              </Text>
              <View style={[styles.offerCertaintyBadge, offer.cost.certainty === 'known' ? styles.offerCertaintyKnown : styles.offerCertaintyUnknown]}>
                <Text style={[styles.offerCertaintyText, offer.cost.certainty === 'known' ? styles.offerCertaintyKnownText : styles.offerCertaintyUnknownText]}>
                  {offer.cost.certainty === 'known' ? 'connu' : offer.cost.certainty === 'partially_known' ? 'partiel' : 'inconnu'}
                </Text>
              </View>
            </View>

            {/* Detail rows — clean, no table */}
            <View style={styles.detailRows}>
              {ROWS.map((row) => {
                const bestIdxs = row.best ? row.best(offers) : [];
                const isBest = bestIdxs.includes(i);
                return (
                  <View key={row.label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{row.label}</Text>
                    <Text style={[styles.detailValue, isBest && styles.detailBest]}>
                      {row.value(offer)}
                      {isBest ? (bestIdxs.length > 1 ? ' ≈' : ' ✓') : ''}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Action — open merchant page */}
            <Pressable
              onPress={() => {
                const url = offer.offerUrl;
                if (url && /^https?:\/\//i.test(url)) {
                  Linking.openURL(url).catch(() => {
                    // Fallback: if opening fails, we can't show a toast here easily,
                    // but the error will be logged in dev mode.
                    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
                      console.warn('[Capucine] Failed to open URL:', url);
                    }
                  });
                }
              }}
              disabled={!offer.offerUrl || !/^https?:\/\//i.test(offer.offerUrl || '')}
              accessibilityRole="link"
              accessibilityLabel={`Voir l'offre chez ${displayText(offer.merchant?.name, 'ce marchand')}`}
              style={({ pressed }) => [styles.offerAction, pressed && styles.pressed, (!offer.offerUrl || !/^https?:\/\//i.test(offer.offerUrl || '')) && styles.offerActionDisabled]}
              hitSlop={8}
            >
              <Text style={[styles.offerActionText, (!offer.offerUrl || !/^https?:\/\//i.test(offer.offerUrl || '')) && styles.offerActionTextDisabled]}>
                {offer.offerUrl ? 'Voir chez le marchand' : 'Lien non vérifié'}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      {/* Footer note */}
      <Text style={styles.footerNote}>
        Capucine ne prend jamais le paiement. Vous validez l'achat vous-même chez le marchand.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.space(2),
    paddingTop: theme.space(2),
    paddingBottom: theme.space(6),
  },
  emptyState: {
    paddingVertical: theme.space(6),
    paddingHorizontal: theme.space(3),
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: theme.font.heading,
    fontWeight: '700',
    color: theme.color.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: theme.font.body,
    color: theme.color.textMuted,
    marginTop: theme.space(1),
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 300,
  },
  actionButton: {
    marginTop: theme.space(2.5),
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1),
    backgroundColor: theme.color.accent,
    borderRadius: theme.radii.md,
    ...theme.shadow.subtle,
  },
  actionButtonText: {
    color: theme.color.accentText,
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  pressed: { opacity: theme.opacity.pressed },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space(2),
    paddingHorizontal: theme.space(0.5),
  },
  back: { minHeight: theme.minTouch, justifyContent: 'center' },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text, flex: 1, textAlign: 'center' },
  clear: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.accent },

  takeaway: {
    marginTop: theme.space(1),
    padding: theme.space(2),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.accentSoft,
    borderWidth: 1,
    borderColor: theme.color.accent,
  },
  takeawayText: { fontSize: theme.font.small, color: theme.color.text, lineHeight: 20 },

  note: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(1), marginBottom: theme.space(2), lineHeight: 20,
  },

  cardsContainer: { gap: theme.space(2) },
  offerCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(2),
    ...theme.shadow.card,
  },
  offerCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1.5),
    marginBottom: theme.space(2),
    flexWrap: 'wrap',
  },
  rankPill: {
    minWidth: 36, height: 36, borderRadius: theme.radii.pill,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
  },
  rankPillText: { color: theme.color.accentText, fontSize: theme.font.small, fontWeight: '700' },
  offerMerchant: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text, flex: 1 },
  recommendedBadge: {
    paddingHorizontal: theme.space(1), paddingVertical: 2,
    borderRadius: theme.radii.pill, backgroundColor: theme.color.accentSoft,
  },
  recommendedBadgeText: { fontSize: theme.font.micro, fontWeight: '700', color: theme.color.accent },

  offerCostHero: {
    marginBottom: theme.space(2),
    paddingBottom: theme.space(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  offerCostLabel: { fontSize: theme.font.small, color: theme.color.textMuted, marginBottom: 2 },
  offerCostValue: {
    fontSize: theme.font.display + 2, fontWeight: '700', color: theme.color.text,
    letterSpacing: -0.3,
  },
  offerCostUnknown: { color: theme.color.unknown },
  offerCertaintyBadge: {
    marginTop: theme.space(1), alignSelf: 'flex-start',
    paddingHorizontal: theme.space(1.5), paddingVertical: 4,
    borderRadius: theme.radii.sm,
  },
  offerCertaintyKnown: { backgroundColor: theme.color.knownSoft },
  offerCertaintyUnknown: { backgroundColor: theme.color.unknownSoft },
  offerCertaintyText: { fontSize: theme.font.micro, fontWeight: '700' },
  offerCertaintyKnownText: { color: theme.color.known },
  offerCertaintyUnknownText: { color: theme.color.unknown },

  detailRows: { gap: theme.space(1), marginTop: theme.space(1) },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.space(0.75),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  detailLabel: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600', flexShrink: 1, paddingRight: theme.space(2) },
  detailValue: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
  detailBest: { fontWeight: '700', color: theme.color.known },

  offerAction: {
    marginTop: theme.space(2.5),
    paddingVertical: theme.space(1.25),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadow.subtle,
  },
  offerActionDisabled: { backgroundColor: theme.color.border, opacity: theme.opacity.disabled },
  offerActionText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
  offerActionTextDisabled: { color: theme.color.textFaint },

  footerNote: {
    marginTop: theme.space(3),
    fontSize: theme.font.micro,
    color: theme.color.textFaint,
    textAlign: 'center',
    lineHeight: 16,
  },
});