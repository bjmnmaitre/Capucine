/**
 * Capucine Application Layer — Normalization Engine
 *
 * REAL IMPLEMENTATION: Transforms raw heterogeneous data into clean consistent data.
 *
 * This EXECUTES normalization:
 * - Applies transformation rules
 * - Handles parsing errors explicitly
 * - Preserves provenance
 * - Never invents missing values
 * - Produces quality metrics
 */

import { NormalizationRule, NormalizationResult, NormalizationTransform, NormalizationError, BatchNormalizationResult, DataQualityIssue, FieldNormalizationStrategy } from './normalization';
import { DataPoint, DataStatus, Offer } from '../domain/types';
import { Source } from './provenance';

// ============================================================================
// NORMALIZATION ENGINE
// ============================================================================

/**
 * Applies normalization rules to raw data.
 * DETERMINISTIC: Same input always produces same output.
 */
export class NormalizationEngine {
  private rules: Map<string, NormalizationRule> = new Map();
  private fieldStrategies: Map<string, FieldNormalizationStrategy> = new Map();

  constructor() {
    // Register default rules
    this.registerDefaultRules();
  }

  // ========================================================================
  // RULE MANAGEMENT
  // ========================================================================

  /**
   * Register a normalization rule.
   */
  registerRule(rule: NormalizationRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Register a field strategy.
   */
  registerFieldStrategy(strategy: FieldNormalizationStrategy): void {
    this.fieldStrategies.set(strategy.fieldName, strategy);
  }

  /**
   * List registered rules for a field.
   */
  getRulesForField(fieldName: string): NormalizationRule[] {
    return Array.from(this.rules.values()).filter(r => r.fieldName === fieldName);
  }

  // ========================================================================
  // NORMALIZATION
  // ========================================================================

  /**
   * Normalize a single value.
   */
  normalize<T = unknown>(
    fieldName: string,
    value: unknown,
    sourceType?: string
  ): NormalizationResult<T> {
    const startTime = Date.now();
    const appliedRules: NormalizationRule[] = [];

    try {
      // Find applicable rules
      const candidateRules = this.getRulesForField(fieldName).filter(r => {
        if (!r.applicableTo) return true; // Always applicable
        if (sourceType && r.applicableTo.sourceType?.includes(sourceType)) return true;
        return false;
      });

      if (candidateRules.length === 0) {
        // No rules apply; return value as-is with known status
        return {
          success: true,
          normalizedValue: {
            value: value as T,
            status: 'known' as DataStatus,
          },
          status: 'partial',
          originalValue: value,
          originalType: typeof value,
          appliedRules: [],
          transformations: [],
          confidence: 0.5,
          processingTime: Date.now() - startTime,
        };
      }

      // Apply rules in order
      let transformed = value;
      for (const rule of candidateRules) {
        const result = this.applyRule(transformed, rule);
        if (!result.success) {
          return {
            success: false,
            status: 'failed',
            error: result.error,
            originalValue: value,
            originalType: typeof value,
            appliedRules,
            transformations: [],
            confidence: 0,
            processingTime: Date.now() - startTime,
          };
        }
        transformed = result.value;
        appliedRules.push(rule);
      }

      // Success
      return {
        success: true,
        normalizedValue: {
          value: transformed as T,
          status: 'verified' as DataStatus,
        },
        status: 'success',
        originalValue: value,
        originalType: typeof value,
        appliedRules,
        transformations: appliedRules.map(r => ({
          stage: 'normalization',
          transformationType: 'normalized',
          inputValue: value,
          outputValue: transformed,
          rule: r.name,
          timestamp: new Date(),
          confidence: r.confidence,
        })),
        confidence: Math.min(...appliedRules.map(r => r.confidence)),
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        error: {
          code: 'other',
          message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        },
        originalValue: value,
        originalType: typeof value,
        appliedRules,
        transformations: [],
        confidence: 0,
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Apply a single rule.
   */
  private applyRule(
    value: unknown,
    rule: NormalizationRule
  ): { success: boolean; value?: unknown; error?: NormalizationError } {
    try {
      switch (rule.transformation.type) {
        case 'parse_number':
          return this.parseNumber(value, rule.transformation);
        case 'parse_boolean':
          return this.parseBoolean(value, rule.transformation);
        case 'parse_date':
          return this.parseDate(value, rule.transformation);
        case 'parse_price':
          return this.parsePrice(value, rule.transformation);
        case 'parse_duration':
          return this.parseDuration(value, rule.transformation);
        case 'normalize_string':
          return this.normalizeString(value, rule.transformation);
        case 'normalize_country':
          return this.normalizeCountry(value, rule.transformation);
        case 'normalize_category':
          return this.normalizeCategory(value, rule.transformation);
        case 'trim_whitespace':
          return { success: true, value: typeof value === 'string' ? value.trim() : value };
        case 'regex_extract':
          return this.regexExtract(value, rule.transformation);
        case 'custom':
          return {
            success: true,
            value: rule.transformation.handler(value),
          };
        default:
          return {
            success: false,
            error: { code: 'other', message: `Unknown transformation type` },
          };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'other',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // ========================================================================
  // TRANSFORMATION IMPLEMENTATIONS
  // ========================================================================

  private parseNumber(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'parse_number' }>
  ): { success: boolean; value?: number; error?: NormalizationError } {
    if (typeof value === 'number') return { success: true, value };
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
      if (isNaN(num)) {
        return {
          success: false,
          error: { code: 'unparseable', message: `Cannot parse "${value}" as number` },
        };
      }
      const places = transform.decimalPlaces ?? 2;
      return { success: true, value: Math.round(num * Math.pow(10, places)) / Math.pow(10, places) };
    }
    return { success: false, error: { code: 'unparseable', message: `Expected number or string, got ${typeof value}` } };
  }

  private parseBoolean(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'parse_boolean' }>
  ): { success: boolean; value?: boolean; error?: NormalizationError } {
    if (typeof value === 'boolean') return { success: true, value };
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      const trueValues = transform.trueValues || ['yes', 'true', '1', 'ok', 'oui'];
      const falseValues = transform.falseValues || ['no', 'false', '0', 'non'];
      if (trueValues.includes(lower)) return { success: true, value: true };
      if (falseValues.includes(lower)) return { success: true, value: false };
      return {
        success: false,
        error: { code: 'unparseable', message: `Cannot parse "${value}" as boolean` },
      };
    }
    return { success: false, error: { code: 'unparseable', message: `Expected boolean or string` } };
  }

  private parseDate(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'parse_date' }>
  ): { success: boolean; value?: Date; error?: NormalizationError } {
    if (value instanceof Date) return { success: true, value };
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return { success: true, value: date };
      }
      return {
        success: false,
        error: { code: 'unparseable', message: `Cannot parse "${value}" as date` },
      };
    }
    return { success: false, error: { code: 'unparseable', message: `Expected date or string` } };
  }

  private parsePrice(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'parse_price' }>
  ): { success: boolean; value?: { amount: number; currency: string }; error?: NormalizationError } {
    // Simple price parsing: try to extract number
    const numResult = this.parseNumber(value, { type: 'parse_number', decimalPlaces: 2 });
    if (numResult.success && numResult.value !== undefined) {
      return {
        success: true,
        value: {
          amount: numResult.value,
          currency: transform.targetCurrency || 'EUR',
        },
      };
    }
    return numResult as any;
  }

  private parseDuration(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'parse_duration' }>
  ): { success: boolean; value?: string; error?: NormalizationError } {
    if (typeof value === 'string') {
      if (transform.format === 'iso8601' && value.match(/^P[\dDTHMS]+$/)) {
        return { success: true, value };
      }
      // Try to parse human-readable durations
      const dayMatch = value.match(/(\d+)\s*days?/i);
      if (dayMatch) {
        return { success: true, value: `P${dayMatch[1]}D` };
      }
      return {
        success: false,
        error: { code: 'unparseable', message: `Cannot parse duration "${value}"` },
      };
    }
    return { success: false, error: { code: 'unparseable', message: `Expected string` } };
  }

  private normalizeString(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'normalize_string' }>
  ): { success: boolean; value?: string; error?: NormalizationError } {
    let str = typeof value === 'string' ? value : String(value);
    if (transform.toLowerCase) str = str.toLowerCase();
    if (transform.trim) str = str.trim();
    return { success: true, value: str };
  }

  private normalizeCountry(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'normalize_country' }>
  ): { success: boolean; value?: string; error?: NormalizationError } {
    if (typeof value !== 'string') {
      return { success: false, error: { code: 'unparseable', message: `Expected string` } };
    }

    const upper = value.toUpperCase();
    const format = transform.format || 'iso2';

    // ISO2 validation
    if (format === 'iso2' && upper.length === 2 && upper.match(/^[A-Z]{2}$/)) {
      return { success: true, value: upper };
    }

    // Basic country name mapping (expanded version in production)
    const countryMap: Record<string, string> = {
      france: 'FR',
      germany: 'DE',
      spain: 'ES',
      italy: 'IT',
      uk: 'GB',
      'united kingdom': 'GB',
      us: 'US',
      'united states': 'US',
      usa: 'US',
      japan: 'JP',
      china: 'CN',
      india: 'IN',
    };

    const mapped = countryMap[value.toLowerCase()];
    if (mapped) {
      return { success: true, value: mapped };
    }

    return {
      success: false,
      error: { code: 'unparseable', message: `Unknown country: "${value}"` },
    };
  }

  private normalizeCategory(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'normalize_category' }>
  ): { success: boolean; value?: string; error?: NormalizationError } {
    if (typeof value !== 'string') {
      return { success: false, error: { code: 'unparseable', message: `Expected string` } };
    }

    if (transform.categoryMap && transform.categoryMap[value]) {
      return { success: true, value: transform.categoryMap[value] };
    }

    return { success: true, value: value.toLowerCase() };
  }

  private regexExtract(
    value: unknown,
    transform: Extract<NormalizationTransform, { type: 'regex_extract' }>
  ): { success: boolean; value?: string; error?: NormalizationError } {
    if (typeof value !== 'string') {
      return { success: false, error: { code: 'unparseable', message: `Expected string` } };
    }

    try {
      const regex = new RegExp(transform.pattern);
      const match = value.match(regex);
      if (match) {
        const groupIndex = transform.groupIndex ?? 0;
        return { success: true, value: match[groupIndex] };
      }
      return {
        success: false,
        error: { code: 'unparseable', message: `Regex did not match` },
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'other', message: `Invalid regex: ${String(error)}` },
      };
    }
  }

  // ========================================================================
  // BATCH PROCESSING
  // ========================================================================
  // OFFER NORMALIZATION
  // ========================================================================

  /**
   * Normalize all characteristics of an Offer using registered rules.
   *
   * - Applies field-level normalization rules to each characteristic.
   * - DataPoints with status='unknown' or value=null are passed through unchanged.
   * - On successful normalization, the DataPoint value is updated.
   * - On normalization failure, the original value is preserved and a warning is noted.
   * - Provenance is NEVER removed or modified.
   * - INVARIANT: normalizeOffer never invents values for unknown fields.
   */
  normalizeOffer(offer: Offer): Offer {
    const normalizedChars: Record<string, DataPoint<unknown>> = {};

    for (const [field, dp] of Object.entries(offer.characteristics)) {
      // Never attempt to normalize unknown/null values
      if (dp.status === 'unknown' || dp.value === null) {
        normalizedChars[field] = dp;
        continue;
      }

      const result = this.normalize(field, dp.value);

      if (result.success && result.normalizedValue !== undefined) {
        const newValue = result.normalizedValue.value;
        // Only update if the value actually changed (avoid no-op mutations)
        if (newValue !== null && newValue !== dp.value) {
          normalizedChars[field] = {
            ...dp,
            value: newValue,
            // Keep original provenance — normalization is a transformation, not a new source
          };
        } else {
          normalizedChars[field] = dp;
        }
      } else {
        // Normalization failed or produced no result — keep original, preserve provenance
        normalizedChars[field] = dp;
      }
    }

    // Normalize price DataPoint if it has a parseable string value
    let price = offer.price;
    if (price.value !== null && typeof price.value === 'string') {
      const priceResult = this.normalize('price', price.value);
      if (priceResult.success && priceResult.normalizedValue?.value !== null) {
        price = { ...price, value: priceResult.normalizedValue!.value as number };
      }
    }

    return {
      ...offer,
      price,
      characteristics: normalizedChars,
    };
  }

  // ========================================================================

  /**
   * Normalize multiple data items.
   */
  normalizeBatch(
    items: Array<{ fieldName: string; value: unknown; source?: Source }>
  ): BatchNormalizationResult {
    const startTime = Date.now();
    const results = items.map(item =>
      this.normalize(item.fieldName, item.value, item.source?.type)
    );

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const dataQualityIssues: DataQualityIssue[] = [];
    if (failed.length > 0) {
      dataQualityIssues.push({
        fieldName: 'general',
        issueType: 'inconsistent_data',
        severity: 'high',
        description: `${failed.length}/${items.length} items failed normalization`,
        affectsRanking: true,
      });
    }

    const avgConfidence = results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

    return {
      id: `batch-${Date.now()}`,
      timestamp: new Date(),
      successfullyNormalized: {
        offers: [], // Would be populated with actual normalized offers
      },
      partiallySerialized: {
        offers: [],
      },
      failedItems: failed.map(f => ({
        identifier: `item-${Math.random()}`,
        reason: f.error?.message || 'Unknown error',
        originalData: f.originalValue,
      })),
      statistics: {
        inputCount: items.length,
        successCount: successful.length,
        partialCount: 0,
        failureCount: failed.length,
        averageConfidence: avgConfidence,
        totalProcessingTime: Date.now() - startTime,
      },
      warnings: failed.length > 0
        ? [`${failed.length} items could not be normalized`]
        : [],
      dataQualityIssues,
    };
  }

  // ========================================================================
  // DEFAULT RULES
  // ========================================================================

  private registerDefaultRules(): void {
    // Price normalization
    this.registerRule({
      id: 'price-parse',
      name: 'Parse price',
      fieldName: 'price',
      transformation: { type: 'parse_number', decimalPlaces: 2 },
      confidence: 0.95,
    });

    // Budget normalization
    this.registerRule({
      id: 'budget-parse',
      name: 'Parse budget',
      fieldName: 'budget',
      transformation: { type: 'parse_number', decimalPlaces: 2 },
      confidence: 0.95,
    });

    // Country normalization
    this.registerRule({
      id: 'country-parse',
      name: 'Normalize country',
      fieldName: 'country',
      transformation: { type: 'normalize_country', format: 'iso2' },
      confidence: 0.9,
    });

    // String normalization (trim + lowercase)
    this.registerRule({
      id: 'string-clean',
      name: 'Clean string',
      fieldName: 'name',
      transformation: { type: 'normalize_string', trim: true, toLowerCase: true },
      confidence: 0.99,
    });

    // ── Storage / RAM normalization ────────────────────────────────────────
    // Handles: "16GB", "16 GB", "16Go", "16 Go", "16 gb", "16 go", "16384 MB"
    // All normalized to canonical "<N>GB" (uppercase, no space)
    this.registerRule({
      id: 'storage-normalize',
      name: 'Normalize storage value',
      fieldName: 'storage',
      transformation: {
        type: 'custom',
        handler: (value) => normalizeStorageValue(value),
      },
      confidence: 0.97,
    });

    this.registerRule({
      id: 'ram-normalize',
      name: 'Normalize RAM value',
      fieldName: 'ram',
      transformation: {
        type: 'custom',
        handler: (value) => normalizeStorageValue(value),
      },
      confidence: 0.97,
    });

    this.registerRule({
      id: 'memory-normalize',
      name: 'Normalize memory value',
      fieldName: 'memory',
      transformation: {
        type: 'custom',
        handler: (value) => normalizeStorageValue(value),
      },
      confidence: 0.97,
    });

    this.registerRule({
      id: 'capacity-normalize',
      name: 'Normalize capacity value',
      fieldName: 'capacity',
      transformation: {
        type: 'custom',
        handler: (value) => normalizeStorageValue(value),
      },
      confidence: 0.97,
    });

    // ── Weight normalization ────────────────────────────────────────────────
    // Canonical: numeric grams (number). Input: "254g", "254 g", "0.254kg"
    this.registerRule({
      id: 'weight-normalize',
      name: 'Normalize weight to grams',
      fieldName: 'weight',
      transformation: {
        type: 'custom',
        handler: (value): number | null => {
          if (value === null || value === undefined) return null;
          const s = String(value).trim();
          // kg → g
          const kgM = s.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
          if (kgM) return Math.round(parseFloat(kgM[1]) * 1000);
          // g (already)
          const gM = s.match(/^(\d+(?:\.\d+)?)\s*g$/i);
          if (gM) return Math.round(parseFloat(gM[1]));
          // bare number (assume grams if >10, assume kg if ≤5)
          const numM = s.match(/^(\d+(?:\.\d+)?)$/);
          if (numM) {
            const n = parseFloat(numM[1]);
            if (n > 5) return Math.round(n);   // likely grams already
            if (n > 0) return Math.round(n * 1000); // likely kg
          }
          return null;
        },
      },
      confidence: 0.9,
    });

    // ── Battery life normalization ─────────────────────────────────────────
    // Canonical: numeric hours (number). Input: "30h", "30 heures", "30 hours"
    this.registerRule({
      id: 'battery-normalize',
      name: 'Normalize battery life to hours',
      fieldName: 'battery_life',
      transformation: {
        type: 'custom',
        handler: (value): number | null => {
          if (value === null || value === undefined) return null;
          const s = String(value).trim();
          const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|heures?|hours?|hrs?)$/i);
          if (m) return parseFloat(m[1]);
          const numM = s.match(/^(\d+(?:\.\d+)?)$/);
          if (numM) return parseFloat(numM[1]); // assume hours
          return null;
        },
      },
      confidence: 0.9,
    });

    // ── Screen size normalization ──────────────────────────────────────────
    // Canonical: numeric inches (number). Input: '27"', '27 pouces', '27 inch'
    this.registerRule({
      id: 'screen-size-normalize',
      name: 'Normalize screen size to inches',
      fieldName: 'screen_size',
      transformation: {
        type: 'custom',
        handler: (value): number | null => {
          if (value === null || value === undefined) return null;
          const s = String(value).trim();
          const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|pouces?|inches?|in\b)/i);
          if (m) return parseFloat(m[1]);
          const numM = s.match(/^(\d+(?:\.\d+)?)$/);
          if (numM) return parseFloat(numM[1]); // assume inches
          return null;
        },
      },
      confidence: 0.88,
    });
  }
}

// ============================================================================
// STORAGE NORMALIZATION UTILITY
// Extracted so it can be imported and unit-tested independently.
// ============================================================================

/**
 * Normalize storage/RAM values to canonical "<N>GB" format.
 *
 * Handles:
 * - "16GB", "16 GB", "16gb"           → "16GB"
 * - "16Go", "16 Go", "16 go"          → "16GB"  (French unit)
 * - "16 GB RAM"                        → "16GB"
 * - "16384 MB", "16384MB"             → "16GB"  (MB → GB conversion)
 * - "1TB", "1 TB", "1 To", "1 to"    → "1024GB"
 * - "512", "512.0"                    → null (no unit = unparseable)
 * - null, undefined, ""               → null
 */
export function normalizeStorageValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === '') return null;

  // Remove noise words: "RAM", "SSD", "HDD", "flash", "stockage"
  const cleaned = str
    .replace(/\b(RAM|SSD|HDD|eMMC|flash|stockage|storage|mémoire)\b/gi, '')
    .trim();

  // TB / To → GB (1 TB = 1024 GB)
  const tbMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:TB|To)\s*$/i);
  if (tbMatch) {
    const gb = Math.round(parseFloat(tbMatch[1]) * 1024);
    return `${gb}GB`;
  }

  // GB / Go → GB (canonical)
  const gbMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:GB|Go)\s*$/i);
  if (gbMatch) {
    const gb = Math.round(parseFloat(gbMatch[1]));
    return `${gb}GB`;
  }

  // MB → GB (only if >= 512 MB to avoid confusion with screen sizes in pixels)
  const mbMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*MB\s*$/i);
  if (mbMatch) {
    const mb = parseFloat(mbMatch[1]);
    if (mb >= 512) {
      const gb = Math.round(mb / 1024);
      return `${gb}GB`;
    }
  }

  // No unit found → unparseable (do NOT guess)
  return null;
}
