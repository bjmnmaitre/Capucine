import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { RankedOffer, SearchResponse } from '../types';
import {
  availabilityEmphasisLabel, costLabel, explainOfferRanking, rankingPreferenceLabel,
  usageContextLabel,
} from '../presentation';
import { CERTAINTY_LABEL, displayText, formatMoney, priceLabel, theme, cardStyle, inputStyle, textStyle } from '../theme';

interface Props {
  query: string;
  response: SearchResponse;
  refining: boolean;
  refineError: string | null;
  onRefine: (answer: string) => void;
  onResetRefinements: () => void;
  onSelect: (offer: RankedOffer) => void;
  onCompare: (offers: RankedOffer[]) => void;
  onReformulate: (query: string) => void;
  onBack: () => void;
}

const REFORMULATE_OPTION_TYPES = new Set(['expand_search_terms']);

const MAX_COMPARE = 3;

const REFINEMENTS = ['le moins cher', 'sans Amazon', 'uniquement du neuf', 'livraison rapide'];

function shippingLabel(offer: RankedOffer): { text: string; style: any } {
  const s = offer.shipping;
  if (!s || s.status === 'unknown' || s.amount === null) {
    return { text: 'livraison inconnue', style: styles.shippingUnknown };
  }
  if (s.amount === 0) {
    return { text: 'Livraison gratuite', style: styles.shippingFree };
  }
  return { text: `livraison ${formatMoney(s.amount, s.currency)}`, style: styles.shippingCost };
}

function priceDisplay(offer: RankedOffer): { text: string; style: any } {
  const p = offer.price;
  const label = priceLabel(p?.amount, p?.currency);
  const style = label.kind === 'none' ? styles.priceOnRequest : label.kind === 'approximate' ? styles.priceApprox : styles.priceValue;
  return { text: label.text, style };
}

function certaintyBadgeStyle(certainty: string) {
  return certainty === 'known' ? styles.badgeKnown : styles.badgeUnknown;
}

function isChrSpecialist(offer: RankedOffer): boolean {
  const merchantName = offer.merchant?.name?.toLowerCase() ?? '';
  const merchantUrl = offer.offerUrl?.toLowerCase() ?? '';
  const chrKeywords = ['chr', 'pro', 'professionnel', 'restaurant', 'cuisine', 'horeca', 'matériel', 'equipement', 'fournisseur', 'grossiste'];
  return chrKeywords.some(kw => merchantName.includes(kw) || merchantUrl.includes(kw));
}

function OfferCard({
  offer, allOffers, ranking, availabilityEmphasis, compareMode, selected, atCapacity, onPress,
}: {
  offer: RankedOffer;
  allOffers: RankedOffer[];
  ranking: SearchResponse['rankingPreference'];
  availabilityEmphasis?: boolean;
  compareMode: boolean;
  selected: boolean;
  atCapacity: boolean;
  onPress: () => void;
}) {
  const isTotalKnown = offer.cost.certainty === 'known';
  const total = costLabel(offer);
  const totalUnknown = offer.cost.certainty === 'unknown' || offer.cost.totalKnown == null;

  const shippingInfo = shippingLabel(offer);
  const priceInfo = priceDisplay(offer);
  const why = explainOfferRanking(offer, allOffers, ranking, availabilityEmphasis);
  const recommended = offer.rank === 1;

  const certaintyText = CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty;
  const a11yLabel = compareMode
    ? `${selected ? 'Sélectionnée pour comparaison' : 'Non sélectionnée'}. `
      + `Offre n°${offer.rank}, ${displayText(offer.merchant?.name, 'Marchand inconnu')}, `
      + `${totalUnknown ? 'coût total inconnu' : 'coût total ' + total}.`
    : `Offre n°${offer.rank}${recommended ? ', recommandée' : ''}. `
      + `${displayText(offer.merchant?.name, 'Marchand inconnu')}. `
      + `${totalUnknown ? 'Coût total inconnu' : 'Coût total ' + total} — ${certaintyText}. `
      + `Prix ${priceInfo.text}, ${shippingInfo.text}. `
      + why.join(' ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={compareMode ? 'checkbox' : 'button'}
      accessibilityState={compareMode ? { checked: selected } : undefined}
      accessibilityLabel={a11yLabel}
      accessibilityHint={
        compareMode
          ? (atCapacity && !selected
              ? 'Limite de 3 offres atteinte — retirez-en une pour ajouter celle-ci'
              : 'Touchez pour ajouter ou retirer de la comparaison')
          : 'Ouvre le détail complet de cette offre'
      }
      style={({ pressed }) => [
        styles.card,
        recommended && !compareMode && styles.cardRecommended,
        selected && styles.cardSelected,
        pressed && styles.cardPressed,
      ]}
    >
      {/* Card header — rank + merchant */}
      <View style={styles.cardHead}>
        {compareMode ? (
          <View style={styles.checkboxWrap}>
            <Text style={[styles.checkbox, selected && styles.checkboxOn]}>
              {selected ? '✓' : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.rankBadge}>
            <Text style={styles.rankText}>#{offer.rank}</Text>
          </View>
        )}
        <Text style={styles.merchant} numberOfLines={1}>
          {displayText(offer.merchant?.name, 'Marchand inconnu')}
        </Text>
        {recommended && !compareMode ? (
          <View style={styles.recommendedPill}>
            <Text style={styles.recommendedPillText}>Recommandée</Text>
          </View>
        ) : null}
        {isChrSpecialist(offer) ? (
          <View style={styles.chrPill}>
            <Text style={styles.chrPillText}>Spécialiste CHR</Text>
          </View>
        ) : null}
      </View>

      {/* Cost total — THE hero number */}
      <View style={styles.totalSection}>
        <Text style={styles.totalLabel}>
          {isTotalKnown ? 'Coût total' : totalUnknown ? 'Coût total' : 'Coût total connu à ce jour'}
        </Text>
        <Text style={[styles.totalValue, totalUnknown && styles.totalUnknown]}>
          {totalUnknown ? 'inconnu' : total}
        </Text>
      </View>

      {/* Certainty badge — right under the total */}
      <View style={styles.certaintyRow}>
        <View style={[styles.badge, certaintyBadgeStyle(offer.cost.certainty)]}>
          <Text style={[styles.badgeText, certaintyBadgeStyle(offer.cost.certainty)]}>
            {CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}
          </Text>
        </View>
        {offer.cost.statement ? (
          <Text style={styles.costStatement} numberOfLines={2}>{offer.cost.statement}</Text>
        ) : null}
      </View>

      {/* Price breakdown — secondary, muted */}
      <View style={styles.breakdownRow}>
        <Text style={[styles.breakdownLabel, priceInfo.style]}>{priceInfo.text}</Text>
        <Text style={[styles.breakdownLabel, shippingInfo.style]}>{shippingInfo.text}</Text>
      </View>

      {/* Unknown components — honest, not hidden */}
      {!compareMode && offer.cost.unknownComponents.length > 0 ? (
        <Text style={styles.unknownList}>
          Non connu : {offer.cost.unknownComponents.join(', ')} — non estimé, non ignoré.
        </Text>
      ) : null}

      {/* Why this rank — only in list mode */}
      {!compareMode ? (
        <View style={styles.whyBox}>
          {why.slice(0, 2).map((line, i) => (
            <Text key={i} style={i === 0 ? styles.whyHead : styles.whyLine}>
              {i === 0 ? line : `· ${line}`}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Conversational refinement bar — free text + quick chips.
 */
function RefinementBar({
  response, refining, refineError, onRefine, onResetRefinements,
}: Pick<Props, 'response' | 'refining' | 'refineError' | 'onRefine' | 'onResetRefinements'>) {
  const [text, setText] = useState('');
  const history = response.session?.answeredQuestions ?? [];
  const canRefine = Boolean(response.session?.sessionId);
  const orderLabel = rankingPreferenceLabel(response.rankingPreference);
  const availabilityLabel = availabilityEmphasisLabel(response.availabilityEmphasis);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || refining) return;
    setText('');
    onRefine(trimmed);
  }

  if (!canRefine) return null;

  return (
    <View style={styles.refineCard}>
      <Text style={styles.refineTitle} accessibilityRole="header">Affiner la recherche</Text>

      {orderLabel ? (
        <View style={styles.orderChip} accessible accessibilityLabel={`Ordre actuel : ${orderLabel}`}>
          <Text style={styles.orderChipText}>{orderLabel}</Text>
        </View>
      ) : null}

      {availabilityLabel ? (
        <Text style={styles.availabilityNote} accessibilityLabel={availabilityLabel}>
          {availabilityLabel}
        </Text>
      ) : null}

      {history.length > 0 ? (
        <View style={styles.refineHistory}>
          <View
            accessible
            accessibilityLabel={`Affinages appliqués : ${history.map((h) => h.answer).join(', ')}`}
          >
            {history.map((h, i) => (
              <Text key={`${h.questionId}-${i}`} style={styles.refineHistoryItem}>• {h.answer}</Text>
            ))}
          </View>
          <Pressable
            onPress={() => { if (!refining) onResetRefinements(); }}
            disabled={refining}
            accessibilityRole="button"
            accessibilityLabel="Repartir de la recherche initiale"
            accessibilityHint="Annule tous les affinages et relance la recherche d'origine"
            style={({ pressed }) => [styles.resetBtn, pressed && styles.cardPressed]}
          >
            <Text style={styles.resetBtnText}>↺ Repartir de la recherche initiale</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.refineInputRow}>
        <TextInput
          style={[styles.refineInput, refining && styles.refineInputDisabled]}
          value={text}
          onChangeText={setText}
          placeholder="ex. le moins cher, livraison rapide…"
          placeholderTextColor={theme.color.textMuted}
          onSubmitEditing={() => submit(text)}
          returnKeyType="send"
          editable={!refining}
          accessibilityLabel="Affiner la recherche"
          accessibilityHint="Décrivez ce qui doit changer, puis validez"
        />
        <Pressable
          onPress={() => submit(text)}
          disabled={refining || text.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Appliquer l'affinage"
          accessibilityState={{ disabled: refining || text.trim().length === 0, busy: refining }}
          style={({ pressed }) => [
            styles.refineSend,
            (pressed || refining || text.trim().length === 0) && styles.refineSendMuted,
          ]}
        >
          {refining
            ? <ActivityIndicator color={theme.color.accentText} />
            : <Text style={styles.refineSendText}>OK</Text>}
        </Pressable>
      </View>

      <View style={styles.refineChips}>
        {response.rankingPreference?.applied
          && response.rankingPreference.preference === 'PRICE_LOWEST' ? (
          <Pressable
            onPress={() => submit('trie par meilleure correspondance')}
            disabled={refining}
            accessibilityRole="button"
            accessibilityLabel="Affiner : revenir au tri par meilleure correspondance"
            style={({ pressed }) => [styles.refineChip, pressed && styles.cardPressed]}
          >
            <Text style={styles.refineChipText}>meilleure correspondance</Text>
          </Pressable>
        ) : null}
        {REFINEMENTS.map((r) => (
          <Pressable
            key={r}
            onPress={() => submit(r)}
            disabled={refining}
            accessibilityRole="button"
            accessibilityLabel={`Affiner : ${r}`}
            style={({ pressed }) => [styles.refineChip, pressed && styles.cardPressed]}
          >
            <Text style={styles.refineChipText}>{r}</Text>
          </Pressable>
        ))}
      </View>

      {refining ? (
        <Text style={styles.refineNote} accessibilityLiveRegion="polite">
          Capucine relance la recherche avec cette précision…
        </Text>
      ) : null}
      {refineError ? (
        <View style={styles.refineErrorBox} accessibilityLiveRegion="assertive">
          <Text style={styles.refineErrorText}>{refineError}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function ResultsScreen({
  query, response, refining, refineError, onRefine, onResetRefinements,
  onSelect, onCompare, onReformulate, onBack,
}: Props) {
  const results = response.results ?? [];
  const productIds = new Set(results.map((r) => r.productId));
  const merchantIds = new Set(results.map((r) => r.merchant?.id).filter(Boolean));

  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionShrank, setSelectionShrank] = useState(false);

  useEffect(() => {
    setSelectedIds((cur) => {
      const kept = cur.filter((id) => results.some((r) => r.offerId === id));
      if (kept.length !== cur.length) setSelectionShrank(true);
      return kept.length === cur.length ? cur : kept;
    });
  }, [results]);

  const selectedOffers = results.filter((r) => selectedIds.includes(r.offerId));

  function toggleCompareMode() {
    setCompareMode((on) => !on);
    setSelectedIds([]);
    setSelectionShrank(false);
  }

  function toggleSelected(offerId: string) {
    setSelectionShrank(false);
    setSelectedIds((cur) => {
      if (cur.includes(offerId)) return cur.filter((id) => id !== offerId);
      if (cur.length >= MAX_COMPARE) return cur;
      return [...cur, offerId];
    });
  }

  const canCompare = results.length >= 2;

  const usageNote = usageContextLabel(response.usageContext);

  const mx = response.merchantExclusions;
  const exclusionNote = mx && mx.hiddenOfferCount > 0
    ? `${mx.hiddenOfferCount} offre${mx.hiddenOfferCount > 1 ? 's' : ''} masquée${mx.hiddenOfferCount > 1 ? 's' : ''}`
      + ` (${mx.hiddenMerchants.join(', ')}) — marchand${mx.hiddenMerchants.length > 1 ? 's' : ''} que vous évitez.`
    : null;

  return (
    <View style={styles.flex}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Revenir à la recherche"
            style={({ pressed }) => [styles.back, pressed && styles.cardPressed]}
            hitSlop={8}
          >
            <Text style={styles.backText}>‹ Recherche</Text>
          </Pressable>
          {compareMode || canCompare ? (
            <Pressable
              onPress={toggleCompareMode}
              accessibilityRole="button"
              accessibilityLabel={compareMode ? 'Quitter le mode comparaison' : 'Comparer des offres'}
              accessibilityState={{ selected: compareMode }}
              style={({ pressed }) => [styles.compareToggle, compareMode && styles.compareToggleOn, pressed && styles.cardPressed]}
              hitSlop={6}
            >
              <Text style={[styles.compareToggleText, compareMode && styles.compareToggleTextOn]}>
                {compareMode ? 'Annuler' : '⇄ Comparer'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.query} numberOfLines={2} accessibilityRole="header">{query}</Text>
        <Text style={styles.counts}>
          {results.length} offre{results.length > 1 ? 's' : ''} · {merchantIds.size} marchand
          {merchantIds.size > 1 ? 's' : ''} · {productIds.size} produit
          {productIds.size > 1 ? 's' : ''}
        </Text>
{compareMode ? (
          <Text style={styles.summary} accessibilityLiveRegion="polite">
            {selectionShrank
              ? "Une offre sélectionnée a disparu après l'affinage — sélection ajustée. "
              : ''}
            Choisissez 2 ou 3 offres à comparer ({selectedOffers.length}/{MAX_COMPARE}).
          </Text>
        ) : response.summary?.resultSummary ? (
          <Text style={styles.summary}>{response.summary.resultSummary}</Text>
        ) : null}

        {!compareMode && usageNote ? (
          <Text style={styles.usageNote} accessibilityLabel={usageNote}>{usageNote}</Text>
        ) : null}

        {!compareMode && exclusionNote ? (
          <Text style={styles.exclusionNote} accessibilityLabel={exclusionNote}>{exclusionNote}</Text>
        ) : null}
      </View>

      {results.length === 0 ? (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <RefinementBar
            response={response}
            refining={refining}
            refineError={refineError}
            onRefine={onRefine}
            onResetRefinements={onResetRefinements}
          />
          <View style={styles.empty} accessibilityLiveRegion="polite">
            <Text style={styles.emptyTitle}>Aucune offre trouvée</Text>
            <Text style={styles.emptyBody}>
              {response.noResultsDiagnosis?.message ??
                "Capucine n'a trouvé aucune offre correspondant à cette demande."}
            </Text>
            {(response.noResultsDiagnosis?.recoveryOptions ?? []).map((option) =>
              REFORMULATE_OPTION_TYPES.has(option.type) ? (
                <Pressable
                  key={option.id}
                  onPress={() => onReformulate(query)}
                  accessibilityRole="button"
                  accessibilityLabel={option.description}
                  accessibilityHint="Revenir à la recherche avec votre texte actuel, pour le modifier"
                  style={({ pressed }) => [styles.recoveryAction, pressed && styles.cardPressed]}
                >
                  <Text style={styles.recoveryActionText}>{option.description} ›</Text>
                  {option.impact ? <Text style={styles.recoveryImpact}>{option.impact}</Text> : null}
                </Pressable>
              ) : (
                <View key={option.id} style={styles.recovery}>
                  <Text style={styles.recoveryText}>{option.description}</Text>
                  {option.impact ? <Text style={styles.recoveryImpact}>{option.impact}</Text> : null}
                </View>
              )
            )}
            {response.searchPlan?.searchContext === 'restaurant_equipment' && (
              <View style={styles.chrSuggestion} accessibilityLiveRegion="polite">
                <Text style={styles.chrSuggestionTitle}>💡 Suggestion CHR</Text>
                <Text style={styles.chrSuggestionBody}>
                  Essayez avec des termes plus précis : "four professionnel", "réfrigérateur CHR",
                  "piano de cuisson", "friteuse professionnelle", "chambre froide"…
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.offerId}
          contentContainerStyle={[
            styles.list,
            compareMode && selectedOffers.length >= 2 && styles.listWithBar,
          ]}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <RefinementBar
              response={response}
              refining={refining}
              refineError={refineError}
              onRefine={onRefine}
              onResetRefinements={onResetRefinements}
            />
          }
          renderItem={({ item }) => (
            <OfferCard
              offer={item}
              allOffers={results}
              ranking={response.rankingPreference}
              availabilityEmphasis={response.availabilityEmphasis}
              compareMode={compareMode}
              selected={selectedIds.includes(item.offerId)}
              atCapacity={selectedIds.length >= MAX_COMPARE}
              onPress={() => (compareMode ? toggleSelected(item.offerId) : onSelect(item))}
            />
          )}
          ListFooterComponent={
            <Text style={styles.footer}>
              Classement produit par le moteur de priorité de Capucine, pas par le prix seul.
            </Text>
          }
        />
      )}

      {compareMode && selectedOffers.length >= 2 ? (
        <View style={styles.compareBar}>
          <Pressable
            onPress={() => onCompare(selectedOffers)}
            accessibilityRole="button"
            accessibilityLabel={`Comparer les ${selectedOffers.length} offres sélectionnées`}
            style={({ pressed }) => [styles.compareGo, pressed && styles.cardPressed]}
            hitSlop={6}
          >
            <Text style={styles.compareGoText}>Comparer ({selectedOffers.length})</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  header: {
    padding: theme.space(2),
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1) },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  compareToggle: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.color.accent,
  },
  compareToggleOn: { backgroundColor: theme.color.accent },
  compareToggleText: { color: theme.color.accent, fontSize: theme.font.small, fontWeight: '700' },
  compareToggleTextOn: { color: theme.color.accentText },
  query: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text, marginTop: theme.space(1) },
  counts: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5) },
  summary: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5), lineHeight: 20 },
  exclusionNote: {
    fontSize: theme.font.small, color: theme.color.unknown, marginTop: theme.space(0.5),
    lineHeight: 18,
  },
  usageNote: {
    fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5),
    lineHeight: 18, fontStyle: 'italic',
  },
  list: { padding: theme.space(2), paddingBottom: theme.space(5), gap: theme.space(1.5) },
  listWithBar: { paddingBottom: theme.space(14) },

  refineCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(2),
    marginBottom: theme.space(2),
    ...theme.shadow.subtle,
  },
  refineTitle: {
    fontSize: theme.font.small, fontWeight: '700', color: theme.color.text,
    marginBottom: theme.space(1.5),
  },
  orderChip: {
    alignSelf: 'flex-start', backgroundColor: theme.color.accentSoft, borderRadius: theme.radii.pill,
    paddingHorizontal: theme.space(1.5), paddingVertical: theme.space(0.5), marginBottom: theme.space(1),
  },
  orderChipText: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600' },
  availabilityNote: {
    fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600',
    lineHeight: 18, marginBottom: theme.space(1),
  },
  refineHistory: { marginBottom: theme.space(1) },
  refineHistoryItem: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 20 },
  resetBtn: { minHeight: theme.minTouch, justifyContent: 'center', marginTop: theme.space(0.5) },
  resetBtnText: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600' },
  refineInputRow: { flexDirection: 'row', gap: theme.space(1), alignItems: 'stretch' },
  refineInput: {
    flex: 1, minHeight: theme.minTouch, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radii.md, paddingHorizontal: theme.space(1.5),
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.background,
  },
  refineInputDisabled: { opacity: 0.6 },
  refineSend: {
    minWidth: theme.minTouch + 8, minHeight: theme.minTouch, borderRadius: theme.radii.md,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: theme.space(1.5), ...theme.shadow.subtle,
  },
  refineSendMuted: { opacity: theme.opacity.disabled },
  refineSendText: { color: theme.color.accentText, fontWeight: '700', fontSize: theme.font.body },
  refineChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1), marginTop: theme.space(1.5) },
  refineChip: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.background,
  },
  refineChipText: { fontSize: theme.font.small, color: theme.color.text },
  refineNote: {
    marginTop: theme.space(1), fontSize: theme.font.small, color: theme.color.textMuted,
  },
  refineErrorBox: {
    marginTop: theme.space(1), padding: theme.space(1.5), borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: theme.color.dangerSoft,
  },
  refineErrorText: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(2),
    marginBottom: theme.space(1.5),
    minHeight: theme.minTouch,
    ...theme.shadow.subtle,
  },
  cardPressed: { opacity: theme.opacity.pressed },
  cardSelected: { borderColor: theme.color.accent, borderWidth: 2, backgroundColor: theme.color.accentSoft },
  cardRecommended: { borderColor: theme.color.accent, borderWidth: 2, backgroundColor: '#F4F7FF' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1.5) },
  checkboxWrap: { width: 28, alignItems: 'center' },
  checkbox: { fontSize: 22, color: theme.color.textMuted },
  checkboxOn: { color: theme.color.accent },
  rankBadge: {
    minWidth: 28, minHeight: 28, borderRadius: theme.radii.sm,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
  },
  rankText: { color: theme.color.accentText, fontSize: theme.font.small, fontWeight: '700' },
  merchant: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text, flexShrink: 1 },
  recommendedPill: {
    marginLeft: 'auto', paddingHorizontal: theme.space(1), paddingVertical: 2,
    borderRadius: theme.radii.pill, backgroundColor: theme.color.accentSoft,
  },
  recommendedPillText: { fontSize: theme.font.micro, fontWeight: '700', color: theme.color.accent },

  chrPill: {
    marginLeft: 'auto', paddingHorizontal: theme.space(1), paddingVertical: 2,
    borderRadius: theme.radii.pill, backgroundColor: '#E8F5E9',
  },
  chrPillText: { fontSize: theme.font.micro, fontWeight: '700', color: '#2E7D32' },

  totalSection: { marginTop: theme.space(1.5), marginBottom: theme.space(0.5) },
  totalLabel: { fontSize: theme.font.small, color: theme.color.textMuted },
  totalValue: { fontSize: theme.font.display, fontWeight: '700', color: theme.color.text, marginTop: 2, letterSpacing: -0.3 },
  totalUnknown: { color: theme.color.unknown },

  certaintyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(1), marginTop: theme.space(1) },
  badge: {
    paddingHorizontal: theme.space(1.5), paddingVertical: 4, borderRadius: theme.radii.sm,
  },
  badgeText: { fontSize: theme.font.micro, fontWeight: '700', backgroundColor: 'transparent' },
  badgeKnown: { color: theme.color.known, backgroundColor: theme.color.knownSoft },
  badgeUnknown: { color: theme.color.unknown, backgroundColor: theme.color.unknownSoft },
  costStatement: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2, flexShrink: 1 },

  breakdown: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(1) },
  breakdownRow: { flexDirection: 'row', gap: theme.space(2), marginTop: theme.space(1) },
  breakdownLabel: { fontSize: theme.font.small },
  priceValue: { fontSize: theme.font.small, fontWeight: '700', color: theme.color.known },
  priceApprox: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.textMuted },
  priceOnRequest: { fontSize: theme.font.small, fontStyle: 'italic', color: theme.color.textMuted },
  shippingCost: { fontSize: theme.font.small, color: theme.color.textMuted },
  shippingFree: { fontSize: theme.font.small, fontWeight: '600', color: theme.color.known },
  shippingUnknown: { fontSize: theme.font.small, fontStyle: 'italic', color: theme.color.textMuted },
  unknownList: {
    fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5),
  },

  whyBox: {
    marginTop: theme.space(1.5), paddingTop: theme.space(1.5),
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  whyHead: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '600', lineHeight: 20 },
  whyLine: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2, lineHeight: 20 },

  recovery: { marginTop: theme.space(1.5), paddingLeft: theme.space(1.5), borderLeftWidth: 3, borderLeftColor: theme.color.accent },
  recoveryText: { fontSize: theme.font.body, color: theme.color.text },
  recoveryImpact: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  recoveryAction: {
    marginTop: theme.space(1.5), padding: theme.space(1.5), borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.color.accent, backgroundColor: theme.color.accentSoft,
    minHeight: theme.minTouch,
  },
  recoveryActionText: { fontSize: theme.font.body, color: theme.color.accent, fontWeight: '700' },

  empty: { padding: theme.space(4), alignItems: 'center' },
  emptyTitle: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  emptyBody: {
    fontSize: theme.font.body, color: theme.color.textMuted,
    marginTop: theme.space(1), lineHeight: 22, textAlign: 'center', maxWidth: 300,
  },
  chrSuggestion: {
    marginTop: theme.space(3), padding: theme.space(2),
    backgroundColor: '#FFF3E0', borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: '#FFB74D',
  },
  chrSuggestionTitle: {
    fontSize: theme.font.small, fontWeight: '700', color: '#E65100',
  },
  chrSuggestionBody: {
    fontSize: theme.font.small, color: '#BF360C', marginTop: theme.space(0.5), lineHeight: 20,
  },
  footer: {
    fontSize: theme.font.micro, color: theme.color.textMuted,
    textAlign: 'center', marginTop: theme.space(2),
  },
  compareBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: theme.space(2), backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
    ...theme.shadow.raised,
    // Ensure visibility above TabBar by using a higher zIndex equivalent
    // The TabBar is rendered after the body View in App.tsx, so this bar
    // sits at the bottom of the body View. The TabBar has its own height
    // (~48pt) + safe area. We rely on listWithBar's paddingBottom (112pt)
    // to keep content above this bar. The bar itself is ~60pt tall.
  },
  compareGo: {
    minHeight: theme.minTouch + 8, borderRadius: theme.radii.md,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.subtle,
  },
  compareGoText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
});