import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { submitOnboarding } from '../api';
import { ApiError, OnboardingAnswers, ShippingProfile } from '../types';
import { buildOnboardingAnswers, KNOWN_MERCHANT_NAMES } from '../onboarding';
import { theme } from '../theme';

interface Props {
  userId: string;
  /** Appelé avec `onboardingCompleted: true` une fois enregistré (profil complet). */
  onComplete: () => void;
  /** « Passer » — annule sans rien enregistrer (un profil vide reste valide). */
  onSkip: () => void;
}

const STEPS = ['Bienvenue', 'Budget', 'État', 'Livraison', 'Origine', 'Adresse', 'Marchands'] as const;
type StepIndex = number;

const OPTION_ROW = ['very_important', 'important', 'preference'] as const;
const LEVEL_LABEL: Record<string, string> = {
  very_important: 'Très important',
  important: 'Important',
  preference: 'Préférence',
};
const LEVEL_HINT: Record<string, string> = {
  very_important: 'Passe devant, sans jamais écarter le reste',
  important: 'Favorise les offres correspondantes',
  preference: 'Un léger coup de pouce',
};

export function OnboardingScreen({ userId, onComplete, onSkip }: Props) {
  const [step, setStep] = useState<StepIndex>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Réponses du wizard. Toutes optionnelles : on envoie ce qui a été rempli.
  const [budgetRaw, setBudgetRaw] = useState('');
  const [condition, setCondition] = useState<'new' | 'used' | 'any' | null>(null);
  const [freeShipping, setFreeShipping] = useState<OnboardingAnswers['freeShipping']>('preference');
  const [origin, setOrigin] = useState<'france' | 'europe' | 'any' | null>(null);
  const [shipping, setShipping] = useState<ShippingProfile>({});
  const [sharedAccounts, setSharedAccounts] = useState<Set<string>>(new Set());
  const [sharedExtra, setSharedExtra] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [excludedInput, setExcludedInput] = useState('');

  const answers: OnboardingAnswers = useMemo(
    () => buildOnboardingAnswers({
      budgetRaw,
      condition,
      freeShipping,
      origin,
      shipping,
      sharedAccounts: [...sharedAccounts],
      sharedExtra,
      excluded,
    }),
    [budgetRaw, condition, freeShipping, origin, shipping, sharedAccounts, sharedExtra, excluded]
  );

  function next() {
    setError(null);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    void submit();
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitOnboarding(userId, answers);
      onComplete();
    } catch (err) {
      setError((err as ApiError).message ?? "L'enregistrement du profil a échoué.");
    } finally {
      setBusy(false);
    }
  }

  function toggleAccount(name: string) {
    setSharedAccounts((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(name)) nextSet.delete(name);
      else nextSet.add(name);
      return nextSet;
    });
  }

  function addExcluded() {
    const t = excludedInput.trim();
    if (t.length === 0) return;
    if (!excluded.some((m) => m.toLowerCase() === t.toLowerCase())) setExcluded((p) => [...p, t]);
    setExcludedInput('');
  }

  const last = step === STEPS.length - 1;

  const shipFields: Array<{ key: keyof ShippingProfile; label: string; placeholder: string; keyboard?: 'default' | 'email-address' }> = [
    { key: 'firstName', label: 'Prénom', placeholder: 'Jeanne' },
    { key: 'lastName', label: 'Nom', placeholder: 'Dupont' },
    { key: 'email', label: 'E-mail', placeholder: 'jeanne@exemple.fr', keyboard: 'email-address' },
    { key: 'street', label: 'Adresse', placeholder: '12 rue des Lilas' },
    { key: 'postalCode', label: 'Code postal', placeholder: '35000' },
    { key: 'city', label: 'Ville', placeholder: 'Rennes' },
    { key: 'country', label: 'Pays', placeholder: 'France' },
  ];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>Étape {step + 1} sur {STEPS.length}</Text>
        <Text style={styles.title} accessibilityRole="header">{STEPS[step]}</Text>

        {step === 0 && (
          <View>
            <Text style={styles.subtitle}>
              Capucine cherche pour vous, sur tout le web, ce que vous décrivez — puis vous
              présente les meilleures options, honnêtement, avec le coût total réel.
            </Text>
            <View style={styles.promiseCard}>
              <Text style={styles.promiseTitle}>Ce que Capucine ne fera pas</Text>
              <Text style={styles.promiseText}>
                Vos réponses ci-après sont des PRÉFÉRENCES : elles mettent en avant ce qui vous
                correspond, mais elles ne limitent jamais vos résultats. Capucine continue de
                chercher le plus large possible.
              </Text>
              <Text style={styles.promiseText}>
                Vos réponses servent aussi à préparer votre commande (adresse, comptes clients)
                pour que vous n’ayez plus qu’à valider — et vous pouvez refuser chaque question.
              </Text>
            </View>
          </View>
        )}

        {step === 1 && (
          <View>
            <Text style={styles.question}>Quel est votre budget de référence ?</Text>
            <Text style={styles.hint}>
              Capucine favorisera les offres sous ce montant, mais n’écartera jamais une offre
              au-dessus qui correspond bien mieux à votre demande.
            </Text>
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={budgetRaw}
                onChangeText={setBudgetRaw}
                placeholder="300"
                placeholderTextColor={theme.color.textMuted}
                keyboardType="numeric"
                editable={!busy}
                accessibilityLabel="Budget de référence en euros"
              />
              <View style={styles.currencyBox}><Text style={styles.currencyText}>€</Text></View>
            </View>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.question}>Préférez-vous du neuf ou de l’occasion ?</Text>
            <Text style={styles.hint}>
              Un souhait de classement — une bonne occasion peut toujours être retenue si elle
              correspond mieux que le reste.
            </Text>
            <View style={styles.options}>
              {([
                ['new', 'Neuf'],
                ['used', 'Occasion'],
                ['any', 'Peu importe'],
              ] as const).map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => setCondition(value)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: condition === value }}
                  accessibilityLabel={`État : ${label}`}
                  style={({ pressed }) => [
                    styles.option, condition === value && styles.optionActive, pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.optionText, condition === value && styles.optionTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={styles.question}>À quel point la livraison gratuite compte ?</Text>
            <Text style={styles.hint}>
              Une livraison payante ne sera jamais exclue — l’offre restera classée selon sa
              correspondance et son coût total honnête.
            </Text>
            <View style={styles.options}>
              {OPTION_ROW.map((lv) => (
                <Pressable
                  key={lv}
                  onPress={() => setFreeShipping(lv)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: freeShipping === lv }}
                  accessibilityLabel={`Livraison gratuite : ${LEVEL_LABEL[lv]}`}
                  style={({ pressed }) => [
                    styles.option, freeShipping === lv && styles.optionActive, pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.optionText, freeShipping === lv && styles.optionTextActive]}>
                    {LEVEL_LABEL[lv]}
                  </Text>
                  {freeShipping === lv && <Text style={styles.optionHint}>{LEVEL_HINT[lv]}</Text>}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 4 && (
          <View>
            <Text style={styles.question}>Avez-vous une préférence d’origine ?</Text>
            <Text style={styles.hint}>
              « Fabriqué en France » ou « en Europe » reçoit un coup de pouce — une offre d’origine
              différente reste proposée si elle vous convient mieux.
            </Text>
            <View style={styles.options}>
              {([
                ['france', 'Fabriqué en France'],
                ['europe', 'Fabriqué en Europe'],
                ['any', 'Peu importe'],
              ] as const).map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => setOrigin(value)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: origin === value }}
                  accessibilityLabel={`Origine : ${label}`}
                  style={({ pressed }) => [
                    styles.option, origin === value && styles.optionActive, pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.optionText, origin === value && styles.optionTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 5 && (
          <View>
            <Text style={styles.question}>Où vous faire livrer ?</Text>
            <Text style={styles.hint}>
              Facultatif. Ces données pré-rempliront votre commande : vous n’aurez plus qu’à
              valider. Elles ne servent jamais à filtrer vos recherches.
            </Text>
            {shipFields.map((f) => (
              <TextInput
                key={f.key}
                style={[styles.input, styles.shipInput]}
                value={String(shipping[f.key] ?? '')}
                onChangeText={(t) => setShipping((p) => ({ ...p, [f.key]: t }))}
                placeholder={f.placeholder}
                placeholderTextColor={theme.color.textMuted}
                keyboardType={f.keyboard}
                editable={!busy}
                accessibilityLabel={f.label}
              />
            ))}
          </View>
        )}

        {step === 6 && (
          <View>
            <View style={styles.sectionBlock}>
              <Text style={styles.questionSmall}>Comptes clients que Capucine peut utiliser</Text>
              <Text style={styles.hint}>
                Cocher un marchand signifie que vous autorisez Capucine à se servir de votre compte
                existant pour préparer votre commande. Rien d’autre. Vous pouvez aussi n’en
                partager aucun.
              </Text>
              <View style={styles.chips}>
                {KNOWN_MERCHANT_NAMES.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => toggleAccount(m)}
                    disabled={busy}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sharedAccounts.has(m) }}
                    accessibilityLabel={`Partager mon compte ${m}`}
                    style={({ pressed }) => [
                      styles.chip,
                      sharedAccounts.has(m) && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, sharedAccounts.has(m) && styles.chipTextActive]}>
                      {m}
                    </Text>
                  </Pressable>
                ))}
                <TextInput
                  style={[styles.input, styles.chipInput]}
                  value={sharedExtra}
                  onChangeText={setSharedExtra}
                  placeholder="Autre marchand…"
                  placeholderTextColor={theme.color.textMuted}
                  editable={!busy}
                  accessibilityLabel="Autre marchand à partager"
                />
              </View>
            </View>

            <View style={styles.sectionBlock}>
              <Text style={styles.questionSmall}>Marchands à éviter</Text>
              <Text style={styles.hint}>
                Leurs offres sont masquées dès la prochaine recherche, et Capucine vous signale
                combien ont été retirées.
              </Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={excludedInput}
                  onChangeText={setExcludedInput}
                  placeholder="ex. Amazon"
                  placeholderTextColor={theme.color.textMuted}
                  editable={!busy}
                  onSubmitEditing={addExcluded}
                  returnKeyType="done"
                  accessibilityLabel="Nom du marchand à éviter"
                />
                <Pressable
                  onPress={addExcluded}
                  disabled={busy || excludedInput.trim().length === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Ajouter ce marchand à éviter"
                  accessibilityState={{ disabled: busy || excludedInput.trim().length === 0, busy }}
                  style={({ pressed }) => [
                    styles.inlineBtn,
                    (pressed || busy || excludedInput.trim().length === 0) && styles.buttonMuted,
                  ]}
                >
                  <Text style={styles.inlineBtnText}>Éviter</Text>
                </Pressable>
              </View>
              {excluded.length === 0 ? (
                <Text style={styles.empty}>Aucun marchand exclu.</Text>
              ) : (
                excluded.map((m) => (
                  <View key={m} style={styles.excludedRow}>
                    <Text style={styles.excludedName}>{m}</Text>
                    <Pressable
                      onPress={() => setExcluded((p) => p.filter((x) => x !== m))}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Ne plus éviter ${m}`}
                      style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                    >
                      <Text style={styles.removeText}>Retirer</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </View>
        )}

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.navRow}>
          {step > 0 ? (
            <Pressable
              onPress={() => setStep(step - 1)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Revenir à l'étape précédente"
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryBtnText}>Précédent</Text>
            </Pressable>
          ) : (
            <View style={styles.navSpacer} />
          )}
          <Pressable
            onPress={next}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={last ? 'Terminer et enregistrer mon profil' : 'Continuer'}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [styles.primaryBtn, (pressed || busy) && styles.buttonMuted]}
          >
            {busy ? <ActivityIndicator color={theme.color.accentText} />
                  : <Text style={styles.primaryBtnText}>{last ? 'Terminer' : 'Continuer'}</Text>}
          </Pressable>
        </View>

        <Pressable
          onPress={onSkip}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Passer la création de profil"
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>Passer pour l’instant — je répondrai plus tard</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: theme.space(2), paddingBottom: theme.space(6) },
  eyebrow: {
    fontSize: theme.font.label, fontWeight: '700', color: theme.color.accentInk,
    marginBottom: theme.space(1),
  },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text },
  subtitle: { fontSize: theme.font.body, color: theme.color.textMuted, lineHeight: 23, marginTop: theme.space(1) },
  promiseCard: {
    marginTop: theme.space(3), padding: theme.space(2), borderRadius: theme.radii.md,
    backgroundColor: theme.color.accentSoft, borderWidth: 1, borderColor: theme.color.accent,
  },
  promiseTitle: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.accentInk },
  promiseText: {
    fontSize: theme.font.small, color: theme.color.accentInk, lineHeight: 20,
    marginTop: theme.space(1),
  },
  question: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text, marginTop: theme.space(2) },
  questionSmall: { fontSize: theme.font.heading, fontWeight: '700', color: theme.color.text },
  hint: {
    fontSize: theme.font.small, color: theme.color.textMuted, lineHeight: 20,
    marginTop: theme.space(1), marginBottom: theme.space(2),
  },
  inlineRow: { flexDirection: 'row', gap: theme.space(1), alignItems: 'stretch' },
  inlineInput: { flex: 1, minHeight: theme.minTouch },
  inlineBtn: {
    minHeight: theme.minTouch, borderRadius: theme.radii.md, backgroundColor: theme.color.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space(2),
  },
  inlineBtnText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
  currencyBox: {
    minHeight: theme.minTouch, borderRadius: theme.radii.md, backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: theme.space(2),
  },
  currencyText: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  input: {
    minHeight: theme.minTouch + 6, borderWidth: 1, borderColor: theme.color.border,
    borderRadius: theme.radii.md, paddingHorizontal: theme.space(2),
    fontSize: theme.font.body, color: theme.color.text, backgroundColor: theme.color.surface,
  },
  shipInput: { marginBottom: theme.space(1) },
  options: { gap: theme.space(1) },
  option: {
    minHeight: theme.minTouch, borderRadius: theme.radii.md, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space(2), paddingVertical: theme.space(1.5),
  },
  optionActive: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSoft },
  optionText: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  optionTextActive: { color: theme.color.accentInk },
  optionHint: { fontSize: theme.font.small, color: theme.color.accentInk, marginTop: 2 },
  sectionBlock: { marginTop: theme.space(2) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1), alignItems: 'center' },
  chipInput: { minWidth: 160, flexGrow: 1 },
  chip: {
    minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1.5),
    borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  chipActive: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSoft },
  chipText: { fontSize: theme.font.small, color: theme.color.text, fontWeight: '600' },
  chipTextActive: { color: theme.color.accentInk },
  excludedRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.space(1),
    backgroundColor: theme.color.surface, borderRadius: theme.radii.sm, borderWidth: 1,
    borderColor: theme.color.border, padding: theme.space(1.5), marginTop: theme.space(1),
  },
  excludedName: { flex: 1, fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  remove: { minHeight: theme.minTouch, justifyContent: 'center', paddingHorizontal: theme.space(1) },
  removeText: { color: theme.color.danger, fontSize: theme.font.small, fontWeight: '600' },
  empty: { fontSize: theme.font.body, color: theme.color.textMuted, marginTop: theme.space(1) },
  errorBox: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radii.md,
    borderWidth: 1, borderColor: theme.color.danger, backgroundColor: theme.color.dangerSoft,
  },
  errorText: { color: theme.color.danger, fontSize: theme.font.body, fontWeight: '600' },
  navRow: { flexDirection: 'row', gap: theme.space(1), marginTop: theme.space(3) },
  navSpacer: { flex: 1 },
  primaryBtn: {
    flex: 1, minHeight: theme.minTouch, borderRadius: theme.radii.md,
    backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: theme.color.accentText, fontSize: theme.font.body, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, minHeight: theme.minTouch, borderRadius: theme.radii.md, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600' },
  buttonMuted: { opacity: 0.6 },
  skip: { alignItems: 'center', marginTop: theme.space(2), minHeight: theme.minTouch, justifyContent: 'center' },
  skipText: { color: theme.color.textMuted, fontSize: theme.font.small, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});