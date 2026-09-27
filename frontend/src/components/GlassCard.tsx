import React, { forwardRef } from 'react';
import { View, ViewStyle, StyleSheet, Pressable, PressableProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { theme, glassStyle, neuralGlassStyle, pulseGlassStyle, Theme } from '../theme.futuristic';

export interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'neural' | 'pulse' | 'elevated';
  padding?: number;
  onPress?: () => void;
  pressable?: boolean;
  blurIntensity?: number;
}

const GlassCard = forwardRef<View, GlassCardProps>(
  (
    {
      children,
      style,
      variant = 'default',
      padding = 4,
      onPress,
      pressable = false,
      blurIntensity = 40,
    },
    ref
  ) => {
    const t = theme;
    const baseStyle = StyleSheet.flatten([
      variant === 'neural' ? neuralGlassStyle(t) : variant === 'pulse' ? pulseGlassStyle(t) : glassStyle(t, variant === 'elevated'),
      { padding: t.space(padding) },
      style,
    ]);

    const content = (
      <BlurView
        intensity={blurIntensity}
        style={StyleSheet.absoluteFill}
        blurType="dark"
      >
        <View style={baseStyle}>{children}</View>
      </BlurView>
    );

    if (pressable && onPress) {
      return (
        <Pressable
          ref={ref}
          onPress={onPress}
          style={({ pressed }) => [
            baseStyle,
            { opacity: pressed ? t.opacity.pressed : 1 },
          ]}
          android_ripple={{ color: t.color.neural, borderless: true }}
        >
          {content}
        </Pressable>
      );
    }

    return <View ref={ref} style={baseStyle}>{children}</View>;
  }
);

GlassCard.displayName = 'GlassCard';

export { GlassCard };