/**
 * Tests for SearchStrategyPlanner — deriving multiple complementary search
 * queries from a single SearchPlan/DiscoveryCriteria, instead of one flat
 * keyword string.
 */

import { SearchStrategyPlanner } from '../../src/application/search-strategy-planner';
import { DiscoveryCriteria } from '../../src/application/discovery';
import { PreferenceCriterion } from '../../src/domain/types';

describe('SearchStrategyPlanner', () => {
  let planner: SearchStrategyPlanner;

  beforeEach(() => {
    planner = new SearchStrategyPlanner();
  });

  it('produces a general strategy from keywords + category', () => {
    const criteria: DiscoveryCriteria = { keywords: ['ordinateur', 'portable'], categories: ['ordinateur_portable'] };
    const strategies = planner.buildStrategies(criteria);

    const general = strategies.find(s => s.channel === 'general');
    expect(general).toBeDefined();
    expect(general!.query).toContain('ordinateur');
    expect(general!.query).toContain('portable');
  });

  it('normalizes an internal snake_case category id to words before it becomes a real search-engine query (never sends "ordinateur_portable" literally)', () => {
    const criteria: DiscoveryCriteria = { keywords: ['ordinateur', 'portable'], categories: ['ordinateur_portable'] };
    const strategies = planner.buildStrategies(criteria);

    for (const s of strategies) {
      expect(s.query).not.toMatch(/_/); // no raw internal id ever leaks into a query string
    }
    const category = strategies.find(s => s.channel === 'category');
    expect(category!.query).toContain('ordinateur portable');
  });

  it('produces a category strategy only when a category is present', () => {
    const withCategory = planner.buildStrategies({ keywords: ['casque'], categories: ['casque'] });
    expect(withCategory.some(s => s.channel === 'category')).toBe(true);

    const withoutCategory = planner.buildStrategies({ keywords: ['casque'] });
    expect(withoutCategory.some(s => s.channel === 'category')).toBe(false);
  });

  it('produces a budget strategy only when maxPrice is present, anchored on the real value', () => {
    const withBudget = planner.buildStrategies({ keywords: ['casque'], maxPrice: 200 });
    const budget = withBudget.find(s => s.channel === 'budget');
    expect(budget).toBeDefined();
    expect(budget!.query).toContain('200');

    const withoutBudget = planner.buildStrategies({ keywords: ['casque'] });
    expect(withoutBudget.some(s => s.channel === 'budget')).toBe(false);
  });

  it('derives a technical_specs strategy generically from any numeric hardConstraints — not hardcoded to ram/screen_size', () => {
    const hardConstraints: PreferenceCriterion[] = [
      { id: 'ram', name: 'Mémoire RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } },
      { id: 'screen_size', name: "Taille d'écran", level: 'required', parameters: { exactValue: 14, unit: 'pouces' } },
    ];
    const strategies = planner.buildStrategies({ keywords: ['ordinateur'] }, hardConstraints);
    const specs = strategies.find(s => s.channel === 'technical_specs');
    expect(specs).toBeDefined();
    expect(specs!.query).toContain('16GB');
    expect(specs!.query).toContain('14pouces');
  });

  it('a criterion with no minValue/exactValue (e.g. category, preferredValues-only) contributes nothing to technical_specs', () => {
    const hardConstraints: PreferenceCriterion[] = [
      { id: 'category', name: 'Catégorie', level: 'required', parameters: { preferredValues: ['ordinateur_portable'] } },
    ];
    const strategies = planner.buildStrategies({ keywords: ['ordinateur'] }, hardConstraints);
    expect(strategies.some(s => s.channel === 'technical_specs')).toBe(false);
  });

  it('produces a synonym/complementary strategy when keywords are present', () => {
    const strategies = planner.buildStrategies({ keywords: ['casque', 'bluetooth'] });
    expect(strategies.some(s => s.channel === 'synonym')).toBe(true);
  });

  it('assigns general/category to phase 1 and technical_specs/budget/synonym to phase 2', () => {
    const strategies = planner.buildStrategies(
      { keywords: ['ordinateur'], categories: ['ordinateur_portable'], maxPrice: 1000 },
      [{ id: 'ram', name: 'RAM', level: 'required', parameters: { minValue: 16, unit: 'GB' } }]
    );
    for (const s of strategies) {
      if (s.channel === 'general' || s.channel === 'category') expect(s.phase).toBe(1);
      else expect(s.phase).toBe(2);
    }
  });

  it('never produces duplicate query strings across channels', () => {
    // No category, no maxPrice, no hardConstraints → 'general' and 'synonym'
    // are the only candidates; ensure no accidental identical strings slip through.
    const strategies = planner.buildStrategies({ keywords: ['casque'] });
    const queries = strategies.map(s => s.query.toLowerCase());
    expect(new Set(queries).size).toBe(queries.length);
  });

  it('produces nothing (empty array) for empty criteria — never invents a query from nothing', () => {
    expect(planner.buildStrategies({})).toEqual([]);
  });

  it('the same query is never derived twice even when it could match two channels', () => {
    // Empty keywords + a category equal to what 'general' would produce alone.
    const strategies = planner.buildStrategies({ categories: ['casque'] });
    const generalQueries = strategies.filter(s => s.channel === 'general').map(s => s.query);
    expect(new Set(generalQueries).size).toBe(generalQueries.length);
  });
});
