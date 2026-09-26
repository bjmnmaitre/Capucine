/**
 * Capucine — Onboarding answers → criteria (tests)
 *
 * The cardinal rule: an onboarding answer is a WISH to be weighed, never a
 * filter. These tests lock the invariant that NOTHING built here can ever
 * exclude at admissibility time (only `required`/`forbidden` do), and that
 * unknown data is always passed, never punished blindly.
 */
import {
  budgetCriterion,
  conditionCriterion,
  freeShippingCriterion,
  originCriterion,
  buildOnboardingCriteria,
  buildMerchantAccounts,
  normalizeShippingProfile,
  merchantAccountCriterion,
  ONBOARDING_BUDGET_ID,
  ONBOARDING_CONDITION_ID,
  ONBOARDING_FREE_SHIPPING_ID,
  ONBOARDING_ORIGIN_ID,
} from '../../src/domain/onboarding';

describe('onboarding criteria builders — softness invariant', () => {
  it('every preference builder emits a SOFT level and unknownPolicy pass', () => {
    const built = [
      budgetCriterion({ maxAmount: 200, currency: 'EUR' }),
      conditionCriterion('new'),
      freeShippingCriterion('very_important'),
      originCriterion('france'),
    ];
    for (const c of built) {
      expect(c).not.toBeNull();
      expect(['very_important', 'important', 'preference']).toContain(c?.level);
      expect(c?.parameters?.unknownPolicy).toBe('pass');
    }
  });

  it('NO criterion ever targets required or forbidden — the cardinal "ne limitons jamais" rule', () => {
    const all = buildOnboardingCriteria({
      budget: { maxAmount: 100, currency: 'EUR' },
      condition: 'new',
      freeShipping: 'very_important',
      origin: 'europe',
    });
    // Only the READ-ONLY merchant-exclusions may be forbidden, and only when
    // the user EXPLICITLY listed excluded merchants.
    expect(all.some((c) => c.level === 'required')).toBe(false);
    expect(all.some((c) => c.level === 'forbidden')).toBe(false);
  });

  it('budget uses the shared `budget` id and maps to price (maxBudget)', () => {
    const c = budgetCriterion({ maxAmount: 250, currency: 'EUR' });
    expect(c?.id).toBe(ONBOARDING_BUDGET_ID);
    expect(c?.level).toBe('preference');
    expect(c?.parameters?.maxBudget).toBe(250);
    expect(c?.parameters?.currency).toBe('EUR');
  });

  it('a null or non-positive budget produces NO criterion (declining is valid)', () => {
    expect(budgetCriterion(null)).toBeNull();
    expect(budgetCriterion({ maxAmount: 0, currency: 'EUR' })).toBeNull();
  });

  it('condition maps to the interpreter\'s vocabulary and is only soft', () => {
    const c = conditionCriterion('used');
    expect(c?.id).toBe(ONBOARDING_CONDITION_ID);
    expect(c?.level).toBe('important');
    expect(c?.parameters?.preferredValues).toEqual(['used']);
    expect(conditionCriterion('any')).toBeNull();
  });

  it('free shipping reuses the `shipping` slot id both engines map to offer.shippingCost', () => {
    const c = freeShippingCriterion('important');
    expect(c?.id).toBe(ONBOARDING_FREE_SHIPPING_ID);
    expect(c?.parameters?.maxValue).toBe(0);
    expect(freeShippingCriterion('off' as never)).toBeNull();
  });

  it('origin is very_important soft — a China-made offer is KEPT, just not boosted', () => {
    const c = originCriterion('france');
    expect(c?.id).toBe(ONBOARDING_ORIGIN_ID);
    expect(c?.level).toBe('very_important');
    expect(c?.parameters?.field).toBe('country_of_origin');
    expect(c?.parameters?.preferredValues).toEqual(['FR', 'France']);
    expect(c?.parameters?.unknownPolicy).toBe('pass');
    expect(originCriterion('any')).toBeNull();
  });
});

describe('buildOnboardingCriteria — deterministic full list', () => {
  it('builds the expected ordering: budget, condition, shipping, origin, exclusions', () => {
    const all = buildOnboardingCriteria({
      budget: { maxAmount: 500, currency: 'EUR' },
      condition: 'new',
      freeShipping: 'preference',
      origin: 'france',
      excludedMerchants: ['Amazon'],
    });
    expect(all.map((c) => c.id)).toEqual([
      'budget', 'condition', 'shipping', 'eu_origin', 'merchant-exclude-amazon',
    ]);
    expect(all.find((c) => c.id.startsWith('merchant-exclude-'))?.level).toBe('forbidden');
  });

  it('declining every question yields an empty list — a valid profile', () => {
    expect(buildOnboardingCriteria({})).toEqual([]);
  });
});

describe('merchantAccountCriterion — the ONLY hard-leaning answer', () => {
  it('is forbidden, applied at presentation time (masked + reported), never a silent discovery filter', () => {
    const c = merchantAccountCriterion('Amazon');
    expect(c.id).toBe('merchant-exclude-amazon');
    expect(c.level).toBe('forbidden');
    expect(c.parameters?.merchantName).toBe('Amazon');
  });
});

describe('buildMerchantAccounts', () => {
  it('each entry IS the consent — the list is the stored facts', () => {
    const accounts = buildMerchantAccounts([{ merchantName: 'Amazon' }, { merchantName: 'Fnac' }]);
    expect(accounts.map((a) => a.merchantName)).toEqual(['Amazon', 'Fnac']);
    expect(accounts.every((a) => a.grantedAt instanceof Date)).toBe(true);
  });

  it('trims names, drops empties, dedupes case-insensitively, memoizes consent date', () => {
    const a = buildMerchantAccounts([
      { merchantName: '  Amazon ' },
      { merchantName: 'amazon' },
      { merchantName: '   ' },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].merchantName).toBe('Amazon');
  });

  it('null/undefined → no stored account (no consent given)', () => {
    expect(buildMerchantAccounts(null)).toEqual([]);
    expect(buildMerchantAccounts(undefined)).toEqual([]);
  });
});

describe('normalizeShippingProfile', () => {
  it('trims, drops empty strings, defaults country to FR, keeps delivery mode', () => {
    const out = normalizeShippingProfile({
      firstName: '  Jeanne ',
      lastName: 'Dupont',
      city: ' ',
      preferredDeliveryMode: 'home',
    });
    expect(out).toEqual({
      firstName: 'Jeanne', lastName: 'Dupont', city: undefined, postalCode: undefined,
      email: undefined, street: undefined, country: 'FR', preferredDeliveryMode: 'home',
    });
  });

  it('an all-empty shipping answer is stored as nothing', () => {
    expect(normalizeShippingProfile({ firstName: ' ' })).toBeNull();
    expect(normalizeShippingProfile(null)).toBeNull();
    expect(normalizeShippingProfile(undefined)).toBeNull();
  });
});