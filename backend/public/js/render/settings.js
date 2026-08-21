/**
 * Capucine — Settings panel: interface language selector.
 *
 * Only the INTERFACE language is chosen here (see i18n.js header — distinct
 * from the search/response language the backend resolves per-query). Every
 * language the backend supports (i18n.js AVAILABLE_LOCALES) is selectable;
 * languages without a hand-written catalog are visibly marked "(translation
 * coming)" rather than silently showing broken/mixed text.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.renderSettings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANGUAGE_NATIVE_NAMES = {
    fr: 'Français', en: 'English', de: 'Deutsch', es: 'Español', it: 'Italiano',
    pt: 'Português', nl: 'Nederlands', pl: 'Polski', sv: 'Svenska', da: 'Dansk',
    no: 'Norsk', fi: 'Suomi', cs: 'Čeština', el: 'Ελληνικά', ro: 'Română',
    hu: 'Magyar', ja: '日本語', ko: '한국어', zh: '中文', ar: 'العربية',
    he: 'עברית', tr: 'Türkçe', uk: 'Українська', ru: 'Русский'
  };

  // Only one settings panel can be mounted at a time, but it can be
  // unmounted several ways (close button, backdrop click, Escape, or a
  // locale change that closes it from app.js) — some of which don't go
  // through this module's own close handler. Tracking the single active
  // listener here (instead of trusting every caller to clean up) means a
  // stray keydown listener never survives past its panel's lifetime.
  var activeEscHandler = null;

  /**
   * @param {{currentLocale: string}} data
   * @param {{onLocaleChange: Function(locale), onClose: Function}} handlers
   */
  function render(data, handlers) {
    if (activeEscHandler) {
      document.removeEventListener('keydown', activeEscHandler);
      activeEscHandler = null;
    }
    var t = Capucine.i18n.t;
    var overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.setAttribute('role', 'presentation');

    var panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t('settings.title'));

    var h2 = document.createElement('h2');
    h2.textContent = t('settings.title');
    panel.appendChild(h2);

    var row = document.createElement('div');
    row.className = 'settings-row';
    var label = document.createElement('label');
    label.setAttribute('for', 'language-select');
    label.textContent = t('settings.language');
    row.appendChild(label);

    var select = document.createElement('select');
    select.id = 'language-select';
    Capucine.i18n.AVAILABLE_LOCALES.forEach(function (loc) {
      var opt = document.createElement('option');
      opt.value = loc;
      var name = LANGUAGE_NATIVE_NAMES[loc] || loc;
      opt.textContent = name + (Capucine.i18n.isTranslated(loc) ? '' : t('settings.languagePreparing'));
      opt.selected = loc === data.currentLocale;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      // Changing the language also closes the panel (see app.js) — clean up
      // the same way closeAndCleanup() does, since this path doesn't call it.
      document.removeEventListener('keydown', escHandler);
      activeEscHandler = null;
      handlers.onLocaleChange(select.value);
    });
    row.appendChild(select);
    panel.appendChild(row);

    function closeAndCleanup() {
      document.removeEventListener('keydown', escHandler);
      activeEscHandler = null;
      handlers.onClose();
    }
    function escHandler(e) {
      if (e.key === 'Escape') closeAndCleanup();
    }

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close';
    closeBtn.textContent = t('settings.close');
    closeBtn.addEventListener('click', closeAndCleanup);
    panel.appendChild(closeBtn);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeAndCleanup();
    });
    document.addEventListener('keydown', escHandler);
    activeEscHandler = escHandler;

    overlay.appendChild(panel);
    return { el: overlay, focus: function () { select.focus(); } };
  }

  return { render: render, LANGUAGE_NATIVE_NAMES: LANGUAGE_NATIVE_NAMES };
});
