import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDailyLog } from '../hooks/useDailyLog';
import { Screen } from '../components/Screen';
import { theme } from '../theme';

type DailyLogType = 'respected' | 'expense_avoided' | 'expense_made' | 'no_declaration';

const OPTION_CONFIG = {
  respected: {
    label: 'J\'ai respecté mon challenge',
    description: 'Aucune dépense non essentielle aujourd\'hui',
    icon: '✅',
    color: '#1F5C4D',
    requiresAmount: false,
  },
  expense_avoided: {
    label: 'J\'ai évité une dépense non essentielle',
    description: 'J\'ai résisté à une tentation d\'achat non essentiel',
    icon: '🛡️',
    color: '#1C6B44',
    requiresAmount: true,
  },
  expense_made: {
    label: 'J\'ai fait une dépense non essentielle',
    description: 'J\'ai cédé à une envie d\'achat non prévu',
    icon: '⚠️',
    color: '#9B2C2C',
    requiresAmount: true,
  },
};

export function DailyLogScreen({ challenge, onBack }: { challenge: any; onBack: () => void }) {
  const [selectedType, setSelectedType] = useState<'respected' | 'expense_avoided' | 'expense_made' | null>(null);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const isPastDate = false;

  const handleSubmit = () => {
    if (!selectedType) {
      setError('Veuillez choisir une option');
      return;
    }
    if (selectedType !== 'respected' && !amount.trim()) {
      setError('Le montant est requis');
      return;
    }
    if (amount && !/^\d+(\.\d{1,2})?$/.test(amount.replace(',', '.'))) {
      setError('Montant invalide');
      return;
    }
    console.log('Soumission:', { type: selectedType, amount, comment });
  };

  const selectedConfig = selectedType ? {
    label: selectedType === 'respected' ? 'J\'ai respecté mon challenge' :
           selectedType === 'expense_avoided' ? 'J\'ai évité une dépense' : 'J\'ai fait une dépense',
    description: selectedType === 'respected' ? 'Aucune dépense non essentielle aujourd\'hui' :
                 selectedType === 'expense_avoided' ? 'J\'ai résisté à une tentation d\'achat non essentiel' : 'J\'ai cédé à une envie d\'achat non prévu',
    icon: selectedType === 'respected' ? '✅' : selectedType === 'expense_avoided' ? '🛡️' : '⚠️',
    color: selectedType === 'respected' ? '#1F5C4D' : selectedType === 'expense_avoided' ? '#1C6B44' : '#9B2C2C',
    requiresAmount: selectedType !== 'respected',
  } : null;

  const requiresAmount = selectedType && selectedType !== 'respected';

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Déclarer ma journée</Text>
        <Text style={styles.subtitle}>Comment s\'est passée votre journée ?</Text>
      </View>

      <View style={styles.options}>
        {(['respected', 'expense_avoided', 'expense_made'] as const).map((type) => {
          const config = {
            respected: { label: 'J\'ai respecté mon challenge', description: 'Aucune dépense non essentielle aujourd\'hui', icon: '✅', color: '#1F5C4D', requiresAmount: false },
            expense_avoided: { label: 'J\'ai évité une dépense', description: 'J\'ai résisté à une tentation d\'achat non essentiel', icon: '🛡️', color: '#1C6B44', requiresAmount: true },
            expense_made: { label: 'J\'ai fait une dépense', description: 'J\'ai cédé à une envie d\'achat non prévu', icon: '⚠️', color: '#9B2C2C', requiresAmount: true },
          }[type];
          
          const isSelected = selectedType === type;
          return (
            <Pressable
              key={type}
              onPress={() => setSelectedType(type)}
              accessibilityRole="button"
              accessibilityLabel={config.label}
              style={({ pressed }) => [
                styles.option,
                isSelected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
              hitSlop={8}
            >
              <View style={styles.iconWrap}>
                <Text style={[styles.iconText, { color: isSelected ? config.color : '#fff' }]}>{config.icon}</Text>
              </View>
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>{config.label}</Text>
                <Text style={styles.optionDescription}>{config.description}</Text>
              </View>
              <View style={styles.optionCheck}>
                {selectedType === type && <Text style={styles.checkMark}>✓</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>

      {selectedType && (
        <>
          <View style={styles.amountSection}>
            <Text style={styles.amountLabel}>Montant (€)</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              placeholder="0,00"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              maxLength={10}
              onChangeText={(text) => setAmount(text.replace(',', '.').replace(/[^0-9.,]/g, ''))}
            />
            
          </View>
        </>
      )}

      <View style={styles.commentSection}>
        <Text style={styles.commentLabel}>Commentaire (optionnel)</Text>
        <TextInput
          style={styles.commentInput}
          value={comment}
          onChangeText={setComment}
          placeholder="Ce qui s'est passé, ce que vous avez ressenti..."
          placeholderTextColor="#999"
          multiline
          numberOfLines={3}
          maxLength={500}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[
          styles.submitButton,
          !selectedType && styles.disabled,
          submitting && styles.loading,
        ]}
        onPress={handleSubmit}
        disabled={!selectedType || submitting}
        accessibilityLabel="Valider ma déclaration"
        hitSlop={8}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : (
          <Text style={styles.submitText}>Valider ma déclaration</Text>
        )}
      </Pressable>

      <Text style={styles.footerNote}>
        Une seule déclaration par jour. Vous pourrez la modifier plus tard si besoin.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#15130F',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#736E65',
    marginTop: 4,
    letterSpacing: -0.2,
  },
  options: {
    gap: 12,
    marginBottom: 24,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7E2D8',
    backgroundColor: '#FBF9F5',
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: '#1F5C4D',
  },
  pressed: {
    opacity: 0.7,
  },
  iconWrap: { width: 44, height: 24, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  iconText: { fontSize: 22 },
  optionContent: { flex: 1 },
  optionLabel: { fontSize: 16, fontWeight: '600', color: '#15130F' },
  optionDescription: { fontSize: 13, color: '#736E65', marginTop: 2, lineHeight: 18 },
  optionCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#1F5C4D', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F5C4D' },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  amountSection: { marginTop: 20, marginBottom: 16 },
  amountLabel: { fontSize: 14, color: '#736E65', marginBottom: 8 },
  amountInput: { fontSize: 28, fontWeight: '700', color: '#15130F', textAlign: 'center', paddingHorizontal: 20, paddingVertical: 16, borderWidth: 2, borderColor: '#E7E2D8', borderRadius: 16 },
  commentSection: { marginTop: 20 },
  commentLabel: { fontSize: 14, fontWeight: '600', color: '#5B5750', marginTop: 16, marginBottom: 8 },
  commentInput: { minHeight: 100, padding: 16, borderWidth: 1, borderColor: '#E7E2D8', borderRadius: 12, backgroundColor: '#FBF9F5', fontSize: 16, color: '#15130F', textAlignVertical: 'top', paddingTop: 12 },
  error: { marginTop: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#9B2C2C', backgroundColor: '#FDF3F3' },
  errorText: { color: '#9B2C2C', fontSize: 14, fontWeight: '600' },
  submitButton: { marginTop: 24, paddingVertical: 18, borderRadius: 16, backgroundColor: '#1F5C4D', alignItems: 'center', justifyContent: 'center', shadowColor: '#1F5C4D', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  submitText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  loading: { opacity: 0.8 },
  footerNote: { marginTop: 28, fontSize: 13, color: '#736E65', textAlign: 'center', lineHeight: 18 },
});
export default DailyLogScreen;
