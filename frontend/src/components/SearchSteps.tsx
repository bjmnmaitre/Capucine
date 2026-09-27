import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { SEARCH_STEPS } from '../agent';

/**
 * What Capucine is doing while a search runs. The API reports no
 * intermediate progress, so no step is ever ticked "done": the whole list
 * pulses gently as "en cours". Static when the OS asks to reduce motion.
 */
export function SearchSteps() {
  const pulse = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (alive) setReduceMotion(v); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: theme.motion.slow * 2, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: theme.motion.slow * 2, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pulse]);

  return (
    <View style={styles.box} accessibilityLiveRegion="polite" accessibilityLabel={`Recherche en cours : ${SEARCH_STEPS.join(', ')}.`}>
      <Text style={styles.title}>Recherche en cours</Text>
      {SEARCH_STEPS.map((step) => (
        <View key={step} style={styles.row}>
          <Animated.View style={[styles.dot, { opacity: pulse }]} />
          <Text style={styles.step}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: theme.space(2), padding: theme.space(2), borderRadius: theme.radii.md,
    backgroundColor: theme.color.brandSurface, gap: theme.space(1),
  },
  title: { fontSize: theme.font.label, fontWeight: theme.weight.semibold, color: theme.color.goldLight, letterSpacing: 1.2, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space(1) },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.gold, transform: [{ rotate: '45deg' }] },
  step: { fontSize: theme.font.small, lineHeight: theme.leading.small, color: theme.color.accentText },
});
