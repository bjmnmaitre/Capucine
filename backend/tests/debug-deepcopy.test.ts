import { InMemoryProfileStore, createProfileWithCriteria } from '../src/application/profile-store';
import { PreferenceCriterion } from '../src/domain/types';

const budget300: PreferenceCriterion = {
  id: 'budget',
  name: 'Budget',
  level: 'required',
  parameters: { maxBudget: 300 },
};

describe('debug deepCopy', () => {
  it('load returns a copy — replicate failing test exactly', async () => {
    const store = new InMemoryProfileStore();
    await store.save(createProfileWithCriteria('user-1', [budget300]));

    const loaded = await store.load('user-1');
    console.log('loaded === same object as stored?', loaded === (store as any).profiles.get('user-1'));
    console.log('loaded criteria[0] === budget300?', loaded.preferences.criteria[0] === budget300);
    
    loaded.preferences.criteria[0].level = 'preference';
    
    const stored = (store as any).profiles.get('user-1');
    console.log('stored.criteria[0].level after mutation of loaded:', stored.preferences.criteria[0].level);
    
    const loaded2 = await store.load('user-1');
    console.log('loaded2.criteria[0].level:', loaded2.preferences.criteria[0].level);
  });
});
