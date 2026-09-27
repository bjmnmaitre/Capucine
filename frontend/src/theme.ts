import { Platform } from 'react-native';

/**
 * CAPUCINE — Design System, charte « Le Prisme » (brand/Main.dc.html).
 *
 * Single source of truth for colour, type, spacing, radius, elevation, motion.
 * Screens never hard-code a hex value or a magic number.
 *
 * Principles:
 * - Functional clarity first: the brand is carried by marine + or, never by
 *   decoration that costs readability (no blur, no low-contrast glass).
 * - Contrast: every text colour >= 4.5:1 on background AND surface — checked
 *   by src/theme.contrast.test.ts, not merely claimed.
 * - Or 500 (#C8A24A) is 2.1:1 on crème: decorative ONLY on light screens, or
 *   on marine (6.5:1). Gold as text on light surfaces uses goldInk.
 * - Touch targets never below minTouch (44pt, Apple HIG).
 * - Honest states: unknown is its own colour (burnt orange, deliberately NOT
 *   the brand gold), never the error colour.
 */

const palette = {
  // Charte — Le Prisme
  encre: '#071528',         // Encre 900 — primary text, 16.2:1 on crème
  marine: '#0E2340',        // Marine 800 — primary action / brand surfaces, 14.0:1
  marine700: '#16304F',     // raised marine surfaces, borders on marine
  or500: '#C8A24A',         // Or 500 — brand gold, decorative / on marine (6.5:1)
  or300: '#E6C97F',         // Or 300 — gold highlight on marine (9.8:1)
  orInk: '#7A5C17',         // gold as TEXT on light surfaces — 5.5:1 on crème
  orSoft: '#F6EDD5',        // gold-tinted light surface
  creme: '#F4F1EA',         // Crème — app background

  // Text hierarchy (slate derived from the charte's #6C819C, darkened for AA)
  inkSoft: '#4E6078',       // secondary text — 5.7:1 on crème
  inkFaint: '#5A6E88',      // captions, placeholders — 4.6:1 on crème

  // Surfaces
  card: '#FFFFFF',
  cardAlt: '#ECE7DC',
  line: '#E0D9C8',
  lineStrong: '#CFC6B1',
  marineSoft: '#E3E8EF',    // marine-tinted light surface

  // Certainty semantics — UNKNOWN is its own colour, never the error colour
  known: '#1C6B44',         // 5.8:1 on crème
  knownSoft: '#E4F1E7',
  unknown: '#8F4300',       // burnt orange — 6.3:1 on crème, distinct from the gold
  unknownSoft: '#FBE6D2',
  danger: '#9B2C2C',        // 6.7:1 on crème
  dangerSoft: '#F7E4E1',

  overlay: 'rgba(7,21,40,0.40)',
};

export const theme = {
  color: {
    // Semantic surface / text roles
    background: palette.creme,
    surface: palette.card,
    surfaceAlt: palette.cardAlt,
    border: palette.line,
    borderStrong: palette.lineStrong,
    text: palette.encre,
    textMuted: palette.inkSoft,
    textFaint: palette.inkFaint,

    // Primary action — marine, crème text
    accent: palette.marine,
    accentText: palette.creme,
    accentSoft: palette.marineSoft,
    accentInk: palette.marine,

    // Brand gold
    gold: palette.or500,
    goldLight: palette.or300,
    goldInk: palette.orInk,
    goldSoft: palette.orSoft,
    brandSurface: palette.marine,
    brandSurfaceRaised: palette.marine700,

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
      ios: { shadowColor: '#071528', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 16 },
      default: { elevation: 2 },
    }) as object,
    raised: Platform.select({
      ios: { shadowColor: '#071528', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 28 },
      default: { elevation: 8 },
    }) as object,
    subtle: Platform.select({
      ios: { shadowColor: '#071528', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8 },
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

  // Absent, empty or non-ISO currency: the amount is shown, the currency is
  // never guessed (DECIDED 2026-09-26 - no silent "€" default).
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
  const approximate = !/^[A-Za-z]{3}$/.test(raw);
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