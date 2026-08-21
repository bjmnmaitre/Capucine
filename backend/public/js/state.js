/**
 * Capucine — minimal app state (no framework).
 *
 * A tiny observable store: state object + subscribe(fn) + set(patch). This
 * project intentionally has no React/Vue/build step (see megaprompt:
 * "éviter les bibliothèques UI énormes si le projet n'en utilise pas déjà"),
 * so this is deliberately small rather than a second framework in disguise.
 *
 * IMPORTANT — what's real persistence vs local-only:
 * - `searches` (history) lives ONLY in this tab's memory + localStorage.
 *   The backend has no history/session-persistence endpoint today — this is
 *   NOT synced to a user account. See render/sidebar.js for how this is
 *   labeled to the user (never implied as cross-device).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.state = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'capucine.history.v1';
  var LOCALE_STORAGE_KEY = 'capucine.locale.v1';

  function createStore(initial) {
    var state = initial;
    var listeners = [];

    function get() {
      return state;
    }

    function set(patch) {
      state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch);
      listeners.forEach(function (fn) { fn(state); });
    }

    function subscribe(fn) {
      listeners.push(fn);
      return function unsubscribe() {
        listeners = listeners.filter(function (l) { return l !== fn; });
      };
    }

    return { get: get, set: set, subscribe: subscribe };
  }

  function loadStoredHistory() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function persistHistory(searches) {
    try {
      // Keep it bounded — this is a lightweight local convenience, not a database.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(searches.slice(0, 50)));
    } catch (e) {
      // Storage unavailable (private mode, quota) — degrade silently, history stays in-memory only.
    }
  }

  function loadStoredLocale() {
    try {
      return localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function persistLocale(locale) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (e) {
      // ignore — locale choice just won't survive a reload.
    }
  }

  return {
    createStore: createStore,
    loadStoredHistory: loadStoredHistory,
    persistHistory: persistHistory,
    loadStoredLocale: loadStoredLocale,
    persistLocale: persistLocale,
  };
});
