/**
 * Ce que ces tests protègent : l'utilisateur ne doit jamais lire « NaN € »,
 * « undefined » ni « null » sur son écran. Ces trois fonctions sont le dernier
 * point de passage entre une valeur venue du backend et le texte affiché.
 */
import { displayText, formatMoney, formatScore } from './theme';

describe('formatMoney — un montant absent ne devient jamais un prix', () => {
  it('formate un montant réel', () => {
    expect(formatMoney(329, 'EUR')).toContain('329');
  });

  it('0 reste 0 : la gratuité est un fait, pas une absence', () => {
    expect(formatMoney(0, 'EUR')).toContain('0');
    expect(formatMoney(0, 'EUR')).not.toBe('inconnu');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('%s devient « inconnu », jamais un nombre affiché', (_label, value) => {
    expect(formatMoney(value as number | null | undefined, 'EUR')).toBe('inconnu');
  });

  it("ne rend jamais la chaîne 'NaN' — le piège d'Intl.NumberFormat", () => {
    expect(formatMoney(NaN, 'EUR')).not.toContain('NaN');
  });

  it('une devise absente ou invalide ne fait pas perdre le montant', () => {
    expect(formatMoney(42, null)).toContain('42');
    expect(formatMoney(42, 'PAS-UNE-DEVISE')).toContain('42');
  });

  it('devise vide → défaut euros (destination France)', () => {
    expect(formatMoney(42, null)).toMatch(/€/);
    expect(formatMoney(42, '')).toMatch(/€/);
  });

  it('devise explicitement « unknown » → montant conservé, devise signalée, jamais « 42 unknown » ni « € »', () => {
    const out = formatMoney(34.9, 'unknown');
    expect(out).toContain('34,90');
    expect(out).toContain('devise non précisée');
    expect(out).not.toContain('unknown');
    expect(out).not.toMatch(/€/);
  });

  it('code ISO à 3 lettres respecté (casse indifférente)', () => {
    expect(formatMoney(10, 'usd')).toMatch(/\$|USD/);
  });
});

describe('formatScore', () => {
  it('affiche un score réel', () => {
    expect(formatScore(67)).toBe('67 points');
  });

  it.each([null, undefined, NaN])('un score absent ne devient pas « NaN points »', (value) => {
    const out = formatScore(value as number | null | undefined);
    expect(out).toBe('score indisponible');
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('undefined');
  });
});

describe('displayText — aucun « undefined » ne parvient à l’écran', () => {
  it('laisse passer un texte réel', () => {
    expect(displayText('Fnac', 'inconnu')).toBe('Fnac');
  });

  it('une chaîne vide ou blanche retombe sur le repli', () => {
    expect(displayText('', 'inconnu')).toBe('inconnu');
    expect(displayText('   ', 'inconnu')).toBe('inconnu');
  });

  it.each([null, undefined])('une valeur absente retombe sur le repli', (value) => {
    expect(displayText(value as string | null | undefined, 'inconnu')).toBe('inconnu');
  });

  it('ne rend jamais littéralement « undefined » ou « null »', () => {
    for (const value of [undefined, null, '']) {
      const out = displayText(value as string | null | undefined, 'Marchand inconnu');
      expect(out).not.toBe('undefined');
      expect(out).not.toBe('null');
    }
  });
});
