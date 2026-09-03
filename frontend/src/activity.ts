/**
 * CAPUCINE — journal d'activité local
 *
 * Ce que Capucine a fait, tel que l'application l'a RÉELLEMENT observé. Rien
 * n'est inventé : chaque entrée correspond à une réponse concrète du backend
 * (une recherche aboutie, un affinage appliqué, des offres masquées par une
 * exclusion, une page marchand préparée).
 *
 * Persistance sur l'appareil via AsyncStorage — jamais envoyé au backend.
 * Mêmes règles que `history.ts` : lecture/écriture encapsulées (un stockage
 * indisponible rend un journal vide, ne plante rien), liste bornée, parse
 * défensif.
 *
 * NE JAMAIS ajouter ici un événement que l'application n'a pas directement
 * constaté — pas de « panier créé », pas d'« achat terminé ».
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'capucine.activity.v1';
const MAX_ENTRIES = 40;

export type ActivityEvent =
  | { id: string; type: 'search'; at: number; query: string; offerCount: number }
  | { id: string; type: 'refine'; at: number; query: string; answer: string }
  | { id: string; type: 'exclude'; at: number; query: string; merchants: string[]; hiddenCount: number }
  | {
      id: string; type: 'prepare'; at: number; query: string;
      merchant: string | null;
      /** Le statut EXACT renvoyé par /prepare-cart. 'partial' = page marchand
       *  prête (pas un panier créé). Jamais reformulé en « acheté ». */
      status: string;
    };

export type NewActivityEvent =
  | Omit<Extract<ActivityEvent, { type: 'search' }>, 'id' | 'at'>
  | Omit<Extract<ActivityEvent, { type: 'refine' }>, 'id' | 'at'>
  | Omit<Extract<ActivityEvent, { type: 'exclude' }>, 'id' | 'at'>
  | Omit<Extract<ActivityEvent, { type: 'prepare' }>, 'id' | 'at'>;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ajoute un événement en tête, borne la liste. Pur, testable. */
export function prependEvent(existing: ActivityEvent[], event: ActivityEvent): ActivityEvent[] {
  return [event, ...existing].slice(0, MAX_ENTRIES);
}

/** Un titre + une ligne de détail pour l'affichage. Aucune donnée inconnue
 *  n'est comblée : `merchant` absent devient « marchand non identifié ». */
export function describeEvent(e: ActivityEvent): { title: string; detail: string } {
  switch (e.type) {
    case 'search':
      return {
        title: 'Recherche terminée',
        detail: `« ${e.query} » — ${e.offerCount} offre${e.offerCount > 1 ? 's' : ''} analysée${e.offerCount > 1 ? 's' : ''}`,
      };
    case 'refine':
      return { title: 'Recherche affinée', detail: `« ${e.query} » — ${e.answer}` };
    case 'exclude': {
      const names = e.merchants.length > 0 ? e.merchants.join(', ') : 'un marchand';
      return {
        title: `Marchand${e.merchants.length > 1 ? 's' : ''} exclu${e.merchants.length > 1 ? 's' : ''}`,
        detail: `${names} — ${e.hiddenCount} offre${e.hiddenCount > 1 ? 's' : ''} masquée${e.hiddenCount > 1 ? 's' : ''}`,
      };
    }
    case 'prepare': {
      const m = e.merchant ?? 'marchand non identifié';
      const status = e.status === 'partial' ? 'page marchand prête'
        : e.status === 'success' ? 'panier préparé chez le marchand'
        : e.status === 'unavailable' ? 'achat non préparable'
        : e.status === 'failed' ? 'préparation échouée'
        : e.status;
      return { title: 'Préparation d’achat', detail: `${m} — ${status}` };
    }
  }
}

/** Parse défensif : tout contenu illisible ou non conforme redevient []. */
export function parseActivity(raw: string | null): ActivityEvent[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const types = new Set(['search', 'refine', 'exclude', 'prepare']);
  return parsed
    .filter((e): e is ActivityEvent =>
      typeof e === 'object' && e !== null
      && typeof (e as ActivityEvent).id === 'string'
      && typeof (e as ActivityEvent).at === 'number'
      && types.has((e as ActivityEvent).type)
      && typeof (e as { query?: unknown }).query === 'string')
    .slice(0, MAX_ENTRIES);
}

export async function loadActivity(): Promise<ActivityEvent[]> {
  try {
    return parseActivity(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export async function recordActivity(event: NewActivityEvent): Promise<void> {
  try {
    const current = parseActivity(await AsyncStorage.getItem(STORAGE_KEY));
    const full = { ...event, id: makeId(), at: Date.now() } as ActivityEvent;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prependEvent(current, full)));
  } catch {
    // Un journal non écrit n'est pas une erreur visible.
  }
}

export async function clearActivity(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
}
