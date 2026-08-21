/**
 * Capucine — Sidebar rendering.
 *
 * Renders: brand, "Nouvelle recherche" button, time-grouped local search
 * history, settings/profile footer links. History is LOCAL ONLY (this
 * browser tab's localStorage) — the backend has no history-sync endpoint
 * today, so this never claims cross-device persistence (see state.js).
 *
 * Pure DOM-building functions — no direct API calls, no i18n string baked
 * in outside of Capucine.i18n.t().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.renderSidebar = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function groupByRecency(searches) {
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startOfYesterday = startOfToday - 86400000;
    var sevenDaysAgo = startOfToday - 7 * 86400000;

    var groups = { today: [], yesterday: [], previous7Days: [], older: [] };
    searches.forEach(function (s) {
      if (s.timestamp >= startOfToday) groups.today.push(s);
      else if (s.timestamp >= startOfYesterday) groups.yesterday.push(s);
      else if (s.timestamp >= sevenDaysAgo) groups.previous7Days.push(s);
      else groups.older.push(s);
    });
    return groups;
  }

  /**
   * @param {{searches: Array<{id:string, label:string, timestamp:number}>, activeId: ?string}} data
   * @param {{onNewSearch: Function, onSelectSearch: Function, onOpenSettings: Function}} handlers
   */
  function render(data, handlers) {
    var t = Capucine.i18n.t;
    var el = document.createElement('div');

    var brand = document.createElement('div');
    brand.className = 'sidebar-brand';
    brand.innerHTML = '<span class="mark" aria-hidden="true">C</span><span>' + escapeHtml(t('app.name')) + '</span>';
    el.appendChild(brand);

    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'new-search-btn';
    newBtn.textContent = t('nav.newSearch');
    newBtn.addEventListener('click', handlers.onNewSearch);
    el.appendChild(newBtn);

    var nav = document.createElement('nav');
    nav.setAttribute('aria-label', t('nav.history'));

    var groups = groupByRecency(data.searches || []);
    var groupDefs = [
      { key: 'today', labelKey: 'history.today' },
      { key: 'yesterday', labelKey: 'history.yesterday' },
      { key: 'previous7Days', labelKey: 'history.previous7Days' },
      { key: 'older', labelKey: 'history.older' },
    ];

    var anyRendered = false;
    groupDefs.forEach(function (def) {
      var items = groups[def.key];
      if (!items.length) return;
      anyRendered = true;
      var groupEl = document.createElement('div');
      groupEl.className = 'history-group';
      var label = document.createElement('div');
      label.className = 'history-group-label';
      label.textContent = t(def.labelKey);
      groupEl.appendChild(label);

      var list = document.createElement('ul');
      list.className = 'history-list';
      items.forEach(function (s) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'history-item' + (s.id === data.activeId ? ' active' : '');
        btn.textContent = s.label;
        btn.title = s.label;
        btn.addEventListener('click', function () { handlers.onSelectSearch(s.id); });
        li.appendChild(btn);
        list.appendChild(li);
      });
      groupEl.appendChild(list);
      nav.appendChild(groupEl);
    });

    if (!anyRendered) {
      var empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = t('history.empty');
      nav.appendChild(empty);
    }

    el.appendChild(nav);

    var footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    var settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'sidebar-footer-btn';
    settingsBtn.textContent = t('nav.settings');
    settingsBtn.addEventListener('click', handlers.onOpenSettings);
    footer.appendChild(settingsBtn);
    el.appendChild(footer);

    return el;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { render: render, groupByRecency: groupByRecency };
});
