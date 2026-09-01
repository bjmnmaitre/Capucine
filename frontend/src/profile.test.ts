/**
 * criterionId : ce qui compte pour l'utilisateur — ré-ajouter la même
 * préférence la met à jour (id stable) au lieu de créer un doublon, et le
 * backend ne reçoit jamais un id vide (qu'il rejette).
 */
import { criterionId } from './profile';

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
