import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  clearAvailabilityPreference, clearRankingPreference, deleteCriterion, excludeMerchant,
  loadProfile, saveCriterion, setAvailabilityPreference, setRankingPreference, unexcludeMerchant,
} from '../api';
import {
  availabilityPreferenceOf, freeTextPreferenceCriterion, isMerchantExclusion,
  merchantNameOf, rankingPreferenceOf,
} from '../profile';
import { ApiError, PREFERENCE_LEVELS, PreferenceLevel, ProfileCriterion } from '../types';
import { theme, cardStyle, inputStyle, primaryButtonStyle, secondaryButtonStyle, textStyle } from '../theme';

interface Props {
  userId: string;
  onOpenOnboarding?: () => void;
}

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
 * Permanent preferences — organized in clear sections.
 * These outlive any single search. A current query can contradict a preference
 * — the backend arbitrates (a current requirement can take precedence).
 * This screen never touches search state, and the search screen never writes here.
 */
export function ProfileScreen({ userId, onOpenOnboarding }: Props) {
  const [criteria, setCriteria] = useState<ProfileCriterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [level, setLevel] = useState<PreferenceLevel>('important');
  const [merchant, setMerchant] = useState('');

  const merchantExclusions = criteria.filter(isMerchantExclusion);
  const cheapestFirst = rankingPreferenceOf(criteria) === 'PRICE_LOWEST';
  const availabilityFirst = availabilityPreferenceOf(criteria);
  const otherCriteria = criteria.filter(
    (c) => !isMerchantExclusion(c)
      && c.id !== 'ranking-preference'
      && c.id !== 'availability-preference'
  );

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
      await saveCriterion(userId, freeTextPreferenceCriterion(trimmed, level));
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

  async function onAddMerchant() {
    const trimmed = merchant.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await excludeMerchant(userId, trimmed);
      setMerchant('');
      await refresh();
    } catch (err) {
      setError((err as ApiError).message ?? "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveMerchant(merchantName: string) {
    setBusy(true);
    setError(null);
    try {
      await unexcludeMerchant(userId, merchantName);
      await refresh();
    } catch (err) {
      setError((err as ApiError).message ?? 'La suppression a échoué.');
    } finally {
      setBusy(false);
    }
  }

  async function onToggleCheapestFirst() {
    setBusy(true);
    setError(null);
    try {
      if (cheapestFirst) await clearRankingPreference(userId);
      else await setRankingPreference(userId, 'PRICE_LOWEST');
      await refresh();
    } catch (err) {
      setError((err as ApiError).message ?? "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleAvailabilityFirst() {
    setBusy(true);
    setError(null);
    try {
      if (availabilityFirst) await clearAvailabilityPreference(userId);
      else await setAvailabilityPreference(userId);
      await refresh();
    } catch (err) {
      setError((err as ApiError).message ?? "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <Text style={styles.title} accessibilityRole="header">Mon Capucine</Text>
      <Text style={styles.subtitle}>
        Ces préférences permanentes sont jointes à chaque recherche. Une demande ponctuelle
        qui les contredit reste prioritaire pour cette recherche-là.
      </Text>

      {onOpenOnboarding ? (
        <Pressable
          onPress={onOpenOnboarding}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Revoir les questions de création de profil"
          style={({ pressed }) => [styles.onboardingLink, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Text style={styles.onboardingLinkText}>Revoir les questions de profil</Text>
        </Pressable>
      ) : null}

      {/* ── MERCHANTS À ÉVITER — concrete, immediate effect ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Marchands à éviter</Text>
        <Text style={styles.sectionNote}>
          Leurs offres sont masquées dès la prochaine recherche. Capucine vous indique
          combien d'offres ont été retirées.
        </Text>

        <View style={styles.inlineRow}>
          <TextInput
            style={[styles.input, styles.inlineInput]}
            value={merchant}
            onChangeText={setMerchant}
            placeholder="ex. Amazon"
            placeholderTextColor={theme.color.textMuted}
            editable={!busy}
            onSubmitEditing={onAddMerchant}
            returnKeyType="done"
            accessibilityLabel="Nom du marchand à éviter"
          />
          <Pressable
            onPress={onAddMerchant}
            disabled={busy || merchant.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Ajouter ce marchand à éviter"
            accessibilityState={{ disabled: busy || merchant.trim().length === 0, busy }}
            style={({ pressed }) => [
              styles.inlineBtn,
              (pressed || busy || merchant.trim().length === 0) && styles.buttonMuted,
            ]}
            hitSlop={8}
          >
            <Text style={styles.buttonText}>Éviter</Text>
          </Pressable>
        </View>

        {merchantExclusions.length === 0 ? (
          <Text style={styles.empty}>Aucun marchand exclu.</Text>
        ) : (
          merchantExclusions.map((c) => {
            const mName = merchantNameOf(c) ?? c.name;
            return (
              <View key={c.id} style={styles.exclusionRow}>
                <Text style={styles.exclusionName}>{mName}</Text>
                <Pressable
                  onPress={() => onRemoveMerchant(mName)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Ne plus éviter ${mName}`}
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                  hitSlop={8}
                >
                  <Text style={styles.removeText}>Retirer</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      {/* ── ORDRE PAR DÉFAUT — immediate, verifiable effect ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Ordre des résultats</Text>
        <Pressable
          onPress={onToggleCheapestFirst}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityLabel="Toujours trier par coût total le plus bas"
          accessibilityState={{ checked: cheapestFirst, disabled: busy }}
          style={({ pressed }) => [styles.toggleCard, pressed && styles.pressed]}
          hitSlop={8}
        >
          <View style={styles.toggleContent}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.toggleName}>Toujours trier par coût total le plus bas</Text>
              <Text style={styles.toggleDesc}>
                {cheapestFirst
                  ? 'Activé — appliqué dès la prochaine recherche'
                  : 'Désactivé — Capucine classe par correspondance'}
              </Text>
            </View>
            <View style={[styles.toggleIndicator, cheapestFirst && styles.toggleIndicatorOn]} />
          </View>
        </Pressable>
      </View>

      {/* ── DISPONIBILITÉ — distinct axis from ordering above ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Disponibilité</Text>
        <Pressable
          onPress={onToggleAvailabilityFirst}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityLabel="Privilégier la disponibilité immédiate"
          accessibilityHint="À correspondance proche, une offre en stock confirmé passe devant. Ne pénalise jamais une disponibilité inconnue."
          accessibilityState={{ checked: availabilityFirst, disabled: busy }}
          style={({ pressed }) => [styles.toggleCard, pressed && styles.pressed]}
          hitSlop={8}
        >
          <View style={styles.toggleContent}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.toggleName}>Privilégier la disponibilité immédiate</Text>
              <Text style={styles.toggleDesc}>
                {availabilityFirst
                  ? 'Activé — une offre en stock confirmé est favorisée à correspondance proche'
                  : 'Désactivé — la disponibilité ne départage que les ex æquo'}
              </Text>
            </View>
            <View style={[styles.toggleIndicator, availabilityFirst && styles.toggleIndicatorOn]} />
          </View>
        </Pressable>
      </View>

      {/* ── PRÉFÉRENCES LIBRES ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Ajouter une préférence</Text>
        <Text style={styles.sectionNote}>
          Capucine les prend en compte lorsqu'elle sait relier votre formulation à un critère
          du produit — sinon elle les conserve sans pouvoir les appliquer.
        </Text>

        <View style={styles.suggestions}>
          {PREFERENCE_SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setName(s)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Pré-remplir : ${s}`}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              hitSlop={8}
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
                styles.levelBtn, level === l && styles.levelBtnActive, pressed && styles.pressed,
              ]}
              hitSlop={6}
            >
              <Text style={[styles.levelBtnText, level === l && styles.levelBtnTextActive]}>
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
            styles.primaryBtn,
            (pressed || busy || name.trim().length === 0) && styles.buttonMuted,
          ]}
          hitSlop={8}
        >
          {busy ? <ActivityIndicator color={theme.color.accentText} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </Pressable>

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      {/* ── PRÉFÉRENCES ENREGISTRÉES ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Préférences enregistrées {loading ? '' : `(${otherCriteria.length})`}
        </Text>

        {loading ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator accessibilityLabel="Chargement du profil" />
          </View>
        ) : otherCriteria.length === 0 ? (
          <Text style={styles.empty}>
            Aucune préférence enregistrée. Capucine s'appuie alors uniquement sur ce que
            vous demandez à chaque recherche.
          </Text>
        ) : (
          otherCriteria.map((c) => (
            <View key={c.id} style={styles.prefRow}>
              <View style={styles.prefInfo}>
                <Text style={styles.prefName}>{c.name}</Text>
                <Text style={styles.prefLevel}>{LEVEL_LABEL[c.level] ?? c.level}</Text>
              </View>
              <Pressable
                onPress={() => onRemove(c.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Supprimer la préférence ${c.name}`}
                style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                hitSlop={8}
              >
                <Text style={styles.removeText}>Supprimer</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      {/* ── COMPTES MARCHANDS — placeholder architecture ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Comptes marchands</Text>
        <Text style={styles.sectionNote}>
          L'association de comptes marchands (OAuth, sessions officielles) n'est pas encore
          disponible. Cette section est préparée pour une future intégration respectueuse
          de la vie privée — Capucine ne stockera jamais vos mots de passe.
        </Text>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Bientôt disponible</Text>
        </View>
      </View>

      {/* Version / debug — subtle */}
      <Text style={styles.version}>Capucine • version 0.1.0</Text>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: theme.space(2), paddingBottom: theme.space(8) },
  title: { fontSize: theme.font.title + 2, fontWeight: '700', color: theme.color.text },
  subtitle: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginTop: theme.space(1), marginBottom: theme.space(4), lineHeight: 21,
  },
  section: { marginBottom: theme.space(4) },
  sectionTitle: {
    fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text,
    marginBottom: theme.space(1),
  },
  sectionNote: {
    fontSize: theme.font.small, color: theme.color.textMuted,
    marginBottom: theme.space(2), lineHeight: 19,
  },
  inlineRow: { flexDirection: 'row', gap: theme.space(1), alignItems: 'stretch' },
  inlineInput: { flex: 1, minHeight: theme.minTouch },
  inlineBtn: {
    minHeight: theme.minTouch, borderRadius: theme.radii.md, backgroundColor: theme.color.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space(2),
    ...theme.shadow.subtle,
  },
  toggleCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(2),
    ...theme.shadow.subtle,
  },
  toggleContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleTextCol: { flex: 1 },
  toggleName: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  toggleDesc: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2, lineHeight: 18 },
  toggleIndicator: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: theme.color.border, alignItems: 'flex-start', justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleIndicatorOn: { backgroundColor: theme.color.accent, alignItems: 'flex-end' },

  label: {
    fontSize: theme.font.small, fontWeight: '600',
    color: theme.color.text, marginTop: theme.space(3), marginBottom: theme.space(1),
  },
  input: {
    minHeight: theme.minTouch + 6, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radii.md, paddingHorizontal: theme.space(2),
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1), marginBottom: theme.space(1.5) },
  suggestion: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.background,
  },
  suggestionText: { fontSize: theme.font.small, color: theme.color.text },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1), marginBottom: theme.space(1.5) },
  levelBtn: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  levelBtnActive: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSoft },
  levelBtnText: { fontSize: theme.font.small, color: theme.color.text },
  levelBtnTextActive: { color: theme.color.accent, fontWeight: '700' },

  primaryBtn: {
    minHeight: theme.minTouch + 6, borderRadius: theme.radii.md,
    backgroundColor: theme.color.accent, alignItems: 'center',
    justifyContent: 'center', marginTop: theme.space(2),
    ...theme.shadow.card,
  },
  buttonMuted: { opacity: theme.opacity.disabled },
  buttonText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },

  errorBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: theme.color.dangerSoft,
  },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, fontWeight: '600' },

  empty: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 22, textAlign: 'center', paddingVertical: theme.space(2) },

  exclusionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.color.surface, borderRadius: theme.radii.md, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(1.5), marginBottom: theme.space(1),
    ...theme.shadow.subtle,
  },
  exclusionName: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  removeBtn: { minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1) },
  removeText: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },

  prefRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.color.surface, borderRadius: theme.radii.md, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(1.5), marginBottom: theme.space(1),
    ...theme.shadow.subtle,
  },
  prefInfo: { flex: 1 },
  prefName: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  prefLevel: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 2 },

  loadingCenter: { paddingVertical: theme.space(3), alignItems: 'center' },

  onboardingLink: {
    minHeight: theme.minTouch, justifyContent: 'center', alignItems: 'center',
    borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.color.accent,
    backgroundColor: theme.color.accentSoft, marginBottom: theme.space(2),
    ...theme.shadow.subtle,
  },
  onboardingLinkText: { color: theme.color.accentInk, fontSize: theme.font.body, fontWeight: '700' },

  comingSoon: {
    padding: theme.space(3), borderRadius: theme.radii.md,
    backgroundColor: theme.color.surfaceAlt, borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center',
  },
  comingSoonText: { color: theme.color.textMuted, fontSize: theme.font.body },

  version: {
    marginTop: theme.space(6), fontSize: theme.font.micro,
    color: theme.color.textFaint, textAlign: 'center',
  },
  pressed: { opacity: theme.opacity.pressed },
});