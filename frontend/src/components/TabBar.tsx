import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { Icon, IconName } from './Icon';

export type TabKey = 'home' | 'searches' | 'compare' | 'activity' | 'profile';

interface TabDef {
  key: TabKey;
  label: string;
  icon: IconName;
  /** Spoken as the accessible name — the visible label is already short. */
  a11y: string;
}

const TABS: TabDef[] = [
  { key: 'home', label: 'Accueil', icon: 'home', a11y: 'Accueil' },
  { key: 'searches', label: 'Recherches', icon: 'search', a11y: 'Mes recherches' },
  { key: 'compare', label: 'Comparer', icon: 'compare', a11y: 'Comparer des offres' },
  { key: 'activity', label: 'Activité', icon: 'activity', a11y: 'Activité de Capucine' },
  { key: 'profile', label: 'Profil', icon: 'profile', a11y: 'Mon Capucine' },
];

/**
 * Bottom navigation. Five destinations, always visible, thumb-reachable.
 * Switching tabs is pure state — it never triggers a network request.
 * A badge on "Comparer" signals a selection is waiting there.
 */
export function TabBar({
  active, onChange, compareCount = 0,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
  compareCount?: number;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, theme.space(1)) }]}
      accessibilityRole="tablist"
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? theme.color.accent : theme.color.textFaint;
        const showBadge = tab.key === 'compare' && compareCount > 0;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={
              tab.a11y + (showBadge ? `, ${compareCount} offre${compareCount > 1 ? 's' : ''} sélectionnée${compareCount > 1 ? 's' : ''}` : '')
            }
            style={styles.tab}
            hitSlop={6}
          >
            <View style={styles.iconWrap}>
              <Icon name={tab.icon} color={color} size={23} />
              {showBadge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{compareCount}</Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.label, { color }, selected && styles.labelActive]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.color.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    paddingTop: theme.space(1),
    paddingHorizontal: theme.space(0.5),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: theme.minTouch,
    paddingHorizontal: 2,
  },
  iconWrap: { width: 26, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 11,
    fontWeight: theme.weight.medium,
    letterSpacing: 0.1,
  },
  labelActive: { fontWeight: theme.weight.bold },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: theme.color.accentText,
    fontSize: 10,
    fontWeight: theme.weight.bold,
  },
});
