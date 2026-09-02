/**
 * criterionId : ce qui compte pour l'utilisateur — ré-ajouter la même
 * préférence la met à jour (id stable) au lieu de créer un doublon, et le
 * backend ne reçoit jamais un id vide (qu'il rejette).
 */
import {
  AVAILABILITY_PREFERENCE_CRITERION_ID, availabilityPreferenceCriterion, availabilityPreferenceOf,
  criterionId, isMerchantExclusion, MERCHANT_EXCLUSION_ID_PREFIX,
  merchantExclusionCriterion, merchantExclusionId, merchantNameOf,
  RANKING_PREFERENCE_CRITERION_ID, rankingPreferenceCriterion, rankingPreferenceOf,
} from './profile';

describe('criterionId', () => {
  it('slugifie un nom lisible', () => {
    expect(criterionId('Livraison en France')).toBe('livraison-en-france');
    expect(criterionId('  Éco  responsable  ')).toBe('co-responsable'); // accents retirés, reste ascii
  });

  it('est stable : même nom (casse/espaces) → même id', () => {
    expect(criterionId('Livraison RAPIDE')).toBe(criterionId('  livraison rapide '));
  });

  it('ne renvoie jamais une chaîne vide', () => {
    for (const n of ['€€€', '✓✓', '  ...  ', '—']) {
      const id = criterionId(n);
      expect(id.length).toBeGreaterThan(0);
      expect(id.startsWith('pref-')).toBe(true);
    }
  });

  it('le repli par hash reste déterministe', () => {
    expect(criterionId('€€€')).toBe(criterionId('€€€'));
    expect(criterionId('€€€')).not.toBe(criterionId('✓✓'));
  });
});

/**
 * Exclusions de marchand : le corps envoyé au backend doit suivre EXACTEMENT
 * la convention que le backend reconnaît (id préfixé, level forbidden,
 * parameters.merchantName), l'id doit être stable (ré-ajouter = mettre à
 * jour, pas dupliquer), et supprimer doit viser le même id.
 */
describe('exclusions de marchand', () => {
  it('merchantExclusionCriterion : corps conforme à la convention backend', () => {
    const body = merchantExclusionCriterion('  Amazon  ');
    expect(body.id).toBe(`${MERCHANT_EXCLUSION_ID_PREFIX}amazon`);
    expect(body.level).toBe('forbidden');
    expect(body.parameters).toEqual({ merchantName: 'Amazon' });
    expect(body.name).toBe('Ne pas acheter chez Amazon');
  });

  it('merchantExclusionId : stable, casse/espaces ignorés, jamais vide', () => {
    expect(merchantExclusionId('Amazon')).toBe(merchantExclusionId('  amazon '));
    expect(merchantExclusionId('Back Market')).toBe(`${MERCHANT_EXCLUSION_ID_PREFIX}back-market`);
    expect(merchantExclusionId('€€€').length).toBeGreaterThan(MERCHANT_EXCLUSION_ID_PREFIX.length);
  });

  it('isMerchantExclusion : reconnaît seulement forbidden + id préfixé', () => {
    expect(isMerchantExclusion({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}fnac`, level: 'forbidden' })).toBe(true);
    expect(isMerchantExclusion({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}fnac`, level: 'preference' })).toBe(false);
    expect(isMerchantExclusion({ id: 'livraison-en-france', level: 'forbidden' })).toBe(false);
  });

  it('merchantNameOf : parameters d\'abord, sinon le slug de l\'id', () => {
    expect(merchantNameOf({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}x`, level: 'forbidden', parameters: { merchantName: 'Rakuten' } }))
      .toBe('Rakuten');
    expect(merchantNameOf({ id: `${MERCHANT_EXCLUSION_ID_PREFIX}back-market`, level: 'forbidden' }))
      .toBe('back market');
    expect(merchantNameOf({ id: 'price', level: 'required' })).toBeNull();
  });
});

describe('préférence de tri permanente', () => {
  it('rankingPreferenceCriterion : corps conforme, id fixe (donc remplace, ne duplique pas)', () => {
    const body = rankingPreferenceCriterion('PRICE_LOWEST');
    expect(body.id).toBe(RANKING_PREFERENCE_CRITERION_ID);
    expect(body.level).toBe('preference');
    expect(body.parameters).toEqual({ rankingPreference: 'PRICE_LOWEST' });
  });

  it('rankingPreferenceOf : lit la valeur ou null', () => {
    expect(rankingPreferenceOf([
      { id: RANKING_PREFERENCE_CRITERION_ID, parameters: { rankingPreference: 'PRICE_LOWEST' } },
    ])).toBe('PRICE_LOWEST');
    expect(rankingPreferenceOf([{ id: 'price', parameters: { maxBudget: 400 } }])).toBeNull();
    expect(rankingPreferenceOf([])).toBeNull();
  });
});

/**
 * Préférence « privilégier la disponibilité immédiate » : axe indépendant du
 * tri, corps conforme à la convention backend (domain/profile.ts), id fixe
 * (ré-activer ne duplique pas), et un flag absent/malformé compte comme OFF.
 */
describe('préférence de disponibilité permanente', () => {
  it('availabilityPreferenceCriterion : corps conforme, id fixe', () => {
    const body = availabilityPreferenceCriterion();
    expect(body.id).toBe(AVAILABILITY_PREFERENCE_CRITERION_ID);
    expect(body.level).toBe('preference');
    expect(body.parameters).toEqual({ prioritizeAvailability: true });
  });

  it('availabilityPreferenceOf : true seulement sur le flag exact', () => {
    expect(availabilityPreferenceOf([
      { id: AVAILABILITY_PREFERENCE_CRITERION_ID, parameters: { prioritizeAvailability: true } },
    ])).toBe(true);
    expect(availabilityPreferenceOf([
      { id: AVAILABILITY_PREFERENCE_CRITERION_ID, parameters: { prioritizeAvailability: 'yes' } },
    ])).toBe(false);
    expect(availabilityPreferenceOf([
      { id: AVAILABILITY_PREFERENCE_CRITERION_ID, parameters: null },
    ])).toBe(false);
    expect(availabilityPreferenceOf([{ id: 'price' }])).toBe(false);
    expect(availabilityPreferenceOf([])).toBe(false);
  });

  it('les deux axes se composent sans collision d\'id', () => {
    const criteria = [
      rankingPreferenceCriterion('PRICE_LOWEST'),
      availabilityPreferenceCriterion(),
    ];
    expect(rankingPreferenceOf(criteria)).toBe('PRICE_LOWEST');
    expect(availabilityPreferenceOf(criteria)).toBe(true);
    expect(criteria[0].id).not.toBe(criteria[1].id);
  });
});
