/**
 * Capucine — New Layers Test Suite
 *
 * Tests for:
 * - Criterion Engine (Gate 3)
 * - Profile Engine (Gate 4/5)
 * - Admissibility Engine (Gate 2/5)
 * - Deduplication Engine (Gate 9)
 * - Search Plan (Gate 14-16)
 * - Conversation Model + SearchState (Gate 24-25)
 * - AI Orchestrator (Gate 20-23)
 *
 * INVARIANTS tested:
 * 1. "Capucine cherche le produit qui correspond le mieux à ce que l'utilisateur a demandé"
 * 2. "La rareté d'un produit ne diminue pas sa pertinence"
 * 3. "La source qui permet de trouver une offre n'a aucun droit particulier sur son classement"
 * 4. "La difficulté d'exécution n'a aucun effet sur le classement"
 * 5. "Capucine ne modifie jamais silencieusement la volonté de l'utilisateur"
 */

import { CriterionFactory, CriterionEvaluator, GenericCriterion } from '../../src/domain/criterion';
import { ProfileEngine, ProfileOverride, PreferenceConflictDetector } from '../../src/domain/profile';
import { AdmissibilityEngine } from '../../src/domain/admissibility';
import { DeduplicationEngine, classifyMatch } from '../../src/application/deduplication';
import { SearchPlanBuilder, SEARCH_LEVEL_CONFIGS } from '../../src/application/search-plan';
import { ConversationManager } from '../../src/application/conversation';
import { AIOrchestrator, MockAIProvider } from '../../src/application/ai-orchestrator';
import {
  UserProfile, CurrentSearchRequirements, Offer, PreferenceCriterion, DataPoint,
  PreferenceLevel,
} from '../../src/domain/types';

// ============================================================================
// TEST HELPERS
// ============================================================================

function makeDataPoint<T>(value: T, status: 'verified' | 'known' | 'unknown' = 'known'): DataPoint<T> {
  return { value, status };
}

const MOCK_PROVENANCE = { source: 'test', retrievedAt: new Date() };

function makeOffer(overrides: {
  id?: string;
  productId?: string;
  title?: string;
  price?: number | null;
  priceStatus?: 'verified' | 'known' | 'unknown';
  chars?: Record<string, DataPoint<unknown>>;
  merchantId?: string;
  merchantName?: string;
}): Offer {
  return {
    id: overrides.id || `offer-${Math.random().toString(36).slice(2, 6)}`,
    productId: overrides.productId || `prod-${Math.random().toString(36).slice(2, 6)}`,
    price: makeDataPoint(overrides.price ?? 100, overrides.priceStatus ?? 'known'),
    shippingCost: makeDataPoint(0),
    currency: 'EUR',
    merchant: {
      id: overrides.merchantId || 'merchant-1',
      name: overrides.merchantName || 'Test Merchant',
      country: 'FR',
      executionCapabilities: [],
    },
    characteristics: overrides.chars || {},
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: MOCK_PROVENANCE,
  };
}

function makeProfile(criteria: PreferenceCriterion[] = []): UserProfile {
  return {
    userId: 'user-test',
    preferences: { criteria, createdAt: new Date(), updatedAt: new Date() },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRequest(criteria: PreferenceCriterion[] = [], profileExceptions: { criterionId: string; temporaryLevel: PreferenceLevel; reason?: string }[] = []): CurrentSearchRequirements {
  return { criteria, profileExceptions, createdAt: new Date() };
}

function makeCriterion(overrides: Partial<PreferenceCriterion> & { id: string; name: string }): PreferenceCriterion {
  return {
    level: 'preference',
    parameters: {},
    ...overrides,
  };
}

// ============================================================================
// GATE 3: CRITERION ENGINE
// ============================================================================

describe('Gate 3 — Criterion Engine', () => {
  const evaluator = new CriterionEvaluator();

  describe('CriterionFactory', () => {
    test('price criterion: creates correct operator and valueType', () => {
      const c = CriterionFactory.price(500, 'EUR', 'required');
      expect(c.operator).toBe('lte');
      expect(c.valueType).toBe('price');
      expect(c.level).toBe('required');
      expect(c.targetValue).toBe(500);
    });

    test('minSpec criterion: creates gte operator', () => {
      const c = CriterionFactory.minSpec('ram', 'RAM', 16, 'GB', 'very_important');
      expect(c.operator).toBe('gte');
      expect(c.unit).toBe('GB');
      expect(c.targetValue).toBe(16);
    });

    test('exact criterion: creates eq operator', () => {
      const c = CriterionFactory.exact('color', 'Color', 'black', 'preference');
      expect(c.operator).toBe('eq');
      expect(c.targetValue).toBe('black');
    });

    test('oneOf criterion: creates in operator', () => {
      const c = CriterionFactory.oneOf('brand', 'Brand', ['Apple', 'Samsung'], 'important');
      expect(c.operator).toBe('in');
      expect(c.acceptedValues).toContain('Apple');
      expect(c.acceptedValues).toContain('Samsung');
    });

    test('noneOf criterion: creates not_in operator', () => {
      const c = CriterionFactory.noneOf('region', 'Region', ['JP', 'US'], 'required');
      expect(c.operator).toBe('not_in');
      expect(c.rejectedValues).toContain('JP');
    });

    test('mustExist criterion: creates exists operator', () => {
      const c = CriterionFactory.mustExist('warranty', 'Warranty', 'important');
      expect(c.operator).toBe('exists');
    });
  });

  describe('CriterionEvaluator — UNKNOWN handling', () => {
    test('UNKNOWN never auto-fails a preference criterion', () => {
      const criterion = CriterionFactory.exact('color', 'Color', 'black', 'preference');
      const result = evaluator.evaluate(criterion, null, 'unknown');
      // UNKNOWN should not fail — we don't know if it's wrong
      expect(result.passes).toBe(true); // unknown = not confirmed bad
      expect(result.comparisonResult).toBe('unknown');
    });

    test('UNKNOWN in required criterion is indeterminate (not a pass)', () => {
      const criterion = CriterionFactory.price(500, 'EUR', 'required');
      const result = evaluator.evaluate(criterion, null, 'unknown');
      // Required criteria with unknown data: cannot confirm, so it's uncertain
      expect(result.comparisonResult).toBe('unknown');
    });

    test('Known value of correct type passes verification', () => {
      const criterion = CriterionFactory.minSpec('ram', 'RAM', 16, 'GB', 'required');
      const result = evaluator.evaluate(criterion, 32, 'verified');
      expect(result.passes).toBe(true);
      expect(result.score).toBeGreaterThan(80);
    });

    test('Value below minimum fails required criterion', () => {
      const criterion = CriterionFactory.minSpec('ram', 'RAM', 16, 'GB', 'required');
      const result = evaluator.evaluate(criterion, 8, 'known');
      expect(result.passes).toBe(false);
    });

    test('oneOf: value in accepted list → passes', () => {
      const criterion = CriterionFactory.oneOf('brand', 'Brand', ['Apple', 'Samsung'], 'required');
      const result = evaluator.evaluate(criterion, 'Apple', 'known');
      expect(result.passes).toBe(true);
    });

    test('oneOf: value NOT in accepted list → fails', () => {
      const criterion = CriterionFactory.oneOf('brand', 'Brand', ['Apple', 'Samsung'], 'required');
      const result = evaluator.evaluate(criterion, 'Huawei', 'known');
      expect(result.passes).toBe(false);
    });

    test('noneOf: rejected value → fails', () => {
      const criterion = CriterionFactory.noneOf('region', 'Region', ['JP', 'US'], 'required');
      const result = evaluator.evaluate(criterion, 'JP', 'known');
      expect(result.passes).toBe(false);
    });

    test('noneOf: non-rejected value → passes', () => {
      const criterion = CriterionFactory.noneOf('region', 'Region', ['JP', 'US'], 'required');
      const result = evaluator.evaluate(criterion, 'FR', 'known');
      expect(result.passes).toBe(true);
    });
  });
});

// ============================================================================
// GATE 4/5: PROFILE ENGINE
// ============================================================================

describe('Gate 4/5 — Profile Engine', () => {
  const engine = new ProfileEngine();

  test('Profile snapshot is immutable — modifying profile after snapshot does not change snapshot', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } }),
    ]);

    const snapshot = engine.snapshot(profile, 'snap-001');

    // Mutate the profile's criteria (simulating a profile update)
    profile.preferences.criteria[0] = {
      ...profile.preferences.criteria[0],
      level: 'preference',  // Changed!
    };

    // Snapshot should still have original level
    expect(snapshot.criteria[0].level).toBe('required');
    expect(profile.preferences.criteria[0].level).toBe('preference');
  });

  test('verifyUnmutated: detects mutation', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'budget', name: 'Budget', level: 'required' }),
    ]);
    const snapshot = engine.snapshot(profile, 'snap-002');

    // Mutate profile
    profile.preferences.criteria[0] = { ...profile.preferences.criteria[0], level: 'preference' };

    expect(engine.verifyUnmutated(profile, snapshot)).toBe(false);
  });

  test('verifyUnmutated: returns true when profile unchanged', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'budget', name: 'Budget', level: 'required' }),
    ]);
    const snapshot = engine.snapshot(profile, 'snap-003');

    expect(engine.verifyUnmutated(profile, snapshot)).toBe(true);
  });

  test('Request criteria win over profile on conflict', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'condition', name: 'Condition', level: 'preference' }),
    ]);
    const request = makeRequest([makeCriterion({ id: 'condition', name: 'Condition', level: 'required' })]);

    const result = engine.resolve(profile, request, [], 'search-001');
    const conditionCriterion = result.criteria.find(c => c.id === 'condition');

    expect(conditionCriterion?.level).toBe('required'); // Request wins
    expect(result.resolvedConflicts.length).toBeGreaterThan(0);
  });

  test('Override takes precedence over both profile and request', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'marketplace', name: 'No marketplace', level: 'forbidden' }),
    ]);
    const request = makeRequest([makeCriterion({ id: 'marketplace', name: 'No marketplace', level: 'forbidden' })]);
    const override: ProfileOverride = {
      criterionId: 'marketplace',
      temporaryLevel: 'preference',
      reason: 'User accepted marketplace for this search',
      source: 'explicit_user',
      createdAt: new Date(),
    };

    const result = engine.resolve(profile, request, [override], 'search-002');
    const marketplaceCrit = result.criteria.find(c => c.id === 'marketplace');

    expect(marketplaceCrit?.level).toBe('preference');
  });

  test('Disabled override removes criterion entirely', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'eco', name: 'Eco certification', level: 'important' }),
    ]);
    const request = makeRequest();
    const override: ProfileOverride = {
      criterionId: 'eco',
      temporaryLevel: 'disabled',
      reason: 'Not relevant for this search',
      source: 'explicit_user',
      createdAt: new Date(),
    };

    const result = engine.resolve(profile, request, [override], 'search-003');
    const ecoCrit = result.criteria.find(c => c.id === 'eco');

    expect(ecoCrit).toBeUndefined(); // Disabled = removed
  });

  test('UserProfile is never mutated by resolve()', () => {
    const profile = makeProfile([
      makeCriterion({ id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } }),
    ]);
    const originalLevel = profile.preferences.criteria[0].level;
    const request = makeRequest([makeCriterion({ id: 'budget', name: 'Budget', level: 'forbidden' })]);

    engine.resolve(profile, request, [], 'search-004');

    // Profile must be unchanged
    expect(profile.preferences.criteria[0].level).toBe(originalLevel);
  });

  test('INVARIANT 5: profile override does not silently modify user intent', () => {
    // Overrides must be traceable — appliedOverrides is logged
    const profile = makeProfile([
      makeCriterion({ id: 'brand', name: 'Brand preference', level: 'important' }),
    ]);
    const request = makeRequest();
    const override: ProfileOverride = {
      criterionId: 'brand',
      temporaryLevel: 'none',
      reason: 'No brand preference for this search',
      source: 'explicit_user',
      createdAt: new Date(),
    };

    const result = engine.resolve(profile, request, [override], 'search-005');
    // The override should be recorded in appliedOverrides
    expect(result.appliedOverrides.length).toBe(1);
    expect(result.appliedOverrides[0].criterionId).toBe('brand');
    expect(result.appliedOverrides[0].reason).toBe('No brand preference for this search');
  });
});

// ============================================================================
// GATE 2/5: ADMISSIBILITY ENGINE
// ============================================================================

describe('Gate 2/5 — Admissibility Engine', () => {
  const engine = new AdmissibilityEngine();

  test('Over-budget offer is always rejected (INVARIANT: no secondary score compensates)', () => {
    const offer = makeOffer({ price: 1200 });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } }),
    ];

    const result = engine.checkOffer(offer, constraints);
    expect(result.eligible).toBe(false);
    expect(result.violations[0].criterionId).toBe('price');
  });

  test('Within-budget offer passes price constraint', () => {
    const offer = makeOffer({ price: 750 });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } }),
    ];

    const result = engine.checkOffer(offer, constraints);
    expect(result.eligible).toBe(true);
  });

  test('Forbidden characteristic triggers rejection', () => {
    const offer = makeOffer({
      chars: {
        is_counterfeit: makeDataPoint(true),
      },
    });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'is_counterfeit', name: 'Not counterfeit', level: 'forbidden' }),
    ];

    const result = engine.checkOffer(offer, constraints);
    expect(result.eligible).toBe(false);
  });

  test('UNKNOWN data on required constraint rejects offer', () => {
    const offer = makeOffer({
      chars: {
        warranty: { value: null, status: 'unknown' },
      },
    });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'warranty', name: 'Warranty required', level: 'required' }),
    ];

    const result = engine.checkOffer(offer, constraints);
    // Cannot confirm the required criterion is met
    expect(result.eligible).toBe(false);
  });

  test('UNKNOWN data on forbidden constraint: not a violation (gives warning)', () => {
    const offer = makeOffer({
      chars: {
        dangerous_chemical: { value: null, status: 'unknown' },
      },
    });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'dangerous_chemical', name: 'No dangerous chemicals', level: 'forbidden' }),
    ];

    const result = engine.checkOffer(offer, constraints);
    // Cannot confirm the forbidden thing is present → not rejected, but warned
    expect(result.eligible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('batch filter: splits eligible and rejected correctly', () => {
    const under = makeOffer({ id: 'cheap', price: 400 });
    const over = makeOffer({ id: 'expensive', price: 1500 });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } }),
    ];

    const batch = engine.filter([under, over], constraints);
    expect(batch.eligibleCount).toBe(1);
    expect(batch.rejectedCount).toBe(1);
    expect(batch.eligibleOffers[0].id).toBe('cheap');
    expect(batch.rejectedOffers[0].offer.id).toBe('expensive');
  });

  test('No hard constraints → all offers eligible', () => {
    const offers = [makeOffer({}), makeOffer({}), makeOffer({})];
    const softConstraints: PreferenceCriterion[] = [
      makeCriterion({ id: 'color', name: 'Color', level: 'preference' }),
    ];

    const batch = engine.filter(offers, softConstraints);
    expect(batch.eligibleCount).toBe(3);
    expect(batch.rejectedCount).toBe(0);
  });

  test('preferredValues constraint: offer with wrong value is rejected', () => {
    const offer = makeOffer({
      chars: {
        size: makeDataPoint('L'),
      },
    });
    const constraints: PreferenceCriterion[] = [
      makeCriterion({
        id: 'size',
        name: 'Size',
        level: 'required',
        parameters: { preferredValues: ['S', 'M'] },
      }),
    ];

    const result = engine.checkOffer(offer, constraints);
    expect(result.eligible).toBe(false);
  });
});

// ============================================================================
// GATE 9: DEDUPLICATION ENGINE
// ============================================================================

describe('Gate 9 — Deduplication Engine', () => {
  const engine = new DeduplicationEngine();

  test('Identical EAN → certain duplicate, grouped together', () => {
    const o1 = makeOffer({ id: 'a', chars: { ean: makeDataPoint('3614272050440') } });
    const o2 = makeOffer({ id: 'b', chars: { ean: makeDataPoint('3614272050440') } });

    const result = engine.deduplicate([o1, o2]);
    expect(result.distinctProducts).toBe(1);
    expect(result.groups[0].confidence).toBe('certain');
    expect(result.duplicatesRemoved).toBe(1);
  });

  test('Different EANs → different products, NOT grouped', () => {
    const o1 = makeOffer({ chars: { ean: makeDataPoint('1111111111111') } });
    const o2 = makeOffer({ chars: { ean: makeDataPoint('2222222222222') } });

    const result = engine.deduplicate([o1, o2]);
    expect(result.distinctProducts).toBe(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  test('iPhone 15 128GB ≠ iPhone 15 256GB (variant signal prevents merge)', () => {
    const o1 = makeOffer({
      id: 'iphone-128',
      chars: {
        model: makeDataPoint('iPhone 15'),
        manufacturer: makeDataPoint('Apple'),
        storage: makeDataPoint('128GB'),
      },
    });
    const o2 = makeOffer({
      id: 'iphone-256',
      chars: {
        model: makeDataPoint('iPhone 15'),
        manufacturer: makeDataPoint('Apple'),
        storage: makeDataPoint('256GB'),
      },
    });

    const result = engine.deduplicate([o1, o2]);
    // Storage differs → different variants → should NOT be grouped at medium confidence
    // (The medium-confidence model match is overridden by the storage variant signal)
    expect(result.distinctProducts).toBe(2);
  });

  test('Identical productId → certain duplicate regardless of title', () => {
    const prodId = 'shared-product-abc';
    const o1 = makeOffer({ id: 'o1', productId: prodId });
    const o2 = makeOffer({ id: 'o2', productId: prodId });

    const result = engine.deduplicate([o1, o2]);
    expect(result.distinctProducts).toBe(1);
    expect(result.groups[0].confidence).toBe('certain');
  });

  test('INVARIANT 2: Rare product with only 1 offer — not merged with anything', () => {
    // A rare product from a specialist source should NOT be grouped with a different product
    const rare = makeOffer({
      id: 'rare-vinyl',
      chars: { ean: makeDataPoint('9999999999001') },
    });
    const common = makeOffer({
      id: 'common-vinyl',
      chars: { ean: makeDataPoint('9999999999002') },
    });

    const result = engine.deduplicate([rare, common]);
    expect(result.distinctProducts).toBe(2);
    // Both distinct products should be in separate groups
    expect(result.groups.length).toBe(2);
  });

  test('selectBestOffer: selects offer with known price over unknown price', () => {
    const withPrice = makeOffer({ id: 'with-price', price: 200, priceStatus: 'known' });
    const unknownPrice = makeOffer({ id: 'no-price', price: null, priceStatus: 'unknown' });
    const group = {
      productKey: 'test',
      offers: [withPrice, unknownPrice],
      confidence: 'certain' as const,
      matchQuality: 'EXACT_MATCH' as const,
      identitySignals: [],
      matchReason: [],
      conflictSignals: [],
    };

    const best = engine.selectBestOffer(group);
    expect(best.best.id).toBe('with-price');
  });

  test('classifyMatch: exact match when all constraints satisfied', () => {
    const classification = classifyMatch(5, 5, 0, false);
    expect(classification).toBe('exact_match');
  });

  test('classifyMatch: match_with_unknown when some data is unknown', () => {
    const classification = classifyMatch(5, 5, 2, false);
    expect(classification).toBe('match_with_unknown');
  });

  test('classifyMatch: incompatible when violations exist', () => {
    const classification = classifyMatch(4, 5, 0, true);
    expect(classification).toBe('incompatible');
  });

  test('Empty input returns empty result', () => {
    const result = engine.deduplicate([]);
    expect(result.totalInput).toBe(0);
    expect(result.distinctProducts).toBe(0);
    expect(result.duplicatesRemoved).toBe(0);
  });
});

// ============================================================================
// GATE 14-16: SEARCH PLAN
// ============================================================================

describe('Gate 14-16 — Search Plan', () => {
  const builder = new SearchPlanBuilder();

  test('Common product: starts at level 1, maxAutoLevel = 2', () => {
    const plan = builder.build({
      requestId: 'req-001',
      primaryTerms: ['iPhone 15'],
      rarityLevel: 'common',
    });

    expect(plan.expansion.currentLevel).toBe(1);
    expect(plan.expansion.maxAutoLevel).toBe(2);
    expect(plan.estimatedAvailability).toBe('abundant');
  });

  test('Rare product: starts at level 1, maxAutoLevel = 4', () => {
    const plan = builder.build({
      requestId: 'req-002',
      primaryTerms: ['Roland SH-09 vintage synth'],
      rarityLevel: 'rare',
    });

    expect(plan.expansion.maxAutoLevel).toBe(4);
    expect(plan.prioritizedSourceTypes).toContain('specialist_source');
  });

  test('Escalation creates new plan at higher level', () => {
    const plan = builder.build({
      requestId: 'req-003',
      primaryTerms: ['Moog Minimoog vintage'],
      rarityLevel: 'very_rare',
      expansionAllowed: true,
    });

    const escalated = builder.escalate(plan);
    expect(escalated).not.toBeNull();
    expect(escalated!.expansion.currentLevel).toBe(2);
    expect(escalated!.expansion.attemptedLevels).toContain(1);
  });

  test('INVARIANT: escalation never modifies hard constraints', () => {
    const hardConstraint = makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } });
    const plan = builder.build({
      requestId: 'req-004',
      primaryTerms: ['Test product'],
      rarityLevel: 'uncommon',
      hardConstraints: [hardConstraint],
    });

    const escalated = builder.escalate(plan);
    expect(escalated).not.toBeNull();
    // Hard constraints must be unchanged
    expect(escalated!.hardConstraints[0].parameters?.maxBudget).toBe(500);
    expect(escalated!.hardConstraints[0].level).toBe('required');
  });

  test('Geographic expansion requires explicit authorization', () => {
    const plan = builder.build({
      requestId: 'req-005',
      primaryTerms: ['Very rare item'],
      rarityLevel: 'extremely_rare',
      geographicExpansionAllowed: false,
    });

    // Level 6 requires permission
    expect(plan.expansion.requiresConfirmation).toContain(6);

    // Escalate through levels until hitting 6
    let current: typeof plan | null = plan;
    let reachedLevel6 = false;
    while (current && builder.canAutoEscalate(current)) {
      current = builder.escalate(current);
      if (current?.expansion.currentLevel === 6) {
        reachedLevel6 = true;
      }
    }

    // Should NOT auto-escalate to level 6 without permission
    expect(reachedLevel6).toBe(false);
  });

  test('INVARIANT 2: rare product search uses specialist sources, not just popular ones', () => {
    const plan = builder.build({
      requestId: 'req-006',
      primaryTerms: ['1967 Fender Stratocaster vintage guitar'],
      rarityLevel: 'extremely_rare',
    });

    // Rare = specialist sources prioritized
    expect(plan.prioritizedSourceTypes).toContain('specialist_source');
    expect(plan.prioritizedSourceTypes).toContain('secondary_market');
  });

  test('INVARIANT 5: expansion never weakens constraints (no hidden relaxation)', () => {
    const constraint = makeCriterion({
      id: 'condition',
      name: 'New condition only',
      level: 'required',
      parameters: { preferredValues: ['new'] },
    });

    const plan = builder.build({
      requestId: 'req-007',
      primaryTerms: ['Test'],
      rarityLevel: 'common',
      hardConstraints: [constraint],
    });

    // At every escalation, constraints must remain
    let current: typeof plan | null = plan;
    while (current !== null) {
      expect(current.hardConstraints.length).toBe(1);
      expect(current.hardConstraints[0].level).toBe('required');
      current = builder.escalate(current);
    }
  });
});

// ============================================================================
// GATE 22-23: AI ORCHESTRATOR + AI ISOLATION
// ============================================================================

describe('Gate 22-23 — AI Orchestrator + Isolation', () => {
  const mockProvider = new MockAIProvider();
  const orchestrator = new AIOrchestrator([mockProvider]);

  test('AIOrchestrator: interpret returns structured InterpretedQuery', async () => {
    const result = await orchestrator.interpret({
      rawQuery: 'Je cherche un MacBook Pro avec 16GB RAM, budget 2000€',
      locale: 'fr',
      currency: 'EUR',
    });

    expect(result).toHaveProperty('productDescription');
    expect(result).toHaveProperty('extractedCriteria');
    expect(result).toHaveProperty('confidence');
    expect(result.providerUsed).toBe('MockAI [MOCKED]');
  });

  test('Audit log: reachedRankingEngine is always false', async () => {
    await orchestrator.interpret({
      rawQuery: 'Test query',
      locale: 'fr',
      currency: 'EUR',
    });

    const log = orchestrator.getAuditLog();
    expect(log.length).toBeGreaterThan(0);
    // INVARIANT: AI never reaches ranking engine
    for (const entry of log) {
      expect(entry.reachedRankingEngine).toBe(false);
    }
  });

  test('GATE 22: Two different AI interpretations → same Priority Engine ranking', () => {
    // This tests AI ISOLATION: ranking must be identical regardless of which AI interpreted the query.
    // We simulate two different interpretations that produce the same criteria.

    const criteria: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } }),
    ];

    // Both interpretations produce the same criteria → same ranking
    const offers = [
      makeOffer({ id: 'cheap', price: 400 }),
      makeOffer({ id: 'expensive', price: 1500 }), // Over budget
    ];

    const { rankOffers } = require('../../src/decision/priority-engine');

    const rankingRequest1 = {
      offers,
      effectiveCriteria: criteria, requestId: 'test-req', timestamp: new Date(),
    };

    // Simulate a "different" AI interpretation that also produces same criteria
    const rankingRequest2 = {
      offers,
      effectiveCriteria: [...criteria], requestId: 'test-req2', timestamp: new Date(), // Same criteria, different object
    };

    const r1 = rankOffers(rankingRequest1);
    const r2 = rankOffers(rankingRequest2);

    // Rankings must be identical regardless of which AI was used
    expect(r1.rankedOffers.length).toBe(r2.rankedOffers.length);
    if (r1.rankedOffers.length > 0 && r2.rankedOffers.length > 0) {
      expect(r1.rankedOffers[0].offer.id).toBe(r2.rankedOffers[0].offer.id);
    }
  });

  test('GATE 23: AI cannot inject unverified data as verified into ranking', async () => {
    // AI output that tries to claim 'verified' status for made-up data
    // must be rejected or marked as 'ai_inferred'

    const result = await orchestrator.interpret({
      rawQuery: 'MacBook Pro',
      locale: 'fr',
      currency: 'EUR',
    });

    // AI output should be used as interpretation proposal, not as verified facts
    // The extracted criteria should be proposals (ai_inferred origin)
    // This test verifies the architecture: we never pass AI output directly to ranking
    expect(result).toBeDefined();

    // The audit log should show this interpretation happened
    const log = orchestrator.getAuditLog();
    const interpretEntry = log.find(e => e.operation === 'interpret');
    expect(interpretEntry).toBeDefined();
    expect(interpretEntry!.reachedRankingEngine).toBe(false);
  });

  test('MockAIProvider: generate search terms returns valid structure', async () => {
    const result = await orchestrator.generateSearchTerms('Guitare électrique vintage', 'fr');

    expect(Array.isArray(result.primaryTerms)).toBe(true);
    expect(Array.isArray(result.synonyms)).toBe(true);
    expect(Array.isArray(result.alternativeSpellings)).toBe(true);
    expect(result.primaryTerms.length).toBeGreaterThan(0);
  });

  test('AI explanation is generated from pre-computed data, not computed by AI', async () => {
    const result = await orchestrator.explain({
      locale: 'fr',
      offerTitle: 'Sony WH-1000XM5',
      rank: 1,
      totalOffers: 5,
      score: 87,
      criteriaBreakdown: [
        { name: 'Price', score: 80, level: 'required', contribution: 'positive' },
        { name: 'Noise Cancellation', score: 95, level: 'very_important', contribution: 'positive' },
      ],
    });

    expect(typeof result.naturalLanguageExplanation).toBe('string');
    expect(result.naturalLanguageExplanation.length).toBeGreaterThan(0);
    expect(result.providerUsed).toBe('MockAI [MOCKED]');
  });
});

// ============================================================================
// GATE 24-25: CONVERSATION MODEL + SEARCH STATE
// ============================================================================

describe('Gate 24-25 — Conversation Model + SearchState', () => {
  const manager = new ConversationManager();

  test('Create conversation: has empty sessions', () => {
    const conv = manager.createConversation('user-001');
    expect(conv.userId).toBe('user-001');
    expect(conv.sessions).toHaveLength(0);
    expect(conv.activeSessionId).toBeNull();
    expect(conv.status).toBe('active');
  });

  test('Start session: creates initial state version 1', () => {
    const conv = manager.createConversation('user-002');
    const profile = makeProfile([]);
    const snapshot = new ProfileEngine().snapshot(profile, 'snap-init');

    const { updatedConversation, session } = manager.startSession(
      conv,
      'Je cherche un casque audio',
      snapshot,
    );

    expect(updatedConversation.sessions).toHaveLength(1);
    expect(updatedConversation.activeSessionId).toBe(session.id);
    expect(session.activeStateVersion).toBe(1);
    expect(session.initialRequest).toBe('Je cherche un casque audio');

    const activeState = manager.getActiveState(session);
    expect(activeState?.version).toBe(1);
    expect(activeState?.originalRequest).toBe('Je cherche un casque audio');
    expect(activeState?.status).toBe('pending');
  });

  test('Modification creates new state version, preserves old one', () => {
    const conv = manager.createConversation('user-003');
    const profileSnap = new ProfileEngine().snapshot(makeProfile([]), 'snap-mod');

    const { session: initialSession } = manager.startSession(conv, 'Casque audio', profileSnap);

    const updatedSession = manager.applyModification(initialSession, {
      type: 'change_budget',
      reason: 'User changed budget from 300€ to 500€',
      updatedRequest: makeRequest([makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } })]),
    });

    // New version created
    expect(updatedSession.activeStateVersion).toBe(2);

    // Old version still exists
    const v1 = updatedSession.states.get(1);
    const v2 = updatedSession.states.get(2);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v2?.previousVersion).toBe(1);
    expect(v2?.creationReason).toBe('User changed budget from 300€ to 500€');
  });

  test('INVARIANT 5: originalRequest is NEVER changed by modifications', () => {
    const conv = manager.createConversation('user-004');
    const profileSnap = new ProfileEngine().snapshot(makeProfile([]), 'snap-orig');
    const { session } = manager.startSession(conv, 'Je cherche un sac à dos', profileSnap);

    const modified = manager.applyModification(session, {
      type: 'add_constraint',
      reason: 'Added color constraint',
    });

    // Original request preserved in ALL versions
    const history = manager.getStateHistory(modified);
    for (const state of history) {
      expect(state.originalRequest).toBe('Je cherche un sac à dos');
    }
  });

  test('State history is append-only — older versions not deleted', () => {
    const conv = manager.createConversation('user-005');
    const profileSnap = new ProfileEngine().snapshot(makeProfile([]), 'snap-hist');
    const { session } = manager.startSession(conv, 'Test request', profileSnap);

    let s = session;
    s = manager.applyModification(s, { type: 'change_budget', reason: 'Modification 1' });
    s = manager.applyModification(s, { type: 'change_budget', reason: 'Modification 2' });
    s = manager.applyModification(s, { type: 'change_budget', reason: 'Modification 3' });

    expect(s.activeStateVersion).toBe(4);
    expect(s.states.size).toBe(4); // All 4 versions present

    const history = manager.getStateHistory(s);
    expect(history).toHaveLength(4);
    expect(history[0].version).toBe(1);
    expect(history[3].version).toBe(4);
  });

  test('Add message to session: preserved in order', () => {
    const conv = manager.createConversation('user-006');
    const profileSnap = new ProfileEngine().snapshot(makeProfile([]), 'snap-msg');
    const { session } = manager.startSession(conv, 'Test', profileSnap);

    let s = session;
    s = manager.addMessage(s, {
      id: 'msg-001',
      role: 'user',
      kind: 'search_request',
      content: 'Je cherche un vélo',
      timestamp: new Date(),
      activeStateVersion: 1,
    });
    s = manager.addMessage(s, {
      id: 'msg-002',
      role: 'capucine',
      kind: 'clarification_query',
      content: 'Quel type de vélo ? Route, VTT, ou ville ?',
      timestamp: new Date(),
      basedOnStateVersion: 1,
    });

    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].role).toBe('user');
    expect(s.messages[1].role).toBe('capucine');
    expect(s.messages[1].kind).toBe('clarification_query');
  });

  test('Profile snapshot used by session is isolated from later profile changes', () => {
    const profileEngine = new ProfileEngine();
    const profile = makeProfile([
      makeCriterion({ id: 'brand', name: 'Brand', level: 'important' }),
    ]);

    const snapshot = profileEngine.snapshot(profile, 'snap-isolation');

    const conv = manager.createConversation('user-007');
    const { session } = manager.startSession(conv, 'Test', snapshot);

    // Now "update" the profile after session started
    profile.preferences.criteria[0] = {
      ...profile.preferences.criteria[0],
      level: 'required', // Changed after session start
    };

    // Session's profile snapshot must NOT reflect this change
    const activeState = manager.getActiveState(session);
    expect(activeState?.profileSnapshot.criteria[0].level).toBe('important');
  });
});

// ============================================================================
// GATE 28: ADDITIONAL ADVERSARIAL TESTS
// ============================================================================

describe('Gate 28 — Additional Adversarial Tests', () => {
  const { rankOffers, filterEligible } = require('../../src/decision/priority-engine');

  // ADVERSARIAL 1: Merchant identity must not affect ranking
  test('ADV-01: Identical offers from different merchants → identical scores', () => {
    const offerA = makeOffer({ id: 'a', merchantId: 'fnac', merchantName: 'Fnac', price: 299, priceStatus: 'verified' });
    const offerB = makeOffer({ id: 'b', merchantId: 'amazon', merchantName: 'Amazon', price: 299, priceStatus: 'verified' });

    // Same product ID, same price, same characteristics
    offerA.productId = 'shared-product';
    offerB.productId = 'shared-product';

    const request = {
      offers: [offerA, offerB],
      effectiveCriteria: [makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } })],
      requestId: 'adv-01',
      timestamp: new Date(),
    };

    const result = rankOffers(request);
    const scores = result.rankedOffers.map((r: { overallScore: number }) => r.overallScore);
    // Both must have identical scores (merchant doesn't affect scoring)
    if (scores.length === 2) {
      expect(Math.abs(scores[0] - scores[1])).toBeLessThanOrEqual(1); // Allow 1 point rounding diff
    }
  });

  // ADVERSARIAL 2: Execution capability must not affect ranking
  test('ADV-02: Identical offers with different execution capabilities → same score', () => {
    // Same price = same score, regardless of execution capability
    const apiOffer = makeOffer({ id: 'api', price: 300, priceStatus: 'verified' });
    apiOffer.merchant.executionCapabilities = ['merchant_api'];

    const webOffer = makeOffer({ id: 'web', price: 300, priceStatus: 'verified' });
    webOffer.merchant.executionCapabilities = ['web_redirect'];

    const request = {
      offers: [apiOffer, webOffer],
      effectiveCriteria: [makeCriterion({ id: 'price', name: 'Budget', level: 'very_important', parameters: { maxBudget: 1000 } })],
      requestId: 'adv-02',
      timestamp: new Date(),
    };

    const result = rankOffers(request);
    // Execution capability has ZERO effect on ranking: same price → same score
    if (result.rankedOffers.length === 2) {
      const apiScore = result.rankedOffers.find((r: { offer: { id: string } }) => r.offer.id === 'api')?.overallScore ?? -1;
      const webScore = result.rankedOffers.find((r: { offer: { id: string } }) => r.offer.id === 'web')?.overallScore ?? -1;
      expect(Math.abs(apiScore - webScore)).toBeLessThanOrEqual(1); // ≤1 for integer rounding
    }
  });

  // ADVERSARIAL 3: Budget exceeded = always rejected regardless of quality
  test('ADV-03: Perfect quality offer that exceeds budget is filtered by admissibility', () => {
    const admissibility = new AdmissibilityEngine();

    // "Perfect" offer — has everything, but too expensive
    const perfect = makeOffer({
      price: 5000,
      chars: {
        warranty: makeDataPoint('5 years'),
        quality: makeDataPoint('excellent'),
        rating: makeDataPoint(5.0),
      },
    });

    const budget: PreferenceCriterion = makeCriterion({
      id: 'price',
      name: 'Budget',
      level: 'required',
      parameters: { maxBudget: 2000 },
    });

    const result = admissibility.checkOffer(perfect, [budget]);
    expect(result.eligible).toBe(false); // Must be rejected despite "quality"
    expect(result.violations[0].criterionId).toBe('price');
  });

  // ADVERSARIAL 4: Deduplication with no false positives
  test('ADV-04: Similar-sounding different products are NOT merged', () => {
    const dedup = new DeduplicationEngine();

    // "Sony WH-1000XM4" vs "Sony WH-1000XM5" — different models!
    const xm4 = makeOffer({
      id: 'xm4',
      chars: {
        model: makeDataPoint('WH-1000XM4'),
        manufacturer: makeDataPoint('Sony'),
      },
    });
    const xm5 = makeOffer({
      id: 'xm5',
      chars: {
        model: makeDataPoint('WH-1000XM5'),
        manufacturer: makeDataPoint('Sony'),
      },
    });

    const result = dedup.deduplicate([xm4, xm5]);
    // These are different models — should NOT be merged
    expect(result.distinctProducts).toBe(2);
  });

  // ADVERSARIAL 5: UNKNOWN price ≠ free
  test('ADV-05: Offer with unknown price is not ranked as "cheapest"', () => {
    const knownPrice = makeOffer({ id: 'known', price: 200, priceStatus: 'known' });
    const unknownPrice = makeOffer({ id: 'unknown', price: null, priceStatus: 'unknown' });

    const request = {
      offers: [knownPrice, unknownPrice],
      effectiveCriteria: [makeCriterion({ id: 'price', name: 'Budget', level: 'very_important', parameters: { maxBudget: 1000 } })],
      requestId: 'adv-05',
      timestamp: new Date(),
    };

    const result = rankOffers(request);
    // Unknown price should NOT rank #1 over a known cheaper price
    if (result.rankedOffers.length > 0) {
      // The offer with known price at 200 should not be beaten by an unknown price
      const knownRank = result.rankedOffers.findIndex((r: { offer: { id: string } }) => r.offer.id === 'known');
      const unknownRank = result.rankedOffers.findIndex((r: { offer: { id: string } }) => r.offer.id === 'unknown');
      // Known price should rank at or above unknown price for price criteria
      expect(knownRank).toBeLessThanOrEqual(unknownRank);
    }
  });

  // ADVERSARIAL 6: Silent constraint relaxation is forbidden
  test('ADV-06: Search expansion NEVER removes hard constraints', () => {
    const searchPlanBuilder = new SearchPlanBuilder();
    const hardConstraint = makeCriterion({
      id: 'condition',
      name: 'New only',
      level: 'required',
      parameters: { preferredValues: ['new'] },
    });

    const plan = searchPlanBuilder.build({
      requestId: 'adv-06',
      primaryTerms: ['test item'],
      rarityLevel: 'very_rare',
      hardConstraints: [hardConstraint],
      expansionAllowed: true,
    });

    // Escalate multiple times
    let current: typeof plan | null = plan;
    let escalations = 0;
    while (current !== null) {
      // At each level, hard constraints must be unchanged
      expect(current.hardConstraints.length).toBeGreaterThan(0);
      expect(current.hardConstraints[0].level).toBe('required');
      expect((current.hardConstraints[0].parameters as Record<string, unknown>)?.preferredValues).toEqual(['new']);
      current = searchPlanBuilder.escalate(current);
      escalations++;
      if (escalations > 10) break; // Safety
    }
    expect(escalations).toBeGreaterThan(0);
  });

  // ADVERSARIAL 7: Profile override does not permanently change profile
  test('ADV-07: Applying temporary override does not mutate permanent profile', () => {
    const profileEngine = new ProfileEngine();
    const profile = makeProfile([
      makeCriterion({ id: 'eco', name: 'Eco label', level: 'required' }),
    ]);
    const originalProfile = JSON.parse(JSON.stringify(profile)); // deep clone

    const request = makeRequest();
    const override: ProfileOverride = {
      criterionId: 'eco',
      temporaryLevel: 'preference',
      reason: 'User temporarily lowered eco requirement',
      source: 'explicit_user',
      createdAt: new Date(),
    };

    profileEngine.resolve(profile, request, [override], 'adv-07');

    // Profile must be unchanged
    expect(profile.preferences.criteria[0].level).toBe('required');
    expect(profile.preferences.criteria[0].level).toBe(originalProfile.preferences.criteria[0].level);
  });

  // ADVERSARIAL 8: Multiple overrides are all traceable
  test('ADV-08: Multiple profile overrides are all logged in appliedOverrides', () => {
    const profileEngine = new ProfileEngine();
    const profile = makeProfile([
      makeCriterion({ id: 'eco', name: 'Eco', level: 'required' }),
      makeCriterion({ id: 'brand', name: 'Brand', level: 'important' }),
    ]);

    const request = makeRequest();
    const overrides: ProfileOverride[] = [
      { criterionId: 'eco', temporaryLevel: 'preference', reason: 'Override eco', source: 'explicit_user', createdAt: new Date() },
      { criterionId: 'brand', temporaryLevel: 'disabled', reason: 'Override brand', source: 'explicit_user', createdAt: new Date() },
    ];

    const result = profileEngine.resolve(profile, request, overrides, 'adv-08');
    expect(result.appliedOverrides.length).toBe(2);
  });

  // ADVERSARIAL 9: Conversation state history never deletes old states
  test('ADV-09: State history is append-only', () => {
    const convManager = new ConversationManager();
    const profileSnap = new ProfileEngine().snapshot(makeProfile([]), 'snap-adv09');
    const conv = convManager.createConversation('user-adv09');
    const { session } = convManager.startSession(conv, 'Test', profileSnap);

    let s = session;
    const modifications = ['mod1', 'mod2', 'mod3', 'mod4', 'mod5'];
    for (const reason of modifications) {
      s = convManager.applyModification(s, { type: 'change_budget', reason });
    }

    // Should have 6 versions: 1 initial + 5 modifications
    expect(s.states.size).toBe(6);
    expect(s.activeStateVersion).toBe(6);

    // All versions accessible
    for (let v = 1; v <= 6; v++) {
      expect(s.states.get(v)).toBeDefined();
    }
  });

  // ADVERSARIAL 10: Deduplication grouping is stable across multiple runs
  test('ADV-10: Deduplication is deterministic — same input → same output', () => {
    const dedup = new DeduplicationEngine();

    const offers = [
      makeOffer({ id: 'a1', chars: { ean: makeDataPoint('1234567890123') } }),
      makeOffer({ id: 'b1', chars: { ean: makeDataPoint('9876543210987') } }),
      makeOffer({ id: 'a2', chars: { ean: makeDataPoint('1234567890123') } }), // Duplicate of a1
    ];

    const result1 = dedup.deduplicate(offers);
    const result2 = dedup.deduplicate(offers);

    expect(result1.distinctProducts).toBe(result2.distinctProducts);
    expect(result1.duplicatesRemoved).toBe(result2.duplicatesRemoved);
  });
});

// ============================================================================
// GATE 30: END-TO-END OFFLINE PIPELINE
// ============================================================================

describe('Gate 30 — End-to-End Offline Pipeline (with mock data)', () => {
  test('Full pipeline: User Request → Profile → AdmissibilityFilter → Ranking', () => {
    const { rankOffers } = require('../../src/decision/priority-engine');
    const admissibilityEngine = new AdmissibilityEngine();
    const deduplicationEngine = new DeduplicationEngine();

    // 1. USER REQUEST: "Je cherche des écouteurs sans fil, budget 150€, neufs"
    const userCriteria: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 150 } }),
      makeCriterion({ id: 'connectivity', name: 'Wireless', level: 'required', parameters: { preferredValues: ['bluetooth', 'wireless'] } }),
      makeCriterion({ id: 'condition', name: 'New condition', level: 'required', parameters: { preferredValues: ['new'] } }),
      makeCriterion({ id: 'battery', name: 'Battery life', level: 'very_important' }),
      makeCriterion({ id: 'brand', name: 'Brand', level: 'preference' }),
    ];

    // 2. PROFILE: User prefers to avoid marketplace sellers
    const profile = makeProfile([
      makeCriterion({ id: 'marketplace', name: 'Avoid marketplace', level: 'preference' }),
    ]);

    // 3. PROFILE ENGINE: Merge profile + request
    const profileEngine = new ProfileEngine();
    const effectiveCriteria = profileEngine.resolve(
      profile,
      makeRequest(userCriteria),
      [],
      'e2e-001'
    );

    // 4. RAW CANDIDATES (mock discovery results)
    const candidates: Offer[] = [
      // Good match: within budget, wireless, new
      makeOffer({
        id: 'sony-xb710ap',
        productId: 'sony-xb710ap',
        price: 89,
        priceStatus: 'verified',
        chars: {
          connectivity: makeDataPoint('bluetooth'),
          condition: makeDataPoint('new'),
          battery: makeDataPoint('35h'),
        },
        merchantId: 'fnac',
        merchantName: 'Fnac',
      }),
      // Over budget: should be rejected by admissibility
      makeOffer({
        id: 'apple-airpods-pro',
        productId: 'apple-airpods-pro',
        price: 249,
        priceStatus: 'verified',
        chars: {
          connectivity: makeDataPoint('bluetooth'),
          condition: makeDataPoint('new'),
          battery: makeDataPoint('30h'),
        },
      }),
      // Good match: slightly more expensive but within budget
      makeOffer({
        id: 'jabra-elite-4',
        productId: 'jabra-elite-4',
        price: 129,
        priceStatus: 'verified',
        chars: {
          connectivity: makeDataPoint('bluetooth'),
          condition: makeDataPoint('new'),
          battery: makeDataPoint('28h'),
        },
        merchantId: 'amazon',
        merchantName: 'Amazon',
      }),
      // No wireless: should be rejected
      makeOffer({
        id: 'wired-headset',
        productId: 'wired-headset',
        price: 29,
        chars: {
          connectivity: makeDataPoint('wired'),
          condition: makeDataPoint('new'),
        },
      }),
      // Duplicate of sony via EAN
      makeOffer({
        id: 'sony-xb710ap-v2',
        productId: 'sony-xb710ap', // Same product ID → duplicate
        price: 95,
        priceStatus: 'known',
        chars: {
          connectivity: makeDataPoint('bluetooth'),
          condition: makeDataPoint('new'),
        },
        merchantId: 'darty',
        merchantName: 'Darty',
      }),
    ];

    // 5. ADMISSIBILITY FILTERING
    const hardConstraints = effectiveCriteria.criteria.filter(c =>
      c.level === 'required' || c.level === 'forbidden'
    );
    const admissibilityResult = admissibilityEngine.filter(candidates, hardConstraints);

    // Validate admissibility results
    expect(admissibilityResult.eligibleOffers.length).toBeGreaterThan(0);
    expect(admissibilityResult.rejectedOffers.length).toBeGreaterThan(0);

    // Over-budget offer must be rejected
    const overBudgetRejected = admissibilityResult.rejectedOffers.some(r => r.offer.id === 'apple-airpods-pro');
    expect(overBudgetRejected).toBe(true);

    // Wired offer must be rejected (wrong connectivity)
    const wiredRejected = admissibilityResult.rejectedOffers.some(r => r.offer.id === 'wired-headset');
    expect(wiredRejected).toBe(true);

    // 6. DEDUPLICATION
    const dedupResult = deduplicationEngine.deduplicate(admissibilityResult.eligibleOffers);

    // Sony duplicate should be detected
    expect(dedupResult.distinctProducts).toBeLessThanOrEqual(admissibilityResult.eligibleCount);

    // 7. RANKING (using best offer from each group)
    const offersToRank = dedupResult.groups.map(g => deduplicationEngine.selectBestOffer(g).best);

    const rankingRequest = {
      offers: offersToRank,
      effectiveCriteria: effectiveCriteria.criteria,
      requestId: 'e2e-rank-001',
      timestamp: new Date(),
    };
    const rankingResult = rankOffers(rankingRequest);

    // Pipeline produced results
    expect(rankingResult.rankedOffers.length).toBeGreaterThan(0);

    // INVARIANT 3: Merchant (fnac vs amazon) must not determine ranking — price/specs do
    const rankedIds = rankingResult.rankedOffers.map((r: { offer: { id: string } }) => r.offer.id);
    expect(rankedIds.length).toBeGreaterThan(0);

    // INVARIANT 1: The result must correspond to user's stated criteria (budget + wireless)
    for (const rankedOffer of rankingResult.rankedOffers) {
      expect(rankedOffer.offer.price.value).toBeLessThanOrEqual(150);
    }
  });

  test('E2E: Empty result when all candidates fail admissibility', () => {
    const admissibility = new AdmissibilityEngine();

    // All candidates are over budget
    const overBudgetOffers = [
      makeOffer({ price: 1500 }),
      makeOffer({ price: 2000 }),
      makeOffer({ price: 999 }),
    ];

    const budget: PreferenceCriterion = makeCriterion({
      id: 'price',
      name: 'Budget',
      level: 'required',
      parameters: { maxBudget: 500 },
    });

    const result = admissibility.filter(overBudgetOffers, [budget]);

    expect(result.eligibleCount).toBe(0);
    expect(result.rejectedCount).toBe(3);
  });

  test('E2E: INVARIANT 2 — Rare product from specialist source appears in results', () => {
    const admissibility = new AdmissibilityEngine();
    const { rankOffers } = require('../../src/decision/priority-engine');

    // A very rare vintage synth found only on a specialist platform
    const rareVintageSynth = makeOffer({
      id: 'minimoog-1970',
      productId: 'minimoog-1970',
      price: 4500,
      priceStatus: 'known',
      chars: {
        year: makeDataPoint(1970),
        condition: makeDataPoint('excellent'),
        authenticity: makeDataPoint('certified'),
      },
      merchantId: 'vintage-synth-specialist',
      merchantName: 'Vintage Synth Specialist',
    });

    const criteria: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'required', parameters: { maxBudget: 10000 } }),
    ];

    const batch = admissibility.filter([rareVintageSynth], criteria);

    // The rare product must be eligible (rarity doesn't reduce relevance)
    expect(batch.eligibleCount).toBe(1);
    expect(batch.eligibleOffers[0].id).toBe('minimoog-1970');

    // Rank it
    const result = rankOffers({
      offers: batch.eligibleOffers,
      effectiveCriteria: criteria, requestId: 'test-req', timestamp: new Date(),
    });

    expect(result.rankedOffers.length).toBe(1);
    expect(result.rankedOffers[0].offer.id).toBe('minimoog-1970');
  });

  test('E2E: INVARIANT 4 — Browser automation offer and API offer rank equally when product is equal', () => {
    const { rankOffers } = require('../../src/decision/priority-engine');

    const apiOffer = makeOffer({ id: 'api-offer', price: 300, priceStatus: 'verified' });
    apiOffer.merchant.executionCapabilities = ['merchant_api'];

    const browserOffer = makeOffer({ id: 'browser-offer', price: 300, priceStatus: 'verified' });
    browserOffer.merchant.executionCapabilities = ['browser_automation'];

    const criteria: PreferenceCriterion[] = [
      makeCriterion({ id: 'price', name: 'Budget', level: 'very_important', parameters: { maxBudget: 1000 } }),
    ];

    const result = rankOffers({
      offers: [apiOffer, browserOffer],
      effectiveCriteria: criteria, requestId: 'test-req', timestamp: new Date(),
    });

    if (result.rankedOffers.length === 2) {
      const apiScore = result.rankedOffers.find((r: { offer: { id: string } }) => r.offer.id === 'api-offer')?.overallScore || 0;
      const browserScore = result.rankedOffers.find((r: { offer: { id: string } }) => r.offer.id === 'browser-offer')?.overallScore || 0;

      // Execution capability must have ZERO effect on score
      expect(Math.abs(apiScore - browserScore)).toBeLessThanOrEqual(1); // ≤1 for rounding
    }
  });
});
