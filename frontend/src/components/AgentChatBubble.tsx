import React, { memo } from 'react';
import { View, Text, StyleSheet, Image, Animated } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withDelay, withTiming, interpolateColor } from 'react-native-reanimated';
import { theme, textStyle, certaintyBadgeStyle, AgentChatBubbleProps } from '../theme.futuristic';

export interface AgentChatBubbleProps {
  message: string;
  sender: 'agent' | 'user' | 'system';
  timestamp?: Date;
  typing?: boolean;
  certainty?: 'known' | 'unknown' | 'danger';
  avatar?: string;
  showAvatar?: boolean;
  animated?: boolean;
  onLongPress?: () => void;
}

const AgentChatBubble = memo(({
  message,
  sender,
  timestamp,
  typing = false,
  certainty,
  avatar,
  showAvatar = true,
  animated = true,
  onLongPress,
}: AgentChatBubbleProps) => {
  const t = theme;
  const styles = textStyle(t);
  const isAgent = sender === 'agent';
  const isUser = sender === 'user';

  // Animation values
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const scale = useSharedValue(0.9);
  const typingDots = useSharedValue(0);

  // Entry animation
  React.useEffect(() => {
    if (animated) {
      opacity.value = withDelay(100, withSpring(1, t.motion.spring.gentle));
      translateY.value = withDelay(100, withSpring(0, t.motion.spring.gentle));
      scale.value = withDelay(100, withSpring(1, t.motion.spring.gentle));
    } else {
      opacity.value = 1;
      translateY.value = 0;
      scale.value = 1;
    }
  }, [animated]);

  // Typing animation
  React.useEffect(() => {
    if (typing) {
      typingDots.value = withTiming(1, { duration: 600, easing: (t) => t }, () => {
        typingDots.value = 0;
      });
    }
  }, [typing]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const bubbleStyle = StyleSheet.flatten([
    {
      maxWidth: '85%',
      paddingHorizontal: t.space(4),
      paddingVertical: t.space(3),
      borderRadius: t.radii.xl,
      borderBottomLeftRadius: isAgent ? t.radii.sm : t.radii.xl,
      borderBottomRightRadius: isUser ? t.radii.sm : t.radii.xl,
      backgroundColor: isUser ? t.color.neural : t.color.glassStrong,
      borderWidth: 1,
      borderColor: isUser ? 'transparent' : t.color.glassBorder,
      ...(isAgent ? t.shadow.glass : t.shadow.neuralGlow),
      alignSelf: isUser ? 'flex-end' : 'flex-start',
    },
    certainty && {
      borderColor: certainty === 'known' ? t.color.known :
                   certainty === 'unknown' ? t.color.unknown : t.color.danger,
      borderWidth: 1.5,
    },
  ]);

  const textColor = isUser ? t.color.textInverse : t.color.text;
  const mutedColor = isUser ? 'rgba(255,255,255,0.7)' : t.color.textMuted;

  const timeString = timestamp
    ? timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <View style={{ flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: t.space(2), marginVertical: t.space(1) }}>
      {showAvatar && isAgent && (
        <Animated.View style={[
          { width: 32, height: 32, borderRadius: 16, marginBottom: 2 },
          t.shadow.neuralGlow,
        ]}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          ) : (
            <View style={{
              ...StyleSheet.absoluteFillObject,
              borderRadius: 16,
              backgroundColor: t.color.neuralSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 16 }}>🤖</Text>
            </View>
          )}
        </Animated.View>
      )}
      {showAvatar && isUser && (
        <View style={{ width: 32, height: 32, borderRadius: 16, marginBottom: 2, backgroundColor: t.color.pulseSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>👤</Text>
        </View>
      )}
      <Animated.View style={[animatedStyle, bubbleStyle]} onLongPress={onLongPress}>
        {typing ? (
          <TypingIndicator color={mutedColor} />
        ) : (
          <Text style={[styles.body, { color: textColor, lineHeight: t.leading.body }]}>
            {message}
          </Text>
        )}
        {(certainty || timeString) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2), marginTop: t.space(2) }}>
            {certainty && (
              <View style={certaintyBadgeStyle(t, certainty)}>
                <Text style={[styles.micro, {
                  color: certainty === 'known' ? t.color.known :
                         certainty === 'unknown' ? t.color.unknown : t.color.danger,
                }]}>
                  {certainty === 'known' ? '✓ Vérifié' : certainty === 'unknown' ? '? Inconnu' : '⚠ Attention'}
                </Text>
              </View>
            )}
            {timeString && (
              <Text style={[styles.micro, { color: mutedColor }]}>{timeString}</Text>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
});

AgentChatBubble.displayName = 'AgentChatBubble';

// Typing Indicator Component
const TypingIndicator = ({ color = '#9A9AB0' }: { color?: string }) => {
  const t = theme;
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  React.useEffect(() => {
    const animate = () => {
      dot1.value = withTiming(1, { duration: 400 }, () => {
        dot1.value = withTiming(0, { duration: 400 });
      });
      dot2.value = withDelay(150, withTiming(1, { duration: 400 }, () => {
        dot2.value = withTiming(0, { duration: 400 });
      }));
      dot3.value = withDelay(300, withTiming(1, { duration: 400 }, () => {
        dot3.value = withTiming(0, { duration: 400 }, () => {
          animate();
        });
      }));
    };
    animate();
  }, []);

  const dotStyle = (anim: Animated.SharedValue<number>) => useAnimatedStyle(() => ({
    opacity: interpolateColor(anim.value, [0, 0.5, 1], [0.3, 1, 0.3]),
    transform: [{ translateY: interpolateColor(anim.value, [0, 0.5, 1], [0, -6, 0]) }],
  }));

  return (
    <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: t.space(1) }}>
      <Animated.View style={[dotStyle(dot1), { width: 6, height: 6, borderRadius: 3, backgroundColor: color }]} />
      <Animated.View style={[dotStyle(dot2), { width: 6, height: 6, borderRadius: 3, backgroundColor: color }]} />
      <Animated.View style={[dotStyle(dot3), { width: 6, height: 6, borderRadius: 3, backgroundColor: color }]} />
    </View>
  );
};

export { AgentChatBubble };