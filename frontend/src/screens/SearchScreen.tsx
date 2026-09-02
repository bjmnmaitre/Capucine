import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { theme } from '../theme';
import { API_BASE_URL, HealthStatus } from '../api';
import {
  clearHistory, loadHistory, relativeTime, removeSearch, SearchHistoryEntry,
} from '../history';

const EXAMPLES = ['casque Sony WH-1000XM5', 'MacBook Air M4 16 Go', 'chaussures de running homme'];

interface Props {
  loading: boolean;
  error: string | null;
  errorDetail?: string | null;
  health?: HealthStatus;
  checkingHealth?: boolean;
  onRecheckHealth?: () => void;
  /** Pré-remplit le champ — utilisé quand on revient ici pour reformuler une
   *  recherche qui n'a rien trouvé, plutôt que de repartir d'un champ vide. */
  initialQuery?: string;
  onSearch: (query: string) => void;
  onOpenProfile: () => void;
}

export function SearchScreen({
  loading, error, errorDetail, health, checkingHealth, onRecheckHealth,
  initialQuery, onSearch, onOpenProfile,
}: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [touched, setTouched] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  // Re-read on every mount: App re-mounts this screen each time the user comes
  // back from results, so a search just made shows up without extra plumbing.
  useEffect(() => {
    let alive = true;
    void loadHistory().then((h) => { if (alive) setHistory(h); });
    return () => { alive = false; };
  }, []);

  async function onClearHistory() {
    await clearHistory();
    setHistory([]);
  }

  async function onRemoveRecent(query: string) {
    setHistory(await removeSearch(query));
  }

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

        {health && !health.reachable ? (
          <View style={styles.offlineBox} accessibilityLiveRegion="polite">
            <Text style={styles.offlineTitle}>Service Capucine injoignable</Text>
            <Text style={styles.offlineBody}>
              Adresse essayée : {API_BASE_URL}
              {'\n'}Vérifiez que le service est démarré et que ce téléphone est sur le même
              réseau que le Mac.
            </Text>
            <Pressable
              onPress={onRecheckHealth}
              disabled={checkingHealth}
              accessibilityRole="button"
              accessibilityLabel="Réessayer la connexion au service"
              accessibilityState={{ disabled: !!checkingHealth, busy: !!checkingHealth }}
              style={({ pressed }) => [styles.retryBtn, (pressed || checkingHealth) && styles.buttonPressed]}
            >
              {checkingHealth
                ? <ActivityIndicator color={theme.color.accentText} />
                : <Text style={styles.retryBtnText}>Réessayer</Text>}
            </Pressable>
          </View>
        ) : health?.reachable && health.webSearch && health.webSearch !== 'configured' ? (
          // Service joignable mais AUCUNE vraie source Web : le dire franchement
          // plutôt que de laisser l'utilisateur lancer une recherche qui ne
          // remontera que le catalogue local (ou rien).
          <View style={styles.offlineBox} accessibilityLiveRegion="polite">
            <Text style={styles.offlineTitle}>Recherche Web indisponible</Text>
            <Text style={styles.offlineBody}>
              Le service répond, mais aucune source Web réelle n’est configurée
              (SERPER_API_KEY). Les recherches ne remonteront pas d’offres réelles.
            </Text>
          </View>
        ) : null}

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

        {history.length > 0 ? (
          <View style={styles.examples}>
            <View style={styles.recentHead}>
              <Text style={styles.examplesTitle}>Recherches récentes</Text>
              <Pressable
                onPress={onClearHistory}
                accessibilityRole="button"
                accessibilityLabel="Effacer l’historique des recherches"
                style={({ pressed }) => [styles.clearBtn, pressed && styles.examplePressed]}
              >
                <Text style={styles.clearBtnText}>Effacer</Text>
              </Pressable>
            </View>
            {history.map((h) => (
              <View key={`${h.query}-${h.at}`} style={styles.recentRow}>
                <Pressable
                  onPress={() => { setTouched(false); onSearch(h.query); }}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `Relancer : ${h.query}. ${h.resultCount} résultat${h.resultCount > 1 ? 's' : ''}, ${relativeTime(h.at)}`
                  }
                  style={({ pressed }) => [styles.example, styles.recentMain, pressed && styles.examplePressed]}
                >
                  <Text style={styles.exampleText} numberOfLines={1}>{h.query}</Text>
                  <Text style={styles.recentMeta}>
                    {h.resultCount} offre{h.resultCount > 1 ? 's' : ''} · {relativeTime(h.at)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onRemoveRecent(h.query)}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel={`Retirer « ${h.query} » de l’historique`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.recentDelete, pressed && styles.examplePressed]}
                >
                  <Text style={styles.recentDeleteText}>✕</Text>
                </Pressable>
              </View>
            ))}
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

        <Text style={styles.apiNote}>
          {health?.reachable
            ? `Service connecté${health.webSearch === 'configured' ? ' · recherche Web active' : ''}`
              + `${health.aiStatus === 'real' ? ' · IA activée' : ''}`
            : `Service : ${API_BASE_URL}`}
        </Text>
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
  offlineBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.unknown, backgroundColor: '#FBF1DC',
  },
  offlineTitle: { color: theme.color.unknown, fontWeight: '700', fontSize: theme.font.body },
  offlineBody: {
    color: theme.color.text, fontSize: theme.font.small,
    marginTop: theme.space(0.5), lineHeight: 19,
  },
  retryBtn: {
    minHeight: theme.minTouch, borderRadius: theme.radius, backgroundColor: theme.color.accent,
    alignItems: 'center', justifyContent: 'center', marginTop: theme.space(1.5),
    paddingHorizontal: theme.space(2), alignSelf: 'flex-start',
  },
  retryBtnText: { color: theme.color.accentText, fontWeight: '700', fontSize: theme.font.small },
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
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clearBtn: { minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1) },
  clearBtnText: { fontSize: theme.font.small, color: theme.color.accent, fontWeight: '600' },
  recentMeta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  recentRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: theme.space(1),
    marginBottom: theme.space(1),
  },
  recentMain: { flex: 1, marginBottom: 0 },
  recentDelete: {
    width: theme.minTouch, minHeight: theme.minTouch, alignItems: 'center', justifyContent: 'center',
    borderRadius: theme.radius, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  recentDeleteText: { fontSize: theme.font.body, color: theme.color.textMuted, fontWeight: '600' },
  example: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(1),
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
