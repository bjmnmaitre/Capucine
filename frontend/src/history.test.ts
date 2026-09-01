/**
 * Historique local : ce qui compte pour l'utilisateur est qu'une recherche
 * relancée ne se duplique pas, que la plus récente remonte, que la liste
 * reste bornée, et qu'un stockage corrompu redevienne simplement vide plutôt
 * que de faire planter l'écran d'accueil.
 */
// AsyncStorage n'existe qu'à l'exécution dans Expo Go. Sous Jest (Node), on
// utilise le mock officiel du paquet — les fonctions testées ici sont pures,
// mais l'import du module doit se résoudre.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import {
  mergeEntry, parseHistory, relativeTime, removeEntry, SearchHistoryEntry,
} from './history';

const entry = (query: string, at: number, resultCount = 3): SearchHistoryEntry =>
  ({ query, at, resultCount });

describe('mergeEntry — dédoublonnage, ordre récent, borne', () => {
  it('place la nouvelle entrée en tête', () => {
    const out = mergeEntry([entry('a', 1)], entry('b', 2));
    expect(out.map((e) => e.query)).toEqual(['b', 'a']);
  });

  it('une requête déjà présente est remontée, pas dupliquée', () => {
    const out = mergeEntry(
      [entry('casque sony', 1), entry('macbook', 2)],
      entry('casque sony', 3)
    );
    expect(out.map((e) => e.query)).toEqual(['casque sony', 'macbook']);
    expect(out[0].at).toBe(3);
  });

  it('la déduplication ignore casse et espaces', () => {
    const out = mergeEntry([entry('Casque   Sony', 1)], entry('casque sony', 2));
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe(2);
  });

  it('la liste ne dépasse jamais 20 entrées', () => {
    let acc: SearchHistoryEntry[] = [];
    for (let i = 0; i < 30; i++) acc = mergeEntry(acc, entry(`q${i}`, i));
    expect(acc).toHaveLength(20);
    expect(acc[0].query).toBe('q29');
  });
});

describe('removeEntry — suppression ciblée, casse/espaces ignorés', () => {
  it('retire l’entrée demandée et garde les autres', () => {
    const out = removeEntry([entry('a', 1), entry('b', 2), entry('c', 3)], 'b');
    expect(out.map((e) => e.query)).toEqual(['a', 'c']);
  });

  it('retire même avec une casse ou des espaces différents', () => {
    const out = removeEntry([entry('Casque  Sony', 1)], 'casque sony');
    expect(out).toEqual([]);
  });

  it('ne fait rien si la requête est absente', () => {
    const list = [entry('a', 1)];
    expect(removeEntry(list, 'zzz')).toEqual(list);
  });
});

describe('parseHistory — tout contenu douteux redevient []', () => {
  it.each([
    ['null', null],
    ['JSON invalide', '{not json'],
    ['pas un tableau', '{"query":"x"}'],
    ['entrées mal formées', '[{"query":""},{"foo":1},{"query":"ok","resultCount":"x","at":1}]'],
  ])('%s', (_label, raw) => {
    expect(parseHistory(raw as string | null)).toEqual([]);
  });

  it('garde les entrées conformes', () => {
    const raw = JSON.stringify([entry('valide', 10)]);
    expect(parseHistory(raw)).toEqual([entry('valide', 10)]);
  });
});

describe('relativeTime — repère court, jamais une date brute', () => {
  const now = 1_000_000_000_000;
  it.each([
    [now - 5_000, "à l'instant"],
    [now - 3 * 60_000, 'il y a 3 min'],
    [now - 2 * 3_600_000, 'il y a 2 h'],
    [now - 25 * 3_600_000, 'hier'],
    [now - 4 * 86_400_000, 'il y a 4 j'],
  ])('%i → %s', (at, expected) => {
    expect(relativeTime(at, now)).toBe(expected);
  });

  it('ne renvoie jamais un temps négatif', () => {
    expect(relativeTime(now + 10_000, now)).toBe("à l'instant");
  });
});
