/**
 * Capucine — Profile Engine
 *
 * Manages the three-layer preference hierarchy:
 *   PERMANENT PROFILE > CURRENT REQUEST > TEMPORARY OVERRIDES
 *
 * INVARIANTS:
 * - Temporary overrides NEVER modify the permanent profile
 * - Profile is immutable during a search
 * - Override resolution is deterministic and traceable
 * - Profile snapshot is taken at search start — later profile changes don't affect it
 *
 * GATE 4 + GATE 5 IMPLEMENTATION
 */

import { PreferenceLevel, PreferenceCriterion, UserProfile, CurrentSearchRequirements, UsageContext } from './types';
import { GenericCriterion, CriterionOrigin } from './criterion';

// ============================================================================
// PROFILE SNAPSHOT
// ============================================================================

/**
 * Immutable snapshot of a profile at the moment of a search.
 * Ensures historical searches are reproducible even after profile changes.
 */
export interface ProfileSnapshot {
  readonly userId: string;
  readonly snapshotId: string;
  readonly takenAt: Date;
  readonly criteria: ReadonlyArray<PreferenceCriterion>;
  readonly profileVersion?: string;
}

// ============================================================================
// OVERRIDE
// ============================================================================

/**
 * A temporary override to the profile for a single search.
 *
 * Overrides can:
 * - Raise a criterion's level (e.g., make a preference required for this search)
 * - Lower a criterion's level (e.g., ignore an "avoid marketplace" preference)
 * - Disable a criterion entirely for this search
 * - Add a new criterion only for this search
 *
 * INVARIANT: Applying an override DOES NOT modify UserProfile.
 */
export interface ProfileOverride {
  criterionId: string;

  // The new level for this search only (null = disable this criterion)
  temporaryLevel: PreferenceLevel | 'disabled';

  // Why this override was created
  reason: string;

  // Source of the override
  source: 'explicit_user' | 'ai_detected' | 'system';

  // When was this override created
  createdAt: Date;

  // Original level (for audit trail)
  originalLevel?: PreferenceLevel;
}

// ============================================================================
// MERGED EFFECTIVE CRITERIA
// ============================================================================

/**
 * The resolved set of criteria after merging all layers.
 * This is what the Priority Engine actually uses.
 *
 * AUDIT TRAIL: Every criterion traces back to its origin.
 */
export interface EffectiveCriteriaSet {
  criteria: PreferenceCriterion[];

  // Trace every criterion to its source
  traceability: CriterionTrace[];

  // Overrides that were applied
  appliedOverrides: ProfileOverride[];

  // Conflicts between profile and request (user chose explicitly)
  resolvedConflicts: ConflictResolution[];
  usageContext?: UsageContext;

  // Metadata
  resolvedAt: Date;
  searchId: string;
}

export interface CriterionTrace {
  criterionId: string;
  finalLevel: PreferenceLevel;
  source: CriterionOrigin;
  originalLevel?: PreferenceLevel;   // What was in the profile before override
  overrideApplied: boolean;
}

export interface ConflictResolution {
  criterionId: string;
  conflictBetween: { source: string; level: PreferenceLevel }[];
  resolution: PreferenceLevel;
  resolutionRule: 'explicit_wins' | 'higher_priority_wins' | 'lower_priority_wins';
}

// ============================================================================
// PERSISTENT MERCHANT EXCLUSIONS
// ============================================================================

/**
 * A permanent "never buy from this merchant" preference.
 *
 * Represented as a normal PreferenceCriterion (so it persists, round-trips
 * and is edited through the exact same /profile plumbing as any other
 * preference) following a convention the discovery layer already uses
 * (capucine-engine.ts reads `forbidden` + id starting with `merchant-`):
 *
 *   { id: 'merchant-exclude-<slug>', level: 'forbidden',
 *     name: 'Ne pas acheter chez <Name>',
 *     parameters: { merchantName: '<name as typed>' } }
 *
 * The exclusion is applied at PRESENTATION time (serializeResult) — the same
 * substring match on the merchant name that a session "sans Amazon" uses —
 * so it is honest and reportable ("N offres masquées"), not a silent
 * discovery filter whose effect the user cannot see.
 */
export const MERCHANT_EXCLUSION_ID_PREFIX = 'merchant-exclude-';

export function isMerchantExclusionCriterion(c: PreferenceCriterion): boolean {
  return c.level === 'forbidden' && c.id.startsWith(MERCHANT_EXCLUSION_ID_PREFIX);
}

/** The merchant name a given exclusion criterion targets, or null if the
 *  criterion is not a well-formed exclusion. */
export function merchantNameOfExclusion(c: PreferenceCriterion): string | null {
  if (!isMerchantExclusionCriterion(c)) return null;
  const fromParams = c.parameters?.['merchantName'];
  if (typeof fromParams === 'string' && fromParams.trim().length > 0) {
    return fromParams.trim();
  }
  // Fall back to the slug in the id (dashes → spaces) so an exclusion saved
  // without parameters still works.
  const slug = c.id.slice(MERCHANT_EXCLUSION_ID_PREFIX.length).replace(/-+/g, ' ').trim();
  return slug.length > 0 ? slug : null;
}

/**
 * Every merchant name the profile permanently excludes, lowercased and
 * de-duplicated. Empty when the profile excludes nothing. Pure.
 */
export function merchantExclusionsFromProfile(profile: UserProfile): string[] {
  const names = profile.preferences.criteria
    .map(merchantNameOfExclusion)
    .filter((n): n is string => n !== null)
    .map((n) => n.toLowerCase());
  return [...new Set(names)];
}

// ============================================================================
// PROFILE ENGINE
// ============================================================================

/**
 * Resolves the effective criteria set from profile + request + overrides.
 *
 * Resolution rules (deterministic):
 * 1. Start with permanent profile criteria
 * 2. Merge current request criteria (request takes precedence for conflicts)
 * 3. Apply explicit overrides (overrides take final precedence)
 * 4. Remove 'disabled' criteria
 * 5. Result is EffectiveCriteriaSet
 *
 * INVARIANT: UserProfile is NEVER modified by this process.
 */
export class ProfileEngine {

  /**
   * Resolve effective criteria for a search.
   *
   * @param profile - Permanent user profile (read-only)
   * @param request - Current search requirements
   * @param overrides - Temporary overrides for this search
   * @param searchId - Identifier for this search session
   */
  resolve(
    profile: UserProfile,
    request: CurrentSearchRequirements,
    overrides: ProfileOverride[] = [],
    searchId: string
  ): EffectiveCriteriaSet {
    const traceability: CriterionTrace[] = [];
    const resolvedConflicts: ConflictResolution[] = [];
    const appliedOverrides: ProfileOverride[] = [];

    // Step 1: Collect profile criteria
    const profileMap = new Map<string, PreferenceCriterion>();
    for (const c of profile.preferences.criteria) {
      profileMap.set(c.id, { ...c }); // shallow copy — never mutate original
      traceability.push({
        criterionId: c.id,
        finalLevel: c.level,
        source: 'profile_permanent',
        overrideApplied: false,
      });
    }

    // Step 2: Merge request criteria — request wins on conflict
    const requestMap = new Map<string, PreferenceCriterion>();
    for (const c of request.criteria) {
      requestMap.set(c.id, { ...c });

      const existing = profileMap.get(c.id);
      if (existing && existing.level !== c.level) {
        // Conflict: request overrides profile
        resolvedConflicts.push({
          criterionId: c.id,
          conflictBetween: [
            { source: 'profile', level: existing.level },
            { source: 'request', level: c.level },
          ],
          resolution: c.level,
          resolutionRule: 'explicit_wins',
        });
      }

      // Update or add trace
      const traceIdx = traceability.findIndex(t => t.criterionId === c.id);
      if (traceIdx >= 0) {
        traceability[traceIdx].source = 'explicit_user';
        traceability[traceIdx].originalLevel = traceability[traceIdx].finalLevel;
        traceability[traceIdx].finalLevel = c.level;
      } else {
        traceability.push({
          criterionId: c.id,
          finalLevel: c.level,
          source: 'explicit_user',
          overrideApplied: false,
        });
      }
    }

    // Step 3: Merge profile exceptions from request
    const exceptionMap = new Map<string, PreferenceLevel | 'disabled'>();
    for (const exc of request.profileExceptions || []) {
      const override: ProfileOverride = {
        criterionId: exc.criterionId,
        temporaryLevel: exc.temporaryLevel,
        reason: exc.reason || 'User exception',
        source: 'explicit_user',
        createdAt: new Date(),
        originalLevel: profileMap.get(exc.criterionId)?.level,
      };
      exceptionMap.set(exc.criterionId, exc.temporaryLevel);
      overrides = [...overrides, override];
    }

    // Step 4: Apply explicit overrides (highest precedence)
    for (const override of overrides) {
      appliedOverrides.push(override);
      const traceIdx = traceability.findIndex(t => t.criterionId === override.criterionId);

      if (traceIdx >= 0) {
        const prev = traceability[traceIdx].finalLevel;
        traceability[traceIdx].originalLevel = prev;
        if (override.temporaryLevel === 'disabled') {
          traceability[traceIdx].finalLevel = 'none';
        } else {
          traceability[traceIdx].finalLevel = override.temporaryLevel;
        }
        traceability[traceIdx].overrideApplied = true;
        traceability[traceIdx].source = 'profile_exception';
      }
    }

    // Step 5: Build final merged criteria
    // Priority: overrides > request > profile
    const merged = new Map<string, PreferenceCriterion>();

    // Add all profile criteria
    for (const [id, c] of profileMap) {
      merged.set(id, { ...c });
    }

    // Request criteria override profile for same id
    for (const [id, c] of requestMap) {
      merged.set(id, { ...c });
    }

    // Apply overrides to final level
    for (const override of overrides) {
      const existing = merged.get(override.criterionId);
      if (existing) {
        if (override.temporaryLevel === 'disabled') {
          merged.delete(override.criterionId);
        } else {
          merged.set(override.criterionId, {
            ...existing,
            level: override.temporaryLevel,
          });
        }
      }
    }

    const criteria = Array.from(merged.values());

    return {
      criteria,
      traceability,
      appliedOverrides,
      resolvedConflicts,
      usageContext: request.usageContext,
      resolvedAt: new Date(),
      searchId,
    };
  }

  /**
   * Take an immutable snapshot of a profile.
   * Use this at search start to ensure reproducibility.
   */
  snapshot(profile: UserProfile, snapshotId: string): ProfileSnapshot {
    return {
      userId: profile.userId,
      snapshotId,
      takenAt: new Date(),
      criteria: profile.preferences.criteria.map(c => ({ ...c })), // deep-enough copy
    };
  }

  /**
   * Verify a profile was not mutated after snapshot.
   * Diagnostic tool for testing.
   */
  verifyUnmutated(original: UserProfile, snapshot: ProfileSnapshot): boolean {
    if (original.preferences.criteria.length !== snapshot.criteria.length) return false;
    for (let i = 0; i < original.preferences.criteria.length; i++) {
      const orig = original.preferences.criteria[i];
      const snap = snapshot.criteria[i];
      if (orig.id !== snap.id || orig.level !== snap.level) return false;
    }
    return true;
  }

  /**
   * Check if a profile override changes what criteria the engine evaluates.
   * Used by clarification engine to determine if a question is worth asking.
   */
  overrideChangesOutcome(
    profile: UserProfile,
    override: ProfileOverride
  ): boolean {
    const existing = profile.preferences.criteria.find(c => c.id === override.criterionId);
    if (!existing) return true; // Adding new criterion always changes things
    return existing.level !== override.temporaryLevel;
  }
}

// ============================================================================
// PREFERENCE CONFLICT DETECTOR
// ============================================================================

/**
 * Detects conflicts between profile preferences and request criteria.
 * Used by the clarification engine and AI orchestrator.
 */
export class PreferenceConflictDetector {

  detect(
    profile: UserProfile,
    request: CurrentSearchRequirements
  ): PreferenceConflict[] {
    const conflicts: PreferenceConflict[] = [];

    for (const reqCriterion of request.criteria) {
      const profileCriterion = profile.preferences.criteria.find(
        c => c.id === reqCriterion.id
      );

      if (!profileCriterion) continue;

      // Check if levels conflict significantly
      if (this.levelsConflict(profileCriterion.level, reqCriterion.level)) {
        conflicts.push({
          criterionId: reqCriterion.id,
          criterionName: reqCriterion.name,
          profileLevel: profileCriterion.level,
          requestLevel: reqCriterion.level,
          severity: this.conflictSeverity(profileCriterion.level, reqCriterion.level),
          description: `Profile has '${profileCriterion.level}' but request has '${reqCriterion.level}'`,
          resolution: 'request_wins', // Default resolution
        });
      }
    }

    return conflicts;
  }

  private levelsConflict(profileLevel: PreferenceLevel, requestLevel: PreferenceLevel): boolean {
    // Significant conflict if one is required/forbidden and other is not
    const hardLevels = new Set(['required', 'forbidden']);
    const softLevels = new Set(['preference', 'low', 'none']);
    return (
      (hardLevels.has(profileLevel) && softLevels.has(requestLevel)) ||
      (softLevels.has(profileLevel) && hardLevels.has(requestLevel)) ||
      (profileLevel === 'forbidden' && requestLevel !== 'forbidden') ||
      (requestLevel === 'forbidden' && profileLevel !== 'forbidden')
    );
  }

  private conflictSeverity(a: PreferenceLevel, b: PreferenceLevel): 'high' | 'medium' | 'low' {
    if (a === 'forbidden' || b === 'forbidden') return 'high';
    if (a === 'required' || b === 'required') return 'medium';
    return 'low';
  }
}

export interface PreferenceConflict {
  criterionId: string;
  criterionName: string;
  profileLevel: PreferenceLevel;
  requestLevel: PreferenceLevel;
  severity: 'high' | 'medium' | 'low';
  description: string;
  resolution: 'request_wins' | 'profile_wins' | 'needs_clarification';
}
