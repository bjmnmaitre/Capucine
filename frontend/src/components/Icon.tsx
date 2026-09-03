import React from 'react';
import { View, StyleSheet } from 'react-native';

/**
 * A tiny geometric icon set drawn with plain Views — no vector-icon
 * dependency. Each glyph is composed inside a 24×24 box and takes a single
 * `color`. Deliberately minimal: line-weight shapes that stay legible at
 * tab-bar size and read as one family.
 */
export type IconName = 'home' | 'search' | 'compare' | 'activity' | 'profile';

export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const s = size / 24; // scale factor from the 24-unit design grid
  const px = (n: number) => Math.round(n * s);
  const stroke = Math.max(1.75, px(2));
  const line = { backgroundColor: color, borderRadius: stroke } as const;
  const border = { borderColor: color, borderWidth: stroke } as const;

  const box = { width: size, height: size, alignItems: 'center', justifyContent: 'center' } as const;

  switch (name) {
    case 'home':
      return (
        <View style={box}>
          {/* roof */}
          <View
            style={[
              {
                width: px(14), height: px(14), marginBottom: -px(7),
                transform: [{ rotate: '45deg' }], borderTopLeftRadius: px(4),
              },
              { borderTopColor: color, borderLeftColor: color, borderTopWidth: stroke, borderLeftWidth: stroke },
            ]}
          />
          {/* body */}
          <View style={[{ width: px(13), height: px(10), borderBottomLeftRadius: px(3), borderBottomRightRadius: px(3) }, border, { borderTopWidth: 0 }]} />
        </View>
      );
    case 'search':
      return (
        <View style={box}>
          <View style={[{ width: px(14), height: px(14), borderRadius: px(7) }, border]} />
          <View style={[line, { position: 'absolute', width: px(6), height: stroke, right: px(3), bottom: px(3), transform: [{ rotate: '45deg' }] }]} />
        </View>
      );
    case 'compare':
      return (
        <View style={[box, { flexDirection: 'row', alignItems: 'flex-end' }]}>
          <View style={[line, { width: px(5), height: px(11), marginRight: px(3) }]} />
          <View style={[line, { width: px(5), height: px(17) }]} />
        </View>
      );
    case 'activity':
      return (
        <View style={[box, { alignItems: 'flex-start', justifyContent: 'center', paddingLeft: px(3) }]}>
          <View style={[line, { width: px(16), height: stroke, marginBottom: px(3) }]} />
          <View style={[line, { width: px(11), height: stroke, marginBottom: px(3) }]} />
          <View style={[line, { width: px(14), height: stroke }]} />
        </View>
      );
    case 'profile':
      return (
        <View style={box}>
          <View style={[{ width: px(9), height: px(9), borderRadius: px(4.5) }, border, { marginBottom: px(2) }]} />
          <View style={[{ width: px(16), height: px(9), borderTopLeftRadius: px(8), borderTopRightRadius: px(8) }, border, { borderBottomWidth: 0 }]} />
        </View>
      );
  }
}

// (StyleSheet kept for parity / future shared glyph styles.)
StyleSheet.create({});
