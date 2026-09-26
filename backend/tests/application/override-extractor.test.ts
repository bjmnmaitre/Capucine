/**
 * MEGAPROMPT #6 — extractOverridesFromAnswer()
 * A clarification answer suspends a PERMANENT profile preference for the
 * current conversation only, and only when the user says so explicitly.
 */
import { extractOverridesFromAnswer } from '../../src/application/override-extractor';
import type { PreferenceCriterion } from '../../src/domain/types';

const amazon: PreferenceCriterion = {
  id: 'merchant-exclude-amazon', name: 'Ne pas acheter chez Amazon', level: 'forbidden',
  parameters: { merchantName: 'Amazon' },
} as PreferenceCriterion;
const freeShipping: PreferenceCriterion = {
  id: 'free-shipping', name: 'Livraison gratuite', level: 'very_important', parameters: {},
} as PreferenceCriterion;
const profile = [amazon, freeShipping];

const ids = (answer: string, crit: PreferenceCriterion[] = profile) =>
  extractOverridesFromAnswer(answer, crit).overrides.map((o) => o.criterionId);

describe('extractOverridesFromAnswer — exception temporaire à une préférence permanente', () => {
  it('« exceptionnellement Amazon ça va » → désactive l’exclusion Amazon, avec le vrai id', () => {
    const { overrides } = extractOverridesFromAnswer('exceptionnellement Amazon ça va', profile);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      criterionId: 'merchant-exclude-amazon',
      temporaryLevel: 'disabled',
      originalLevel: 'forbidden',
      source: 'explicit_user',
    });
  });

  it('« aujourd’hui peu importe la livraison » → désactive « Livraison gratuite » (accents / apostrophes tolérés)', () => {
    expect(ids("aujourd'hui peu importe la livraison")).toEqual(['free-shipping']);
    expect(ids('aujourd’hui peu importe la livraison')).toEqual(['free-shipping']);
  });

  it('English: "Amazon is fine just this once"', () => {
    expect(ids('Amazon is fine just this once')).toEqual(['merchant-exclude-amazon']);
  });

  it('sans signal temporel : aucune exception (ambigu, on ne devine pas)', () => {
    expect(ids('Amazon ça va')).toEqual([]);
  });

  it('formulation permanente (« toujours ») : aucune exception — le profil se modifie par l’utilisateur, pas ici', () => {
    const r = extractOverridesFromAnswer('Amazon ça va toujours', profile);
    expect(r.overrides).toEqual([]);
    expect(r.extractionLog.join(' ')).toMatch(/Permanent/);
  });

  it('signal temporel sans relâchement : aucune exception (« aujourd’hui je veux du neuf »)', () => {
    expect(ids("aujourd'hui je veux du neuf")).toEqual([]);
  });

  it('ne cible jamais un critère absent du profil (pas d’id synthétique)', () => {
    expect(ids('exceptionnellement Fnac ça va')).toEqual([]);
    expect(ids('exceptionnellement Amazon ça va', [])).toEqual([]);
  });

  it('mot entier : « amazonie » ne réautorise pas Amazon', () => {
    expect(ids('exceptionnellement un livre sur l’amazonie ça va')).toEqual([]);
  });

  it('ne modifie jamais les critères du profil reçus', () => {
    const copy = JSON.parse(JSON.stringify(profile));
    extractOverridesFromAnswer('exceptionnellement Amazon ça va', profile);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(copy);
  });
});
