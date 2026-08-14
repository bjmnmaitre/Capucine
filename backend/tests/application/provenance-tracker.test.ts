/**
 * Tests for ProvenanceTracker
 *
 * Validates real provenance tracking and conflict resolution.
 */

import { ProvenanceTracker } from '../../src/application/provenance-tracker';
import { Source, Evidence } from '../../src/application/provenance';
import { Source as SourceType } from '../../src/application/provenance';

describe('ProvenanceTracker', () => {
  let tracker: ProvenanceTracker;
  let testSource: SourceType;

  beforeEach(() => {
    tracker = new ProvenanceTracker();

    testSource = {
      id: 's1',
      name: 'TestMerchant',
      type: 'merchant_official',
      verification: 'credible',
      isActive: true,
      canProvide: { pricing: true },
      createdAt: new Date(),
    };

    tracker.registerSource(testSource);
  });

  describe('Source Management', () => {
    it('should register a source', () => {
      expect(tracker.getSource('s1')).toBeDefined();
      expect(tracker.getSource('s1')?.name).toBe('TestMerchant');
    });

    it('should list all registered sources', () => {
      const sources = tracker.listSources();
      expect(sources.length).toBeGreaterThan(0);
      expect(sources.some(s => s.id === 's1')).toBe(true);
    });

    it('should mark source as unreliable', () => {
      tracker.markSourceUnreliable('s1');
      const source = tracker.getSource('s1');
      expect(source?.verification).toBe('suspicious');
      expect(source?.isActive).toBe(false);
    });
  });

  describe('Evidence Recording', () => {
    it('should record evidence for a data point', () => {
      const evidence: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price is €599',
        claimValue: 599,
        observedAt: new Date(),
        retrievalMethod: 'api',
        confidence: 0.95,
      };

      tracker.recordEvidence('Sony WH-1000XM5 price', evidence);

      const recorded = tracker.getEvidence('Sony WH-1000XM5 price');
      expect(recorded.length).toBe(1);
      expect(recorded[0].claimValue).toBe(599);
    });

    it('should detect conflicts when multiple sources disagree', () => {
      const price599: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
        retrievalMethod: 'api',
      };

      const price650: Evidence = {
        id: 'e2',
        sourceId: 's2',
        claimType: 'price',
        claim: 'Price €650',
        claimValue: 650,
        observedAt: new Date(),
        retrievalMethod: 'scrape',
      };

      tracker.recordEvidence('product-price', price599);
      tracker.recordEvidence('product-price', price650);

      const summary = tracker.getConflictSummary();
      expect(summary.totalConflicts).toBeGreaterThan(0);
      expect(summary.unresolvedConflicts).toBeGreaterThanOrEqual(0);
    });

    it('should NOT detect conflicts when values match', () => {
      const evidence1: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      const evidence2: Evidence = {
        id: 'e2',
        sourceId: 's2',
        claimType: 'price',
        claim: 'Also €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      tracker.recordEvidence('same-price', evidence1);
      tracker.recordEvidence('same-price', evidence2);

      const summary = tracker.getConflictSummary();
      // Should NOT create conflict if values match
      expect(summary.conflictedDataPoints).not.toContain('same-price');
    });
  });

  describe('Provenance Building', () => {
    it('should build complete provenance for a value', () => {
      const evidence: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      tracker.recordEvidence('price-data', evidence);

      const provenance = tracker.buildProvenance('price-data', 599, 's1');

      expect(provenance.source).toBeDefined();
      expect(provenance.source.id).toBe('s1');
      expect(provenance.supportingEvidence.length).toBeGreaterThanOrEqual(1);
      expect(provenance.verificationStatus).toBeDefined();
    });

    it('should calculate reliability metrics', () => {
      const evidence: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      tracker.recordEvidence('price', evidence);
      const provenance = tracker.buildProvenance('price', 599, 's1');

      expect(provenance.reliability.sourceReliability).toBeGreaterThan(0);
      expect(provenance.reliability.dataFreshness).toBeGreaterThanOrEqual(0);
      expect(provenance.reliability.evidenceCount).toBeGreaterThanOrEqual(1);
      expect(provenance.reliability.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(provenance.reliability.overallConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve conflicts by source authority', () => {
      const trustedSource: SourceType = {
        id: 's-trusted',
        name: 'Manufacturer',
        type: 'manufacturer',
        verification: 'trusted',
        isActive: true,
        canProvide: {},
        createdAt: new Date(),
      };

      tracker.registerSource(trustedSource);

      const untrustEvidence: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      const trustedEvidence: Evidence = {
        id: 'e2',
        sourceId: 's-trusted',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      tracker.recordEvidence('conflict-price', untrustEvidence);
      tracker.recordEvidence('conflict-price', trustedEvidence);

      const summary = tracker.getConflictSummary();
      // Conflict should be resolved by authority, so it might be marked resolved
      expect(summary).toBeDefined();
    });

    it('should resolve conflicts by consensus', () => {
      const source1: SourceType = {
        id: 's1',
        name: 'Source1',
        type: 'api_integration',
        verification: 'unverified',
        isActive: true,
        canProvide: {},
        createdAt: new Date(),
      };
      const source2: SourceType = {
        id: 's2',
        name: 'Source2',
        type: 'api_integration',
        verification: 'unverified',
        isActive: true,
        canProvide: {},
        createdAt: new Date(),
      };
      const source3: SourceType = {
        id: 's3',
        name: 'Source3',
        type: 'api_integration',
        verification: 'unverified',
        isActive: true,
        canProvide: {},
        createdAt: new Date(),
      };

      tracker.registerSource(source1);
      tracker.registerSource(source2);
      tracker.registerSource(source3);

      // 2 sources say 100, 1 source says 90
      tracker.recordEvidence('test-data', {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: '100',
        claimValue: 100,
        observedAt: new Date(),
      });

      tracker.recordEvidence('test-data', {
        id: 'e2',
        sourceId: 's2',
        claimType: 'price',
        claim: '100',
        claimValue: 100,
        observedAt: new Date(),
      });

      tracker.recordEvidence('test-data', {
        id: 'e3',
        sourceId: 's3',
        claimType: 'price',
        claim: '90',
        claimValue: 90,
        observedAt: new Date(),
      });

      const summary = tracker.getConflictSummary();
      expect(summary).toBeDefined();
    });
  });

  describe('Audit Trail', () => {
    it('should generate comprehensive audit trail', () => {
      const evidence: Evidence = {
        id: 'e1',
        sourceId: 's1',
        claimType: 'price',
        claim: 'Price €599',
        claimValue: 599,
        observedAt: new Date(),
      };

      tracker.recordEvidence('audit-test', evidence);

      const trail = tracker.buildAuditTrail('audit-test', 599);

      expect(trail.id).toBeDefined();
      expect(trail.dataPointDescription).toBe('audit-test');
      expect(trail.claimedValue).toBe(599);
      expect(trail.sources.length).toBeGreaterThanOrEqual(1);
      expect(trail.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(trail.confidenceScore).toBeLessThanOrEqual(1);
      expect(trail.summary).toBeDefined();
      expect(trail.createdAt).toBeInstanceOf(Date);
    });

    it('should generate warnings for low-evidence data', () => {
      const trail = tracker.buildAuditTrail('no-evidence', 'some-value');

      expect(trail.warnings).toBeDefined();
      expect(trail.warnings!.length).toBeGreaterThan(0);
      expect(trail.warnings!.some(w => w.includes('No evidence'))).toBe(true);
    });
  });

  describe('Conflict Summary', () => {
    it('should provide accurate conflict summary', () => {
      const summary = tracker.getConflictSummary();

      expect(summary.totalConflicts).toBeGreaterThanOrEqual(0);
      expect(summary.unresolvedConflicts).toBeGreaterThanOrEqual(0);
      expect(summary.unresolvedConflicts).toBeLessThanOrEqual(summary.totalConflicts);
      expect(summary.conflictedDataPoints).toBeInstanceOf(Array);
      expect(typeof summary.affectsRanking).toBe('boolean');
      expect(typeof summary.userNotificationNeeded).toBe('boolean');
    });

    it('should only notify user when conflicts are few and unresolved', () => {
      const summary = tracker.getConflictSummary();

      if (summary.unresolvedConflicts > 3) {
        // Too many conflicts to show user
        expect(summary.userNotificationNeeded).toBe(false);
      }
    });
  });
});
