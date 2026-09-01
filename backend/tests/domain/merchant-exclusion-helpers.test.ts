/**
 * Helpers purs qui lisent les exclusions de marchand d'un profil.
 * Ce qui compte : ne reconnaître QUE les critères bien formés (forbidden +
 * id conventionnel), retrouver le nom même sans parameters, dédoublonner et
 * mettre en minuscules.
 */
import {
  MERCHANT_EXCLUSION_ID_PREFIX,
  RANKING_PREFERENCE_CRITERION_ID,
  AVAILABILITY_PREFERENCE_CRITERION_ID,
  isMerchantExclusionCriterion,
  merchantNameOfExclusion,
  merchantExclusionsFromProfile,
  rankingPreferenceFromProfile,
  availabilityPreferenceFromProfile,
} from '../../src/domain/profile';
import { isRankingPreference } from '../../src/application/ranking-preference';
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

describe('rankingPreferenceFromProfile / isRankingPreference', () => {
  it('lit la préférence stockée', () => {
    expect(rankingPreferenceFromProfile(profileWith([
      { id: RANKING_PREFERENCE_CRITERION_ID, name: '…', level: 'preference',
        parameters: { rankingPreference: 'PRICE_LOWEST' } },
    ]))).toBe('PRICE_LOWEST');
  });

  it('null quand absente', () => {
    expect(rankingPreferenceFromProfile(createEmptyProfile('u'))).toBeNull();
  });

  it('isRankingPreference rejette ce qui n\'est pas dans l\'union', () => {
    expect(isRankingPreference('PRICE_LOWEST')).toBe(true);
    expect(isRankingPreference('BEST_MATCH')).toBe(true);
    expect(isRankingPreference('CHEAPEST_EVER')).toBe(false);
    expect(isRankingPreference(42)).toBe(false);
    expect(isRankingPreference(null)).toBe(false);
  });
});

describe('availabilityPreferenceFromProfile', () => {
  const withAvail = (params: unknown) => profileWith([
    { id: AVAILABILITY_PREFERENCE_CRITERION_ID, name: '…', level: 'preference',
      parameters: params as Record<string, unknown> },
  ]);

  it('true seulement si prioritizeAvailability === true', () => {
    expect(availabilityPreferenceFromProfile(withAvail({ prioritizeAvailability: true }))).toBe(true);
  });

  it('false pour toute autre valeur, jamais d\'erreur', () => {
    expect(availabilityPreferenceFromProfile(withAvail({ prioritizeAvailability: false }))).toBe(false);
    expect(availabilityPreferenceFromProfile(withAvail({ prioritizeAvailability: 'yes' }))).toBe(false);
    expect(availabilityPreferenceFromProfile(withAvail({}))).toBe(false);
    expect(availabilityPreferenceFromProfile(createEmptyProfile('u'))).toBe(false);
  });
});
