import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Screen } from '../components/Screen';
import { prepareCart } from '../api';
import {
  costLabel, explainOfferRanking, prepStatusLabel, shippingValueLabel, isShippingKnown,
} from '../presentation';
import { ApiError, PrepareCartResponse, RankedOffer, RankingPreferenceState } from '../types';
import { CERTAINTY_LABEL, displayText, formatMoney, formatScore, theme, cardStyle, textStyle } from '../theme';

interface Props {
  offer: RankedOffer;
  allOffers: RankedOffer[];
  ranking?: RankingPreferenceState | null;
  availabilityEmphasis?: boolean;
  sessionId: string | null;
  onPrepared?: (status: string, merchant: string | null) => void;
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
  purchasable: 'Lien d\'achat',
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

export function OfferDetailScreen({
  offer, allOffers, ranking, availabilityEmphasis, sessionId, onPrepared, onBack,
}: Props) {
  const [preparing, setPreparing] = useState(false);
  const [prep, setPrep] = useState<PrepareCartResponse | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const currency = offer.cost.currency || offer.price?.currency || 'EUR';
  const isTotalKnown = offer.cost.certainty === 'known';
  const reasons = explainOfferRanking(offer, allOffers, ranking, availabilityEmphasis);

  async function onPrepare() {
    if (inFlight.current) return;
    if (!sessionId) {
      setPrepError('La session de recherche est expirée. Relancez une recherche.');
      return;
    }
    inFlight.current = true;
    setPreparing(true);
    setPrepError(null);
    setPrep(null);
    try {
      const result = await prepareCart(sessionId, offer.offerId);
      setPrep(result);
      onPrepared?.(result.status, offer.merchant?.name ?? null);
    } catch (err) {
      const e = err as ApiError;
      setPrepError(e.message ?? 'La préparation a échoué.');
    } finally {
      setPreparing(false);
      inFlight.current = false;
    }
  }

  const openableUrl =
    prep?.checkoutUrl && /^https?:\/\//i.test(prep.checkoutUrl) ? prep.checkoutUrl : null;

  async function openMerchant() {
    if (!openableUrl) return;
    try {
      await Linking.openURL(openableUrl);
    } catch {
      setPrepError(
        "Impossible d'ouvrir la page du marchand sur cet appareil. "
        + `Copiez le lien : ${openableUrl}`
      );
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Back button */}
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Revenir aux résultats"
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text style={styles.backText}>‹ Résultats</Text>
      </Pressable>

      {/* Merchant header */}
      <Text style={styles.merchant} accessibilityRole="header">
        {displayText(offer.merchant?.name, 'Marchand inconnu')}
      </Text>

      {/* Match quality if available */}
      {offer.matchQuality ? (
        <View style={styles.matchPill}>
          <Text style={styles.matchText}>{offer.matchQuality}</Text>
        </View>
      ) : null}

      {/* COST TOTAL HERO — the promise of Capucine */}
      <View
        style={styles.hero}
        accessible
        accessibilityLabel={
          `${isTotalKnown ? 'Coût total' : 'Coût total connu à ce jour'} : `
          + `${costLabel(offer)}. ${CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}.`
        }
      >
        <Text style={styles.heroLabel}>
          {isTotalKnown ? 'Coût total' : 'Coût total connu à ce jour'}
        </Text>
        <Text style={styles.heroValue}>{costLabel(offer)}</Text>
        <Text style={styles.heroCertainty}>
          {CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}
        </Text>
      </View>

      {/* Cost breakdown */}
      <Text style={styles.section} accessibilityRole="header">Détail du coût</Text>
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

      {offer.cost.statement ? (
        <Text style={styles.statement}>{offer.cost.statement}</Text>
      ) : null}

      {/* Why this ranking */}
      <Text style={styles.section} accessibilityRole="header">Pourquoi ce classement</Text>
      <View style={styles.card}>
        <View
          style={styles.reasonList}
          accessible
          accessibilityLabel={`Pourquoi ce classement : ${reasons.join(' ')}`}
        >
          {reasons.map((line, i) => (
            <Text key={i} style={i === 0 ? styles.reasonHead : styles.reasonLine}>
              {i === 0 ? line : `· ${line}`}
            </Text>
          ))}
        </View>
        <Row label="Rang" value={`#${offer.rank}`} />
        <Row label="Score" value={formatScore(offer.score)} />
        {(offer.criteria ?? []).slice(0, 8).map((c) => (
          <Row
            key={c.id}
            label={c.level ? `${c.name} (${c.level})` : c.name}
            value={CRITERION_STATUS[c.status] ?? c.status}
            muted={c.status !== 'satisfied'}
          />
        ))}
      </View>

      {/* Availability */}
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
            Aucune information de disponibilité n'a été relevée pour cette offre.
          </Text>
        ) : null}
      </View>

      {/* Data provenance */}
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

      {/* Offer URL — never fabricated */}
      <Text style={styles.section} accessibilityRole="header">Lien vers l'offre</Text>
      <View style={styles.card}>
        {offer.offerUrl ? (
          <Text style={styles.url} selectable>{offer.offerUrl}</Text>
        ) : (
          <Text style={styles.unknownNote}>
            Aucune URL vérifiée n'est connue pour cette offre. Capucine n'en invente pas.
          </Text>
        )}
      </View>

      {/* Prepare cart — honest action */}
      <Pressable
        onPress={onPrepare}
        disabled={preparing}
        accessibilityRole="button"
        accessibilityLabel="Préparer l'achat"
        accessibilityState={{ disabled: preparing, busy: preparing }}
        style={({ pressed }) => [styles.button, (pressed || preparing) && styles.pressed]}
        hitSlop={8}
      >
        {preparing
          ? <ActivityIndicator color={theme.color.accentText} />
          : <Text style={styles.buttonText}>Préparer l'achat</Text>}
      </Pressable>

      {prepError ? (
        <View style={styles.errorBox} accessibilityLiveRegion="assertive">
          <Text style={styles.errorTitle} selectable>{prepError}</Text>
        </View>
      ) : null}

      {prep ? (
        <View style={styles.prepBox} accessibilityLiveRegion="polite">
          <Text style={styles.prepStatus}>{prepStatusLabel(prep.status)}</Text>
          {prep.status === 'partial' ? (
            <Text style={styles.prepAction}>
              Capucine vous amène à la bonne page ; le panier se crée chez le marchand,
              où vous vérifiez le total avant de payer.
            </Text>
          ) : null}
          {prep.nextAction ? <Text style={styles.prepAction}>{prep.nextAction}</Text> : null}
          {openableUrl ? (
            <Pressable
              onPress={openMerchant}
              accessibilityRole="link"
              accessibilityLabel="Ouvrir la page du marchand"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              hitSlop={8}
            >
              <Text style={styles.secondaryText}>Ouvrir la page du marchand</Text>
            </Pressable>
          ) : prep.status === 'partial' || prep.status === 'success' ? (
            <Text style={styles.unknownNote}>
              Aucun lien exploitable n'a été fourni pour cette offre.
            </Text>
          ) : null}
          <Text style={styles.paymentNote}>
            Capucine ne prend jamais le paiement. Vous validez l'achat vous-même chez le marchand.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.space(2), paddingBottom: theme.space(8) },
  back: { minHeight: theme.minTouch, justifyContent: 'center', marginBottom: theme.space(1) },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  pressed: { opacity: theme.opacity.pressed },

  merchant: { fontSize: theme.font.title + 2, fontWeight: '700', color: theme.color.text },
  matchPill: {
    marginTop: theme.space(1), alignSelf: 'flex-start',
    paddingHorizontal: theme.space(1.5), paddingVertical: 4,
    borderRadius: theme.radii.pill, backgroundColor: theme.color.knownSoft,
  },
  matchText: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.known },

  hero: {
    marginTop: theme.space(2),
    padding: theme.space(3),
    borderRadius: theme.radii.lg,
    backgroundColor: theme.color.surface,
    borderWidth: 2,
    borderColor: theme.color.accent,
    ...theme.shadow.card,
  },
  heroLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  heroValue: {
    fontSize: theme.font.display + 6, fontWeight: '700', color: theme.color.text,
    marginTop: theme.space(0.5), letterSpacing: -0.5,
  },
  heroCertainty: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5) },

  section: {
    fontSize: theme.font.heading, fontWeight: '700',
    color: theme.color.text, marginTop: theme.space(4), marginBottom: theme.space(1.5),
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(2),
    ...theme.shadow.subtle,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 8, gap: theme.space(2),
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
  reasonList: { marginBottom: theme.space(1) },
  reasonHead: {
    fontSize: theme.font.body, color: theme.color.text, fontWeight: '700', lineHeight: 24,
  },
  reasonLine: {
    fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 3, lineHeight: 20,
  },
  url: { fontSize: theme.font.small, color: theme.color.accent },
  unknownNote: { fontSize: theme.font.body, color: theme.color.unknown, lineHeight: 22 },

  button: {
    minHeight: theme.minTouch + 8, borderRadius: theme.radii.md,
    backgroundColor: theme.color.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: theme.space(3),
    ...theme.shadow.card,
  },
  buttonText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },

  errorBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: theme.color.dangerSoft,
  },
  errorTitle: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.body },

  prepBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
    ...theme.shadow.subtle,
  },
  prepStatus: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  prepAction: {
    fontSize: theme.font.small, color: theme.color.text,
    marginTop: theme.space(1), lineHeight: 20,
  },
  secondary: {
    minHeight: theme.minTouch, borderRadius: theme.radii.md, borderWidth: 1,
    borderColor: theme.color.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: theme.space(2),
  },
  secondaryText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '700' },
  paymentNote: {
    fontSize: theme.font.micro, color: theme.color.textMuted,
    marginTop: theme.space(2), lineHeight: 18, textAlign: 'center',
  },
});