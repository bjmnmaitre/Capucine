import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  clearHistory, loadHistory, relativeTime, removeSearch, SearchHistoryEntry,
} from '../history';
import { Screen, ScreenTitle, EmptyState } from '../components/Screen';
import { theme, cardStyle, primaryButtonStyle, textStyle } from '../theme';

/**
 * The Recherches tab — your search history. Each card shows what you searched for,
 * when you searched, and how many results you got. Tap to rerun a search.
 */
export function SearchesScreen({
  onRun, onNewSearch,
}: {
  onRun: (query: string) => void;
  onNewSearch: () => void;
}) {
  const [items, setItems] = useState<SearchHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    let alive = true;
    void loadHistory().then((h) => { if (alive) { setItems(h); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  useEffect(reload, [reload]);

  async function onRemove(query: string) {
    setItems(await removeSearch(query));
  }

  async function onClearAll() {
    await clearHistory();
    setItems([]);
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <ScreenTitle
          eyebrow="Historique"
          title="Mes recherches"
          trailing={
            items.length > 0 ? (
              <Pressable
                onPress={onClearAll}
                accessibilityRole="button"
                accessibilityLabel="Tout effacer"
                hitSlop={8}
                style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
              >
                <Text style={styles.clearText}>Tout effacer</Text>
              </Pressable>
            ) : undefined
          }
        />

        {loaded && items.length === 0 ? (
          <EmptyState
            title="Aucune recherche pour l'instant"
            body="Vos recherches apparaîtront ici. Vous pourrez les relancer d'un geste."
            action={
              <Pressable onPress={onNewSearch} style={styles.actionButton}>
                <Text style={styles.actionButtonText}>Nouvelle recherche</Text>
              </Pressable>
            }
          />
        ) : (
          <View style={styles.list}>
            {items.map((h) => (
              <View key={`${h.query}-${h.at}`} style={styles.card}>
                <Pressable
                  onPress={() => onRun(h.query)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `Relancer : ${h.query}. ${h.resultCount} offre${h.resultCount > 1 ? 's' : ''} la dernière fois, ${relativeTime(h.at)}.`
                  }
                  accessibilityHint="Relance cette recherche"
                  style={({ pressed }) => [styles.cardInner, pressed && styles.pressed]}
                >
                  <View style={styles.cardMain}>
                    <Text style={styles.query} numberOfLines={2}>{h.query}</Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.meta}>
                        {h.resultCount > 0
                          ? `${h.resultCount} offre${h.resultCount > 1 ? 's' : ''} la dernière fois`
                          : 'aucune offre la dernière fois'}
                      </Text>
                      <Text style={styles.metaTime}>{relativeTime(h.at)}</Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => onRemove(h.query)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retirer « ${h.query} » de l'historique`}
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </Pressable>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.space(2.5),
    paddingTop: theme.space(1.5),
    paddingBottom: theme.space(4),
  },
  clearBtn: {
    paddingHorizontal: theme.space(1),
    paddingVertical: theme.space(0.25),
  },
  clearText: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.accent },
  pressed: { opacity: theme.opacity.pressed },

  list: { marginTop: theme.space(3), gap: theme.space(1.5) },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    overflow: 'hidden',
    ...theme.shadow.subtle,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.space(2),
  },
  cardMain: { flex: 1, minWidth: 0 },
  query: {
    flex: 1,
    fontSize: theme.font.body,
    lineHeight: theme.leading.body,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1.5), marginTop: theme.space(1) },
  meta: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    flexShrink: 1,
  },
  metaTime: {
    color: theme.color.textFaint,
    fontSize: theme.font.micro,
    flexShrink: 0,
  },
  removeBtn: {
    width: theme.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space(0.5),
  },
  removeText: {
    color: theme.color.textFaint,
    fontSize: theme.font.body,
    fontWeight: theme.weight.semibold,
  },

  actionButton: {
    marginTop: theme.space(3),
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1),
    backgroundColor: theme.color.accent,
    borderRadius: theme.radii.md,
    alignSelf: 'center',
    ...theme.shadow.subtle,
  },
  actionButtonText: {
    color: theme.color.accentText,
    fontSize: theme.font.body,
    fontWeight: '700',
  },
});