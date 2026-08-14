/**
 * Capucine — ConflictResolver
 *
 * Explicit resolution of contradictory data between sources.
 *
 * Example: Source A (manufacturer) says warranty = 3 years.
 *          Source B (retailer) says warranty = 1 year.
 *
 * This module resolves such conflicts WITHOUT silently choosing one.
 *
 * Architecture:
 *   Contradictory DataPoint → ConflictResolver → DataConflictResolution
 *   - Resolution may be: "use source A", "use most conservative", "present both", "ask user"
 *   - All resolutions are AUDITED (which strategy was used, why)
 *   - The resolved value is stored with status 'known' or 'contradictory' depending on confidence
 *
 * INVARIANT: A contradiction is never hidden.
 * If resolution is uncertain, the DataPoint keeps status 'contradictory'.
 */

import { DataPoint, DataStatus, DataProvenance } from '../domain/types';

// ============================================================================
// SOURCE AUTHORITY
// ============================================================================

/**
 * Trust hierarchy for sources.
 * Higher = more trusted.
 * This ranking is FIXED in the code and cannot be changed per-search.
 * Source authority does not affect ranking — only conflict resolution.
 */
export const SOURCE_AUTHORITY: Record<string, number> = {
  manufacturer: 100,
  brand: 95,
  official_distributor: 90,
  certified_retailer: 80,
  verified_retailer: 75,
  retailer: 60,
  aggregator: 50,
  user_review: 30,
  ai_inferred: 10,
  unknown: 0,
};

function getAuthority(source: string): number {
  return SOURCE_AUTHORITY[source] ?? SOURCE_AUTHORITY.unknown;
}

// ============================================================================
// CONFLICT TYPES
// ============================================================================

export type ConflictType =
  | 'value_disagreement'    // Sources give different concrete values
  | 'presence_disagreement' // One source says field exists, other says it doesn't
  | 'format_disagreement'   // Same value, different format (e.g., "2yr" vs "24 months")
  | 'unit_disagreement';    // Different units for same physical quantity

export type ResolutionStrategy =
  | 'most_authoritative'    // Use the highest-authority source
  | 'most_conservative'     // Use the value safest for the user (e.g., lowest warranty)
  | 'consensus'             // Majority of sources agree
  | 'most_recent'           // Most recently retrieved
  | 'normalized_same'       // After normalization, values are equal
  | 'unresolvable';         // Cannot resolve — keep contradictory status

export interface ConflictEvidence {
  sourceId: string;
  sourceName: string;
  authority: number;
  value: unknown;
  retrievedAt: Date;
  provenance: DataProvenance;
}

export interface DataConflictResolution<T = unknown> {
  /** The winning value (or null if unresolvable) */
  resolvedValue: T | null;

  /** Final DataPoint status after resolution */
  resolvedStatus: DataStatus;

  /** Which strategy was used */
  strategy: ResolutionStrategy;

  /** How confident are we? 0-1 */
  confidence: number;

  /** Human-readable explanation of how we resolved */
  explanation: string;

  /** All evidence considered */
  evidence: ConflictEvidence[];

  /** If true, the user should be notified about this conflict */
  shouldNotifyUser: boolean;

  /** The type of conflict detected */
  conflictType: ConflictType;
}

export interface ConflictAnalysis {
  fieldName: string;
  conflictType: ConflictType;
  evidence: ConflictEvidence[];
  resolution: DataConflictResolution;
}

// ============================================================================
// NORMALIZERS (for format_disagreement resolution)
// ============================================================================

/**
 * Try to normalize a value to a canonical form.
 * Returns null if normalization fails.
 */
function tryNormalize(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).toLowerCase().trim();

  // Duration/warranty: normalize to months
  if (fieldName.includes('warranty') || fieldName.includes('garantie')) {
    const yearMatch = str.match(/(\d+)\s*(an|year|yr)/i);
    if (yearMatch) return `${parseInt(yearMatch[1], 10) * 12}m`;
    const monthMatch = str.match(/(\d+)\s*(mois|month|mo)/i);
    if (monthMatch) return `${parseInt(monthMatch[1], 10)}m`;
  }

  // Storage: normalize to GB
  if (fieldName.includes('storage') || fieldName.includes('stockage') || fieldName.includes('ram')) {
    const gbMatch = str.match(/(\d+)\s*(gb|go)/i);
    if (gbMatch) return `${parseInt(gbMatch[1], 10)}gb`;
    const tbMatch = str.match(/(\d+)\s*(tb|to)/i);
    if (tbMatch) return `${parseInt(tbMatch[1], 10) * 1024}gb`;
    const mbMatch = str.match(/(\d+)\s*mb/i);
    if (mbMatch) return `${(parseInt(mbMatch[1], 10) / 1024).toFixed(1)}gb`;
  }

  return str;
}

// ============================================================================
// CONFLICT RESOLVER
// ============================================================================

export class ConflictResolver {
  /**
   * Resolve a conflict for a single field.
   *
   * @param fieldName - The data field with a conflict
   * @param dataPoints - All known DataPoints for this field (from different sources)
   */
  resolve<T = unknown>(
    fieldName: string,
    dataPoints: Array<DataPoint<T> & { sourceId: string; sourceName: string }>
  ): DataConflictResolution<T> {
    // Build evidence list
    const evidence: ConflictEvidence[] = dataPoints
      .filter(dp => dp.status !== 'unknown' && dp.value !== null)
      .map(dp => ({
        sourceId: dp.sourceId,
        sourceName: dp.sourceName,
        authority: getAuthority(dp.sourceId),
        value: dp.value,
        retrievedAt: dp.provenance?.retrievedAt ?? new Date(0),
        provenance: dp.provenance ?? { source: dp.sourceId, retrievedAt: new Date() },
      }));

    if (evidence.length === 0) {
      return {
        resolvedValue: null,
        resolvedStatus: 'unknown',
        strategy: 'unresolvable',
        confidence: 0,
        explanation: 'Aucune donnée disponible pour ce champ.',
        evidence: [],
        shouldNotifyUser: false,
        conflictType: 'value_disagreement',
      };
    }

    if (evidence.length === 1) {
      // No conflict — single source
      return {
        resolvedValue: evidence[0].value as T,
        resolvedStatus: 'known',
        strategy: 'most_authoritative',
        confidence: 0.9,
        explanation: `Source unique : ${evidence[0].sourceName}`,
        evidence,
        shouldNotifyUser: false,
        conflictType: 'value_disagreement',
      };
    }

    // Detect conflict type
    const conflictType = this.detectConflictType(fieldName, evidence);

    // Try each resolution strategy in order
    return (
      this.tryNormalizedSame(fieldName, evidence, conflictType) ??
      this.tryConsensus(evidence, conflictType) ??
      this.tryMostAuthoritative(evidence, conflictType) ??
      this.tryMostConservative(fieldName, evidence, conflictType) ??
      this.unresolvable(evidence, conflictType)
    ) as DataConflictResolution<T>;
  }

  /**
   * Analyze a DataPoint with 'contradictory' status.
   */
  resolveFromDataPoint<T>(
    fieldName: string,
    dp: DataPoint<T>
  ): DataConflictResolution<T> {
    if (dp.status !== 'contradictory') {
      return {
        resolvedValue: dp.value,
        resolvedStatus: dp.status,
        strategy: 'most_authoritative',
        confidence: 1.0,
        explanation: 'Pas de contradiction détectée.',
        evidence: [],
        shouldNotifyUser: false,
        conflictType: 'value_disagreement',
      };
    }

    const conflictingValues = dp.conflictingValues ?? [dp.value];

    // Build synthetic evidence (no per-source info in this path)
    const evidence: ConflictEvidence[] = conflictingValues.map((v, i) => ({
      sourceId: `source-${i}`,
      sourceName: `Source ${i + 1}`,
      authority: 50,
      value: v,
      retrievedAt: dp.provenance?.retrievedAt ?? new Date(),
      provenance: dp.provenance ?? { source: `source-${i}`, retrievedAt: new Date() },
    }));

    return this.resolve(fieldName, evidence.map(e => ({
      value: e.value as T,
      status: 'known' as const,
      provenance: e.provenance,
      sourceId: e.sourceId,
      sourceName: e.sourceName,
    })));
  }

  // ── Private strategies ─────────────────────────────────────────────────────

  private detectConflictType(fieldName: string, evidence: ConflictEvidence[]): ConflictType {
    // Check if values are same after normalization
    const normalized = evidence.map(e => tryNormalize(e.value, fieldName));
    const uniqueNorm = [...new Set(normalized.filter(n => n !== null))];
    if (uniqueNorm.length === 1) return 'format_disagreement';

    // Check for presence disagreement
    const someNull = evidence.some(e => e.value === null || e.value === undefined);
    const somePresent = evidence.some(e => e.value !== null && e.value !== undefined);
    if (someNull && somePresent) return 'presence_disagreement';

    return 'value_disagreement';
  }

  private tryNormalizedSame(
    fieldName: string,
    evidence: ConflictEvidence[],
    conflictType: ConflictType
  ): DataConflictResolution | null {
    if (conflictType !== 'format_disagreement') return null;

    const normalized = evidence.map(e => tryNormalize(e.value, fieldName));
    const unique = [...new Set(normalized.filter(n => n !== null))];

    if (unique.length === 1) {
      // All values are the same after normalization
      const best = evidence.reduce((a, b) => a.authority >= b.authority ? a : b);
      return {
        resolvedValue: best.value,
        resolvedStatus: 'verified',
        strategy: 'normalized_same',
        confidence: 0.99,
        explanation: `Valeurs identiques après normalisation (formats différents). Valeur de ${best.sourceName} retenue.`,
        evidence,
        shouldNotifyUser: false,
        conflictType,
      };
    }

    return null;
  }

  private tryConsensus(
    evidence: ConflictEvidence[],
    conflictType: ConflictType
  ): DataConflictResolution | null {
    // Count votes per value
    const valueCounts = new Map<string, { count: number; value: unknown; example: ConflictEvidence }>();
    for (const ev of evidence) {
      const key = JSON.stringify(ev.value);
      if (!valueCounts.has(key)) {
        valueCounts.set(key, { count: 0, value: ev.value, example: ev });
      }
      valueCounts.get(key)!.count++;
    }

    // Find majority
    const sorted = [...valueCounts.entries()].sort((a, b) => b[1].count - a[1].count);
    const [, top] = sorted[0];
    const ratio = top.count / evidence.length;

    if (ratio > 0.5 && top.count >= 2) {
      return {
        resolvedValue: top.value,
        resolvedStatus: 'known',
        strategy: 'consensus',
        confidence: ratio,
        explanation: `Consensus de ${top.count}/${evidence.length} sources.`,
        evidence,
        shouldNotifyUser: ratio < 0.9,
        conflictType,
      };
    }

    return null;
  }

  private tryMostAuthoritative(
    evidence: ConflictEvidence[],
    conflictType: ConflictType
  ): DataConflictResolution | null {
    const sorted = [...evidence].sort((a, b) => b.authority - a.authority);
    const best = sorted[0];
    const second = sorted[1];

    // Only use if there's a clear authority gap
    if (best.authority - second.authority >= 20) {
      return {
        resolvedValue: best.value,
        resolvedStatus: 'known',
        strategy: 'most_authoritative',
        confidence: best.authority / 100,
        explanation: `Source la plus fiable : ${best.sourceName} (autorité ${best.authority}/100 vs ${second.authority}/100).`,
        evidence,
        shouldNotifyUser: true,
        conflictType,
      };
    }

    return null;
  }

  private tryMostConservative(
    fieldName: string,
    evidence: ConflictEvidence[],
    conflictType: ConflictType
  ): DataConflictResolution | null {
    // Conservative = beneficial to user (e.g., shorter warranty = safer assumption)
    // Only applies to numeric fields where "less is safer"
    const isWarranty = fieldName.includes('warranty') || fieldName.includes('garantie');

    if (!isWarranty) return null;

    // Parse all warranty durations to months
    const withMonths = evidence
      .map(ev => {
        const normalized = tryNormalize(ev.value, fieldName);
        if (!normalized) return null;
        const match = normalized.match(/^(\d+)m$/);
        return match ? { ev, months: parseInt(match[1], 10) } : null;
      })
      .filter((x): x is { ev: ConflictEvidence; months: number } => x !== null);

    if (withMonths.length < 2) return null;

    const minEntry = withMonths.reduce((a, b) => a.months < b.months ? a : b);
    return {
      resolvedValue: minEntry.ev.value,
      resolvedStatus: 'known',
      strategy: 'most_conservative',
      confidence: 0.8,
      explanation: `Valeur conservative retenue (durée minimale de garantie : ${minEntry.months} mois). Toute valeur supérieure devrait être vérifiée.`,
      evidence,
      shouldNotifyUser: true,
      conflictType,
    };
  }

  private unresolvable(
    evidence: ConflictEvidence[],
    conflictType: ConflictType
  ): DataConflictResolution {
    const values = evidence.map(e => `${e.sourceName}: ${JSON.stringify(e.value)}`).join(', ');
    return {
      resolvedValue: null,
      resolvedStatus: 'contradictory',
      strategy: 'unresolvable',
      confidence: 0,
      explanation: `Contradiction non résoluble. Valeurs observées : ${values}. La donnée est conservée avec statut "contradictory".`,
      evidence,
      shouldNotifyUser: true,
      conflictType,
    };
  }
}
