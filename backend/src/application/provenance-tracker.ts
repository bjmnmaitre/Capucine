/**
 * Capucine Application Layer — Provenance Tracker
 *
 * REAL IMPLEMENTATION: Manages data provenance and conflicts.
 *
 * This is WORKING CODE that:
 * - Tracks data sources
 * - Manages evidence
 * - Detects and resolves conflicts
 * - Produces audit trails
 * - Answers "Where did this come from?"
 */

import {
  Source,
  Evidence,
  CompleteProvenance,
  DataConflict,
  ConflictSummary,
  SourceTrustHierarchy,
  SourceNetwork,
  ProvenanceAuditTrail,
  SourceVerification,
  SourceType,
} from './provenance';
import { DataPoint, DataStatus } from '../domain/types';

// ============================================================================
// PROVENANCE TRACKER
// ============================================================================

/**
 * Tracks data provenance and manages conflicts.
 * Ensures traceability and explicit resolution of contradictions.
 */
export class ProvenanceTracker {
  private sources: Map<string, Source> = new Map();
  private evidence: Map<string, Evidence[]> = new Map(); // keyed by data point description
  private conflicts: Map<string, DataConflict> = new Map();
  private trustHierarchy: SourceTrustHierarchy;

  constructor() {
    // Initialize default trust hierarchy
    this.trustHierarchy = {
      levels: [
        {
          level: 1,
          sourceTypes: ['manufacturer', 'merchant_official'],
          reasoning: 'Official sources have highest authority',
        },
        {
          level: 2,
          sourceTypes: ['api_integration', 'database_cached'],
          reasoning: 'Verified integrations are trustworthy',
        },
        {
          level: 3,
          sourceTypes: ['comparison_site', 'marketplace'],
          reasoning: 'Aggregators have moderate trust',
        },
        {
          level: 4,
          sourceTypes: ['web_scrape', 'review_site'],
          reasoning: 'Scraped and review data have lower authority',
        },
        {
          level: 5,
          sourceTypes: ['user_input', 'estimate', 'other'],
          reasoning: 'User input and estimates are least authoritative',
        },
      ],
    };
  }

  // ========================================================================
  // SOURCE MANAGEMENT
  // ========================================================================

  /**
   * Register a source that can provide data.
   */
  registerSource(source: Source): void {
    this.sources.set(source.id, source);
  }

  /**
   * Get a registered source.
   */
  getSource(sourceId: string): Source | undefined {
    return this.sources.get(sourceId);
  }

  /**
   * List all registered sources.
   */
  listSources(): Source[] {
    return Array.from(this.sources.values());
  }

  /**
   * Mark a source as unreliable.
   */
  markSourceUnreliable(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.verification = 'suspicious';
      source.isActive = false;
    }
  }

  // ========================================================================
  // EVIDENCE MANAGEMENT
  // ========================================================================

  /**
   * Record a piece of evidence about a data point.
   */
  recordEvidence(
    dataPointDescription: string,
    evidence: Evidence
  ): void {
    if (!this.evidence.has(dataPointDescription)) {
      this.evidence.set(dataPointDescription, []);
    }
    this.evidence.get(dataPointDescription)!.push(evidence);

    // Check for conflicts
    this.detectConflicts(dataPointDescription);
  }

  /**
   * Get all evidence for a data point.
   */
  getEvidence(dataPointDescription: string): Evidence[] {
    return this.evidence.get(dataPointDescription) || [];
  }

  /**
   * Build complete provenance for a value.
   */
  buildProvenance(
    dataPointDescription: string,
    value: unknown,
    sourceId: string
  ): CompleteProvenance {
    const source = this.sources.get(sourceId) || this.createUnknownSource(sourceId);
    const evidenceList = this.getEvidence(dataPointDescription);

    // Calculate reliability
    const reliability = this.calculateReliability(
      evidenceList,
      sourceId,
      dataPointDescription
    );

    return {
      source,
      retrievedAt: new Date(),
      supportingEvidence: evidenceList.filter(e => this.valueSimilar(e.claimValue, value)),
      contradictingEvidence: evidenceList.filter(
        e => !this.valueSimilar(e.claimValue, value)
      ),
      verificationStatus: this.determineVerificationStatus(reliability),
      verificationMethod: this.getVerificationMethod(source),
      isFresh: this.isFresh(new Date()),
      reliability,
      transformations: [],
    };
  }

  // ========================================================================
  // CONFLICT DETECTION & RESOLUTION
  // ========================================================================

  /**
   * Detect conflicts between different evidence.
   */
  private detectConflicts(dataPointDescription: string): void {
    const evidenceList = this.getEvidence(dataPointDescription);

    if (evidenceList.length < 2) {
      return; // No conflict possible with 0-1 pieces of evidence
    }

    // Find unique values
    const uniqueValues = new Map<string, Evidence[]>();
    for (const ev of evidenceList) {
      const key = JSON.stringify(ev.claimValue);
      if (!uniqueValues.has(key)) {
        uniqueValues.set(key, []);
      }
      uniqueValues.get(key)!.push(ev);
    }

    // If multiple unique values, we have conflicts
    if (uniqueValues.size > 1) {
      const conflictingValues: Array<{
        sourceId: string;
        sourceName: string;
        value: unknown;
        observedAt: Date;
        evidence: Evidence;
      }> = Array.from(uniqueValues.entries()).map(([_, evs]) => ({
        sourceId: evs[0].sourceId,
        sourceName: this.sources.get(evs[0].sourceId)?.name || 'Unknown',
        value: evs[0].claimValue,
        observedAt: evs[0].observedAt,
        evidence: evs[0],
      }));

      const conflict: DataConflict = {
        id: `conflict-${Date.now()}-${Math.random()}`,
        dataPointDescription,
        conflictingValues,
        detectedAt: new Date(),
        status: 'unresolved',
      };

      // Try automatic resolution
      this.tryResolveConflict(conflict);

      // Store conflict
      this.conflicts.set(conflict.id, conflict);
    }
  }

  /**
   * Try to automatically resolve a conflict.
   */
  private tryResolveConflict(conflict: DataConflict): void {
    if (conflict.conflictingValues.length === 0) {
      return;
    }

    // Strategy 1: If only one source is "trusted", use that
    const trustedSources = conflict.conflictingValues.filter(cv => {
      const source = this.sources.get(cv.sourceId);
      return source && ['trusted', 'verified', 'authoritative'].includes(source.verification);
    });

    if (trustedSources.length === 1) {
      conflict.resolutionAttempt = {
        resolvedValue: trustedSources[0].value,
        resolutionMethod: 'source_authority',
        confidence: 0.95,
        reasoning: 'Trusted source provides single authoritative value',
      };
      conflict.status = 'resolved';
      return;
    }

    // Strategy 2: If majority agree on a value, use that
    const valueCounts = new Map<string, number>();
    for (const cv of conflict.conflictingValues) {
      const key = JSON.stringify(cv.value);
      valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
    }

    if (valueCounts.size > 0) {
      const [consensusValue, count] = Array.from(valueCounts.entries()).reduce((a, b) =>
        b[1] > a[1] ? b : a
      );

      if (count > conflict.conflictingValues.length / 2) {
        conflict.resolutionAttempt = {
          resolvedValue: JSON.parse(consensusValue),
          resolutionMethod: 'consensus',
          confidence: count / conflict.conflictingValues.length,
          reasoning: `${count}/${conflict.conflictingValues.length} sources agree`,
        };
        conflict.status = 'resolved';
        return;
      }
    }

    // Strategy 3: Use most recent
    const mostRecent = conflict.conflictingValues.reduce((a, b) =>
      a.observedAt > b.observedAt ? a : b
    );

    conflict.resolutionAttempt = {
      resolvedValue: mostRecent.value,
      resolutionMethod: 'most_recent',
      confidence: 0.6,
      reasoning: `Most recent observation (${mostRecent.observedAt.toISOString()})`,
    };
    conflict.status = 'resolved';
  }

  /**
   * Get conflict summary for a ranking request.
   */
  getConflictSummary(): ConflictSummary {
    const allConflicts = Array.from(this.conflicts.values());
    const unresolved = allConflicts.filter(c => c.status === 'unresolved');

    return {
      totalConflicts: allConflicts.length,
      unresolvedConflicts: unresolved.length,
      conflictedDataPoints: allConflicts.map(c => c.dataPointDescription),
      affectsRanking: unresolved.length > 0, // Unresolved conflicts affect confidence in ranking
      userNotificationNeeded: unresolved.length > 0 && unresolved.length <= 3, // Show if few conflicts
    };
  }

  /**
   * Produce an audit trail for a data point.
   */
  buildAuditTrail(
    dataPointDescription: string,
    claimedValue: unknown
  ): ProvenanceAuditTrail {
    const evidenceList = this.getEvidence(dataPointDescription);
    const conflict = Array.from(this.conflicts.values()).find(
      c => c.dataPointDescription === dataPointDescription
    );

    const sources = evidenceList.map(ev => ({
      source: this.sources.get(ev.sourceId)!,
      evidence: [ev],
      timestamp: ev.observedAt,
    }));

    const confidenceScore = this.calculateConfidenceScore(
      dataPointDescription,
      claimedValue
    );

    return {
      id: `audit-${Date.now()}`,
      dataPointId: `dp-${dataPointDescription.toLowerCase().replace(/\s+/g, '-')}`,
      dataPointDescription,
      claimedValue,
      sources,
      normalizationSteps: [],
      confidenceScore,
      confidenceFactors: this.analyzeConfidenceFactors(evidenceList),
      conflicts: conflict ? [conflict] : [],
      warnings: this.generateWarnings(evidenceList, conflict),
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
      summary: this.generateSummary(
        dataPointDescription,
        confidenceScore,
        sources.length
      ),
    };
  }

  // ========================================================================
  // HELPER METHODS
  // ========================================================================

  private valueSimilar(value1: unknown, value2: unknown): boolean {
    return JSON.stringify(value1) === JSON.stringify(value2);
  }

  private calculateReliability(
    evidenceList: Evidence[],
    sourceId: string,
    dataPointDescription: string
  ): {
    sourceReliability: number;
    conflictLevel: 'none' | 'low' | 'medium' | 'high';
    conflictingSourceCount?: number;
    dataFreshness: number;
    evidenceCount: number;
    overallConfidence: number;
  } {
    const source = this.sources.get(sourceId);
    const sourceReliability = this.getSourceReliability(source);

    const conflict = Array.from(this.conflicts.values()).find(
      c => c.dataPointDescription === dataPointDescription
    );

    let conflictLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
    let conflictingSourceCount = 0;
    if (conflict) {
      conflictingSourceCount = conflict.conflictingValues.length;
      conflictLevel = conflictingSourceCount > 3 ? 'high' : 'medium';
    }

    const freshness = this.calculateFreshness(evidenceList);
    const overall = (sourceReliability + (1 - (conflictLevel === 'high' ? 0.5 : 0)) + freshness) / 3;

    return {
      sourceReliability,
      conflictLevel,
      conflictingSourceCount,
      dataFreshness: freshness,
      evidenceCount: evidenceList.length,
      overallConfidence: overall,
    };
  }

  private getSourceReliability(source?: Source): number {
    if (!source) return 0.3; // Unknown source
    if (source.verification === 'trusted' || source.verification === 'authoritative') return 0.95;
    if (source.verification === 'verified' || source.verification === 'credible') return 0.75;
    if (source.verification === 'unverified') return 0.5;
    if (source.verification === 'suspicious') return 0.1;
    return 0.5;
  }

  private calculateFreshness(evidenceList: Evidence[]): number {
    if (evidenceList.length === 0) return 0.3; // No data = unknown freshness

    const now = Date.now();
    const ages = evidenceList.map(e => now - e.observedAt.getTime());
    const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;

    const oneDay = 24 * 60 * 60 * 1000;
    const oneMonth = 30 * oneDay;

    if (avgAge < oneDay) return 1.0; // Very fresh
    if (avgAge < 7 * oneDay) return 0.9; // Fresh
    if (avgAge < oneMonth) return 0.7; // Moderate
    if (avgAge < 3 * oneMonth) return 0.5; // Stale
    return 0.2; // Very stale
  }

  private determineVerificationStatus(
    reliability: { overallConfidence: number; conflictLevel: string }
  ): 'verified' | 'credible' | 'unverified' | 'contradicted' {
    if (reliability.conflictLevel === 'high') return 'contradicted';
    if (reliability.overallConfidence > 0.85) return 'verified';
    if (reliability.overallConfidence > 0.6) return 'credible';
    return 'unverified';
  }

  private getVerificationMethod(source: Source): 'direct' | 'cross_reference' | 'authority' | undefined {
    if (source.type === 'manufacturer') return 'authority';
    if (source.type === 'api_integration') return 'direct';
    if (source.type === 'web_scrape') return 'cross_reference';
    return undefined;
  }

  private isFresh(date: Date): boolean {
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    return Date.now() - date.getTime() < oneMonth;
  }

  private createUnknownSource(sourceId: string): Source {
    return {
      id: sourceId,
      name: `Unknown source (${sourceId})`,
      type: 'other',
      verification: 'unverified',
      isActive: false,
      canProvide: {},
      createdAt: new Date(),
    };
  }

  private calculateConfidenceScore(
    dataPointDescription: string,
    claimedValue: unknown
  ): number {
    const evidenceList = this.getEvidence(dataPointDescription);
    const supportingEvidence = evidenceList.filter(e =>
      this.valueSimilar(e.claimValue, claimedValue)
    );

    if (evidenceList.length === 0) return 0.3; // No evidence = low confidence
    if (supportingEvidence.length === 0) return 0.1; // No support = very low
    return Math.min(1, supportingEvidence.length / evidenceList.length);
  }

  private analyzeConfidenceFactors(
    evidenceList: Evidence[]
  ): { factor: string; impact: number }[] {
    return [
      { factor: 'Evidence count', impact: Math.min(1, evidenceList.length / 5) },
      { factor: 'Source diversity', impact: this.assessSourceDiversity(evidenceList) },
      { factor: 'Data freshness', impact: this.assessFreshness(evidenceList) },
      { factor: 'Source reliability', impact: this.assessSourceReliability(evidenceList) },
    ];
  }

  private assessSourceDiversity(evidenceList: Evidence[]): number {
    const uniqueSources = new Set(evidenceList.map(e => e.sourceId)).size;
    return Math.min(1, uniqueSources / 3);
  }

  private assessFreshness(evidenceList: Evidence[]): number {
    if (evidenceList.length === 0) return 0;
    const now = Date.now();
    const ages = evidenceList.map(e => now - e.observedAt.getTime());
    const avgAge = ages.reduce((a, b) => a + b) / ages.length;
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    return Math.max(0, 1 - avgAge / oneMonth);
  }

  private assessSourceReliability(evidenceList: Evidence[]): number {
    if (evidenceList.length === 0) return 0;
    const reliabilities = evidenceList.map(e => {
      const source = this.sources.get(e.sourceId);
      return this.getSourceReliability(source);
    });
    return reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length;
  }

  private generateWarnings(
    evidenceList: Evidence[],
    conflict?: DataConflict
  ): string[] {
    const warnings: string[] = [];

    if (evidenceList.length === 0) {
      warnings.push('No evidence found for this data point');
    }

    if (evidenceList.length === 1) {
      warnings.push('Only single source, cannot cross-verify');
    }

    if (conflict && conflict.status === 'unresolved') {
      warnings.push(`Unresolved conflict: ${conflict.conflictingValues.length} sources disagree`);
    }

    const oldEvidence = evidenceList.filter(
      e => Date.now() - e.observedAt.getTime() > 90 * 24 * 60 * 60 * 1000
    );
    if (oldEvidence.length > 0) {
      warnings.push(`Data is older than 90 days (${oldEvidence.length}/${evidenceList.length} items)`);
    }

    return warnings;
  }

  private generateSummary(
    dataPointDescription: string,
    confidence: number,
    sourceCount: number
  ): string {
    if (confidence > 0.9) {
      return `Highly confident (${sourceCount} sources). ${dataPointDescription}`;
    }
    if (confidence > 0.7) {
      return `Reasonably confident (${sourceCount} sources). ${dataPointDescription}`;
    }
    if (confidence > 0.5) {
      return `Moderately confident (${sourceCount} sources). ${dataPointDescription}`;
    }
    return `Low confidence (${sourceCount} sources). ${dataPointDescription}`;
  }
}
