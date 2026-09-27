/**
 * La charte est vérifiée, pas seulement affirmée : chaque couleur de TEXTE
 * atteint WCAG AA (4,5:1) sur le fond et sur les cartes ; l'or de marque
 * n'est jamais utilisé comme texte sur fond clair.
 */
import { theme } from './theme';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const c = theme.color;
const AA = 4.5;

describe('charte « Le Prisme » — contrastes mesurés', () => {
  it.each([
    ['text', c.text], ['textMuted', c.textMuted], ['textFaint', c.textFaint],
    ['goldInk', c.goldInk], ['known', c.known], ['unknown', c.unknown], ['danger', c.danger],
    ['accent', c.accent],
  ])('%s ≥ 4,5:1 sur le fond ET sur les cartes', (_name, fg) => {
    expect(contrast(fg, c.background)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fg, c.surface)).toBeGreaterThanOrEqual(AA);
  });

  it('texte des boutons principaux (crème sur marine) ≥ 7:1', () => {
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(7);
  });

  it('états sur leur fond teinté ≥ 4,5:1', () => {
    expect(contrast(c.known, c.knownSoft)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.unknown, c.unknownSoft)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.danger, c.dangerSoft)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.goldInk, c.goldSoft)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.accentInk, c.accentSoft)).toBeGreaterThanOrEqual(AA);
  });

  it('l’or de marque est lisible sur marine, et PAS sur fond clair (d’où goldInk)', () => {
    expect(contrast(c.gold, c.brandSurface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.goldLight, c.brandSurface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.gold, c.background)).toBeLessThan(3);
  });

  it('« inconnu » ne se confond pas avec l’or de marque', () => {
    expect(c.unknown).not.toBe(c.goldInk);
    expect(c.unknown).not.toBe(c.gold);
  });
});
