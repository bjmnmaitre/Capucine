/**
 * MockAIProvider heuristics must not fabricate criteria from substrings:
 * the mock drives the whole test suite, a false criterion there hides bugs.
 */
import { MockAIProvider } from '../../src/application/ai-orchestrator';

async function criteriaFor(query: string): Promise<Array<{ id: string; parameters?: { preferredValues?: string[] } }>> {
  const res = await new MockAIProvider().complete({
    prompt: `Analyse cette requête d'achat : "${query}"`,
    model: 'mock-fast',
    maxTokens: 500,
  });
  return JSON.parse(res.content).extractedCriteria;
}

const categoryOf = async (q: string) => (await criteriaFor(q)).find(c => c.id === 'category')?.parameters?.preferredValues?.[0];
const conditionOf = async (q: string) => (await criteriaFor(q)).find(c => c.id === 'condition')?.parameters?.preferredValues?.[0];

describe('MockAIProvider — category heuristic', () => {
  it('"enceinte portable" is NOT a laptop', async () => {
    expect(await categoryOf('enceinte portable bluetooth')).toBeUndefined();
  });
  it('"batterie portable" is NOT a laptop', async () => {
    expect(await categoryOf('batterie portable 20000 mah')).toBeUndefined();
  });
  it('"ordinateur portable" / "pc portable" / "laptop" are laptops', async () => {
    expect(await categoryOf('ordinateur portable 16 go')).toBe('ordinateur_portable');
    expect(await categoryOf('pc portable gamer')).toBe('ordinateur_portable');
    expect(await categoryOf('laptop lenovo')).toBe('ordinateur_portable');
  });
});

describe('MockAIProvider — condition heuristic', () => {
  it('"news" / "renew" never produce a "new" condition', async () => {
    expect(await conditionOf('casque sony news')).toBeUndefined();
    expect(await conditionOf('renew abonnement')).toBeUndefined();
  });
  it('"neuf" / "brand new" → new ; "reconditionné" / "occasion" → used', async () => {
    expect(await conditionOf('iphone neuf')).toBe('new');
    expect(await conditionOf('brand new iphone')).toBe('new');
    expect(await conditionOf('iphone reconditionné')).toBe('used');
    expect(await conditionOf('vélo occasion')).toBe('used');
  });
});
