import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RankedOffer } from '../types';
import {
  bestRankedIndex, compareTakeaway, costLabel, lowestKnownCostIndex,
  priceLabel, shippingValueLabel,
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
  /** index(es) de la ou des offres les plus avantageuses sur cette ligne —
   *  PLUSIEURS en cas d'égalité réelle, [] si on ne peut pas trancher
   *  honnêtement. Jamais un gagnant unique choisi arbitrairement. */
  best?: (offers: RankedOffer[]) => number[];
};

/** Toutes les offres dont `readiness.ready` est vrai — égalité assumée
 *  plutôt qu'un seul gagnant arbitraire quand plusieurs le sont. */
function readyIndexes(offers: RankedOffer[]): number[] {
  return offers.reduce<number[]>((acc, o, i) => {
    if (o.readiness?.ready) acc.push(i);
    return acc;
  }, []);
}

/** Fiabilité de la source (0–1) telle que rapportée par le backend —
 *  jamais estimée ici. La ou les offres à la fiabilité connue la plus
 *  haute gagnent la ligne ; une fiabilité inconnue ne gagne jamais. */
function mostReliableIndexes(offers: RankedOffer[]): number[] {
  const known = offers
    .map((o, i) => ({ i, r: o.provenance?.reliability }))
    .filter((x): x is { i: number; r: number } => typeof x.r === 'number' && Number.isFinite(x.r));
  if (known.length === 0) return [];
  const max = Math.max(...known.map((k) => k.r));
  return known.filter((k) => Math.abs(k.r - max) < 0.005).map((k) => k.i);
}

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
    best: readyIndexes,
  },
  {
    label: 'Fiabilité de la source',
    value: (o) =>
      typeof o.provenance?.reliability === 'number'
        ? `${Math.round(o.provenance.reliability * 100)} %`
        : 'inconnue',
    best: mostReliableIndexes,
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
  const topIdx = bestRankedIndex(offers);
  const takeaway = compareTakeaway(offers);

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

      {takeaway ? (
        <View style={styles.takeaway} accessible accessibilityLabel={takeaway}>
          <Text style={styles.takeawayText}>{takeaway}</Text>
        </View>
      ) : null}

      <Text style={styles.note}>
        Les valeurs viennent du classement de Capucine ; rien n’est recalculé ici.
        Une donnée inconnue reste affichée comme inconnue.
      </Text>

      <View style={styles.grid}>
        {/* En-tête : marchands. Lu comme une seule annonce ; les lignes qui
            suivent répètent chaque nom de marchand, donc on ne le détaille
            pas cellule par cellule ici. */}
        <View
          style={styles.headRow}
          accessible
          accessibilityRole="header"
          accessibilityLabel={
            `Offres comparées : ${offers.map((o, i) =>
              displayText(o.merchant?.name, 'marchand inconnu') + (i === topIdx ? ', recommandée par Capucine' : '')
            ).join(', ')}`
          }
        >
          <View style={styles.labelCell} />
          {offers.map((o, i) => (
            <View key={o.offerId} style={styles.headCell}>
              <Text style={styles.merchant} numberOfLines={2}>
                {displayText(o.merchant?.name, 'Marchand inconnu')}
              </Text>
              {i === topIdx ? <Text style={styles.headBadge}>★ Recommandée</Text> : null}
            </View>
          ))}
        </View>

        {ROWS.map((row) => {
          const bestIdxs = row.best ? row.best(offers) : [];
          const tied = bestIdxs.length > 1;
          const spoken = `${row.label} : ` + offers
            .map((o, i) =>
              `${displayText(o.merchant?.name, 'offre ' + (i + 1))} ${row.value(o)}`
              + (bestIdxs.includes(i) ? (tied ? ', à égalité' : ', meilleure valeur') : '')
            )
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
                  <Text style={[styles.cellText, bestIdxs.includes(i) && styles.cellBest]}>
                    {row.value(o)}
                    {bestIdxs.includes(i) ? (tied ? '  ≈' : '  ✓') : ''}
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
  takeaway: {
    marginTop: theme.space(1), padding: theme.space(1.5), borderRadius: theme.radius,
    backgroundColor: '#F4F7FF', borderWidth: 1, borderColor: theme.color.accent,
  },
  takeawayText: { fontSize: theme.font.small, color: theme.color.text, lineHeight: 20 },
  note: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(1), marginBottom: theme.space(2), lineHeight: 20,
  },
  headBadge: {
    fontSize: 11, color: theme.color.accent, fontWeight: '700', marginTop: 2,
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
