#!/usr/bin/env node
/**
 * CAPUCINE — diagnostic de préparation au premier appel Web réel.
 *
 * Répond à trois questions, sans JAMAIS révéler la moindre clé :
 *   1. une clé de recherche est-elle configurée ?
 *   2. le fichier .env est-il réellement lu ?
 *   3. le backend est-il joignable, et que déclare-t-il ?
 *
 * Usage :  node --env-file-if-exists=.env scripts/diagnose.mjs [url]
 * Défaut :  http://localhost:3001
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '');

const state = (name) => {
  const value = process.env[name];
  // On ne rapporte QUE la présence et la longueur — jamais la valeur.
  return value && value.trim().length > 0
    ? `configurée (${value.trim().length} caractères)`
    : 'absente';
};

console.log('── Configuration lue par ce processus');
console.log(`   BRAVE_API_KEY  : ${state('BRAVE_API_KEY')}`);
console.log(`   SERPER_API_KEY : ${state('SERPER_API_KEY')}`);
console.log(`   CORS_ORIGIN    : ${process.env.CORS_ORIGIN ? 'configurée' : 'absente (normal pour Expo Go natif)'}`);

const hasKey = Boolean(process.env.BRAVE_API_KEY?.trim() || process.env.SERPER_API_KEY?.trim());
if (!hasKey) {
  console.log('\n   → Aucune clé lue. Si vous en avez placé une dans backend/.env,');
  console.log('     vérifiez de lancer via « npm run dev » : `npx tsx` seul NE lit PAS .env.');
}

console.log(`\n── Backend sur ${baseUrl}`);
try {
  const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    console.log(`   ✗ /health a répondu ${res.status}`);
    process.exit(1);
  }
  const health = await res.json();
  const web = health.capabilities?.webSearch ?? {};
  console.log(`   ✓ joignable`);
  console.log(`   recherche web  : ${web.status}`);
  console.log(`   fournisseurs   : ${(web.providers ?? []).join(', ') || 'aucun'}`);
  console.log(`   IA             : ${health.capabilities?.aiProviders?.status ?? 'inconnu'}`);

  if (web.status === 'configured') {
    console.log('\n   → Prêt pour une recherche réelle. Lancez le smoke test :');
    console.log(`      node scripts/smoke-test.mjs "${baseUrl}"`);
  } else {
    console.log('\n   → Le serveur ne dispose d\'aucune source Web : les résultats');
    console.log('     proviendront du catalogue local uniquement.');
  }
} catch (err) {
  console.log(`   ✗ injoignable : ${err instanceof Error ? err.message : String(err)}`);
  console.log('     Démarrez le backend avec « npm run dev » depuis backend/.');
  process.exit(1);
}
