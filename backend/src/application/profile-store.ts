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

// ============================================================================
// FILE-BACKED STORE (local persistence)
// ============================================================================

/**
 * FileProfileStore — profiles that survive a process restart.
 *
 * WHY A FILE AND NOT A DATABASE
 * ─────────────────────────────
 * A preference the user typed a minute ago disappearing when the backend
 * restarts makes the feature not worth having, so in-memory is not enough.
 * But the project has no database, no ORM and no storage dependency at all,
 * and adding one to hold a handful of criteria would be infrastructure the
 * MVP does not need. One JSON file per user, written through Node's own `fs`,
 * is the smallest thing that is actually persistent. This is the
 * `FileProfileStore (single-user, local mode)` this module's header already
 * anticipated; swapping in Postgres later means implementing IProfileStore
 * again, nothing else.
 *
 * FILENAME = SHA-256 OF THE USER ID
 * ─────────────────────────────────
 * userIds come from HTTP requests. Deriving a path from one directly invites
 * traversal (`../../etc/something`), and escaping schemes are easy to get
 * subtly wrong. A hash is not an escaping scheme that might have a hole: it
 * cannot contain a separator at all. The real userId is stored inside the
 * file, so nothing is lost.
 *
 * HONEST FAILURES
 * ───────────────
 * A missing file means the user has no profile yet — an empty profile, which
 * is a fact. Any OTHER read failure (permissions, I/O, corrupt JSON) throws.
 * Returning an empty profile there would tell the user "you have no
 * preferences" when the truth is "your preferences could not be read", and
 * the next save would overwrite what we failed to load.
 *
 * CONCURRENCY
 * ───────────
 * updateCriterion/removeCriterion are read-modify-write. Operations on the
 * SAME user are chained through a per-user promise queue, so two concurrent
 * HTTP requests cannot interleave and lose an update. Writes are atomic
 * (temp file + rename), so a reader never sees a half-written file and a
 * crash mid-write leaves the previous version intact.
 *
 * KNOWN LIMIT (acceptable for a local MVP, deliberately not solved here):
 * the queue is per-process. Two backend processes sharing one directory could
 * still lose an update — last writer wins. Single-process local use, which is
 * what `npm run dev` does, is unaffected.
 */
export class FileProfileStore implements IProfileStore {
  private readonly directory: string;
  /** Serializes operations per user id — see CONCURRENCY above. */
  private readonly queues: Map<string, Promise<unknown>> = new Map();

  constructor(directory: string) {
    this.directory = directory;
  }

  async load(userId: string): Promise<UserProfile> {
    return this.enqueue(userId, () => this.readProfile(userId));
  }

  async save(profile: UserProfile): Promise<void> {
    return this.enqueue(profile.userId, () =>
      this.writeProfile({ ...profile, updatedAt: new Date() })
    );
  }

  async delete(userId: string): Promise<void> {
    return this.enqueue(userId, async () => {
      const { unlink } = await import('node:fs/promises');
      try {
        await unlink(this.pathFor(userId));
      } catch (err) {
        // Already absent is the desired end state, not a failure.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    });
  }

  async exists(userId: string): Promise<boolean> {
    return this.enqueue(userId, async () => {
      const { access } = await import('node:fs/promises');
      try {
        await access(this.pathFor(userId));
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        // Cannot tell — say so rather than answer "no".
        throw err;
      }
    });
  }

  async updateCriterion(userId: string, criterion: PreferenceCriterion): Promise<void> {
    // Read and write inside ONE queued unit: another request for this user
    // cannot slip between them and have its change overwritten.
    return this.enqueue(userId, async () => {
      const profile = await this.readProfile(userId);
      const index = profile.preferences.criteria.findIndex(c => c.id === criterion.id);
      if (index >= 0) {
        profile.preferences.criteria[index] = { ...criterion };
      } else {
        profile.preferences.criteria.push({ ...criterion });
      }
      profile.preferences.updatedAt = new Date();
      await this.writeProfile({ ...profile, updatedAt: new Date() });
    });
  }

  async removeCriterion(userId: string, criterionId: string): Promise<void> {
    return this.enqueue(userId, async () => {
      const profile = await this.readProfile(userId);
      const before = profile.preferences.criteria.length;
      profile.preferences.criteria = profile.preferences.criteria.filter(
        c => c.id !== criterionId
      );
      if (profile.preferences.criteria.length === before) return; // nothing to do
      profile.preferences.updatedAt = new Date();
      await this.writeProfile({ ...profile, updatedAt: new Date() });
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    // `.catch` keeps one failed operation from poisoning the queue for the
    // next caller, while the failure itself is still returned to ITS caller.
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(userId, next.catch(() => undefined));
    return next;
  }

  private pathFor(userId: string): string {
    const createHash = require('node:crypto').createHash as typeof import('node:crypto').createHash;
    const name = createHash('sha256').update(userId, 'utf8').digest('hex');
    const path = require('node:path') as typeof import('node:path');
    return path.join(this.directory, `${name}.json`);
  }

  private async readProfile(userId: string): Promise<UserProfile> {
    const { readFile } = await import('node:fs/promises');
    let raw: string;
    try {
      raw = await readFile(this.pathFor(userId), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // No file = no profile yet. A fact, not a failure.
        return createEmptyProfile(userId);
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Stored profile for user is unreadable (invalid JSON). Refusing to report an ` +
        `empty profile, which would silently discard the stored preferences.`
      );
    }
    return reviveProfile(parsed, userId);
  }

  private async writeProfile(profile: UserProfile): Promise<void> {
    const { mkdir, writeFile, rename } = await import('node:fs/promises');
    const path = require('node:path') as typeof import('node:path');
    await mkdir(this.directory, { recursive: true });

    const target = this.pathFor(profile.userId);
    // Same directory, so the rename is atomic (same filesystem). A reader
    // sees either the old file or the new one, never a partial write.
    const temp = path.join(
      this.directory,
      `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`
    );
    await writeFile(temp, JSON.stringify(profile, null, 2), 'utf8');
    await rename(temp, target);
  }
}

/**
 * Rebuilds a UserProfile from parsed JSON, restoring the Date fields that
 * JSON.stringify flattened into strings. Throws on a structurally invalid
 * payload: a corrupt file must not quietly become an empty profile.
 */
function reviveProfile(parsed: unknown, userId: string): UserProfile {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Stored profile is not an object.');
  }
  const raw = parsed as Record<string, unknown>;
  const preferences = raw['preferences'] as Record<string, unknown> | undefined;
  const criteria = preferences?.['criteria'];
  if (!Array.isArray(criteria)) {
    throw new Error('Stored profile has no criteria list.');
  }

  const toDate = (value: unknown, fallback: Date): Date => {
    if (typeof value !== 'string') return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  };
  const now = new Date();

  return {
    ...(raw as unknown as UserProfile),
    // The file name is derived from the requested userId, so this is the
    // authoritative one even if the stored copy disagrees.
    userId,
    preferences: {
      ...(preferences as unknown as UserProfile['preferences']),
      criteria: criteria as PreferenceCriterion[],
      updatedAt: toDate(preferences?.['updatedAt'], now),
    },
    createdAt: toDate(raw['createdAt'], now),
    updatedAt: toDate(raw['updatedAt'], now),
  };
}
