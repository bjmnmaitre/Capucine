import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { CapucineAvatar } from './CapucineAvatar';

/** Capucine speaking. Plain text bubble next to the Prisme mark — no blur,
 *  full-contrast text, announced politely to screen readers when it changes. */
export function AgentMessage({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessibilityLabel={`Capucine : ${text}`}>
      <CapucineAvatar size={compact ? 26 : 32} />
      <View style={[styles.bubble, compact && styles.bubbleCompact]}>
        <Text style={[styles.text, compact && styles.textCompact]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(1) },
  bubble: {
    flex: 1, backgroundColor: theme.color.surface, borderRadius: theme.radii.md,
    borderTopLeftRadius: theme.radii.xs, borderWidth: 1, borderColor: theme.color.border,
    paddingVertical: theme.space(1.25), paddingHorizontal: theme.space(1.5),
  },
  bubbleCompact: { paddingVertical: theme.space(0.75), paddingHorizontal: theme.space(1.25) },
  text: { fontSize: theme.font.body, lineHeight: theme.leading.body, color: theme.color.text },
  textCompact: { fontSize: theme.font.small, lineHeight: theme.leading.small },
});
