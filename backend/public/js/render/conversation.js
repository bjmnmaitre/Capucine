/**
 * Capucine — conversation rendering: home/empty state, message bubbles,
 * search-in-progress state, clarification prompt, error state.
 *
 * HONESTY RULE (megaprompt): the current backend answers POST /search with
 * a single synchronous HTTP response — there is no SSE/streaming endpoint
 * that reports intermediate progress ("understanding" → "searching" →
 * "ranking" as separate events). So this module NEVER renders a fake
 * multi-step checklist implying we know which step is running — that would
 * be exactly the "progression mensongère" the megaprompt forbids. It shows
 * one honest state: "Recherche en cours…" while the request is in flight.
 * If the backend later exposes real progress events, this is the single
 * place to extend.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.renderConversation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderHome(handlers) {
    var t = Capucine.i18n.t;
    var el = document.createElement('div');
    el.className = 'home-view';

    var h1 = document.createElement('h1');
    h1.textContent = t('home.title');
    el.appendChild(h1);

    var subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = t('home.subtitle');
    el.appendChild(subtitle);

    var suggestions = document.createElement('div');
    suggestions.className = 'suggestions';
    ['home.suggestion1', 'home.suggestion2', 'home.suggestion3', 'home.suggestion4'].forEach(function (key) {
      var text = t(key);
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'suggestion-chip';
      chip.textContent = text;
      chip.addEventListener('click', function () { handlers.onSuggestionClick(text); });
      suggestions.appendChild(chip);
    });
    el.appendChild(suggestions);

    return el;
  }

  function renderUserMessage(text) {
    var el = document.createElement('div');
    el.className = 'msg msg-user';
    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    el.appendChild(bubble);
    return el;
  }

  /** @param {'understanding'|'searching'|'searchingDeeper'|'generic'} statusKind */
  function renderProgress(statusKind) {
    var t = Capucine.i18n.t;
    var el = document.createElement('div');
    el.className = 'msg msg-capucine';
    el.setAttribute('aria-live', 'polite');

    var box = document.createElement('div');
    box.className = 'progress-box';

    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = 'var(--space-3)';

    var spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    row.appendChild(spinner);

    var text = document.createElement('p');
    text.style.margin = '0';
    text.textContent = t('status.' + (statusKind || 'generic'));
    row.appendChild(text);

    box.appendChild(row);
    el.appendChild(box);
    return el;
  }

  function renderClarify(question, handlers) {
    var t = Capucine.i18n.t;
    var el = document.createElement('div');
    el.className = 'msg msg-capucine';

    var box = document.createElement('div');
    box.className = 'clarify-box';

    var q = document.createElement('p');
    q.className = 'clarify-question';
    q.textContent = question;
    box.appendChild(q);

    var form = document.createElement('form');
    form.className = 'clarify-form';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('clarify.placeholder');
    input.setAttribute('aria-label', t('clarify.placeholder'));
    input.required = true;

    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = t('clarify.continue');

    form.appendChild(input);
    form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var val = input.value.trim();
      if (val) handlers.onAnswer(val);
    });

    box.appendChild(form);
    el.appendChild(box);
    return { el: el, focus: function () { input.focus(); } };
  }

  function renderError(message, handlers) {
    var t = Capucine.i18n.t;
    var el = document.createElement('div');
    el.className = 'msg msg-capucine';
    el.setAttribute('role', 'alert');

    var box = document.createElement('div');
    box.className = 'error-box';

    var p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);

    var retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'link-button';
    retryBtn.textContent = t('error.retry');
    retryBtn.addEventListener('click', handlers.onRetry);
    box.appendChild(retryBtn);

    el.appendChild(box);
    return el;
  }

  /** A short, honest Capucine text turn (e.g. the results summary sentence). */
  function renderCapucineText(text) {
    var el = document.createElement('div');
    el.className = 'msg msg-capucine';
    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    el.appendChild(bubble);
    return el;
  }

  return {
    renderHome: renderHome,
    renderUserMessage: renderUserMessage,
    renderProgress: renderProgress,
    renderClarify: renderClarify,
    renderError: renderError,
    renderCapucineText: renderCapucineText,
  };
});
