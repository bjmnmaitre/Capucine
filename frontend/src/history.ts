/**
 * CAPUCINE — historique local des recherches
 *
 * Persistance sur l'appareil, via AsyncStorage (inclus dans Expo Go). Cet
 * historique est PRIVÉ au téléphone : il n'est jamais envoyé au backend et ne
 * sert qu'à re-proposer à l'utilisateur ce qu'il a déjà cherché.
 *
 * Règles :
 *  - toute lecture/écriture est encapsulée : un stockage indisponible (mode
 *    privé, quota, première ouverture) ne doit jamais faire planter un écran,
 *    seulement rendre l'historique vide ;
 *  - on ne stocke que ce que l'utilisateur a réellement tapé, plus le nombre
 *    de résultats obtenus et l'instant — aucune donnée d'offre, aucun prix ;
 *  - une même requête (à la casse/espaces près) n'apparaît qu'une fois, la
 *    plus récente en tête ;
 *  - la liste est bornée, pour ne pas grossir indéfiniment.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'capucine.searchHistory.v1';
const MAX_ENTRIES = 20;

export interface SearchHistoryEntry {
  /** Exactement ce que l'utilisateur a saisi (déjà trimé). */
  query: string;
  /** Nombre d'offres renvoyées par cette recherche. */
  resultCount: number;
  /** Epoch ms de la recherche. */
  at: number;
}

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "à l'instant", "il y a 3 min", "hier", "il y a 4 j" — repère court pour
 *  l'historique, jamais une date/heure brute. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}

/** Fusionne une nouvelle entrée : dédoublonnée, la plus récente en tête, bornée. */
export function mergeEntry(
  existing: SearchHistoryEntry[],
  entry: SearchHistoryEntry
): SearchHistoryEntry[] {
  const key = normalize(entry.query);
  const withoutDuplicate = existing.filter((e) => normalize(e.query) !== key);
  return [entry, ...withoutDuplicate].slice(0, MAX_ENTRIES);
}

/** Parse défensif : tout contenu illisible ou non conforme redevient []. */
export function parseHistory(raw: string | null): SearchHistoryEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is SearchHistoryEntry =>
      typeof e === 'object' && e !== null &&
      typeof (e as SearchHistoryEntry).query === 'string' &&
      (e as SearchHistoryEntry).query.trim().length > 0 &&
      typeof (e as SearchHistoryEntry).resultCount === 'number' &&
      typeof (e as SearchHistoryEntry).at === 'number'
  ).slice(0, MAX_ENTRIES);
}

export async function loadHistory(): Promise<SearchHistoryEntry[]> {
  try {
    return parseHistory(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export async function recordSearch(query: string, resultCount: number): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return;
  try {
    const current = parseHistory(await AsyncStorage.getItem(STORAGE_KEY));
    const next = mergeEntry(current, { query: trimmed, resultCount, at: Date.now() });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Un historique non écrit n'est pas une erreur visible par l'utilisateur.
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
}
