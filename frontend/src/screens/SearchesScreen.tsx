import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  clearHistory, loadHistory, relativeTime, removeSearch, SearchHistoryEntry,
} from '../history';
import { Screen, ScreenTitle, EmptyState } from '../components/Screen';
import { Button } from '../components/Button';
import { theme } from '../theme';

/**
 * The Recherches tab — the user's own history, as cards they can act on.
 * Persisted on the device (see history.ts); reloaded every time the tab is
 * shown so a search just made from the journey appears here.
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
              >
                <Text style={styles.clear}>Tout effacer</Text>
              </Pressable>
            ) : undefined
          }
        />

        {loaded && items.length === 0 ? (
          <EmptyState
            title="Aucune recherche pour l’instant"
            body="Vos recherches apparaîtront ici. Vous pourrez les relancer d’un geste."
            action={<Button label="Nouvelle recherche" onPress={onNewSearch} />}
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
                  style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                >
                  <Text style={styles.query} numberOfLines={2}>{h.query}</Text>
                  <Text style={styles.meta}>
                    {h.resultCount > 0
                      ? `${h.resultCount} offre${h.resultCount > 1 ? 's' : ''} la dernière fois`
                      : 'aucune offre la dernière fois'} · {relativeTime(h.at)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onRemove(h.query)}
                  accessibilityRole="button"
                  accessibilityLabel={`Retirer « ${h.query} » de l’historique`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                >
                  <Text style={styles.removeGlyph}>✕</Text>
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
    paddingTop: theme.space(2),
    paddingBottom: theme.space(4),
  },
  clear: { fontSize: theme.font.small, fontWeight: theme.weight.semibold, color: theme.color.accent },
  list: { marginTop: theme.space(3), gap: theme.space(1.5) },
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    ...theme.shadow.card,
  },
  cardMain: { flex: 1, padding: theme.space(2), justifyContent: 'center', minHeight: theme.minTouch + 12 },
  query: {
    fontSize: theme.font.body,
    lineHeight: theme.leading.body,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  meta: { fontSize: theme.font.small, color: theme.color.textMuted, marginTop: 4 },
  remove: {
    width: theme.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.color.border,
  },
  removeGlyph: { fontSize: theme.font.body, color: theme.color.textFaint, fontWeight: theme.weight.semibold },
  pressed: { opacity: 0.6 },
});
