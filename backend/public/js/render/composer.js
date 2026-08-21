/**
 * Capucine — Composer: the heart of the interface (megaprompt).
 *
 * Text input (auto-growing textarea, Enter=send / Shift+Enter=newline),
 * a mic button prepared for voice input but explicitly NOT functional
 * (no real STT provider is wired to the browser — see megaprompt "ne
 * prétends pas que le microphone réel fonctionne"). Clicking it shows an
 * honest "coming soon" state rather than silently doing nothing or faking
 * a recording.
 *
 * InputModality is modeled explicitly (text | voice) even though only
 * 'text' is functional today — this is what lets voice be added later
 * without restructuring the composer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.renderComposer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_HEIGHT_PX = 200;

  /**
   * @param {{disabled: boolean, value?: string}} data - `value` preserves
   *   in-progress text across a re-render (e.g. opening Settings or toggling
   *   the sidebar rebuilds the composer DOM node — without this, that would
   *   silently wipe whatever the user was mid-typing).
   * @param {{onSubmit: Function(text), onMicClick: Function}} handlers
   * @returns {{el: HTMLElement, focus: Function, reset: Function}}
   */
  function render(data, handlers) {
    var t = Capucine.i18n.t;
    var wrap = document.createElement('div');
    wrap.className = 'composer-wrap';

    var inner = document.createElement('div');
    inner.className = 'composer-inner';

    var form = document.createElement('form');
    form.className = 'composer';
    form.setAttribute('role', 'search');

    var textarea = document.createElement('textarea');
    textarea.id = 'query-input';
    textarea.rows = 1;
    textarea.placeholder = t('composer.placeholder');
    textarea.setAttribute('aria-label', t('composer.placeholder'));
    textarea.required = true;
    textarea.disabled = !!data.disabled;
    if (data.value) textarea.value = data.value;

    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, MAX_HEIGHT_PX) + 'px';
    }
    textarea.addEventListener('input', autoResize);
    if (data.value) autoResize();

    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit() : submit();
      }
    });

    var micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'composer-btn composer-mic';
    micBtn.setAttribute('aria-label', t('composer.micAriaLabel'));
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.title = t('composer.micComingSoon');
    micBtn.innerHTML = micIconSvg();
    micBtn.addEventListener('click', function () {
      handlers.onMicClick && handlers.onMicClick();
    });

    var sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.className = 'composer-btn composer-send';
    sendBtn.setAttribute('aria-label', t('composer.sendAriaLabel'));
    sendBtn.disabled = !!data.disabled;
    sendBtn.innerHTML = sendIconSvg();

    function submit() {
      var value = textarea.value.trim();
      if (!value) return;
      handlers.onSubmit(value);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });

    form.appendChild(micBtn);
    form.appendChild(textarea);
    form.appendChild(sendBtn);
    inner.appendChild(form);

    var hint = document.createElement('p');
    hint.className = 'composer-hint';
    hint.textContent = t('composer.hint');
    inner.appendChild(hint);

    wrap.appendChild(inner);

    return {
      el: wrap,
      focus: function () { textarea.focus(); },
      reset: function () { textarea.value = ''; autoResize(); },
      getValue: function () { return textarea.value; },
      setDisabled: function (disabled) {
        textarea.disabled = disabled;
        sendBtn.disabled = disabled;
      },
    };
  }

  function sendIconSvg() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12L20 4L14 20L11 13L4 12Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="currentColor"/></svg>';
  }
  function micIconSvg() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  return { render: render };
});
