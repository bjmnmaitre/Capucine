import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, Dimensions, Image,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay,
  interpolateColor, useAnimatedReaction, runOnJS
} from 'react-native-reanimated';
import { theme, textStyle, glassStyle, neuralGlassStyle, AgentChatBubbleProps } from '../theme.futuristic';
import { HealthStatus } from '../api';
import { suggest, SuggestResponse } from '../api';
import {
  clearHistory, loadHistory, relativeTime, removeSearch, SearchHistoryEntry,
} from '../history';
import { NeuralSearchInput, HolographicButton, GlassCard, AgentChatBubble, NeuralStageProgress } from '../components';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const EXAMPLES = [
  'casque Sony WH-1000XM5',
  'MacBook Air M4 16 Go',
  'chaussures de running homme',
];
const CHR_EXAMPLES = [
  'four professionnel pizza La Rochelle',
  'friteuse CHR',
  'chambre froide restaurant',
  'piano de cuisson professionnel',
];

interface Props {
  loading: boolean;
  error: string | null;
  health?: HealthStatus;
  checkingHealth?: boolean;
  onRecheckHealth?: () => void;
  initialQuery?: string;
  onSearch: (query: string) => void;
  onOpenProfile: () => void;
}

export function SearchScreen({
  loading, error, health, checkingHealth, onRecheckHealth,
  initialQuery, onSearch, onOpenProfile,
}: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [touched, setTouched] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentChatBubbleProps[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchStage, setSearchStage] = useState<'idle' | 'interpreting' | 'searching' | 'analyzing' | 'ranking' | 'complete'>('idle');
  const [agentTyping, setAgentTyping] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styles = textStyle(theme);

  // Animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(-30);
  const inputOpacity = useSharedValue(0);
  const inputTranslateY = useSharedValue(20);
  const examplesOpacity = useSharedValue(0);
  const examplesTranslateY = useSharedValue(20);
  const searchProgress = useSharedValue(0);
  const pulseAnim = useSharedValue(0);

  // Entrance animations
  useEffect(() => {
    headerOpacity.value = withDelay(100, withSpring(1, theme.motion.spring.gentle));
    headerTranslateY.value = withDelay(100, withSpring(0, theme.motion.spring.gentle));
    inputOpacity.value = withDelay(300, withSpring(1, theme.motion.spring.gentle));
    inputTranslateY.value = withDelay(300, withSpring(0, theme.motion.spring.gentle));
    examplesOpacity.value = withDelay(500, withSpring(1, theme.motion.spring.gentle));
    examplesTranslateY.value = withDelay(500, withSpring(0, theme.motion.spring.gentle));
  }, []);

  // Pulse animation for listening state
  useEffect(() => {
    if (searchStage === 'interpreting') {
      pulseAnim.value = withTiming(1, { duration: 1000, easing: (t) => t }, () => {
        pulseAnim.value = withTiming(0, { duration: 1000, easing: (t) => t });
      });
    }
  }, [searchStage]);

  // Load history on mount
  useEffect(() => {
    let alive = true;
    void loadHistory().then((h) => { if (alive) setHistory(h); });
    return () => { alive = false; };
  }, []);

  // Initial agent greeting
  useEffect(() => {
    if (initialQuery) return;
    setAgentMessages([
      {
        message: "Bonjour ! Je suis Capucine, votre agent d'achat intelligent. Dites-moi ce que vous cherchez et je comparerai les offres réelles pour vous.",
        sender: 'agent',
        timestamp: new Date(),
        certainty: 'known',
      },
    ]);
  }, [initialQuery]);

  const fetchSuggestions = useCallback(async (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length < 3) {
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const response: SuggestResponse = await suggest(text);
        if (response.suggestions && response.suggestions.length > 0) {
          setShowSuggestions(true);
        }
      } catch {
        setShowSuggestions(false);
      }
    }, 200);
  }, []);

  const trimmed = query.trim();
  const isEmpty = trimmed.length === 0;

  const startSearch = async () => {
    setTouched(true);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isEmpty) return;

    setSearchStage('interpreting');
    setAgentTyping(true);
    setAgentMessages(prev => [...prev, {
      message: trimmed,
      sender: 'user',
      timestamp: new Date(),
    }]);

    // Simulate agent thinking
    setTimeout(() => {
      setSearchStage('searching');
      setAgentMessages(prev => [...prev, {
        message: "J'analyse votre demande et je lance la recherche sur les sources disponibles...",
        sender: 'agent',
        timestamp: new Date(),
        typing: true,
      }]);
    }, 800);

    onSearch(trimmed);
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (touched) setTouched(false);
    fetchSuggestions(text);
  };

  const selectSuggestion = (suggestion: string) => {
    setQuery(suggestion);
    setShowSuggestions(false);
    startSearch();
  };

  const clearHistoryHandler = async () => {
    await clearHistory();
    setHistory([]);
  };

  const removeRecent = async (q: string) => {
    setHistory(await removeSearch(q));
  };

  // Animated styles
  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const inputAnimatedStyle = useAnimatedStyle(() => ({
    opacity: inputOpacity.value,
    transform: [{ translateY: inputTranslateY.value }],
  }));

  const examplesAnimatedStyle = useAnimatedStyle(() => ({
    opacity: examplesOpacity.value,
    transform: [{ translateY: examplesTranslateY.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolateColor(pulseAnim.value, [0, 0.5, 1], [0.3, 1, 0.3]),
    transform: [{ scale: interpolateColor(pulseAnim.value, [0, 0.5, 1], [1, 1.05, 1]) }],
  }));

  const searchStages = useMemo(() => [
    { id: 'interpreting', label: 'Interprétation', status: searchStage === 'interpreting' ? 'active' : searchStage === 'idle' ? 'pending' : 'complete' },
    { id: 'searching', label: 'Recherche', status: searchStage === 'searching' ? 'active' : searchStage === 'interpreting' ? 'pending' : searchStage === 'idle' ? 'pending' : 'complete' },
    { id: 'analyzing', label: 'Analyse', status: searchStage === 'analyzing' ? 'active' : searchStage === 'searching' ? 'pending' : searchStage === 'idle' ? 'pending' : 'complete' },
    { id: 'ranking', label: 'Classement', status: searchStage === 'ranking' ? 'active' : searchStage === 'analyzing' ? 'pending' : searchStage === 'idle' ? 'pending' : 'complete' },
    { id: 'complete', label: 'Terminé', status: searchStage === 'complete' ? 'complete' : 'pending' },
  ], [searchStage]);

  const isOffline = health && !health.reachable;
  const isWebUnavailable = health?.reachable && health.webSearch && health.webSearch !== 'configured';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header with Agent Avatar */}
        <Animated.View style={[styles.header, headerAnimatedStyle]}>
          <View style={styles.agentAvatarWrapper}>
            <Animated.View style={[
              styles.agentAvatar,
              pulseStyle,
              { backgroundColor: theme.color.neuralSoft },
            ]}>
              <Image
                source={require('../assets/agent-avatar.png')}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
              <View style={StyleSheet.absoluteFillObject}>
                <View style={[
                  styles.avatarPulse,
                  { borderColor: theme.color.neural },
                ]} />
              </View>
            </Animated.View>
          </View>
          <Text style={[styles.title, styles.mono]}>CAPUCINE</Text>
          <Text style={styles.subtitle}>
            Agent d'achat autonome · Recherche · Analyse · Décision
          </Text>
        </Animated.View>

        {/* Connection Status */}
        {(isOffline || isWebUnavailable) && (
          <Animated.View style={[styles.statusCard, inputAnimatedStyle]}>
            <GlassCard variant={isOffline ? 'pulse' : 'neural'} style={styles.statusContent}>
              <View style={styles.statusRow}>
                <Text style={[
                  styles.statusIcon,
                  { color: isOffline ? theme.color.pulse : theme.color.neural },
                ]}>
                  {isOffline ? '⚠' : '🌐'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statusTitle, { color: isOffline ? theme.color.pulse : theme.color.neural }]}>
                    {isOffline
                      ? (health?.configured ? 'Connexion impossible' : 'Service non configuré')
                      : 'Recherche Web indisponible'}
                  </Text>
                  <Text style={styles.statusBody}>
                    {isOffline
                      ? (health?.configured
                          ? 'Impossible de joindre le service. Vérifiez votre connexion.'
                          : 'Aucun endpoint de service configuré. Relancez avec le tunnel de développement.')
                      : 'Aucune source Web réelle configurée (SERPER_API_KEY). Résultats limités au catalogue local.'}
                  </Text>
                </View>
                {isOffline && health?.configured && (
                  <HolographicButton
                    variant="pulse-ghost"
                    size="sm"
                    onPress={onRecheckHealth}
                    disabled={checkingHealth}
                  >
                    {checkingHealth ? '⟳' : 'Réessayer'}
                  </HolographicButton>
                )}
              </View>
            </GlassCard>
          </Animated.View>
        )}

        {/* Conversational Interface */}
        {agentMessages.length > 0 && (
          <Animated.View style={[styles.chatSection, inputAnimatedStyle]}>
            <Text style={[styles.sectionTitle, styles.mono]}>CONVERSATION</Text>
            <View style={styles.chatContainer}>
              {agentMessages.map((msg, idx) => (
                <AgentChatBubble
                  key={`${msg.sender}-${idx}`}
                  {...msg}
                  animated={true}
                />
              ))}
              {agentTyping && (
                <AgentChatBubble
                  key="typing"
                  message=""
                  sender="agent"
                  typing={true}
                  animated={true}
                />
              )}
            </View>
          </Animated.View>
        )}

        {/* Search Progress */}
        {searchStage !== 'idle' && searchStage !== 'complete' && (
          <Animated.View style={[styles.progressSection, inputAnimatedStyle]}>
            <Text style={[styles.sectionTitle, styles.mono]}>PROGRESSION</Text>
            <GlassCard variant="elevated" style={styles.progressCard}>
              <NeuralStageProgress
                stages={searchStages}
                variant="neural"
                showDetails={true}
              />
            </GlassCard>
          </Animated.View>
        )}

        {/* Input Area */}
        <Animated.View style={[styles.inputSection, inputAnimatedStyle]}>
          <Text style={[styles.sectionTitle, styles.mono]}>RECHERCHE</Text>
          <NeuralSearchInput
            label="Votre recherche"
            placeholder="Ex: four professionnel pizza La Rochelle, friteuse CHR, casque Sony…"
            value={query}
            onChangeText={handleQueryChange}
            onSearch={startSearch}
            loading={loading}
            onVoiceSearch={() => { /* TODO: Voice search */ }}
            suggestions={showSuggestions ? EXAMPLES.filter(e => e.toLowerCase().includes(query.toLowerCase())).slice(0, 5) : []}
            onSuggestionPress={selectSuggestion}
            disabled={loading}
            error={touched && isEmpty ? 'Saisissez un produit avant de lancer la recherche.' : undefined}
          />
          {loading && searchStage !== 'idle' && (
            <Text style={[styles.loadingNote, { color: theme.color.textMuted }]}>
              Recherche en cours : interprétation, sources, coût réel, classement…
            </Text>
          )}
        </Animated.View>

        {/* Error Display */}
        {error && (
          <Animated.View style={[styles.errorSection, inputAnimatedStyle]}>
            <GlassCard variant="pulse" style={styles.errorCard}>
              <View style={styles.errorContent}>
                <Text style={[styles.errorIcon, { color: theme.color.pulse }]}>⚠</Text>
                <View>
                  <Text style={[styles.errorTitle, { color: theme.color.pulse }]}>
                    Recherche indisponible
                  </Text>
                  <Text style={[styles.errorSubtitle, { color: theme.color.textMuted }]}>
                    {error}
                  </Text>
                </View>
              </View>
              <HolographicButton
                variant="pulse"
                size="sm"
                onPress={() => startSearch()}
                disabled={loading}
              >
                Réessayer
              </HolographicButton>
            </GlassCard>
          </Animated.View>
        )}

        {/* History & Examples */}
        {(history.length > 0 || !query) && (
          <Animated.View style={[styles.examplesSection, examplesAnimatedStyle]}>
            {history.length > 0 && (
              <View style={styles.historyBlock}>
                <View style={styles.historyHeader}>
                  <Text style={[styles.sectionTitle, styles.mono]}>HISTORIQUE</Text>
                  <HolographicButton
                    variant="neural-ghost"
                    size="sm"
                    onPress={clearHistoryHandler}
                    disabled={loading}
                  >
                    Effacer
                  </HolographicButton>
                </View>
                {history.map((h) => (
                  <Pressable
                    key={`${h.query}-${h.at}`}
                    onPress={() => { setTouched(false); onSearch(h.query); }}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel={`Relancer : ${h.query}. ${h.resultCount} résultat${h.resultCount > 1 ? 's' : ''}, ${relativeTime(h.at)}`}
                    style={({ pressed }) => [styles.historyItem, pressed && styles.historyItemPressed]}
                  >
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={[styles.historyQuery, { color: theme.color.text }]}>
                        {h.query}
                      </Text>
                      <Text style={[styles.historyMeta, { color: theme.color.textMuted }]}>
                        {h.resultCount} offre{h.resultCount > 1 ? 's' : ''} · {relativeTime(h.at)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeRecent(h.query)}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityLabel={`Retirer « ${h.query} » de l'historique`}
                      hitSlop={10}
                      style={styles.historyDelete}
                    >
                      <Text style={{ color: theme.color.textFaint, fontSize: 18 }}>✕</Text>
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}

            {!query && (
              <>
                <Text style={[styles.sectionTitle, styles.mono]}>EXEMPLES</Text>
                <GlassCard variant="default" style={styles.examplesGrid}>
                  {EXAMPLES.map((ex) => (
                    <Pressable
                      key={ex}
                      onPress={() => { setQuery(ex); setTouched(false); }}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityLabel={`Utiliser l'exemple : ${ex}`}
                      style={({ pressed }) => [styles.exampleChip, pressed && styles.exampleChipPressed]}
                    >
                      <Text style={styles.exampleChipText}>{ex}</Text>
                    </Pressable>
                  ))}
                </GlassCard>

                <Text style={[styles.sectionTitle, styles.mono]}>MATÉRIEL CHR</Text>
                <GlassCard variant="default" style={styles.examplesGrid}>
                  {CHR_EXAMPLES.map((ex) => (
                    <Pressable
                      key={ex}
                      onPress={() => { setQuery(ex); setTouched(false); }}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityLabel={`Utiliser l'exemple : ${ex}`}
                      style={({ pressed }) => [styles.exampleChip, pressed && styles.exampleChipPressed]}
                    >
                      <Text style={styles.exampleChipText}>{ex}</Text>
                    </Pressable>
                  ))}
                </GlassCard>
              </>
            )}
          </Animated.View>
        )}

        {/* Profile Link */}
        <Animated.View style={[styles.profileSection, examplesAnimatedStyle]}>
          <Pressable
            onPress={onOpenProfile}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Ouvrir vos préférences permanentes"
            style={({ pressed }) => [styles.profileLink, pressed && { opacity: 0.7 }]}
          >
            <HolographicButton
              variant="neural-ghost"
              size="md"
              fullWidth
              onPress={onOpenProfile}
              disabled={loading}
              iconLeft={<Text style={{ fontSize: 20 }}>⚙</Text>}
            >
              Vos préférences permanentes
            </HolographicButton>
          </Pressable>
        </Animated.View>

        {/* Footer Status */}
        {health?.reachable && (
          <Animated.View style={[styles.footer, examplesAnimatedStyle]}>
            <Text style={styles.apiNote}>
              {`Service connecté${health.webSearch === 'configured' ? ' · Recherche Web active' : ''}`}
              {`${health.aiStatus === 'real' ? ' · IA activée' : ''}`}
            </Text>
          </Animated.View>
        )}
      </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  container: { padding: theme.space(4), paddingBottom: theme.space(8), gap: theme.space(4) },

  // Header
  header: { alignItems: 'center', paddingTop: theme.space(2), gap: theme.space(2) },
  agentAvatarWrapper: { position: 'relative' },
  agentAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    ...theme.shadow.neuralGlow,
  },
  avatarPulse: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 40,
    borderWidth: 2,
  },
  title: {
    fontSize: theme.font.display,
    fontWeight: theme.weight.extrabold,
    color: theme.color.text,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: theme.font.small,
    color: theme.color.textMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  mono: { fontFamily: 'SpaceMono, monospace' },

  // Status Card
  statusCard: { width: '100%' },
  statusContent: { padding: theme.space(3) },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(3) },
  statusIcon: { fontSize: 24, marginTop: 2 },
  statusTitle: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, marginBottom: theme.space(0.5) },
  statusBody: { fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: theme.leading.small },

  // Chat Section
  chatSection: { gap: theme.space(2) },
  sectionTitle: {
    fontSize: theme.font.label,
    fontWeight: theme.weight.bold,
    color: theme.color.textMuted,
    letterSpacing: 0.8,
  },
  chatContainer: { gap: theme.space(2) },

  // Progress Section
  progressSection: { gap: theme.space(2) },
  progressCard: { padding: theme.space(2) },

  // Input Section
  inputSection: { gap: theme.space(2) },
  loadingNote: { fontSize: theme.font.small, textAlign: 'center' },

  // Error Section
  errorSection: { width: '100%' },
  errorCard: { padding: theme.space(3) },
  errorContent: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(2) },
  errorIcon: { fontSize: 24, marginTop: 2 },
  errorTitle: { fontSize: theme.font.body, fontWeight: theme.weight.bold, marginBottom: theme.space(0.5) },
  errorSubtitle: { fontSize: theme.font.small, lineHeight: theme.leading.small },

  // History & Examples
  examplesSection: { gap: theme.space(4) },
  historyBlock: { gap: theme.space(2) },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.space(3),
    backgroundColor: theme.color.glass,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
    borderRadius: theme.radii.md,
    gap: theme.space(3),
  },
  historyItemPressed: { opacity: 0.7 },
  historyQuery: { fontSize: theme.font.body, flex: 1 },
  historyMeta: { fontSize: theme.font.small, marginTop: 2 },
  historyDelete: { padding: theme.space(1) },

  examplesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
    padding: theme.space(3),
  },
  exampleChip: {
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    borderRadius: theme.radii.pill,
    backgroundColor: theme.color.glass,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
    minHeight: theme.minTouch,
    justifyContent: 'center',
  },
  exampleChipPressed: { opacity: 0.7, borderColor: theme.color.neural },
  exampleChipText: { fontSize: theme.font.small, color: theme.color.text, fontWeight: theme.weight.medium },

  // Profile Section
  profileSection: { paddingTop: theme.space(2) },
  profileLink: { width: '100%' },

  // Footer
  footer: { paddingTop: theme.space(4), alignItems: 'center' },
  apiNote: {
    fontSize: theme.font.micro,
    color: theme.color.textFaint,
    textAlign: 'center',
    fontFamily: 'SpaceMono, monospace',
  },
});

export default SearchScreen;