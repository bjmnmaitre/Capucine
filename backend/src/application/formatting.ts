/**
 * Capucine — Locale-aware formatting
 *
 * Internal data stays structured ({ amount: 1299.99, currency: 'EUR' }) all
 * the way through the pipeline — see domain/types.ts Offer.price (DataPoint
 * <number> + a separate currency field). This module is the ONLY place a
 * structured value becomes a display string, and only at the presentation
 * boundary (server.ts serialization, future voice output). Never format
 * earlier and pass a string around — that's the naive-string-transform the
 * megaprompt explicitly forbids.
 *
 * Built entirely on the platform's Intl.* — no new formatting logic to
 * maintain, no third-party i18n library dependency, and correct for every
 * SUPPORTED_LOCALES entry out of the box (numbering systems, currency
 * symbol placement, decimal/group separators — all real CLDR data).
 */

/** BCP-47-ish tag ("fr", "fr-FR", "en-US", ...) — build with toBcp47() from
 *  i18n.ts's SupportedLanguage/SupportedCountry rather than hand-writing one. */
type LocaleCode = string;

// ============================================================================
// PRICE / CURRENCY / NUMBER
// ============================================================================

export function formatPrice(amount: number, currency: string, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export function formatNumber(value: number, locale: LocaleCode, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function formatPercent(ratio: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

// ============================================================================
// DATE / TIME / DURATION
// ============================================================================

export function formatDate(date: Date, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(date: Date, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Duration in whole seconds → locale-formatted "Xh Ym" style string, via
 *  Intl.DurationFormat where available, with a manual fallback (Node/engine
 *  support for DurationFormat is still rolling out as of this writing). */
export function formatDurationSeconds(totalSeconds: number, locale: LocaleCode): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const IntlAny = Intl as unknown as { DurationFormat?: new (locale: string, opts: unknown) => { format(d: unknown): string } };
  if (IntlAny.DurationFormat) {
    return new IntlAny.DurationFormat(locale, { style: 'short' }).format({ hours, minutes });
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ============================================================================
// TECHNICAL UNITS
// ============================================================================

/**
 * Canonical internal units stay as-is (see NormalizationEngine —
 * screen_size in inches, storage/ram in GB); this only controls DISPLAY.
 * `unit` uses the CSS/Intl unit identifiers Intl.NumberFormat understands.
 */
export function formatUnit(value: number, unit: 'inch' | 'gigabyte' | 'kilogram' | 'gram' | 'centimeter' | 'kilometer', locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value);
}
