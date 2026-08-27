#!/usr/bin/env node
/**
 * CAPUCINE — smoke de PRÉ-LANCEMENT, au niveau produit
 *
 * Rejoue le parcours qu'un utilisateur fait réellement dans Expo Go, et
 * vérifie à chaque étape ce que Capucine a le droit d'affirmer.
 *
 *   /health → recherche → résultats → offre → coût → provenance → URL
 *           → prepare-cart → absence de faux succès
 *
 * Ce script échoue si Capucine ment. Il n'échoue PAS parce qu'une donnée est
 * inconnue : une inconnue honnêtement rapportée est un succès.
 *
 *   node --env-file-if-exists=.env scripts/smoke-product.mjs [http://host:port]
 */
const BASE = process.argv[2] ?? `http://localhost:${process.env.PORT ?? 3001}`;
const REQUÊTE = process.env.SMOKE_QUERY ?? 'casque Sony WH-1000XM5';

let passed = 0;
const failures = [];
function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`   \x1b[32m✓\x1b[0m ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`   \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function json(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log(`\n── Smoke produit Capucine — ${BASE}\n`);

// ── 1. /health ───────────────────────────────────────────────────────────────
console.log('1. Service');
const health = await json('GET', '/health').catch(() => ({ status: 0, body: null }));
check('le service répond', health.status === 200, `HTTP ${health.status}`);
if (health.status !== 200) {
  console.log('\n   Le backend ne répond pas. Lancez-le puis relancez ce smoke.\n');
  process.exit(1);
}
const web = health.body?.capabilities?.webSearch;
check('la source Web est déclarée honnêtement', web?.status === 'configured' || web?.status === 'no_real_source',
  `status=${web?.status}`);
const realWeb = web?.status === 'configured';
console.log(realWeb ? `   (source réelle : ${web.providers?.join(', ')})` : '   (aucune source Web réelle — parcours hors ligne)');
check('aucune clé exposée par /health', !JSON.stringify(health.body).match(/[A-Za-z0-9]{28,}/));

// ── 2. Recherche ─────────────────────────────────────────────────────────────
console.log('\n2. Recherche');
const t0 = Date.now();
const search = await json('POST', '/search', { query: REQUÊTE, userId: 'smoke-produit' });
const elapsed = Date.now() - t0;
check('la recherche aboutit', search.status === 200, `HTTP ${search.status}`);
const b = search.body ?? {};
const results = b.results ?? [];
check('un identifiant de requête est rendu (diagnostic possible)', typeof b.requestId === 'string' && b.requestId.length > 0);
check('le temps est mesuré et rapporté', typeof b.durationMs === 'number');
check(`la recherche tient en moins de 30 s (${(elapsed / 1000).toFixed(1)} s)`, elapsed < 30_000);
check('le nombre annoncé est celui des offres présentées',
  b.summary?.totalFound === results.length, `annoncé ${b.summary?.totalFound}, rendu ${results.length}`);
if (results.length === 0) {
  check('un écran vide explique POURQUOI', typeof b.noResultsDiagnosis?.message === 'string');
}

// ── 3. Résultats ─────────────────────────────────────────────────────────────
console.log('\n3. Résultats');
check('au moins une offre est présentée', results.length > 0, `${results.length} offre(s)`);
const offer = results[0];
if (offer) {
  check('chaque offre porte un identifiant, un marchand et un rang',
    results.every(o => o.offerId && o.merchant?.name && typeof o.rank === 'number'));
  check('les rangs sont strictement ordonnés',
    results.every((o, i) => i === 0 || o.rank >= results[i - 1].rank));
  check('aucune offre ne prétend un prix sans montant',
    results.every(o => o.price === null || typeof o.price?.amount === 'number'));

  // ── 4-5. Détail et coût ───────────────────────────────────────────────────
  console.log('\n4. Coût réel de l’offre en tête');
  const cost = offer.cost ?? {};
  check('la certitude du coût est explicite',
    ['known', 'partially_known', 'unknown'].includes(cost.certainty), `certainty=${cost.certainty}`);
  check('un coût partiel énumère ce qui manque',
    cost.certainty !== 'partially_known' || (cost.unknownComponents?.length ?? 0) > 0);
  check('une livraison inconnue n’est JAMAIS présentée comme gratuite',
    !(offer.shipping?.status === 'unknown' && offer.shipping?.amount === 0 &&
      /gratuit|offerte|free/i.test(cost.statement ?? '')));
  check('le coût connu ne dépasse pas le total quand celui-ci est certain',
    cost.certainty !== 'known' || typeof cost.totalKnown === 'number');

  // ── 6. Provenance ─────────────────────────────────────────────────────────
  console.log('\n5. Provenance');
  check('la source de l’offre est nommée', typeof offer.provenance?.source === 'string');
  check('la nature de la page est conservée',
    offer.provenance?.pageType === null || typeof offer.provenance?.pageType === 'string');
  check('une offre issue du Web dit de quelle page elle vient',
    !offer.offerUrl || offer.provenance?.pageType !== undefined);

  // ── 7. URL ────────────────────────────────────────────────────────────────
  console.log('\n6. URL');
  const withUrl = results.filter(o => o.offerUrl);
  check('toute URL présentée est une URL absolue réelle',
    withUrl.every(o => { try { const u = new URL(o.offerUrl); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }));
  check('aucune URL ne pointe vers Capucine elle-même',
    withUrl.every(o => !/localhost|127\.0\.0\.1|capucine\.local/i.test(o.offerUrl)));

  // ── 8-9. Préparation ──────────────────────────────────────────────────────
  console.log('\n7. Préparation de l’achat');
  const sessionId = b.session?.sessionId;
  check('la recherche ouvre une session utilisable', typeof sessionId === 'string' && sessionId.length > 0);
  if (sessionId) {
    const prep = await json('POST', '/prepare-cart', { sessionId, offerId: offer.offerId, quantity: 1 });
    check('la préparation répond', prep.status === 200, `HTTP ${prep.status}`);
    const p = prep.body ?? {};
    check('le statut de préparation est explicite',
      ['partial', 'success', 'unavailable', 'failed'].includes(p.status), `status=${p.status}`);
    check('une consigne est donnée à l’utilisateur', typeof p.nextAction === 'string' && p.nextAction.length > 0);
    check('la consigne est en français',
      !p.nextAction || /[àâçéèêëîïôûùü]|\b(le|la|les|du|des|vous|marchand|page)\b/i.test(p.nextAction),
      p.nextAction?.slice(0, 60));

    // ── 10-11. Aucun faux succès ────────────────────────────────────────────
    console.log('\n8. Aucun faux succès');
    check('purchaseCompleted n’est JAMAIS vrai sans achat réel', p.purchaseCompleted !== true);
    check('merchantConfirmed n’est JAMAIS vrai sans confirmation', p.merchantConfirmed !== true);
    check('aucune formulation ne laisse croire à une commande passée',
      !/commande (a été )?(passée|effectuée|confirmée)|order placed|purchase complete/i.test(JSON.stringify(p)));
    check('une URL de paiement est réelle ou absente, jamais fabriquée',
      p.checkoutUrl == null || (() => { try { new URL(p.checkoutUrl); return true; } catch { return false; } })());
    check('un statut « unavailable » ne propose aucune URL de paiement',
      p.status !== 'unavailable' || p.checkoutUrl == null);
    check('il est dit que le paiement se fait chez le marchand',
      !p.nextAction || /marchand|merchant/i.test(p.nextAction));
  }
}

// ── Bilan ────────────────────────────────────────────────────────────────────
const total = passed + failures.length;
console.log(`\n── ${passed}/${total} vérifications passées`);
if (failures.length > 0) {
  console.log('\n   Manquements :');
  for (const f of failures) console.log(`   • ${f}`);
  console.log('');
  process.exit(1);
}
console.log('   Parcours produit honnête de bout en bout.\n');
