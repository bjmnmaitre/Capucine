import React, { memo } from 'react';
import { View, Text, Image, StyleSheet, Pressable, Animated } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, interpolateColor } from 'react-native-reanimated';
import { theme, glassStyle, neuralGlassStyle, textStyle, priceLabel, formatScore, displayText, CERTAINTY_LABEL, NeuralProgressRing, Theme, certaintyBadgeStyle } from '../theme.futuristic';
import { HolographicButton } from './HolographicButton';

export interface ProductCardProps {
  offer: {
    id: string;
    productId: string;
    title: string;
    merchant: { name: string; country: string };
    price: number | null;
    currency: string | null;
    originalPrice?: number | null;
    discount?: number | null;
    availability: string | null;
    imageUrl?: string;
    matchQuality?: string;
    score?: number | null;
    specs?: Record<string, string>;
    executionUrl?: string;
    characteristics?: Record<string, any>;
  };
  onPress?: () => void;
  onFavorite?: () => void;
  favorite?: boolean;
  compact?: boolean;
  animated?: boolean;
  index?: number;
}

const ProductCard = memo(({
  offer,
  onPress,
  onFavorite,
  favorite = false,
  compact = false,
  animated = true,
  index = 0,
}: ProductCardProps) => {
  const t = theme;
  const styles = textStyle(t);

  const pressScale = useSharedValue(1);
  const favoriteScale = useSharedValue(1);
  const glowIntensity = useSharedValue(0);
  const imageOpacity = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  // Staggered entry animation
  React.useEffect(() => {
    if (animated) {
      const delay = index * t.motion.stagger.normal;
      imageOpacity.value = withDelay(delay + 100, withSpring(1, t.motion.spring.gentle));
      contentOpacity.value = withDelay(delay + 200, withSpring(1, t.motion.spring.gentle));
      translateY.value = withDelay(delay + 100, withSpring(0, t.motion.spring.gentle));
    } else {
      imageOpacity.value = 1;
      contentOpacity.value = 1;
      translateY.value = 0;
    }
  }, [animated, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: pressScale.value },
      { translateY: translateY.value },
    ],
    opacity: contentOpacity.value,
  }));

  const imageStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
    transform: [{ scale: interpolateColor(imageOpacity.value, [0, 1], [1.1, 1]) }],
  }));

  const favoriteStyle = useAnimatedStyle(() => ({
    transform: [{ scale: favoriteScale.value }],
    backgroundColor: favorite ? t.color.pulse : t.color.glassStrong,
  }));

  const priceData = priceLabel(offer.price, offer.currency);
  const hasDiscount = offer.originalPrice && offer.price && offer.originalPrice > offer.price;
  const discountPercent = hasDiscount && offer.originalPrice
    ? Math.round((1 - offer.price! / offer.originalPrice!) * 100)
    : 0;

  const handlePressIn = () => {
    pressScale.value = withSpring(0.98, t.motion.spring.snappy);
    glowIntensity.value = withTiming(1, { duration: 100 });
  };

  const handlePressOut = () => {
    pressScale.value = withSpring(1, t.motion.spring.standard);
    glowIntensity.value = withTiming(0, { duration: 200 });
  };

  const handleFavoritePress = (e: any) => {
    e.stopPropagation();
    favoriteScale.value = withSpring(0.8, t.motion.spring.snappy, () => {
      favoriteScale.value = withSpring(1.2, t.motion.spring.bouncy, () => {
        favoriteScale.value = withSpring(1, t.motion.spring.standard);
      });
    });
    onFavorite?.();
  };

  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: t.color.neural,
    shadowOpacity: glowIntensity.value * 0.4,
    shadowRadius: glowIntensity.value * 24,
    elevation: glowIntensity.value * 8,
  }));

  const cardBaseStyle = StyleSheet.flatten([
    neuralGlassStyle(t),
    glowStyle,
    animatedStyle,
    { overflow: 'hidden', flexDirection: compact ? 'row' : 'column' },
  ]);

  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={cardBaseStyle}
        android_ripple={{ color: t.color.neural, borderless: true }}
      >
        {/* Image */}
        {offer.imageUrl && (
          <Animated.Image
            source={{ uri: offer.imageUrl }}
            style={[
              imageStyle,
              { width: 80, height: 80, borderRadius: t.radii.md, resizeMode: 'cover' },
            ]}
            resizeMode="cover"
          />
        )}

        {/* Content */}
        <View style={{ flex: 1, padding: t.space(3), justifyContent: 'center', gap: t.space(1) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={[styles.bodyStrong, { color: t.color.text, flex: 1 }]}>
              {displayText(offer.title, 'Produit sans nom')}
            </Text>
            <Animated.Pressable
              onPress={handleFavoritePress}
              style={[
                { padding: t.space(1.5), borderRadius: t.radii.pill },
                favoriteStyle,
              ]}
            >
              <Text style={{ fontSize: 16 }}>{favorite ? '♥' : '♡'}</Text>
            </Animated.Pressable>
          </View>

          <Text style={[styles.small, { color: t.color.textMuted }]}>
            {displayText(offer.merchant?.name, 'Marchand inconnu')}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space(2) }}>
            <Text style={[
              styles.heading,
              { color: priceData.kind === 'exact' ? t.color.known : priceData.kind === 'approximate' ? t.color.unknown : t.color.text },
            ]}>
              {priceData.text}
            </Text>
            {hasDiscount && (
              <Text style={[styles.label, { color: t.color.pulse }]}>-{discountPercent}%</Text>
            )}
            {offer.score !== null && offer.score !== undefined && (
              <Text style={[styles.micro, { color: t.color.neural }]}>
                {formatScore(offer.score)}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  // Full card layout
  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={cardBaseStyle}
      android_ripple={{ color: t.color.neural, borderless: true }}
    >
      {/* Image Section */}
      <View style={{ position: 'relative', aspectRatio: 16 / 10, overflow: 'hidden' }}>
        {offer.imageUrl ? (
          <Animated.Image
            source={{ uri: offer.imageUrl }}
            style={[imageStyle, StyleSheet.absoluteFill, { borderTopLeftRadius: t.radii.lg, borderTopRightRadius: t.radii.lg }]}
            resizeMode="cover"
          />
        ) : (
          <View style={[
            StyleSheet.absoluteFill,
            { borderTopLeftRadius: t.radii.lg, borderTopRightRadius: t.radii.lg },
            { backgroundColor: t.color.backgroundAlt, alignItems: 'center', justifyContent: 'center' },
          ]}>
            <Text style={{ fontSize: 48 }}>📦</Text>
          </View>
        )}

        {/* Badges overlay */}
        <View style={{
          position: 'absolute',
          top: t.space(3),
          left: t.space(3),
          right: t.space(3),
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}>
          {offer.matchQuality && offer.matchQuality !== 'unknown' && (
            <View style={[
              { paddingHorizontal: t.space(2), paddingVertical: t.space(1), borderRadius: t.radii.pill },
              { backgroundColor: t.color.neuralSoft, borderWidth: 1, borderColor: t.color.neural },
            ]}>
              <Text style={[styles.micro, { color: t.color.neural, fontWeight: t.weight.bold }]}>
                {offer.matchQuality.replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          )}
          {hasDiscount && (
            <View style={[
              { paddingHorizontal: t.space(2), paddingVertical: t.space(1), borderRadius: t.radii.pill },
              { backgroundColor: t.color.pulseSoft, borderWidth: 1, borderColor: t.color.pulse },
            ]}>
              <Text style={[styles.label, { color: t.color.pulse }]}>-{discountPercent}%</Text>
            </View>
          )}
        </View>

        {/* Favorite button */}
        <Animated.Pressable
          onPress={handleFavoritePress}
          style={[
            { position: 'absolute', bottom: t.space(3), right: t.space(3), padding: t.space(2), borderRadius: t.radii.pill },
            favoriteStyle,
            { zIndex: 1 },
          ]}
        >
          <Text style={{ fontSize: 18 }}>{favorite ? '♥' : '♡'}</Text>
        </Animated.Pressable>
      </View>

      {/* Content Section */}
      <View style={{ padding: t.space(4), gap: t.space(3), flex: 1 }}>
        {/* Title & Merchant */}
        <View style={{ gap: t.space(1) }}>
          <Text style={[styles.heading, { color: t.color.text, lineHeight: t.leading.heading }]}>
            {displayText(offer.title, 'Produit sans nom')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2) }}>
            <Text style={[styles.small, { color: t.color.textMuted }]}>
              {displayText(offer.merchant?.name, 'Marchand inconnu')}
            </Text>
            {offer.merchant?.country && (
              <Text style={[styles.micro, { color: t.color.textFaint }]}>
                🇫🇷 {offer.merchant.country.toUpperCase()}
              </Text>
            )}
          </View>
        </View>

        {/* Price & Score */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space(3), flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space(2) }}>
            <Text style={[
              styles.display,
              { color: priceData.kind === 'exact' ? t.color.known : priceData.kind === 'approximate' ? t.color.unknown : t.color.text },
            ]}>
              {priceData.text}
            </Text>
            {hasDiscount && offer.originalPrice && (
              <Text style={[styles.body, { color: t.color.textFaint, textDecorationLine: 'line-through' }]}>
                {priceLabel(offer.originalPrice, offer.currency).text}
              </Text>
            )}
          </View>

          {offer.score !== null && offer.score !== undefined && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(1), paddingHorizontal: t.space(2), paddingVertical: t.space(1), borderRadius: t.radii.pill, backgroundColor: t.color.neuralSoft, borderWidth: 1, borderColor: t.color.neural }}>
              <Text style={[styles.label, { color: t.color.neural }]}>SCORE</Text>
              <Text style={[styles.bodyStrong, { color: t.color.neural }]}>{formatScore(offer.score)}</Text>
            </View>
          )}
        </View>

        {/* Availability & Certainty */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2), flexWrap: 'wrap' }}>
          {offer.availability && (
            <View style={[
              { flexDirection: 'row', alignItems: 'center', gap: t.space(1), paddingHorizontal: t.space(2), paddingVertical: t.space(1), borderRadius: t.radii.pill },
              { backgroundColor: t.color.knownSoft, borderWidth: 1, borderColor: t.color.known },
            ]}>
              <Text style={[styles.micro, { color: t.color.known }]}>✓</Text>
              <Text style={[styles.micro, { color: t.color.known }]}>{displayText(offer.availability, 'Disponible')}</Text>
            </View>
          )}

          {offer.characteristics?.certainty && (
            <View style={certaintyBadgeStyle(t, offer.characteristics.certainty as 'known' | 'unknown' | 'danger')}>
              <Text style={[styles.micro, {
                color: offer.characteristics.certainty === 'known' ? t.color.known :
                       offer.characteristics.certainty === 'unknown' ? t.color.unknown : t.color.danger,
                fontWeight: t.weight.semibold,
              }]}>
                {CERTAINTY_LABEL[offer.characteristics.certainty] || offer.characteristics.certainty}
              </Text>
            </View>
          )}
        </View>

        {/* Specs preview */}
        {offer.specs && Object.keys(offer.specs).length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space(1.5) }}>
            {Object.entries(offer.specs).slice(0, 3).map(([key, value]) => (
              <View key={key} style={[
                { paddingHorizontal: t.space(2), paddingVertical: t.space(1), borderRadius: t.radii.sm },
                { backgroundColor: t.color.glass, borderWidth: 1, borderColor: t.color.glassBorder },
              ]}>
                <Text style={[styles.micro, { color: t.color.textFaint }]}>{key}:</Text>
                <Text style={[styles.micro, { color: t.color.text, marginLeft: t.space(1) }]}>{value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Action bar */}
        <View style={{ flexDirection: 'row', gap: t.space(2), marginTop: t.space(1) }}>
          <HolographicButton
            variant="neural"
            size="md"
            fullWidth={true}
            onPress={onPress}
          >
            Voir les détails
          </HolographicButton>
        </View>
      </View>
    </Pressable>
  );
});

ProductCard.displayName = 'ProductCard';

// Need to import HolographicButton
import { HolographicButton } from './HolographicButton';

export { ProductCard };