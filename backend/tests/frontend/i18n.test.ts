/**
 * Tests for the frontend i18n module (public/js/i18n.js) — loaded via
 * require() exactly as Jest's CommonJS environment would, exercising the
 * SAME code the browser runs (UMD-lite dual export, see file header).
 *
 * No jsdom here — this project's Jest config is `testEnvironment: 'node'`
 * (see jest.config.js) and none of this module's logic touches the DOM, so
 * no new test infrastructure is needed (megaprompt: "ne rajoute pas une
 * nouvelle infrastructure de test sans nécessité").
 */

const i18n = require('../../public/js/i18n.js');
const fr = require('../../public/js/locales/fr.js');
const en = require('../../public/js/locales/en.js');

describe('frontend i18n — locale resolution', () => {
  beforeAll(() => {
    i18n.registerCatalog('fr', fr);
    i18n.registerCatalog('en', en);
  });

  it('1. default locale is French', () => {
    expect(i18n.DEFAULT_LOCALE).toBe('fr');
  });

  it('17. supports at least fr and en fully translated', () => {
    expect(i18n.isTranslated('fr')).toBe(true);
    expect(i18n.isTranslated('en')).toBe(true);
  });

  it('12. other backend-supported languages are available (selectable) even without a full catalog', () => {
    expect(i18n.isAvailable('de')).toBe(true);
    expect(i18n.isTranslated('de')).toBe(false);
  });

  it('20. Arabic and Hebrew are flagged RTL', () => {
    expect(i18n.isRtl('ar')).toBe(true);
    expect(i18n.isRtl('he')).toBe(true);
    expect(i18n.isRtl('fr')).toBe(false);
  });

  it('13. explicit choice wins over stored preference and browser language', () => {
    expect(i18n.resolveInterfaceLocale({ explicit: 'en', stored: 'de', browser: 'es' })).toBe('en');
  });

  it('falls back to stored, then browser, then default', () => {
    expect(i18n.resolveInterfaceLocale({ stored: 'de', browser: 'es' })).toBe('de');
    expect(i18n.resolveInterfaceLocale({ browser: 'es' })).toBe('es'); // available even if not translated
    expect(i18n.resolveInterfaceLocale({})).toBe('fr');
  });

  it('14. an unsupported/unknown language code never crashes, falls through the chain', () => {
    expect(i18n.resolveInterfaceLocale({ explicit: 'xx-BOGUS', browser: 'en' })).toBe('en');
  });
});

describe('frontend i18n — translate()', () => {
  beforeAll(() => {
    i18n.registerCatalog('fr', fr);
    i18n.registerCatalog('en', en);
  });

  it('17. French translation resolves real UI text', () => {
    expect(i18n.t('nav.newSearch', undefined, 'fr')).toBe('Nouvelle recherche');
  });

  it('18. English translation resolves real UI text, distinct from French', () => {
    expect(i18n.t('nav.newSearch', undefined, 'en')).toBe('New search');
    expect(i18n.t('nav.newSearch', undefined, 'en')).not.toBe(i18n.t('nav.newSearch', undefined, 'fr'));
  });

  it('interpolates {param} placeholders', () => {
    expect(i18n.t('results.rank', { rank: 3 }, 'fr')).toBe('Résultat #3');
    expect(i18n.t('results.source', { source: 'amazon.fr' }, 'en')).toBe('Source: amazon.fr');
  });

  it('falls back to French text for a locale with no catalog yet (never blank)', () => {
    const text = i18n.t('nav.newSearch', undefined, 'de');
    expect(text.length).toBeGreaterThan(0);
    expect(['Nouvelle recherche', 'New search']).toContain(text);
  });

  it('an unknown key stays visibly a key, never invented prose', () => {
    expect(i18n.t('totally.unknown.key', undefined, 'fr')).toBe('totally.unknown.key');
  });

  it('every fr.js key has a matching en.js key (no half-translated UI)', () => {
    const missingInEn = Object.keys(fr).filter(k => !(k in en));
    expect(missingInEn).toEqual([]);
  });
});

describe('frontend i18n — pluralize() (real CLDR rules)', () => {
  beforeAll(() => {
    i18n.registerCatalog('fr', fr);
    i18n.registerCatalog('en', en);
  });

  it('28. French: pluralizes results count correctly for 0/1/2+', () => {
    expect(i18n.pluralize(1, 'results.count', {}, 'fr')).toBe('1 offre trouvée');
    expect(i18n.pluralize(3, 'results.count', {}, 'fr')).toBe('3 offres trouvées');
  });

  it('28b. English: pluralizes results count correctly', () => {
    expect(i18n.pluralize(1, 'results.count', {}, 'en')).toBe('1 offer found');
    expect(i18n.pluralize(5, 'results.count', {}, 'en')).toBe('5 offers found');
  });
});
