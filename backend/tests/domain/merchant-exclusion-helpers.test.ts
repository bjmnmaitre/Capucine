/**
 * Helpers purs qui lisent les exclusions de marchand d'un profil.
 * Ce qui compte : ne reconnaître QUE les critères bien formés (forbidden +
 * id conventionnel), retrouver le nom même sans parameters, dédoublonner et
 * mettre en minuscules.
 */
import {
  MERCHANT_EXCLUSION_ID_PREFIX,
  isMerchantExclusionCriterion,
  merchantNameOfExclusion,
  merchantExclusionsFromProfile,
} from '../../src/domain/profile';
import { createEmptyProfile } from '../../src/application/profile-store';
import type { PreferenceCriterion, UserProfile } from '../../src/domain/types';

const excl = (over: Partial<PreferenceCriterion> = {}): PreferenceCriterion => ({
  id: `${MERCHANT_EXCLUSION_ID_PREFIX}amazon`,
  name: 'Ne pas acheter chez Amazon',
  level: 'forbidden',
  parameters: { merchantName: 'Amazon' },
  ...over,
});

const profileWith = (criteria: PreferenceCriterion[]): UserProfile => {
  const p = createEmptyProfile('u');
  p.preferences.criteria = criteria;
  return p;
};

describe('isMerchantExclusionCriterion', () => {
  it('vrai seulement pour forbidden + id conventionnel', () => {
    expect(isMerchantExclusionCriterion(excl())).toBe(true);
    expect(isMerchantExclusionCriterion(excl({ level: 'important' }))).toBe(false);
    expect(isMerchantExclusionCriterion(excl({ id: 'price' }))).toBe(false);
  });
});

describe('merchantNameOfExclusion', () => {
  it('prend parameters.merchantName en priorité', () => {
    expect(merchantNameOfExclusion(excl({ parameters: { merchantName: 'Rakuten' } }))).toBe('Rakuten');
  });

  it('retombe sur le slug de l\'id si parameters absent', () => {
    expect(merchantNameOfExclusion(excl({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}back-market`, parameters: undefined })))
      .toBe('back market');
  });

  it('null si ce n\'est pas une exclusion', () => {
    expect(merchantNameOfExclusion(excl({ level: 'preference' }))).toBeNull();
  });
});

describe('merchantExclusionsFromProfile', () => {
  it('liste, minuscule, dédoublonnée', () => {
    expect(merchantExclusionsFromProfile(profileWith([
      excl({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}amazon`, parameters: { merchantName: 'Amazon' } }),
      excl({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}amazon-fr`, parameters: { merchantName: 'AMAZON' } }),
      { id: 'price', name: 'Prix', level: 'required' },
    ]))).toEqual(['amazon']);
  });

  it('vide quand le profil n\'exclut rien', () => {
    expect(merchantExclusionsFromProfile(createEmptyProfile('u'))).toEqual([]);
  });
});
