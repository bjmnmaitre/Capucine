import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { theme } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost';

/**
 * The one button. Three weights: `primary` (filled accent), `secondary`
 * (outlined), `ghost` (text only). Always ≥ 44pt tall, always shows a spinner
 * in place of its label while `loading`, always exposes `busy`/`disabled` to
 * assistive tech.
 */
export function Button({
  label, onPress, variant = 'primary', loading = false, disabled = false,
  accessibilityHint, style, full = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
  full?: boolean;
}) {
  const isOff = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isOff, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        full && styles.full,
        pressed && !isOff && styles.pressed,
        isOff && styles.off,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.color.accentText : theme.color.accent} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' ? styles.labelOnAccent : styles.labelAccent,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: theme.minTouch + 6,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.space(2.5),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  full: { alignSelf: 'stretch' },
  primary: { backgroundColor: theme.color.accent },
  secondary: {
    borderWidth: 1.5,
    borderColor: theme.color.accent,
    backgroundColor: 'transparent',
  },
  ghost: { paddingHorizontal: theme.space(1) },
  pressed: { opacity: 0.72 },
  off: { opacity: 0.45 },
  label: { fontSize: theme.font.body, fontWeight: theme.weight.bold, letterSpacing: 0.1 },
  labelOnAccent: { color: theme.color.accentText },
  labelAccent: { color: theme.color.accent },
});
