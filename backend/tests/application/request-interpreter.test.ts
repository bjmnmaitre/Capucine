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
});
