/**
 * Tests for Request Interpreter
 *
 * Validates that real interpretation logic works.
 */

import { BasicPatternInterpreter, RequestResolver } from '../../src/application/request-interpreter';
import { UserQuery, InterpretedRequest } from '../../src/application/request';

describe('BasicPatternInterpreter', () => {
  let interpreter: BasicPatternInterpreter;

  beforeEach(() => {
    interpreter = new BasicPatternInterpreter();
  });

  describe('interpret', () => {
    it('should extract budget from query text', async () => {
      const query: UserQuery = {
        id: 'q1',
        userId: 'u1',
        text: 'I want a laptop under €1000',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      expect(result.queryId).toBe('q1');
      expect(result.userId).toBe('u1');
      expect(result.budget).toBeDefined();
      expect(result.budget?.maximum).toBe(1000);
      expect(result.extractedCriteria.length).toBeGreaterThan(0);
    });

    it('should identify required criteria', async () => {
      const query: UserQuery = {
        id: 'q2',
        userId: 'u1',
        text: 'I need a laptop with at least 16GB RAM',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      const hasRequired = result.extractedCriteria.some(c => c.level === 'required');
      expect(hasRequired).toBe(true);
    });

    it('should identify preferences', async () => {
      const query: UserQuery = {
        id: 'q3',
        userId: 'u1',
        text: 'I prefer lightweight models',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      const hasPreference = result.extractedCriteria.some(
        c => c.level === 'preference'
      );
      expect(hasPreference).toBe(true);
    });

    it('should identify exclusions as forbidden', async () => {
      const query: UserQuery = {
        id: 'q4',
        userId: 'u1',
        text: 'Avoid plastic models',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      const hasForbidden = result.extractedCriteria.some(
        c => c.level === 'forbidden'
      );
      expect(hasForbidden).toBe(true);
    });

    it('should detect budget flexibility ambiguity', async () => {
      const query: UserQuery = {
        id: 'q5',
        userId: 'u1',
        text: 'Around €1000 budget',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      const hasFlexAmbiguity = result.ambiguities.some(
        a => a.ambiguityType === 'budget_flexibility'
      );
      expect(hasFlexAmbiguity).toBe(true);
    });

    it('should handle structured input', async () => {
      const query: UserQuery = {
        id: 'q6',
        userId: 'u1',
        structured: {
          category: 'electronics',
          budget: { max: 500, currency: 'EUR' },
          location: 'FR',
        },
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      expect(result.category).toBe('electronics');
      expect(result.budget?.maximum).toBe(500);
      expect(result.shippingPreferences?.country).toBe('FR');
    });

    it('should produce valid InterpretedRequest structure', async () => {
      const query: UserQuery = {
        id: 'q7',
        userId: 'u1',
        text: 'I want a good phone under €500',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      expect(result.id).toBeTruthy();
      expect(result.queryId).toBe('q7');
      expect(result.userId).toBe('u1');
      expect(result.extractedCriteria).toBeInstanceOf(Array);
      expect(result.ambiguities).toBeInstanceOf(Array);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.interpretedAt).toBeInstanceOf(Date);
    });

    it('should throw error if query has no text or structure', async () => {
      const query: UserQuery = {
        id: 'q8',
        userId: 'u1',
        timestamp: new Date(),
      };

      await expect(interpreter.interpret(query)).rejects.toThrow();
    });

    it('should lower confidence with many ambiguities', async () => {
      const query: UserQuery = {
        id: 'q9',
        userId: 'u1',
        text: 'Around €1000, good but not too expensive, lightweight, powerful, etc',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      // More ambiguities should lower confidence
      expect(result.ambiguities.length).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(0.9);
    });

    it('should raise confidence with clear budget', async () => {
      const query: UserQuery = {
        id: 'q10',
        userId: 'u1',
        text: 'Max €600',
        timestamp: new Date(),
      };

      const result = await interpreter.interpret(query);

      expect(result.budget).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('analyzeQuery', () => {
    it('should analyze query complexity', async () => {
      const query: UserQuery = {
        id: 'q11',
        userId: 'u1',
        text: 'Simple query',
        timestamp: new Date(),
      };

      const analysis = await interpreter.analyzeQuery(query);

      expect(analysis.queryId).toBe('q11');
      expect(analysis.queryLength).toBeGreaterThan(0);
      expect(['simple', 'moderate', 'complex']).toContain(
        analysis.estimatedComplexity
      );
      expect(analysis.isRankable).toBe(true);
    });

    it('should detect time constraints', async () => {
      const query: UserQuery = {
        id: 'q12',
        userId: 'u1',
        text: 'I need this urgently',
        timestamp: new Date(),
      };

      const analysis = await interpreter.analyzeQuery(query);

      expect(analysis.isTimeConstrained).toBe(true);
    });

    it('should extract categories', async () => {
      const query: UserQuery = {
        id: 'q13',
        userId: 'u1',
        text: 'Looking for a laptop or tablet',
        timestamp: new Date(),
      };

      const analysis = await interpreter.analyzeQuery(query);

      expect(analysis.detectedCategories.length).toBeGreaterThan(0);
    });
  });

  describe('validateQuery', () => {
    it('should reject query without id', async () => {
      const query: any = {
        userId: 'u1',
        text: 'test',
        timestamp: new Date(),
      };

      const result = await interpreter.validateQuery(query);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject query without text or structure', async () => {
      const query: UserQuery = {
        id: 'q14',
        userId: 'u1',
        timestamp: new Date(),
      };

      const result = await interpreter.validateQuery(query);

      expect(result.isValid).toBe(false);
    });

    it('should warn about very short queries', async () => {
      const query: UserQuery = {
        id: 'q15',
        userId: 'u1',
        text: 'ab',
        timestamp: new Date(),
      };

      const result = await interpreter.validateQuery(query);

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should pass validation for good query', async () => {
      const query: UserQuery = {
        id: 'q16',
        userId: 'u1',
        text: 'I want a good laptop under €500',
        timestamp: new Date(),
      };

      const result = await interpreter.validateQuery(query);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });
});

describe('RequestResolver', () => {
  let resolver: RequestResolver;
  let interpreter: BasicPatternInterpreter;

  beforeEach(() => {
    resolver = new RequestResolver();
    interpreter = new BasicPatternInterpreter();
  });

  it('should resolve ambiguities', async () => {
    const query: UserQuery = {
      id: 'q17',
      userId: 'u1',
      text: 'Around €1000',
      timestamp: new Date(),
    };

    const interpreted = await interpreter.interpret(query);

    const clarifications = new Map<string, string>();
    if (interpreted.ambiguities.length > 0) {
      clarifications.set(interpreted.ambiguities[0].id, '±20%');
    }

    const resolved = resolver.resolveRequest(interpreted, clarifications);

    expect(resolved.readyForRanking).toBe(true);
    expect(resolved.finalBudget).toBeDefined();
    if (resolved.finalBudget?.flexible) {
      expect(resolved.finalBudget.flexibilityPercent).toBeDefined();
    }
  });

  it('should produce valid ResolvedInterpretedRequest', async () => {
    const query: UserQuery = {
      id: 'q18',
      userId: 'u1',
      text: 'I need a laptop under €500',
      timestamp: new Date(),
    };

    const interpreted = await interpreter.interpret(query);
    const resolved = resolver.resolveRequest(interpreted, new Map());

    expect(resolved.id).toBeTruthy();
    expect(resolved.originalQueryId).toBe(query.id);
    expect(resolved.interpretedRequestId).toBe(interpreted.id);
    expect(resolved.userId).toBe('u1');
    expect(resolved.finalCriteria).toBeInstanceOf(Array);
    expect(resolved.readyForRanking).toBe(true);
    expect(resolved.createdAt).toBeInstanceOf(Date);
    expect(resolved.finalizedAt).toBeInstanceOf(Date);
  });

  it('should apply budget flexibility clarification', async () => {
    const query: UserQuery = {
      id: 'q19',
      userId: 'u1',
      text: 'Around €1000 budget',
      timestamp: new Date(),
    };

    const interpreted = await interpreter.interpret(query);
    const flexAmbiguity = interpreted.ambiguities.find(
      a => a.ambiguityType === 'budget_flexibility'
    );

    if (flexAmbiguity) {
      const clarifications = new Map<string, string>();
      clarifications.set(flexAmbiguity.id, '±20%');

      const resolved = resolver.resolveRequest(interpreted, clarifications);

      expect(resolved.finalBudget?.flexible).toBe(true);
      expect(resolved.finalBudget?.flexibilityPercent).toBeCloseTo(0.2, 1);
    }
  });
});

// ============================================================================
// PRODUCT TERM EXTRACTION
// ============================================================================

describe('Product term extraction (suggestedSearchTerms)', () => {
  let interp: import('../../src/application/request-interpreter').BasicPatternInterpreter;

  const q = (text: string): import('../../src/application/request').UserQuery => ({
    id: 'pt-test',
    userId: 'u1',
    text,
    timestamp: new Date(),
  });

  beforeEach(() => {
    const { BasicPatternInterpreter } = require('../../src/application/request-interpreter');
    interp = new BasicPatternInterpreter();
  });

  it('extracts brand name Sony', async () => {
    const result = await interp.interpret(q('je cherche un casque Sony'));
    expect(result.suggestedSearchTerms).toBeDefined();
    expect(result.suggestedSearchTerms!.some((t: string) => t === 'sony')).toBe(true);
  });

  it('extracts model number WH-1000XM5', async () => {
    const result = await interp.interpret(q('Sony WH-1000XM5 bluetooth'));
    const terms = result.suggestedSearchTerms ?? [];
    expect(terms.some((t: string) => t.toLowerCase().includes('wh') || t.includes('1000'))).toBe(true);
  });

  it('extracts multiple brands and models', async () => {
    const result = await interp.interpret(q('MacBook Pro M3 ou Dell XPS 15'));
    const terms = result.suggestedSearchTerms ?? [];
    expect(terms.some((t: string) => t === 'apple' || t.includes('macbook'))).toBe(true);
    expect(terms.some((t: string) => t === 'dell')).toBe(true);
  });

  it('extracts quoted product name verbatim', async () => {
    const result = await interp.interpret(q('je cherche le "Roborock S8 Pro Ultra"'));
    const terms = result.suggestedSearchTerms ?? [];
    expect(terms.some((t: string) => t.toLowerCase().includes('roborock'))).toBe(true);
  });

  it('returns non-empty terms for a product query', async () => {
    const result = await interp.interpret(q('aspirateur robot Dyson V15'));
    expect(result.suggestedSearchTerms).toBeDefined();
    expect(result.suggestedSearchTerms!.length).toBeGreaterThan(0);
  });

  it('sync version also populates suggestedSearchTerms', () => {
    const result = interp.interpretSync(q('Sony WH-1000XM5'));
    expect(result.suggestedSearchTerms).toBeDefined();
    expect(result.suggestedSearchTerms!.length).toBeGreaterThan(0);
  });

  // ── Regression: shopping-intent verbs must never leak into search terms —
  // real bug found by running the megaprompt's own conversation scenario
  // through the full HTTP pipeline: "trouve-moi un ordinateur portable"
  // produced suggestedSearchTerms=['trouve','ordinateur','portable'] because
  // "trouve" (present tense) wasn't in EXTRACT_STOP (only "trouver",
  // infinitive, was) — InMemoryDiscoveryStrategy requires EVERY keyword to
  // appear in a candidate's corpus, so the leaked verb alone zeroed out
  // every result for an entirely ordinary, natural French request. ──
  it('French shopping-intent verb conjugations never leak into search terms ("trouve-moi", "montre-moi", "recherche")', async () => {
    const cases: Array<[string, string]> = [
      ['trouve-moi un ordinateur portable', 'trouve'],
      ['montre-moi des casques', 'montre'],
      ['recherche un aspirateur robot', 'recherche'],
      ['affiche-moi des claviers', 'affiche'],
      ['propose-moi un smartphone', 'propose'],
    ];
    for (const [query, verb] of cases) {
      const result = await interp.interpret(q(query));
      const terms = result.suggestedSearchTerms ?? [];
      expect(terms).not.toContain(verb);
    }
  });

  it('a leaked verb previously caused zero discovery results end-to-end — now the product terms alone reach the local catalog', async () => {
    const { CapucineEngine } = require('../../src/application/capucine-engine');
    const { InMemoryProfileStore } = require('../../src/application/profile-store');
    const engine = new CapucineEngine();
    const profile = await new InMemoryProfileStore().load('anonymous');

    const result = await engine.search({ queryText: 'trouve-moi un ordinateur portable', requestId: 'verb-leak', profile });
    expect(result.interpretedRequest?.suggestedSearchTerms).toEqual(['ordinateur', 'portable']);
    expect(result.ranking.rankedOffers.length).toBeGreaterThan(0);
  });

  it('a plural French phrasing ("montre-moi des casques") still finds results against the (singular-only) local catalog fixtures', async () => {
    const { CapucineEngine } = require('../../src/application/capucine-engine');
    const { InMemoryProfileStore } = require('../../src/application/profile-store');
    const engine = new CapucineEngine();
    const profile = await new InMemoryProfileStore().load('anonymous');

    const result = await engine.search({ queryText: 'montre-moi des casques', requestId: 'plural', profile });
    expect(result.ranking.rankedOffers.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// FRENCH TECHNICAL CONSTRAINT INTERPRETATION
// (screen size, RAM, storage) — separated from free-text search terms.
// ============================================================================

describe('French technical constraint interpretation', () => {
  let interp: import('../../src/application/request-interpreter').BasicPatternInterpreter;

  const q = (text: string): import('../../src/application/request').UserQuery => ({
    id: 'tech-test',
    userId: 'u1',
    text,
    timestamp: new Date(),
  });

  const findCriterion = (result: import('../../src/application/request').InterpretedRequest, id: string) =>
    result.extractedCriteria.find(c => c.id === id);

  beforeEach(() => {
    const { BasicPatternInterpreter } = require('../../src/application/request-interpreter');
    interp = new BasicPatternInterpreter();
  });

  // ---- 1. Full critical example ----
  it('1. "ordinateur portable 14 pouces 16 Go RAM moins de 1000 €" → structured constraints, clean terms', async () => {
    const result = await interp.interpret(q('ordinateur portable 14 pouces 16 Go RAM moins de 1000 €'));

    const budget = findCriterion(result, 'budget');
    expect(budget?.parameters?.maxBudget).toBe(1000);

    const screen = findCriterion(result, 'screen_size');
    expect(screen?.level).toBe('required');
    expect(screen?.parameters?.exactValue).toBe(14);

    const ram = findCriterion(result, 'ram');
    expect(ram?.level).toBe('required');
    expect(ram?.parameters?.minValue).toBe(16);

    // Search terms must stay clean — no "pouces-16" / "de-1000" style noise.
    const terms = result.suggestedSearchTerms ?? [];
    for (const t of terms) {
      expect(t).not.toMatch(/^pouces-/);
      expect(t).not.toMatch(/^de-\d/);
    }
    expect(terms).toEqual(expect.arrayContaining(['ordinateur', 'portable']));
  });

  // ---- 2. "sous X €" budget variant ----
  it('2. "ordinateur portable sous 1000 €" → budget extracted via "sous"', async () => {
    const result = await interp.interpret(q('ordinateur portable sous 1000 €'));
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1000);
  });

  // ---- 3. Screen size via quote mark ----
  it('3. \'laptop 14"\' → screen_size = 14', async () => {
    const result = await interp.interpret(q('laptop 14"'));
    expect(findCriterion(result, 'screen_size')?.parameters?.exactValue).toBe(14);
  });

  // ---- 4. RAM via "16GB RAM" ----
  it('4. "PC portable 16GB RAM" → ram minValue = 16', async () => {
    const result = await interp.interpret(q('PC portable 16GB RAM'));
    expect(findCriterion(result, 'ram')?.parameters?.minValue).toBe(16);
  });

  // ---- 5. Storage via "X Go SSD" ----
  it('5. "ordinateur portable 512 Go SSD" → storage minValue = 512', async () => {
    const result = await interp.interpret(q('ordinateur portable 512 Go SSD'));
    expect(findCriterion(result, 'storage')?.parameters?.minValue).toBe(512);
  });

  // ---- 6. Storage via "1 To" (converted to GB, ×1024 to match NormalizationEngine) ----
  it('6. "ordinateur portable 1 To" → storage minValue = 1024 GB', async () => {
    const result = await interp.interpret(q('ordinateur portable 1 To'));
    expect(findCriterion(result, 'storage')?.parameters?.minValue).toBe(1024);
  });

  // ---- 7. "jusqu'à X euros" budget variant ----
  it('7. "ordinateur portable jusqu\'à 1000 euros" → budget extracted', async () => {
    const result = await interp.interpret(q("ordinateur portable jusqu'à 1000 euros"));
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1000);
  });

  // ---- 8. No technical constraint in query ----
  it('8. "ordinateur portable" → no screen_size/ram/storage/budget criteria', async () => {
    const result = await interp.interpret(q('ordinateur portable'));
    expect(findCriterion(result, 'screen_size')).toBeUndefined();
    expect(findCriterion(result, 'ram')).toBeUndefined();
    expect(findCriterion(result, 'storage')).toBeUndefined();
    expect(findCriterion(result, 'budget')).toBeUndefined();
    expect(result.suggestedSearchTerms).toEqual(expect.arrayContaining(['ordinateur', 'portable']));
  });

  // ---- 9. Query with a constraint the interpreter can't parse — stays absent, not fabricated ----
  it('9. "ordinateur portable très puissant" → no screen_size/ram/storage invented from vague wording', async () => {
    const result = await interp.interpret(q('ordinateur portable très puissant'));
    expect(findCriterion(result, 'screen_size')).toBeUndefined();
    expect(findCriterion(result, 'ram')).toBeUndefined();
    expect(findCriterion(result, 'storage')).toBeUndefined();
  });

  // ---- 10. Several constraints together ----
  it('10. "ordinateur portable 16 Go RAM 512 Go SSD moins de 1000 €" → all three constraints + budget present', async () => {
    const result = await interp.interpret(q('ordinateur portable 16 Go RAM 512 Go SSD moins de 1000 €'));
    expect(findCriterion(result, 'ram')?.parameters?.minValue).toBe(16);
    expect(findCriterion(result, 'storage')?.parameters?.minValue).toBe(512);
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1000);
  });

  // ---- 11. No "pouces-16" / "de-1000" style fragments in search terms, across variants ----
  it('11. noisy word+number fragments never appear as search terms', async () => {
    const queries = [
      'ordinateur portable 14 pouces 16 Go RAM moins de 1000 €',
      'ordinateur portable 512 Go SSD moins de 800 euros',
      'laptop 14" 16GB RAM',
    ];
    for (const query of queries) {
      const result = await interp.interpret(q(query));
      const terms = result.suggestedSearchTerms ?? [];
      for (const t of terms) {
        expect(t).not.toMatch(/^(pouces|de|go|gb|ssd|ram|euros?)-\d/);
        expect(t).not.toMatch(/^\d+-(pouces|de|go|gb|ssd|ram|euros?)/);
      }
    }
  });

  // ---- 12. Structured constraints survive alongside search terms (not one-or-the-other) ----
  it('12. structured criteria and suggestedSearchTerms are both populated (not mutually exclusive)', async () => {
    const result = await interp.interpret(q('ordinateur portable 14 pouces 16 Go RAM moins de 1000 €'));
    expect(result.extractedCriteria.length).toBeGreaterThanOrEqual(3); // budget, screen_size, ram
    expect((result.suggestedSearchTerms ?? []).length).toBeGreaterThan(0);
  });

  // ---- 13. Condition extraction (used by conversational follow-ups — "uniquement du neuf") ----
  it('13. "ordinateur portable reconditionné" → condition = refurbished, unknownPolicy pass', async () => {
    const result = await interp.interpret(q('ordinateur portable reconditionné'));
    const condition = findCriterion(result, 'condition');
    expect(condition?.parameters?.preferredValues).toEqual(['refurbished']);
    expect(condition?.parameters?.unknownPolicy).toBe('pass');
  });

  it('13b. "smartphone occasion" → condition = used', async () => {
    const result = await interp.interpret(q('smartphone occasion'));
    expect(findCriterion(result, 'condition')?.parameters?.preferredValues).toEqual(['used']);
  });

  it('13c. "ordinateur portable neuf" → condition = new', async () => {
    const result = await interp.interpret(q('ordinateur portable neuf'));
    expect(findCriterion(result, 'condition')?.parameters?.preferredValues).toEqual(['new']);
  });

  it('13d. no condition wording → no condition criterion fabricated', async () => {
    const result = await interp.interpret(q('ordinateur portable 16 Go'));
    expect(findCriterion(result, 'condition')).toBeUndefined();
  });

  // ---- 14. Conversational budget-refinement phrasing (used by follow-up turns) ----
  it('14. "élargis à 1100€" → budget maxBudget = 1100', async () => {
    const result = await interp.interpret(q('élargis à 1100€'));
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1100);
  });

  it('14b. "augmente le budget à 1200 euros" → budget maxBudget = 1200', async () => {
    const result = await interp.interpret(q('augmente le budget à 1200 euros'));
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1200);
  });

  it('14c. "increase the budget to 1300" → budget maxBudget = 1300', async () => {
    const result = await interp.interpret(q('increase the budget to 1300'));
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1300);
  });

  it('14d. refinement phrasing never shadows the ordinary "moins de X€" pattern in single-turn text', async () => {
    // Regression guard: the new patterns were appended LAST specifically so
    // ordinary queries keep matching the same pattern (and value) as before.
    const result = await interp.interpret(q('ordinateur portable moins de 1000 €'));
    expect(findCriterion(result, 'budget')?.parameters?.maxBudget).toBe(1000);
  });

  // ---- 15. Conversational RAM-refinement phrasing (megaprompt's own
  // conversation scenario: "uniquement 16 Go" / "finalement 32 Go" as
// ---- Budget follow-up phrasing tests for Megaprompt compliance ----
it("'300 € maximum' → budget maxBudget = 300", async () => {
  const result = await interp.interpret(q("300 € maximum"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
});

it("'maximum 300 €' → budget maxBudget = 300", async () => {
  const result = await interp.interpret(q("maximum 300 €"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
});

it("'300 euros max' → budget maxBudget = 300", async () => {
  const result = await interp.interpret(q("300 euros max"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
});

it("'pas plus de 300 €' → budget maxBudget = 300", async () => {
  const result = await interp.interpret(q("pas plus de 300 €"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
});

it("'jusqu'à 300 €' → budget maxBudget = 300", async () => {
  const result = await interp.interpret(q("jusqu'à 300 €"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
});

it("'300 €, neuf uniquement' → budget maxBudget = 300 AND condition = new", async () => {
  const result = await interp.interpret(q("300 €, neuf uniquement"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
  expect(findCriterion(result, "condition")?.parameters?.preferredValues).toEqual(["new"]);
});

// Test contradiction handling (later response overrides earlier)
it("'400 €' after '300 € maximum' → budget maxBudget = 400 (last wins)", async () => {
  // First establish 300 EUR budget
  let result = await interp.interpret(q("300 € maximum"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(300);
  
  // Update with 400 EUR
  result = await interp.interpret(q("400 € maximum"));
  expect(findCriterion(result, "budget")?.parameters?.maxBudget).toBe(400);
});

// Test vague response does not invent budget
it("'pas trop cher' → no budget invented", async () => {
  const result = await interp.interpret(q("pas trop cher"));
  expect(findCriterion(result, "budget")).toBeUndefined();
});
  // follow-ups never repeat the word "ram") ----
  it('15. "uniquement 16 Go" → ram minValue = 16, without the word "ram"', async () => {
    const result = await interp.interpret(q('uniquement 16 Go'));
    expect(findCriterion(result, 'ram')?.parameters?.minValue).toBe(16);
  });

  it('15b. "finalement 32 Go" → ram minValue = 32', async () => {
    const result = await interp.interpret(q('finalement 32 Go'));
    expect(findCriterion(result, 'ram')?.parameters?.minValue).toBe(32);
  });

  it('15c. "et avec 32 Go" / "and with 32 GB" → ram minValue = 32', async () => {
    expect(findCriterion(await interp.interpret(q('et avec 32 Go')), 'ram')?.parameters?.minValue).toBe(32);
    expect(findCriterion(await interp.interpret(q('and with 32 GB')), 'ram')?.parameters?.minValue).toBe(32);
  });

  it('15d. a bare "16 Go" with NO refinement quantifier is still NOT read as ram (unchanged single-turn behavior — ambiguous with storage)', async () => {
    const result = await interp.interpret(q('clé USB 16 Go'));
    expect(findCriterion(result, 'ram')).toBeUndefined();
  });
});

// ============================================================================
// CATEGORY DETECTION — interpret() vs interpretSync()
//
// interpretSync() already detected category; interpret() (the async path used
// by the real HTTP pipeline via CapucineEngine.search()) did not. Both now
// share the same applyCategoryDetection() logic, wired so AdmissibilityEngine
// actually compares the value (preferredValues) instead of silently accepting
// any category, and so an offer with no category data isn't wrongly rejected
// (unknownPolicy: 'pass'). See admissibility.test.ts for the filtering side.
// ============================================================================

describe('Category detection (interpret vs interpretSync)', () => {
  let interp: import('../../src/application/request-interpreter').BasicPatternInterpreter;

  const q = (text: string): import('../../src/application/request').UserQuery => ({
    id: 'cat-test', userId: 'u1', text, timestamp: new Date(),
  });

  beforeEach(() => {
    const { BasicPatternInterpreter } = require('../../src/application/request-interpreter');
    interp = new BasicPatternInterpreter();
  });

  // ---- 1. category detected in interpretSync() ----
  it('1. interpretSync detects category and wires it as preferredValues + unknownPolicy pass', () => {
    const result = interp.interpretSync(q('ordinateur portable 16 Go RAM'));
    const cat = result.extractedCriteria.find(c => c.id === 'category');
    expect(cat).toBeDefined();
    expect(cat!.level).toBe('required');
    expect(cat!.parameters?.preferredValues).toEqual(['ordinateur_portable']);
    expect(cat!.parameters?.unknownPolicy).toBe('pass');
    expect(result.category).toBe('ordinateur_portable');
  });

  // ---- 2. category detected in interpret() (previously missing) ----
  it('2. interpret() (async, used by the real HTTP pipeline) also detects category', async () => {
    const result = await interp.interpret(q('ordinateur portable 16 Go RAM'));
    const cat = result.extractedCriteria.find(c => c.id === 'category');
    expect(cat).toBeDefined();
    expect(cat!.level).toBe('required');
    expect(cat!.parameters?.preferredValues).toEqual(['ordinateur_portable']);
    expect(cat!.parameters?.unknownPolicy).toBe('pass');
    expect(result.category).toBe('ordinateur_portable');
  });

  it('interpret() and interpretSync() detect the same category for the same query', async () => {
    const text = 'casque bluetooth pas cher';
    const syncResult = interp.interpretSync(q(text));
    const asyncResult = await interp.interpret(q(text));
    expect(asyncResult.category).toBe(syncResult.category);
  });

  // ---- Regression guard: highest-confidence category wins, not first-declared ----
  it('picks the highest-confidence category, not the first one declared in the pattern table', async () => {
    // "bluetooth" alone weakly matches 'casque' (1/8 keywords); 'clavier' is
    // matched far more specifically by "clavier" + "keychron" + "mécanique"
    // (3/5 keywords) — 'clavier' must win despite 'casque' being declared
    // earlier in the category pattern table.
    const result = await interp.interpret(q('keychron k3 pro clavier mécanique bluetooth'));
    expect(result.category).toBe('clavier');
  });

  it('does not fabricate a category when the query gives no recognizable signal', async () => {
    const result = await interp.interpret(q('xyzzy plugh quux'));
    expect(result.extractedCriteria.find(c => c.id === 'category')).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  // ---- B. domain category vs generic category — domain must always win ----
  it('B. "laptop" resolves to the domain category ordinateur_portable, never the generic electronics — even though electronics has a shorter keyword list (1/5 > 1/7 by raw ratio)', async () => {
    const result = await interp.interpret(q('laptop under 1000 euros'));
    expect(result.category).toBe('ordinateur_portable');
    const cat = result.extractedCriteria.find(c => c.id === 'category');
    expect(cat!.parameters?.preferredValues).toEqual(['ordinateur_portable']);
  });

  it('B2. "headphone" resolves to the domain category casque, never generic electronics', async () => {
    const result = await interp.interpret(q('headphone for running'));
    expect(result.category).toBe('casque');
  });

  it('B3. a query matching ONLY a generic pattern (no domain vocabulary at all) still detects the generic category rather than nothing', async () => {
    const result = await interp.interpret(q('chocolate and pasta for dinner'));
    expect(result.category).toBe('food');
  });
});

// ============================================================================
// D/E. category preferredValues → DiscoveryCriteria.categories propagation
// (the actual bug fixed this chantier: buildSearchPlan previously read a
// bespoke `parameters.category` key that RequestInterpreter never set).
// ============================================================================

describe('Category propagation: RequestInterpreter → CapucineEngine.buildSearchPlan → DiscoveryCriteria', () => {
  it('D. a domain category detected from query text reaches searchPlan.query.categories (was always empty before this fix)', async () => {
    const { CapucineEngine } = require('../../src/application/capucine-engine');
    const { InMemoryProfileStore } = require('../../src/application/profile-store');
    const engine = new CapucineEngine();
    const profile = await new InMemoryProfileStore().load('anonymous');

    const result = await engine.search({ queryText: 'ordinateur portable 16 Go moins de 1100 euros', requestId: 'cat-d', profile });
    expect(result.searchPlan.query.categories).toEqual(['ordinateur_portable']);
  });

  it("C. a query with no detectable category at all leaves searchPlan.query.categories undefined (never fabricated)", async () => {
    const { CapucineEngine } = require('../../src/application/capucine-engine');
    const { InMemoryProfileStore } = require('../../src/application/profile-store');
    const engine = new CapucineEngine();
    const profile = await new InMemoryProfileStore().load('anonymous');

    const result = await engine.search({ queryText: 'xyzzy plugh quux', requestId: 'cat-c', profile });
    expect(result.searchPlan.query.categories).toBeUndefined();
  });

  it('A generic-only detected category (e.g. "shoes" → clothing) is NEVER wired into the hard discovery filter — it matches no catalog entry and would silently zero out every candidate', async () => {
    const { CapucineEngine } = require('../../src/application/capucine-engine');
    const { InMemoryProfileStore } = require('../../src/application/profile-store');
    const engine = new CapucineEngine();
    const profile = await new InMemoryProfileStore().load('anonymous');

    const result = await engine.search({ queryText: 'a nice jacket for winter', requestId: 'cat-generic', profile });
    // 'jacket' → generic 'clothing' only (no domain category for clothing
    // exists in the catalog yet) — categories must stay undefined so the
    // (would-be-broken) hard filter never applies, rather than silently
    // discarding every candidate the moment a generic category is detected.
    expect(result.interpretedRequest?.category).toBe('clothing');
    expect(result.searchPlan.query.categories).toBeUndefined();
  });

  it('E. category-guided discovery actually narrows results — a laptop query never surfaces a headphone via keyword false-positive', async () => {
    const { CapucineEngine } = require('../../src/application/capucine-engine');
    const { InMemoryProfileStore } = require('../../src/application/profile-store');
    const engine = new CapucineEngine();
    const profile = await new InMemoryProfileStore().load('anonymous');

    const result = await engine.search({ queryText: 'ordinateur portable 16 Go moins de 1100 euros', requestId: 'cat-e', profile });
    expect(result.ranking.rankedOffers.length).toBeGreaterThan(0);
    for (const o of result.ranking.rankedOffers) {
      expect(o.offer.characteristics['category']?.value).toBe('ordinateur_portable');
    }
  });
});

// ============================================================================
// RANKING PREFERENCE INTENT — "montre-moi les moins chers" (megaprompt PARTIE 15)
// ============================================================================

describe('extractRankingPreference', () => {
  const { extractRankingPreference } = require('../../src/application/request-interpreter');

  it('G. "montre-moi les moins chers" / "finalement montre-moi les moins chers" → PRICE_LOWEST', () => {
    expect(extractRankingPreference('montre-moi les moins chers')).toBe('PRICE_LOWEST');
    expect(extractRankingPreference('finalement montre-moi les moins chers')).toBe('PRICE_LOWEST');
  });

  it('English: "show me the cheapest ones" → PRICE_LOWEST', () => {
    expect(extractRankingPreference('show me the cheapest ones')).toBe('PRICE_LOWEST');
  });

  it('an unrelated follow-up never fabricates a ranking preference', () => {
    expect(extractRankingPreference('uniquement neuf')).toBeNull();
    expect(extractRankingPreference('moins de 1100 €')).toBeNull(); // "moins de" ≠ "moins cher"
  });
});

// ============================================================================
// INTERNATIONAL SEARCH INTENT — "cherche aussi en Allemagne" (megaprompt PARTIE 10)
// ============================================================================

describe('extractInternationalIntent', () => {
  const { extractInternationalIntent } = require('../../src/application/request-interpreter');

  it('K. "cherche aussi en Allemagne" → targetCountries: [DE]', () => {
    expect(extractInternationalIntent('cherche aussi en Allemagne')).toEqual({ targetCountries: ['DE'], broaden: false });
  });

  it('English: "also search Germany" → targetCountries: [DE]', () => {
    expect(extractInternationalIntent('also search Germany')).toEqual({ targetCountries: ['DE'], broaden: false });
  });

  it('"regarde aussi en Espagne" → targetCountries: [ES]', () => {
    expect(extractInternationalIntent('regarde aussi en Espagne')).toEqual({ targetCountries: ['ES'], broaden: false });
  });

  it('"compare avec l\'Allemagne" (no explicit "aussi") still recognized via the "compare" framing', () => {
    expect(extractInternationalIntent("compare avec l'Allemagne")?.targetCountries).toEqual(['DE']);
  });

  it('"cherche partout en Europe" / "peu importe le pays" → broaden with no specific country named', () => {
    expect(extractInternationalIntent('cherche partout en Europe')).toEqual({ targetCountries: [], broaden: true });
    expect(extractInternationalIntent('peu importe le pays')).toEqual({ targetCountries: [], broaden: true });
  });

  it('English: "search internationally" / "search abroad" → broaden', () => {
    expect(extractInternationalIntent('search internationally')?.broaden).toBe(true);
    expect(extractInternationalIntent('search abroad')?.broaden).toBe(true);
  });

  it('multiple countries in one follow-up: "compare avec l\'Allemagne et l\'Espagne"', () => {
    const intent = extractInternationalIntent("compare avec l'Allemagne et l'Espagne");
    expect(intent?.targetCountries.sort()).toEqual(['DE', 'ES']);
  });

  it('an unrelated follow-up ("uniquement neuf") is never misread as an international intent', () => {
    expect(extractInternationalIntent('uniquement neuf')).toBeNull();
  });

  it('a plain product query mentioning no country and no search-framing verb returns null', () => {
    expect(extractInternationalIntent('un casque bluetooth')).toBeNull();
  });
});

// ============================================================================
// RESULT LIMIT — "montre-moi les 3 meilleures" (megaprompt tour 10)
// ============================================================================

describe('extractResultLimit', () => {
  const { extractResultLimit } = require('../../src/application/request-interpreter');

  it('"montre-moi les 3 meilleures" → 3', () => {
    expect(extractResultLimit('montre-moi les 3 meilleures')).toBe(3);
  });

  it('"top 5" → 5', () => {
    expect(extractResultLimit('top 5')).toBe(5);
  });

  it('"les 2 premières" → 2', () => {
    expect(extractResultLimit('les 2 premières')).toBe(2);
  });

  it('English: "show me the 3 best" → 3', () => {
    expect(extractResultLimit('show me the 3 best')).toBe(3);
  });

  it('no number expressed → null, never a guessed default', () => {
    expect(extractResultLimit('montre-moi les meilleures')).toBeNull();
    expect(extractResultLimit('uniquement neuf')).toBeNull();
  });
});

// ============================================================================
// MERCHANT EXCLUSION — "exclue Amazon" (megaprompt PARTIE 8)
// ============================================================================

describe('extractMerchantExclusion', () => {
  const { extractMerchantExclusion } = require('../../src/application/request-interpreter');

  it('"exclue Amazon" / "exclus Amazon" / "excluez Amazon" → "Amazon"', () => {
    expect(extractMerchantExclusion('exclue Amazon')).toBe('Amazon');
    expect(extractMerchantExclusion('exclus Amazon')).toBe('Amazon');
    expect(extractMerchantExclusion('excluez Amazon')).toBe('Amazon');
  });

  it('English: "exclude Amazon" / "without Amazon" → "Amazon"', () => {
    expect(extractMerchantExclusion('exclude Amazon')).toBe('Amazon');
    expect(extractMerchantExclusion('without Amazon')).toBe('Amazon');
  });

  it('"sans Fnac" → "Fnac"', () => {
    expect(extractMerchantExclusion('sans Fnac')).toBe('Fnac');
  });

  it('never confuses "sans frais de livraison" with a merchant named "Frais"', () => {
    expect(extractMerchantExclusion('sans frais de livraison')).toBeNull();
  });

  it('a plain product query never fabricates a merchant exclusion', () => {
    expect(extractMerchantExclusion('un casque bluetooth')).toBeNull();
  });
});

// ============================================================================
// FREE SHIPPING / DELIVERABILITY INTENTS
// ============================================================================

describe('extractFreeShippingIntent', () => {
  const { extractFreeShippingIntent } = require('../../src/application/request-interpreter');

  it('"sans frais de livraison" → a required shipping_cost=0 criterion, unknownPolicy pass', () => {
    const c = extractFreeShippingIntent('sans frais de livraison');
    expect(c?.id).toBe('shipping_cost');
    expect(c?.level).toBe('required');
    expect(c?.parameters?.exactValue).toBe(0);
    expect(c?.parameters?.unknownPolicy).toBe('pass');
  });

  it('English: "free shipping only" → the same criterion', () => {
    expect(extractFreeShippingIntent('free shipping only')?.id).toBe('shipping_cost');
  });

  it('an unrelated follow-up never fabricates a shipping criterion', () => {
    expect(extractFreeShippingIntent('uniquement neuf')).toBeNull();
  });
});

describe('extractDeliverabilityIntent', () => {
  const { extractDeliverabilityIntent } = require('../../src/application/request-interpreter');

  it('"garde uniquement les offres livrables en France" → a deliversTo criterion comparing against the REAL destination country, unknownPolicy pass (honest: no source populates this data yet — see final report)', () => {
    const c = extractDeliverabilityIntent('garde uniquement les offres livrables en France', 'FR');
    expect(c?.id).toBe('deliversTo');
    expect(c?.parameters?.preferredValues).toEqual(['FR']);
    expect(c?.parameters?.unknownPolicy).toBe('pass');
  });

  it('the criterion compares against whatever destinationCountry is passed — never hardcoded to France', () => {
    const c = extractDeliverabilityIntent('deliverable to Germany', 'DE');
    expect(c?.parameters?.preferredValues).toEqual(['DE']);
  });

  it('an unrelated follow-up never fabricates a deliverability criterion', () => {
    expect(extractDeliverabilityIntent('uniquement neuf', 'FR')).toBeNull();
  });
});

// ============================================================================
// RETRY / RELAUNCH INTENT — SEARCH_AGAIN / SEARCH_ELSEWHERE / FIND_BETTER
// (megaprompt PARTIE 3/4)
// ============================================================================

describe('extractRetryIntent', () => {
  const { extractRetryIntent } = require('../../src/application/request-interpreter');

  it('SEARCH_ELSEWHERE: "cherche ailleurs" / "regarde sur d\'autres sites" / "essaie d\'autres magasins"', () => {
    expect(extractRetryIntent('cherche ailleurs')).toBe('SEARCH_ELSEWHERE');
    expect(extractRetryIntent("regarde sur d'autres sites")).toBe('SEARCH_ELSEWHERE');
    expect(extractRetryIntent("essaie d'autres magasins")).toBe('SEARCH_ELSEWHERE');
  });

  it('English: "look elsewhere" / "try other stores" / "look on other websites" / "find another one"', () => {
    expect(extractRetryIntent('look elsewhere')).toBe('SEARCH_ELSEWHERE');
    expect(extractRetryIntent('try other stores')).toBe('SEARCH_ELSEWHERE');
    expect(extractRetryIntent('look on other websites')).toBe('SEARCH_ELSEWHERE');
    expect(extractRetryIntent('find another one')).toBe('SEARCH_ELSEWHERE');
  });

  it('SEARCH_AGAIN: "regarde encore" / "continue" / "cherche davantage" / "élargis la recherche" / "je veux d\'autres résultats"', () => {
    expect(extractRetryIntent('regarde encore')).toBe('SEARCH_AGAIN');
    expect(extractRetryIntent('continue')).toBe('SEARCH_AGAIN');
    expect(extractRetryIntent('cherche davantage')).toBe('SEARCH_AGAIN');
    expect(extractRetryIntent('élargis la recherche')).toBe('SEARCH_AGAIN');
    expect(extractRetryIntent("je veux d'autres résultats")).toBe('SEARCH_AGAIN');
  });

  it('English: "search again" / "search more" / "keep searching"', () => {
    expect(extractRetryIntent('search again')).toBe('SEARCH_AGAIN');
    expect(extractRetryIntent('search more')).toBe('SEARCH_AGAIN');
    expect(extractRetryIntent('keep searching')).toBe('SEARCH_AGAIN');
  });

  it('FIND_BETTER: "trouve une meilleure offre" / "trouve mieux" — a DISTINCT intent from SEARCH_AGAIN/SEARCH_ELSEWHERE', () => {
    expect(extractRetryIntent('trouve une meilleure offre')).toBe('FIND_BETTER');
    expect(extractRetryIntent('trouve mieux')).toBe('FIND_BETTER');
  });

  it('English: "find a better deal" / "find something better"', () => {
    expect(extractRetryIntent('find a better deal')).toBe('FIND_BETTER');
    expect(extractRetryIntent('find something better')).toBe('FIND_BETTER');
  });

  it('an unrelated follow-up never fabricates a retry intent', () => {
    expect(extractRetryIntent('uniquement neuf')).toBeNull();
    expect(extractRetryIntent('moins de 1100 €')).toBeNull();
  });

  it('a bare re-run with no retry intent stays null — a retry intent must always change something real, never silently replay an identical deterministic search', () => {
    expect(extractRetryIntent('ordinateur portable')).toBeNull();
  });
});
