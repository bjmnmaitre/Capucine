import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HealthStatus } from '../api';
import { Screen } from '../components/Screen';
import { CapucineAvatar } from '../components/CapucineAvatar';
import { SearchSteps } from '../components/SearchSteps';
import { theme, cardStyle, inputStyle, primaryButtonStyle, textStyle } from '../theme';

interface Props {
  loading: boolean;
  error: string | null;
  health?: HealthStatus;
  checkingHealth?: boolean;
  onRecheckHealth?: () => void;
  /** Pre-fills the field — set when returning here to reword a search that
   *  found nothing, or to re-run one from the Recherches tab. */
  initialQuery?: string;
  /** The query whose results are still available behind the "Reprendre" card. */
  lastQuery?: string | null;
  onSearch: (query: string) => void;
  onResume: () => void;
}

const SUGGESTIONS = [
  { text: 'Trouver le moins cher', icon: '💰' },
  { text: 'Comparer plusieurs offres', icon: '⚖️' },
  { text: 'Rechercher un produit', icon: '🔍' },
] as const;

/**
 * Capucine's Home — an AI shopping assistant opener.
 * One dominant input: the user describes what they want naturally.
 * Everything else stays deliberately quiet.
 */
export function HomeScreen({
  loading, error, health, checkingHealth, onRecheckHealth,
  initialQuery, lastQuery, onSearch, onResume,
}: Props) {
  const [text, setText] = useState(initialQuery ?? '');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (initialQuery !== undefined) {
      setText(initialQuery);
      setTouched(false);
    }
  }, [initialQuery]);

  const trimmed = text.trim();
  const empty = trimmed.length === 0;

  function submit() {
    setTouched(true);
    if (empty || loading) return;
    Keyboard.dismiss();
    onSearch(trimmed);
  }

  const unreachable = health && !health.reachable;
  const webUnavailable = health?.reachable && health.webSearch && health.webSearch !== 'configured';

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={styles.container}>
          {/* Header — wordmark only, subtle */}
          <View style={[styles.header, styles.headerRow]}>
            <CapucineAvatar size={26} />
            <Text style={styles.wordmark}>Capucine</Text>
          </View>

          {/* Hero greeting — conversational, human */}
          <View style={styles.hero}>
            <Text style={styles.greeting} accessibilityRole="header">Bonjour.</Text>
            <Text style={styles.prompt}>Que puis-je trouver pour vous ?</Text>
            <Text style={styles.signature}>Je cherche. Je trouve. Tu décides.</Text>
          </View>

          {/* Search input area — the hero component */}
          <View style={styles.searchArea}>
            <View style={[
              styles.fieldWrapper,
              focused && styles.fieldFocused,
              touched && empty && styles.fieldError,
              loading && styles.fieldLoading,
            ]}>
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={theme.color.accent} size="small" />
                  <Text style={styles.loadingText}>Capucine cherche…</Text>
                </View>
              ) : (
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={text}
                  onChangeText={(t) => { setText(t); if (touched) setTouched(false); }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="Trouvez-moi le Sony WH-1000XM5 le moins cher…"
                  placeholderTextColor={theme.color.textFaint}
                  onSubmitEditing={submit}
                  returnKeyType="search"
                  multiline
                  maxLength={500}
                  blurOnSubmit
                  accessibilityLabel="Votre demande"
                  accessibilityHint="Décrivez ce que vous cherchez, par exemple : trouve-moi le casque Sony le moins cher"
                />
              )}
            </View>

            {!loading && (
              <Pressable
                style={[styles.goButton, empty && styles.goButtonDisabled]}
                onPress={submit}
                disabled={empty}
                accessibilityRole="button"
                accessibilityLabel="Lancer la recherche"
                android_ripple={{ color: theme.color.accentText }}
              >
                <Text style={[styles.goText, empty && styles.goTextDisabled]}>Chercher</Text>
              </Pressable>
            )}
          </View>

          {loading ? <SearchSteps /> : null}

          {/* Error / status messages — honest, actionable, no technical details */}
          {error ? (
            <View style={styles.notice} accessibilityLiveRegion="assertive">
              <Text style={styles.noticeTitle}>Capucine rencontre un problème de connexion.</Text>
              <Text style={styles.noticeBody}>Vérifiez votre connexion puis réessayez.</Text>
              <Pressable
                onPress={() => onRecheckHealth?.()}
                disabled={!!checkingHealth}
                accessibilityRole="button"
                accessibilityLabel="Réessayer"
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Réessayer</Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && !error && unreachable ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeTitle}>
                {health?.configured ? 'Connexion impossible' : 'Configuration requise'}
              </Text>
              <Text style={styles.noticeBody}>
                {health?.configured
                  ? 'Capucine ne parvient pas à joindre son service pour l\'instant.'
                  : 'Sur cet appareil, Capucine ne sait pas encore où joindre son service.'}
              </Text>
              {health?.configured ? (
                <Pressable
                  onPress={() => onRecheckHealth?.()}
                  disabled={!!checkingHealth}
                  accessibilityRole="button"
                  accessibilityLabel="Réessayer"
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  {checkingHealth ? (
                    <ActivityIndicator color={theme.color.accent} size="small" />
                  ) : (
                    <Text style={styles.retryText}>Réessayer</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {!loading && !error && !unreachable && webUnavailable ? (
            <View style={[styles.notice, styles.noticeWarn]}>
              <Text style={styles.noticeTitle}>Recherche Web indisponible</Text>
              <Text style={styles.noticeBody}>
                Le service répond, mais aucune source Web n'est configurée. Les recherches
                ne remonteront pas d'offres réelles.
              </Text>
            </View>
          ) : null}

          {/* Resume previous search — subtle card */}
          {lastQuery && !loading && !error ? (
            <Pressable
              onPress={onResume}
              accessibilityRole="button"
              accessibilityLabel={`Reprendre : ${lastQuery}`}
              style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}
            >
              <View style={styles.resumeIcon} accessible importantForAccessibility="no-hide-descendants">
                <Text style={styles.resumeIconText}>↩️</Text>
              </View>
              <View style={styles.resumeContent}>
                <Text style={styles.resumeLabel}>Reprendre la recherche</Text>
                <Text style={styles.resumeQuery} numberOfLines={1}>{lastQuery}</Text>
              </View>
            </Pressable>
          ) : null}

          {/* Suggestions — chips with icons, not dense list */}
          {!loading && !error && (
            <View style={styles.suggestions}>
              <Text style={styles.suggestionsTitle}>Suggestions</Text>
              <View style={styles.suggestionGrid}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s.text}
                    onPress={() => { setText(s.text); setTouched(false); inputRef.current?.focus(); }}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel={`Rechercher : ${s.text}`}
                    style={({ pressed }) => [styles.suggestionChip, pressed && styles.pressed]}
                  >
                    <Text style={styles.suggestionIcon} importantForAccessibility="no-hide-descendants">{s.icon}</Text>
                    <Text style={styles.suggestionText}>{s.text}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Bottom trust note */}
          <Text style={styles.foot}>
            Capucine compare le coût total réel — pas le prix affiché.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingHorizontal: theme.space(3),
    paddingTop: theme.space(2),
    paddingBottom: theme.space(5),
    flexGrow: 1,
  },
  header: {
    marginBottom: theme.space(4),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1) },
  signature: {
    fontSize: theme.font.small, color: theme.color.goldInk, fontWeight: theme.weight.semibold,
    letterSpacing: 0.4, marginTop: theme.space(1.5),
  },
  wordmark: {
    fontSize: theme.font.micro,
    fontWeight: theme.weight.bold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: theme.color.accent,
  },
  hero: { marginTop: theme.space(6), marginBottom: theme.space(4) },
  greeting: {
    fontSize: theme.font.mega,
    lineHeight: theme.leading.mega,
    fontWeight: theme.weight.bold,
    color: theme.color.text,
    letterSpacing: -0.8,
  },
  prompt: {
    fontSize: theme.font.title,
    lineHeight: theme.leading.title,
    color: theme.color.textMuted,
    marginTop: theme.space(1),
    letterSpacing: -0.2,
  },

  searchArea: {
    marginTop: theme.space(2),
  },
  fieldWrapper: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(1.5),
    ...theme.shadow.subtle,
  },
  fieldFocused: {
    borderColor: theme.color.accent,
    borderWidth: 2,
    ...theme.shadow.card,
  },
  fieldError: { borderColor: theme.color.danger, borderWidth: 1.5 },
  fieldLoading: { opacity: 0.7 },
  input: {
    fontSize: theme.font.body,
    lineHeight: theme.leading.body,
    color: theme.color.text,
    minHeight: theme.minTouch + 8,
    paddingHorizontal: theme.space(1),
    paddingTop: theme.space(1),
    textAlignVertical: 'top',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1),
  },
  loadingText: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
  },
  goButton: {
    marginTop: theme.space(1.5),
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1),
    backgroundColor: theme.color.accent,
    borderRadius: theme.radii.md,
    ...theme.shadow.subtle,
  },
  // Disabled = light marine tint + muted text (4.9:1), never a washed-out marine.
  goButtonDisabled: { backgroundColor: theme.color.accentSoft },
  goText: {
    color: theme.color.accentText,
    fontSize: theme.font.body,
    fontWeight: theme.weight.bold,
  },
  goTextDisabled: { color: theme.color.textMuted },

  notice: {
    marginTop: theme.space(2.5),
    padding: theme.space(2.5),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  noticeWarn: {
    backgroundColor: theme.color.unknownSoft,
    borderColor: theme.color.unknown,
  },
  noticeTitle: {
    fontSize: theme.font.body,
    fontWeight: theme.weight.bold,
    color: theme.color.text,
  },
  noticeBody: {
    fontSize: theme.font.small,
    lineHeight: theme.leading.small,
    color: theme.color.textMuted,
    marginTop: theme.space(0.5),
  },
  retryButton: {
    marginTop: theme.space(1.5),
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(0.75),
    backgroundColor: theme.color.accent,
    borderRadius: theme.radii.md,
  },
  retryText: {
    color: theme.color.accentText,
    fontSize: theme.font.small,
    fontWeight: theme.weight.bold,
  },

  resumeCard: {
    marginTop: theme.space(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    padding: theme.space(2.5),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.accentSoft,
    borderWidth: 1,
    borderColor: theme.color.accent,
    ...theme.shadow.subtle,
  },
  resumeIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' },
  resumeIconText: { fontSize: 18 },
  resumeContent: { flex: 1 },
  resumeLabel: {
    fontSize: theme.font.label,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.color.accentInk,
  },
  resumeQuery: {
    fontSize: theme.font.body,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginTop: 2,
  },
  pressed: { opacity: theme.opacity.pressed },

  suggestions: { marginTop: theme.space(5) },
  suggestionsTitle: {
    fontSize: theme.font.label,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.color.textFaint,
    marginBottom: theme.space(1.5),
  },
  suggestionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(1.5),
    marginTop: theme.space(1.5),
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1),
    minHeight: theme.minTouch + 4,
    paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(1),
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.background,
    ...theme.shadow.subtle,
  },
  suggestionIcon: { fontSize: 16 },
  suggestionText: {
    fontSize: theme.font.small,
    color: theme.color.text,
    flexShrink: 1,
  },

  foot: {
    marginTop: theme.space(6),
    fontSize: theme.font.micro,
    color: theme.color.textFaint,
    textAlign: 'center',
    lineHeight: 16,
  },
});