import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { RankedOffer, SearchResponse } from '../types';
import { CERTAINTY_LABEL, displayText, formatMoney, theme } from '../theme';

interface Props {
  query: string;
  response: SearchResponse;
  onSelect: (offer: RankedOffer) => void;
  onBack: () => void;
}

/** An unknown delivery cost is not a free delivery: the two never collapse. */
function shippingLabel(offer: RankedOffer): string {
  const s = offer.shipping;
  if (!s || s.status === 'unknown' || s.amount === null) return 'livraison inconnue';
  if (s.amount === 0) return 'livraison offerte';
  return `livraison ${formatMoney(s.amount, s.currency)}`;
}

function certaintyStyle(certainty: string) {
  return certainty === 'known' ? styles.badgeKnown : styles.badgeUnknown;
}

function OfferRow({ offer, onPress }: { offer: RankedOffer; onPress: () => void }) {
  // `price` is null when the backend could not extract one. 'prix inconnu'
  // is the honest rendering — never 0, never a dash standing in for a number.
  const price = offer.price ? formatMoney(offer.price.amount, offer.price.currency) : 'prix inconnu';
  const isTotal = offer.cost.certainty === 'known';
  const totalLabel = isTotal
    ? formatMoney(offer.cost.totalKnown, offer.cost.currency)
    : `au moins ${formatMoney(offer.cost.totalKnown, offer.cost.currency)}`;

  // One spoken sentence per offer: rank, merchant, price, and how sure the
  // total is. A screen-reader user should not have to explore the card.
  const shipping = shippingLabel(offer);
  const a11yLabel =
    `Offre numéro ${offer.rank}. ${displayText(offer.merchant?.name, 'Marchand inconnu')}. ` +
    `Prix ${price}, ${shipping}. ` +
    `${CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}, ${totalLabel}.`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Ouvre le détail de cette offre"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.rank}>#{offer.rank}</Text>
        <Text style={styles.merchant} numberOfLines={1}>
          {displayText(offer.merchant?.name, 'Marchand inconnu')}
        </Text>
      </View>

      <Text style={styles.price}>{price}</Text>
      <Text style={styles.shipping}>{shipping}</Text>

      <View style={[styles.badge, certaintyStyle(offer.cost.certainty)]}>
        <Text style={[styles.badgeText, certaintyStyle(offer.cost.certainty)]}>
          {CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty} · {totalLabel}
        </Text>
      </View>

      {offer.cost.unknownComponents.length > 0 ? (
        <Text style={styles.unknownList}>
          Non connu : {offer.cost.unknownComponents.join(', ')} — non estimé, non ignoré.
        </Text>
      ) : null}

      {offer.explanation ? (
        <Text style={styles.explanation} numberOfLines={2}>{offer.explanation}</Text>
      ) : null}
    </Pressable>
  );
}

export function ResultsScreen({ query, response, onSelect, onBack }: Props) {
  const results = response.results ?? [];
  const productIds = new Set(results.map((r) => r.productId));
  const merchantIds = new Set(results.map((r) => r.merchant.id));

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Revenir à la recherche"
          style={({ pressed }) => [styles.back, pressed && styles.cardPressed]}
        >
          <Text style={styles.backText}>‹ Recherche</Text>
        </Pressable>
        <Text style={styles.query} numberOfLines={2} accessibilityRole="header">{query}</Text>
        <Text style={styles.counts}>
          {results.length} offre{results.length > 1 ? 's' : ''} · {merchantIds.size} marchand
          {merchantIds.size > 1 ? 's' : ''} · {productIds.size} produit
          {productIds.size > 1 ? 's' : ''}
        </Text>
        {response.summary?.resultSummary ? (
          <Text style={styles.summary}>{response.summary.resultSummary}</Text>
        ) : null}
      </View>

      {results.length === 0 ? (
        <View style={styles.empty} accessibilityLiveRegion="polite">
          <Text style={styles.emptyTitle}>Aucune offre trouvée</Text>
          <Text style={styles.emptyBody}>
            {response.noResultsDiagnosis?.message ??
              "Capucine n’a trouvé aucune offre correspondant à cette demande."}
          </Text>
          {/*
            Ce que l'utilisateur peut faire pour élargir. Chaque option demande
            sa confirmation : Capucine ne relâche jamais un critère toute seule.
          */}
          {(response.noResultsDiagnosis?.recoveryOptions ?? []).map((option) => (
            <View key={option.id} style={styles.recovery}>
              <Text style={styles.recoveryText}>{option.description}</Text>
              {option.impact ? <Text style={styles.recoveryImpact}>{option.impact}</Text> : null}
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.offerId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <OfferRow offer={item} onPress={() => onSelect(item)} />}
          ListFooterComponent={
            <Text style={styles.footer}>
              Classement produit par le moteur de priorité de Capucine, pas par le prix seul.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    padding: theme.space(2), backgroundColor: theme.color.surface,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  back: { minHeight: theme.minTouch, justifyContent: 'center' },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  query: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text },
  counts: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5) },
  summary: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5) },
  list: { padding: theme.space(2), paddingBottom: theme.space(5) },
  card: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(2), marginBottom: theme.space(1.5),
    minHeight: theme.minTouch,
  },
  cardPressed: { opacity: 0.75 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1) },
  rank: {
    fontSize: theme.font.small, fontWeight: '700', color: theme.color.accentText,
    backgroundColor: theme.color.accent, paddingHorizontal: theme.space(1),
    paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  merchant: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text, flexShrink: 1 },
  price: {
    fontSize: theme.font.title, fontWeight: '700',
    color: theme.color.text, marginTop: theme.space(1),
  },
  badge: {
    marginTop: theme.space(1), alignSelf: 'flex-start',
    paddingHorizontal: theme.space(1), paddingVertical: 4, borderRadius: 6,
  },
  badgeText: { fontSize: theme.font.small, fontWeight: '600', backgroundColor: 'transparent' },
  badgeKnown: { color: theme.color.known, backgroundColor: '#E7F4EC' },
  badgeUnknown: { color: theme.color.unknown, backgroundColor: '#FBF1DC' },
  shipping: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  unknownList: {
    fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5),
  },
  explanation: { fontSize: theme.font.small, color: theme.color.text, marginTop: theme.space(1) },
  recovery: { marginTop: theme.space(1.5), paddingLeft: theme.space(1.5), borderLeftWidth: 3, borderLeftColor: theme.color.accent },
  recoveryText: { fontSize: theme.font.body, color: theme.color.text },
  recoveryImpact: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  empty: { padding: theme.space(3) },
  emptyTitle: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text },
  emptyBody: {
    fontSize: theme.font.body, color: theme.color.textMuted,
    marginTop: theme.space(1), lineHeight: 22,
  },
  footer: {
    fontSize: 12, color: theme.color.textMuted,
    textAlign: 'center', marginTop: theme.space(1),
  },
});
