/**
 * criterionId : ce qui compte pour l'utilisateur — ré-ajouter la même
 * préférence la met à jour (id stable) au lieu de créer un doublon, et le
 * backend ne reçoit jamais un id vide (qu'il rejette).
 */
import {
  criterionId, isMerchantExclusion, MERCHANT_EXCLUSION_ID_PREFIX,
  merchantExclusionCriterion, merchantExclusionId, merchantNameOf,
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
