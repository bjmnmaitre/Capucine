/**
 * Capucine — Product/Offer grouping.
 *
 * The API returns a flat list of ranked offers (each carrying a
 * `productId`) — this module groups them client-side into "one product,
 * several offers" for display, exactly matching the backend's own
 * Product/Offer distinction (domain/types.ts) without requiring any
 * backend change: the data needed (productId) is already in the response.
 *
 * Pure logic, no DOM — testable directly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.productGrouping = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @param {Array<{productId:string, rank:number}>} results
   * @returns {Array<{productId:string, offers: object[]}>} groups, in the
   *   order their best-ranked offer first appeared (ranking order preserved
   *   — grouping never re-sorts by anything the backend didn't already decide).
   */
  function groupByProduct(results) {
    var order = [];
    var byProduct = {};
    (results || []).forEach(function (r) {
      var pid = r.productId || r.offerId; // fallback: never drop an offer for lacking a productId
      if (!byProduct[pid]) {
        byProduct[pid] = [];
        order.push(pid);
      }
      byProduct[pid].push(r);
    });
    return order.map(function (pid) {
      return { productId: pid, offers: byProduct[pid] };
    });
  }

  return { groupByProduct: groupByProduct };
});
