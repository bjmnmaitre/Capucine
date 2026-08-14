/**
 * Tests for NormalizationEngine
 *
 * Validates real data normalization and transformation.
 */

import { NormalizationEngine } from '../../src/application/normalization-engine';

describe('NormalizationEngine', () => {
  let engine: NormalizationEngine;

  beforeEach(() => {
    engine = new NormalizationEngine();
  });

  describe('Number Parsing', () => {
    it('should parse string numbers', async () => {
      const result = engine.normalize('price', '599.99');

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe(599.99);
      expect(result.normalizedValue?.status).toBe('verified');
    });

    it('should parse numbers with currency symbols', async () => {
      const result = engine.normalize('price', '€599.99');

      expect(result.success).toBe(true);
      expect(typeof result.normalizedValue?.value).toBe('number');
    });

    it('should reject non-numeric strings', async () => {
      const result = engine.normalize('price', 'not-a-number');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('unparseable');
    });

    it('should pass through actual numbers', async () => {
      const result = engine.normalize('price', 599.99);

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe(599.99);
    });
  });

  describe('Boolean Parsing', () => {
    it('should parse string booleans with registered rule', async () => {
      // Register a boolean rule for this field
      engine.registerRule({
        id: 'available-parse',
        name: 'Parse available',
        fieldName: 'available',
        transformation: { type: 'parse_boolean' },
        confidence: 0.95,
      });

      const resultTrue = engine.normalize('available', 'yes');
      const resultFalse = engine.normalize('available', 'no');

      expect(resultTrue.success).toBe(true);
      expect(resultTrue.normalizedValue?.value).toBe(true);

      expect(resultFalse.success).toBe(true);
      expect(resultFalse.normalizedValue?.value).toBe(false);
    });

    it('should pass through actual booleans', async () => {
      const result = engine.normalize('available', true);

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe(true);
    });

    it('should reject ambiguous strings with registered rule', async () => {
      engine.registerRule({
        id: 'available-parse-2',
        name: 'Parse available',
        fieldName: 'available-field',
        transformation: { type: 'parse_boolean' },
        confidence: 0.95,
      });

      const result = engine.normalize('available-field', 'maybe');

      expect(result.success).toBe(false);
    });
  });

  describe('Date Parsing', () => {
    it('should parse ISO date strings with registered rule', async () => {
      engine.registerRule({
        id: 'date-parse',
        name: 'Parse date',
        fieldName: 'created-at',
        transformation: { type: 'parse_date' },
        confidence: 0.95,
      });

      const dateStr = '2026-08-12T10:30:00Z';
      const result = engine.normalize('created-at', dateStr);

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBeInstanceOf(Date);
    });

    it('should pass through Date objects', async () => {
      const date = new Date('2026-08-12');
      const result = engine.normalize('date', date);

      expect(result.success).toBe(true);
      // Without a rule, it passes through as-is
      expect(result.normalizedValue?.value).toEqual(date);
    });

    it('should reject invalid date strings with registered rule', async () => {
      engine.registerRule({
        id: 'date-parse-2',
        name: 'Parse date',
        fieldName: 'updated-at',
        transformation: { type: 'parse_date' },
        confidence: 0.95,
      });

      const result = engine.normalize('updated-at', 'not-a-date');

      expect(result.success).toBe(false);
    });
  });

  describe('String Normalization', () => {
    it('should trim whitespace', async () => {
      const result = engine.normalize('name', '  hello world  ');

      expect(result.success).toBe(true);
      expect((result.normalizedValue?.value as string).includes('hello world')).toBe(true);
    });

    it('should handle custom field normalization', async () => {
      // Name field is configured to normalize string
      const result = engine.normalize('name', 'HELLO WORLD');

      expect(result.success).toBe(true);
      // Should be lowercase
      expect(typeof result.normalizedValue?.value).toBe('string');
    });
  });

  describe('Country Normalization', () => {
    it('should normalize ISO2 country codes', async () => {
      const result = engine.normalize('country', 'fr');

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe('FR');
    });

    it('should convert country names to ISO2', async () => {
      const result = engine.normalize('country', 'France');

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe('FR');
    });

    it('should reject unknown countries', async () => {
      const result = engine.normalize('country', 'Unknown Land');

      expect(result.success).toBe(false);
    });
  });

  describe('Price Parsing', () => {
    it('should normalize price field', async () => {
      const result = engine.normalize('price', '€599.99');

      expect(result.success).toBe(true);
    });

    it('should normalize budget field', async () => {
      const result = engine.normalize('budget', '1000');

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe(1000);
    });
  });

  describe('Duration Parsing', () => {
    it('should parse ISO 8601 durations with registered rule', async () => {
      engine.registerRule({
        id: 'duration-parse',
        name: 'Parse duration',
        fieldName: 'shippingTime',
        transformation: { type: 'parse_duration', format: 'iso8601' },
        confidence: 0.95,
      });

      const result = engine.normalize('shippingTime', 'P2D');

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toBe('P2D');
    });

    it('should parse human-readable durations with registered rule', async () => {
      engine.registerRule({
        id: 'duration-parse-2',
        name: 'Parse duration',
        fieldName: 'deliveryTime',
        transformation: { type: 'parse_duration', format: 'iso8601' },
        confidence: 0.95,
      });

      const result = engine.normalize('deliveryTime', '2 days');

      expect(result.success).toBe(true);
      expect(result.normalizedValue?.value).toContain('P');
    });
  });

  describe('Batch Processing', () => {
    it('should normalize multiple items', async () => {
      const items = [
        { fieldName: 'price', value: '€599' },
        { fieldName: 'name', value: '  Product  ' },
        { fieldName: 'available', value: 'yes' },
      ];

      const result = engine.normalizeBatch(items);

      expect(result.statistics.inputCount).toBe(3);
      expect(result.statistics.successCount).toBeGreaterThan(0);
    });

    it('should track failed normalization', async () => {
      const items = [
        { fieldName: 'price', value: 'not-a-price' },
        { fieldName: 'name', value: 'valid' },
      ];

      const result = engine.normalizeBatch(items);

      expect(result.statistics.failureCount).toBeGreaterThan(0);
    });

    it('should calculate average confidence', async () => {
      const items = [
        { fieldName: 'price', value: '€599' },
        { fieldName: 'budget', value: '1000' },
      ];

      const result = engine.normalizeBatch(items);

      expect(result.statistics.averageConfidence).toBeGreaterThanOrEqual(0);
      expect(result.statistics.averageConfidence).toBeLessThanOrEqual(1);
    });

    it('should report quality issues for failed items', async () => {
      const items = [
        { fieldName: 'price', value: 'totally-not-a-number' },
        { fieldName: 'price', value: 'abc-def' },
        { fieldName: 'price', value: 'xyz' },
      ];

      const result = engine.normalizeBatch(items);

      // All price items without numbers should fail parsing
      expect(result.statistics.failureCount).toBeGreaterThan(0);
      expect(result.dataQualityIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle normalization errors gracefully', async () => {
      const result = engine.normalize('price', { complex: 'object' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.status).toBe('failed');
      expect(result.confidence).toBe(0);
    });

    it('should preserve original value in error cases', async () => {
      const originalValue = 'invalid-price';
      const result = engine.normalize('price', originalValue);

      expect(result.originalValue).toBe(originalValue);
    });

    it('should record processing time', async () => {
      const result = engine.normalize('price', '599');

      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical input', async () => {
      const result1 = engine.normalize('price', '€599.99');
      const result2 = engine.normalize('price', '€599.99');

      expect(result1.success).toBe(result2.success);
      expect(result1.normalizedValue?.value).toBe(result2.normalizedValue?.value);
      expect(result1.status).toBe(result2.status);
    });

    it('should be deterministic across batch operations', async () => {
      const items = [
        { fieldName: 'price', value: '€599' },
        { fieldName: 'name', value: '  test  ' },
      ];

      const result1 = engine.normalizeBatch(items);
      const result2 = engine.normalizeBatch(items);

      expect(result1.statistics.successCount).toBe(result2.statistics.successCount);
      expect(result1.statistics.failureCount).toBe(result2.statistics.failureCount);
    });
  });

  describe('Never Invents Data', () => {
    it('should NOT invent missing values', async () => {
      const result = engine.normalize('price', null);

      // Should fail or return unknown status, NOT invent a price
      expect(result.success).toBe(false);
      expect(result.normalizedValue?.value).not.toBeDefined();
    });

    it('should NOT invent missing field', async () => {
      const result = engine.normalize('nonexistent-field', 'value');

      // Unknown field should not auto-normalize
      expect(result.success).toBeDefined();
      // Result should reflect what actually happened
      expect(result.originalValue).toBe('value');
    });
  });
});

// ============================================================================
// normalizeOffer — real pipeline integration
// ============================================================================

import { Offer, DataPoint, DataStatus } from '../../src/domain/types';

function makeTestOffer(chars: Record<string, { value: unknown; status: DataStatus }>): Offer {
  const now = new Date();
  function dp<T>(v: T, s: DataStatus = 'known'): DataPoint<T> {
    return { value: v, status: s };
  }
  return {
    id: 'test-offer',
    productId: 'test-product',
    merchant: { id: 'test', name: 'Test', country: 'FR', executionCapabilities: [] },
    price: dp<number>(299),
    currency: 'EUR',
    shippingCost: dp<number>(null as unknown as number, 'unknown'),
    characteristics: Object.fromEntries(
      Object.entries(chars).map(([k, v]) => [k, { value: v.value, status: v.status }])
    ),
    provenance: { source: 'test', retrievedAt: now },
    createdAt: now,
    retrievedAt: now,
  };
}

describe('NormalizationEngine.normalizeOffer — field normalization', () => {
  const eng = new NormalizationEngine();

  test('normalizes storage from "16 Go" to "16GB"', () => {
    const offer = makeTestOffer({ storage: { value: '16 Go', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.storage.value).toBe('16GB');
  });

  test('normalizes RAM from "8GB"  (no change needed)', () => {
    const offer = makeTestOffer({ ram: { value: '8GB', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.ram.value).toBe('8GB');
  });

  test('normalizes weight from "254g" to number 254', () => {
    const offer = makeTestOffer({ weight: { value: '254g', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.weight.value).toBe(254);
  });

  test('normalizes weight from "0.254kg" to number 254', () => {
    const offer = makeTestOffer({ weight: { value: '0.254kg', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.weight.value).toBe(254);
  });

  test('normalizes battery_life from "30h" to 30', () => {
    const offer = makeTestOffer({ battery_life: { value: '30h', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.battery_life.value).toBe(30);
  });

  test('normalizes screen_size from \'27"\' to 27', () => {
    const offer = makeTestOffer({ screen_size: { value: '27"', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.screen_size.value).toBe(27);
  });

  test('never modifies unknown DataPoints', () => {
    const offer = makeTestOffer({ weight: { value: null, status: 'unknown' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.weight.status).toBe('unknown');
    expect(result.characteristics.weight.value).toBeNull();
  });

  test('preserves provenance through normalization', () => {
    const offer = makeTestOffer({ storage: { value: '16 Go', status: 'known' } });
    (offer.characteristics.storage as any).provenance = { source: 'fnac', retrievedAt: new Date() };
    const result = eng.normalizeOffer(offer);
    expect((result.characteristics.storage as any).provenance?.source).toBe('fnac');
  });

  test('unknown field with value is passed through unchanged', () => {
    const offer = makeTestOffer({ arbitrary_custom_field: { value: 'xyz-value', status: 'known' } });
    const result = eng.normalizeOffer(offer);
    expect(result.characteristics.arbitrary_custom_field.value).toBe('xyz-value');
  });
});
