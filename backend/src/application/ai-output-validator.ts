/**
 * Capucine — AI Output Validator
 *
 * SECURITY INVARIANT: "aucune réponse IA considérée automatiquement comme vérité"
 *
 * Every piece of AI output that touches the business pipeline must pass through
 * this validator. The validator:
 *  - Rejects structurally invalid responses (missing fields, wrong types)
 *  - Rejects semantically invalid responses (negative budgets, unknown enums)
 *  - Sanitizes string values (length limits, no null bytes)
 *  - NEVER crashes the engine — always returns a safe fallback on failure
 *  - Logs what was rejected and why (for auditability)
 *
 * The AI is allowed to SUGGEST criteria, search terms, and explanations.
 * It is NEVER allowed to modify hard constraints, override admissibility decisions,
 * or inject arbitrary values into the ranking engine.
 */

import { PreferenceLevel } from '../domain/types';

// ============================================================================
// VALIDATION RESULT
// ============================================================================

export interface ValidationResult<T> {
  /** Whether the value passed validation */
  valid: boolean;
  /** The sanitized/coerced value (may be the safe fallback if !valid) */
  value: T;
  /** Errors encountered during validation */
  errors: ValidationError[];
  /** Whether the original was usable at all (vs completely replaced by fallback) */
  usedFallback: boolean;
}

export interface ValidationError {
  field: string;
  code: ValidationErrorCode;
  message: string;
  rejectedValue?: unknown;
}

export type ValidationErrorCode =
  | 'INVALID_JSON'
  | 'MISSING_REQUIRED_FIELD'
  | 'WRONG_TYPE'
  | 'VALUE_OUT_OF_RANGE'
  | 'INVALID_ENUM'
  | 'STRING_TOO_LONG'
  | 'EMPTY_REQUIRED_ARRAY'
  | 'INJECTION_ATTEMPT'
  | 'NEGATIVE_VALUE'
  | 'UNKNOWN_FIELD_IGNORED';

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_PREFERENCE_LEVELS = new Set<string>([
  'required', 'forbidden', 'very_important', 'important', 'preference', 'low', 'none',
]);

const MAX_STRING_LENGTH = 2000;
const MAX_TERM_LENGTH = 100;
const MAX_TERMS = 20;
const MAX_CRITERIA = 30;

// Characters that suggest prompt injection attempts
const INJECTION_PATTERNS = [
  /\x00/,                        // null byte
  /\bignore previous\b/i,        // classic injection
  /\bforget (all|your|these)\b/i,
  /\bsystem prompt\b/i,
  /\bact as\b/i,
  /\bdo not follow\b/i,
];

// ============================================================================
// SANITIZATION HELPERS
// ============================================================================

function sanitizeString(value: unknown, maxLen = MAX_STRING_LENGTH): { ok: boolean; value: string; error?: ValidationError } {
  if (typeof value !== 'string') {
    return { ok: false, value: '', error: { field: 'string', code: 'WRONG_TYPE', message: `Expected string, got ${typeof value}`, rejectedValue: value } };
  }

  // Null byte check
  if (/\x00/.test(value)) {
    return { ok: false, value: '', error: { field: 'string', code: 'INJECTION_ATTEMPT', message: 'Null byte in string', rejectedValue: '[redacted]' } };
  }

  // Injection pattern check
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      return { ok: false, value: '', error: { field: 'string', code: 'INJECTION_ATTEMPT', message: `Injection pattern detected: ${pattern}`, rejectedValue: '[redacted]' } };
    }
  }

  const trimmed = value.trim().slice(0, maxLen);
  return { ok: true, value: trimmed };
}

function sanitizeNumber(value: unknown, min?: number, max?: number): { ok: boolean; value: number | null; error?: ValidationError } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(n)) {
    return { ok: false, value: null, error: { field: 'number', code: 'WRONG_TYPE', message: `Cannot parse as number: ${value}`, rejectedValue: value } };
  }
  if (min !== undefined && n < min) {
    return { ok: false, value: null, error: { field: 'number', code: 'NEGATIVE_VALUE', message: `Value ${n} is below minimum ${min}`, rejectedValue: n } };
  }
  if (max !== undefined && n > max) {
    return { ok: false, value: null, error: { field: 'number', code: 'VALUE_OUT_OF_RANGE', message: `Value ${n} exceeds maximum ${max}`, rejectedValue: n } };
  }
  return { ok: true, value: n };
}

// ============================================================================
// AI OUTPUT VALIDATOR
// ============================================================================

export class AIOutputValidator {

  // ── Search term validation ─────────────────────────────────────────────────

  /**
   * Validate the output of generateSearchTerms().
   *
   * Expected shape: { primaryTerms: string[], synonyms?: string[], alternativeSpellings?: string[] }
   * Returns safe defaults on any failure.
   */
  validateSearchTerms(
    raw: unknown,
    fallbackTerms: string[]
  ): ValidationResult<{ primaryTerms: string[]; synonyms: string[]; alternativeSpellings: string[] }> {
    const errors: ValidationError[] = [];
    const fallback = { primaryTerms: fallbackTerms, synonyms: [], alternativeSpellings: [] };

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push({ field: 'root', code: 'WRONG_TYPE', message: 'Expected object', rejectedValue: typeof raw });
      return { valid: false, value: fallback, errors, usedFallback: true };
    }

    const obj = raw as Record<string, unknown>;

    // Validate primaryTerms
    if (!Array.isArray(obj.primaryTerms)) {
      errors.push({ field: 'primaryTerms', code: 'WRONG_TYPE', message: 'primaryTerms must be an array' });
      return { valid: false, value: fallback, errors, usedFallback: true };
    }

    const primaryTerms = this.sanitizeTermArray(obj.primaryTerms, 'primaryTerms', errors);
    if (primaryTerms.length === 0) {
      // Empty terms → use fallback
      errors.push({ field: 'primaryTerms', code: 'EMPTY_REQUIRED_ARRAY', message: 'primaryTerms must not be empty' });
      return { valid: false, value: fallback, errors, usedFallback: true };
    }

    const synonyms = Array.isArray(obj.synonyms)
      ? this.sanitizeTermArray(obj.synonyms, 'synonyms', errors)
      : [];

    const alternativeSpellings = Array.isArray(obj.alternativeSpellings)
      ? this.sanitizeTermArray(obj.alternativeSpellings, 'alternativeSpellings', errors)
      : [];

    return {
      valid: errors.length === 0,
      value: { primaryTerms, synonyms, alternativeSpellings },
      errors,
      usedFallback: false,
    };
  }

  // ── Interpretation validation ──────────────────────────────────────────────

  /**
   * Validate the output of interpret().
   *
   * Strips any AI-injected criteria that are structurally invalid.
   * Validated criteria still go through ProfileEngine + AdmissibilityEngine — this
   * is NOT the final security check, but the first line of defense.
   */
  validateInterpretation(raw: unknown): ValidationResult<{
    productDescription: string;
    extractedCriteria: ValidatedCriterion[];
    suggestedTerms: string[];
    confidence: number;
  }> {
    const errors: ValidationError[] = [];
    const fallback = { productDescription: '', extractedCriteria: [], suggestedTerms: [], confidence: 0 };

    if (typeof raw !== 'object' || raw === null) {
      errors.push({ field: 'root', code: 'WRONG_TYPE', message: 'Expected object' });
      return { valid: false, value: fallback, errors, usedFallback: true };
    }

    const obj = raw as Record<string, unknown>;

    // productDescription
    const descResult = sanitizeString(obj.productDescription ?? '');
    const productDescription = descResult.ok ? descResult.value : '';
    if (!descResult.ok && descResult.error) errors.push({ ...descResult.error, field: 'productDescription' });

    // suggestedTerms
    const suggestedTerms = Array.isArray(obj.suggestedTerms)
      ? this.sanitizeTermArray(obj.suggestedTerms, 'suggestedTerms', errors)
      : [];

    // confidence — must be 0–1
    let confidence = 0.5;
    if (typeof obj.confidence === 'number') {
      if (obj.confidence < 0 || obj.confidence > 1) {
        errors.push({ field: 'confidence', code: 'VALUE_OUT_OF_RANGE', message: `confidence must be 0–1, got ${obj.confidence}`, rejectedValue: obj.confidence });
        confidence = 0.5;
      } else {
        confidence = obj.confidence;
      }
    }

    // extractedCriteria — each one validated individually
    const rawCriteria = Array.isArray(obj.extractedCriteria) ? obj.extractedCriteria : [];
    const extractedCriteria: ValidatedCriterion[] = [];
    for (let i = 0; i < Math.min(rawCriteria.length, MAX_CRITERIA); i++) {
      const validated = this.validateCriterion(rawCriteria[i], i, errors);
      if (validated) extractedCriteria.push(validated);
    }

    return {
      valid: errors.length === 0,
      value: { productDescription, extractedCriteria, suggestedTerms, confidence },
      errors,
      usedFallback: false,
    };
  }

  // ── Clarification question validation ─────────────────────────────────────

  /**
   * Validate AI-generated clarification questions.
   * Questions must have at minimum: id, question, urgency.
   */
  validateClarificationQuestions(raw: unknown): ValidationResult<ValidatedClarificationQuestion[]> {
    const errors: ValidationError[] = [];

    if (!Array.isArray(raw)) {
      errors.push({ field: 'root', code: 'WRONG_TYPE', message: 'Expected array of clarification questions' });
      return { valid: false, value: [], errors, usedFallback: true };
    }

    const questions: ValidatedClarificationQuestion[] = [];
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const q = this.validateSingleQuestion(raw[i], i, errors);
      if (q) questions.push(q);
    }

    return { valid: errors.length === 0, value: questions, errors, usedFallback: false };
  }

  // ── Parse + validate JSON from AI ─────────────────────────────────────────

  /**
   * Safely parse JSON from an AI response string.
   * Returns null on parse failure (never throws).
   */
  parseJSON(content: string): { parsed: unknown; error: ValidationError | null } {
    try {
      // Strip markdown code fences that some models add
      const cleaned = content.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      return { parsed, error: null };
    } catch (err) {
      return {
        parsed: null,
        error: {
          field: 'json',
          code: 'INVALID_JSON',
          message: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
          rejectedValue: content.slice(0, 100),
        },
      };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private sanitizeTermArray(arr: unknown[], field: string, errors: ValidationError[]): string[] {
    const result: string[] = [];
    for (let i = 0; i < Math.min(arr.length, MAX_TERMS); i++) {
      const item = arr[i];
      if (typeof item !== 'string') {
        errors.push({ field: `${field}[${i}]`, code: 'WRONG_TYPE', message: `Term must be string, got ${typeof item}` });
        continue;
      }
      if (item.length > MAX_TERM_LENGTH) {
        errors.push({ field: `${field}[${i}]`, code: 'STRING_TOO_LONG', message: `Term too long (${item.length} chars, max ${MAX_TERM_LENGTH})` });
        continue;
      }
      // Injection check
      const clean = sanitizeString(item, MAX_TERM_LENGTH);
      if (!clean.ok) {
        if (clean.error) errors.push({ ...clean.error, field: `${field}[${i}]` });
        continue;
      }
      if (clean.value.length > 0) result.push(clean.value);
    }
    return result;
  }

  private validateCriterion(raw: unknown, index: number, errors: ValidationError[]): ValidatedCriterion | null {
    if (typeof raw !== 'object' || raw === null) {
      errors.push({ field: `extractedCriteria[${index}]`, code: 'WRONG_TYPE', message: 'Criterion must be object' });
      return null;
    }

    const c = raw as Record<string, unknown>;

    // id
    const idResult = sanitizeString(c.id ?? '', 50);
    if (!idResult.ok || !idResult.value) {
      errors.push({ field: `extractedCriteria[${index}].id`, code: 'MISSING_REQUIRED_FIELD', message: 'Criterion id is required' });
      return null;
    }

    // name
    const nameResult = sanitizeString(c.name ?? '', 200);
    const name = nameResult.ok ? nameResult.value : idResult.value;

    // level — must be a valid PreferenceLevel
    const level = c.level as string;
    if (!VALID_PREFERENCE_LEVELS.has(level as PreferenceLevel)) {
      errors.push({ field: `extractedCriteria[${index}].level`, code: 'INVALID_ENUM', message: `Invalid level: "${level}"`, rejectedValue: level });
      return null;
    }

    // parameters — basic sanitization of common fields
    const params: Record<string, unknown> = {};
    if (typeof c.parameters === 'object' && c.parameters !== null) {
      const p = c.parameters as Record<string, unknown>;

      // maxBudget — must be positive number
      if (p.maxBudget !== undefined) {
        const budgetR = sanitizeNumber(p.maxBudget, 0, 1_000_000);
        if (budgetR.ok && budgetR.value !== null) params.maxBudget = budgetR.value;
        else if (budgetR.error) errors.push({ ...budgetR.error, field: `extractedCriteria[${index}].parameters.maxBudget` });
      }

      // minValue / targetValue — numbers
      for (const numField of ['minValue', 'targetValue', 'maxValue'] as const) {
        if (p[numField] !== undefined) {
          const r = sanitizeNumber(p[numField], -1_000_000, 1_000_000);
          if (r.ok && r.value !== null) params[numField] = r.value;
          else if (r.error) errors.push({ ...r.error, field: `extractedCriteria[${index}].parameters.${numField}` });
        }
      }

      // preferredValues / acceptedValues — string arrays (injection-checked)
      for (const arrField of ['preferredValues', 'acceptedValues'] as const) {
        if (Array.isArray(p[arrField])) {
          const safe: string[] = [];
          for (const v of (p[arrField] as unknown[])) {
            if (typeof v !== 'string' || v.length > 200) continue;
            const cleaned = sanitizeString(v, 200);
            if (cleaned.ok && cleaned.value.length > 0) safe.push(cleaned.value);
            // else: injection/null-byte detected — silently drop
          }
          if (safe.length > 0) params[arrField] = safe;
        }
      }

      // boolean fields
      if (typeof p.boolean === 'boolean') params.boolean = p.boolean;
    }

    return {
      id: idResult.value,
      name,
      level: level as PreferenceLevel,
      parameters: params,
    };
  }

  private validateSingleQuestion(raw: unknown, index: number, errors: ValidationError[]): ValidatedClarificationQuestion | null {
    if (typeof raw !== 'object' || raw === null) {
      errors.push({ field: `questions[${index}]`, code: 'WRONG_TYPE', message: 'Question must be object' });
      return null;
    }

    const q = raw as Record<string, unknown>;

    const idResult = sanitizeString(q.id ?? `ai-q-${index}`, 100);
    const questionResult = sanitizeString(q.question ?? q.suggestedQuestion ?? '', 500);

    if (!questionResult.ok || !questionResult.value) {
      errors.push({ field: `questions[${index}].question`, code: 'MISSING_REQUIRED_FIELD', message: 'Question text is required' });
      return null;
    }

    const validUrgencies = new Set(['blocking', 'important', 'optional']);
    const urgency = validUrgencies.has(q.urgency as string)
      ? (q.urgency as 'blocking' | 'important' | 'optional')
      : 'optional';

    return {
      id: idResult.ok ? idResult.value : `ai-q-${index}`,
      question: questionResult.value,
      urgency,
    };
  }
}

// ============================================================================
// VALIDATED TYPES (output of validator — guaranteed clean)
// ============================================================================

export interface ValidatedCriterion {
  id: string;
  name: string;
  /** Guaranteed to be a valid PreferenceLevel string */
  level: string;
  parameters: Record<string, unknown>;
}

export interface ValidatedClarificationQuestion {
  id: string;
  question: string;
  urgency: 'blocking' | 'important' | 'optional';
}

// ============================================================================
// SINGLETON — shared across the application
// ============================================================================

export const aiOutputValidator = new AIOutputValidator();
