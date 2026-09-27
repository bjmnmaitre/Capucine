import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolateColor, Easing } from 'react-native-reanimated';
import Svg, { Circle, G, Rect } from 'react-native-svg';
import { theme, neuralProgressStyle, pulseProgressStyle, textStyle, Theme } from '../theme.futuristic';

export interface NeuralProgressProps {
  progress: number; // 0-1
  variant?: 'neural' | 'pulse' | 'known' | 'unknown' | 'danger';
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  label?: string;
  animated?: boolean;
  animateOnMount?: boolean;
  style?: ViewStyle;
}

interface NeuralProgressRingProps extends NeuralProgressProps {
  children?: React.ReactNode;
}

const NeuralProgressRing = memo(({
  progress,
  variant = 'neural',
  size = 64,
  strokeWidth = 4,
  showLabel = true,
  label,
  animated = true,
  animateOnMount = true,
  children,
  style,
}: NeuralProgressRingProps) => {
  const t = theme;
  const styles = textStyle(t);

  const progressAnim = useSharedValue(0);
  const rotationAnim = useSharedValue(0);

  React.useEffect(() => {
    if (animated && animateOnMount) {
      progressAnim.value = withSpring(progress, t.motion.spring.standard);
      rotationAnim.value = withTiming(360, {
        duration: 2000,
        easing: Easing.linear,
      }, () => {
        rotationAnim.value = 0;
      });
    } else {
      progressAnim.value = progress;
    }
  }, [progress, animated, animateOnMount]);

  // Color based on variant
  const getStrokeColor = (v: typeof variant) => {
    switch (v) {
      case 'neural': return t.color.neural;
      case 'pulse': return t.color.pulse;
      case 'known': return t.color.known;
      case 'unknown': return t.color.unknown;
      case 'danger': return t.color.danger;
    }
  };

  const strokeColor = getStrokeColor(variant);
  const trailColor = t.color.glassBorder;

  const animatedCircleStyle = useAnimatedStyle(() => {
    const p = progressAnim.value;
    const strokeDashoffset = 2 * Math.PI * (size / 2 - strokeWidth / 2) * (1 - p);
    return {
      strokeDashoffset,
    };
  });

  const animatedRotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotationAnim.value}deg` }],
  }));

  const displayLabel = label ?? `${Math.round(progress * 100)}%`;

  return (
    <View style={[style, { width: size, height: size, alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={animatedRotation}>
        <Svg width={size} height={size}>
          {/* Trail */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={size / 2 - strokeWidth / 2}
            stroke={trailColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
          />
          {/* Progress */}
          <Animated.Circle
            cx={size / 2}
            cy={size / 2}
            r={size / 2 - strokeWidth / 2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * (size / 2 - strokeWidth / 2)}
            style={animatedCircleStyle}
          />
          {/* Center glow when complete */}
          {progressAnim.value >= 1 && (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={size / 2 - strokeWidth * 2}
              fill={strokeColor}
              opacity={0.15}
            />
          )}
        </Svg>
      </Animated.View>

      {showLabel && (
        <Animated.View style={{
          position: 'absolute',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {children || (
            <Text style={[
              styles.bodyStrong,
              { color: t.color.text },
              { fontSize: size * 0.18 },
            ]}>
              {displayLabel}
            </Text>
          )}
        </Animated.View>
      )}
    </View>
  );
});

NeuralProgressRing.displayName = 'NeuralProgressRing';

// Linear Progress Bar
export interface NeuralLinearProgressProps {
  progress: number;
  variant?: 'neural' | 'pulse' | 'known' | 'unknown' | 'danger';
  height?: number;
  borderRadius?: number;
  showLabel?: boolean;
  label?: string;
  animated?: boolean;
  animateOnMount?: boolean;
  striped?: boolean;
  style?: ViewStyle;
}

const NeuralLinearProgress = memo(({
  progress,
  variant = 'neural',
  height = 6,
  borderRadius = 999,
  showLabel = false,
  label,
  animated = true,
  animateOnMount = true,
  striped = false,
  style,
}: NeuralLinearProgressProps) => {
  const t = theme;
  const styles = textStyle(t);

  const progressAnim = useSharedValue(0);

  React.useEffect(() => {
    if (animated && animateOnMount) {
      progressAnim.value = withSpring(progress, t.motion.spring.standard);
    } else {
      progressAnim.value = progress;
    }
  }, [progress, animated, animateOnMount]);

  const getColor = (v: typeof variant) => {
    switch (v) {
      case 'neural': return t.color.neural;
      case 'pulse': return t.color.pulse;
      case 'known': return t.color.known;
      case 'unknown': return t.color.unknown;
      case 'danger': return t.color.danger;
    }
  };

  const color = getColor(variant);
  const trackColor = t.color.glassBorder;

  const animatedWidth = useAnimatedStyle(() => ({
    width: `${progressAnim.value * 100}%`,
  }));

  const stripeAnim = useSharedValue(0);
  React.useEffect(() => {
    if (striped) {
      stripeAnim.value = withTiming(1, { duration: 1000, easing: Easing.linear }, () => {
        stripeAnim.value = 0;
      });
    }
  }, [striped]);

  const stripeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${stripeAnim.value * -20}px` }],
  }));

  return (
    <View style={[style, { gap: t.space(2) }]}>
      <View style={{
        height,
        borderRadius,
        backgroundColor: trackColor,
        overflow: 'hidden',
        ...t.shadow.inset,
      }}>
        <Animated.View style={[
          {
            height: '100%',
            borderRadius,
            backgroundColor: color,
            ...t.shadow[variant === 'pulse' ? 'pulseGlow' : 'neuralGlow'],
          },
          animatedWidth,
        ]}>
          {striped && (
            <Animated.View style={[
              StyleSheet.absoluteFill,
              stripeStyle,
              {
                backgroundImage: `repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0, rgba(255,255,255,0.15) 10px, transparent 10px, transparent 20px)`,
              },
            ]} />
          )}
        </Animated.View>
      </View>

      {showLabel && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[styles.label, { color: t.color.textMuted }]}>
            {label ?? 'Progression'}
          </Text>
          <Text style={[styles.label, { color: color, fontWeight: t.weight.bold }]}>
            {Math.round(progress * 100)}%
          </Text>
        </View>
      )}
    </View>
  );
});

NeuralLinearProgress.displayName = 'NeuralLinearProgress';

// Multi-stage progress (for agent steps)
export interface NeuralStageProgressProps {
  stages: Array<{
    id: string;
    label: string;
    status: 'pending' | 'active' | 'complete' | 'error';
    detail?: string;
  }>;
  variant?: 'neural' | 'pulse';
  showDetails?: boolean;
  style?: ViewStyle;
}

const NeuralStageProgress = memo(({
  stages,
  variant = 'neural',
  showDetails = true,
  style,
}: NeuralStageProgressProps) => {
  const t = theme;
  const styles = textStyle(t);
  const color = variant === 'pulse' ? t.color.pulse : t.color.neural;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete': return t.color.known;
      case 'error': return t.color.danger;
      case 'active': return color;
      default: return t.color.textFaint;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete': return '✓';
      case 'error': return '✕';
      case 'active': return '⟳';
      default: return '○';
    }
  };

  return (
    <View style={[style, { gap: t.space(3) }]}>
      {stages.map((stage, index) => (
        <View key={stage.id} style={{ flexDirection: 'row', gap: t.space(3), alignItems: 'flex-start' }}>
          {/* Connecting line */}
          <View style={{
            position: 'absolute',
            left: 12,
            top: index === 0 ? 24 : 0,
            bottom: index === stages.length - 1 ? 0 : -t.space(3),
            width: 1.5,
            backgroundColor: index < stages.length - 1 ? t.color.glassBorder : 'transparent',
          }} />
          
          {/* Status indicator */}
          <Animated.View style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: getStatusColor(stage.status),
            backgroundColor: stage.status === 'active' || stage.status === 'complete' ? getStatusColor(stage.status) : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}>
            <Text style={{
              fontSize: 12,
              fontWeight: t.weight.bold,
              color: stage.status === 'pending' ? t.color.textFaint : t.color.textInverse,
            }}>
              {getStatusIcon(stage.status)}
            </Text>
          </Animated.View>

          {/* Content */}
          <View style={{ flex: 1, paddingTop: t.space(0.5), gap: t.space(1) }}>
            <Text style={[
              styles.body,
              { color: stage.status === 'pending' ? t.color.textMuted : t.color.text },
              { fontWeight: stage.status === 'active' ? t.weight.semibold : t.weight.regular },
            ]}>
              {stage.label}
            </Text>
            {showDetails && stage.detail && (
              <Text style={[styles.small, { color: t.color.textFaint }]}>
                {stage.detail}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
});

NeuralStageProgress.displayName = 'NeuralStageProgress';

export { NeuralProgressRing, NeuralLinearProgress, NeuralStageProgress };