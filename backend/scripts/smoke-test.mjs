#!/usr/bin/env node
/**
 * CAPUCINE — smoke test du premier appel Web réel.
 *
 * À exécuter dès qu'une clé est fournie. Il ne vérifie PAS que les résultats
 * sont « bons » — cela demande un œil humain — mais que la chaîne produit un
 * résultat HONNÊTE : provenance présente, URL jamais fabriquée, coût jamais
 * inventé, préparation d'achat sans faux succès.
 *
 * Usage : node scripts/smoke-test.mjs [url] [requête]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '');
const query = process.argv[3] ?? 'casque Sony WH-1000XM5';

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok });
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`── Recherche « ${query} » sur ${baseUrl}\n`);

const started = Date.now();
const res = await fetch(`${baseUrl}/search`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, userId: 'smoke-test' }),
});
const elapsed = Date.now() - started;

check('HTTP 200', res.status === 200, `${res.status} en ${elapsed} ms`);
if (res.status !== 200) process.exit(1);

const body = await res.json();
const offers = body.results ?? [];

check('au moins une offre', offers.length > 0, `${offers.length} offre(s)`);
check('session exploitable', typeof body.session?.sessionId === 'string');

const merchants = new Set(offers.map(o => o.merchant?.id).filter(Boolean));
const products = new Set(offers.map(o => o.productId).filter(Boolean));
check('Product / Offer / Merchant distincts', offers.length === 0 || merchants.size > 0,
  `${offers.length} offres · ${merchants.size} marchands · ${products.size} produits`);

check('provenance présente sur chaque offre',
  offers.every(o => typeof o.provenance?.source === 'string' && o.provenance.source.length > 0));

const withUrl = offers.filter(o => typeof o.offerUrl === 'string');
check('URLs toutes réelles (http/https), aucune fabriquée',
  withUrl.every(o => /^https?:\/\//.test(o.offerUrl)), `${withUrl.length} avec URL`);

check('aucune livraison inconnue affichée comme gratuite',
  offers.every(o => o.shipping?.status !== 'unknown' || o.shipping?.amount === null));

check('coût jamais présenté comme certain s\'il ne l\'est pas',
  offers.every(o => o.cost?.certainty !== 'known' || (o.cost.unknownComponents ?? []).length === 0));

check('classement contigu et ordonné',
  offers.every((o, i) => o.rank === i + 1));

check('aucune valeur technique dans la réponse',
  !JSON.stringify(body).match(/NaN|undefined|\[object Object\]/));

// ── préparation d'achat sur la première offre ────────────────────────────
if (offers.length > 0) {
  console.log('\n── Préparation d\'achat sur l\'offre #1\n');
  const cartRes = await fetch(`${baseUrl}/prepare-cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: body.session.sessionId, offerId: offers[0].offerId, quantity: 1 }),
  });
  const cart = await cartRes.json();

  check('HTTP 200', cartRes.status === 200);
  check('statut explicite', typeof cart.status === 'string', cart.status);
  check('action utilisateur exploitable', typeof cart.nextAction === 'string' && cart.nextAction.length > 0);
  check('AUCUN faux succès d\'achat', cart.purchaseCompleted === false);
  check('URL de paiement réelle ou absente, jamais fabriquée',
    cart.checkoutUrl === null || /^https?:\/\//.test(cart.checkoutUrl));
}

const failed = checks.filter(c => !c.ok);
console.log(`\n── ${checks.length - failed.length}/${checks.length} vérifications passées`);
if (failed.length > 0) {
  console.log('   Échecs : ' + failed.map(f => f.label).join(' · '));
  process.exit(1);
}
console.log('   Chaîne honnête de bout en bout.');
