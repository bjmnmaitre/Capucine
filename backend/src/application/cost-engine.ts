/**
 * Capucine — CostEngine
 *
 * The price shown on a page is NOT the real cost of buying something.
 * CostEngine turns an Offer's financial DataPoints (price, shippingCost,
 * and — when a source ever populates them — taxes/importDuties/fees/
 * discount, see domain/types.ts's Offer) into a structured CostBreakdown
 * that is honest about what is actually known.
 *
 * INVARIANTS (non-negotiable):
 * - A missing cost component is NEVER treated as 0. It stays UNKNOWN.
 * - `totalKnown` sums only the components that ARE known — it is NOT "the
 *   final price", and `certainty` says explicitly whether anything is
 *   still missing.
 * - No currency conversion is ever invented: convertTo() only produces a
 *   value when an ExchangeRateProvider actually returns a rate; otherwise
 *   the breakdown stays in its original currency with certainty capped at
 *   'unknown' for the conversion itself (see convertBreakdown()).
 * - Comparing two breakdowns (compareCost) never claims one is
 *   "definitely cheaper" when either has unknown components that could
 *   change the outcome — see compareCost()'s doc comment.
 */

import { DataPoint, DataStatus, Offer } from '../domain/types';
import { SupportedCurrency, convertPrice, DEFAULT_CURRENCY } from './i18n';

// ============================================================================
// TYPES
// ============================================================================

export type CostCertainty = 'known' | 'partially_known' | 'unknown';

/**
 * State of ONE cost component. Four states, because collapsing them loses
 * information the user needs:
 *
 *  'known'          a source published it. Counted in totalKnown.
 *  'unknown'        nobody published it. NOT zero, NOT ignored — reported.
 *  'not_applicable' it provably cannot apply to this transaction (e.g. import
 *                   duties on a purchase that never crosses a customs border).
 *                   Counted as zero because it IS zero, not because we guessed.
 *  'estimated'      derived rather than published — currently only a currency
 *                   conversion made with a non-live rate. Never presented as
 *                   a confirmed amount.
 */
export type CostComponentState = 'known' | 'unknown' | 'not_applicable' | 'estimated';

export type CostComponentName = 'productPrice' | 'shipping' | 'taxes' | 'importDuties' | 'fees' | 'discount';

/**
 * Where the purchase happens, so the engine can tell a component that is
 * genuinely inapplicable from one that is merely unreported.
 */
export interface CostContext {
  /** ISO country the buyer wants delivery to. */
  destinationCountry?: string;
  /** ISO country the merchant ships from, when known. */
  merchantCountry?: string;
}

export interface CostBreakdown {
  productPrice: DataPoint<number>;
  shipping: DataPoint<number>;
  taxes: DataPoint<number>;
  importDuties: DataPoint<number>;
  fees: DataPoint<number>;
  /** A discount is a REDUCTION — subtracted from the sum of the components above. */
  discount: DataPoint<number>;

  currency: SupportedCurrency;

  /** Sum of every component whose status is 'known' or 'verified', minus
   *  any known discount. NOT the final price — see `certainty`. */
  totalKnown: number;

  /** 'known' only when EVERY component (price, shipping, taxes,
   *  importDuties, fees) is known/verified — discount is not required to
   *  be known for 'known' (many offers legitimately have no discount at
   *  all, which is a fact, not a gap). 'unknown' when price itself is
   *  unknown (nothing meaningful can be totaled). 'partially_known' otherwise. */
  certainty: CostCertainty;

  /** Which named components are NOT known — empty when certainty === 'known'. */
  unknownComponents: string[];

  /**
   * Per-component state. Strictly richer than `unknownComponents`, which is
   * kept unchanged for existing consumers: a component can now be reported as
   * provably inapplicable instead of being lumped in with the unknowns.
   */
  componentStates: Record<CostComponentName, CostComponentState>;

  /**
   * True when `totalKnown` includes an estimated part (today: a currency
   * conversion made with a non-live rate). A caller must never present an
   * estimated total as a confirmed price.
   */
  containsEstimate: boolean;
}

export interface ExchangeRate {
  from: SupportedCurrency;
  to: SupportedCurrency;
  rate: number;
  /** Where this rate came from — 'mock' for the deterministic built-in
   *  provider, never presented as a live market rate. */
  source: string;
  asOf: Date;
}

export interface ExchangeRateProvider {
  /** Returns null — never a guessed rate — when the pair isn't available. */
  getRate(from: SupportedCurrency, to: SupportedCurrency): ExchangeRate | null;
}

/**
 * Deterministic, offline, clearly-labeled-as-mock rate table. Capucine must
 * remain functional with ZERO external providers configured (megaprompt
 * PARTIE 6) — this is what makes currency COMPARISON possible in that mode,
 * while every rate it returns is traceable to `source: 'mock_static_table'`
 * so nothing downstream can mistake it for a live market rate.
 */
export class MockExchangeRateProvider implements ExchangeRateProvider {
  private static readonly SOURCE = 'mock_static_table';
  // Fixed, illustrative rates relative to EUR — NOT live rates. Extend this
  // table (not a new provider) to cover more currencies.
  private static readonly TO_EUR: Partial<Record<SupportedCurrency, number>> = {
    EUR: 1,
    USD: 0.92,
    GBP: 1.17,
  };

  getRate(from: SupportedCurrency, to: SupportedCurrency): ExchangeRate | null {
    // TO_EUR[cur] = how many EUR one unit of `cur` is worth. To convert an
    // amount FROM `from` TO `to`: amount * TO_EUR[from] = amount in EUR;
    // (amount in EUR) / TO_EUR[to] = amount in `to`. So the direct
    // from→to multiplier is TO_EUR[from] / TO_EUR[to].
    const fromRate = MockExchangeRateProvider.TO_EUR[from];
    const toRate = MockExchangeRateProvider.TO_EUR[to];
    if (fromRate === undefined || toRate === undefined) return null;
    return {
      from,
      to,
      rate: fromRate / toRate,
      source: MockExchangeRateProvider.SOURCE,
      asOf: new Date(),
    };
  }
}

// ============================================================================
// COST ENGINE
// ============================================================================

export class CostEngine {
  /**
   * Computes a CostBreakdown from an offer's financial DataPoints. Purely
   * deterministic — no AI, no network. Every component is read as-is; none
   * is inferred from another (e.g. a known price never implies a guessed
   * shipping cost).
   */
  computeCost(offer: Offer, context: CostContext = {}): CostBreakdown {
    const currency = (offer.currency as SupportedCurrency | undefined) ?? DEFAULT_CURRENCY;

    const price = offer.price;
    const shipping = offer.shippingCost;
    const taxes = offer.taxes ?? { value: null, status: 'unknown' as DataStatus };
    const importDuties = offer.importDuties ?? { value: null, status: 'unknown' as DataStatus };
    const fees = offer.fees ?? { value: null, status: 'unknown' as DataStatus };
    const discount = offer.discount ?? { value: null, status: 'unknown' as DataStatus };

    const isKnown = (dp: DataPoint<number>) =>
      (dp.status === 'known' || dp.status === 'verified') && dp.value !== null;

    const unknownComponents: string[] = [];
    const componentStates: Record<CostComponentName, CostComponentState> = {
      productPrice: 'unknown',
      shipping: 'unknown',
      taxes: 'unknown',
      importDuties: 'unknown',
      fees: 'unknown',
      discount: 'unknown',
    };
    let total = 0;

    if (isKnown(price)) { total += price.value as number; componentStates.productPrice = 'known'; }
    else unknownComponents.push('productPrice');

    if (isKnown(shipping)) { total += shipping.value as number; componentStates.shipping = 'known'; }
    else unknownComponents.push('shipping');

    if (isKnown(taxes)) { total += taxes.value as number; componentStates.taxes = 'known'; }
    else unknownComponents.push('taxes');

    // Import duties are NOT unknown when the transaction crosses no customs
    // border: a domestic purchase, or one inside the EU customs union, incurs
    // none. Reporting that as 'unknown' would understate what Capucine
    // actually knows and would keep a fully-known cost from ever reaching
    // certainty 'known'. This is a legal fact about the transaction, not an
    // estimate — see NO_CUSTOMS_BORDER.
    if (isKnown(importDuties)) { total += importDuties.value as number; componentStates.importDuties = 'known'; }
    else if (crossesNoCustomsBorder(context)) { componentStates.importDuties = 'not_applicable'; }
    else unknownComponents.push('importDuties');

    if (isKnown(fees)) { total += fees.value as number; componentStates.fees = 'known'; }
    else unknownComponents.push('fees');

    // A discount is subtracted, but its ABSENCE is not evidence of an
    // unreported discount — most offers simply have none. Only price/
    // shipping/taxes/importDuties/fees drive certainty; discount is applied
    // when known, ignored (not flagged as a gap) when not.
    if (isKnown(discount)) { total -= discount.value as number; componentStates.discount = 'known'; }
    else componentStates.discount = 'not_applicable'; // no discount reported is a fact, not a gap

    const certainty: CostCertainty = !isKnown(price)
      ? 'unknown'
      : unknownComponents.length === 0
        ? 'known'
        : 'partially_known';

    return {
      productPrice: price,
      shipping,
      taxes,
      importDuties,
      fees,
      discount,
      currency,
      totalKnown: total,
      certainty,
      unknownComponents,
      componentStates,
      containsEstimate: false,
    };
  }

  /**
   * Converts a breakdown's totalKnown into `targetCurrency` using
   * `provider`. Returns the ORIGINAL breakdown, untouched, when no rate is
   * available — a missing exchange rate is exactly the same kind of gap as
   * a missing shipping cost, and is reflected the same way: certainty is
   * never silently upgraded, and the currency field is never changed
   * without an actual rate to back it.
   */
  convertBreakdown(
    breakdown: CostBreakdown,
    targetCurrency: SupportedCurrency,
    provider: ExchangeRateProvider
  ): CostBreakdown {
    if (breakdown.currency === targetCurrency) return breakdown;
    const rate = provider.getRate(breakdown.currency, targetCurrency);
    if (!rate) return breakdown; // no fabricated conversion — stays in its original currency

    const converted = convertPrice(breakdown.totalKnown, breakdown.currency, targetCurrency, {
      [breakdown.currency]: 1,
      [targetCurrency]: rate.rate,
    } as Record<SupportedCurrency, number>);

    // The converted amount is DERIVED, not published — and today's only rate
    // provider is an explicitly static table. Marking it estimated is what
    // keeps a caller from presenting it as a confirmed price. The certainty of
    // the underlying components is unchanged; what became uncertain is the
    // currency, and that is said separately.
    return {
      ...breakdown,
      currency: targetCurrency,
      totalKnown: converted,
      containsEstimate: true,
    };
  }

  /**
   * Orders two breakdowns for a "cheapest first" preference.
   *
   * IMPORTANT — this never claims false certainty: it returns a
   * deterministic order (by totalKnown) so the UI has something useful to
   * show, but a caller building the "why is this #1" explanation MUST check
   * `certainty` on whichever breakdown ends up first — an offer whose
   * totalKnown happens to be lowest while `certainty !== 'known'` is NOT
   * "the cheapest", it is "the cheapest AMONG KNOWN COMPONENTS, with
   * {unknownComponents} still unknown and possibly higher". See
   * ranking-preference.ts's reasonCode selection for how that distinction
   * is actually surfaced to the user.
   */
  compareCost(a: CostBreakdown, b: CostBreakdown): number {
    if (a.currency !== b.currency) {
      // Cannot honestly compare amounts in different currencies without a
      // conversion having already happened — treat as a tie rather than
      // silently comparing incompatible numbers.
      return 0;
    }
    return a.totalKnown - b.totalKnown;
  }
}

/**
 * Countries between which a purchase crosses no customs border.
 *
 * EU member states form a customs union: goods moving between them incur no
 * import duties. This is a legal fact, not a guess, which is why the resulting
 * component is 'not_applicable' rather than 'estimated'. A pair not covered
 * here stays UNKNOWN — never assumed duty-free.
 */
const EU_CUSTOMS_UNION: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

function crossesNoCustomsBorder(context: CostContext): boolean {
  const { destinationCountry, merchantCountry } = context;
  if (!destinationCountry || !merchantCountry) return false;
  const from = merchantCountry.toUpperCase();
  const to = destinationCountry.toUpperCase();
  if (from === to) return true;
  return EU_CUSTOMS_UNION.has(from) && EU_CUSTOMS_UNION.has(to);
}

export const defaultCostEngine = new CostEngine();
