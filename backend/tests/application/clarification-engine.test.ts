/**
 * ClarificationEngine tests
 *
 * Core invariant: Never block a search that has sufficient context.
 * Never silently modify user intent.
 * Only ask questions with real decision value.
 */

import { ClarificationEngine } from '../../src/application/clarification-engine';

const engine = new ClarificationEngine();

// ── Helper ──────────────────────────────────────────────────────────────────

function analyze(query: string) {
  return engine.analyze([], query, 'test');
}

// ============================================================================
// Specific product queries — MUST NOT trigger blocking clarification
// ============================================================================

describe('Specific product queries — no blocking clarification', () => {
  const cases = [
    'sony wh-1000xm5 casque bluetooth',
    'casque WH-1000XM5 noir',
    'casque bose qc45 sans fil',
    'casque audio sennheiser momentum 4',
    'casque gaming hyperx cloud 3',
    'casque sony bluetooth anc',
    'clavier mécanique keychron k3 pro',
    'clavier gaming razer blackwidow',
    'clavier midi yamaha p-125',
    'tablette samsung galaxy tab s9',
    'tablette apple ipad pro',
    'tablette wacom intuos dessin',
    'montre connectée apple watch series 9',
    'montre automatique seiko 5',
    'montre garmin fenix 7 gps sport',
    'écran 4k dell ultrasharp 27 pouces',
    'écran gaming asus 144hz ips',
  ];

  for (const query of cases) {
    test(`should not block: "${query}"`, () => {
      const result = analyze(query);
      const blocking = result.opportunities.filter(o => o.blocksSearch);
      expect(blocking).toHaveLength(0);
      expect(result.canProceedWithoutClarification).toBe(true);
    });
  }
});

// ============================================================================
// Genuinely ambiguous queries — SHOULD trigger clarification
// ============================================================================

describe('Genuinely ambiguous queries — should trigger clarification', () => {
  test('bare "casque" with no context', () => {
    const result = analyze('casque pas cher');
    const blocking = result.opportunities.filter(o => o.blocksSearch);
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking[0].trigger).toBe('underspecified_category');
  });

  test('"tablette" alone with no context', () => {
    const result = analyze('tablette 200 euros');
    const blocking = result.opportunities.filter(o => o.blocksSearch);
    expect(blocking.length).toBeGreaterThan(0);
  });

  test('"clavier" alone', () => {
    const result = analyze('clavier blanc');
    const blocking = result.opportunities.filter(o => o.blocksSearch);
    expect(blocking.length).toBeGreaterThan(0);
  });

  test('"montre" alone', () => {
    const result = analyze('montre homme');
    const blocking = result.opportunities.filter(o => o.blocksSearch);
    expect(blocking.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Budget ambiguity — should be non-blocking (important, not blocking)
// ============================================================================

describe('Budget ambiguity — important but not blocking', () => {
  test('"pas trop cher" → budget clarification, optional/important', () => {
    const result = analyze('casque audio pas trop cher');
    // No category blocking (context has "audio")
    const blocking = result.opportunities.filter(o => o.blocksSearch);
    expect(blocking).toHaveLength(0);
  });
});

// ============================================================================
// canProceedWithoutClarification logic
// ============================================================================

describe('canProceedWithoutClarification', () => {
  test('specific product search can always proceed', () => {
    const result = analyze('sony wh-1000xm5 256go noir');
    expect(result.canProceedWithoutClarification).toBe(true);
  });

  test('bare ambiguous term cannot proceed', () => {
    const result = analyze('casque');
    // Category ambiguous — should indicate search is blocked
    expect(result.canProceedWithoutClarification).toBe(false);
  });

  test('analysis returns correct counts', () => {
    const result = analyze('sony wh-1000xm5 casque bluetooth anc');
    expect(result.blockingCount).toBe(0);
    expect(result.opportunities).toBeInstanceOf(Array);
  });
});

// ============================================================================
// INVARIANT 5: questions must never silently modify user intent
// ============================================================================

describe('INVARIANT 5 — clarification questions never invent intent', () => {
  test('clarification analysis contains possibleInterpretations for every item', () => {
    const result = analyze('casque');
    for (const item of result.opportunities) {
      expect(item.possibleInterpretations.length).toBeGreaterThan(0);
      expect(item.ambiguityDescription).toBeTruthy();
      expect(item.suggestedQuestion).toBeTruthy();
    }
  });

  test('clarification items have a trigger and urgency', () => {
    const result = analyze('casque');
    for (const item of result.opportunities) {
      expect(item.trigger).toBeTruthy();
      expect(['blocking', 'important', 'optional']).toContain(item.urgency);
    }
  });

  test('recommendedQuestions is a subset of opportunities', () => {
    const result = analyze('casque');
    for (const q of result.recommendedQuestions) {
      expect(result.opportunities.find(o => o.id === q.id)).toBeDefined();
    }
  });
});
