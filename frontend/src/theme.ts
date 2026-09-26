import { Platform } from 'react-native';

/**
 * CAPUCINE — Design System.
 *
 * Single source of truth for colour, type, spacing, radius, elevation, motion.
 * Screens never hard-code a hex value or a magic number.
 *
 * Principles:
 * - Warm, quiet, premium. Few borders, one accent, generous space.
 * - Strong type hierarchy carries meaning instead of colour and chrome.
 * - Contrast: every text colour >= 4.5:1 on background/surface.
 * - Touch targets never below minTouch (44pt, Apple HIG).
 * - Honest states: unknown is its own colour, never the error colour.
 */

const palette = {
  // Text hierarchy — warm near-black through muted
  ink: '#15130F',           // primary text — 16.7:1 on paper
  inkSoft: '#5B5750',       // secondary text — 7.0:1 on paper
  inkFaint: '#736E65',      // captions, placeholders — 4.8:1 on paper

  // Surfaces
  paper: '#FBF9F5',         // app background, warm off-white
  card: '#FFFFFF',          // raised surfaces
  cardAlt: '#F4F1EA',       // insets, pressed rows, skeletons
  line: '#E7E2D8',          // hairlines
  lineStrong: '#D8D2C4',    // stronger separators

  // Accent — deep pine green, single brand colour
  accent: '#1F5C4D',        // primary action — 6.6:1 on paper
  accentText: '#FFFFFF',    // on accent
  accentSoft: '#E6EFEB',    // accent-tinted surface
  accentInk: '#174A3D',     // accent as text on accentSoft — 7.1:1

  // Certainty semantics — UNKNOWN is its own colour, never the error colour
  known: '#1C6B44',         // a fact we stand behind — 5.4:1 on paper
  knownSoft: '#E4F1E7',
  unknown: '#7A5200',       // unknown, NOT an error — 5.2:1 on paper
  unknownSoft: '#F6EAD3',
  danger: '#9B2C2C',        // destructive — 6.4:1 on paper
  dangerSoft: '#F7E4E1',

  // Overlay
  overlay: 'rgba(21,19,15,0.32)',
};

export const theme = {
  color: {
    // Semantic surface / text roles
    background: palette.paper,
    surface: palette.card,
    surfaceAlt: palette.cardAlt,
    border: palette.line,
    borderStrong: palette.lineStrong,
    text: palette.ink,
    textMuted: palette.inkSoft,
    textFaint: palette.inkFaint,

    // Accent
    accent: palette.accent,
    accentText: palette.accentText,
    accentSoft: palette.accentSoft,
    accentInk: palette.accentInk,

    // Certainty semantics
    known: palette.known,
    knownSoft: palette.knownSoft,
    unknown: palette.unknown,
    unknownSoft: palette.unknownSoft,
    danger: palette.danger,
    dangerSoft: palette.dangerSoft,

    overlay: palette.overlay,
  },

  /** 8-pt spacing scale. `space(1)` = 8, `space(0.5)` = 4, `space(3)` = 24. */
  space: (n: number) => n * 8,

  /** Single legacy radius token (kept for backward compat). */
  radius: 14,
  /** Named radii for new work. */
  radii: { xs: 4, sm: 8, md: 14, lg: 20, xl: 28, pill: 999 },

  /** Apple HIG / Material minimum touch target. */
  minTouch: 44,

  font: {
    /** Home hero greeting. */
    mega: 40,
    display: 30,
    title: 24,
    heading: 19,
    body: 16,
    small: 14,
    label: 12.5,
    micro: 11,
  },

  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  /** Absolute line-heights, paired with the sizes above. */
  leading: {
    mega: 44,
    display: 36,
    title: 30,
    heading: 25,
    body: 23,
    small: 20,
    label: 17,
  },

  /** Platform elevation — soft, warm shadows, never hard drops. */
  shadow: {
    card: Platform.select({
      ios: { shadowColor: '#2A2109', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 16 },
      default: { elevation: 2 },
    }) as object,
    raised: Platform.select({
      ios: { shadowColor: '#2A2109', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 28 },
      default: { elevation: 8 },
    }) as object,
    subtle: Platform.select({
      ios: { shadowColor: '#2A2109', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8 },
      default: { elevation: 1 },
    }) as object,
  },

  /** Motion tokens — subtle, purposeful, never decorative. */
  motion: {
    fast: 150,
    normal: 250,
    slow: 350,
    easing: { standard: 'cubic-bezier(0.4, 0, 0.2, 1)', emphasize: 'cubic-bezier(0.2, 0, 0, 1)' },
  },

  /** Opacity for pressed/disabled states. */
  opacity: { pressed: 0.7, disabled: 0.4, overlay: 0.5 },
} as const;

/**
 * Money formatting that refuses to invent. `null` never becomes 0 or "0 €" —
 * it becomes an explicit "inconnu", because an unknown price and a free item
 * are not the same thing.
 */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'inconnu';

  const raw = typeof currency === 'string' ? currency.trim() : '';
  const isIsoCode = /^[A-Za-z]{3}$/.test(raw);

  if (raw.length > 0 && !isIsoCode) {
    const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    return `${n} (devise non précisée)`;
  }

  const code = isIsoCode ? raw.toUpperCase() : 'EUR';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}

/**
 * Offer price label for the results list. Never invents a currency: an
 * unknown / non-ISO currency is said so (via formatMoney), a foreign ISO
 * currency keeps its own symbol. `approximate` flags the non-ISO case.
 * A missing or zero amount is "Prix non communiqué", never "0,00 €".
 */
export function priceLabel(
  amount: number | null | undefined,
  currency: string | null | undefined,
): { text: string; kind: 'none' | 'approximate' | 'exact' } {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount === 0) {
    return { text: 'Prix non communiqué', kind: 'none' };
  }
  const raw = typeof currency === 'string' ? currency.trim() : '';
  const approximate = raw.length > 0 && !/^[A-Za-z]{3}$/.test(raw);
  return { text: formatMoney(amount, currency), kind: approximate ? 'approximate' : 'exact' };
}

/**
 * Renders a score for display. Missing/non-finite → explicit label.
 */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'score indisponible';
  return `${Math.round(score)} points`;
}

/**
 * Last line of defence for any backend string rendered as-is.
 * An absent/blank value becomes the caller's fallback, never literal "undefined"/"null".
 */
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

/**
 * Creates a consistent card style object for StyleSheet.
 */
export const cardStyle = (t: typeof theme) => ({
  backgroundColor: t.color.surface,
  borderRadius: t.radii.md,
  borderWidth: 1,
  borderColor: t.color.border,
  ...t.shadow.subtle,
});

/**
 * Creates a consistent input field style.
 */
export const inputStyle = (t: typeof theme, hasError = false, disabled = false) => ({
  minHeight: t.minTouch + 6,
  borderWidth: 1,
  borderColor: hasError ? t.color.danger : (disabled ? t.color.border : t.color.border),
  borderRadius: t.radii.md,
  paddingHorizontal: t.space(2),
  fontSize: t.font.body,
  color: t.color.text,
  backgroundColor: disabled ? t.color.surfaceAlt : t.color.surface,
});

/**
 * Primary button style.
 */
export const primaryButtonStyle = (t: typeof theme, disabled = false) => ({
  minHeight: t.minTouch + 6,
  borderRadius: t.radii.md,
  backgroundColor: disabled ? t.color.accent : t.color.accent,
  alignItems: 'center',
  justifyContent: 'center',
  opacity: disabled ? t.opacity.disabled : 1,
  ...t.shadow.subtle,
});

/**
 * Secondary button style (outline).
 */
export const secondaryButtonStyle = (t: typeof theme, disabled = false) => ({
  minHeight: t.minTouch,
  borderRadius: t.radii.md,
  borderWidth: 1,
  borderColor: disabled ? t.color.border : t.color.accent,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: disabled ? 'transparent' : t.color.accentSoft,
  opacity: disabled ? t.opacity.disabled : 1,
});

/**
 * Text styles for common roles.
 */
export const textStyle = (t: typeof theme) => ({
  mega: { fontSize: t.font.mega, lineHeight: t.leading.mega, fontWeight: t.weight.bold, color: t.color.text, letterSpacing: -0.8 },
  display: { fontSize: t.font.display, lineHeight: t.leading.display, fontWeight: t.weight.bold, color: t.color.text, letterSpacing: -0.5 },
  title: { fontSize: t.font.title, lineHeight: t.leading.title, fontWeight: t.weight.bold, color: t.color.text },
  heading: { fontSize: t.font.heading, lineHeight: t.leading.heading, fontWeight: t.weight.semibold, color: t.color.text },
  body: { fontSize: t.font.body, lineHeight: t.leading.body, fontWeight: t.weight.regular, color: t.color.text },
  bodyStrong: { fontSize: t.font.body, lineHeight: t.leading.body, fontWeight: t.weight.semibold, color: t.color.text },
  small: { fontSize: t.font.small, lineHeight: t.leading.small, fontWeight: t.weight.regular, color: t.color.textMuted },
  smallStrong: { fontSize: t.font.small, lineHeight: t.leading.small, fontWeight: t.weight.semibold, color: t.color.textMuted },
  label: { fontSize: t.font.label, lineHeight: t.leading.label, fontWeight: t.weight.medium, color: t.color.textFaint },
  micro: { fontSize: t.font.micro, lineHeight: t.leading.label, fontWeight: t.weight.medium, color: t.color.textFaint },
});