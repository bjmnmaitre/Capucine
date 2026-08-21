/**
 * Capucine — SearchCoverage display helper.
 *
 * Pure logic, no DOM. `coverage` is exactly what the API returned
 * (server.ts: result.discovery.statistics.coverage — see
 * application/search-coverage.ts on the backend) or `null` when the
 * discovery strategy that ran didn't compute one (e.g. the local catalog
 * path). This module NEVER invents a coverage summary when the field is
 * null/absent — callers must check hasCoverage() first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.coverage = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hasCoverage(coverage) {
    return !!coverage && typeof coverage === 'object';
  }

  /**
   * Builds the list of i18n (key, params) pairs to render for a real
   * coverage object — callers pass each through t()/pluralize(). Only
   * includes lines for fields that are actually present and meaningful;
   * never pads with a fabricated "0 domains" line if the field is missing.
   */
  function summaryLines(coverage) {
    if (!hasCoverage(coverage)) return [];
    var lines = [];
    if (typeof coverage.queriesExecuted === 'number') {
      lines.push({ pluralKey: 'coverage.queries', count: coverage.queriesExecuted });
    }
    if (typeof coverage.sourcesAttempted === 'number') {
      lines.push({ pluralKey: 'coverage.sources', count: coverage.sourcesAttempted });
    }
    if (typeof coverage.uniqueDomains === 'number') {
      lines.push({ pluralKey: 'coverage.domains', count: coverage.uniqueDomains });
    }
    if (typeof coverage.sourcesFailed === 'number' && coverage.sourcesFailed > 0) {
      lines.push({ pluralKey: 'coverage.sourcesFailed', count: coverage.sourcesFailed });
    }
    return lines;
  }

  function saturationKey(coverage) {
    if (!hasCoverage(coverage)) return null;
    return coverage.saturated ? 'coverage.saturatedYes' : 'coverage.saturatedNo';
  }

  function elapsedSeconds(coverage) {
    if (!hasCoverage(coverage) || typeof coverage.elapsedMs !== 'number') return null;
    return Math.round(coverage.elapsedMs / 100) / 10;
  }

  return {
    hasCoverage: hasCoverage,
    summaryLines: summaryLines,
    saturationKey: saturationKey,
    elapsedSeconds: elapsedSeconds,
  };
});
