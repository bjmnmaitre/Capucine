#!/usr/bin/env node
/**
 * Capucine — dev launcher for tunnelled sessions (public Wi-Fi, client isolation).
 *
 * The problem it solves: on a guest / public network the phone cannot reach
 * the Mac's LAN address, so the Expo tunnel is used to serve the bundle. But
 * the Expo tunnel host (`*.exp.direct`) forwards ONLY Metro's port — the
 * backend on :3001 stays unreachable, and its host must never be guessed from
 * the Expo tunnel domain (see src/api.ts).
 *
 * This script opens a SECOND, dedicated tunnel to the backend with ngrok,
 * discovers its public URL from ngrok's local agent API, and starts Expo with
 * EXPO_PUBLIC_API_URL pointing at it. Both ends are then reachable from
 * anywhere, with no dependency on a LAN address.
 *
 *   cd frontend
 *   npm run start:tunnel            # backend tunnel + `expo start --tunnel`
 *   npm run start:tunnel -- --lan   # backend tunnel + `expo start --lan`
 *
 * Requirements: the backend running on :3001, and `ngrok` on PATH, configured
 * with an authtoken (`ngrok config add-authtoken <token>` — one time).
 */
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const BACKEND_PORT = 3001;
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';
const passthroughArgs = process.argv.slice(2);
const expoArgs = passthroughArgs.length > 0 ? passthroughArgs : ['--tunnel'];

const log = (m) => console.log(`\x1b[36m[start-tunnel]\x1b[0m ${m}`);
const warn = (m) => console.warn(`\x1b[33m[start-tunnel]\x1b[0m ${m}`);
const die = (m) => { console.error(`\x1b[31m[start-tunnel]\x1b[0m ${m}`); process.exit(1); };

async function fetchJson(url, timeoutMs = 2000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The https public URL of a tunnel that already forwards to our backend port. */
async function existingBackendTunnel() {
  const data = await fetchJson(NGROK_API);
  if (!data?.tunnels) return null;
  const hit = data.tunnels.find(
    (tn) => tn.proto === 'https' && String(tn.config?.addr ?? '').endsWith(`:${BACKEND_PORT}`)
  );
  return hit?.public_url ?? null;
}

async function waitForBackendTunnel(attempts = 25) {
  for (let i = 0; i < attempts; i++) {
    const url = await existingBackendTunnel();
    if (url) return url;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function main() {
  // 1. Backend must be up — the tunnel would just forward to a closed port.
  const health = await fetchJson(`http://localhost:${BACKEND_PORT}/health`, 1500);
  if (!health) {
    die(`Le backend ne répond pas sur :${BACKEND_PORT}. Lancez-le d'abord :  cd ../backend && npm run dev`);
  }
  log(`backend OK sur :${BACKEND_PORT} (web search: ${health.capabilities?.webSearch?.status ?? '?'})`);

  // 2. Reuse an existing ngrok tunnel to :3001 if one is already open.
  let backendUrl = await existingBackendTunnel();
  let ngrok = null;

  if (backendUrl) {
    log(`tunnel backend déjà ouvert : ${backendUrl}`);
  } else {
    if (spawnSync('ngrok', ['--version'], { stdio: 'ignore' }).status !== 0) {
      die('ngrok introuvable sur le PATH. Installez-le puis :  ngrok config add-authtoken <token>');
    }
    log('ouverture du tunnel backend (ngrok http 3001)…');
    ngrok = spawn('ngrok', ['http', String(BACKEND_PORT), '--log=stdout'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    ngrok.on('exit', (code) => {
      if (code && code !== 0) warn(`ngrok s'est arrêté (code ${code}).`);
    });
    backendUrl = await waitForBackendTunnel();
    if (!backendUrl) {
      if (ngrok) ngrok.kill('SIGTERM');
      die('Impossible de récupérer l\'URL du tunnel ngrok (agent API 4040 muette). Un ngrok gratuit n\'autorise qu\'une session à la fois.');
    }
    log(`tunnel backend : ${backendUrl}`);
  }

  // 3. Verify the backend answers THROUGH the tunnel before starting Expo.
  const viaTunnel = await fetchJson(`${backendUrl}/health`, 8000);
  if (!viaTunnel) {
    warn('le backend ne répond pas encore à travers le tunnel — on démarre quand même, réessayez depuis l\'app si besoin.');
  } else {
    log('backend joignable à travers le tunnel ✓');
  }

  // 4. Start Expo with the backend URL injected. EXPO_PUBLIC_* is inlined into
  //    the bundle by Metro, so the app resolves `source: 'explicit'`.
  log(`expo start ${expoArgs.join(' ')}   (EXPO_PUBLIC_API_URL=${backendUrl})`);
  const expo = spawn('npx', ['expo', 'start', ...expoArgs], {
    stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_API_URL: backendUrl },
  });

  const shutdown = () => {
    expo.kill('SIGTERM');
    if (ngrok) ngrok.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  expo.on('exit', (code) => {
    if (ngrok) ngrok.kill('SIGTERM');
    process.exit(code ?? 0);
  });
}

main().catch((e) => die(e?.message ?? String(e)));
