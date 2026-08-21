/**
 * Capucine — app bootstrap.
 *
 * Wires: i18n (locale resolution + catalogs), the API client, the local
 * history store, and every render/* module together. One user submission
 * == one search request (composer is disabled while a request is in
 * flight — see megaprompt "une soumission utilisateur = une recherche
 * logique", no duplicate/racing requests).
 *
 * Real backend only — no fabricated data anywhere in this file.
 */
(function () {
  'use strict';

  var i18n = Capucine.i18n;
  i18n.registerCatalog('fr', Capucine.locales.fr);
  i18n.registerCatalog('en', Capucine.locales.en);

  // ---- Locale resolution (interface language — see i18n.js header) ----
  var browserLocale = (navigator.language || navigator.userLanguage || 'fr').split('-')[0];
  var storedLocale = Capucine.state.loadStoredLocale();
  i18n.setLocale(i18n.resolveInterfaceLocale({ stored: storedLocale, browser: browserLocale }));
  document.documentElement.lang = i18n.getLocale();
  document.documentElement.dir = i18n.isRtl(i18n.getLocale()) ? 'rtl' : 'ltr';

  // ---- App state ----
  var store = Capucine.state.createStore({
    conversation: [],          // ordered list of { type, ...payload }
    searches: Capucine.state.loadStoredHistory(),
    activeSearchId: null,
    sessionId: null,
    clarifyQuestionId: null,
    inFlight: false,
    sidebarOpen: false,
    settingsOpen: false,
  });

  var sidebarToggleBtn = document.getElementById('sidebar-toggle');
  var appShellEl = document.getElementById('app-shell');
  var sidebarSlot = document.getElementById('sidebar-slot');
  var conversationScroll = document.getElementById('conversation-scroll');
  var conversationSlot = document.getElementById('conversation-slot');
  var composerSlot = document.getElementById('composer-slot');
  var configStatusEl = document.getElementById('config-status');
  var settingsSlot = document.getElementById('settings-slot');

  var composerHandle = null;

  // ---- Rendering ----

  function renderAll() {
    renderSidebar();
    renderConversation();
    renderComposer();
    renderSettingsOverlay();
    var sidebarOpen = store.get().sidebarOpen;
    appShellEl.classList.toggle('sidebar-open', sidebarOpen);
    sidebarToggleBtn.setAttribute('aria-expanded', String(sidebarOpen));
  }

  function renderSidebar() {
    sidebarSlot.innerHTML = '';
    var s = store.get();
    sidebarSlot.appendChild(Capucine.renderSidebar.render(
      { searches: s.searches, activeId: s.activeSearchId },
      {
        onNewSearch: startNewSearch,
        onSelectSearch: function (id) { /* local history is a label list only today — no stored transcript to reopen yet */ },
        onOpenSettings: function () { store.set({ settingsOpen: true }); },
      }
    ));
  }

  function renderConversation() {
    var s = store.get();
    conversationSlot.innerHTML = '';

    if (s.conversation.length === 0) {
      conversationSlot.appendChild(Capucine.renderConversation.renderHome({
        onSuggestionClick: function (text) { submitQuery(text); },
      }));
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'conversation';

    s.conversation.forEach(function (turn) {
      if (turn.type === 'user') {
        wrap.appendChild(Capucine.renderConversation.renderUserMessage(turn.text));
      } else if (turn.type === 'progress') {
        wrap.appendChild(Capucine.renderConversation.renderProgress(turn.kind));
      } else if (turn.type === 'results') {
        wrap.appendChild(Capucine.renderResults.render(turn.data));
      } else if (turn.type === 'clarify') {
        var c = Capucine.renderConversation.renderClarify(turn.question, { onAnswer: submitClarifyAnswer });
        wrap.appendChild(c.el);
      } else if (turn.type === 'error') {
        wrap.appendChild(Capucine.renderConversation.renderError(turn.message, { onRetry: retryLast }));
      } else if (turn.type === 'text') {
        wrap.appendChild(Capucine.renderConversation.renderCapucineText(turn.text));
      }
    });

    conversationSlot.appendChild(wrap);
    conversationScroll.scrollTop = conversationScroll.scrollHeight;
  }

  function renderComposer() {
    // Preserve any in-progress text across a re-render (e.g. opening
    // Settings or toggling the sidebar rebuilds this DOM node) — never
    // silently wipe what the user was mid-typing.
    var previousValue = composerHandle ? composerHandle.getValue() : '';
    composerSlot.innerHTML = '';
    composerHandle = Capucine.renderComposer.render(
      { disabled: store.get().inFlight, value: previousValue },
      { onSubmit: submitQuery, onMicClick: onMicClick }
    );
    composerSlot.appendChild(composerHandle.el);
  }

  function renderSettingsOverlay() {
    settingsSlot.innerHTML = '';
    if (!store.get().settingsOpen) return;
    var handle = Capucine.renderSettings.render(
      { currentLocale: i18n.getLocale() },
      {
        onLocaleChange: function (locale) {
          i18n.setLocale(locale);
          Capucine.state.persistLocale(locale);
          document.documentElement.lang = locale;
          document.documentElement.dir = i18n.isRtl(locale) ? 'rtl' : 'ltr';
          store.set({ settingsOpen: false });
        },
        onClose: function () { store.set({ settingsOpen: false }); },
      }
    );
    settingsSlot.appendChild(handle.el);
    handle.focus();
  }

  // ---- Actions ----

  function startNewSearch() {
    store.set({ conversation: [], sessionId: null, clarifyQuestionId: null, activeSearchId: null, sidebarOpen: false });
    if (composerHandle) { composerHandle.reset(); composerHandle.focus(); }
  }

  function pushTurn(turn) {
    store.set(function (s) { return { conversation: s.conversation.concat([turn]) }; });
  }

  function replaceLastProgress(turn) {
    store.set(function (s) {
      var conv = s.conversation.slice();
      // Drop any trailing progress turn before appending the real result.
      while (conv.length && conv[conv.length - 1].type === 'progress') conv.pop();
      conv.push(turn);
      return { conversation: conv };
    });
  }

  function submitQuery(text) {
    if (store.get().inFlight) return; // one user submission = one logical search — never race two.
    pushTurn({ type: 'user', text: text });
    pushTurn({ type: 'progress', kind: 'generic' });
    store.set({ inFlight: true });

    Capucine.api.search({ query: text, language: i18n.getLocale() }).then(function (res) {
      store.set({ inFlight: false });
      handleApiResponse(res, text);
    }).catch(function () {
      store.set({ inFlight: false });
      replaceLastProgress({ type: 'error', message: i18n.t('error.network') });
    });
  }

  function submitClarifyAnswer(answer) {
    var s = store.get();
    if (s.inFlight || !s.sessionId || !s.clarifyQuestionId) return;
    pushTurn({ type: 'user', text: answer });
    pushTurn({ type: 'progress', kind: 'generic' });
    store.set({ inFlight: true });

    Capucine.api.clarify({ sessionId: s.sessionId, questionId: s.clarifyQuestionId, answer: answer }).then(function (res) {
      store.set({ inFlight: false });
      handleApiResponse(res, null);
    }).catch(function () {
      store.set({ inFlight: false });
      replaceLastProgress({ type: 'error', message: i18n.t('error.network') });
    });
  }

  function handleApiResponse(res, originalQueryForHistory) {
    if (!res.ok) {
      replaceLastProgress({ type: 'error', message: (res.body && res.body.message) || i18n.t('error.server', { status: res.status }) });
      return;
    }
    var data = res.body;

    if (data.session && data.session.sessionId) {
      store.set({ sessionId: data.session.sessionId });
    }

    if (data.clarifications && data.clarifications.questions && data.clarifications.questions.length > 0 && data.clarifications.canProceed === false) {
      var q = data.clarifications.questions[0];
      store.set({ clarifyQuestionId: q.id });
      replaceLastProgress({ type: 'clarify', question: q.question });
      return;
    }

    replaceLastProgress({ type: 'results', data: data });

    if (originalQueryForHistory) {
      recordHistory(originalQueryForHistory);
    }
  }

  function recordHistory(queryText) {
    var id = 'h-' + Date.now();
    var label = queryText.length > 60 ? queryText.slice(0, 57) + '…' : queryText;
    store.set(function (s) {
      var searches = [{ id: id, label: label, timestamp: Date.now() }].concat(s.searches);
      Capucine.state.persistHistory(searches);
      return { searches: searches, activeSearchId: id };
    });
  }

  function retryLast() {
    var s = store.get();
    var lastUser = null;
    for (var i = s.conversation.length - 1; i >= 0; i--) {
      if (s.conversation[i].type === 'user') { lastUser = s.conversation[i].text; break; }
    }
    // Drop the trailing error turn, then resubmit — never silently mutates the original query.
    store.set(function (state) {
      var conv = state.conversation.slice();
      if (conv.length && conv[conv.length - 1].type === 'error') conv.pop();
      return { conversation: conv };
    });
    if (lastUser) submitQuery(lastUser);
  }

  function onMicClick() {
    // Honest state: no real STT provider is wired to the browser in this
    // session (see backend voice-providers.ts — mocks only, no UI capture
    // pipeline yet). Never fakes listening/recording.
    pushTurn({ type: 'text', text: i18n.t('voice.notConfigured') });
  }

  // ---- Footer: real server config status (never hidden, never fabricated) ----
  function loadConfigStatus() {
    Capucine.api.health().then(function (res) {
      if (!res.ok) { configStatusEl.textContent = i18n.t('error.serverStatus'); return; }
      var data = res.body;
      var ai = data.capabilities && data.capabilities.aiProviders;
      var web = data.capabilities && data.capabilities.webSearch;
      var parts = [];
      if (ai) {
        parts.push(ai.status === 'real'
          ? i18n.t('config.aiReal', { providers: ai.configured.join(', ') })
          : i18n.t('config.aiMock'));
      }
      if (web) {
        var adapters = web.adapters || [];
        var isNoop = adapters.length === 0 || (adapters.length === 1 && adapters[0] === 'noop');
        parts.push(isNoop
          ? i18n.t('config.webNotConfigured')
          : i18n.t('config.webConfigured', { adapter: adapters.join(', ') }));
      }
      configStatusEl.textContent = parts.join(' · ');
    }).catch(function () {
      configStatusEl.textContent = i18n.t('error.serverStatus');
    });
  }

  // ---- Sidebar toggle (mobile) ----
  sidebarToggleBtn.addEventListener('click', function () {
    store.set(function (s) { return { sidebarOpen: !s.sidebarOpen }; });
  });
  sidebarToggleBtn.setAttribute('aria-label', i18n.t('nav.toggleSidebar'));

  // ---- Subscribe + first render ----
  store.subscribe(renderAll);
  renderAll();
  loadConfigStatus();
})();
