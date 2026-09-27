import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/** The « Prisme » mark, simplified: a marine lozenge with a gold C.
 *  Decorative — hidden from assistive tech (the message carries the meaning). */
export function CapucineAvatar({ size = 32 }: { size?: number }) {
  const side = size / Math.SQRT2;
  return (
    <View style={[styles.box, { width: size, height: size }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[styles.lozenge, { width: side, height: side, borderRadius: size * 0.08 }]} />
      <Text style={[styles.letter, { fontSize: size * 0.46 }]}>C</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  lozenge: {
    position: 'absolute', transform: [{ rotate: '45deg' }],
    backgroundColor: theme.color.brandSurface, borderWidth: 1, borderColor: theme.color.gold,
  },
  letter: { color: theme.color.gold, fontWeight: theme.weight.bold },
});
