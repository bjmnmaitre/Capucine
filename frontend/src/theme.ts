import { Platform } from 'react-native';

/**
 * CAPUCINE — design tokens.
 *
 * One source of truth for colour, type, spacing, radius, elevation. Screens
 * never hard-code a hex value or a magic number: every visual decision routes
 * through here so the app reads as one product.
 *
 * Contrast: every text colour is >= 4.5:1 on `surface` (#FFFFFF) and on
 * `background`. Touch targets are never below `minTouch` (44pt, Apple HIG).
 *
 * Direction: warm, quiet, premium. Few borders, one accent, generous space,
 * a strong type hierarchy carrying the meaning instead of colour and chrome.
 */

const palette = {
  ink: '#15130F',        // near-black, warm — 16.7:1 on paper
  inkSoft: '#5B5750',    // secondary text — 7.0:1 on paper
  inkFaint: '#736E65',   // captions, placeholders — 4.8:1 on paper
  paper: '#FBF9F5',      // app background, warm off-white
  card: '#FFFFFF',       // raised surfaces
  cardAlt: '#F4F1EA',    // insets, pressed rows, skeletons
  line: '#E7E2D8',       // hairlines
  lineStrong: '#D8D2C4',

  accent: '#1F5C4D',     // deep pine green — 6.6:1 on paper
  accentText: '#FFFFFF',
  accentSoft: '#E6EFEB', // accent-tinted surface
  accentInk: '#174A3D',  // accent used as text on accentSoft — 7.1:1

  known: '#1C6B44',      // a fact we stand behind — 5.4:1 on paper
  knownSoft: '#E4F1E7',
  unknown: '#7A5200',    // unknown, NOT an error — 5.2:1 on paper
  unknownSoft: '#F6EAD3',
  danger: '#9B2C2C',     // 6.4:1 on paper
  dangerSoft: '#F7E4E1',

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

    // Certainty semantics — UNKNOWN is its own colour, never the error colour
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

  /** Single legacy radius token (kept: many styles read `theme.radius`). */
  radius: 14,
  /** Named radii for new work. */
  radii: { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 },

  /** Apple HIG / Material minimum touch target. */
  minTouch: 44,

  font: {
    /** Home hero. */
    mega: 40,
    display: 30,
    title: 24,
    heading: 19,
    body: 16,
    small: 14,
    label: 12.5,
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
  },

  /** Platform elevation. Spread into a style: `...theme.shadow.card`. Kept
   *  deliberately soft — one warm shadow, never a hard drop. */
  shadow: {
    card: Platform.select({
      ios: {
        shadowColor: '#2A2109',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 16,
      },
      default: { elevation: 2 },
    }) as object,
    raised: Platform.select({
      ios: {
        shadowColor: '#2A2109',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.1,
        shadowRadius: 28,
      },
      default: { elevation: 8 },
    }) as object,
  },
} as const;

/**
 * Money formatting that refuses to invent. `null` never becomes 0 or "0 €" —
 * it becomes an explicit "inconnu", because an unknown price and a free item
 * are not the same thing.
 */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  // Non-finite guard, not just null: Intl.NumberFormat.format(NaN) renders
  // the string "NaN €", which is worse than saying nothing — it looks like a
  // price. Infinity and a malformed number are unknown values too.
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'inconnu';

  const raw = typeof currency === 'string' ? currency.trim() : '';
  const isIsoCode = /^[A-Za-z]{3}$/.test(raw);

  // A blank currency defaults to EUR (destination is France, the overwhelming
  // majority of offers are in euros). But an EXPLICIT non-ISO value — the
  // backend sends the literal "unknown" when it read an amount off a page
  // without a currency symbol — must not be silently rendered as euros, nor
  // as the raw token ("34,9 unknown"): keep the number, flag the currency.
  if (raw.length > 0 && !isIsoCode) {
    const n = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    return `${n} (devise non précisée)`;
  }

  const code = isIsoCode ? raw.toUpperCase() : 'EUR';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).format(amount);
  } catch {
    // An unsupported (but 3-letter) currency code must not lose the amount.
    return `${amount} ${code}`;
  }
}

/**
 * Renders a score for display. A missing or non-finite score becomes an
 * explicit "score indisponible" rather than "NaN points" or "undefined points".
 */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'score indisponible';
  return `${Math.round(score)} points`;
}

/**
 * Last line of defence for any backend string rendered as-is. An absent or
 * blank value becomes the caller's fallback, never the literal "undefined"
 * or "null" that string interpolation would otherwise print on screen.
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
