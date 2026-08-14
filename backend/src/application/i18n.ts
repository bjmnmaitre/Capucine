/**
 * Capucine Application Layer — Internationalization Infrastructure
 *
 * Native multi-language, multi-country, multi-currency support.
 * Designed from the ground up to be international, not retrofitted.
 *
 * Key principle: No hardcoded France, French, or EUR.
 * All can be extended without code changes.
 */

// ============================================================================
// LANGUAGE SUPPORT
// ============================================================================

/**
 * Supported languages.
 * Extensible: new languages can be added without code changes.
 * Format: ISO 639-1 codes (alpha-2)
 */
export const SUPPORTED_LANGUAGES = ['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'ja', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Primary language for a user or market.
 */
export interface Language {
  code: SupportedLanguage;
  name: string; // English name: "French"
  nativeName: string; // Native name: "Français"
  direction?: 'ltr' | 'rtl'; // Text direction
  isRtl: boolean;
  dateFormat?: string; // e.g., "dd/mm/yyyy" or "mm/dd/yyyy"
  numberFormat?: {
    decimalSeparator: '.' | ',';
    thousandsSeparator: ',' | '.';
  };
}

// ============================================================================
// COUNTRY & REGION SUPPORT
// ============================================================================

/**
 * Supported countries.
 * Format: ISO 3166-1 alpha-2 codes
 */
export const SUPPORTED_COUNTRIES = [
  'FR', 'DE', 'ES', 'IT', 'PT', 'BE', 'NL', 'AT', 'CH', 'GB', 'IE',
  'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'SK', 'HU', 'RO', 'GR', 'CY',
  'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'JP', 'KR', 'CN', 'IN', 'AU', 'NZ'
] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

/**
 * Country/region information.
 */
export interface Country {
  code: SupportedCountry;
  name: string;
  region?: string; // e.g., "Europe", "Americas"

  // Localization
  officialLanguage: SupportedLanguage;
  alternativeLanguages?: SupportedLanguage[];

  // Currency
  currency: string; // ISO 4217

  // Shipping
  shippingZone?: string; // For domestic vs international rates

  // Legal/Tax
  taxRate?: number; // VAT/GST percentage
  requiresVAT?: boolean;

  // Market information
  isLaunched?: boolean; // Is Capucine commercially available here?
  launchDate?: Date;
  marketType?: 'primary' | 'secondary' | 'experimental';
}

/**
 * Region grouping for easier handling.
 */
export interface Region {
  id: string;
  name: string;
  countries: SupportedCountry[];
  primaryLanguage: SupportedLanguage;
  secondaryLanguages?: SupportedLanguage[];
  shippingZoneName?: string;
}

// ============================================================================
// CURRENCY SUPPORT
// ============================================================================

/**
 * Supported currencies.
 * Format: ISO 4217 codes
 */
export const SUPPORTED_CURRENCIES = [
  'EUR', 'USD', 'GBP', 'JPY', 'CNY', 'INR', 'AUD', 'CAD', 'CHF',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK'
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Currency information.
 */
export interface Currency {
  code: SupportedCurrency;
  name: string;
  symbol: string; // e.g., "€", "$", "£"

  // Formatting
  symbolPosition: 'before' | 'after';
  decimalPlaces: number; // Usually 2, but JPY is 0
  decimalSeparator: '.' | ',';
  thousandsSeparator?: ',' | '.' | ' ';

  // Exchange
  exchangeRateToUSD?: number; // Base rate for conversions
  lastUpdatedAt?: Date;

  // Countries using this
  countries: SupportedCountry[];
}

/**
 * Multi-currency price.
 */
export interface MultiCurrencyPrice {
  baseCurrency: SupportedCurrency;
  baseAmount: number;

  // Additional prices in other currencies (cache)
  inCurrency?: {
    currency: SupportedCurrency;
    amount: number;
    exchangeRate?: number;
    convertedAt?: Date;
  }[];

  // Total cost (base + shipping, taxes, etc.)
  totalInCurrency?: {
    currency: SupportedCurrency;
    subtotal: number;
    shipping?: number;
    taxes?: number;
    total: number;
  }[];
}

/**
 * Currency conversion request.
 */
export interface CurrencyConversion {
  from: SupportedCurrency;
  to: SupportedCurrency;
  amount: number;

  // Exchange rate metadata
  rate?: number;
  rateSource?: string; // e.g., "ECB", "custom"
  rateDate?: Date;

  // Result
  convertedAmount?: number;
  roundingMethod?: 'floor' | 'ceil' | 'round';
}

// ============================================================================
// LOCALIZATION CONTEXT
// ============================================================================

/**
 * Complete localization context for a user or request.
 */
export interface LocalizationContext {
  // User's chosen language
  language: SupportedLanguage;

  // User's location (where they are)
  userCountry: SupportedCountry;
  userRegion?: string; // e.g., state/province

  // Shipping context (where products are shipped to)
  shippingCountry: SupportedCountry;
  shippingRegion?: string;

  // Currency preference
  currency: SupportedCurrency;

  // Timezone (for time-related features)
  timezone?: string; // IANA timezone

  // Market context
  market: 'primary' | 'secondary' | 'experimental';

  // Preferences
  useNativeSpelling?: boolean; // e.g., "metre" vs "meter"
  dateFormat?: string; // Override default
  timeFormat?: string; // 12h or 24h

  // Timestamps
  createdAt: Date;
  lastUpdatedAt: Date;
}

// ============================================================================
// MULTI-VALUE FIELDS (Multilingual strings)
// ============================================================================

/**
 * A string that can have multiple language versions.
 */
export interface MultiLanguageString {
  primary: {
    language: SupportedLanguage;
    value: string;
  };

  // Translations
  translations?: {
    language: SupportedLanguage;
    value: string;
    isAutomatic?: boolean; // Machine-translated?
  }[];

  // Metadata
  createdAt: Date;
  lastUpdatedAt: Date;
}

/**
 * A description field in multiple languages.
 */
export interface LocalizedDescription {
  productId: string;

  // Language versions
  descriptions: MultiLanguageString[];

  // Canonical/authoritative version
  canonicalLanguage: SupportedLanguage;

  // Quality
  completeLanguages: SupportedLanguage[];
  partialLanguages?: SupportedLanguage[]; // Only auto-translated
}

// ============================================================================
// LOCALIZED PRODUCT & OFFER
// ============================================================================

/**
 * Product with localization support.
 */
export interface LocalizedProduct {
  id: string;

  // Language-specific fields
  name: MultiLanguageString;
  description?: LocalizedDescription;
  category: {
    primary: string; // Primary taxonomy
    localizedName?: MultiLanguageString; // Category name in user's language
  };

  // Availability by country
  availableIn: SupportedCountry[];

  // Metadata
  defaultLanguage: SupportedLanguage;
  publishedLanguages: SupportedLanguage[];
}

/**
 * Offer with localization support.
 */
export interface LocalizedOffer {
  id: string;
  productId: string;
  merchantId: string;
  merchantName: MultiLanguageString; // If merchant has multilingual name

  // Pricing
  price: MultiCurrencyPrice;

  // Localized product name on this offer
  productNameAsListed?: MultiLanguageString;

  // Shipping by country
  shippingOptions: {
    toCountry: SupportedCountry;
    cost?: MultiCurrencyPrice;
    timeEstimate?: string; // ISO 8601 duration
    available: boolean;
  }[];

  // Availability
  availableCountries: SupportedCountry[];
  restrictedCountries?: SupportedCountry[];

  // Local regulatory info
  localRequirements?: {
    country: SupportedCountry;
    requirement: string;
    example?: string;
  }[];

  // Language of product description on merchant site
  listedLanguages: SupportedLanguage[];
}

// ============================================================================
// SEARCH SCOPE (International discovery)
// ============================================================================

/**
 * Search scope defines where to search and in which languages.
 */
export interface InternationalSearchScope {
  // User context
  userCountry: SupportedCountry;
  userLanguage: SupportedLanguage;
  shippingCountry: SupportedCountry;

  // Search configuration
  searchCountries: SupportedCountry[]; // Where to search for products
  searchLanguages: SupportedLanguage[]; // In which languages

  // Preferences
  preferLocalProducts: boolean; // Prefer domestic over imports?
  includeInternational: boolean; // Include international offers?

  // Filters
  maxShippingTime?: string; // ISO 8601 duration
  acceptsShippingTo: SupportedCountry[];

  // Currency
  displayCurrency: SupportedCurrency;

  // Metadata
  createdAt: Date;
}

/**
 * Example: A French user in Paris wants to buy headphones.
 */
export const EXAMPLE_FRENCH_SEARCH: InternationalSearchScope = {
  userCountry: 'FR',
  userLanguage: 'fr',
  shippingCountry: 'FR',
  searchCountries: ['FR', 'DE', 'ES', 'IT', 'BE', 'NL', 'AT'],
  searchLanguages: ['fr', 'en', 'de'],
  preferLocalProducts: true,
  includeInternational: true,
  maxShippingTime: 'P2W', // 2 weeks
  acceptsShippingTo: ['FR'],
  displayCurrency: 'EUR',
  createdAt: new Date(),
};

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Global i18n configuration.
 */
export interface I18nConfig {
  // Supported values
  languages: Language[];
  countries: Country[];
  currencies: Currency[];
  regions: Region[];

  // Defaults
  defaultLanguage: SupportedLanguage;
  defaultCountry: SupportedCountry;
  defaultCurrency: SupportedCurrency;

  // Exchange rates
  exchangeRateProvider?: 'ECB' | 'custom' | 'builtin';
  exchangeRateUpdateFrequency?: string; // ISO 8601 duration

  // Feature flags
  features: {
    multiLanguageSupport: boolean;
    multiCountrySupport: boolean;
    multiCurrencySupport: boolean;
    autoTranslation?: boolean;
    currencyConversion?: boolean;
  };

  // Metadata
  lastUpdatedAt: Date;
  version: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Determine if a product can be shipped to a user's country.
 */
export function canShipTo(offer: LocalizedOffer, country: SupportedCountry): boolean {
  return (
    offer.availableCountries.includes(country) &&
    !offer.restrictedCountries?.includes(country)
  );
}

/**
 * Get the best language for communication with user.
 * Tries primary language first, then fallback.
 */
export function getBestLanguage(
  userPreferred: SupportedLanguage,
  availableLanguages: SupportedLanguage[],
  fallback: SupportedLanguage = 'en'
): SupportedLanguage {
  if (availableLanguages.includes(userPreferred)) {
    return userPreferred;
  }
  if (availableLanguages.includes(fallback)) {
    return fallback;
  }
  return availableLanguages[0] || 'en';
}

/**
 * Convert a price from one currency to another.
 */
export function convertPrice(
  amount: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency,
  exchangeRates: Record<SupportedCurrency, number>
): number {
  const fromRate = exchangeRates[fromCurrency] || 1;
  const toRate = exchangeRates[toCurrency] || 1;
  return (amount / fromRate) * toRate;
}
