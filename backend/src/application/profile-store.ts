/**
 * Capucine — Profile Storage Abstraction
 *
 * IProfileStore defines how user profiles are persisted and retrieved.
 * InMemoryProfileStore is the implementation used in development and tests.
 *
 * ARCHITECTURE: The storage layer is deliberately separated from the domain.
 * CapucineEngine receives a fully-loaded UserProfile — it never talks to storage.
 * The HTTP API layer (server.ts) is responsible for loading / saving profiles.
 *
 * INVARIANTS:
 * - A profile is always returned (createEmptyProfile if not found)
 * - save() never mutates the profile's own logic (pure persistence)
 * - Temporary overrides are NOT stored in the profile (they live in SearchRequest)
 * - Profile reads are always consistent within a request lifecycle
 *
 * Future implementations:
 *   - PostgresProfileStore  (production, persistent)
 *   - RedisProfileStore     (caching layer)
 *   - FileProfileStore      (single-user, local mode)
 */

import { UserProfile, PreferenceCriterion, PreferenceLevel } from '../domain/types';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IProfileStore {
  /**
   * Load a user's profile.
   * Returns a new empty profile if the user doesn't exist yet.
   * NEVER returns null or throws on missing user.
   */
  load(userId: string): Promise<UserProfile>;

  /**
   * Save a user's profile.
   * Creates or updates (upsert semantics).
   */
  save(profile: UserProfile): Promise<void>;

  /**
   * Delete a user's profile (GDPR right to erasure).
   * No-op if user doesn't exist.
   */
  delete(userId: string): Promise<void>;

  /**
   * Check if a user has a stored profile.
   */
  exists(userId: string): Promise<boolean>;

  /**
   * Update a single criterion in a profile.
   * Merges into existing profile; does not require full profile load.
   *
   * This is the common mutation: user says "always prefer Apple products".
   */
  updateCriterion(userId: string, criterion: PreferenceCriterion): Promise<void>;

  /**
   * Remove a criterion from a profile.
   */
  removeCriterion(userId: string, criterionId: string): Promise<void>;
}

// ============================================================================
// IN-MEMORY IMPLEMENTATION
// ============================================================================

/**
 * In-memory profile store. Thread-safe for single-process use.
 * Used in: tests, development, single-user local mode.
 *
 * NOT suitable for production (data lost on process exit).
 */
export class InMemoryProfileStore implements IProfileStore {
  private readonly profiles: Map<string, UserProfile> = new Map();

  async load(userId: string): Promise<UserProfile> {
    const existing = this.profiles.get(userId);
    if (existing) {
      // Return a deep copy so callers can't accidentally mutate the stored profile
      return this.deepCopy(existing);
    }
    // Create a fresh empty profile (not stored until save() is called)
    return createEmptyProfile(userId);
  }

  async save(profile: UserProfile): Promise<void> {
    // Store a deep copy so future mutations don't affect stored state
    this.profiles.set(profile.userId, this.deepCopy({
      ...profile,
      updatedAt: new Date(),
    }));
  }

  async delete(userId: string): Promise<void> {
    this.profiles.delete(userId);
  }

  async exists(userId: string): Promise<boolean> {
    return this.profiles.has(userId);
  }

  async updateCriterion(userId: string, criterion: PreferenceCriterion): Promise<void> {
    const profile = await this.load(userId);

    const existingIndex = profile.preferences.criteria.findIndex(
      c => c.id === criterion.id
    );

    if (existingIndex >= 0) {
      profile.preferences.criteria[existingIndex] = { ...criterion };
    } else {
      profile.preferences.criteria.push({ ...criterion });
    }

    profile.preferences.updatedAt = new Date();
    await this.save(profile);
  }

  async removeCriterion(userId: string, criterionId: string): Promise<void> {
    const profile = await this.load(userId);

    const originalLength = profile.preferences.criteria.length;
    profile.preferences.criteria = profile.preferences.criteria.filter(
      c => c.id !== criterionId
    );

    if (profile.preferences.criteria.length !== originalLength) {
      profile.preferences.updatedAt = new Date();
      await this.save(profile);
    }
  }

  /** Synchronous load — for contexts where async is not available. */
  loadSync(userId: string): UserProfile {
    const existing = this.profiles.get(userId);
    return existing ? this.deepCopy(existing) : createEmptyProfile(userId);
  }

  /** Number of stored profiles (for testing). */
  size(): number {
    return this.profiles.size;
  }

  /** Clear all profiles (for testing). */
  clear(): void {
    this.profiles.clear();
  }

  private deepCopy(profile: UserProfile): UserProfile {
    // structuredClone correctly handles Date, Map, Set, etc.
    // Available in Node 17+ (we're on 22+) and modern browsers.
    return structuredClone(profile);
  }
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Create an empty user profile.
 * Used when a user has no stored preferences yet.
 */
export function createEmptyProfile(userId: string): UserProfile {
  const now = new Date();
  return {
    userId,
    preferences: {
      criteria: [],
      createdAt: now,
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a profile with some initial criteria.
 * Useful for bootstrapping profiles in tests.
 */
export function createProfileWithCriteria(
  userId: string,
  criteria: PreferenceCriterion[]
): UserProfile {
  const profile = createEmptyProfile(userId);
  // Spread-copy each criterion so callers can't accidentally mutate shared objects
  profile.preferences.criteria = criteria.map(c => ({ ...c, parameters: c.parameters ? { ...c.parameters } : undefined }));
  return profile;
}

/**
 * Merge two profiles (for multi-device sync use cases).
 * Later criteria from `incoming` overwrite `base` when IDs match.
 * INVARIANT: Does not change the userId.
 */
export function mergeProfiles(base: UserProfile, incoming: UserProfile): UserProfile {
  if (base.userId !== incoming.userId) {
    throw new Error(
      `Cannot merge profiles with different userIds: ${base.userId} vs ${incoming.userId}`
    );
  }

  const merged = new Map<string, PreferenceCriterion>();

  // Start with base criteria
  for (const c of base.preferences.criteria) {
    merged.set(c.id, { ...c });
  }

  // Override with incoming (later wins on conflict)
  for (const c of incoming.preferences.criteria) {
    merged.set(c.id, { ...c });
  }

  return {
    ...base,
    preferences: {
      criteria: Array.from(merged.values()),
      createdAt: base.preferences.createdAt,
      updatedAt: new Date(),
    },
    updatedAt: new Date(),
  };
}
