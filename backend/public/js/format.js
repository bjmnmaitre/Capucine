/**
 * Capucine — locale-aware formatting (browser Intl.*, no extra library).
 * Mirrors the backend's own formatting.ts philosophy: structured data
 * ({ amount, currency }) is only turned into a display string here, at the
 * presentation boundary — never earlier.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.format = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function localeTag(language) {
    // Bare language code is valid for Intl.* — no invented region.
    return language || 'fr';
  }

  function price(amount, currency, language) {
    if (amount === null || amount === undefined) return null;
    try {
      return new Intl.NumberFormat(localeTag(language), { style: 'currency', currency: currency || 'EUR' }).format(amount);
    } catch (e) {
      return amount + ' ' + (currency || '');
    }
  }

  function number(value, language) {
    try {
      return new Intl.NumberFormat(localeTag(language)).format(value);
    } catch (e) {
      return String(value);
    }
  }

  function duration(ms, language) {
    var seconds = Math.round(ms / 100) / 10; // one decimal
    return seconds;
  }

  return { price: price, number: number, duration: duration };
});
