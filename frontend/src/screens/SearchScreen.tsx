import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { theme } from '../theme';
import { API_BASE_URL } from '../api';

const EXAMPLES = ['casque Sony WH-1000XM5', 'MacBook Air M4 16 Go', 'chaussures de running homme'];

interface Props {
  loading: boolean;
  error: string | null;
  errorDetail?: string | null;
  onSearch: (query: string) => void;
  onOpenProfile: () => void;
}

export function SearchScreen({ loading, error, errorDetail, onSearch, onOpenProfile }: Props) {
  const [query, setQuery] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = query.trim();
  const isEmpty = trimmed.length === 0;

  function submit() {
    setTouched(true);
    if (isEmpty) return; // an empty search is refused here, never sent as ""
    onSearch(trimmed);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">Capucine</Text>
        <Text style={styles.subtitle}>
          Dites ce que vous cherchez. Capucine compare les offres réelles et leur coût total,
          en distinguant ce qui est connu de ce qui ne l’est pas.
        </Text>

        <Text style={styles.label} nativeID="search-label">Votre recherche</Text>
        <TextInput
          style={[styles.input, touched && isEmpty && styles.inputError]}
          value={query}
          onChangeText={(t) => { setQuery(t); if (touched) setTouched(false); }}
          placeholder="ex. casque Sony WH-1000XM5"
          placeholderTextColor={theme.color.textMuted}
          onSubmitEditing={submit}
          returnKeyType="search"
          editable={!loading}
          accessibilityLabel="Votre recherche"
          accessibilityLabelledBy="search-label"
          accessibilityHint="Saisissez un produit, puis validez pour lancer la recherche"
        />
        {touched && isEmpty ? (
          <Text style={styles.fieldError} accessibilityLiveRegion="polite">
            Saisissez un produit avant de lancer la recherche.
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Rechercher"
          accessibilityState={{ disabled: loading, busy: loading }}
          style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}
        >
          {loading
            ? <ActivityIndicator color={theme.color.accentText} />
            : <Text style={styles.buttonText}>Rechercher</Text>}
        </Pressable>

        {loading ? (
          <Text style={styles.loadingNote} accessibilityLiveRegion="polite">
            Recherche en cours : interprétation, sources, coût réel, classement…
          </Text>
        ) : null}

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="assertive">
            <Text style={styles.errorTitle}>{error}</Text>
            {errorDetail ? <Text style={styles.errorDetail}>{errorDetail}</Text> : null}
            <Text style={styles.errorHint}>
              Vérifiez que le service Capucine est démarré, puis réessayez.
            </Text>
          </View>
        ) : null}

        <View style={styles.examples}>
          <Text style={styles.examplesTitle}>Exemples</Text>
          {EXAMPLES.map((ex) => (
            <Pressable
              key={ex}
              onPress={() => { setQuery(ex); setTouched(false); }}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={`Utiliser l’exemple : ${ex}`}
              style={({ pressed }) => [styles.example, pressed && styles.examplePressed]}
            >
              <Text style={styles.exampleText}>{ex}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={onOpenProfile}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir vos préférences permanentes"
          style={({ pressed }) => [styles.profileLink, pressed && styles.examplePressed]}
        >
          <Text style={styles.profileLinkText}>Vos préférences permanentes ›</Text>
        </Pressable>

        <Text style={styles.apiNote}>Service : {API_BASE_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: theme.space(3), paddingBottom: theme.space(6) },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text },
  subtitle: {
    fontSize: theme.font.body, color: theme.color.textMuted,
    marginTop: theme.space(1), lineHeight: 23,
  },
  label: {
    fontSize: theme.font.small, fontWeight: '600', color: theme.color.text,
    marginTop: theme.space(3), marginBottom: theme.space(1),
  },
  input: {
    minHeight: theme.minTouch + 6, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius, paddingHorizontal: theme.space(2),
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface,
  },
  inputError: { borderColor: theme.color.danger, borderWidth: 2 },
  fieldError: { color: theme.color.danger, fontSize: theme.font.small, marginTop: theme.space(1) },
  button: {
    minHeight: theme.minTouch + 6, borderRadius: theme.radius,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
    marginTop: theme.space(2),
  },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
  loadingNote: {
    marginTop: theme.space(2), fontSize: theme.font.small, color: theme.color.textMuted,
  },
  errorBox: {
    marginTop: theme.space(3), padding: theme.space(2), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: '#FDF3F3',
  },
  errorTitle: { color: theme.color.danger, fontWeight: '700', fontSize: theme.font.body },
  errorDetail: { color: theme.color.text, fontSize: theme.font.small, marginTop: theme.space(0.5) },
  errorHint: { color: theme.color.textMuted, fontSize: theme.font.small, marginTop: theme.space(1) },
  examples: { marginTop: theme.space(4) },
  examplesTitle: {
    fontSize: theme.font.small, fontWeight: '600',
    color: theme.color.textMuted, marginBottom: theme.space(1),
  },
  example: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(2),
    borderRadius: theme.radius, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface, marginBottom: theme.space(1),
  },
  examplePressed: { opacity: 0.7 },
  exampleText: { fontSize: theme.font.body, color: theme.color.text },
  profileLink: {
    minHeight: theme.minTouch, justifyContent: 'center', marginTop: theme.space(3),
  },
  profileLinkText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  apiNote: {
    marginTop: theme.space(4), fontSize: 12, color: theme.color.textMuted, textAlign: 'center',
  },
});
