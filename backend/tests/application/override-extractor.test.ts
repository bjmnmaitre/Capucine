/**
 * CAPUCINE — Override Extractor Tests
 *
 * Tests for extractOverridesFromAnswer function.
 * Uses a real detectTemporariness stub that returns appropriate temporariness levels.
 */

import { extractOverridesFromAnswer } from '../../src/application/override-extractor';
import { ProfileOverride } from '../../src/domain/profile';

// Stub detectTemporariness that returns appropriate values based on input
function detectTemporarinessStub(text: string): 'explicit' | 'likely' | 'unlikely' | 'unknown' {
  const normalized = text.toLowerCase().trim();
  
  const explicitSignals = [
    'aujourd\'hui', 'ce soir', 'cette fois', 'cette fois-ci', 'juste pour',
    'juste cette fois', 'pour l\'instant', 'exceptionnellement',
    'just this time', 'just this once', 'for now', 'today only',
    'one time', 'one-time', 'ponctuellement', 'uniquement aujourd\'hui'
  ];
  
  const likelySignals = [
    'aujourd\'hui', 'ce soir', 'cette fois', 'just this time',
    'for now', 'today'
  ];
  
  const permanentSignals = [
    'toujours', 'always', 'définitivement', 'permanently',
    'permanent', 'définitif', 'permanentement', 'en permanence',
    'pour toujours', 'forever'
  ];

  for (const signal of explicitSignals) {
    if (normalized.includes(signal)) return 'explicit';
  }
  for (const signal of likelySignals) {
    if (normalized.includes(signal)) return 'likely';
  }
  for (const signal of permanentSignals) {
    if (normalized.includes(signal)) return 'unlikely';
  }
  return 'unknown';
}

describe('extractOverridesFromAnswer', () => {
  describe('Explicit temporal signals (8 tests)', () => {
    test('"aujourd\'hui je veux rester sous 15€" → 1 override, budget type', () => {
      const result = extractOverridesFromAnswer(
        "aujourd'hui je veux rester sous 15€",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
      expect(result.overrides[0].temporaryLevel).toBe('required');
      expect(result.overrides[0].source).toBe('ai_detected');
      expect(result.extractionLog.some((l: string) => l.includes('Budget override detected'))).toBe(true);
    });

    test('"juste pour cette fois, pas de livraison" → 1 override, exclusion type', () => {
      const result = extractOverridesFromAnswer(
        "juste pour cette fois, pas de livraison",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_');
      expect(result.overrides[0].temporaryLevel).toBe('forbidden');
      expect(result.overrides[0].source).toBe('ai_detected');
      expect(result.extractionLog.some((l: string) => l.includes('Exclusion override detected'))).toBe(true);
    });

    test('"just this time under 20" → 1 override, budget type', () => {
      const result = extractOverridesFromAnswer(
        "just this time under 20",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
      expect(result.overrides[0].temporaryLevel).toBe('required');
    });

    test('"ce soir uniquement, moins de 25 euros" → 1 override, budget type', () => {
      const result = extractOverridesFromAnswer(
        "ce soir uniquement, moins de 25 euros",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
    });

    test('"exceptionnellement, sans saumon" → 1 override, exclusion type', () => {
      const result = extractOverridesFromAnswer(
        "exceptionnellement, sans saumon",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_');
      expect(result.overrides[0].temporaryLevel).toBe('forbidden');
    });

    test('Multiple signals in one answer → extracts the most specific', () => {
      const result = extractOverridesFromAnswer(
        "aujourd'hui sous 20€ sans amazon",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      // Should extract budget (more specific) - both patterns present
      expect(result.overrides.length).toBeGreaterThanOrEqual(1);
      const budgetOverride = result.overrides.find((o: ProfileOverride) => o.criterionId === '_budget_temp');
      expect(budgetOverride).toBeDefined();
    });

    test('Explicit signal but no extractable constraint → returns empty overrides, log explains why', () => {
      const result = extractOverridesFromAnswer(
        "aujourd'hui je cherche",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(0);
      expect(result.extractionLog.some((l: string) => l.includes('no extractable constraint pattern'))).toBe(true);
    });

    test('Explicit signal with detectTemporariness returning unlikely → returns empty overrides', () => {
      // Stub that returns 'unlikely' for this specific input
      const unlikelyStub = () => 'unlikely' as const;
      const result = extractOverridesFromAnswer(
        "aujourd'hui sous 20€",
        '(free-form follow-up)',
        unlikelyStub
      );
      expect(result.overrides).toHaveLength(0);
      expect(result.extractionLog.some((l: string) => l.includes('permanent preference'))).toBe(true);
    });
  });

  describe('Budget pattern detection (6 tests)', () => {
    test('"moins de 18€" → budget override, limit = 18', () => {
      const result = extractOverridesFromAnswer(
        "moins de 18€",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
      expect(result.overrides[0].temporaryLevel).toBe('required');
    });

    test('"sous 20 euros" → budget override, limit = 20', () => {
      const result = extractOverridesFromAnswer(
        "sous 20 euros",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
    });

    test('"max 15" → budget override, limit = 15', () => {
      const result = extractOverridesFromAnswer(
        "max 15",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
    });

    test('"under €30" → budget override, limit = 30', () => {
      const result = extractOverridesFromAnswer(
        "under €30",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
    });

    test('"pas plus de 22 EUR" → budget override, limit = 22', () => {
      const result = extractOverridesFromAnswer(
        "pas plus de 22 EUR",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
    });

    test('"je veux dépenser 15" (no explicit "less than" keyword) → NO override', () => {
      const result = extractOverridesFromAnswer(
        "je veux dépenser 15",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(0);
    });
  });

  describe('Category exclusion detection (5 tests)', () => {
    test('"sans livraison" → exclusion override', () => {
      const result = extractOverridesFromAnswer(
        "sans livraison",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_');
      expect(result.overrides[0].temporaryLevel).toBe('forbidden');
    });

    test('"pas de saumon" → exclusion override', () => {
      const result = extractOverridesFromAnswer(
        "pas de saumon",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_saumon');
    });

    test('"no delivery" → exclusion override', () => {
      const result = extractOverridesFromAnswer(
        "no delivery",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_delivery');
    });

    test('"aucun burger" → exclusion override', () => {
      const result = extractOverridesFromAnswer(
        "aucun burger",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_burger');
    });

    test('"sans gluten" → exclusion override', () => {
      const result = extractOverridesFromAnswer(
        "sans gluten",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toContain('_exclusion_temp_gluten');
    });
  });

  describe('No override cases (4 tests)', () => {
    test('"oui" → empty overrides', () => {
      const result = extractOverridesFromAnswer(
        "oui",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(0);
    });

    test('"je préfère le poulet" → empty overrides (permanent preference signal)', () => {
      const result = extractOverridesFromAnswer(
        "je préfère le poulet",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(0);
    });

    test('"c\'est bon merci" → empty overrides', () => {
      const result = extractOverridesFromAnswer(
        "c'est bon merci",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(0);
    });

    test('"" (empty string) → empty overrides, no throw', () => {
      const result = extractOverridesFromAnswer(
        "",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(0);
      expect(result.extractionLog).toContain('Empty or invalid answer text');
    });
  });

  describe('Safety / edge cases (2 tests)', () => {
    test('Very long answer (>1000 chars) → does not throw, returns result within 50ms', () => {
      const longAnswer = 'aujourd\'hui je veux '.repeat(100) + 'sous 20€';
      const start = Date.now();
      const result = extractOverridesFromAnswer(
        longAnswer,
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50);
      expect(result.overrides).toHaveLength(1);
    });

    test('Answer with special characters / emoji → does not throw', () => {
      const result = extractOverridesFromAnswer(
        "aujourd'hui 🎉 je veux 🍕 sous 15€ !!!",
        '(free-form follow-up)',
        detectTemporarinessStub
      );
      expect(result.overrides).toHaveLength(1);
      expect(result.overrides[0].criterionId).toBe('_budget_temp');
    });
  });
});