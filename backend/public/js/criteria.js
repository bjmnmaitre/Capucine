/**
 * Capucine — criteria display grouping.
 *
 * Pure logic, no DOM. Respects the backend's exact SATISFIED / VIOLATED /
 * UNKNOWN semantics (domain/admissibility.ts) — this module NEVER
 * reinterprets them:
 *   - UNKNOWN means "not verifiable", never rendered as "non conforme".
 *   - VIOLATED means the criterion was checked and genuinely not met.
 *   - SATISFIED means it was checked and met.
 * The status string comes straight from the API (server.ts's
 * `criteria[].status`) — this module only groups/sorts for display.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.criteria = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {Array<{id:string,name:string,level:string,requiredOrForbidden:boolean,status:'satisfied'|'unknown'|'violated'}>} criteria
   * @returns {{satisfied: object[], violated: object[], unknown: object[]}}
   */
  function group(criteria) {
    var result = { satisfied: [], violated: [], unknown: [] };
    (criteria || []).forEach(function (c) {
      if (c.status === 'satisfied') result.satisfied.push(c);
      else if (c.status === 'violated') result.violated.push(c);
      else result.unknown.push(c);
    });
    return result;
  }

  /** Only the criteria the user actually constrained the search with
   *  (required/forbidden) — soft preferences are excluded from "Vos critères". */
  function hardOnly(criteria) {
    return (criteria || []).filter(function (c) { return c.requiredOrForbidden; });
  }

  return { group: group, hardOnly: hardOnly };
});
