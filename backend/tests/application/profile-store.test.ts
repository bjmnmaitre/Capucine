/**
 * Profile Store Tests
 *
 * Tests for InMemoryProfileStore — load, save, update, merge, GDPR delete.
 * Also verifies the API endpoints for profile management.
 */

import {
  InMemoryProfileStore,
  createEmptyProfile,
  createProfileWithCriteria,
  mergeProfiles,
} from '../../src/application/profile-store';
import { PreferenceCriterion } from '../../src/domain/types';

const budget300: PreferenceCriterion = {
  id: 'budget',
  name: 'Budget',
  level: 'required',
  parameters: { maxBudget: 300 },
};

const prefQuality: PreferenceCriterion = {
  id: 'quality',
  name: 'Qualité',
  level: 'important',
};

// ============================================================================
// createEmptyProfile
// ============================================================================

describe('createEmptyProfile', () => {
  it('returns a profile with the given userId', () => {
    const p = createEmptyProfile('user-1');
    expect(p.userId).toBe('user-1');
  });

  it('has empty criteria list', () => {
    const p = createEmptyProfile('user-1');
    expect(p.preferences.criteria).toHaveLength(0);
  });

  it('has createdAt and updatedAt set', () => {
    const p = createEmptyProfile('user-1');
    expect(p.createdAt).toBeInstanceOf(Date);
    expect(p.updatedAt).toBeInstanceOf(Date);
  });
});

// ============================================================================
// InMemoryProfileStore
// ============================================================================

describe('InMemoryProfileStore', () => {
  let store: InMemoryProfileStore;

  beforeEach(() => {
    store = new InMemoryProfileStore();
  });

  it('load returns empty profile for unknown user', async () => {
    const profile = await store.load('unknown-user');
    expect(profile.userId).toBe('unknown-user');
    expect(profile.preferences.criteria).toHaveLength(0);
  });

  it('save then load round-trips correctly', async () => {
    const profile = createProfileWithCriteria('user-1', [budget300]);
    await store.save(profile);

    const loaded = await store.load('user-1');
    expect(loaded.userId).toBe('user-1');
    expect(loaded.preferences.criteria).toHaveLength(1);
    expect(loaded.preferences.criteria[0].id).toBe('budget');
  });

  it('save does not mutate the original profile object', async () => {
    const profile = createProfileWithCriteria('user-1', [budget300]);
    await store.save(profile);

    // Mutate after save — stored copy should be unaffected
    profile.preferences.criteria[0].level = 'preference';

    const loaded = await store.load('user-1');
    expect(loaded.preferences.criteria[0].level).toBe('required'); // original value
  });

  it('load returns a copy — mutating it does not affect store', async () => {
    await store.save(createProfileWithCriteria('user-1', [budget300]));

    const loaded = await store.load('user-1');
    loaded.preferences.criteria[0].level = 'preference'; // mutate loaded copy

    const loaded2 = await store.load('user-1');
    expect(loaded2.preferences.criteria[0].level).toBe('required'); // store unchanged
  });

  it('exists returns false for unknown user', async () => {
    expect(await store.exists('nobody')).toBe(false);
  });

  it('exists returns true after save', async () => {
    await store.save(createEmptyProfile('user-2'));
    expect(await store.exists('user-2')).toBe(true);
  });

  it('delete removes a profile', async () => {
    await store.save(createEmptyProfile('user-3'));
    await store.delete('user-3');
    expect(await store.exists('user-3')).toBe(false);
  });

  it('delete is no-op for unknown user', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  it('updateCriterion adds new criterion', async () => {
    await store.updateCriterion('user-4', budget300);

    const loaded = await store.load('user-4');
    expect(loaded.preferences.criteria).toHaveLength(1);
    expect(loaded.preferences.criteria[0].id).toBe('budget');
  });

  it('updateCriterion replaces existing criterion with same id', async () => {
    await store.updateCriterion('user-5', budget300);

    const updatedBudget: PreferenceCriterion = { ...budget300, parameters: { maxBudget: 500 } };
    await store.updateCriterion('user-5', updatedBudget);

    const loaded = await store.load('user-5');
    expect(loaded.preferences.criteria).toHaveLength(1);
    expect(loaded.preferences.criteria[0].parameters?.['maxBudget']).toBe(500);
  });

  it('updateCriterion appends when id is different', async () => {
    await store.updateCriterion('user-6', budget300);
    await store.updateCriterion('user-6', prefQuality);

    const loaded = await store.load('user-6');
    expect(loaded.preferences.criteria).toHaveLength(2);
  });

  it('removeCriterion removes an existing criterion', async () => {
    await store.save(createProfileWithCriteria('user-7', [budget300, prefQuality]));
    await store.removeCriterion('user-7', 'budget');

    const loaded = await store.load('user-7');
    expect(loaded.preferences.criteria).toHaveLength(1);
    expect(loaded.preferences.criteria[0].id).toBe('quality');
  });

  it('removeCriterion is no-op when criterion not found', async () => {
    await store.save(createProfileWithCriteria('user-8', [budget300]));
    await store.removeCriterion('user-8', 'nonexistent');

    const loaded = await store.load('user-8');
    expect(loaded.preferences.criteria).toHaveLength(1);
  });

  it('size() tracks stored profile count', async () => {
    expect(store.size()).toBe(0);
    await store.save(createEmptyProfile('u1'));
    await store.save(createEmptyProfile('u2'));
    expect(store.size()).toBe(2);
  });

  it('clear() removes all profiles', async () => {
    await store.save(createEmptyProfile('u1'));
    await store.save(createEmptyProfile('u2'));
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('loadSync returns empty profile for unknown user', () => {
    const p = store.loadSync('nobody');
    expect(p.userId).toBe('nobody');
    expect(p.preferences.criteria).toHaveLength(0);
  });
});

// ============================================================================
// mergeProfiles
// ============================================================================

describe('mergeProfiles', () => {
  it('throws if userIds differ', () => {
    const a = createEmptyProfile('user-a');
    const b = createEmptyProfile('user-b');
    expect(() => mergeProfiles(a, b)).toThrow();
  });

  it('merges criteria from both profiles', () => {
    const base = createProfileWithCriteria('user-1', [budget300]);
    const incoming = createProfileWithCriteria('user-1', [prefQuality]);

    const merged = mergeProfiles(base, incoming);
    expect(merged.preferences.criteria).toHaveLength(2);
  });

  it('incoming overwrites base on criterion id conflict', () => {
    const base = createProfileWithCriteria('user-1', [budget300]);
    const updated: PreferenceCriterion = { ...budget300, parameters: { maxBudget: 800 } };
    const incoming = createProfileWithCriteria('user-1', [updated]);

    const merged = mergeProfiles(base, incoming);
    expect(merged.preferences.criteria).toHaveLength(1);
    expect(merged.preferences.criteria[0].parameters?.['maxBudget']).toBe(800);
  });

  it('preserves userId from base', () => {
    const base = createProfileWithCriteria('user-1', [budget300]);
    const incoming = createProfileWithCriteria('user-1', [prefQuality]);
    const merged = mergeProfiles(base, incoming);
    expect(merged.userId).toBe('user-1');
  });
});

// ============================================================================
// Profile API endpoints
// ============================================================================

describe('Profile API endpoints', () => {
  let app: import('express').Application;
  // supertest is imported dynamically inside each test to avoid type issues

  beforeEach(async () => {
    const { buildApp } = await import('../../src/api/server');
    app = buildApp();
  });

  it('GET /profile/:userId returns empty profile for unknown user', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);
    const res = await request.get('/profile/new-user-xyz').expect(200);
    expect(res.body.userId).toBe('new-user-xyz');
    expect(res.body.criteria).toHaveLength(0);
  });

  it('PUT /profile/:userId/criterion stores a criterion', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);
    const userId = 'api-test-user-1';
    await request
      .put(`/profile/${userId}/criterion`)
      .send({ id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 500 } })
      .expect(200);

    const res = await request.get(`/profile/${userId}`).expect(200);
    expect(res.body.criteria).toHaveLength(1);
    expect(res.body.criteria[0].id).toBe('budget');
  });

  it('PUT /profile returns 400 for invalid level', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);
    await request
      .put('/profile/user-x/criterion')
      .send({ id: 'budget', name: 'Budget', level: 'super_important' })
      .expect(400);
  });

  it('PUT /profile returns 400 for missing fields', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);
    await request
      .put('/profile/user-x/criterion')
      .send({ id: 'budget' }) // missing name and level
      .expect(400);
  });

  it('DELETE /profile/:userId/criterion/:criterionId removes it', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);
    const userId = 'api-test-user-2';
    await request
      .put(`/profile/${userId}/criterion`)
      .send({ id: 'quality', name: 'Qualité', level: 'important' })
      .expect(200);

    await request
      .delete(`/profile/${userId}/criterion/quality`)
      .expect(200);

    const res = await request.get(`/profile/${userId}`).expect(200);
    expect(res.body.criteria).toHaveLength(0);
  });

  it('Profile persists across multiple searches within same server instance', async () => {
    const { default: supertest } = await import('supertest');
    const request = supertest(app);
    const userId = 'persistent-user';

    // Set a budget preference
    await request
      .put(`/profile/${userId}/criterion`)
      .send({ id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 400 } })
      .expect(200);

    // Search — profile should be loaded
    const searchRes = await request
      .post('/search')
      .send({ query: 'casque bluetooth', userId })
      .expect(200);

    // The effective criteria should include the stored budget preference
    const effectiveCriteria = searchRes.body.effectiveCriteria as Array<{ id: string }>;
    expect(effectiveCriteria.some(c => c.id === 'budget')).toBe(true);
  });
});
