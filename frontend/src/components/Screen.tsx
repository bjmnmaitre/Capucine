import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';

/**
 * Every tab's root. Paints the background edge to edge and pads the top safe
 * area (status bar, notch, Dynamic Island) once, so screens never re-handle
 * it. The bottom inset is owned by the TabBar, so scroll containers inside a
 * Screen only need their own `paddingBottom` to clear it (`Screen.tabClearance`).
 */
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }, style]}>
      {children}
    </View>
  );
}

/** Bottom padding a scroll view should add so its last item clears the tab bar. */
Screen.tabClearance = theme.space(3);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
});

/**
 * A screen's title block. `eyebrow` is the small line above the title
 * (a section name, a state). Kept generous — the type hierarchy, not chrome,
 * tells the user where they are.
 */
export function ScreenTitle({
  title, eyebrow, trailing,
}: {
  title: string;
  eyebrow?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={titleStyles.row}>
      <View style={titleStyles.textCol}>
        {eyebrow ? <Text style={titleStyles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={titleStyles.title} accessibilityRole="header">{title}</Text>
      </View>
      {trailing ? <View style={titleStyles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const titleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.space(1),
  },
  textCol: { flexShrink: 1 },
  eyebrow: {
    fontSize: theme.font.label,
    fontWeight: theme.weight.semibold,
    color: theme.color.textFaint,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: theme.space(0.5),
  },
  title: {
    fontSize: theme.font.display,
    lineHeight: theme.leading.display,
    fontWeight: theme.weight.bold,
    color: theme.color.text,
    letterSpacing: -0.4,
  },
  trailing: { paddingBottom: 2 },
});

/** A calm, centred empty state — no error styling, just guidance. */
export function EmptyState({
  title, body, action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={emptyStyles.wrap} accessibilityLiveRegion="polite">
      <Text style={emptyStyles.title}>{title}</Text>
      {body ? <Text style={emptyStyles.body}>{body}</Text> : null}
      {action ? <View style={emptyStyles.action}>{action}</View> : null}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: { paddingVertical: theme.space(6), paddingHorizontal: theme.space(2), alignItems: 'center' },
  title: {
    fontSize: theme.font.heading,
    lineHeight: theme.leading.heading,
    fontWeight: theme.weight.bold,
    color: theme.color.text,
    textAlign: 'center',
  },
  body: {
    fontSize: theme.font.body,
    lineHeight: theme.leading.body,
    color: theme.color.textMuted,
    textAlign: 'center',
    marginTop: theme.space(1),
    maxWidth: 320,
  },
  action: { marginTop: theme.space(2.5) },
});
