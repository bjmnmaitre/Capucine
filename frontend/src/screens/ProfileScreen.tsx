import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { deleteCriterion, loadProfile, saveCriterion } from '../api';
import { criterionId } from '../profile';
import { ApiError, PREFERENCE_LEVELS, PreferenceLevel, ProfileCriterion } from '../types';
import { theme } from '../theme';

interface Props {
  userId: string;
  onBack: () => void;
}

/** Formulations que le backend relie couramment à un critère produit
 *  (livraison / neuf-occasion / budget). Un point de départ fiable ; le champ
 *  libre reste possible pour le reste. */
const PREFERENCE_SUGGESTIONS = ['Livraison en France', 'Produit neuf', 'Budget serré'];

const LEVEL_LABEL: Record<PreferenceLevel, string> = {
  required: 'obligatoire',
  very_important: 'très important',
  important: 'important',
  preference: 'préférence',
  low: 'accessoire',
  forbidden: 'interdit',
  none: 'aucun',
};

/**
 * Permanent preferences.
 *
 * These outlive any single search. What the user types in the search box
 * describes only the CURRENT search and may contradict a preference stored
 * here — the backend arbitrates that (a current requirement can take
 * precedence). This screen therefore never touches search state, and the
 * search screen never writes here.
 */
export function ProfileScreen({ userId, onBack }: Props) {
  const [criteria, setCriteria] = useState<ProfileCriterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [level, setLevel] = useState<PreferenceLevel>('important');

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const profile = await loadProfile(userId);
      setCriteria(profile.criteria);
    } catch (err) {
      setError((err as ApiError).message ?? 'Profil indisponible.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [userId]);

  async function onAdd() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await saveCriterion(userId, { id: criterionId(trimmed), name: trimmed, level });
      setName('');
      await refresh();
    } catch (err) {
      setError((err as ApiError).message ?? "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteCriterion(userId, id);
      await refresh();
    } catch (err) {
      setError((err as ApiError).message ?? 'La suppression a échoué.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Revenir à la recherche"
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Text style={styles.backText}>‹ Recherche</Text>
      </Pressable>

      <Text style={styles.title} accessibilityRole="header">Vos préférences</Text>
      <Text style={styles.subtitle}>
        Ces préférences permanentes sont jointes à chaque recherche. Capucine les prend en
        compte lorsqu’elle sait relier votre formulation à un critère du produit — sinon
        elle les conserve sans pouvoir les appliquer. Une demande ponctuelle qui les
        contredit reste prioritaire pour cette recherche-là.
      </Text>

      <Text style={styles.section} accessibilityRole="header">Ajouter une préférence</Text>
      <View style={styles.suggestions}>
        {PREFERENCE_SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => setName(s)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Pré-remplir : ${s}`}
            style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
          >
            <Text style={styles.suggestionText}>{s}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="ex. Livraison en France"
        placeholderTextColor={theme.color.textMuted}
        editable={!busy}
        accessibilityLabel="Nom de la préférence"
      />

      <Text style={styles.label}>Importance</Text>
      <View style={styles.levels}>
        {PREFERENCE_LEVELS.map((l) => (
          <Pressable
            key={l}
            onPress={() => setLevel(l)}
            accessibilityRole="radio"
            accessibilityState={{ selected: level === l }}
            accessibilityLabel={`Importance : ${LEVEL_LABEL[l]}`}
            style={({ pressed }) => [
              styles.level, level === l && styles.levelActive, pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.levelText, level === l && styles.levelTextActive]}>
              {LEVEL_LABEL[l]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={onAdd}
        disabled={busy || name.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel="Enregistrer la préférence"
        accessibilityState={{ disabled: busy || name.trim().length === 0, busy }}
        style={({ pressed }) => [
          styles.button,
          (pressed || busy || name.trim().length === 0) && styles.buttonMuted,
        ]}
      >
        {busy ? <ActivityIndicator color={theme.color.accentText} />
              : <Text style={styles.buttonText}>Enregistrer</Text>}
      </Pressable>

      {error ? (
        <View style={styles.errorBox} accessibilityLiveRegion="assertive">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.section} accessibilityRole="header">
        Préférences enregistrées {loading ? '' : `(${criteria.length})`}
      </Text>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Chargement du profil" />
      ) : criteria.length === 0 ? (
        <Text style={styles.empty}>
          Aucune préférence enregistrée. Capucine s’appuie alors uniquement sur ce que
          vous demandez à chaque recherche.
        </Text>
      ) : (
        criteria.map((c) => (
          <View key={c.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{c.name}</Text>
              <Text style={styles.rowLevel}>{LEVEL_LABEL[c.level] ?? c.level}</Text>
            </View>
            <Pressable
              onPress={() => onRemove(c.id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Supprimer la préférence ${c.name}`}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <Text style={styles.removeText}>Supprimer</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.space(2), paddingBottom: theme.space(6) },
  back: { minHeight: theme.minTouch, justifyContent: 'center' },
  backText: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text },
  subtitle: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(1), lineHeight: 21,
  },
  section: {
    fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text,
    marginTop: theme.space(3), marginBottom: theme.space(1),
  },
  label: {
    fontSize: theme.font.small, fontWeight: '600',
    color: theme.color.text, marginTop: theme.space(2), marginBottom: theme.space(1),
  },
  input: {
    minHeight: theme.minTouch + 6, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radius, paddingHorizontal: theme.space(2),
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1), marginBottom: theme.space(1) },
  suggestion: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radius, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.background,
  },
  suggestionText: { fontSize: theme.font.small, color: theme.color.text },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) },
  level: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radius, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  levelActive: { borderColor: theme.color.accent, backgroundColor: '#EAF0FE' },
  levelText: { fontSize: theme.font.small, color: theme.color.text },
  levelTextActive: { color: theme.color.accent, fontWeight: '700' },
  button: {
    minHeight: theme.minTouch + 6, borderRadius: theme.radius,
    backgroundColor: theme.color.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: theme.space(2),
  },
  buttonMuted: { opacity: 0.6 },
  buttonText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
  errorBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: '#FDF3F3',
  },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, fontWeight: '600' },
  empty: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 22 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.space(1),
    backgroundColor: theme.color.surface, borderRadius: theme.radius, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(1.5), marginBottom: theme.space(1),
  },
  rowText: { flex: 1 },
  rowName: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  rowLevel: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },
  remove: { minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1) },
  removeText: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },
});
