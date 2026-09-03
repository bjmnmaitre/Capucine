import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { HealthStatus } from '../api';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { theme } from '../theme';

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
  'Casque Sony WH-1000XM5',
  'MacBook Air M4 16 Go',
  'Chaussures de running homme',
  'Enceinte portable la meilleure autonomie',
];

/**
 * The home of Capucine — a conversation opener, not a form. One dominant
 * input: the user says what they want in a full sentence, Capucine does the
 * rest. Everything else on this screen is deliberately quiet.
 */
export function HomeScreen({
  loading, error, health, checkingHealth, onRecheckHealth,
  initialQuery, lastQuery, onSearch, onResume,
}: Props) {
  const [text, setText] = useState(initialQuery ?? '');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<TextInput>(null);

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
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.wordmark}>Capucine</Text>

          <View style={styles.hero}>
            <Text style={styles.greeting} accessibilityRole="header">Bonjour.</Text>
            <Text style={styles.prompt}>Que puis-je trouver pour vous ?</Text>
          </View>

          <Pressable
            style={[styles.field, touched && empty && styles.fieldError]}
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="none"
          >
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={(t) => { setText(t); if (touched) setTouched(false); }}
              placeholder="Décrivez ce que vous cherchez…"
              placeholderTextColor={theme.color.textFaint}
              onSubmitEditing={submit}
              returnKeyType="search"
              editable={!loading}
              multiline
              blurOnSubmit
              accessibilityLabel="Votre demande"
              accessibilityHint="Écrivez une phrase, par exemple : trouve-moi le casque Sony le moins cher"
            />
            <Button
              label={loading ? '…' : 'Chercher'}
              onPress={submit}
              loading={loading}
              disabled={empty}
              accessibilityHint="Lance la recherche"
              style={styles.go}
            />
          </Pressable>

          {touched && empty ? (
            <Text style={styles.fieldHint} accessibilityLiveRegion="polite">
              Dites d’abord ce que vous cherchez.
            </Text>
          ) : null}

          {loading ? (
            <Text style={styles.working} accessibilityLiveRegion="polite">
              Capucine cherche : elle interprète, consulte les sources, calcule le coût réel,
              puis classe.
            </Text>
          ) : null}

          {error ? (
            <View style={styles.notice} accessibilityLiveRegion="assertive">
              <Text style={styles.noticeTitle}>{error}</Text>
              <Text style={styles.noticeBody}>Vérifiez votre connexion, puis réessayez.</Text>
            </View>
          ) : null}

          {!loading && !error && unreachable ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeTitle}>
                {health?.configured ? 'Connexion impossible' : 'Configuration requise'}
              </Text>
              <Text style={styles.noticeBody}>
                {health?.configured
                  ? 'Capucine ne parvient pas à joindre son service pour l’instant.'
                  : 'Sur cet appareil, Capucine ne sait pas encore où joindre son service.'}
              </Text>
              {health?.configured ? (
                <Button
                  label="Réessayer"
                  variant="secondary"
                  onPress={() => onRecheckHealth?.()}
                  loading={!!checkingHealth}
                  style={styles.retry}
                />
              ) : null}
            </View>
          ) : null}

          {!loading && !error && !unreachable && webUnavailable ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Recherche Web indisponible</Text>
              <Text style={styles.noticeBody}>
                Le service répond, mais aucune source Web n’est configurée : les recherches
                ne remonteront pas d’offres réelles.
              </Text>
            </View>
          ) : null}

          {lastQuery ? (
            <Pressable
              onPress={onResume}
              accessibilityRole="button"
              accessibilityLabel={`Reprendre : ${lastQuery}`}
              style={({ pressed }) => [styles.resume, pressed && styles.pressed]}
            >
              <Text style={styles.resumeEyebrow}>Reprendre</Text>
              <Text style={styles.resumeQuery} numberOfLines={1}>{lastQuery}</Text>
            </Pressable>
          ) : null}

          <View style={styles.suggestions}>
            <Text style={styles.suggestionsTitle}>Idées de recherche</Text>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => { setText(s); setTouched(false); inputRef.current?.focus(); }}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={`Utiliser : ${s}`}
                style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              >
                <Text style={styles.suggestionText}>{s}</Text>
                <Text style={styles.suggestionArrow}>↗</Text>
              </Pressable>
            ))}
          </View>

          {health?.reachable ? (
            <Text style={styles.foot}>
              {`Service connecté${health.webSearch === 'configured' ? ' · recherche Web active' : ''}`}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingHorizontal: theme.space(3),
    paddingTop: theme.space(2),
    paddingBottom: theme.space(4),
  },
  wordmark: {
    fontSize: theme.font.small,
    fontWeight: theme.weight.bold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: theme.color.accent,
  },
  hero: { marginTop: theme.space(5), marginBottom: theme.space(3) },
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
  field: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(1.5),
    ...theme.shadow.card,
  },
  fieldError: { borderColor: theme.color.danger, borderWidth: 1.5 },
  input: {
    fontSize: theme.font.body,
    lineHeight: theme.leading.body,
    color: theme.color.text,
    minHeight: theme.minTouch,
    paddingHorizontal: theme.space(1),
    paddingTop: theme.space(1),
    textAlignVertical: 'top',
  },
  go: { marginTop: theme.space(1) },
  fieldHint: {
    color: theme.color.danger,
    fontSize: theme.font.small,
    marginTop: theme.space(1),
    marginLeft: theme.space(1),
  },
  working: {
    fontSize: theme.font.small,
    lineHeight: theme.leading.small,
    color: theme.color.textMuted,
    marginTop: theme.space(2),
  },
  notice: {
    marginTop: theme.space(2.5),
    padding: theme.space(2),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.surfaceAlt,
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
  retry: { marginTop: theme.space(1.5), alignSelf: 'flex-start' },
  resume: {
    marginTop: theme.space(3),
    padding: theme.space(2),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.accentSoft,
  },
  resumeEyebrow: {
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
    marginTop: 3,
  },
  suggestions: { marginTop: theme.space(4) },
  suggestionsTitle: {
    fontSize: theme.font.label,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.color.textFaint,
    marginBottom: theme.space(1.5),
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: theme.minTouch + 4,
    paddingVertical: theme.space(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  suggestionText: {
    fontSize: theme.font.body,
    color: theme.color.text,
    flexShrink: 1,
    paddingRight: theme.space(1),
  },
  suggestionArrow: { fontSize: theme.font.body, color: theme.color.textFaint },
  pressed: { opacity: 0.6 },
  foot: {
    marginTop: theme.space(4),
    fontSize: theme.font.label,
    color: theme.color.textFaint,
    textAlign: 'center',
  },
});
