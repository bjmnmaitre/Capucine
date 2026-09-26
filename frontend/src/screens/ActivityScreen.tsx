import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ActivityEvent, clearActivity, describeEvent, loadActivity,
} from '../activity';
import { relativeTime } from '../history';
import { Screen, ScreenTitle, EmptyState } from '../components/Screen';
import { theme, cardStyle, textStyle } from '../theme';

const DOT_COLOR: Record<ActivityEvent['type'], string> = {
  search: theme.color.accent,
  refine: theme.color.accent,
  exclude: theme.color.unknown,
  prepare: theme.color.known,
};

const TYPE_LABEL: Record<ActivityEvent['type'], string> = {
  search: 'Recherche',
  refine: 'Affinage',
  exclude: 'Marchand exclu',
  prepare: 'Préparation d\'achat',
};

/**
 * The Activité tab — what Capucine has actually done, in order, most recent first.
 * Every line is something the app directly observed (see activity.ts);
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
                style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
              >
                <Text style={styles.clearText}>Effacer</Text>
              </Pressable>
            ) : undefined
          }
        />

        {loaded && events.length === 0 ? (
          <EmptyState
            title="Rien à afficher pour l'instant"
            body="Ce que Capucine fait pour vous — recherches, affinages, marchands exclus, préparations d'achat — s'inscrit ici au fil de l'utilisation."
          />
        ) : (
          <View style={styles.feed}>
            {events.map((e, i) => {
              const { title, detail } = describeEvent(e);
              const typeLabel = TYPE_LABEL[e.type];
              return (
                <View
                  key={e.id}
                  style={styles.row}
                  accessible
                  accessibilityLabel={`${typeLabel}. ${title}. ${detail}. ${relativeTime(e.at)}.`}
                >
                  {/* Timeline gutter */}
                  <View style={styles.gutter}>
                    <View style={[styles.dot, { backgroundColor: DOT_COLOR[e.type] }]} />
                    {i < events.length - 1 ? <View style={styles.thread} /> : null}
                  </View>

                  {/* Content */}
                  <View style={styles.rowBody}>
                    <View style={styles.rowHeader}>
                      <View style={styles.rowTypeWrap}>
                        <Text style={styles.rowType}>{typeLabel}</Text>
                      </View>
                      <Text style={styles.rowTime}>{relativeTime(e.at)}</Text>
                    </View>
                    <Text style={styles.rowTitle}>{title}</Text>
                    <Text style={styles.rowDetail}>{detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {events.length > 0 ? (
          <View style={styles.footer} accessible accessibilityLiveRegion="polite">
            <Text style={styles.footerText}>
              Capucine ne prend jamais le paiement. Une préparation d'achat prépare la page
              du marchand — elle ne passe pas commande.
            </Text>
          </View>
        ) : null}
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

  feed: { marginTop: theme.space(2) },
  row: { flexDirection: 'row', gap: theme.space(2), marginBottom: theme.space(3) },
  gutter: { width: 14, alignItems: 'center', flexShrink: 0 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  thread: { flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: theme.color.borderStrong, marginTop: 2 },
  rowBody: { flex: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space(0.5) },
  rowTypeWrap: { backgroundColor: theme.color.surfaceAlt, paddingHorizontal: theme.space(1), paddingVertical: 2, borderRadius: theme.radii.pill },
  rowType: { fontSize: theme.font.micro, fontWeight: '700', color: theme.color.accent, letterSpacing: 0.3, textTransform: 'uppercase' },
  rowTime: { fontSize: theme.font.micro, color: theme.color.textFaint },
  rowTitle: { fontSize: theme.font.body, fontWeight: theme.weight.semibold, color: theme.color.text, lineHeight: 22 },
  rowDetail: {
    fontSize: theme.font.small,
    lineHeight: theme.leading.small,
    color: theme.color.textMuted,
    marginTop: 2,
  },

  footer: {
    marginTop: theme.space(3),
    padding: theme.space(2),
    borderRadius: theme.radii.md,
    backgroundColor: theme.color.accentSoft,
    borderWidth: 1,
    borderColor: theme.color.accent,
  },
  footerText: {
    fontSize: theme.font.micro,
    lineHeight: 17,
    color: theme.color.accentInk,
    textAlign: 'center',
  },
});