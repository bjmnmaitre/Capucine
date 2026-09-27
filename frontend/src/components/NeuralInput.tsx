import React, { forwardRef, memo } from 'react';
import { View, Text, TextInput, StyleSheet, Animated } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolateColor } from 'react-native-reanimated';
import { theme, inputStyle, textStyle, Theme } from '../theme.futuristic';

export interface NeuralInputProps extends Omit<React.ComponentProps<typeof TextInput>, 'style' | 'onFocus' | 'onBlur' | 'onChangeText'> {
  label?: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  secureTextEntry?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: ViewStyle;
  inputStyle?: ViewStyle;
  labelStyle?: ViewStyle;
  autoFocus?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
}

const NeuralInput = forwardRef<TextInput, NeuralInputProps>(
  (
    {
      label,
      placeholder,
      value,
      onChangeText,
      error,
      helperText,
      disabled = false,
      secureTextEntry = false,
      iconLeft,
      iconRight,
      style,
      inputStyle: customInputStyle,
      labelStyle,
      autoFocus = false,
      multiline = false,
      numberOfLines,
      ...props
    },
    ref
  ) => {
    const t = theme;
    const styles = textStyle(t);

    const focusAnim = useSharedValue(0);
    const errorAnim = useSharedValue(0);
    const labelAnim = useSharedValue(0);

    const hasValue = value && value.length > 0;
    const isFocused = focusAnim.value > 0.5;

    const containerStyle = useAnimatedStyle(() => ({
      borderColor: interpolateColor(
        focusAnim.value,
        [0, 1],
        [error ? t.color.danger : t.color.glassBorder, t.color.neural]
      ),
      borderWidth: interpolateColor(focusAnim.value, [0, 1], [1, 2]),
      backgroundColor: interpolateColor(
        focusAnim.value,
        [0, 1],
        [disabled ? t.color.backgroundAlt : t.color.glass, t.color.glassStrong]
      ),
      shadowColor: t.color.neural,
      shadowOpacity: focusAnim.value * 0.15,
      shadowRadius: focusAnim.value * 16,
      elevation: focusAnim.value * 4,
    }));

    const labelAnimatedStyle = useAnimatedStyle(() => ({
      opacity: interpolateColor(focusAnim.value + (hasValue ? 1 : 0), [0, 0.5, 1], [1, 0.7, 0]),
      transform: [{
        translateY: interpolateColor(focusAnim.value + (hasValue ? 1 : 0), [0, 0.5, 1], [0, -8, -20])
      }],
      color: interpolateColor(
        focusAnim.value,
        [0, 1],
        [error ? t.color.danger : t.color.textMuted, t.color.neural]
      ),
      fontSize: interpolateColor(focusAnim.value + (hasValue ? 1 : 0), [0, 0.5, 1], [t.font.body, t.font.small, t.font.label]),
    }));

    const errorStyle = useAnimatedStyle(() => ({
      opacity: errorAnim.value,
      height: errorAnim.value * 20,
    }));

    return (
      <View style={[styles.container, style]}>
        <Animated.View style={[inputStyle(t, !!error, isFocused, disabled), containerStyle, customInputStyle]}>
          {iconLeft && (
            <View style={{ position: 'absolute', left: t.space(3), top: '50%', marginTop: -12, zIndex: 1 }}>
              {iconLeft}
            </View>
          )}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.space(3) }}>
            {label && (
              <Animated.Text style={[
                styles.body,
                labelAnimatedStyle,
                labelStyle,
                { position: 'absolute', left: iconLeft ? t.space(6) : t.space(3), pointerEvents: 'none' },
              ]}>
                {label}
              </Animated.Text>
            )}
            <TextInput
              ref={ref}
              value={value}
              onChangeText={onChangeText}
              placeholder={!label ? placeholder : undefined}
              placeholderTextColor={t.color.textFaint}
              secureTextEntry={secureTextEntry}
              disabled={disabled}
              autoFocus={autoFocus}
              multiline={multiline}
              numberOfLines={numberOfLines}
              style={[
                styles.body,
                { flex: 1, color: t.color.text, paddingVertical: t.space(2) },
                { paddingLeft: label || iconLeft ? 0 : undefined },
              ]}
              onFocus={() => {
                focusAnim.value = withSpring(1, t.motion.spring.snappy);
                labelAnim.value = withSpring(1, t.motion.spring.snappy);
              }}
              onBlur={() => {
                focusAnim.value = withSpring(0, t.motion.spring.standard);
                labelAnim.value = withSpring(0, t.motion.spring.standard);
              }}
              selectionColor={t.color.neural}
              cursorColor={t.color.neural}
              {...props}
            />
            {iconRight && (
              <View style={{ marginLeft: t.space(2) }}>
                {iconRight}
              </View>
            )}
            {!secureTextEntry && value && value.length > 0 && (
              <Animated.Text
                onPress={() => onChangeText?.('')}
                style={[
                  { color: t.color.textFaint, paddingRight: t.space(2) },
                  { opacity: focusAnim.value },
                ]}
              >
                ✕
              </Animated.Text>
            )}
          </View>
        </Animated.View>

        {(error || helperText) && (
          <Animated.View style={[errorStyle, { overflow: 'hidden', marginTop: t.space(1) }]}>
            <Text style={[
              styles.small,
              { color: error ? t.color.danger : t.color.textFaint },
              { marginLeft: t.space(1) },
            ]}>
              {error || helperText}
            </Text>
          </Animated.View>
        )}
      </View>
    );
  }
);

NeuralInput.displayName = 'NeuralInput';

// Search Input Variant
export interface NeuralSearchInputProps extends Omit<NeuralInputProps, 'iconLeft'> {
  onSearch?: (query: string) => void;
  onVoiceSearch?: () => void;
  loading?: boolean;
  suggestions?: string[];
  onSuggestionPress?: (suggestion: string) => void;
}

const NeuralSearchInput = memo((
  {
    label = 'Rechercher',
    placeholder = 'Que cherchez-vous ?',
    onSearch,
    onVoiceSearch,
    loading = false,
    suggestions,
    onSuggestionPress,
    ...props
  }: NeuralSearchInputProps
) => {
  const t = theme;
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  const handleFocus = () => {
    setFocused(true);
    setShowSuggestions(true);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setFocused(false);
      setShowSuggestions(false);
    }, 200);
  };

  const handleChange = (text: string) => {
    props.onChangeText?.(text);
    if (text.length > 0) {
      setShowSuggestions(true);
    }
  };

  const handleSubmit = () => {
    if (props.value && onSearch) {
      onSearch(props.value);
      setShowSuggestions(false);
    }
  };

  return (
    <View style={{ position: 'relative' }}>
      <NeuralInput
        {...props}
        label={label}
        placeholder={placeholder}
        onChangeText={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmit}
        iconLeft={<Text style={{ fontSize: 20 }}>🔍</Text>}
        iconRight={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(1) }}>
            {loading && <Text style={{ fontSize: 16 }}>⟳</Text>}
            {onVoiceSearch && (
              <Text onPress={onVoiceSearch} style={{ fontSize: 20, paddingLeft: t.space(2) }}>🎤</Text>
            )}
          </View>
        }
        style={props.style}
      />
      {showSuggestions && suggestions && suggestions.length > 0 && (
        <Animated.View style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: t.space(1),
          zIndex: 100,
        }}>
          <GlassCard variant="elevated" style={{ maxHeight: 200 }}>
            {suggestions.map((suggestion, index) => (
              <Text
                key={index}
                onPress={() => {
                  onSuggestionPress?.(suggestion);
                  setShowSuggestions(false);
                }}
                style={[
                  styles.body,
                  { color: t.color.text, paddingVertical: t.space(2), paddingHorizontal: t.space(3) },
                  { borderBottomWidth: index < suggestions.length - 1 ? 0.5 : 0, borderBottomColor: t.color.glassBorder },
                ]}
              >
                {suggestion}
              </Text>
            ))}
          </GlassCard>
        </Animated.View>
      )}
    </View>
  );
});

NeuralSearchInput.displayName = 'NeuralSearchInput';

export { NeuralInput, NeuralSearchInput };