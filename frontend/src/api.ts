import Constants from 'expo-constants';
import {
  ApiError, PreferenceLevel, PrepareCartResponse, ProfileResponse, SearchResponse,
} from './types';
import {
  AVAILABILITY_PREFERENCE_CRITERION_ID, availabilityPreferenceCriterion,
  merchantExclusionCriterion, merchantExclusionId,
  RANKING_PREFERENCE_CRITERION_ID, rankingPreferenceCriterion,
} from './profile';

/** Dev-only logging gate. Metro sets NODE_ENV; `__DEV__` isn't visible to the
 *  test tsconfig, so this expresses the same thing portably. Silent under jest. */
const IS_DEV = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

/**
 * Resolving the backend address.
 *
 * Expo Go runs on a PHONE, so `localhost` points at the phone, not at the dev
 * machine. When the bundle is served over the LAN, Expo's host URI is the
 * machine's LAN address — we reuse that host and swap in the API port.
 *
 * But when the bundle is served through the **Expo tunnel** (`*.exp.direct`,
 * ngrok, Cloudflare…), that host is a public relay that ONLY forwards Metro's
 * port. Deriving `http://<tunnel-host>:3001` from it points the app at a port
 * that relay never exposes — the mistake this module now refuses to make.
 *
 * On a tunnelled session the backend needs its own public address, passed
 * explicitly via EXPO_PUBLIC_API_URL (see `scripts/start-tunnel.mjs`, which
 * opens an ngrok tunnel to :3001 and injects its URL). An explicit value
 * always wins.
 */
export const DEFAULT_API_PORT = 3001;

/**
 * Host suffixes that identify a dev tunnel rather than a directly reachable
 * host. The backend is NEVER derived from one of these — a tunnel forwards a
 * single port, not the whole machine.
 */
const TUNNEL_HOST_SUFFIXES = [
  '.exp.direct', '.exp.host',
  '.ngrok.io', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev',
  '.trycloudflare.com', '.loca.lt', '.lhr.life', '.serveo.net',
];

/**
 * Is `host` something the phone can reach directly on the LAN (an IP, a
 * `.local` mDNS name, a bare hostname)? False for the public tunnel relays,
 * whose host must not be reused as the backend host.
 */
export function isLanReachableHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  if (h.length === 0) return false;
  return !TUNNEL_HOST_SUFFIXES.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix));
}

/**
 * Bare host out of an Expo host URI. On a physical device over LAN this is
 * `192.168.x.y:8081`; it can also arrive scheme-prefixed (`exp://…`,
 * `http://…`) or path-suffixed depending on the Expo channel. We want only the
 * host — no scheme, no port, no path. Returns `null` when nothing usable is
 * left. Pure; unit-tested — this is THE path a phone uses to find the backend.
 */
export function hostFromExpoHostUri(hostUri: string | undefined | null): string | null {
  if (!hostUri || typeof hostUri !== 'string') return null;
  let s = hostUri.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // drop scheme:// (exp://, http://, …)
  s = s.split('/')[0];                            // drop /path or ?query
  s = s.split(':')[0];                            // drop :port
  s = s.trim();
  return s.length > 0 ? s : null;
}

/** How the backend address was resolved — for dev logging and for the UI to
 *  tell "backend is down" apart from "backend address was never configured". */
export type ApiUrlSource = 'explicit' | 'lan' | 'unconfigured';

export interface ResolvedApi {
  baseUrl: string;
  source: ApiUrlSource;
}

/**
 * Pure backend base-URL resolution. `explicit` (EXPO_PUBLIC_API_URL) always
 * wins; otherwise a *LAN-reachable* host from Expo + the API port. A tunnel
 * host is NOT usable — it yields `source: 'unconfigured'` and a localhost
 * placeholder that will fail fast on a device, so the UI shows a
 * configuration-needed state rather than silently hammering a dead port.
 */
export function resolveApiFrom(
  hostUri: string | undefined | null,
  explicit?: string | undefined | null
): ResolvedApi {
  if (explicit && explicit.trim().length > 0) {
    return { baseUrl: explicit.trim().replace(/\/+$/, ''), source: 'explicit' };
  }
  const host = hostFromExpoHostUri(hostUri);
  if (host && isLanReachableHost(host)) {
    return { baseUrl: `http://${host}:${DEFAULT_API_PORT}`, source: 'lan' };
  }
  return { baseUrl: `http://localhost:${DEFAULT_API_PORT}`, source: 'unconfigured' };
}

/** Back-compat string-only resolver (kept for existing callers and tests). */
export function apiBaseUrlFrom(
  hostUri: string | undefined | null,
  explicit?: string | undefined | null
): string {
  return resolveApiFrom(hostUri, explicit).baseUrl;
}

function resolveApi(): ResolvedApi {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  return resolveApiFrom(hostUri, process.env.EXPO_PUBLIC_API_URL);
}

const RESOLVED_API = resolveApi();

/** Base URL used for every request. Never shown in the UI. */
export const API_BASE_URL = RESOLVED_API.baseUrl;
/** `false` when no backend address could be resolved (tunnelled session with
 *  no EXPO_PUBLIC_API_URL). The UI uses this to explain what to do. */
export const API_CONFIGURED = RESOLVED_API.source !== 'unconfigured';
export const API_URL_SOURCE: ApiUrlSource = RESOLVED_API.source;

// Developer-only signal. The USER never sees an address; a developer running
// Metro sees exactly what the app resolved and why.
if (IS_DEV) {
  // eslint-disable-next-line no-console
  console.log(
    `[Capucine] backend = ${API_BASE_URL} (${API_URL_SOURCE})`
    + (API_URL_SOURCE === 'unconfigured'
      ? ' — tunnelled session: set EXPO_PUBLIC_API_URL or use `npm run start:tunnel`'
      : '')
  );
}

/**
 * Headers sent with every request. `ngrok-skip-browser-warning` is inert for a
 * direct/LAN backend and, when the backend is behind an ngrok free tunnel,
 * skips the HTML interstitial ngrok would otherwise return to a browser-like
 * client — keeping the response pure JSON.
 */
const BASE_HEADERS: Record<string, string> = {
  'ngrok-skip-browser-warning': 'true',
};

/**
 * The user-facing message when a request cannot reach the backend. NO address,
 * NO port, NO "check the server is started" — those are developer instructions.
 * Wording depends only on whether an address was ever resolved.
 */
export function networkErrorMessage(): string {
  return API_CONFIGURED
    ? 'Capucine ne parvient pas à se connecter. Vérifiez votre connexion, puis réessayez.'
    : 'Capucine n’est pas encore configurée pour se connecter à son service sur cet appareil.';
}

/**
 * Une recherche réelle enchaîne plusieurs requêtes au moteur PUIS la lecture
 * de plusieurs pages marchandes. Mesuré : médiane ~4 s, mais un site lent
 * pousse au-delà de 10 s. Le délai doit laisser aboutir ce qui aboutit —
 * abandonner trop tôt afficherait « service injoignable » alors que le
 * service travaille.
 */
const REQUEST_TIMEOUT_MS = 45000;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Unreachable backend, DNS failure, timeout, phone off Wi-Fi. We say so
    // plainly instead of rendering an empty result list, which would read as
    // "no offers exist" — a claim we have no basis for. The address tried is
    // a developer detail (logged), never surfaced to the user.
    if (IS_DEV) console.warn(`[Capucine] ${path} unreachable at ${API_BASE_URL}`);
    throw new ApiError('network', networkErrorMessage(), undefined);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError('server', 'Réponse illisible du service.', raw.slice(0, 200));
    }
  }

  if (!response.ok) {
    const payload = parsed as { error?: string; message?: string } | null;
    throw new ApiError(
      response.status >= 500 ? 'server' : 'bad_request',
      payload?.message ?? `Le service a répondu ${response.status}.`,
      payload?.error
    );
  }

  return parsed as T;
}

export function search(query: string, userId: string): Promise<SearchResponse> {
  return postJson<SearchResponse>('/search', { query, userId });
}

/** Ce que /health nous apprend, réduit à ce dont l'UI a besoin. */
export interface HealthStatus {
  reachable: boolean;
  /** `false` when no backend address is configured (tunnelled session). The UI
   *  then shows a "not set up yet" state, not a "service is down" one. */
  configured: boolean;
  /** 'mock' = interprétation heuristique ; 'real' = un fournisseur IA est actif. */
  aiStatus?: 'mock' | 'real' | string;
  /** 'configured' = au moins une vraie source Web ; 'no_real_source' = catalogue local seul. */
  webSearch?: 'configured' | 'no_real_source' | string;
}

/**
 * Ping rapide du backend. Séparé de `search` : il doit répondre vite ou pas
 * du tout, pour afficher un état de connexion sans faire attendre 45 s. Ne
 * lève jamais — un backend injoignable est une réponse (`reachable: false`),
 * pas une exception à gérer partout.
 */
export async function checkHealth(timeoutMs = 4000): Promise<HealthStatus> {
  // No address was ever resolved — don't bother the network, and let the UI
  // show a configuration state instead of a transient "unreachable" flash.
  if (!API_CONFIGURED) return { reachable: false, configured: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      headers: BASE_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return { reachable: false, configured: true };
    const body = (await res.json()) as {
      capabilities?: { aiProviders?: { status?: string }; webSearch?: { status?: string } };
    };
    return {
      reachable: true,
      configured: true,
      aiStatus: body.capabilities?.aiProviders?.status,
      webSearch: body.capabilities?.webSearch?.status,
    };
  } catch {
    return { reachable: false, configured: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Continue a search conversationally. `answer` is free text — "le moins cher",
 * "livraison rapide", "sans Amazon", "élargis à 400 €", "montre-moi les 3
 * meilleures". The backend re-runs the REAL pipeline with the refinement
 * merged into the session (never a fabricated delta) and returns the same
 * shape as /search, with the order and `rankingPreference` updated.
 *
 * `FOLLOWUP_QUESTION_ID` is the sentinel that tells /clarify this is a
 * free-form refinement of the current search, not an answer to a specific
 * pending question. It is always required by the backend, never inferred.
 */
export const FOLLOWUP_QUESTION_ID = '__followup__';

export function refine(sessionId: string, answer: string): Promise<SearchResponse> {
  return postJson<SearchResponse>('/clarify', {
    sessionId,
    questionId: FOLLOWUP_QUESTION_ID,
    answer,
  });
}

export function prepareCart(
  sessionId: string,
  offerId: string,
  quantity = 1
): Promise<PrepareCartResponse> {
  return postJson<PrepareCartResponse>('/prepare-cart', { sessionId, offerId, quantity });
}

async function request<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body === undefined
        ? BASE_HEADERS
        : { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (IS_DEV) console.warn(`[Capucine] ${method} ${path} unreachable at ${API_BASE_URL}`);
    throw new ApiError('network', networkErrorMessage(), undefined);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  // Analysé sous garde, comme dans postJson : une réponse illisible (page
  // d'erreur d'un proxy, HTML d'un portail Wi-Fi) faisait remonter une
  // SyntaxError brute jusqu'à l'écran, au lieu d'un message compréhensible.
  let parsed: unknown = null;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError('server', 'Réponse illisible du service.', raw.slice(0, 200));
    }
  }
  if (!response.ok) {
    const payload = parsed as { message?: string; error?: string } | null;
    throw new ApiError(
      response.status >= 500 ? 'server' : 'bad_request',
      payload?.message ?? `Le service a répondu ${response.status}.`,
      payload?.error
    );
  }
  return parsed as T;
}

/** Permanent preferences. Never mixed with the current search's requirements. */
export function loadProfile(userId: string): Promise<ProfileResponse> {
  return request<ProfileResponse>('GET', `/profile/${encodeURIComponent(userId)}`);
}

export function saveCriterion(
  userId: string,
  criterion: { id: string; name: string; level: PreferenceLevel; parameters?: Record<string, unknown> }
): Promise<unknown> {
  return request('PUT', `/profile/${encodeURIComponent(userId)}/criterion`, criterion);
}

export function deleteCriterion(userId: string, criterionId: string): Promise<unknown> {
  return request(
    'DELETE',
    `/profile/${encodeURIComponent(userId)}/criterion/${encodeURIComponent(criterionId)}`
  );
}

/**
 * Persistent "never buy from this merchant" preference. Stored as a normal
 * criterion following the backend's convention (see src/profile.ts) — it
 * survives restarts and is applied from the very first search after.
 */
export function excludeMerchant(userId: string, merchantName: string): Promise<unknown> {
  return saveCriterion(userId, merchantExclusionCriterion(merchantName));
}

export function unexcludeMerchant(userId: string, merchantName: string): Promise<unknown> {
  return deleteCriterion(userId, merchantExclusionId(merchantName));
}

/** Persistent default ordering — applied from the very first search after,
 *  still overridable by an explicit session "meilleure correspondance". */
export function setRankingPreference(userId: string, pref: string): Promise<unknown> {
  return saveCriterion(userId, rankingPreferenceCriterion(pref));
}

export function clearRankingPreference(userId: string): Promise<unknown> {
  return deleteCriterion(userId, RANKING_PREFERENCE_CRITERION_ID);
}

/**
 * Persistent "prioritise immediate availability" preference — an axis distinct
 * from the ordering above (they compose). Applied from the very first search
 * after, survives every conversational follow-up (it lives in the session's
 * profile snapshot on the backend).
 */
export function setAvailabilityPreference(userId: string): Promise<unknown> {
  return saveCriterion(userId, availabilityPreferenceCriterion());
}

export function clearAvailabilityPreference(userId: string): Promise<unknown> {
  return deleteCriterion(userId, AVAILABILITY_PREFERENCE_CRITERION_ID);
}
