/**
 * Journal d'activité : ce qui compte est qu'il reste borné, que le plus récent
 * remonte, qu'un contenu corrompu redevienne vide sans planter, et surtout que
 * la description d'un événement `prepare` de statut `partial` ne prétende
 * JAMAIS qu'un panier a été créé.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { ActivityEvent, describeEvent, parseActivity, prependEvent } from './activity';

const ev = (over: Partial<ActivityEvent> = {}): ActivityEvent =>
  ({ id: 'x', at: 1, type: 'search', query: 'q', offerCount: 3, ...over } as ActivityEvent);

describe('prependEvent — ordre récent, borne', () => {
  it('place le nouvel événement en tête', () => {
    const out = prependEvent([ev({ id: 'a' })], ev({ id: 'b' }));
    expect(out.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('borne la liste à 40', () => {
    let list: ActivityEvent[] = [];
    for (let i = 0; i < 60; i++) list = prependEvent(list, ev({ id: `e${i}` }));
    expect(list).toHaveLength(40);
    expect(list[0].id).toBe('e59');
  });
});

describe('describeEvent — honnête, aucune donnée inventée', () => {
  it('recherche', () => {
    expect(describeEvent(ev({ type: 'search', query: 'sony', offerCount: 12 }))).toEqual({
      title: 'Recherche terminée',
      detail: '« sony » — 12 offres analysées',
    });
  });

  it('affinage', () => {
    expect(describeEvent(ev({ type: 'refine', query: 'sony', answer: 'le moins cher' }))).toEqual({
      title: 'Recherche affinée',
      detail: '« sony » — le moins cher',
    });
  });

  it('exclusion de marchand', () => {
    const d = describeEvent(ev({
      type: 'exclude', query: 'sony', merchants: ['Amazon'], hiddenCount: 2,
    }));
    expect(d.title).toBe('Marchand exclu');
    expect(d.detail).toBe('Amazon — 2 offres masquées');
  });

  it('prepare `partial` = « page marchand prête », jamais « panier créé »', () => {
    const d = describeEvent(ev({
      type: 'prepare', query: 'sony', merchant: 'Fnac', status: 'partial',
    }));
    expect(d.detail).toBe('Fnac — page marchand prête');
    expect(d.detail).not.toMatch(/panier/i);
    expect(d.detail).not.toMatch(/achet/i);
  });

  it('prepare sans marchand identifié ne rend pas « undefined »', () => {
    const d = describeEvent(ev({
      type: 'prepare', query: 'sony', merchant: null, status: 'partial',
    }));
    expect(d.detail).toBe('marchand non identifié — page marchand prête');
  });

  it('prepare `success` peut dire « panier préparé » (le backend l\'a fait)', () => {
    const d = describeEvent(ev({
      type: 'prepare', query: 'sony', merchant: 'Fnac', status: 'success',
    }));
    expect(d.detail).toBe('Fnac — panier préparé chez le marchand');
  });
});

describe('parseActivity — un stockage corrompu redevient []', () => {
  it.each(['', 'null', '{}', '[oops', '"a string"'])('%s → []', (raw) => {
    expect(parseActivity(raw)).toEqual([]);
  });

  it('filtre les entrées non conformes', () => {
    const raw = JSON.stringify([
      { id: 'ok', at: 2, type: 'search', query: 'a', offerCount: 1 },
      { id: 'bad-type', at: 3, type: 'purchase', query: 'b' },
      { at: 4, type: 'search', query: 'no-id' },
      { id: 'no-query', at: 5, type: 'search' },
    ]);
    expect(parseActivity(raw).map((e) => e.id)).toEqual(['ok']);
  });
});
