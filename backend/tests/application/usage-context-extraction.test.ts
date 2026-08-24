/**
 * Usage context — EXTRACTION and MAPPING
 *
 * Covers spec §18-A (extraction, FR + EN), §18-B (multi-context), the §7
 * mapping table, and the provenance rules of §6.
 *
 * The load-bearing case is the one the whole feature exists for:
 *   "Sony XM5 noir pour écouter de la musique, surtout dans les transports"
 * must yield usage=music AND context=transport. Reading it as usage=transport
 * (and losing the music half) is the exact bug this replaced.
 */

import { BasicPatternInterpreter, hasStatedUsage } from '../../src/application/request-interpreter';
import {
  mapUsageContextToSignals,
  relevantSignals,
  mergeUsageContexts,
  usageSearchTerms,
  signalSearchTerms,
  describeUsageContext,
  explainSignalRelevance,
} from '../../src/domain/usage-context-mapping';
import { UsageContext } from '../../src/domain/types';

const interpreter = new BasicPatternInterpreter();

function interpret(text: string) {
  return interpreter.interpretSync({
    id: 'q-test',
    userId: 'u-test',
    text,
    timestamp: new Date(),
  });
}

function usageOf(text: string): UsageContext | undefined {
  return interpret(text).usageContext;
}

// ============================================================================
// A. EXTRACTION — French
// ============================================================================

describe('Extraction FR — the usage the user stated', () => {
  const cases: Array<[string, string, string | undefined]> = [
    ['pour les transports',              'transport', 'transport'],
    ['surtout dans le métro',            'transport', 'transport'],
    ['pour le train',                    'transport', 'transport'],
    ['pour voyager',                     'travel',    'travel'],
    ['pour écouter de la musique',       'music',     undefined],
    ['pour le sport',                    'sport',     'gym'],
    ['pour courir',                      'sport',     'gym'],
    ['pour le bureau',                   'office',    'office'],
    ['pour jouer',                       'gaming',    'gaming'],
    ['pour jouer sur PC',                'gaming',    'gaming'],
    ['au bureau',                        'office',    'office'],
    ['en studio',                        'music',     'studio'],
  ];

  for (const [text, usage, context] of cases) {
    it(`"${text}" → usage=${usage}${context ? `, context=${context}` : ''}`, () => {
      const ctx = usageOf(`casque bluetooth ${text}`);
      expect(ctx).toBeDefined();
      expect(ctx!.usage).toBe(usage);
      if (context) expect(ctx!.context).toBe(context);
    });
  }
});

// ============================================================================
// A. EXTRACTION — English
// ============================================================================

describe('Extraction EN — same behaviour, other language', () => {
  const cases: Array<[string, string]> = [
    ['for commuting',        'transport'],
    ['for public transport', 'transport'],
    ['mostly on the train',  'transport'],
    ['for travelling',       'travel'],
    ['for music',            'music'],
    ['for sports',           'sport'],
    ['for running',          'sport'],
    ['for work',             'office'],
    ['for the office',       'office'],
    ['for gaming',           'gaming'],
  ];

  for (const [text, usage] of cases) {
    it(`"${text}" → usage=${usage}`, () => {
      const ctx = usageOf(`headphones ${text}`);
      expect(ctx).toBeDefined();
      expect(ctx!.usage).toBe(usage);
    });
  }
});

// ============================================================================
// THE CENTRAL CASE — activity + environment must both survive
// ============================================================================

describe('Activity and environment are combined, never collapsed', () => {
  it('"pour écouter de la musique, surtout dans les transports" → music IN transport', () => {
    const ctx = usageOf('Je cherche un Sony XM5 noir pour écouter de la musique, surtout dans les transports');
    expect(ctx).toBeDefined();
    expect(ctx!.usage).toBe('music');       // WHAT the user does
    expect(ctx!.context).toBe('transport'); // WHERE they do it
  });

  it('an environment stated alone still yields its implied usage (unchanged behaviour)', () => {
    const ctx = usageOf('casque pour les transports');
    expect(ctx!.usage).toBe('transport');
    expect(ctx!.context).toBe('transport');
  });

  it('the mapping of the central case covers BOTH halves of it', () => {
    const ctx = usageOf('casque pour écouter de la musique, surtout dans les transports')!;
    const signals = mapUsageContextToSignals(ctx);
    // from "transport"
    expect(signals.weight).toBe('relevant');
    expect(signals.batteryLife).toBe('relevant');
    expect(signals.noiseCancellation).toBe('relevant');
    expect(signals.portability).toBe('relevant');
    // from "music"
    expect(signals.audioQuality).toBe('relevant');
    expect(signals.codecSupport).toBe('relevant');
  });
});

// ============================================================================
// B. MULTI-CONTEXT
// ============================================================================

describe('B. Multi-context — several usages are kept, not overwritten', () => {
  it('"pour le sport et les voyages" keeps both', () => {
    const ctx = usageOf('casque pour le sport et les voyages');
    expect(ctx).toBeDefined();
    const usages = [ctx!.usage, ...(ctx!.additional ?? []).map(a => a.usage)];
    expect(usages).toContain('sport');
    expect(usages).toContain('travel');
  });

  it('the signals of a multi-context are the UNION of both usages', () => {
    const ctx = usageOf('casque pour le sport et les voyages')!;
    const signals = mapUsageContextToSignals(ctx);
    expect(signals.sweatResistance).toBe('relevant'); // sport only
    expect(signals.foldability).toBe('relevant');     // travel only
  });

  it('each secondary usage keeps its own provenance', () => {
    const ctx = usageOf('casque pour le sport et les voyages')!;
    for (const entry of [ctx, ...(ctx.additional ?? [])]) {
      expect(entry.source).toBe('user');
      expect(entry.confidence).toBeGreaterThan(0);
      expect(entry.matchedText).toBeTruthy();
    }
  });
});

// ============================================================================
// NO FALSE POSITIVES
// ============================================================================

describe('A usage word inside a product name is not a stated usage', () => {
  const notUsages = [
    'casque gaming hyperx cloud 3',
    'clavier gaming razer blackwidow',
    'écran gaming asus 144hz ips',
    'montre garmin fenix 7 gps sport',
    'sony wh-1000xm5 casque bluetooth',
  ];

  for (const text of notUsages) {
    it(`"${text}" states no usage`, () => {
      expect(usageOf(text)).toBeUndefined();
      expect(hasStatedUsage(text)).toBe(false);
    });
  }
});

// ============================================================================
// §6 PROVENANCE
// ============================================================================

describe('§6 Provenance and confidence', () => {
  it('records source, confidence and the exact words the user wrote', () => {
    const ctx = usageOf('casque pour les transports')!;
    expect(ctx.source).toBe('user');
    expect(ctx.confidence).toBeGreaterThan(0);
    expect(ctx.confidence).toBeLessThanOrEqual(1);
    expect(ctx.matchedText).toContain('transports');
    expect(ctx.timestamp).toBeInstanceOf(Date);
  });

  it('an explanation of a contextual signal never claims the user asked for it', () => {
    const ctx = usageOf('casque pour les transports')!;
    const sentence = explainSignalRelevance(ctx, 'weight');
    expect(sentence).toContain('signal contextuel');
    expect(sentence.toLowerCase()).not.toContain('vous avez demandé');
  });
});

// ============================================================================
// §7 MAPPING TABLE
// ============================================================================

describe('§7 Mapping table — deterministic and complete', () => {
  const table: Array<[string, Array<keyof ReturnType<typeof mapUsageContextToSignals>>]> = [
    ['pour les transports', ['portability', 'weight', 'batteryLife', 'noiseCancellation', 'comfort']],
    ['pour voyager',        ['portability', 'weight', 'batteryLife', 'noiseCancellation', 'comfort']],
    ['pour écouter de la musique', ['audioQuality', 'codecSupport', 'frequencyResponse', 'comfort']],
    ['pour le sport',       ['stability', 'sweatResistance', 'weight', 'comfort']],
    ['pour le bureau',      ['microphone', 'comfort', 'noiseCancellation', 'batteryLife']],
    ['pour jouer',          ['latency', 'microphone', 'compatibility', 'spatialAudio']],
  ];

  for (const [text, expected] of table) {
    it(`"${text}" makes ${expected.join(', ')} relevant`, () => {
      const ctx = usageOf(`casque ${text}`)!;
      const signals = mapUsageContextToSignals(ctx);
      for (const key of expected) expect(signals[key]).toBe('relevant');
    });
  }

  it('is deterministic — same context, same signals, same order', () => {
    const ctx = usageOf('casque pour les transports')!;
    expect(relevantSignals(ctx)).toEqual(relevantSignals(ctx));
    expect(JSON.stringify(mapUsageContextToSignals(ctx)))
      .toBe(JSON.stringify(mapUsageContextToSignals(ctx)));
  });

  it("usage 'other' makes nothing relevant — no invented dimensions", () => {
    const ctx: UsageContext = {
      usage: 'other', source: 'inferred', confidence: 0.5, timestamp: new Date(),
    };
    expect(relevantSignals(ctx)).toEqual([]);
  });
});

// ============================================================================
// SEARCH VOCABULARY
// ============================================================================

describe('Search vocabulary derived from the context', () => {
  it('produces usage words in the query language', () => {
    const ctx = usageOf('casque pour les transports')!;
    expect(usageSearchTerms(ctx, 'fr')).toContain('transport');
    expect(usageSearchTerms(ctx, 'en')).toContain('commuting');
  });

  it('produces the technical dimensions the usage makes relevant, bounded', () => {
    const ctx = usageOf('casque pour les transports')!;
    const terms = signalSearchTerms(ctx, 'fr', 4);
    expect(terms.length).toBeLessThanOrEqual(4);
    expect(terms).toContain('autonomie');
  });

  it('describes the context in prose for explanations', () => {
    const ctx = usageOf('casque pour écouter de la musique, surtout dans les transports')!;
    const label = describeUsageContext(ctx, 'fr');
    expect(label).toContain('musique');
    expect(label).toContain('transports');
  });
});

// ============================================================================
// MERGING ACROSS TURNS
// ============================================================================

describe('mergeUsageContexts — a later turn adds, never erases', () => {
  it('keeps the earlier usage while making the newest one dominant', () => {
    const turn2 = usageOf('pour écouter de la musique')!;
    const turn3 = usageOf('surtout dans le métro')!;
    const merged = mergeUsageContexts(turn2, turn3)!;

    expect(merged.usage).toBe('transport'); // newest statement dominates
    const all = [merged.usage, ...(merged.additional ?? []).map(a => a.usage)];
    expect(all).toContain('music');         // earlier statement survives
  });

  it('does not duplicate a usage stated twice', () => {
    const a = usageOf('pour les transports')!;
    const b = usageOf('pour les transports')!;
    const merged = mergeUsageContexts(a, b)!;
    expect(merged.additional ?? []).toHaveLength(0);
  });

  it('returns the existing context unchanged when the new turn states no usage', () => {
    const a = usageOf('pour les transports')!;
    expect(mergeUsageContexts(a, undefined)).toBe(a);
  });

  it('never mutates its arguments', () => {
    const a = usageOf('pour écouter de la musique')!;
    const b = usageOf('pour le sport')!;
    const snapshotA = JSON.stringify(a);
    const snapshotB = JSON.stringify(b);
    mergeUsageContexts(a, b);
    expect(JSON.stringify(a)).toBe(snapshotA);
    expect(JSON.stringify(b)).toBe(snapshotB);
  });
});

// ============================================================================
// USAGE CONTEXT IS NEVER A CRITERION
// ============================================================================

describe('F. A usage context never becomes a criterion', () => {
  it('extracting a usage adds no PreferenceCriterion of any level', () => {
    const withUsage = interpret('casque bluetooth pour les transports');
    const withoutUsage = interpret('casque bluetooth');
    expect(withUsage.usageContext).toBeDefined();
    expect(withUsage.extractedCriteria.map(c => c.id).sort())
      .toEqual(withoutUsage.extractedCriteria.map(c => c.id).sort());
  });

  it('no extracted criterion is named after a contextual dimension', () => {
    const result = interpret('casque bluetooth pour les transports');
    const ids = result.extractedCriteria.map(c => c.id);
    for (const forbidden of ['weight', 'poids', 'battery_life', 'anc', 'portability']) {
      expect(ids).not.toContain(forbidden);
    }
  });
});
