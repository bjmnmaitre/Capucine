import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RankedOffer } from '../types';
import {
  costLabel, lowestKnownCostIndex, priceLabel, shippingValueLabel,
} from '../presentation';
import { CERTAINTY_LABEL, displayText, theme } from '../theme';

interface Props {
  offers: RankedOffer[];
  onBack: () => void;
}

/**
 * Comparaison côte à côte de 2 ou 3 offres déjà classées.
 *
 * N'introduit AUCUN calcul : chaque ligne réutilise les mêmes règles de
 * présentation que les autres écrans (coût inconnu reste inconnu, livraison
 * inconnue n'est jamais « offerte »). La seule chose calculée ici est
 * cosmétique : quelle cellule d'une ligne est la plus avantageuse, pour la
 * mettre en gras — et uniquement quand la comparaison est licite (même
 * devise, valeurs connues).
 */

type RowSpec = {
  label: string;
  value: (o: RankedOffer) => string;
  /** index de l'offre la plus avantageuse sur cette ligne, ou null si on ne
   *  peut pas trancher honnêtement. */
  best?: (offers: RankedOffer[]) => number | null;
};

const ROWS: RowSpec[] = [
  { label: 'Rang', value: (o) => `#${o.rank}` },
  { label: 'Prix produit', value: priceLabel },
  { label: 'Livraison', value: (o) => shippingValueLabel(o) },
  { label: 'Coût total', value: costLabel, best: lowestKnownCostIndex },
  {
    label: 'Certitude du coût',
    value: (o) => CERTAINTY_LABEL[o.cost?.certainty] ?? o.cost?.certainty ?? 'inconnue',
  },
  {
    label: 'Prêt à l’achat',
    value: (o) =>
      o.readiness?.ready ? 'oui' : o.readiness ? 'à confirmer' : 'inconnu',
    best: (offers) => {
      const idx = offers.findIndex((o) => o.readiness?.ready);
      return offers.filter((o) => o.readiness?.ready).length === 1 ? idx : null;
    },
  },
  {
    label: 'Correspondance',
    value: (o) => displayText(o.matchQuality, 'non évaluée'),
  },
  {
    label: 'Lien d’achat',
    value: (o) => (o.offerUrl ? 'disponible' : 'non vérifié'),
  },
];

export function CompareScreen({ offers, onBack }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Revenir aux résultats"
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
      >
        <Text style={styles.backText}>‹ Résultats</Text>
      </Pressable>

      <Text style={styles.title} accessibilityRole="header">
        Comparer {offers.length} offres
      </Text>
      <Text style={styles.note}>
        Les valeurs viennent du classement de Capucine ; rien n’est recalculé ici.
        Une donnée inconnue reste affichée comme inconnue.
      </Text>

      <View style={styles.grid}>
        {/* En-tête : marchands */}
        <View style={styles.headRow}>
          <View style={styles.labelCell}><Text style={styles.labelText} /></View>
          {offers.map((o) => (
            <View key={o.offerId} style={styles.headCell}>
              <Text style={styles.merchant} numberOfLines={2}>
                {displayText(o.merchant?.name, 'Marchand inconnu')}
              </Text>
            </View>
          ))}
        </View>

        {ROWS.map((row) => {
          const bestIdx = row.best ? row.best(offers) : null;
          const spoken = `${row.label} : ` + offers
            .map((o, i) => `${displayText(o.merchant?.name, 'offre ' + (i + 1))} ${row.value(o)}`)
            .join(' ; ');
          return (
            <View
              key={row.label}
              style={styles.row}
              accessible
              accessibilityLabel={spoken}
            >
              <View style={styles.labelCell}>
                <Text style={styles.labelText}>{row.label}</Text>
              </View>
              {offers.map((o, i) => (
                <View key={o.offerId} style={styles.cell}>
                  <Text style={[styles.cellText, bestIdx === i && styles.cellBest]}>
                    {row.value(o)}
                    {bestIdx === i ? '  ✓' : ''}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.space(2), paddingBottom: theme.space(6) },
  back: { minHeight: theme.minTouch, justifyContent: 'center' },
  backPressed: { opacity: 0.7 },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text },
  note: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(0.5), marginBottom: theme.space(2), lineHeight: 20,
  },
  grid: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius,
    overflow: 'hidden', backgroundColor: theme.color.surface,
  },
  headRow: { flexDirection: 'row', backgroundColor: theme.color.background },
  headCell: {
    flex: 1, padding: theme.space(1), borderLeftWidth: 1, borderLeftColor: theme.color.border,
  },
  merchant: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.text },
  row: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.color.border },
  labelCell: {
    width: 116, padding: theme.space(1), backgroundColor: theme.color.background,
    justifyContent: 'center',
  },
  labelText: { fontSize: theme.font.small, color: theme.color.textMuted, fontWeight: '600' },
  cell: {
    flex: 1, padding: theme.space(1),
    borderLeftWidth: 1, borderLeftColor: theme.color.border, justifyContent: 'center',
  },
  cellText: { fontSize: theme.font.small, color: theme.color.text, lineHeight: 18 },
  cellBest: { fontWeight: '700', color: theme.color.known },
});
