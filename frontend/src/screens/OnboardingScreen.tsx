import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay,
  interpolateColor, runOnJS,
} from 'react-native-reanimated';
import { submitOnboarding } from '../api';
import { ApiError, OnboardingAnswers, ShippingProfile } from '../types';
import { buildOnboardingAnswers, KNOWN_MERCHANT_NAMES } from '../onboarding';
import { theme, textStyle, neuralGlassStyle, glassStyle, HolographicButton, GlassCard, NeuralProgressRing, NeuralStageProgress, NeuralInput } from '../theme.futuristic';
import { NeuralInput } from '../components/NeuralInput';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STEPS = [
  { id: 'welcome', title: 'BIENVENUE', icon: '🤖' },
  { id: 'budget', title: 'BUDGET', icon: '💰' },
  { id: 'condition', title: 'ÉTAT', icon: '📦' },
  { id: 'shipping', title: 'LIVRAISON', icon: '🚚' },
  { id: 'origin', title: 'ORIGINE', icon: '🇫🇷' },
  { id: 'address', title: 'ADRESSE', icon: '🏠' },
  { id: 'merchants', title: 'MARCHANDS', icon: '🏪' },
] as const;

type StepId = typeof STEPS[number]['id'];

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

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingScreen({ userId, onComplete, onSkip }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const currentStep = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;
  const progress = (stepIndex + 1) / STEPS.length;

  const styles = textStyle(theme);

  // Animations
  const stepOpacity = useSharedValue(0);
  const stepTranslateY = useSharedValue(20);
  const progressAnim = useSharedValue(0);
  const pulseAnim = useSharedValue(0);
  const avatarScale = useSharedValue(1);

  useEffect(() => {
    stepOpacity.value = withSpring(1, theme.motion.spring.gentle);
    stepTranslateY.value = withSpring(0, theme.motion.spring.gentle);
    progressAnim.value = withSpring(progress, theme.motion.spring.standard);
  }, [stepIndex]);

  useEffect(() => {
    pulseAnim.value = withTiming(1, { duration: 1200, easing: (t) => t }, () => {
      pulseAnim.value = withTiming(0, { duration: 1200, easing: (t) => t });
    });
  }, [stepIndex]);

  const stepAnimatedStyle = useAnimatedStyle(() => ({
    opacity: stepOpacity.value,
    transform: [{ translateY: stepTranslateY.value }],
  }));

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    width: `${progressAnim.value * 100}%`,
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolateColor(pulseAnim.value, [0, 0.5, 1], [0.4, 1, 0.4]),
    transform: [{ scale: interpolateColor(pulseAnim.value, [0, 0.5, 1], [1, 1.05, 1]) }],
  }));

  const next = useCallback(() => {
    setError(null);
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }
    void submit();
  }, [stepIndex]);

  const submit = async () => {
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
  };

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

  const shipFields: Array<{ key: keyof ShippingProfile; label: string; placeholder: string; keyboard?: 'default' | 'email-address' }> = [
    { key: 'firstName', label: 'PRÉNOM', placeholder: 'Jeanne' },
    { key: 'lastName', label: 'NOM', placeholder: 'Dupont' },
    { key: 'email', label: 'E-MAIL', placeholder: 'jeanne@exemple.fr', keyboard: 'email-address' },
    { key: 'street', label: 'ADRESSE', placeholder: '12 rue des Lilas' },
    { key: 'postalCode', label: 'CODE POSTAL', placeholder: '35000' },
    { key: 'city', label: 'VILLE', placeholder: 'Rennes' },
    { key: 'country', label: 'PAYS', placeholder: 'France' },
  ];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.background}>
        {/* Animated Background */}
        <Animated.View style={[
          styles.bgOrb,
          { top: -SCREEN_WIDTH * 0.3, right: -SCREEN_WIDTH * 0.3 },
          pulseStyle,
        ]} />
        <Animated.View style={[
          styles.bgOrb,
          { bottom: -SCREEN_WIDTH * 0.2, left: -SCREEN_WIDTH * 0.2 },
          { backgroundColor: theme.color.pulseSoft },
          { transform: [{ scale: interpolateColor(pulseAnim.value, [0, 0.5, 1], [1, 1.1, 1]) }] },
        ]} />
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Progress Header */}
        <View style={styles.progressHeader}>
          <View style={styles.progressTrack}>
            <Animated.View style={[
              styles.progressFill,
              progressAnimatedStyle,
              { backgroundColor: theme.color.neural },
            ]} />
          </View>
          <View style={styles.progressSteps}>
            {STEPS.map((s, i) => (
              <View key={s.id} style={styles.progressStep}>
                <Animated.View style={[
                  styles.progressDot,
                  {
                    backgroundColor: i <= stepIndex ? theme.color.neural : theme.color.glassBorder,
                    borderWidth: i === stepIndex ? 3 : 0,
                    borderColor: theme.color.neural,
                    transform: [{ scale: i === stepIndex ? 1.3 : 1 }],
                  },
                ]} />
                <Text style={[
                  styles.progressStepLabel,
                  { color: i <= stepIndex ? theme.color.text : theme.color.textFaint },
                  { fontWeight: i === stepIndex ? theme.weight.bold : theme.weight.regular },
                ]}>
                  {s.icon}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[
            styles.progressText,
            { color: theme.color.textMuted, fontFamily: 'SpaceMono, monospace' },
          ]}>
            ÉTAPE {stepIndex + 1} / {STEPS.length}
          </Text>
        </View>

        {/* Agent Avatar */}
        <Animated.View style={[styles.agentHeader, stepAnimatedStyle]}>
          <Animated.View style={[
            styles.agentAvatar,
            pulseStyle,
            { backgroundColor: theme.color.neuralSoft },
          ]}>
            <Text style={{ fontSize: 48 }}>🤖</Text>
          </Animated.View>
          <Text style={[styles.agentName, { color: theme.color.text, fontFamily: 'SpaceMono, monospace' }]}>
            CAPUCINE
          </Text>
          <Text style={[styles.agentRole, { color: theme.color.textMuted }]}>
            {currentStep.title}
          </Text>
        </Animated.View>

        {/* Step Content */}
        <Animated.View style={[styles.contentCard, stepAnimatedStyle]}>
          <GlassCard variant="elevated" style={styles.stepCard}>
            {/* Welcome Step */}
            {stepIndex === 0 && (
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: theme.color.text }]}>
                  Bienvenue dans Capucine.
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                  Je suis votre agent d'achat autonome. Je compare les offres réelles,
                  calcule le coût total et ne vous cache jamais ce qui est inconnu.
                </Text>

                <GlassCard variant="neural" style={styles.promiseCard}>
                  <Text style={[styles.promiseTitle, { color: theme.color.neural }]}>
                    CE QUE JE NE FERAI PAS
                  </Text>
                  <Text style={[styles.promiseText, { color: theme.color.textMuted }]}>
                    Vos réponses sont des PRÉFÉRENCES : elles mettent en avant ce qui vous
                    correspond, mais ne limitent jamais vos résultats. Je continue de
                    chercher le plus large possible.
                  </Text>
                  <Text style={[styles.promiseText, { color: theme.color.textMuted }]}>
                    Vos réponses servent aussi à préparer votre commande (adresse, comptes clients)
                    pour que vous n'ayez plus qu'à valider — et vous pouvez refuser chaque question.
                  </Text>
                </GlassCard>
              </View>
            )}

            {/* Budget Step */}
            {stepIndex === 1 && (
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: theme.color.text }]}>
                  Quel est votre budget de référence ?
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                  Je favoriserai les offres sous ce montant, mais n'écarterai jamais une offre
                  au-dessus qui correspond mieux à votre demande.
                </Text>

                <View style={styles.inlineRow}>
                  <NeuralInput
                    label="BUDGET (€)"
                    value={budgetRaw}
                    onChangeText={setBudgetRaw}
                    placeholder="300"
                    keyboardType="numeric"
                    disabled={busy}
                    style={styles.budgetInput}
                    inputStyle={styles.budgetInputInner}
                  />
                </View>
              </View>
            )}

            {/* Condition Step */}
            {stepIndex === 2 && (
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: theme.color.text }]}>
                  Préférez-vous du neuf ou de l'occasion ?
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                  Un souhait de classement — une bonne occasion peut toujours être retenue si elle
                  correspond mieux que le reste.
                </Text>
                <View style={styles.optionsGrid}>
                  {([
                    ['new', 'NEUF', '🆕'],
                    ['used', 'OCCASION', '♻️'],
                    ['any', 'Peu importe', '✨'],
                  ] as const).map(([value, label, icon]) => (
                    <Pressable
                      key={value}
                      onPress={() => setCondition(value)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: condition === value }}
                      accessibilityLabel={`État : ${label}`}
                      style={({ pressed }) => [
                        styles.optionCard,
                        condition === value && styles.optionCardActive,
                        pressed && styles.optionCardPressed,
                      ]}
                    >
                      <Text style={{ fontSize: 28 }}>{icon}</Text>
                      <Text style={[
                        styles.optionLabel,
                        condition === value && styles.optionLabelActive,
                      ]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Shipping Step */}
            {stepIndex === 3 && (
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: theme.color.text }]}>
                  À quel point la livraison gratuite compte ?
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                  Une livraison payante ne sera jamais exclue — l'offre restera classée selon sa
                  correspondance et son coût total honnête.
                </Text>
                <View style={styles.optionsGrid}>
                  {OPTION_ROW.map((lv) => (
                    <Pressable
                      key={lv}
                      onPress={() => setFreeShipping(lv)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: freeShipping === lv }}
                      accessibilityLabel={`Livraison gratuite : ${LEVEL_LABEL[lv]}`}
                      style={({ pressed }) => [
                        styles.optionCard,
                        freeShipping === lv && styles.optionCardActive,
                        pressed && styles.optionCardPressed,
                      ]}
                    >
                      <Text style={[
                        styles.optionLabel,
                        freeShipping === lv && styles.optionLabelActive,
                        { fontWeight: theme.weight.bold },
                      ]}>
                        {LEVEL_LABEL[lv]}
                      </Text>
                      {freeShipping === lv && (
                        <Text style={[styles.optionHint, { color: theme.color.neural }]}>
                          {LEVEL_HINT[lv]}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Origin Step */}
            {stepIndex === 4 && (
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: theme.color.text }]}>
                  Avez-vous une préférence d'origine ?
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                  « Fabriqué en France » ou « en Europe » reçoit un coup de pouce — une offre d'origine
                  différente reste proposée si elle vous convient mieux.
                </Text>
                <View style={styles.optionsGrid}>
                  {([
                    ['france', 'FABRIQUÉ EN FRANCE', '🇫🇷'],
                    ['europe', 'FABRIQUÉ EN EUROPE', '🇪🇺'],
                    ['any', 'Peu importe', '🌍'],
                  ] as const).map(([value, label, icon]) => (
                    <Pressable
                      key={value}
                      onPress={() => setOrigin(value)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: origin === value }}
                      accessibilityLabel={`Origine : ${label}`}
                      style={({ pressed }) => [
                        styles.optionCard,
                        origin === value && styles.optionCardActive,
                        pressed && styles.optionCardPressed,
                      ]}
                    >
                      <Text style={{ fontSize: 28 }}>{icon}</Text>
                      <Text style={[
                        styles.optionLabel,
                        origin === value && styles.optionLabelActive,
                      ]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Address Step */}
            {stepIndex === 5 && (
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: theme.color.text }]}>
                  Où vous faire livrer ?
                </Text>
                <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                  Facultatif. Ces données pré-rempliront votre commande : vous n'aurez plus qu'à
                  valider. Elles ne servent jamais à filtrer vos recherches.
                </Text>
                {shipFields.map((f) => (
                  <NeuralInput
                    key={f.key}
                    label={f.label}
                    value={String(shipping[f.key] ?? '')}
                    onChangeText={(t) => setShipping((p) => ({ ...p, [f.key]: t }))}
                    placeholder={f.placeholder}
                    keyboardType={f.keyboard}
                    disabled={busy}
                    style={styles.addressInput}
                  />
                ))}
              </View>
            )}

            {/* Merchants Step */}
            {stepIndex === 6 && (
              <View style={styles.stepContent}>
                <View style={styles.sectionBlock}>
                  <Text style={[styles.questionSmall, { color: theme.color.text }]}>
                    Comptes clients que Capucine peut utiliser
                  </Text>
                  <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                    Cocher un marchand signifie que vous autorisez Capucine à se servir de votre compte
                    existant pour préparer votre commande. Rien d'autre. Vous pouvez aussi n'en
                    partager aucun.
                  </Text>
                  <View style={styles.chipsContainer}>
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
                          pressed && styles.chipPressed,
                        ]}
                      >
                        <Text style={[
                          styles.chipText,
                          sharedAccounts.has(m) && styles.chipTextActive,
                        ]}>
                          {m}
                        </Text>
                      </Pressable>
                    ))}
                    <NeuralInput
                      label="AUTRE"
                      value={sharedExtra}
                      onChangeText={setSharedExtra}
                      placeholder="Autre marchand…"
                      disabled={busy}
                      style={styles.extraInput}
                    />
                  </View>
                </View>

                <View style={styles.sectionBlock}>
                  <Text style={[styles.questionSmall, { color: theme.color.text }]}>
                    Marchands à éviter
                  </Text>
                  <Text style={[styles.stepSubtitle, { color: theme.color.textMuted }]}>
                    Leurs offres sont masquées dès la prochaine recherche, et je vous signalerai
                    combien ont été retirées.
                  </Text>
                  <View style={styles.inlineRow}>
                    <NeuralInput
                      label="MARCHAND"
                      value={excludedInput}
                      onChangeText={setExcludedInput}
                      placeholder="ex. Amazon"
                      disabled={busy}
                      onSubmitEditing={addExcluded}
                      returnKeyType="done"
                      style={styles.excludedInput}
                    />
                    <HolographicButton
                      variant="pulse"
                      size="md"
                      onPress={addExcluded}
                      disabled={busy || excludedInput.trim().length === 0}
                      accessibilityRole="button"
                      accessibilityLabel="Ajouter ce marchand à éviter"
                    >
                      ÉVITER
                    </HolographicButton>
                  </View>
                  {excluded.length === 0 ? (
                    <Text style={[styles.empty, { color: theme.color.textFaint }]}>
                      Aucun marchand exclu.
                    </Text>
                  ) : (
                    excluded.map((m) => (
                      <View key={m} style={styles.excludedRow}>
                        <Text style={[styles.excludedName, { color: theme.color.text }]}>{m}</Text>
                        <Pressable
                          onPress={() => setExcluded((p) => p.filter((x) => x !== m))}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={`Ne plus éviter ${m}`}
                          style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
                        >
                          <Text style={[styles.removeText, { color: theme.color.pulse }]}>RETIRER</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              </View>
            )}
          </GlassCard>
        </Animated.View>

        {/* Error Display */}
        {error && (
          <Animated.View style={[styles.errorCard, stepAnimatedStyle]}>
            <GlassCard variant="pulse" style={styles.errorCardInner}>
              <View style={styles.errorContent}>
                <Text style={[styles.errorIcon, { color: theme.color.pulse }]}>⚠</Text>
                <Text style={[styles.errorText, { color: theme.color.pulse }]}>{error}</Text>
              </View>
            </GlassCard>
          </Animated.View>
        )}

        {/* Navigation */}
        <Animated.View style={[styles.navRow, stepAnimatedStyle]}>
          {stepIndex > 0 ? (
            <HolographicButton
              variant="neural-ghost"
              size="lg"
              onPress={() => setStepIndex(stepIndex - 1)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Revenir à l'étape précédente"
              style={{ flex: 1 }}
            >
              PRÉCÉDENT
            </HolographicButton>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <HolographicButton
            variant={isLastStep ? 'pulse' : 'neural'}
            size="xl"
            onPress={next}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? 'Terminer et enregistrer mon profil' : 'Continuer'}
            accessibilityState={{ disabled: busy, busy }}
            loading={busy}
            style={{ flex: 1, marginLeft: stepIndex > 0 ? theme.space(2) : 0 }}
          >
            {isLastStep ? 'TERMINER' : 'CONTINUER'}
          </HolographicButton>
        </Animated.View>

        {/* Skip */}
        <Animated.View style={[styles.skipRow, stepAnimatedStyle]}>
          <Pressable
            onPress={onSkip}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Passer la création de profil"
            style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.skipText, { color: theme.color.textFaint, fontFamily: 'SpaceMono, monospace' }]}>
              PASSER POUR L'INSTANT — JE RÉPONDRAI PLUS TARD
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.background },
  background: { ...StyleSheet.absoluteFillObject },
  bgOrb: {
    position: 'absolute',
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
    borderRadius: SCREEN_WIDTH / 2,
    opacity: 0.15,
  },
  container: {
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(4),
    paddingBottom: theme.space(6),
    flexGrow: 1,
    zIndex: 1,
  },

  // Progress Header
  progressHeader: { marginBottom: theme.space(4), gap: theme.space(3) },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.glassBorder,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  progressSteps: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  progressStep: { alignItems: 'center', gap: theme.space(1) },
  progressDot: {
    width: 12, height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
  },
  progressStepLabel: { fontSize: 18, fontWeight: theme.weight.medium },
  progressText: { fontSize: theme.font.micro, textAlign: 'center', letterSpacing: 1 },

  // Agent Header
  agentHeader: { alignItems: 'center', gap: theme.space(2), marginBottom: theme.space(3) },
  agentAvatar: {
    width: 80, height: 80,
    borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.neuralGlow,
  },
  agentName: { fontSize: theme.font.label, fontWeight: theme.weight.extrabold, letterSpacing: 2 },
  agentRole: { fontSize: theme.font.body, fontWeight: theme.weight.light },

  // Content Card
  contentCard: { width: '100%' },
  stepCard: { padding: theme.space(4) },
  stepContent: { gap: theme.space(4) },
  stepTitle: { fontSize: theme.font.title, fontWeight: theme.weight.bold, letterSpacing: -0.5 },
  stepSubtitle: { fontSize: theme.font.body, lineHeight: theme.leading.body },

  // Promise Card
  promiseCard: { padding: theme.space(3), borderWidth: 1, borderColor: theme.color.neural },
  promiseTitle: { fontSize: theme.font.label, fontWeight: theme.weight.bold, letterSpacing: 1, fontFamily: 'SpaceMono, monospace', marginBottom: theme.space(2) },
  promiseText: { fontSize: theme.font.small, lineHeight: theme.leading.small, marginTop: theme.space(1) },

  // Inputs
  inlineRow: { flexDirection: 'row', gap: theme.space(2), alignItems: 'stretch' },
  budgetInput: { flex: 1 },
  budgetInputInner: { fontSize: theme.font.display, fontWeight: theme.weight.bold, textAlign: 'center', fontFamily: 'SpaceMono, monospace' },
  addressInput: { marginBottom: theme.space(2) },
  extraInput: { marginTop: theme.space(2) },
  excludedInput: { flex: 1 },

  // Options
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) },
  optionCard: {
    flex: 1,
    minWidth: 100,
    minHeight: 100,
    padding: theme.space(3),
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
    backgroundColor: theme.color.glass,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(2),
    ...theme.shadow.subtle,
  },
  optionCardActive: { borderColor: theme.color.neural, backgroundColor: theme.color.neuralSoft },
  optionCardPressed: { opacity: 0.8 },
  optionLabel: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, textAlign: 'center', color: theme.color.text },
  optionLabelActive: { color: theme.color.neural },
  optionHint: { fontSize: theme.font.micro, marginTop: theme.space(1), textAlign: 'center' },

  // Address
  sectionBlock: { marginTop: theme.space(3), paddingTop: theme.space(3), borderTopWidth: 1, borderTopColor: theme.color.glassBorder },
  questionSmall: { fontSize: theme.font.label, fontWeight: theme.weight.bold, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'SpaceMono, monospace' },

  // Chips
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2), marginTop: theme.space(2) },
  chip: {
    minHeight: theme.minTouch,
    paddingHorizontal: theme.space(3),
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.color.glassBorder,
    backgroundColor: theme.color.glass,
    ...theme.shadow.subtle,
  },
  chipActive: { borderColor: theme.color.neural, backgroundColor: theme.color.neuralSoft },
  chipPressed: { opacity: 0.8 },
  chipText: { fontSize: theme.font.small, fontWeight: theme.weight.medium, color: theme.color.text },
  chipTextActive: { color: theme.color.neural },

  // Excluded
  excludedRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: theme.space(2),
    backgroundColor: theme.color.glass,
    borderWidth: 1, borderColor: theme.color.glassBorder,
    borderRadius: theme.radii.md,
    marginTop: theme.space(2),
  },
  excludedName: { fontSize: theme.font.body, fontWeight: theme.weight.semibold },
  removeBtn: { paddingHorizontal: theme.space(2), paddingVertical: theme.space(1) },
  removeBtnPressed: { opacity: 0.7 },
  removeText: { fontSize: theme.font.small, fontWeight: theme.weight.bold, fontFamily: 'SpaceMono, monospace' },
  empty: { marginTop: theme.space(2) },

  // Error
  errorCard: { marginTop: theme.space(2) },
  errorCardInner: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2), padding: theme.space(3) },
  errorContent: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  errorIcon: { fontSize: 20 },
  errorText: { fontSize: theme.font.body, fontWeight: theme.weight.semibold },

  // Navigation
  navRow: { flexDirection: 'row', gap: theme.space(2), marginTop: theme.space(4) },
  skipRow: { marginTop: theme.space(3), alignItems: 'center' },
  skipBtn: { paddingVertical: theme.space(2) },
  skipText: { fontSize: theme.font.small, fontWeight: theme.weight.medium, letterSpacing: 0.5 },
});

export default OnboardingScreen;