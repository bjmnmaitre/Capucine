import Constants from 'expo-constants';
import {
  ApiError, PreferenceLevel, PrepareCartResponse, ProfileResponse, SearchResponse,
} from './types';
import {
  AVAILABILITY_PREFERENCE_CRITERION_ID, availabilityPreferenceCriterion,
  merchantExclusionCriterion, merchantExclusionId,
  RANKING_PREFERENCE_CRITERION_ID, rankingPreferenceCriterion,
} from './profile';

/**
 * Resolving the backend address.
 *
 * Expo Go runs on a PHONE, so `localhost` points at the phone, not at the dev
 * machine. Expo already knows the machine's LAN address (it is how the bundle
 * itself is served), so we reuse that host and swap in the API port. An
 * explicit EXPO_PUBLIC_API_URL always wins, for tunnels or a deployed backend.
 */
export const DEFAULT_API_PORT = 3001;

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

/**
 * Pure backend base-URL resolution. `explicit` (EXPO_PUBLIC_API_URL) always
 * wins; otherwise the LAN host from Expo + the API port; `localhost` only as a
 * last resort — on a real device Expo always reports a host URI, so reaching
 * that branch means a misconfiguration, and the health check will then surface
 * `http://localhost:3001` as the address it tried (a legible signal).
 */
export function apiBaseUrlFrom(
  hostUri: string | undefined | null,
  explicit?: string | undefined | null
): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/+$/, '');
  }
  const host = hostFromExpoHostUri(hostUri);
  if (host) return `http://${host}:${DEFAULT_API_PORT}`;
  return `http://localhost:${DEFAULT_API_PORT}`;
}

function resolveBaseUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  return apiBaseUrlFrom(hostUri, process.env.EXPO_PUBLIC_API_URL);
}

export const API_BASE_URL = resolveBaseUrl();

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Unreachable backend, DNS failure, timeout, phone off Wi-Fi. We say so
    // plainly instead of rendering an empty result list, which would read as
    // "no offers exist" — a claim we have no basis for.
    throw new ApiError(
      'network',
      "Capucine n'a pas pu joindre son service.",
      `Adresse essayée : ${API_BASE_URL}${path}`
    );
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    if (!res.ok) return { reachable: false };
    const body = (await res.json()) as {
      capabilities?: { aiProviders?: { status?: string }; webSearch?: { status?: string } };
    };
    return {
      reachable: true,
      aiStatus: body.capabilities?.aiProviders?.status,
      webSearch: body.capabilities?.webSearch?.status,
    };
  } catch {
    return { reachable: false };
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
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network', "Capucine n'a pas pu joindre son service.", `${API_BASE_URL}${path}`);
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
