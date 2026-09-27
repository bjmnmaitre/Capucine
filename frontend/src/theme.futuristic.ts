import { Platform } from 'react-native';

/**
 * CAPUCINE FUTURISTIC — Design System v2.
 *
 * A cybernetic, agent-native interface for an AI shopping companion.
 * Dark-first, glassmorphism, neural accents, living motion.
 *
 * Principles:
 * - Agent-first: UI feels like talking to an intelligence, not using a tool
 * - Glassmorphism: Depth through translucency, blur, and light refraction
 * - Neural accents: Cyan/magenta dual-tone for AI/Human distinction
 * - Living motion: Springs, stagger, micro-interactions that breathe
 * - Honest uncertainty: Unknown states have their own visual language
 * - Accessibility: WCAG AAA contrast, reduced motion, dynamic type
 */

// ──────────────────────────────────────────────────────────────────────────────
// PALETTE — Cybernetic Dual-Tone
// ──────────────────────────────────────────────────────────────────────────────

const palette = {
  // ─── Core Surfaces (Dark First) ───
  void: '#050508',              // Deep space background
  voidElevated: '#0D0D14',      // Elevated surfaces
  voidAlt: '#14141F',           // Inset/pressed surfaces
  glass: 'rgba(20, 20, 31, 0.72)',    // Glassmorphism base
  glassStrong: 'rgba(20, 20, 31, 0.88)', // Stronger glass
  glassBorder: 'rgba(255, 255, 255, 0.08)', // Hairline on glass
  glassBorderBright: 'rgba(255, 255, 255, 0.18)', // Focused/active

  // ─── Neural Accents — Cyan (AI) / Magenta (Human/Action) ───
  neural: '#00F0FF',            // Primary AI accent — electric cyan
  neuralDim: '#00C8D4',         // Dimmed neural
  neuralSoft: 'rgba(0, 240, 255, 0.12)', // Neural tint
  neuralGlow: 'rgba(0, 240, 255, 0.45)', // Neural glow

  pulse: '#FF2D95',             // Human/Action accent — hot magenta
  pulseDim: '#D61F7A',          // Dimmed pulse
  pulseSoft: 'rgba(255, 45, 149, 0.12)', // Pulse tint
  pulseGlow: 'rgba(255, 45, 149, 0.45)', // Pulse glow

  // ─── Semantic Certainty (Preserved from v1, adapted) ───
  known: '#00E676',             // Verified fact — matrix green
  knownSoft: 'rgba(0, 230, 118, 0.14)',
  knownGlow: 'rgba(0, 230, 118, 0.4)',

  unknown: '#FFB300',           // Unknown — amber warning
  unknownSoft: 'rgba(255, 179, 0, 0.14)',
  unknownGlow: 'rgba(255, 179, 0, 0.4)',

  danger: '#FF3D4F',            // Destructive — coral red
  dangerSoft: 'rgba(255, 61, 79, 0.14)',
  dangerGlow: 'rgba(255, 61, 79, 0.4)',

  // ─── Text Hierarchy ───
  text: '#F5F5FA',              // Primary — near white
  textMuted: '#9A9AB0',         // Secondary
  textFaint: '#6B6B7A',         // Captions, placeholders
  textInverse: '#0A0A0F',       // On accent surfaces

  // ─── Gradients ───
  gradientNeural: ['#00F0FF', '#0088FF'] as const,
  gradientPulse: ['#FF2D95', '#FF0066'] as const,
  gradientVoid: ['#0D0D14', '#050508'] as const,
  gradientGlass: ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.02)'] as const,
  gradientNeuralPulse: ['#00F0FF', '#FF2D95'] as const,

  // ─── Overlays ───
  overlay: 'rgba(5, 5, 8, 0.72)',
  overlayStrong: 'rgba(5, 5, 8, 0.92)',
};

// ──────────────────────────────────────────────────────────────────────────────
// SPACING & LAYOUT
// ──────────────────────────────────────────────────────────────────────────────

export const space = (n: number) => n * 4; // 4pt base grid (denser for futuristic)

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  xxl: 36,
  pill: 999,
  // Organic shapes
  blob: 24,
  neural: 16,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// TYPOGRAPHY — Inter Variable / Space Grotesk
// ──────────────────────────────────────────────────────────────────────────────

export const font = {
  // Display — Hero moments
  mega: 52,
  display: 38,
  title: 28,
  heading: 20,
  body: 16,
  small: 13.5,
  label: 12,
  micro: 10.5,
} as const;

export const weight = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

export const leading = {
  mega: 58,
  display: 44,
  title: 34,
  heading: 27,
  body: 24,
  small: 19,
  label: 16,
  micro: 14,
} as const;

// Monospace for technical data
export const fontMono = {
  body: 14,
  small: 12,
  micro: 10,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// MOTION — Spring Physics, Stagger, Breathing
// ──────────────────────────────────────────────────────────────────────────────

export const motion = {
  // Duration tokens
  instant: 0,
  micro: 80,
  fast: 150,
  normal: 250,
  slow: 400,
  slower: 600,
  ambient: 3000, // Breathing animations

  // Spring configs (for Reanimated)
  spring: {
    gentle: { damping: 22, stiffness: 120, mass: 1 },
    standard: { damping: 20, stiffness: 150, mass: 1 },
    snappy: { damping: 18, stiffness: 200, mass: 1 },
    bouncy: { damping: 15, stiffness: 180, mass: 1 },
    wobble: { damping: 12, stiffness: 160, mass: 1 },
  },

  // Easing curves (for non-spring)
  easing: {
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    emphasize: 'cubic-bezier(0.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    // Custom neural curve
    neural: 'cubic-bezier(0.23, 1, 0.32, 1)',
    pulse: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
  },

  // Stagger delays
  stagger: {
    tight: 30,
    normal: 60,
    loose: 100,
  },
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// SHADOWS & GLOWS — Layered Depth
// ──────────────────────────────────────────────────────────────────────────────

type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
} | {
  elevation: number;
};

const iosShadow = (color: string, opacity: number, radius: number, y: number): ShadowStyle => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: radius,
});

const androidElevation = (elevation: number): ShadowStyle => ({ elevation });

export const shadow = {
  // Glassmorphism shadows
  glass: Platform.select({
    ios: iosShadow('#00F0FF', 0.06, 24, 8),
    android: androidElevation(4),
    default: iosShadow('#00F0FF', 0.06, 24, 8),
  }) as ShadowStyle,

  glassStrong: Platform.select({
    ios: iosShadow('#00F0FF', 0.12, 40, 16),
    android: androidElevation(12),
    default: iosShadow('#00F0FF', 0.12, 40, 16),
  }) as ShadowStyle,

  // Neural glow shadows
  neuralGlow: Platform.select({
    ios: iosShadow('#00F0FF', 0.35, 32, 0),
    android: androidElevation(8),
    default: iosShadow('#00F0FF', 0.35, 32, 0),
  }) as ShadowStyle,

  pulseGlow: Platform.select({
    ios: iosShadow('#FF2D95', 0.35, 32, 0),
    android: androidElevation(8),
    default: iosShadow('#FF2D95', 0.35, 32, 0),
  }) as ShadowStyle,

  // Subtle depth
  subtle: Platform.select({
    ios: iosShadow('#000000', 0.18, 12, 4),
    android: androidElevation(2),
    default: iosShadow('#000000', 0.18, 12, 4),
  }) as ShadowStyle,

  // Inset/pressed
  inset: Platform.select({
    ios: iosShadow('#000000', 0.12, 4, 2),
    android: androidElevation(1),
    default: iosShadow('#000000', 0.12, 4, 2),
  }) as ShadowStyle,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// OPACITY & BLEND MODES
// ──────────────────────────────────────────────────────────────────────────────

export const opacity = {
  pressed: 0.82,
  disabled: 0.38,
  overlay: 0.6,
  glass: 0.72,
  glassStrong: 0.88,
  ghost: 0.15,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// BREAKPOINTS (for responsive web)
// ──────────────────────────────────────────────────────────────────────────────

export const breakpoints = {
  xs: 0,
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1440,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// THEME OBJECT — Complete Design Token Set
// ──────────────────────────────────────────────────────────────────────────────

export const theme = {
  color: {
    // Base surfaces
    background: palette.void,
    backgroundElevated: palette.voidElevated,
    backgroundAlt: palette.voidAlt,

    // Glassmorphism
    glass: palette.glass,
    glassStrong: palette.glassStrong,
    glassBorder: palette.glassBorder,
    glassBorderBright: palette.glassBorderBright,

    // Neural (AI) accent system
    neural: palette.neural,
    neuralDim: palette.neuralDim,
    neuralSoft: palette.neuralSoft,
    neuralGlow: palette.neuralGlow,

    // Pulse (Human/Action) accent system
    pulse: palette.pulse,
    pulseDim: palette.pulseDim,
    pulseSoft: palette.pulseSoft,
    pulseGlow: palette.pulseGlow,

    // Text hierarchy
    text: palette.text,
    textMuted: palette.textMuted,
    textFaint: palette.textFaint,
    textInverse: palette.textInverse,

    // Certainty semantics
    known: palette.known,
    knownSoft: palette.knownSoft,
    knownGlow: palette.knownGlow,
    unknown: palette.unknown,
    unknownSoft: palette.unknownSoft,
    unknownGlow: palette.unknownGlow,
    danger: palette.danger,
    dangerSoft: palette.dangerSoft,
    dangerGlow: palette.dangerGlow,

    // Overlays
    overlay: palette.overlay,
    overlayStrong: palette.overlayStrong,

    // Gradients (as strings for StyleSheet)
    gradientNeural: `linear-gradient(135deg, ${palette.gradientNeural[0]}, ${palette.gradientNeural[1]})`,
    gradientPulse: `linear-gradient(135deg, ${palette.gradientPulse[0]}, ${palette.gradientPulse[1]})`,
    gradientVoid: `linear-gradient(180deg, ${palette.gradientVoid[0]}, ${palette.gradientVoid[1]})`,
    gradientGlass: `linear-gradient(135deg, ${palette.gradientGlass[0]}, ${palette.gradientGlass[1]})`,
    gradientNeuralPulse: `linear-gradient(135deg, ${palette.gradientNeuralPulse[0]}, ${palette.gradientNeuralPulse[1]})`,
  },

  space,
  radii,
  font,
  fontMono,
  weight,
  leading,
  motion,
  shadow,
  opacity,
  breakpoints,
  minTouch: 48, // Slightly larger for futuristic feel
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ──────────────────────────────────────────────────────────────────────────────

export type Theme = typeof theme;
export type ColorToken = keyof typeof theme.color;
export type SpaceToken = number;
export type RadiusToken = keyof typeof radii;
export type FontToken = keyof typeof font;
export type WeightToken = keyof typeof weight;
export type MotionToken = keyof typeof motion;
export type ShadowToken = keyof typeof shadow;

// ──────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

/** Responsive value based on screen width */
export function responsive<T>(values: { xs: T; sm?: T; md?: T; lg?: T; xl?: T }, width: number): T {
  if (width >= breakpoints.xl) return values.xl ?? values.lg ?? values.md ?? values.sm ?? values.xs;
  if (width >= breakpoints.lg) return values.lg ?? values.md ?? values.sm ?? values.xs;
  if (width >= breakpoints.md) return values.md ?? values.sm ?? values.xs;
  if (width >= breakpoints.sm) return values.sm ?? values.xs;
  return values.xs;
}

/** Create a glassmorphism style object */
export const glassStyle = (t: Theme, elevated = false) => ({
  backgroundColor: elevated ? t.color.glassStrong : t.color.glass,
  borderWidth: 1,
  borderColor: t.color.glassBorder,
  borderRadius: t.radii.lg,
  ...t.shadow.glass,
  // Backdrop blur handled via native component
});

/** Create a neural-accented glass style */
export const neuralGlassStyle = (t: Theme) => ({
  ...glassStyle(t, true),
  borderColor: t.color.neuralGlow,
  ...t.shadow.neuralGlow,
});

/** Create a pulse-accented glass style */
export const pulseGlassStyle = (t: Theme) => ({
  ...glassStyle(t, true),
  borderColor: t.color.pulseGlow,
  ...t.shadow.pulseGlow,
});

/** Primary neural button */
export const neuralButtonStyle = (t: Theme, disabled = false) => ({
  minHeight: t.minTouch + 8,
  borderRadius: t.radii.pill,
  backgroundColor: disabled ? t.color.neuralDim : t.color.neural,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: t.space(6),
  opacity: disabled ? t.opacity.disabled : 1,
  ...t.shadow.neuralGlow,
});

/** Primary pulse button (destructive/actions) */
export const pulseButtonStyle = (t: Theme, disabled = false) => ({
  minHeight: t.minTouch + 8,
  borderRadius: t.radii.pill,
  backgroundColor: disabled ? t.color.pulseDim : t.color.pulse,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: t.space(6),
  opacity: disabled ? t.opacity.disabled : 1,
  ...t.shadow.pulseGlow,
});

/** Ghost/outline neural button */
export const neuralGhostButtonStyle = (t: Theme, disabled = false) => ({
  minHeight: t.minTouch + 4,
  borderRadius: t.radii.pill,
  borderWidth: 1.5,
  borderColor: disabled ? t.color.glassBorder : t.color.neural,
  backgroundColor: disabled ? 'transparent' : t.color.neuralSoft,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: t.space(5),
  opacity: disabled ? t.opacity.disabled : 1,
});

/** Ghost/outline pulse button */
export const pulseGhostButtonStyle = (t: Theme, disabled = false) => ({
  minHeight: t.minTouch + 4,
  borderRadius: t.radii.pill,
  borderWidth: 1.5,
  borderColor: disabled ? t.color.glassBorder : t.color.pulse,
  backgroundColor: disabled ? 'transparent' : t.color.pulseSoft,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: t.space(5),
  opacity: disabled ? t.opacity.disabled : 1,
});

/** Text styles */
export const textStyle = (t: Theme) => ({
  mega: {
    fontSize: t.font.mega,
    lineHeight: t.leading.mega,
    fontWeight: t.weight.extrabold,
    color: t.color.text,
    letterSpacing: -1.5,
  },
  display: {
    fontSize: t.font.display,
    lineHeight: t.leading.display,
    fontWeight: t.weight.bold,
    color: t.color.text,
    letterSpacing: -1,
  },
  title: {
    fontSize: t.font.title,
    lineHeight: t.leading.title,
    fontWeight: t.weight.bold,
    color: t.color.text,
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: t.font.heading,
    lineHeight: t.leading.heading,
    fontWeight: t.weight.semibold,
    color: t.color.text,
  },
  body: {
    fontSize: t.font.body,
    lineHeight: t.leading.body,
    fontWeight: t.weight.regular,
    color: t.color.text,
  },
  bodyStrong: {
    fontSize: t.font.body,
    lineHeight: t.leading.body,
    fontWeight: t.weight.semibold,
    color: t.color.text,
  },
  small: {
    fontSize: t.font.small,
    lineHeight: t.leading.small,
    fontWeight: t.weight.regular,
    color: t.color.textMuted,
  },
  smallStrong: {
    fontSize: t.font.small,
    lineHeight: t.leading.small,
    fontWeight: t.weight.semibold,
    color: t.color.textMuted,
  },
  label: {
    fontSize: t.font.label,
    lineHeight: t.leading.label,
    fontWeight: t.weight.medium,
    color: t.color.textFaint,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  micro: {
    fontSize: t.font.micro,
    lineHeight: t.leading.micro,
    fontWeight: t.weight.medium,
    color: t.color.textFaint,
  },
  // Monospace for technical data
  mono: {
    fontSize: t.fontMono.body,
    lineHeight: t.leading.body,
    fontWeight: t.weight.medium,
    color: t.color.textMuted,
    fontFamily: 'SpaceMono, monospace',
  },
  monoSmall: {
    fontSize: t.fontMono.small,
    lineHeight: t.leading.small,
    fontWeight: t.weight.medium,
    color: t.color.textFaint,
    fontFamily: 'SpaceMono, monospace',
  },
});

/** Input field style */
export const inputStyle = (t: Theme, hasError = false, focused = false, disabled = false) => ({
  minHeight: t.minTouch + 8,
  borderWidth: focused ? 2 : 1,
  borderColor: hasError
    ? t.color.danger
    : focused
    ? t.color.neural
    : disabled
    ? t.color.glassBorder
    : t.color.glassBorder,
  borderRadius: t.radii.md,
  paddingHorizontal: t.space(4),
  paddingVertical: t.space(2),
  fontSize: t.font.body,
  color: t.color.text,
  backgroundColor: disabled ? t.color.backgroundAlt : t.color.glass,
  ...t.shadow.subtle,
});

/** Certainty badge styles */
export const certaintyBadgeStyle = (t: Theme, kind: 'known' | 'unknown' | 'danger') => ({
  paddingHorizontal: t.space(3),
  paddingVertical: t.space(1),
  borderRadius: t.radii.pill,
  backgroundColor: kind === 'known'
    ? t.color.knownSoft
    : kind === 'unknown'
    ? t.color.unknownSoft
    : t.color.dangerSoft,
  borderWidth: 1,
  borderColor: kind === 'known'
    ? t.color.known
    : kind === 'unknown'
    ? t.color.unknown
    : t.color.danger,
});

/** Neural progress ring style */
export const neuralProgressStyle = (t: Theme) => ({
  strokeWidth: 3,
  strokeColor: t.color.neural,
  trailColor: t.color.glassBorder,
});

/** Pulse progress ring style */
export const pulseProgressStyle = (t: Theme) => ({
  strokeWidth: 3,
  strokeColor: t.color.pulse,
  trailColor: t.color.glassBorder,
});

/** Format money - preserves v1 behavior */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'inconnu';

  const raw = typeof currency === 'string' ? currency.trim() : '';
  const isIsoCode = /^[A-Za-z]{3}$/.test(raw);

  if (!isIsoCode) {
    const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    return `${n} (devise non précisée)`;
  }

  const code = raw.toUpperCase();
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}

/** Price label for results */
export function priceLabel(
  amount: number | null | undefined,
  currency: string | null | undefined,
): { text: string; kind: 'none' | 'approximate' | 'exact' } {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount === 0) {
    return { text: 'Prix non communiqué', kind: 'none' };
  }
  const raw = typeof currency === 'string' ? currency.trim() : '';
  const approximate = !/^[A-Za-z]{3}$/.test(raw);
  return { text: formatMoney(amount, currency), kind: approximate ? 'approximate' : 'exact' };
}

/** Score formatting */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'score indisponible';
  return `${Math.round(score)} pts`;
}

/** Safe display text */
export function displayText(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export const CERTAINTY_LABEL: Record<string, string> = {
  known: 'Coût total connu',
  partially_known: 'Coût partiellement connu',
  unknown: 'Coût inconnu',
};

// Agent personality tokens
export const agent = {
  name: 'Capucine',
  personality: {
    curious: 'J\'analyse...',
    thinking: 'Réflexion en cours...',
    found: 'J\'ai trouvé quelque chose pour vous.',
    uncertain: 'Il me manque quelques détails.',
    helpful: 'Comment puis-je affiner la recherche ?',
  },
  // Response delays for natural feel
  responseDelay: {
    instant: 0,
    quick: 300,
    normal: 600,
    thoughtful: 1200,
  },
} as const;