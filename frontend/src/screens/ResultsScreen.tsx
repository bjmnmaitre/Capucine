import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View,
  Dimensions, Animated,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay,
  interpolateColor, runOnJS,
} from 'react-native-reanimated';
import { RankedOffer, SearchResponse } from '../types';
import {
  availabilityEmphasisLabel, costLabel, explainOfferRanking, rankingPreferenceLabel,
  usageContextLabel,
} from '../presentation';
import { CERTAINTY_LABEL, displayText, formatMoney, priceLabel, formatScore, theme, textStyle } from '../theme.futuristic';
import { HolographicButton, GlassCard, ProductCard, NeuralLinearProgress, NeuralStageProgress, NeuralSearchInput } from '../components';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MAX_COMPARE = 3;

const REFINEMENTS = ['le moins cher', 'sans Amazon', 'uniquement du neuf', 'livraison rapide'];

function shippingLabel(offer: RankedOffer): { text: string; kind: 'free' | 'cost' | 'unknown' } {
  const s = offer.shipping;
  if (!s || s.status === 'unknown' || s.amount === null) {
    return { text: 'livraison inconnue', kind: 'unknown' };
  }
  if (s.amount === 0) {
    return { text: 'Livraison gratuite', kind: 'free' };
  }
  return { text: `livraison ${formatMoney(s.amount, s.currency)}`, kind: 'cost' };
}

function priceDisplay(offer: RankedOffer): { text: string; kind: 'none' | 'approximate' | 'exact' } {
  const p = offer.price;
  return priceLabel(p?.amount, p?.currency);
}

function isChrSpecialist(offer: RankedOffer): boolean {
  const merchantName = offer.merchant?.name?.toLowerCase() ?? '';
  const merchantUrl = offer.offerUrl?.toLowerCase() ?? '';
  const chrKeywords = ['chr', 'pro', 'professionnel', 'restaurant', 'cuisine', 'horeca', 'matériel', 'equipement', 'fournisseur', 'grossiste'];
  return chrKeywords.some(kw => merchantName.includes(kw) || merchantUrl.includes(kw));
}

interface OfferCardProps {
  offer: RankedOffer;
  allOffers: RankedOffer[];
  ranking: SearchResponse['rankingPreference'];
  availabilityEmphasis?: boolean;
  compareMode: boolean;
  selected: boolean;
  atCapacity: boolean;
  onPress: () => void;
  index: number;
}

const OfferCard = React.memo(function OfferCard({
  offer, allOffers, ranking, availabilityEmphasis, compareMode, selected, atCapacity, onPress, index,
}: OfferCardProps) {
  const t = theme;
  const styles = textStyle(t);

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

  // Animations
  const pressScale = useSharedValue(1);
  const glowIntensity = useSharedValue(0);
  const entryOpacity = useSharedValue(0);
  const entryTranslateY = useSharedValue(20);

  useEffect(() => {
    entryOpacity.value = withDelay(index * 60, withSpring(1, t.motion.spring.gentle));
    entryTranslateY.value = withDelay(index * 60, withSpring(0, t.motion.spring.gentle));
  }, [index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: entryOpacity.value,
    transform: [
      { scale: pressScale.value },
      { translateY: entryTranslateY.value },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: t.color.neural,
    shadowOpacity: glowIntensity.value * 0.3,
    shadowRadius: glowIntensity.value * 20,
    elevation: glowIntensity.value * 6,
  }));

  const handlePressIn = () => {
    pressScale.value = withSpring(0.98, t.motion.spring.snappy);
    glowIntensity.value = withTiming(1, { duration: 100 });
  };

  const handlePressOut = () => {
    pressScale.value = withSpring(1, t.motion.spring.standard);
    glowIntensity.value = withTiming(0, { duration: 200 });
  };

  return (
    <Animated.View style={[animatedStyle, glowStyle]} collapsable={false}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
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
        android_ripple={{ color: t.color.neural, borderless: true }}
      >
        <GlassCard variant={recommended && !compareMode ? 'neural' : selected ? 'pulse' : 'default'} style={styles.card}>
          {/* Card Header */}
          <View style={styles.cardHead}>
            {compareMode ? (
              <View style={styles.checkboxWrap}>
                <Animated.Text style={[
                  styles.checkbox,
                  { color: selected ? t.color.pulse : t.color.textFaint },
                  { transform: [{ scale: selected ? 1.2 : 1 }] },
                ]}>
                  {selected ? '✓' : ''}
                </Animated.Text>
              </View>
            ) : (
              <Animated.View style={[
                styles.rankBadge,
                { backgroundColor: recommended ? t.color.neural : t.color.pulse },
              ]}>
                <Animated.Text style={[
                  styles.rankText,
                  { color: recommended ? t.color.textInverse : t.color.textInverse },
                ]}>
                  #{offer.rank}
                </Animated.Text>
              </Animated.View>
            )}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.space(2) }}>
              <Text style={[styles.merchant, { color: t.color.text }]} numberOfLines={1}>
                {displayText(offer.merchant?.name, 'Marchand inconnu')}
              </Text>
              {offer.merchant?.country && (
                <Text style={[styles.micro, { color: t.color.textFaint, fontFamily: 'SpaceMono, monospace' }]}>
                  🇫🇷 {offer.merchant.country.toUpperCase()}
                </Text>
              )}
            </View>
            {recommended && !compareMode && (
              <View style={[
                styles.recommendedPill,
                { backgroundColor: t.color.neuralSoft, borderWidth: 1, borderColor: t.color.neural },
              ]}>
                <Text style={[styles.recommendedPillText, { color: t.color.neural }]}>RECOMMANDÉE</Text>
              </View>
            )}
            {isChrSpecialist(offer) && (
              <View style={[
                styles.chrPill,
                { backgroundColor: t.color.knownSoft, borderWidth: 1, borderColor: t.color.known },
              ]}>
                <Text style={[styles.chrPillText, { color: t.color.known }]}>SPÉCIALISTE CHR</Text>
              </View>
            )}
          </View>

          {/* Cost Total - Hero Number */}
          <View style={styles.totalSection}>
            <Text style={[styles.totalLabel, { color: t.color.textMuted }]}>
              {isTotalKnown ? 'COÛT TOTAL' : totalUnknown ? 'COÛT TOTAL' : 'COÛT TOTAL CONNU'}
            </Text>
            <Animated.Text style={[
              styles.totalValue,
              {
                color: totalUnknown ? t.color.unknown :
                       isTotalKnown ? t.color.known : t.color.text,
              },
            ]}>
              {totalUnknown ? 'INCONNU' : total}
            </Animated.Text>
          </View>

          {/* Certainty Badge */}
          <View style={styles.certaintyRow}>
            <Animated.View style={[
              styles.badge,
              {
                backgroundColor: offer.cost.certainty === 'known' ? t.color.knownSoft :
                               offer.cost.certainty === 'unknown' ? t.color.unknownSoft : t.color.dangerSoft,
                borderWidth: 1,
                borderColor: offer.cost.certainty === 'known' ? t.color.known :
                             offer.cost.certainty === 'unknown' ? t.color.unknown : t.color.danger,
              },
            ]}>
              <Text style={[
                styles.badgeText,
                {
                  color: offer.cost.certainty === 'known' ? t.color.known :
                         offer.cost.certainty === 'unknown' ? t.color.unknown : t.color.danger,
                },
              ]}>
                {CERTAINTY_LABEL[offer.cost.certainty] ?? offer.cost.certainty}
              </Text>
            </Animated.View>
            {offer.cost.statement && (
              <Text style={[styles.costStatement, { color: t.color.textMuted }]} numberOfLines={2}>
                {offer.cost.statement}
              </Text>
            )}
          </View>

          {/* Price Breakdown */}
          <View style={styles.breakdownRow}>
            <Text style={[
              styles.breakdownLabel,
              {
                color: priceInfo.kind === 'exact' ? t.color.known :
                       priceInfo.kind === 'approximate' ? t.color.unknown : t.color.textMuted,
                fontWeight: priceInfo.kind === 'exact' ? t.weight.bold : t.weight.regular,
              },
            ]}>
              {priceInfo.text}
            </Text>
            <Text style={[
              styles.breakdownLabel,
              {
                color: shippingInfo.kind === 'free' ? t.color.known :
                       shippingInfo.kind === 'cost' ? t.color.textMuted : t.color.textFaint,
                fontWeight: shippingInfo.kind === 'free' ? t.weight.semibold : t.weight.regular,
              },
            ]}>
              {shippingInfo.text}
            </Text>
          </View>

          {/* Unknown Components */}
          {!compareMode && offer.cost.unknownComponents.length > 0 && (
            <Text style={[styles.unknownList, { color: t.color.textMuted }]}>
              Non connu : {offer.cost.unknownComponents.join(', ')} — non estimé, non ignoré.
            </Text>
          )}

          {/* Why this rank */}
          {!compareMode && (
            <View style={[
              styles.whyBox,
              { borderTopWidth: 1, borderTopColor: t.color.glassBorder },
            ]}>
              {why.slice(0, 2).map((line, i) => (
                <Animated.Text key={i} style={[
                  i === 0 ? styles.whyHead : styles.whyLine,
                  { color: i === 0 ? t.color.text : t.color.textMuted },
                ]}>
                  {i === 0 ? line : `· ${line}`}
                </Animated.Text>
              ))}
            </View>
          )}
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
});

/**
 * Conversational refinement bar.
 */
function RefinementBar({
  response, refining, refineError, onRefine, onResetRefinements,
}: Pick<Props, 'response' | 'refining' | 'refineError' | 'onRefine' | 'onResetRefinements'>) {
  const [text, setText] = useState('');
  const history = response.session?.answeredQuestions ?? [];
  const canRefine = Boolean(response.session?.sessionId);
  const orderLabel = rankingPreferenceLabel(response.rankingPreference);
  const availabilityLabel = availabilityEmphasisLabel(response.availabilityEmphasis);
  const t = theme;
  const styles = textStyle(t);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || refining) return;
    setText('');
    onRefine(trimmed);
  }

  if (!canRefine) return null;

  return (
    <GlassCard variant="elevated" style={styles.refineCard}>
      <View style={styles.refineHeader}>
        <Text style={[styles.refineTitle, { color: t.color.text }]}>AFFINER LA RECHERCHE</Text>
        <HolographicButton
          variant="neural-ghost"
          size="sm"
          onPress={onResetRefinements}
          disabled={refining}
        >
          ↺ RESET
        </HolographicButton>
      </View>

      <View style={styles.refineStatus}>
        {orderLabel && (
          <View style={[
            styles.orderChip,
            { backgroundColor: t.color.neuralSoft, borderWidth: 1, borderColor: t.color.neural },
          ]}>
            <Text style={[styles.orderChipText, { color: t.color.neural }]}>{orderLabel}</Text>
          </View>
        )}
        {availabilityLabel && (
          <Text style={[styles.availabilityNote, { color: t.color.textMuted }]}>{availabilityLabel}</Text>
        )}
      </View>

      {history.length > 0 && (
        <View style={styles.refineHistory}>
          <Text style={[styles.micro, { color: t.color.textFaint, fontFamily: 'SpaceMono, monospace', marginBottom: t.space(1) }]}>
            AFFINAGES APPLIQUÉS
          </Text>
          {history.map((h, i) => (
            <Text key={`${h.questionId}-${i}`} style={[styles.refineHistoryItem, { color: t.color.textMuted }]}>
              ▸ {h.answer}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.refineInputRow}>
        <NeuralInput
          value={text}
          onChangeText={setText}
          placeholder="ex. le moins cher, livraison rapide…"
          error={refineError}
          disabled={refining}
          onSubmitEditing={() => submit(text)}
          style={styles.refineInput}
        />
        <HolographicButton
          variant="neural"
          size="md"
          onPress={() => submit(text)}
          disabled={refining || text.trim().length === 0}
          loading={refining}
        >
          APPLIQUER
        </HolographicButton>
      </View>

      <View style={styles.refineChips}>
        {response.rankingPreference?.applied
          && response.rankingPreference.preference === 'PRICE_LOWEST' ? (
          <HolographicButton
            variant="neural-ghost"
            size="sm"
            onPress={() => submit('trie par meilleure correspondance')}
            disabled={refining}
          >
            meilleure correspondance
          </HolographicButton>
        ) : null}
        {REFINEMENTS.map((r) => (
          <HolographicButton
            key={r}
            variant="neural-ghost"
            size="sm"
            onPress={() => submit(r)}
            disabled={refining}
          >
            {r}
          </HolographicButton>
        ))}
      </View>

      {refining && (
        <NeuralLinearProgress
          progress={0.5}
          variant="neural"
          height={3}
          animated={true}
          style={{ marginTop: t.space(2) }}
        />
      )}

      {refineError && (
        <View style={[
          styles.refineErrorBox,
          { backgroundColor: t.color.dangerSoft, borderWidth: 1, borderColor: t.color.danger },
        ]}>
          <Text style={[styles.refineErrorText, { color: t.color.danger }]}>{refineError}</Text>
        </View>
      )}
    </GlassCard>
  );
}

// Need to import NeuralInput
import { NeuralInput } from '../components/NeuralInput';

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
  const [listLayout, setListLayout] = useState<'list' | 'grid'>('list');

  useEffect(() => {
    setSelectedIds((cur) => {
      const kept = cur.filter((id) => results.some((r) => r.offerId === id));
      if (kept.length !== cur.length) setSelectionShrank(true);
      return kept.length === cur.length ? cur : kept;
    });
  }, [results]);

  const selectedOffers = results.filter((r) => selectedIds.includes(r.offerId));

  const toggleCompareMode = useCallback(() => {
    setCompareMode((on) => !on);
    setSelectedIds([]);
    setSelectionShrank(false);
  }, []);

  const toggleSelected = useCallback((offerId: string) => {
    setSelectionShrank(false);
    setSelectedIds((cur) => {
      if (cur.includes(offerId)) return cur.filter((id) => id !== offerId);
      if (cur.length >= MAX_COMPARE) return cur;
      return [...cur, offerId];
    });
  }, []);

  const canCompare = results.length >= 2;

  const usageNote = usageContextLabel(response.usageContext);

  const mx = response.merchantExclusions;
  const exclusionNote = mx && mx.hiddenOfferCount > 0
    ? `${mx.hiddenOfferCount} offre${mx.hiddenOfferCount > 1 ? 's' : ''} masquée${mx.hiddenOfferCount > 1 ? 's' : ''}`
      + ` (${mx.hiddenMerchants.join(', ')}) — marchand${mx.hiddenMerchants.length > 1 ? 's' : ''} que vous évitez.`
    : null;

  const t = theme;
  const styles = textStyle(t);

  // Header animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(-20);
  useEffect(() => {
    headerOpacity.value = withSpring(1, t.motion.spring.gentle);
    headerTranslateY.value = withSpring(0, t.motion.spring.gentle);
  }, []);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const listContentStyle = useMemo(() => [
    styles.list,
    compareMode && selectedOffers.length >= 2 && styles.listWithBar,
    { paddingTop: t.space(2) },
  ], [compareMode, selectedOffers.length]);

  return (
    <View style={styles.flex}>
      {/* Sticky Header */}
      <Animated.View style={[styles.header, headerAnimatedStyle]}>
        <View style={styles.headerTop}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Revenir à la recherche"
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <HolographicButton variant="neural-ghost" size="sm" iconLeft={<Text style={{ fontSize: 18 }}>←</Text>} onPress={onBack}>
              RECHERCHE
            </HolographicButton>
          </Pressable>
          {(compareMode || canCompare) && (
            <HolographicButton
              variant={compareMode ? 'pulse' : 'neural-ghost'}
              size="sm"
              onPress={toggleCompareMode}
              accessibilityRole="button"
              accessibilityLabel={compareMode ? 'Quitter le mode comparaison' : 'Comparer des offres'}
              accessibilityState={{ selected: compareMode }}
              iconLeft={<Text style={{ fontSize: 18 }}>⇄</Text>}
            >
              {compareMode ? 'ANNULER' : 'COMPARER'}
            </HolographicButton>
          )}
        </View>
        <Text style={[styles.query, { color: t.color.text }]} numberOfLines={2}>{query}</Text>
        <View style={styles.headerStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: t.color.neural }]}>{results.length}</Text>
            <Text style={[styles.statLabel, { color: t.color.textMuted }]}>OFFRES</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: t.color.pulse }]}>{merchantIds.size}</Text>
            <Text style={[styles.statLabel, { color: t.color.textMuted }]}>MARCHANDS</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: t.color.known }]}>{productIds.size}</Text>
            <Text style={[styles.statLabel, { color: t.color.textMuted }]}>PRODUITS</Text>
          </View>
        </View>
        <View style={styles.headerMeta}>
          {compareMode ? (
            <Text style={[styles.summary, { color: t.color.textMuted }]}>
              {selectionShrank
                ? "Une offre sélectionnée a disparu après l'affinage — sélection ajustée. "
                : ''}
              Choisissez 2 ou 3 offres à comparer ({selectedOffers.length}/{MAX_COMPARE}).
            </Text>
          ) : response.summary?.resultSummary ? (
            <Text style={[styles.summary, { color: t.color.textMuted }]}>{response.summary.resultSummary}</Text>
          ) : null}
          {!compareMode && usageNote && (
            <Text style={[styles.usageNote, { color: t.color.textMuted, fontStyle: 'italic' }]}>{usageNote}</Text>
          )}
          {!compareMode && exclusionNote && (
            <Text style={[styles.exclusionNote, { color: t.color.unknown }]}>{exclusionNote}</Text>
          )}
        </View>
        <HolographicButton
          variant="neural-ghost"
          size="sm"
          fullWidth
          onPress={() => setListLayout(l => l === 'list' ? 'grid' : 'list')}
          iconLeft={<Text style={{ fontSize: 18 }}>{listLayout === 'list' ? '⊞' : '☰'}</Text>}
        >
          {listLayout === 'list' ? 'GRILLE' : 'LISTE'}
        </HolographicButton>
      </Animated.View>

      {results.length === 0 ? (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <RefinementBar
            response={response}
            refining={refining}
            refineError={refineError}
            onRefine={onRefine}
            onResetRefinements={onResetRefinements}
          />
          <GlassCard variant="default" style={styles.emptyCard}>
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.color.text }]}>AUCUNE OFFRE TROUVÉE</Text>
              <Text style={[styles.emptyBody, { color: t.color.textMuted }]}>
                {response.noResultsDiagnosis?.message ??
                  "Capucine n'a trouvé aucune offre correspondant à cette demande."}
              </Text>
              {(response.noResultsDiagnosis?.recoveryOptions ?? []).map((option) =>
                REFORMULATE_OPTION_TYPES.has(option.type) ? (
                  <HolographicButton
                    key={option.id}
                    variant="neural"
                    size="md"
                    fullWidth
                    onPress={() => onReformulate(query)}
                    accessibilityRole="button"
                    accessibilityLabel={option.description}
                    style={{ marginTop: t.space(2) }}
                  >
                    {option.description}
                    {option.impact && <Text style={{ fontSize: theme.font.micro, opacity: 0.7 }}>{option.impact}</Text>}
                  </HolographicButton>
                ) : (
                  <View key={option.id} style={styles.recovery}>
                    <Text style={[styles.recoveryText, { color: t.color.text }]}>{option.description}</Text>
                    {option.impact && <Text style={[styles.recoveryImpact, { color: t.color.textMuted }]}>{option.impact}</Text>}
                  </View>
                )
              )}
              {response.searchPlan?.searchContext === 'restaurant_equipment' && (
                <GlassCard variant="neural" style={styles.chrSuggestion}>
                  <Text style={[styles.chrSuggestionTitle, { color: t.color.neural }]}>💡 SUGGESTION CHR</Text>
                  <Text style={[styles.chrSuggestionBody, { color: t.color.textMuted }]}>
                    Essayez avec des termes plus précis : "four professionnel", "réfrigérateur CHR",
                    "piano de cuisson", "friteuse professionnelle", "chambre froide"…
                  </Text>
                </GlassCard>
              )}
            </View>
          </GlassCard>
        </ScrollView>
      ) : (
        <>
          <FlatList
            data={results}
            keyExtractor={(item) => item.offerId}
            contentContainerStyle={listContentStyle}
            keyboardShouldPersistTaps="handled"
            numColumns={listLayout === 'grid' ? 2 : 1}
            columnWrapperStyle={listLayout === 'grid' ? { justifyContent: 'space-between' } : undefined}
            ListHeaderComponent={
              <RefinementBar
                response={response}
                refining={refining}
                refineError={refineError}
                onRefine={onRefine}
                onResetRefinements={onResetRefinements}
              />
            }
            renderItem={({ item, index }) => (
              <OfferCard
                offer={item}
                allOffers={results}
                ranking={response.rankingPreference}
                availabilityEmphasis={response.availabilityEmphasis}
                compareMode={compareMode}
                selected={selectedIds.includes(item.offerId)}
                atCapacity={selectedIds.length >= MAX_COMPARE}
                onPress={() => (compareMode ? toggleSelected(item.offerId) : onSelect(item))}
                index={index}
              />
            )}
            ListFooterComponent={
              <View style={styles.footer}>
                <Text style={[styles.footerText, { color: t.color.textFaint, fontFamily: 'SpaceMono, monospace' }]}>
                  Classement par le moteur de priorité de Capucine · Pas par le prix seul
                </Text>
              </View>
            }
          />

          {compareMode && selectedOffers.length >= 2 && (
            <View style={styles.compareBar}>
              <HolographicButton
                variant="pulse"
                size="lg"
                fullWidth
                onPress={() => onCompare(selectedOffers)}
                accessibilityRole="button"
                accessibilityLabel={`Comparer les ${selectedOffers.length} offres sélectionnées`}
                iconLeft={<Text style={{ fontSize: 20 }}>⇄</Text>}
              >
                COMPARER ({selectedOffers.length})
              </HolographicButton>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// Need to import REFORMULATE_OPTION_TYPES
const REFORMULATE_OPTION_TYPES = new Set(['expand_search_terms']);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  header: {
    padding: theme.space(3),
    paddingTop: theme.space(4),
    backgroundColor: theme.color.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.glassBorder,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1) },
  backText: { color: theme.color.neural, fontSize: theme.font.body, fontWeight: '600', fontFamily: 'SpaceMono, monospace' },
  query: { fontSize: theme.font.heading, fontWeight: theme.weight.bold, color: theme.color.text, marginTop: theme.space(2), letterSpacing: -0.3 },
  headerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: theme.space(3),
    paddingVertical: theme.space(2),
    backgroundColor: theme.color.glass,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: theme.font.title, fontWeight: theme.weight.extrabold, fontFamily: 'SpaceMono, monospace' },
  statLabel: { fontSize: theme.font.micro, fontWeight: theme.weight.medium, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: theme.color.glassBorder },
  headerMeta: { marginTop: theme.space(3), gap: theme.space(2) },
  summary: { fontSize: theme.font.small, lineHeight: theme.leading.small },
  usageNote: { fontSize: theme.font.small, lineHeight: theme.leading.small, fontStyle: 'italic' },
  exclusionNote: { fontSize: theme.font.small, lineHeight: theme.leading.small },
  list: { padding: theme.space(3), paddingBottom: theme.space(12), gap: theme.space(3) },
  listWithBar: { paddingBottom: theme.space(16) },

  // Refinement Bar
  refineCard: { padding: theme.space(3) },
  refineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space(2) },
  refineTitle: { fontSize: theme.font.label, fontWeight: theme.weight.bold, letterSpacing: 0.8, fontFamily: 'SpaceMono, monospace' },
  refineStatus: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2), marginBottom: theme.space(3) },
  orderChip: { paddingHorizontal: theme.space(2), paddingVertical: theme.space(1), borderRadius: theme.radii.pill },
  orderChipText: { fontSize: theme.font.small, fontWeight: theme.weight.semibold },
  availabilityNote: { fontSize: theme.font.small, fontWeight: theme.weight.medium, alignSelf: 'center' },
  refineHistory: { marginBottom: theme.space(3), paddingVertical: theme.space(2), borderTopWidth: 1, borderTopColor: t.color.glassBorder },
  refineHistoryItem: { fontSize: theme.font.small, lineHeight: theme.leading.small },
  refineInputRow: { flexDirection: 'row', gap: theme.space(2), alignItems: 'stretch' },
  refineInput: { flex: 1 },
  refineChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2), marginTop: theme.space(2) },
  refineErrorBox: { marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radii.md },
  refineErrorText: { fontSize: theme.font.small, fontWeight: theme.weight.semibold },

  // Card
  card: { width: listLayout === 'grid' ? (SCREEN_WIDTH - theme.space(3) * 3) / 2 : '100%', minHeight: 180 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2), marginBottom: theme.space(2) },
  checkboxWrap: { width: 32, alignItems: 'center' },
  checkbox: { fontSize: 24, fontWeight: theme.weight.bold },
  rankBadge: {
    minWidth: 36, minHeight: 36, borderRadius: theme.radii.sm,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.neuralGlow,
  },
  rankText: { fontSize: theme.font.small, fontWeight: theme.weight.bold, fontFamily: 'SpaceMono, monospace' },
  merchant: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, flexShrink: 1 },
  recommendedPill: { paddingHorizontal: theme.space(2), paddingVertical: theme.space(0.5), borderRadius: theme.radii.pill },
  recommendedPillText: { fontSize: theme.font.micro, fontWeight: theme.weight.bold, fontFamily: 'SpaceMono, monospace' },
  chrPill: { paddingHorizontal: theme.space(2), paddingVertical: theme.space(0.5), borderRadius: theme.radii.pill },
  chrPillText: { fontSize: theme.font.micro, fontWeight: theme.weight.bold, fontFamily: 'SpaceMono, monospace' },

  totalSection: { marginBottom: theme.space(2) },
  totalLabel: { fontSize: theme.font.label, fontWeight: theme.weight.bold, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: 'SpaceMono, monospace', marginBottom: theme.space(1) },
  totalValue: { fontSize: theme.font.display, fontWeight: theme.weight.extrabold, letterSpacing: -0.5, fontFamily: 'SpaceMono, monospace' },

  certaintyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(2), marginBottom: theme.space(2) },
  badge: { paddingHorizontal: theme.space(2), paddingVertical: theme.space(1), borderRadius: theme.radii.sm, borderWidth: 1 },
  badgeText: { fontSize: theme.font.micro, fontWeight: theme.weight.bold, fontFamily: 'SpaceMono, monospace' },
  costStatement: { fontSize: theme.font.small, flex: 1, marginTop: 2 },

  breakdownRow: { flexDirection: 'row', gap: theme.space(3), marginBottom: theme.space(2), paddingTop: theme.space(2), borderTopWidth: 1, borderTopColor: t.color.glassBorder },
  breakdownLabel: { fontSize: theme.font.small, fontFamily: 'SpaceMono, monospace' },
  unknownList: { fontSize: theme.font.small, marginTop: theme.space(1) },

  whyBox: { paddingTop: theme.space(2), borderTopWidth: 1, borderTopColor: t.color.glassBorder },
  whyHead: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, lineHeight: theme.leading.small },
  whyLine: { fontSize: theme.font.small, marginTop: theme.space(1), lineHeight: theme.leading.small },

  // Empty State
  emptyCard: { marginTop: theme.space(2) },
  empty: { padding: theme.space(6), alignItems: 'center' },
  emptyTitle: { fontSize: theme.font.title, fontWeight: theme.weight.extrabold, textAlign: 'center', letterSpacing: -0.5, marginBottom: theme.space(2) },
  emptyBody: { fontSize: theme.font.body, textAlign: 'center', lineHeight: theme.leading.body, maxWidth: 300, marginBottom: theme.space(4) },
  recovery: { width: '100%', paddingHorizontal: theme.space(3), marginTop: theme.space(2) },
  recoveryText: { fontSize: theme.font.body, marginBottom: theme.space(1) },
  recoveryImpact: { fontSize: theme.font.small },

  // CHR Suggestion
  chrSuggestion: { marginTop: theme.space(3) },
  chrSuggestionTitle: { fontSize: theme.font.small, fontWeight: theme.weight.bold, marginBottom: theme.space(1) },
  chrSuggestionBody: { fontSize: theme.font.small, lineHeight: theme.leading.small },

  // Footer
  footer: { padding: theme.space(4), alignItems: 'center' },
  footerText: { fontSize: theme.font.micro, textAlign: 'center' },

  // Compare Bar
  compareBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: theme.space(3),
    backgroundColor: theme.color.backgroundElevated,
    borderTopWidth: 1, borderTopColor: theme.color.glassBorder,
    ...theme.shadow.glassStrong,
  },
});

export default ResultsScreen;