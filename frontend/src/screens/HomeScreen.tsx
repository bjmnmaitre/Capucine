import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, View, Dimensions, Image, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay,
  interpolateColor, runOnJS,
} from 'react-native-reanimated';
import { HealthStatus } from '../api';
import { theme, textStyle, glassStyle, neuralGlassStyle, pulseGlassStyle } from '../theme.futuristic';
import { HolographicButton, GlassCard, AgentChatBubble, NeuralProgressRing, NeuralStageProgress, NeuralSearchInput } from '../components';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const SUGGESTIONS = [
  { id: 'cheapest', text: 'Trouver le moins cher', icon: '💰', category: 'price' },
  { id: 'compare', text: 'Comparer plusieurs offres', icon: '⚖️', category: 'compare' },
  { id: 'search', text: 'Rechercher un produit', icon: '🔍', category: 'search' },
  { id: 'chr', text: 'Matériel CHR / Pro', icon: '🏭', category: 'chr' },
  { id: 'local', text: 'Produits français uniquement', icon: '🇫🇷', category: 'origin' },
  { id: 'sustainable', text: 'Options durables / reconditionné', icon: '♻️', category: 'eco' },
] as const;

interface Props {
  loading: boolean;
  error: string | null;
  health?: HealthStatus;
  checkingHealth?: boolean;
  onRecheckHealth?: () => void;
  initialQuery?: string;
  lastQuery?: string | null;
  onSearch: (query: string) => void;
  onResume: () => void;
}

export function HomeScreen({
  loading, error, health, checkingHealth, onRecheckHealth,
  initialQuery, lastQuery, onSearch, onResume,
}: Props) {
  const [text, setText] = useState(initialQuery ?? '');
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showAgentChat, setShowAgentChat] = useState(false);
  const inputRef = useRef<any>(null);
  const insets = useSafeAreaInsets();

  const styles = textStyle(theme);

  // Animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(-30);
  const heroOpacity = useSharedValue(0);
  const heroTranslateY = useSharedValue(30);
  const searchOpacity = useSharedValue(0);
  const searchTranslateY = useSharedValue(30);
  const suggestionsOpacity = useSharedValue(0);
  const suggestionsTranslateY = useSharedValue(20);
  const pulseAnim = useSharedValue(0);
  const neuralOrbit = useSharedValue(0);

  // Entrance animations
  useEffect(() => {
    headerOpacity.value = withDelay(100, withSpring(1, theme.motion.spring.gentle));
    headerTranslateY.value = withDelay(100, withSpring(0, theme.motion.spring.gentle));
    heroOpacity.value = withDelay(300, withSpring(1, theme.motion.spring.gentle));
    heroTranslateY.value = withDelay(300, withSpring(0, theme.motion.spring.gentle));
    searchOpacity.value = withDelay(500, withSpring(1, theme.motion.spring.gentle));
    searchTranslateY.value = withDelay(500, withSpring(0, theme.motion.spring.gentle));
    suggestionsOpacity.value = withDelay(700, withSpring(1, theme.motion.spring.gentle));
    suggestionsTranslateY.value = withDelay(700, withSpring(0, theme.motion.spring.gentle));
  }, []);

  // Pulse animation for agent avatar
  useEffect(() => {
    const interval = setInterval(() => {
      pulseAnim.value = withTiming(1, { duration: 1500, easing: (t) => t }, () => {
        pulseAnim.value = withTiming(0, { duration: 1500, easing: (t) => t });
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Neural orbit animation
  useEffect(() => {
    neuralOrbit.value = withTiming(360, { duration: 20000, easing: (t) => t }, () => {
      neuralOrbit.value = 0;
    });
  }, []);

  const trimmed = text.trim();
  const empty = trimmed.length === 0;

  const submit = () => {
    setTouched(true);
    if (empty || loading) return;
    Keyboard.dismiss();
    onSearch(trimmed);
  };

  const unreachable = health && !health.reachable;
  const webUnavailable = health?.reachable && health.webSearch && health.webSearch !== 'configured';

  // Agent chat messages
  const agentMessages = useMemo(() => [
    {
      message: "Bonjour ! Je suis Capucine, votre agent d'achat autonome. Je compare les offres réelles, calcule le coût total et ne vous cache jamais ce qui est inconnu.",
      sender: 'agent' as const,
      timestamp: new Date(Date.now() - 10000),
      certainty: 'known' as const,
    },
    {
      message: "Dites-moi ce que vous cherchez, ou choisissez une suggestion ci-dessous.",
      sender: 'agent' as const,
      timestamp: new Date(Date.now() - 5000),
      certainty: 'known' as const,
    },
  ], []);

  // Animated styles
  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const heroAnimatedStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslateY.value }],
  }));

  const searchAnimatedStyle = useAnimatedStyle(() => ({
    opacity: searchOpacity.value,
    transform: [{ translateY: searchTranslateY.value }],
  }));

  const suggestionsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: suggestionsOpacity.value,
    transform: [{ translateY: suggestionsTranslateY.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolateColor(pulseAnim.value, [0, 0.5, 1], [0.4, 1, 0.4]),
    transform: [{ scale: interpolateColor(pulseAnim.value, [0, 0.5, 1], [1, 1.08, 1]) }],
  }));

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${neuralOrbit.value}deg` }],
  }));

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <Animated.ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header - Agent Status */}
        <Animated.View style={[styles.header, headerAnimatedStyle]}>
          <View style={styles.agentStatus}>
            <View style={styles.agentAvatarWrapper}>
              <Animated.View style={[
                styles.agentAvatar,
                pulseStyle,
                { backgroundColor: theme.color.neuralSoft },
              ]}>
                <View style={StyleSheet.absoluteFillObject}>
                  <Animated.View style={[
                    orbitStyle,
                    styles.avatarOrbit,
                    { borderColor: theme.color.neural },
                  ]} />
                  <View style={[
                    styles.avatarCore,
                    { backgroundColor: theme.color.neural },
                  ]}>
                    <Text style={{ fontSize: 24 }}>🤖</Text>
                  </View>
                </View>
              </Animated.View>
              <View style={[
                styles.statusDot,
                { backgroundColor: health?.reachable ? theme.color.known : theme.color.danger },
              ]} />
            </View>
            <View style={styles.agentInfo}>
              <Text style={[styles.wordmark, styles.mono]}>CAPUCINE</Text>
              <Text style={[styles.agentSubtitle, { color: theme.color.textMuted }]}>
                Agent d'achat autonome · {health?.reachable ? 'En ligne' : 'Hors ligne'}
              </Text>
            </View>
          </View>

          {/* System Status Indicators */}
          <View style={styles.statusIndicators}>
            <StatusIndicator
              icon="🌐"
              label="Web"
              active={health?.webSearch === 'configured'}
              color={health?.webSearch === 'configured' ? theme.color.known : theme.color.unknown}
            />
            <StatusIndicator
              icon="🧠"
              label="IA"
              active={health?.aiStatus === 'real'}
              color={health?.aiStatus === 'real' ? theme.color.neural : theme.color.textMuted}
            />
            <StatusIndicator
              icon="🔒"
              label="Privé"
              active={true}
              color={theme.color.known}
            />
          </View>
        </Animated.View>

        {/* Hero Greeting */}
        <Animated.View style={[styles.hero, heroAnimatedStyle]}>
          <Text style={[styles.greeting, { color: theme.color.text }]}>Bonjour.</Text>
          <Text style={[styles.prompt, { color: theme.color.textMuted }]}>
            Que puis-je trouver pour vous aujourd'hui ?
          </Text>
        </Animated.View>

        {/* Search Input - Main Action */}
        <Animated.View style={[styles.searchSection, searchAnimatedStyle]}>
          <View style={styles.searchCardWrapper}>
            <GlassCard variant="elevated" style={styles.searchCard}>
              <NeuralSearchInput
                ref={inputRef}
                label="VOTRE RECHERCHE"
                placeholder="Trouvez-moi le Sony WH-1000XM5 le moins cher…"
                value={text}
                onChangeText={(t) => { setText(t); if (touched) setTouched(false); }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSearch={submit}
                loading={loading}
                onVoiceSearch={() => { /* TODO: Voice search */ }}
                disabled={loading}
                error={touched && empty ? 'Décrivez ce que vous cherchez' : undefined}
                style={styles.searchInput}
              />
              {!loading && (
                <HolographicButton
                  variant="neural"
                  size="xl"
                  fullWidth
                  onPress={submit}
                  disabled={empty}
                  style={{ marginTop: theme.space(2) }}
                  iconLeft={<Text style={{ fontSize: 24 }}>🚀</Text>}
                >
                  LANCER LA RECHERCHE
                </HolographicButton>
              )}
              {loading && (
                <View style={styles.loadingState}>
                  <NeuralProgressRing
                    progress={0.5}
                    size={60}
                    strokeWidth={3}
                    variant="neural"
                    animated={true}
                    showLabel={false}
                  />
                  <Text style={[styles.loadingText, { color: theme.color.textMuted }]}>
                    Capucine analyse, recherche, compare…
                  </Text>
                </View>
              )}
            </GlassCard>
          </View>

          {/* Error / Status Messages */}
          {error && (
            <GlassCard variant="pulse" style={styles.errorCard}>
              <View style={styles.errorContent}>
                <Text style={[styles.errorIcon, { color: theme.color.pulse }]}>⚠</Text>
                <View>
                  <Text style={[styles.errorTitle, { color: theme.color.pulse }]}>
                    Problème de connexion
                  </Text>
                  <Text style={[styles.errorBody, { color: theme.color.textMuted }]}>
                    Vérifiez votre connexion puis réessayez.
                  </Text>
                </View>
              </View>
              <HolographicButton
                variant="pulse-ghost"
                size="sm"
                onPress={onRecheckHealth}
                disabled={checkingHealth}
              >
                {checkingHealth ? '⟳ Vérification…' : 'RÉESSAYER'}
              </HolographicButton>
            </GlassCard>
          )}

          {!loading && !error && unreachable && (
            <GlassCard variant={health?.configured ? 'pulse' : 'neural'} style={styles.errorCard}>
              <View style={styles.errorContent}>
                <Text style={[styles.errorIcon, { color: health?.configured ? theme.color.pulse : theme.color.neural }]}>
                  {health?.configured ? '⚠' : '⚙'}
                </Text>
                <View>
                  <Text style={[styles.errorTitle, { color: health?.configured ? theme.color.pulse : theme.color.neural }]}>
                    {health?.configured ? 'Connexion impossible' : 'Configuration requise'}
                  </Text>
                  <Text style={[styles.errorBody, { color: theme.color.textMuted }]}>
                    {health?.configured
                      ? 'Capucine ne parvient pas à joindre son service pour l\'instant.'
                      : 'Sur cet appareil, Capucine ne sait pas encore où joindre son service.'}
                  </Text>
                </View>
              </View>
              {health?.configured && (
                <HolographicButton
                  variant={health?.configured ? 'pulse-ghost' : 'neural-ghost'}
                  size="sm"
                  onPress={onRecheckHealth}
                  disabled={checkingHealth}
                >
                  {checkingHealth ? '⟳ Vérification…' : 'RÉESSAYER'}
                </HolographicButton>
              )}
            </GlassCard>
          )}

          {!loading && !error && !unreachable && webUnavailable && (
            <GlassCard variant="neural" style={styles.errorCard}>
              <View style={styles.errorContent}>
                <Text style={[styles.errorIcon, { color: theme.color.neural }]}>🌐</Text>
                <View>
                  <Text style={[styles.errorTitle, { color: theme.color.neural }]}>
                    Recherche Web indisponible
                  </Text>
                  <Text style={[styles.errorBody, { color: theme.color.textMuted }]}>
                    Le service répond, mais aucune source Web n'est configurée. Les recherches
                    ne remonteront pas d'offres réelles.
                  </Text>
                </View>
              </View>
            </GlassCard>
          )}

          {/* Resume Previous Search */}
          {lastQuery && !loading && !error && (
            <Pressable
              onPress={onResume}
              accessibilityRole="button"
              accessibilityLabel={`Reprendre : ${lastQuery}`}
              style={({ pressed }) => [styles.resumeCard, pressed && { opacity: 0.7 }]}
            >
              <GlassCard variant="neural" style={styles.resumeCardInner}>
                <View style={styles.resumeIconWrapper}>
                  <View style={[
                    styles.resumeIcon,
                    { backgroundColor: theme.color.neuralSoft },
                  ]}>
                    <Text style={{ fontSize: 20 }}>↩</Text>
                  </View>
                </View>
                <View style={styles.resumeContent}>
                  <Text style={[styles.resumeLabel, { color: theme.color.neural, fontFamily: 'SpaceMono, monospace' }]}>
                    REPRENDRE
                  </Text>
                  <Text style={[styles.resumeQuery, { color: theme.color.text }]} numberOfLines={1}>
                    {lastQuery}
                  </Text>
                </View>
                <Text style={[styles.resumeArrow, { color: theme.color.neural }]}>→</Text>
              </GlassCard>
            </Pressable>
          )}
        </Animated.View>

        {/* Agent Chat Preview */}
        <Animated.View style={[styles.agentChatSection, suggestionsAnimatedStyle]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, styles.mono, { color: theme.color.textMuted }]}>
              CAPUCINE PARLE
            </Text>
            <Pressable
              onPress={() => setShowAgentChat(!showAgentChat)}
              style={styles.chatToggle}
            >
              <Text style={[styles.mono, { color: theme.color.neural, fontSize: theme.font.micro }]}>
                {showAgentChat ? 'MASQUER' : 'AFFICHER'} CONVERSATION
              </Text>
            </Pressable>
          </View>
          {showAgentChat && (
            <GlassCard variant="default" style={styles.chatPreview}>
              <View style={styles.chatMessages}>
                {agentMessages.map((msg, idx) => (
                  <AgentChatBubble
                    key={`${msg.sender}-${idx}`}
                    {...msg}
                    animated={true}
                    showAvatar={true}
                  />
                ))}
              </View>
            </GlassCard>
          )}
        </Animated.View>

        {/* Suggestions Grid */}
        <Animated.View style={[styles.suggestionsSection, suggestionsAnimatedStyle]}>
          <Text style={[styles.sectionTitle, styles.mono, { color: theme.color.textMuted }]}>
            ACTIONS RAPIDES
          </Text>
          <GlassCard variant="default" style={styles.suggestionsGrid}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => { setText(s.text); setTouched(false); inputRef.current?.focus?.(); }}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={`Rechercher : ${s.text}`}
                style={({ pressed }) => [styles.suggestionCard, pressed && styles.suggestionCardPressed]}
              >
                <View style={[
                  styles.suggestionIconWrapper,
                  { backgroundColor: theme.color.neuralSoft, borderWidth: 1, borderColor: theme.color.neural },
                ]}>
                  <Text style={{ fontSize: 24 }}>{s.icon}</Text>
                </View>
                <Text style={[styles.suggestionText, { color: theme.color.text }]}>{s.text}</Text>
              </Pressable>
            ))}
          </GlassCard>
        </Animated.View>

        {/* Capabilities */}
        <Animated.View style={[styles.capabilitiesSection, suggestionsAnimatedStyle]}>
          <Text style={[styles.sectionTitle, styles.mono, { color: theme.color.textMuted }]}>
            CAPACITÉS
          </Text>
          <View style={styles.capabilitiesGrid}>
            <CapabilityCard
              icon="🔍"
              title="RECHERCHE MULTI-SOURCES"
              desc="Serper, catalogues locaux, APIs marchands"
              color={theme.color.neural}
            />
            <CapabilityCard
              icon="💰"
              title="COÛT TOTAL RÉEL"
              desc="Prix + livraison + taxes + frais, sans invention"
              color={theme.color.known}
            />
            <CapabilityCard
              icon="🧠"
              title="CLASSEMENT ÉTHIQUE"
              desc="Moteur de priorité transparent, sans biais marchand"
              color={theme.color.pulse}
            />
            <CapabilityCard
              icon="🛡"
              title="CONFIDENTIALITÉ"
              desc="Aucun tracking, données locales uniquement"
              color={theme.color.unknown}
            />
          </View>
        </Animated.View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footText, { color: theme.color.textFaint, fontFamily: 'SpaceMono, monospace' }]}>
            Capucine compare le coût total réel — pas le prix affiché.
          </Text>
          <Text style={[styles.versionText, { color: theme.color.textFaint, fontFamily: 'SpaceMono, monospace' }]}>
            v2.0.0-neural · Build {new Date().toISOString().split('T')[0]}
          </Text>
        </View>
      </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

// Status Indicator Component
function StatusIndicator({ icon, label, active, color }: { icon: string; label: string; active: boolean; color: string }) {
  const t = theme;
  const styles = textStyle(t);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (active) {
      pulse.value = withTiming(1, { duration: 1000, easing: (t) => t }, () => {
        pulse.value = withTiming(0, { duration: 1000, easing: (t) => t });
      });
    }
  }, [active]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolateColor(pulse.value, [0, 0.5, 1], [0.5, 1, 0.5]),
    transform: [{ scale: interpolateColor(pulse.value, [0, 0.5, 1], [1, 1.1, 1]) }],
  }));

  return (
    <Pressable style={styles.statusItem}>
      <Animated.View style={[pulseStyle, { padding: t.space(1) }]}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
      </Animated.View>
      <Text style={[
        styles.statusLabel,
        { color: active ? color : t.color.textFaint },
        { fontWeight: active ? t.weight.semibold : t.weight.regular },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Capability Card Component
function CapabilityCard({ icon, title, desc, color }: { icon: string; title: string; desc: string; color: string }) {
  const t = theme;
  const styles = textStyle(t);
  const hoverScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: hoverScale.value }],
    borderColor: interpolateColor(hoverScale.value, [1, 1.02], [t.color.glassBorder, color]),
  }));

  return (
    <Animated.View style={[animatedStyle, styles.capabilityCard]}>
      <View style={[
        styles.capabilityIcon,
        { backgroundColor: `${color}20`, borderWidth: 1, borderColor: color },
      ]}>
        <Text style={{ fontSize: 24 }}>{icon}</Text>
      </View>
      <Text style={[styles.capabilityTitle, { color: t.color.text, fontFamily: 'SpaceMono, monospace' }]}>
        {title}
      </Text>
      <Text style={[styles.capabilityDesc, { color: t.color.textMuted }]}>
        {desc}
      </Text>
      <View style={[
        styles.capabilityBar,
        { backgroundColor: color },
      ]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  container: {
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(3),
    paddingBottom: theme.space(6),
    flexGrow: 1,
    gap: theme.space(4),
  },

  // Header
  header: { gap: theme.space(3) },
  agentStatus: { flexDirection: 'row', alignItems: 'center', gap: theme.space(3) },
  agentAvatarWrapper: { position: 'relative' },
  agentAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    ...theme.shadow.neuralGlow,
  },
  avatarOrbit: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth: 1.5,
  },
  avatarCore: {
    position: 'absolute',
    top: '50%', left: '50%',
    width: 40, height: 40,
    marginTop: -20, marginLeft: -20,
    borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.neuralGlow,
  },
  statusDot: {
    position: 'absolute',
    bottom: 0, right: 0,
    width: 16, height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.color.background,
  },
  agentInfo: { flex: 1 },
  wordmark: {
    fontSize: theme.font.label,
    fontWeight: theme.weight.extrabold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: theme.color.text,
    fontFamily: 'SpaceMono, monospace',
  },
  agentSubtitle: { fontSize: theme.font.small },
  mono: { fontFamily: 'SpaceMono, monospace' },

  statusIndicators: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: theme.space(1) },
  statusItem: { alignItems: 'center', gap: theme.space(1), flex: 1 },
  statusLabel: { fontSize: theme.font.micro, fontWeight: theme.weight.medium, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'SpaceMono, monospace' },

  // Hero
  hero: { gap: theme.space(1), alignItems: 'center', textAlign: 'center' },
  greeting: {
    fontSize: theme.font.mega,
    lineHeight: theme.leading.mega,
    fontWeight: theme.weight.extrabold,
    letterSpacing: -1.5,
    color: theme.color.text,
  },
  prompt: {
    fontSize: theme.font.title,
    lineHeight: theme.leading.title,
    fontWeight: theme.weight.light,
    letterSpacing: -0.2,
    color: theme.color.textMuted,
    maxWidth: 320,
  },

  // Search Section
  searchSection: { gap: theme.space(3) },
  searchCardWrapper: { width: '100%' },
  searchCard: { padding: theme.space(3), width: '100%' },
  searchInput: { width: '100%' },
  loadingState: { alignItems: 'center', gap: theme.space(2), paddingVertical: theme.space(4) },
  loadingText: { fontSize: theme.font.small, textAlign: 'center' },

  // Error Card
  errorCard: { marginTop: theme.space(2), flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space(3) },
  errorContent: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(2), flex: 1 },
  errorIcon: { fontSize: 24, marginTop: 2 },
  errorTitle: { fontSize: theme.font.body, fontWeight: theme.weight.bold, marginBottom: theme.space(0.5) },
  errorBody: { fontSize: theme.font.small, lineHeight: theme.leading.small },

  // Resume Card
  resumeCard: { marginTop: theme.space(2) },
  resumeCardInner: { flexDirection: 'row', alignItems: 'center', gap: theme.space(3), padding: theme.space(3), width: '100%' },
  resumeIconWrapper: { flexShrink: 0 },
  resumeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  resumeContent: { flex: 1 },
  resumeLabel: { fontSize: theme.font.label, fontWeight: theme.weight.semibold, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'SpaceMono, monospace', marginBottom: 2 },
  resumeQuery: { fontSize: theme.font.body, fontWeight: theme.weight.semibold },
  resumeArrow: { fontSize: 20, fontWeight: theme.weight.bold },

  // Agent Chat Section
  agentChatSection: { gap: theme.space(2) },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space(2) },
  sectionTitle: { fontSize: theme.font.label, fontWeight: theme.weight.bold, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'SpaceMono, monospace' },
  chatToggle: { paddingVertical: theme.space(1) },
  chatPreview: { padding: theme.space(2) },
  chatMessages: { gap: theme.space(2) },

  // Suggestions
  suggestionsSection: { gap: theme.space(2) },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
    padding: theme.space(2),
  },
  suggestionCard: {
    width: (SCREEN_WIDTH - theme.space(4) * 2 - theme.space(2) * 2) / 3,
    minHeight: 100,
    padding: theme.space(3),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.glass,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(2),
    ...theme.shadow.subtle,
  },
  suggestionCardPressed: { opacity: 0.8, borderColor: theme.color.neural },
  suggestionIconWrapper: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  suggestionText: { fontSize: theme.font.small, fontWeight: theme.weight.medium, textAlign: 'center', lineHeight: theme.leading.small },

  // Capabilities
  capabilitiesSection: { gap: theme.space(2) },
  capabilitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
    justifyContent: 'space-between',
  },
  capabilityCard: {
    width: (SCREEN_WIDTH - theme.space(4) * 2 - theme.space(2)) / 2,
    padding: theme.space(3),
    borderRadius: theme.radii.lg,
    backgroundColor: theme.color.glass,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
    alignItems: 'center',
    gap: theme.space(2),
    ...theme.shadow.glass,
  },
  capabilityIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  capabilityTitle: { fontSize: theme.font.small, fontWeight: theme.weight.bold, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'SpaceMono, monospace' },
  capabilityDesc: { fontSize: theme.font.micro, textAlign: 'center', lineHeight: theme.leading.micro, maxWidth: 160 },
  capabilityBar: { width: '100%', height: 2, borderRadius: 1, marginTop: theme.space(2) },

  // Footer
  footer: { paddingTop: theme.space(4), paddingBottom: theme.space(6), alignItems: 'center', gap: theme.space(1) },
  footText: { fontSize: theme.font.micro, textAlign: 'center' },
  versionText: { fontSize: theme.font.micro, textAlign: 'center' },
});

export default HomeScreen;