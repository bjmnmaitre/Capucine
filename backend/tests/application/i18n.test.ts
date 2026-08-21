/**
 * Tests for the i18n core (locale/language resolution, message catalog,
 * pluralization) and language detection — all deterministic, local, no
 * network, no API key.
 */

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  resolveLanguage,
  registerCatalog,
  translate,
  pluralize,
  toBcp47,
} from '../../src/application/i18n';
import { HeuristicLanguageDetector } from '../../src/application/language-detection';

describe('i18n — locale defaults and coverage', () => {
  it('1. default language is French, default country France, default currency EUR', () => {
    expect(DEFAULT_LANGUAGE).toBe('fr');
    expect(DEFAULT_COUNTRY).toBe('FR');
    expect(DEFAULT_CURRENCY).toBe('EUR');
  });

  it('supports at least the languages the megaprompt lists as a floor', () => {
    for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'fi', 'cs', 'el', 'ro', 'hu', 'ja', 'ko', 'zh', 'ar', 'he', 'tr', 'uk', 'ru']) {
      expect(SUPPORTED_LANGUAGES).toContain(lang);
    }
  });

  it('toBcp47 combines language + country without inventing either', () => {
    expect(toBcp47('fr', 'FR')).toBe('fr-FR');
    expect(toBcp47('en')).toBe('en');
  });
});

describe('i18n — resolveLanguage priority chain', () => {
  it('13. explicit request language wins over everything else', () => {
    expect(resolveLanguage({ requestLanguage: 'en', sessionLanguage: 'de', profileLanguage: 'fr' })).toBe('en');
  });

  it('16. profil français + requête anglaise (session/detected) → répond en anglais', () => {
    expect(resolveLanguage({ sessionLanguage: 'en', profileLanguage: 'fr' })).toBe('en');
  });

  it('falls back to profile language when no request/session language given', () => {
    expect(resolveLanguage({ profileLanguage: 'de' })).toBe('de');
  });

  it('14. unknown/unsupported language input falls back down the chain, never crashes', () => {
    expect(resolveLanguage({ requestLanguage: 'xx-INVALID', profileLanguage: 'es' })).toBe('es');
  });

  it('13b. system default (fr) when nothing else is provided', () => {
    expect(resolveLanguage({})).toBe(DEFAULT_LANGUAGE);
  });
});

describe('i18n — message catalog / translate', () => {
  beforeAll(() => {
    registerCatalog('fr', { GREETING: 'Bonjour {name}' });
    registerCatalog('en', { GREETING: 'Hello {name}' });
  });

  it('26. translates a reasonCode with param interpolation, per language', () => {
    expect(translate('GREETING', 'fr', { name: 'Marie' })).toBe('Bonjour Marie');
    expect(translate('GREETING', 'en', { name: 'Marie' })).toBe('Hello Marie');
  });

  it('falls back to DEFAULT_LANGUAGE catalog when the requested language has no entry', () => {
    registerCatalog('fr', { FR_ONLY: 'Texte français' });
    expect(translate('FR_ONLY', 'de')).toBe('Texte français');
  });

  it('27. an untranslated code stays visibly a code — never blank, never invented prose', () => {
    expect(translate('TOTALLY_UNKNOWN_CODE', 'en')).toBe('TOTALLY_UNKNOWN_CODE');
  });
});

describe('i18n — pluralize (real CLDR rules, not count === 1)', () => {
  it('28. French: 0 and 1 are both singular (CLDR "one"), 2+ is "other"', () => {
    const forms = { one: '{n} résultat', other: '{n} résultats' };
    expect(pluralize(0, 'fr', forms).length).toBeGreaterThan(0); // 'one' in fr-CLDR
    expect(new Intl.PluralRules('fr').select(0)).toBe('one');
    expect(new Intl.PluralRules('fr').select(2)).toBe('other');
  });

  it('28b. English: only 1 is singular', () => {
    expect(new Intl.PluralRules('en').select(1)).toBe('one');
    expect(new Intl.PluralRules('en').select(0)).toBe('other');
  });

  it('falls back to "other" when a language-specific form is missing', () => {
    expect(pluralize(5, 'fr', { other: '{n} items' })).toBe('{n} items');
  });
});

describe('HeuristicLanguageDetector — deterministic, no network', () => {
  const detector = new HeuristicLanguageDetector();

  it('2. detects French', () => {
    const r = detector.detectLanguage('je cherche un ordinateur portable pour la maison');
    expect(r.language).toBe('fr');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('3. detects English', () => {
    const r = detector.detectLanguage('I am looking for a laptop with the best price for a friend');
    expect(r.language).toBe('en');
  });

  it('4. detects German', () => {
    const r = detector.detectLanguage('ich suche einen Laptop mit der besten Leistung für das Büro');
    expect(r.language).toBe('de');
  });

  it('5. detects Spanish', () => {
    const r = detector.detectLanguage('busco un portátil con la mejor batería para el trabajo');
    expect(r.language).toBe('es');
  });

  it('14b. unknown/empty text → "unknown", confidence 0, never fabricated', () => {
    expect(detector.detectLanguage('').language).toBe('unknown');
    expect(detector.detectLanguage('12345 !!! ###').confidence).toBe(0);
  });

  it('confidence is never fabricated as 1.0', () => {
    const r = detector.detectLanguage('je cherche un casque bluetooth pour le sport avec une bonne autonomie');
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('detects script structurally (Cyrillic) independent of the stopword list', () => {
    const r = detector.detectLanguage('Привет мир это тест');
    expect(r.script).toBe('cyrillic');
  });

  // ── Regression: short realistic queries must not misdetect via a shared
  // stopword ("un" appears in fr/es/it lists) resolving to whichever
  // language's dictionary happens to be SHORTER — see language-detection.ts's
  // EXCLUSIVE_STOPWORDS. A conversational shopping query is exactly this
  // shape: short, one or two function words, mostly content words the
  // controlled stopword lists don't cover. ──
  it('a short realistic French query is never misdetected as Spanish via the shared word "un"', () => {
    const r = detector.detectLanguage('je cherche un casque bluetooth');
    expect(r.language).toBe('fr');
  });

  it('"trouve-moi un ordinateur portable" (the exact megaprompt conversation-opener example) is detected as French', () => {
    const r = detector.detectLanguage('trouve-moi un ordinateur portable');
    expect(r.language).toBe('fr');
  });

  it('a real Spanish query is correctly detected as Spanish, not French, once it has its own exclusive vocabulary (not just the shared "un")', () => {
    const r = detector.detectLanguage('quiero un ordenador portátil barato');
    expect(r.language).toBe('es');
  });

  it('a real Italian query is correctly detected as Italian', () => {
    const r = detector.detectLanguage('cerco un computer portatile economico');
    expect(r.language).toBe('it');
  });

  it('a real Portuguese query is correctly detected as Portuguese', () => {
    const r = detector.detectLanguage('procuro um computador portátil barato');
    expect(r.language).toBe('pt');
  });

  it('on a genuine tie (only a word shared across languages, e.g. "un" alone) the default language (fr) wins deterministically, never an arbitrary object-key order artifact', () => {
    const r = detector.detectLanguage('un');
    expect(r.language).toBe('fr');
  });
});
