/**
 * Capucine — frontend i18n core.
 *
 * RULE (non-negotiable, see megaprompt): no user-facing string is ever
 * written directly in a component. Every piece of text goes through
 * t('some.key', params) — this file is the ONLY place that resolves a key
 * to actual text, exactly mirroring the backend's own i18n.ts split
 * (MessageCode → translate()) so the whole product follows one philosophy.
 *
 * Mirrors (does not duplicate) the backend's language model:
 * - same priority chain as backend resolveLanguage(): explicit > detected
 *   response.language from the API > stored user choice > browser default > 'fr'.
 * - the backend already resolves the SEARCH/response language server-side
 *   (CapucineEngine.search()); this module governs the INTERFACE language,
 *   a separate dimension — see megaprompt "langue de recherche ≠ langue
 *   d'interface". The two can differ (French UI searching German sites).
 *
 * Dual export (UMD-lite): loads as a plain <script> in the browser
 * (window.Capucine.i18n) and via require() in Jest — zero bundler, zero new
 * test infrastructure, the exact code the browser runs is what gets tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.i18n = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_LOCALE = 'fr';

  /** Locales with a real, hand-written catalog (see locales/*.js). Anything
   *  else in AVAILABLE_LOCALES is "prepared" (selectable, structurally
   *  supported by the backend) but falls back to French/English text —
   *  never silently blank, never invented translations. */
  var TRANSLATED_LOCALES = ['fr', 'en'];

  /** The full set the backend supports (see backend i18n.ts
   *  SUPPORTED_LANGUAGES) — kept in sync manually since the frontend has no
   *  build step to import backend TypeScript directly. Used to populate the
   *  language selector so a user CAN pick e.g. 'de' even before its catalog
   *  is written; UI text for 'de' falls back to French/English until then. */
  var AVAILABLE_LOCALES = [
    'fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'fi',
    'cs', 'el', 'ro', 'hu', 'ja', 'ko', 'zh', 'ar', 'he', 'tr', 'uk', 'ru'
  ];

  /** Locales that read right-to-left — drives `dir` attribute, not a guess. */
  var RTL_LOCALES = ['ar', 'he'];

  var catalogs = {};
  var currentLocale = DEFAULT_LOCALE;

  function registerCatalog(locale, catalog) {
    catalogs[locale] = Object.assign({}, catalogs[locale] || {}, catalog);
  }

  function isTranslated(locale) {
    return TRANSLATED_LOCALES.indexOf(locale) !== -1;
  }

  function isAvailable(locale) {
    return AVAILABLE_LOCALES.indexOf(locale) !== -1;
  }

  function isRtl(locale) {
    return RTL_LOCALES.indexOf(locale) !== -1;
  }

  function setLocale(locale) {
    currentLocale = isAvailable(locale) ? locale : DEFAULT_LOCALE;
    return currentLocale;
  }

  function getLocale() {
    return currentLocale;
  }

  /**
   * Priority chain for the INTERFACE language (distinct from the backend's
   * own SEARCH-response language resolution — see file header):
   *   explicit choice > stored preference > browser language > DEFAULT_LOCALE.
   * Never throws, never returns an unsupported code.
   */
  function resolveInterfaceLocale(opts) {
    opts = opts || {};
    var candidates = [opts.explicit, opts.stored, opts.browser];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c) continue;
      var lang = String(c).trim().toLowerCase().split(/[-_]/)[0];
      if (isAvailable(lang)) return lang;
    }
    return DEFAULT_LOCALE;
  }

  /**
   * Translate `key` for `locale` (defaults to the current locale), with
   * {param}-style interpolation. Fallback chain: exact locale → English →
   * French → the key itself (visibly a key, never blank, never invented
   * prose) — matches the backend's translate() fallback philosophy exactly.
   */
  function t(key, params, locale) {
    var loc = locale || currentLocale;
    var template =
      (catalogs[loc] && catalogs[loc][key]) ||
      (catalogs.en && catalogs.en[key]) ||
      (catalogs.fr && catalogs.fr[key]) ||
      key;

    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, function (_, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : '{' + name + '}';
    });
  }

  /**
   * Pluralization using the platform's real CLDR rules (Intl.PluralRules) —
   * not `count === 1`. `key` should resolve (via t()) to a JSON-ish map of
   * plural category → template is NOT how this works; instead callers pass
   * explicit per-category keys, e.g. pluralize(n, 'results.count', locale)
   * looks up 'results.count.one' / 'results.count.other' etc.
   */
  function pluralize(count, keyBase, params, locale) {
    var loc = locale || currentLocale;
    var category;
    try {
      category = new Intl.PluralRules(loc).select(count);
    } catch (e) {
      category = count === 1 ? 'one' : 'other';
    }
    var mergedParams = Object.assign({ count: count }, params || {});
    var specific = keyBase + '.' + category;
    var hasSpecific = (catalogs[loc] && catalogs[loc][specific]) || (catalogs.fr && catalogs.fr[specific]);
    if (hasSpecific) return t(specific, mergedParams, loc);
    return t(keyBase + '.other', mergedParams, loc);
  }

  return {
    DEFAULT_LOCALE: DEFAULT_LOCALE,
    AVAILABLE_LOCALES: AVAILABLE_LOCALES,
    TRANSLATED_LOCALES: TRANSLATED_LOCALES,
    registerCatalog: registerCatalog,
    isTranslated: isTranslated,
    isAvailable: isAvailable,
    isRtl: isRtl,
    setLocale: setLocale,
    getLocale: getLocale,
    resolveInterfaceLocale: resolveInterfaceLocale,
    t: t,
    pluralize: pluralize,
  };
});
