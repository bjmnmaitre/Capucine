import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ActivityEvent, clearActivity, describeEvent, loadActivity,
} from '../activity';
import { relativeTime } from '../history';
import { Screen, ScreenTitle, EmptyState } from '../components/Screen';
import { theme } from '../theme';

const DOT_COLOR: Record<ActivityEvent['type'], string> = {
  search: theme.color.accent,
  refine: theme.color.accent,
  exclude: theme.color.unknown,
  prepare: theme.color.known,
};

/**
 * The Activité tab — what Capucine has actually done, in order, most recent
 * first. Every line is something the app directly observed (see activity.ts);
 * nothing is inferred. A "page marchand prête" is never rendered as a
 * completed purchase.
 */
export function ActivityScreen() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    let alive = true;
    void loadActivity().then((e) => { if (alive) { setEvents(e); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  useEffect(reload, [reload]);

  async function onClearAll() {
    await clearActivity();
    setEvents([]);
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <ScreenTitle
          eyebrow="Journal"
          title="Activité"
          trailing={
            events.length > 0 ? (
              <Pressable
                onPress={onClearAll}
                accessibilityRole="button"
                accessibilityLabel="Effacer le journal"
                hitSlop={8}
              >
                <Text style={styles.clear}>Effacer</Text>
              </Pressable>
            ) : undefined
          }
        />

        {loaded && events.length === 0 ? (
          <EmptyState
            title="Rien à afficher"
            body="Ce que Capucine fait pour vous — recherches, affinages, marchands exclus, préparations d’achat — s’inscrit ici."
          />
        ) : (
          <View style={styles.feed}>
            {events.map((e, i) => {
              const { title, detail } = describeEvent(e);
              return (
                <View
                  key={e.id}
                  style={styles.row}
                  accessible
                  accessibilityLabel={`${title}. ${detail}. ${relativeTime(e.at)}.`}
                >
                  <View style={styles.gutter}>
                    <View style={[styles.dot, { backgroundColor: DOT_COLOR[e.type] }]} />
                    {i < events.length - 1 ? <View style={styles.thread} /> : null}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{title}</Text>
                    <Text style={styles.rowDetail}>{detail}</Text>
                    <Text style={styles.rowTime}>{relativeTime(e.at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {events.length > 0 ? (
          <Text style={styles.foot}>
            Capucine ne prend jamais le paiement. Une préparation d’achat prépare la page
            du marchand — elle ne passe pas commande.
          </Text>
        ) : null}
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
  feed: { marginTop: theme.space(3) },
  row: { flexDirection: 'row', gap: theme.space(1.5) },
  gutter: { width: 12, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  thread: { flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: theme.color.borderStrong, marginTop: 4 },
  rowBody: { flex: 1, paddingBottom: theme.space(2.5) },
  rowTitle: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, color: theme.color.text },
  rowDetail: {
    fontSize: theme.font.small,
    lineHeight: theme.leading.small,
    color: theme.color.textMuted,
    marginTop: 2,
  },
  rowTime: { fontSize: theme.font.label, color: theme.color.textFaint, marginTop: 4 },
  foot: {
    marginTop: theme.space(2),
    fontSize: theme.font.label,
    lineHeight: 18,
    color: theme.color.textFaint,
  },
});
