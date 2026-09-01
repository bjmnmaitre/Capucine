import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { RankedOffer, SearchResponse } from '../types';
import { costLabel, explainOfferRanking, rankingPreferenceLabel } from '../presentation';
import { CERTAINTY_LABEL, displayText, formatMoney, theme } from '../theme';

interface Props {
  query: string;
  response: SearchResponse;
  refining: boolean;
  refineError: string | null;
  onRefine: (answer: string) => void;
  onResetRefinements: () => void;
  onSelect: (offer: RankedOffer) => void;
  onCompare: (offers: RankedOffer[]) => void;
  /** Retour à l'écran de recherche, texte actuel pré-rempli — pour l'option
   *  de récupération « reformuler la recherche », qui ne demande PAS de
   *  retaper une requête vide. */
  onReformulate: (query: string) => void;
  onBack: () => void;
}

/**
 * Types de recoveryOptions que le backend peut suggérer sans exiger de
 * valeur (pas de budget chiffré, pas de condition à deviner) — les seuls
 * qu'on peut rendre RÉELLEMENT actionnables d'un tap. Les autres
 * (relax_budget, accept_refurbished) restent du texte informatif : le
 * backend ne comprend une relance que sous une forme précise ("élargis à
 * 1100 €"), qu'on ne peut pas deviner ici sans risquer d'envoyer une phrase
 * que l'interpréteur ne reconnaît pas, ou pire, sur-contraint (« reconditionné »
 * seul devient un critère REQUIRED, pas une simple autorisation).
 */
const REFORMULATE_OPTION_TYPES = new Set(['expand_search_terms']);

const MAX_COMPARE = 3;

/** Ready-made refinements — the phrasings the backend's follow-up interpreter
 *  reliably understands, offered as one tap instead of forcing the user to
 *  guess what it accepts. */
const REFINEMENTS = ['le moins cher', 'sans Amazon', 'uniquement du neuf', 'livraison rapide'];

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

function OfferRow({
  offer, allOffers, ranking, compareMode, selected, atCapacity, onPress,
}: {
  offer: RankedOffer;
  allOffers: RankedOffer[];
  ranking: SearchResponse['rankingPreference'];
  compareMode: boolean;
  selected: boolean;
  atCapacity: boolean;
  onPress: () => void;
}) {
  // `price` is null when the backend could not extract one. 'prix inconnu'
  // is the honest rendering — never 0, never a dash standing in for a number.
  const price = offer.price ? formatMoney(offer.price.amount, offer.price.currency) : 'prix inconnu';
  const isTotalKnown = offer.cost.certainty === 'known';
  // Le COÛT TOTAL est ce que Capucine compare — mis en avant, pas le prix seul.
  // costLabel : "X" si connu, "au moins X" si partiel, "coût inconnu" sinon.
  const total = costLabel(offer);
  const totalUnknown = offer.cost.certainty === 'unknown' || offer.cost.totalKnown == null;

  const shipping = shippingLabel(offer);
  // Deterministic, comparison-aware "why" — the headline plus the single most
  // useful supporting fact. Full reasoning lives on the detail screen.
  const why = explainOfferRanking(offer, allOffers, ranking);
  const recommended = offer.rank === 1;

  // One spoken sentence per offer, now including WHY it sits here: a
  // screen-reader user gets the recommendation reasoning without opening the card.
  const certaintyText = CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty;
  const a11yLabel = compareMode
    ? `${selected ? 'Sélectionnée pour comparaison' : 'Non sélectionnée'}. `
      + `Offre numéro ${offer.rank}, ${displayText(offer.merchant?.name, 'Marchand inconnu')}, `
      + `${totalUnknown ? 'coût total inconnu' : 'coût total ' + total}.`
    : `Offre numéro ${offer.rank}${recommended ? ', recommandée' : ''}. `
      + `${displayText(offer.merchant?.name, 'Marchand inconnu')}. `
      + `${totalUnknown ? 'Coût total inconnu' : 'Coût total ' + total} — ${certaintyText}. `
      + `Prix ${price}, ${shipping}. `
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
      <View style={styles.cardHead}>
        {compareMode ? (
          <Text style={[styles.checkbox, selected && styles.checkboxOn]}>
            {selected ? '☑' : '☐'}
          </Text>
        ) : (
          <Text style={styles.rank}>#{offer.rank}</Text>
        )}
        <Text style={styles.merchant} numberOfLines={1}>
          {displayText(offer.merchant?.name, 'Marchand inconnu')}
        </Text>
        {recommended && !compareMode ? <Text style={styles.recommendedTag}>✓ Recommandée</Text> : null}
      </View>

      {/* Le coût total, ce que Capucine compare réellement, est le chiffre
          dominant — le prix seul n'est qu'une composante, montrée dessous. */}
      <Text style={styles.totalLabel}>
        {isTotalKnown ? 'Coût total' : totalUnknown ? 'Coût total' : 'Coût total connu à ce jour'}
      </Text>
      <Text style={[styles.total, totalUnknown && styles.totalUnknown]}>
        {totalUnknown ? 'inconnu' : total}
      </Text>

      <View style={[styles.badge, certaintyStyle(offer.cost.certainty)]}>
        <Text style={[styles.badgeText, certaintyStyle(offer.cost.certainty)]}>
          {CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}
        </Text>
      </View>

      <Text style={styles.breakdown}>
        Prix {price} · {shipping}
      </Text>

      {!compareMode && offer.cost.unknownComponents.length > 0 ? (
        <Text style={styles.unknownList}>
          Non connu : {offer.cost.unknownComponents.join(', ')} — non estimé, non ignoré.
        </Text>
      ) : null}

      {/* En mode comparaison la carte est un simple sélecteur : l'explication
          détaillée reste sur le tableau de comparaison et l'écran de détail. */}
      {!compareMode ? (
        <View style={styles.whyBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
 * Conversational refinement of the current search. Sends free text to
 * POST /clarify — the backend re-runs the real pipeline with the refinement
 * merged into the session, so the whole list (and its order) is replaced by a
 * genuine re-search, never a client-side filter.
 */
function RefinementBar({
  response, refining, refineError, onRefine, onResetRefinements,
}: Pick<Props, 'response' | 'refining' | 'refineError' | 'onRefine' | 'onResetRefinements'>) {
  const [text, setText] = useState('');
  const history = response.session?.answeredQuestions ?? [];
  const canRefine = Boolean(response.session?.sessionId);
  const orderLabel = rankingPreferenceLabel(response.rankingPreference);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || refining) return;
    setText('');
    onRefine(trimmed);
  }

  if (!canRefine) return null;

  return (
    <View style={styles.refine}>
      <Text style={styles.refineTitle} accessibilityRole="header">Affiner la recherche</Text>

      {orderLabel ? (
        <View style={styles.orderChip} accessible accessibilityLabel={`Ordre actuel : ${orderLabel}`}>
          <Text style={styles.orderChipText}>{orderLabel}</Text>
        </View>
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
            accessibilityHint="Annule tous les affinages et relance la recherche d’origine"
            style={({ pressed }) => [styles.resetBtn, pressed && styles.cardPressed]}
          >
            <Text style={styles.resetBtnText}>↺ Repartir de la recherche initiale</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.refineInputRow}>
        <TextInput
          style={styles.refineInput}
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
          accessibilityLabel="Appliquer l’affinage"
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

  // A refinement replaces the whole list. A previously-picked offer may no
  // longer be present — drop it from the selection (never compare an offer the
  // user can't see) and tell them once.
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
      if (cur.length >= MAX_COMPARE) return cur; // silently capped
      return [...cur, offerId];
    });
  }

  const canCompare = results.length >= 2;

  // Honnêteté : si des offres ont été masquées par une exclusion de marchand
  // (affinage « sans X » OU préférence permanente), on le dit — la liste
  // n'est pas juste plus courte en silence.
  const mx = response.merchantExclusions;
  const exclusionNote = mx && mx.hiddenOfferCount > 0
    ? `${mx.hiddenOfferCount} offre${mx.hiddenOfferCount > 1 ? 's' : ''} masquée${mx.hiddenOfferCount > 1 ? 's' : ''}`
      + ` (${mx.hiddenMerchants.join(', ')}) — marchand${mx.hiddenMerchants.length > 1 ? 's' : ''} que vous évitez.`
    : null;

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Revenir à la recherche"
            style={({ pressed }) => [styles.back, pressed && styles.cardPressed]}
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
              ? 'Une offre sélectionnée a disparu après l’affinage — sélection ajustée. '
              : ''}
            Choisissez 2 ou 3 offres à comparer ({selectedOffers.length}/{MAX_COMPARE}).
          </Text>
        ) : response.summary?.resultSummary ? (
          <Text style={styles.summary}>{response.summary.resultSummary}</Text>
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
                "Capucine n’a trouvé aucune offre correspondant à cette demande."}
            </Text>
            {/*
              Ce que l'utilisateur peut faire pour élargir. Chaque option demande
              sa confirmation : Capucine ne relâche jamais un critère toute seule.
              Seule « reformuler » est un vrai bouton — les autres (budget,
              reconditionné) demandent une valeur ou un mot précis que la
              recherche libre ne peut pas deviner sans risquer de sur-contraindre
              la prochaine recherche (voir REFORMULATE_OPTION_TYPES).
            */}
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
            <OfferRow
              offer={item}
              allOffers={results}
              ranking={response.rankingPreference}
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
          >
            <Text style={styles.compareGoText}>Comparer ({selectedOffers.length})</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    padding: theme.space(2), backgroundColor: theme.color.surface,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { minHeight: theme.minTouch, justifyContent: 'center' },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  compareToggle: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radius, borderWidth: 1, borderColor: theme.color.accent,
  },
  compareToggleOn: { backgroundColor: theme.color.accent },
  compareToggleText: { color: theme.color.accent, fontSize: theme.font.small, fontWeight: '700' },
  compareToggleTextOn: { color: theme.color.accentText },
  query: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text },
  counts: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5) },
  summary: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5) },
  exclusionNote: {
    fontSize: theme.font.small, color: theme.color.unknown, marginTop: theme.space(0.5),
    lineHeight: 18,
  },
  list: { padding: theme.space(2), paddingBottom: theme.space(5) },
  listWithBar: { paddingBottom: theme.space(12) },
  refine: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(1.5), marginBottom: theme.space(1.5),
  },
  refineTitle: {
    fontSize: theme.font.small, fontWeight: '700', color: theme.color.text,
    marginBottom: theme.space(1),
  },
  orderChip: {
    alignSelf: 'flex-start', backgroundColor: '#EAF0FE', borderRadius: 6,
    paddingHorizontal: theme.space(1), paddingVertical: 4, marginBottom: theme.space(1),
  },
  orderChipText: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600' },
  refineHistory: { marginBottom: theme.space(1) },
  refineHistoryItem: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 20 },
  resetBtn: { minHeight: theme.minTouch, justifyContent: 'center', marginTop: 2 },
  resetBtnText: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600' },
  refineInputRow: { flexDirection: 'row', gap: theme.space(1), alignItems: 'stretch' },
  refineInput: {
    flex: 1, minHeight: theme.minTouch, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius, paddingHorizontal: theme.space(1.5),
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.background,
  },
  refineSend: {
    minWidth: theme.minTouch + 8, minHeight: theme.minTouch, borderRadius: theme.radius,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: theme.space(1.5),
  },
  refineSendMuted: { opacity: 0.5 },
  refineSendText: { color: theme.color.accentText, fontWeight: '700', fontSize: theme.font.body },
  refineChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1), marginTop: theme.space(1) },
  refineChip: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radius, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.background,
  },
  refineChipText: { fontSize: theme.font.small, color: theme.color.text },
  refineNote: {
    marginTop: theme.space(1), fontSize: theme.font.small, color: theme.color.textMuted,
  },
  refineErrorBox: {
    marginTop: theme.space(1), padding: theme.space(1.5), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: '#FDF3F3',
  },
  refineErrorText: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },
  card: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(2), marginBottom: theme.space(1.5),
    minHeight: theme.minTouch,
  },
  cardPressed: { opacity: 0.75 },
  cardSelected: { borderColor: theme.color.accent, borderWidth: 2, backgroundColor: '#EAF0FE' },
  checkbox: { fontSize: 20, color: theme.color.textMuted },
  checkboxOn: { color: theme.color.accent },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1) },
  rank: {
    fontSize: theme.font.small, fontWeight: '700', color: theme.color.accentText,
    backgroundColor: theme.color.accent, paddingHorizontal: theme.space(1),
    paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  merchant: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text, flexShrink: 1 },
  totalLabel: {
    fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(1),
  },
  total: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text, marginTop: 1 },
  totalUnknown: { color: theme.color.unknown },
  badge: {
    marginTop: theme.space(1), alignSelf: 'flex-start',
    paddingHorizontal: theme.space(1), paddingVertical: 4, borderRadius: 6,
  },
  badgeText: { fontSize: theme.font.small, fontWeight: '600', backgroundColor: 'transparent' },
  badgeKnown: { color: theme.color.known, backgroundColor: '#E7F4EC' },
  badgeUnknown: { color: theme.color.unknown, backgroundColor: '#FBF1DC' },
  breakdown: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(1) },
  unknownList: {
    fontSize: theme.font.small, color: theme.color.textMuted, marginTop: theme.space(0.5),
  },
  cardRecommended: { borderColor: theme.color.accent, borderWidth: 2, backgroundColor: '#F4F7FF' },
  recommendedTag: {
    fontSize: theme.font.small, fontWeight: '700', color: theme.color.accent,
    marginLeft: 'auto',
  },
  whyBox: {
    marginTop: theme.space(1), paddingTop: theme.space(1),
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  whyHead: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '600', lineHeight: 19 },
  whyLine: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2, lineHeight: 19 },
  recovery: { marginTop: theme.space(1.5), paddingLeft: theme.space(1.5), borderLeftWidth: 3, borderLeftColor: theme.color.accent },
  recoveryText: { fontSize: theme.font.body, color: theme.color.text },
  recoveryImpact: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  recoveryAction: {
    marginTop: theme.space(1.5), padding: theme.space(1.5), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.accent, backgroundColor: '#F4F7FF',
    minHeight: theme.minTouch,
  },
  recoveryActionText: { fontSize: theme.font.body, color: theme.color.accent, fontWeight: '700' },
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
  compareBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: theme.space(2), backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  compareGo: {
    minHeight: theme.minTouch + 4, borderRadius: theme.radius,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
  },
  compareGoText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
});
