/**
 * Minimal design tokens. Contrast ratios against `surface` (#FFFFFF) are
 * >= 4.5:1 for every text colour, and touch targets are never below 44pt.
 */
export const theme = {
  color: {
    background: '#F6F7F9',
    surface: '#FFFFFF',
    border: '#D3D7DE',
    text: '#14181F',        // 16.1:1 on white
    textMuted: '#4F5764',   // 7.6:1 on white
    accent: '#1B4FD8',      // 7.0:1 on white
    accentText: '#FFFFFF',
    known: '#14603A',       // 6.4:1 — a fact we stand behind
    unknown: '#6B4A00',     // 6.3:1 — unknown, NOT an error colour
    danger: '#9B1C1C',      // 7.4:1
  },
  space: (n: number) => n * 8,
  radius: 12,
  /** Apple HIG / Material minimum touch target. */
  minTouch: 44,
  font: {
    title: 26,
    heading: 19,
    body: 16,
    small: 14,
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
