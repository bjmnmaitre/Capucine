import React, { forwardRef } from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { theme, neuralButtonStyle, pulseButtonStyle, neuralGhostButtonStyle, pulseGhostButtonStyle, Theme } from '../theme.futuristic';

export type ButtonVariant = 'neural' | 'pulse' | 'neural-ghost' | 'pulse-ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface HolographicButtonProps extends Omit<Pressable, 'style' | 'children'> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const sizeConfig: Record<ButtonSize, { height: number; paddingX: number; fontSize: number; gap: number }> = {
  sm: { height: 40, paddingX: 16, fontSize: 13, gap: 6 },
  md: { height: 52, paddingX: 24, fontSize: 15, gap: 8 },
  lg: { height: 60, paddingX: 32, fontSize: 17, gap: 10 },
  xl: { height: 72, paddingX: 40, fontSize: 19, gap: 12 },
};

const variantStyles = (t: Theme, variant: ButtonVariant, disabled = false) => {
  switch (variant) {
    case 'neural':
      return neuralButtonStyle(t, disabled);
    case 'pulse':
      return pulseButtonStyle(t, disabled);
    case 'neural-ghost':
      return neuralGhostButtonStyle(t, disabled);
    case 'pulse-ghost':
      return pulseGhostButtonStyle(t, disabled);
  }
};

const HolographicButton = forwardRef<Animated.View, HolographicButtonProps>(
  (
    {
      children,
      variant = 'neural',
      size = 'md',
      fullWidth = false,
      loading = false,
      iconLeft,
      iconRight,
      style,
      textStyle,
      disabled,
      onPress,
      ...props
    },
    ref
  ) => {
    const t = theme;
    const config = sizeConfig[size];
    const isDisabled = disabled || loading;

    const pressScale = useSharedValue(1);
    const glowIntensity = useSharedValue(0);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: pressScale.value }],
      shadowColor: variant === 'pulse' || variant === 'pulse-ghost' ? t.color.pulse : t.color.neural,
      shadowOpacity: glowIntensity.value * 0.5,
      shadowRadius: glowIntensity.value * 20,
      elevation: glowIntensity.value * 8,
    }));

    const handlePressIn = () => {
      pressScale.value = withSpring(0.96, t.motion.spring.snappy);
      glowIntensity.value = withTiming(1, { duration: 100 });
    };

    const handlePressOut = () => {
      pressScale.value = withSpring(1, t.motion.spring.standard);
      glowIntensity.value = withTiming(0, { duration: 200 });
    };

    const baseButtonStyle = StyleSheet.flatten([
      variantStyles(t, variant, isDisabled),
      {
        height: config.height,
        paddingHorizontal: config.paddingX,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: config.gap,
        width: fullWidth ? '100%' : undefined,
      },
      style,
    ]);

    const labelStyle = StyleSheet.flatten([
      {
        fontSize: config.fontSize,
        fontWeight: t.weight.semibold,
        letterSpacing: 0.3,
        color: variant === 'neural-ghost' || variant === 'pulse-ghost'
          ? (isDisabled ? t.color.textFaint : (variant === 'neural-ghost' ? t.color.neural : t.color.pulse))
          : t.color.textInverse,
      },
      textStyle,
    ]);

    return (
      <Animated.View style={animatedStyle} collapsable={false}>
        <Pressable
          ref={ref}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isDisabled}
          accessibilityState={{ disabled: isDisabled }}
          style={baseButtonStyle}
          {...props}
        >
          {loading ? (
            <NeuralSpinner size={config.fontSize * 1.2} color={t.color.textInverse} />
          ) : (
            <>
              {iconLeft}
              <Text style={labelStyle}>{children}</Text>
              {iconRight}
            </>
          )}
        </Pressable>
      </Animated.View>
    );
  }
);

HolographicButton.displayName = 'HolographicButton';

// Neural Spinner Component
interface NeuralSpinnerProps {
  size?: number;
  color?: string;
  speed?: number;
}

const NeuralSpinner = React.memo(({ size = 24, color, speed = 1 }: NeuralSpinnerProps) => {
  const rotation = useSharedValue(0);
  const t = theme;

  React.useEffect(() => {
    rotation.value = withTiming(360, {
      duration: 1000 / speed,
      easing: (t) => t,
    }, () => {
      rotation.value = 0;
    });
  }, [speed]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={[animatedStyle, { width: size, height: size }]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2.5,
          borderColor: 'transparent',
          borderTopColor: color || t.color.neural,
          borderRightColor: color || t.color.neural,
        }}
      />
    </Animated.View>
  );
});

NeuralSpinner.displayName = 'NeuralSpinner';

export { HolographicButton, NeuralSpinner };