/**
 * Capucine — results rendering: product/offer grouping, criteria breakdown
 * (SATISFIED/VIOLATED/UNKNOWN — exact backend semantics, never reinterpreted),
 * search coverage, empty-result state with real recovery actions.
 *
 * Every piece of data rendered here comes directly from the API response —
 * nothing is fabricated (no invented price, URL, seller, or coverage stat).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.renderResults = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** @param {object} data full /search or /clarify JSON response */
  function render(data) {
    var t = Capucine.i18n.t;
    var pluralize = Capucine.i18n.pluralize;
    var locale = data.language || Capucine.i18n.getLocale();
    var results = data.results || [];

    var el = document.createElement('div');
    el.className = 'msg msg-capucine';

    var container = document.createElement('div');
    container.style.width = '100%';

    if (results.length === 0) {
      container.appendChild(renderEmpty(data));
      el.appendChild(container);
      return el;
    }

    var summary = document.createElement('p');
    summary.className = 'results-summary';
    summary.textContent = data.summary && data.summary.resultSummary
      ? data.summary.resultSummary
      : pluralize(results.length, 'results.count', {}, locale);
    container.appendChild(summary);

    var list = document.createElement('ul');
    list.className = 'results-list';

    var groups = Capucine.productGrouping.groupByProduct(results);
    groups.forEach(function (group) {
      group.offers.forEach(function (r) {
        list.appendChild(renderResultCard(r, locale));
      });
    });

    container.appendChild(list);

    var coverageBlock = renderCoverageBlock(data.coverage, locale);
    if (coverageBlock) container.appendChild(coverageBlock);

    el.appendChild(container);
    return el;
  }

  function renderResultCard(r, locale) {
    var t = Capucine.i18n.t;
    var li = document.createElement('li');
    li.className = 'result-card' + (r.rank === 1 ? ' rank-1' : '');

    var badge = document.createElement('span');
    badge.className = 'result-rank-badge';
    badge.textContent = r.rank === 1 ? t('results.bestMatch') : t('results.rank', { rank: r.rank });
    li.appendChild(badge);

    var topRow = document.createElement('div');
    topRow.className = 'result-top-row';
    var merchant = document.createElement('span');
    merchant.className = 'result-merchant';
    merchant.textContent = (r.merchant && r.merchant.name) || '—';
    topRow.appendChild(merchant);

    var priceEl = document.createElement('span');
    if (r.price && r.price.amount !== null && r.price.amount !== undefined) {
      priceEl.className = 'result-price';
      priceEl.textContent = Capucine.format.price(r.price.amount, r.price.currency, locale);
    } else {
      priceEl.className = 'result-price unknown';
      priceEl.textContent = t('results.priceUnknown');
    }
    topRow.appendChild(priceEl);
    li.appendChild(topRow);

    if (r.matchQuality) {
      var matchBadge = document.createElement('span');
      matchBadge.className = 'match-badge' + (r.score < 50 ? ' low' : '');
      matchBadge.textContent = r.matchQuality;
      li.appendChild(matchBadge);
    }

    if (r.explanation) {
      var explanation = document.createElement('p');
      explanation.className = 'result-explanation';
      explanation.textContent = r.explanation;
      li.appendChild(explanation);
    }

    if (Array.isArray(r.criteria) && r.criteria.length > 0) {
      li.appendChild(renderCriteriaBlock(r.criteria));
    }

    var footer = document.createElement('div');
    footer.className = 'result-footer';

    var prov = document.createElement('span');
    prov.className = 'result-provenance';
    prov.textContent = t('results.source', { source: (r.provenance && r.provenance.source) || '—' });
    footer.appendChild(prov);

    if (r.offerUrl) {
      var link = document.createElement('a');
      link.className = 'open-offer-link';
      link.href = r.offerUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = t('results.viewOffer') + ' ↗';
      footer.appendChild(link);
    } else {
      var noLink = document.createElement('span');
      noLink.className = 'open-offer-link disabled';
      noLink.title = t('results.noUrlHint');
      noLink.textContent = t('results.noUrl');
      footer.appendChild(noLink);
    }

    li.appendChild(footer);
    return li;
  }

  /** SATISFIED / VIOLATED / UNKNOWN — exact backend semantics, never a color-only signal. */
  function renderCriteriaBlock(criteria) {
    var t = Capucine.i18n.t;
    var grouped = Capucine.criteria.group(Capucine.criteria.hardOnly(criteria));

    var block = document.createElement('div');
    block.className = 'criteria-block';

    var list = document.createElement('ul');
    list.className = 'criteria-list';

    grouped.satisfied.forEach(function (c) { list.appendChild(criterionChip(c, 'satisfied', '✓')); });
    grouped.violated.forEach(function (c) { list.appendChild(criterionChip(c, 'violated', '✕')); });
    grouped.unknown.forEach(function (c) { list.appendChild(criterionChip(c, 'unknown', '?')); });

    block.appendChild(list);
    return block;
  }

  function criterionChip(criterion, statusClass, mark) {
    var t = Capucine.i18n.t;
    var li = document.createElement('li');
    li.className = 'criteria-item ' + statusClass;
    var label = t('criteria.' + statusClass);
    li.title = criterion.name + ' — ' + label;
    li.innerHTML = '<span class="mark" aria-hidden="true">' + mark + '</span><span>' + escapeHtml(criterion.name) + '</span>';
    li.setAttribute('aria-label', criterion.name + ': ' + label);
    return li;
  }

  /** Real SearchCoverage only — see coverage.js. Never rendered when absent. */
  function renderCoverageBlock(coverage, locale) {
    var t = Capucine.i18n.t;
    var pluralize = Capucine.i18n.pluralize;
    if (!Capucine.coverage.hasCoverage(coverage)) return null;

    var box = document.createElement('div');
    box.className = 'coverage-box';

    var title = document.createElement('p');
    title.className = 'coverage-title';
    title.textContent = t('coverage.title');
    box.appendChild(title);

    var list = document.createElement('ul');
    list.className = 'coverage-lines';
    Capucine.coverage.summaryLines(coverage).forEach(function (line) {
      var li = document.createElement('li');
      li.textContent = pluralize(line.count, line.pluralKey, {}, locale);
      list.appendChild(li);
    });

    var saturationKey = Capucine.coverage.saturationKey(coverage);
    if (saturationKey) {
      var li2 = document.createElement('li');
      li2.textContent = t(saturationKey);
      list.appendChild(li2);
    }

    var elapsed = Capucine.coverage.elapsedSeconds(coverage);
    if (elapsed !== null) {
      var li3 = document.createElement('li');
      li3.textContent = t('coverage.elapsed', { seconds: elapsed });
      list.appendChild(li3);
    }

    box.appendChild(list);
    return box;
  }

  function renderEmpty(data) {
    var t = Capucine.i18n.t;
    var box = document.createElement('div');
    box.className = 'no-results-box';

    var h3 = document.createElement('h3');
    h3.textContent = t('empty.title');
    box.appendChild(h3);

    var p = document.createElement('p');
    p.textContent = (data.noResultsDiagnosis && data.noResultsDiagnosis.message) || t('empty.explainGeneric');
    box.appendChild(p);

    // Recovery actions come from the API's noResultsDiagnosis.recoveryOptions
    // when present — mapped to i18n labels by type (matching the real
    // RecoveryOption['type'] values from no-results-analyzer.ts), never
    // fabricated when absent. `opt.description` (already localized by the
    // backend in data.language) is the fallback for any future type.
    var actionKeyByType = {
      relax_budget: 'empty.actionIncreaseBudget',
      expand_search_terms: 'empty.actionBroaden',
      widen_category: 'empty.actionBroaden',
      expand_geography: 'empty.actionInternational',
      remove_criterion: 'empty.actionRemoveCriterion',
      lower_preference_level: 'empty.actionLowerLevel',
      accept_refurbished: 'empty.actionAcceptRefurbished',
    };
    var recoveryOptions = (data.noResultsDiagnosis && data.noResultsDiagnosis.recoveryOptions) || [];
    if (recoveryOptions.length > 0) {
      var actions = document.createElement('div');
      actions.className = 'no-results-actions';
      recoveryOptions.forEach(function (opt) {
        // 'new-search' shares its type (expand_search_terms) with 'expand-search'
        // but means something distinct (rephrase vs broaden) — id wins when present.
        var key = opt.id === 'new-search' ? 'empty.actionRephrase' : actionKeyByType[opt.type];
        var chip = document.createElement('span');
        chip.className = 'action-chip';
        chip.title = opt.impact || '';
        chip.textContent = key ? t(key) : opt.description;
        actions.appendChild(chip);
      });
      box.appendChild(actions);
    }

    var coverageBlock = renderCoverageBlock(data.coverage, data.language);
    if (coverageBlock) box.appendChild(coverageBlock);

    return box;
  }

  return { render: render, renderResultCard: renderResultCard, renderCriteriaBlock: renderCriteriaBlock, renderCoverageBlock: renderCoverageBlock };
});
