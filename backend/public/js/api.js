/**
 * Capucine — single API client.
 *
 * Wraps the REAL existing backend contract (POST /search, POST /clarify,
 * GET /health) — no new route, no /api/search-v2, no duplicate client.
 * Same origin as the page (server.ts serves this frontend from the same
 * Express process as the API), so no CORS/base-URL configuration needed —
 * and definitely no API key here: every key stays server-side (server.ts).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.api = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = '';

  function request(path, options) {
    return fetch(BASE + path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  /** @param {{query:string, requestId?:string, userId?:string, criteria?:object[], language?:string}} params */
  function search(params) {
    return request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  /** @param {{sessionId:string, questionId:string, answer:string}} params */
  function clarify(params) {
    return request('/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  function health() {
    return request('/health', { method: 'GET' });
  }

  return { search: search, clarify: clarify, health: health };
});
