import React, { useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { prepareCart } from '../api';
import { shippingValueLabel, isShippingKnown } from '../presentation';
import { ApiError, PrepareCartResponse, RankedOffer } from '../types';
import { CERTAINTY_LABEL, displayText, formatMoney, formatScore, theme } from '../theme';

interface Props {
  offer: RankedOffer;
  sessionId: string | null;
  onBack: () => void;
}

const CRITERION_STATUS: Record<string, string> = {
  satisfied: 'respecté',
  violated: 'non respecté',
  unknown: 'inconnu',
  not_applicable: 'sans objet',
};

const READINESS_DIMENSION: Record<string, string> = {
  verified: 'Prix vérifié',
  purchasable: 'Lien d’achat',
  inStock: 'Stock',
  deliverable: 'Livraison',
};

const READINESS_STATE: Record<string, string> = {
  confirmed: 'confirmé',
  unknown: 'inconnu',
  blocked: 'bloqué',
};

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label} : ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowValueMuted]}>{value}</Text>
    </View>
  );
}

export function OfferDetailScreen({ offer, sessionId, onBack }: Props) {
  const [preparing, setPreparing] = useState(false);
  const [prep, setPrep] = useState<PrepareCartResponse | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);

  const currency = offer.cost.currency || offer.price?.currency || 'EUR';
  const isTotalKnown = offer.cost.certainty === 'known';

  async function onPrepare() {
    if (!sessionId) {
      setPrepError("La session de recherche est expirée. Relancez une recherche.");
      return;
    }
    setPreparing(true);
    setPrepError(null);
    setPrep(null);
    try {
      setPrep(await prepareCart(sessionId, offer.offerId));
    } catch (err) {
      const e = err as ApiError;
      setPrepError(e.message ?? 'La préparation a échoué.');
    } finally {
      setPreparing(false);
    }
  }

  const canOpen = Boolean(prep?.checkoutUrl);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Revenir aux résultats"
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Text style={styles.backText}>‹ Résultats</Text>
      </Pressable>

      <Text style={styles.merchant} accessibilityRole="header">
        {displayText(offer.merchant?.name, 'Marchand inconnu')}
      </Text>
      {/*
        Le productId du backend est un identifiant interne
        ("product-web-www.amazon.com.be"), pas un nom de produit : l'afficher
        n'apprenait rien à l'utilisateur. Ce qui le renseigne réellement sur
        l'adéquation de l'offre, c'est matchQuality ("Correspondance exacte").
      */}
      {offer.matchQuality ? <Text style={styles.match}>{offer.matchQuality}</Text> : null}

      <Text style={styles.section} accessibilityRole="header">Coût</Text>
      <View style={styles.card}>
        <Row
          label="Prix"
          value={offer.price ? formatMoney(offer.price.amount, offer.price.currency) : 'inconnu'}
          muted={!offer.price}
        />
        <Row
          label="Livraison"
          value={shippingValueLabel(offer)}
          muted={!isShippingKnown(offer)}
        />
        <Row
          label={isTotalKnown ? 'Coût total' : 'Coût total connu à ce jour'}
          value={
            isTotalKnown
              ? formatMoney(offer.cost.totalKnown, currency)
              : `au moins ${formatMoney(offer.cost.totalKnown, currency)}`
          }
        />
        <Row
          label="Certitude"
          value={CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}
          muted={!isTotalKnown}
        />
        {offer.cost.unknownComponents.length > 0 ? (
          <Row label="Composantes inconnues" value={offer.cost.unknownComponents.join(', ')} muted />
        ) : null}
      </View>
      {offer.cost.statement ? <Text style={styles.statement}>{offer.cost.statement}</Text> : null}

      <Text style={styles.section} accessibilityRole="header">Pourquoi ce classement</Text>
      <View style={styles.card}>
        <Row label="Rang" value={`#${offer.rank}`} />
        <Row label="Score" value={formatScore(offer.score)} />
        {offer.explanation ? <Text style={styles.explanation}>{offer.explanation}</Text> : null}
        {(offer.criteria ?? []).slice(0, 8).map((c) => (
          <Row
            key={c.id}
            label={c.level ? `${c.name} (${c.level})` : c.name}
            value={CRITERION_STATUS[c.status] ?? c.status}
            muted={c.status !== 'satisfied'}
          />
        ))}
      </View>

      <Text style={styles.section} accessibilityRole="header">Disponibilité</Text>
      <View style={styles.card}>
        {(offer.readiness?.details ?? []).map((d) => (
          <Row
            key={d.dimension}
            label={READINESS_DIMENSION[d.dimension] ?? d.dimension}
            value={READINESS_STATE[d.state] ?? d.state}
            muted={d.state !== 'confirmed'}
          />
        ))}
        {offer.readiness?.statement ? (
          <Text style={styles.statement}>{offer.readiness.statement}</Text>
        ) : null}
        {(offer.readiness?.details ?? []).length === 0 && !offer.readiness?.statement ? (
          <Text style={styles.unknownNote}>
            Aucune information de disponibilité n’a été relevée pour cette offre.
          </Text>
        ) : null}
      </View>

      <Text style={styles.section} accessibilityRole="header">Fiabilité des données</Text>
      <View style={styles.card}>
        <Row
          label="Source"
          value={displayText(offer.provenance?.source, 'inconnue')}
          muted={!offer.provenance?.source}
        />
        {offer.provenance?.reliability != null ? (
          <Row label="Fiabilité de la source" value={`${Math.round(offer.provenance.reliability * 100)} %`} />
        ) : null}
        <Row
          label="Statut du prix"
          value={displayText(offer.price?.status, 'inconnu')}
          muted={!offer.price}
        />
        {offer.dataQuality?.statement ? (
          <Text style={styles.statement}>{offer.dataQuality.statement}</Text>
        ) : null}
      </View>

      <Text style={styles.section} accessibilityRole="header">Lien vers l’offre</Text>
      <View style={styles.card}>
        {offer.offerUrl ? (
          <Text style={styles.url} selectable>{offer.offerUrl}</Text>
        ) : (
          // No verified URL is known. Capucine does NOT build one from the
          // merchant name or the offer id — a guessed link is a fabricated fact.
          <Text style={styles.unknownNote}>
            Aucune URL vérifiée n’est connue pour cette offre. Capucine n’en invente pas.
          </Text>
        )}
      </View>

      <Pressable
        onPress={onPrepare}
        disabled={preparing}
        accessibilityRole="button"
        accessibilityLabel="Préparer l’achat"
        accessibilityState={{ disabled: preparing, busy: preparing }}
        style={({ pressed }) => [styles.button, (pressed || preparing) && styles.pressed]}
      >
        {preparing
          ? <ActivityIndicator color={theme.color.accentText} />
          : <Text style={styles.buttonText}>Préparer l’achat</Text>}
      </Pressable>

      {prepError ? (
        <View style={styles.errorBox} accessibilityLiveRegion="assertive">
          <Text style={styles.errorTitle}>{prepError}</Text>
        </View>
      ) : null}

      {prep ? (
        <View style={styles.prepBox} accessibilityLiveRegion="polite">
          <Text style={styles.prepStatus}>
            {prep.status === 'unavailable' || prep.status === 'failed'
              ? 'Achat non préparable'
              : 'Panier préparé'}
          </Text>
          {prep.nextAction ? <Text style={styles.prepAction}>{prep.nextAction}</Text> : null}
          {canOpen ? (
            <Pressable
              onPress={() => Linking.openURL(prep!.checkoutUrl!)}
              accessibilityRole="link"
              accessibilityLabel="Ouvrir la page du marchand"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Ouvrir la page du marchand</Text>
            </Pressable>
          ) : null}
          <Text style={styles.paymentNote}>
            Capucine ne prend jamais le paiement. Vous validez l’achat vous-même chez le marchand.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.space(2), paddingBottom: theme.space(6) },
  back: { minHeight: theme.minTouch, justifyContent: 'center' },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  merchant: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text },
  match: { fontSize: theme.font.small, color: theme.color.known, marginTop: 2, fontWeight: '600' },
  section: {
    fontSize: theme.font.heading, fontWeight: '700',
    color: theme.color.text, marginTop: theme.space(3), marginBottom: theme.space(1),
  },
  card: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.border, padding: theme.space(2),
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 6, gap: theme.space(2),
  },
  rowLabel: { fontSize: theme.font.body, color: theme.color.textMuted, flexShrink: 1 },
  rowValue: {
    fontSize: theme.font.body, color: theme.color.text,
    fontWeight: '600', flexShrink: 1, textAlign: 'right',
  },
  rowValueMuted: { color: theme.color.unknown },
  statement: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(1), lineHeight: 20,
  },
  explanation: {
    fontSize: theme.font.small, color: theme.color.text,
    marginTop: theme.space(0.5), marginBottom: theme.space(0.5),
  },
  url: { fontSize: theme.font.small, color: theme.color.accent },
  unknownNote: { fontSize: theme.font.body, color: theme.color.unknown, lineHeight: 22 },
  button: {
    minHeight: theme.minTouch + 6, borderRadius: theme.radius,
    backgroundColor: theme.color.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: theme.space(3),
  },
  buttonText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
  errorBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: '#FDF3F3',
  },
  errorTitle: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.body },
  prepBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  prepStatus: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  prepAction: {
    fontSize: theme.font.small, color: theme.color.text,
    marginTop: theme.space(1), lineHeight: 20,
  },
  secondary: {
    minHeight: theme.minTouch, borderRadius: theme.radius, borderWidth: 1,
    borderColor: theme.color.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: theme.space(2),
  },
  secondaryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '700' },
  paymentNote: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(2), lineHeight: 20,
  },
});
