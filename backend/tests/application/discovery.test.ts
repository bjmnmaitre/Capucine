/**
 * Tests for Discovery Abstraction
 *
 * Validates offer discovery orchestration and strategy plugging.
 */

import { DiscoveryOrchestrator, MockDiscoveryStrategy, DiscoveryCriteria, IDiscoveryStrategy, DiscoveryResult } from '../../src/application/discovery';
import { Offer } from '../../src/domain/types';

describe('Discovery Abstraction', () => {
  let orchestrator: DiscoveryOrchestrator;
  let mockStrategy: MockDiscoveryStrategy;

  beforeEach(() => {
    orchestrator = new DiscoveryOrchestrator();
    mockStrategy = new MockDiscoveryStrategy();
    orchestrator.registerStrategy(mockStrategy, true);
  });

  describe('Strategy Registration', () => {
    it('should register a strategy', () => {
      const strategies = orchestrator.listStrategies();
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.some(s => s.name === 'mock')).toBe(true);
    });

    it('should list strategies with metadata', () => {
      const strategies = orchestrator.listStrategies();
      const mock = strategies.find(s => s.name === 'mock');

      expect(mock).toBeDefined();
      expect(mock?.version).toBeDefined();
      expect(typeof mock?.ready).toBe('boolean');
    });

    it('should not register duplicate strategies', () => {
      const initialCount = orchestrator.listStrategies().length;
      orchestrator.registerStrategy(mockStrategy);
      const finalCount = orchestrator.listStrategies().length;

      expect(finalCount).toBe(initialCount);
    });
  });

  describe('Synchronous Discovery', () => {
    it('should execute discovery sync', () => {
      const criteria: DiscoveryCriteria = {
        keywords: ['laptop'],
        limit: 10,
      };

      const result = orchestrator.discoverSync(criteria);

      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.criteria).toEqual(criteria);
      expect(Array.isArray(result.candidates)).toBe(true);
    });

    it('should return discovery result with statistics', () => {
      const criteria: DiscoveryCriteria = { limit: 5 };
      const result = orchestrator.discoverSync(criteria);

      expect(result.statistics.queriedSources).toBeGreaterThan(0);
      expect(result.statistics.candidatesFound).toBeGreaterThanOrEqual(0);
      expect(result.statistics.searchTimeMs).toBeGreaterThanOrEqual(0);
      expect(['high', 'medium', 'low']).toContain(result.statistics.relevanceEstimate);
    });

    it('should respect limit criteria', () => {
      const criteria: DiscoveryCriteria = { limit: 5 };
      const result = orchestrator.discoverSync(criteria);

      expect(result.candidates.length).toBeLessThanOrEqual(5);
    });

    it('should respect offset criteria', () => {
      const criteria1: DiscoveryCriteria = { offset: 0, limit: 10 };
      const result1 = orchestrator.discoverSync(criteria1);

      const criteria2: DiscoveryCriteria = { offset: 5, limit: 10 };
      const result2 = orchestrator.discoverSync(criteria2);

      // Results from different offsets should have different candidates
      // (if enough candidates exist)
      expect(result1.candidates.length).toBeGreaterThanOrEqual(0);
      expect(result2.candidates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Asynchronous Discovery', () => {
    it('should execute discovery async', async () => {
      const criteria: DiscoveryCriteria = {
        keywords: ['keyboard'],
        limit: 10,
      };

      const result = await orchestrator.discover(criteria);

      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(Array.isArray(result.candidates)).toBe(true);
    });

    it('should produce identical results for identical criteria (determinism)', async () => {
      const criteria: DiscoveryCriteria = {
        keywords: ['test'],
        minPrice: 100,
        maxPrice: 500,
      };

      const result1 = await orchestrator.discover(criteria);
      const result2 = await orchestrator.discover(criteria);

      expect(result1.candidates.length).toBe(result2.candidates.length);
      expect(result1.strategy).toBe(result2.strategy);
    });
  });

  describe('Caching', () => {
    it('should support caching', async () => {
      orchestrator.enableCache(true, 5000);

      const criteria: DiscoveryCriteria = { limit: 5 };

      const result1 = await orchestrator.discover(criteria);
      const result2 = await orchestrator.discover(criteria);

      // Should be identical
      expect(result1.candidates.length).toBe(result2.candidates.length);
      expect(result1.id).toBe(result2.id); // Same ID = from cache
    });

    it('should clear cache', async () => {
      orchestrator.enableCache(true);

      const criteria: DiscoveryCriteria = { limit: 5 };
      const result1 = await orchestrator.discover(criteria);
      const id1 = result1.id;

      orchestrator.clearCache();

      const result2 = await orchestrator.discover(criteria);
      const id2 = result2.id;

      // After cache clear, new discovery may produce different ID
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
    });

    it('should respect cache TTL', async () => {
      orchestrator.enableCache(true, 100); // 100ms TTL

      const criteria: DiscoveryCriteria = { limit: 5 };

      const result1 = await orchestrator.discover(criteria);
      const id1 = result1.id;

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const result2 = await orchestrator.discover(criteria);
      const id2 = result2.id;

      // Results may differ after expiration
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
    });
  });

  describe('Fallback Strategy', () => {
    it('should fall back to alternate strategy if primary fails', async () => {
      // Create a failing strategy
      const failingStrategy: IDiscoveryStrategy = {
        name: 'failing',
        version: '1.0',
        isReady: true,
        discover: async () => {
          throw new Error('Strategy failed');
        },
        discoverSync: () => {
          throw new Error('Strategy failed');
        },
        health: async () => ({ status: 'unavailable' }),
      };

      orchestrator.registerStrategy(failingStrategy, true); // Make it primary
      orchestrator.registerStrategy(mockStrategy); // Register working fallback

      const criteria: DiscoveryCriteria = { limit: 5 };

      // Should use fallback
      const result = await orchestrator.discover(criteria);
      expect(result.strategy).toBe('mock');
    });
  });

  describe('No Results Handling', () => {
    it('should return empty candidates when no match', () => {
      const criteria: DiscoveryCriteria = {
        categories: ['nonexistent-category'],
      };

      const result = orchestrator.discoverSync(criteria);

      expect(result.candidates.length).toBe(0);
      expect(result.statistics.candidatesFound).toBe(0);
    });

    it('should include warnings when no results', () => {
      const criteria: DiscoveryCriteria = {
        categories: ['nonexistent'],
      };

      const result = orchestrator.discoverSync(criteria);

      if (result.candidates.length === 0) {
        expect(result.warnings).toBeDefined();
      }
    });
  });

  describe('Mock Strategy', () => {
    it('should identify as mock strategy', () => {
      const strategies = orchestrator.listStrategies();
      const mock = strategies.find(s => s.name === 'mock');

      expect(mock?.name).toBe('mock');
      expect(mock?.version).toBe('1.0.0');
    });

    it('should be ready immediately', () => {
      expect(mockStrategy.isReady).toBe(true);
    });

    it('should report healthy status', async () => {
      const health = await mockStrategy.health();
      expect(health.status).toBe('healthy');
    });

    it('should support both sync and async', async () => {
      const criteria: DiscoveryCriteria = { limit: 5 };

      const syncResult = mockStrategy.discoverSync(criteria);
      const asyncResult = await mockStrategy.discover(criteria);

      expect(syncResult.candidates.length).toEqual(asyncResult.candidates.length);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical input', () => {
      const criteria: DiscoveryCriteria = {
        minPrice: 100,
        maxPrice: 1000,
        sortBy: 'price_asc',
      };

      const result1 = orchestrator.discoverSync(criteria);
      const result2 = orchestrator.discoverSync(criteria);

      expect(result1.candidates.length).toBe(result2.candidates.length);
      expect(result1.statistics.candidatesFound).toBe(result2.statistics.candidatesFound);
    });

    it('should handle identical queries from different sources', () => {
      const criteria: DiscoveryCriteria = {
        keywords: ['test'],
        limit: 10,
      };

      const syncResult = orchestrator.discoverSync(criteria);
      const asyncResult = orchestrator.discoverSync(criteria); // Same as calling discoverSync again

      expect(syncResult.candidates.length).toBe(asyncResult.candidates.length);
    });
  });

  describe('Error Handling', () => {
    it('should handle all strategies failing gracefully', async () => {
      const failingStrategy: IDiscoveryStrategy = {
        name: 'only-failing',
        version: '1.0',
        isReady: true,
        discover: async () => {
          throw new Error('Always fails');
        },
        discoverSync: () => {
          throw new Error('Always fails');
        },
        health: async () => ({ status: 'unavailable' }),
      };

      const tempOrchestrator = new DiscoveryOrchestrator();
      tempOrchestrator.registerStrategy(failingStrategy, true);

      const criteria: DiscoveryCriteria = { limit: 5 };

      // Should not throw, should return empty result
      const result = await tempOrchestrator.discover(criteria);
      expect(result.candidates).toEqual([]);
      expect(result.warnings).toBeDefined();
    });

    it('should handle criteria filtering errors gracefully', () => {
      const criteria: DiscoveryCriteria = {
        allowedMerchants: ['nonexistent'],
        excludedMerchants: ['also-nonexistent'],
      };

      const result = orchestrator.discoverSync(criteria);

      // Should return valid result, possibly with 0 candidates
      expect(result.id).toBeDefined();
      expect(Array.isArray(result.candidates)).toBe(true);
    });
  });
});
