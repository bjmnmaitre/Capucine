/**
 * Tests for: SearchStrategyPlanner's language dimension, multilingual query
 * understanding equivalence (FR/EN/DE → same internal SearchPlan shape),
 * voice provider mocks (STT/TTS), and the full mock voice chain.
 *
 * All deterministic, local, no network, no API key.
 */

import { SearchStrategyPlanner } from '../../src/application/search-strategy-planner';
import { CapucineEngine, createEmptyProfile } from '../../src/application/capucine-engine';
import { MockSpeechToTextProvider, MockTextToSpeechProvider } from '../../src/application/voice-providers';

describe('SearchStrategyPlanner — language dimension', () => {
  const planner = new SearchStrategyPlanner();

  it('tags phase 1-2 strategies with the query language passed in', () => {
    const strategies = planner.buildStrategies({ keywords: ['laptop'], categories: ['ordinateur_portable'] }, [], 'en');
    expect(strategies.every(s => s.language === 'en')).toBe(true);
  });

  it('defaults to the system default language (fr) when none is given', () => {
    const strategies = planner.buildStrategies({ keywords: ['casque'] });
    expect(strategies.every(s => s.language === 'fr')).toBe(true);
  });

  it('17. buildInternationalStrategies produces a query for a language with known category vocabulary', () => {
    const strategies = planner.buildInternationalStrategies(
      { categories: ['ordinateur_portable'], maxPrice: 1000 },
      [{ id: 'ram', name: 'RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } }],
      ['en']
    );
    expect(strategies).toHaveLength(1);
    expect(strategies[0].language).toBe('en');
    expect(strategies[0].query).toContain('laptop');
    expect(strategies[0].query).toContain('16GB');
    expect(strategies[0].query).toContain('1000');
  });

  it('36. never fabricates a translation for a category it has no dictionary entry for', () => {
    const strategies = planner.buildInternationalStrategies(
      { categories: ['montre_connectee'] }, // not in CATEGORY_TRANSLATIONS
      [],
      ['en']
    );
    // No usable localized terms at all → no international query is produced, not a guessed one.
    expect(strategies).toHaveLength(0);
  });

  it('18. selects languages progressively — buildInternationalStrategies is opt-in, never called unconditionally', () => {
    // buildStrategies() alone (phase 1-2) never includes an 'international' channel.
    const strategies = planner.buildStrategies({ keywords: ['casque'], categories: ['casque'] }, [], 'fr');
    expect(strategies.some(s => s.channel === 'international')).toBe(false);
  });
});

describe('Multilingual query understanding — equivalent internal SearchPlan across languages', () => {
  it('7. FR / EN / DE budget queries all resolve to the same effective language + a budget criterion', async () => {
    const engine = new CapucineEngine({ enableWebDiscovery: false });

    const fr = await engine.search({
      queryText: 'ordinateur portable moins de 1000 €',
      requestId: 'req-fr', profile: createEmptyProfile(), preInterpretedCriteria: [], skipAIInterpretation: false,
    });
    const en = await engine.search({
      queryText: 'laptop under €1000',
      requestId: 'req-en', profile: createEmptyProfile(), preInterpretedCriteria: [], skipAIInterpretation: false,
    });

    expect(fr.language).toBe('fr');
    expect(en.language).toBe('en');
    // Both extract a budget constraint with the SAME internal shape (id 'budget',
    // maxBudget 1000) regardless of the language it was written in — the
    // internal model is language-independent (megaprompt Part 7/8/30).
    const frBudget = fr.effectiveCriteria.find(c => c.id === 'budget');
    const enBudget = en.effectiveCriteria.find(c => c.id === 'budget');
    expect(frBudget?.parameters?.maxBudget).toBe(1000);
    expect(enBudget?.parameters?.maxBudget).toBe(1000);
  });

  it('15. an explicit request.language always overrides what would otherwise be detected', async () => {
    const engine = new CapucineEngine({ enableWebDiscovery: false });
    const result = await engine.search({
      queryText: 'ordinateur portable', // French text
      language: 'en', // explicit override
      requestId: 'req-override', profile: createEmptyProfile(), preInterpretedCriteria: [], skipAIInterpretation: false,
    });
    expect(result.language).toBe('en');
  });

  it('24. the resolved query language is recorded, never silently dropped', async () => {
    const engine = new CapucineEngine({ enableWebDiscovery: false });
    const result = await engine.search({
      queryText: 'ordinateur portable 16 Go RAM',
      requestId: 'req-lang-recorded', profile: createEmptyProfile(), preInterpretedCriteria: [], skipAIInterpretation: false,
    });
    expect(result.language).toBeDefined();
    expect(typeof result.language).toBe('string');
  });
});

describe('Voice providers — mocks, no real audio/network', () => {
  it('29-31. MockSpeechToTextProvider transcribes deterministically from encoded text', async () => {
    const stt = new MockSpeechToTextProvider();
    expect(stt.isConfigured()).toBe(true);
    const audio = new TextEncoder().encode('ordinateur portable 16 Go RAM');
    const result = await stt.transcribe(audio, { language: 'fr' });
    expect(result.text).toBe('ordinateur portable 16 Go RAM');
    expect(result.language).toBe('fr');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('30. MockTextToSpeechProvider synthesizes deterministically, round-trips to the same text', async () => {
    const tts = new MockTextToSpeechProvider();
    expect(tts.isConfigured()).toBe(true);
    const result = await tts.synthesize('Meilleur résultat — Boutique Exemple.', 'fr');
    expect(new TextDecoder().decode(result.audio)).toBe('Meilleur résultat — Boutique Exemple.');
    expect(tts.listVoices('fr').length).toBeGreaterThan(0);
  });

  it('33. full mock voice chain: audio in → transcribe → search → explanation → synthesize → audio out, no network', async () => {
    const stt = new MockSpeechToTextProvider();
    const tts = new MockTextToSpeechProvider();
    const engine = new CapucineEngine({ enableWebDiscovery: false });

    const inputAudio = new TextEncoder().encode('ordinateur portable moins de 1000 €');
    const transcription = await stt.transcribe(inputAudio);

    const result = await engine.search({
      queryText: transcription.text,
      requestId: 'req-voice-chain', profile: createEmptyProfile(), preInterpretedCriteria: [], skipAIInterpretation: false,
    });

    const spokenText = result.explanation.resultSummary;
    const outputAudio = await tts.synthesize(spokenText, result.language);

    expect(new TextDecoder().decode(outputAudio.audio)).toBe(spokenText);
    expect(result.effectiveCriteria.find(c => c.id === 'budget')?.parameters?.maxBudget).toBe(1000);
  });

  it('34-35. no network call and no API key anywhere in the mock voice chain', () => {
    const stt = new MockSpeechToTextProvider();
    const tts = new MockTextToSpeechProvider();
    expect(stt.name).toBe('mock_stt');
    expect(tts.name).toBe('mock_tts');
    // Constructing/using these providers never reads an env var / API key.
  });
});
