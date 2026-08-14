/**
 * Tests for SearchProviderOrchestrator
 *
 * Covers multi-provider search orchestration, deduplication, and failure handling.
 */

import {
  SearchProviderOrchestrator,
  createDefaultSearchOrchestrator,
} from '../../src/application/search-provider-orchestrator';
import { WebSearchAdapter, WebSearchParams, WebSearchOutput } from '../../src/application/tools';

// ============================================================================
// MOCK ADAPTERS
// ============================================================================

class MockSearchAdapter implements WebSearchAdapter {
  readonly adapterName: string;
  private results: WebSearchOutput;
  private isConfiguredFlag: boolean;

  constructor(name: string, results: WebSearchOutput, isConfigured = true) {
    this.adapterName = name;
    this.results = results;
    this.isConfiguredFlag = isConfigured;
  }

  isConfigured(): boolean {
    return this.isConfiguredFlag;
  }

  async search(_params: WebSearchParams): Promise<WebSearchOutput> {
    return this.results;
  }
}

class TimeoutMockAdapter implements WebSearchAdapter {
  readonly adapterName = 'timeout_adapter';

  isConfigured(): boolean {
    return true;
  }

  async search(_params: WebSearchParams): Promise<WebSearchOutput> {
    // Simulate timeout by never resolving
    return new Promise(() => {
      // Never resolves
    });
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('SearchProviderOrchestrator', () => {
  describe('initialization', () => {
    it('should create orchestrator with multiple adapters', () => {
      const adapter1 = new MockSearchAdapter('brave', {
        results: [],
        searchEngine: 'brave',
      });
      const adapter2 = new MockSearchAdapter('serper', {
        results: [],
        searchEngine: 'serper',
      });

      const orchestrator = new SearchProviderOrchestrator([adapter1, adapter2]);
      expect(orchestrator).toBeDefined();
    });

    it('should handle empty provider list', async () => {
      const orchestrator = new SearchProviderOrchestrator([]);
      const result = await orchestrator.search({
        query: 'test',
      });

      expect(result.status).toBe('NO_PROVIDERS');
      expect(result.results).toHaveLength(0);
    });
  });

  describe('parallel search execution', () => {
    it('should search all providers in parallel', async () => {
      const braveResults = {
        results: [
          {
            title: 'Product A',
            url: 'https://brave.example/a',
            snippet: 'Description A',
            position: 1,
            domain: 'brave.example',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const serperResults = {
        results: [
          {
            title: 'Product B',
            url: 'https://serper.example/b',
            snippet: 'Description B',
            position: 1,
            domain: 'serper.example',
          },
        ],
        searchEngine: 'serper' as const,
      };

      const braveAdapter = new MockSearchAdapter('brave', braveResults);
      const serperAdapter = new MockSearchAdapter('serper', serperResults);

      const orchestrator = new SearchProviderOrchestrator([braveAdapter, serperAdapter], {
        deduplicateByUrl: true,
      });

      const result = await orchestrator.search({ query: 'test' });

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toHaveLength(2);
      expect(result.providerOutcomes).toHaveLength(2);
      expect(result.providerOutcomes.every((o) => o.status === 'success')).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate results by URL', async () => {
      const commonUrl = 'https://example.com/product';

      const braveResults = {
        results: [
          {
            title: 'Product Title',
            url: commonUrl,
            snippet: 'Snippet from Brave',
            position: 1,
            domain: 'example.com',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const serperResults = {
        results: [
          {
            title: 'Product Title (Serper)',
            url: commonUrl,
            snippet: 'Snippet from Serper',
            position: 1,
            domain: 'example.com',
          },
        ],
        searchEngine: 'serper' as const,
      };

      const braveAdapter = new MockSearchAdapter('brave', braveResults);
      const serperAdapter = new MockSearchAdapter('serper', serperResults);

      const orchestrator = new SearchProviderOrchestrator([braveAdapter, serperAdapter], {
        deduplicateByUrl: true,
      });

      const result = await orchestrator.search({ query: 'test' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].foundBy).toContain('example.com');
      expect(result.mergeMetadata.dedupByUrlCount).toBeGreaterThan(0);
    });

    it('should preserve foundBy list when deduplicating', async () => {
      const url = 'https://example.com/product';

      const braveResults = {
        results: [
          {
            title: 'Product',
            url,
            snippet: 'From Brave',
            position: 1,
            domain: 'brave.example.com',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const serperResults = {
        results: [
          {
            title: 'Product',
            url,
            snippet: 'From Serper',
            position: 1,
            domain: 'serper.example.com',
          },
        ],
        searchEngine: 'serper' as const,
      };

      const braveAdapter = new MockSearchAdapter('brave', braveResults);
      const serperAdapter = new MockSearchAdapter('serper', serperResults);

      const orchestrator = new SearchProviderOrchestrator([braveAdapter, serperAdapter]);

      const result = await orchestrator.search({ query: 'test' });

      expect(result.results[0].foundBy).toEqual(
        expect.arrayContaining(['brave.example.com', 'serper.example.com'])
      );
    });
  });

  describe('provider failure handling', () => {
    it('should return PARTIAL status when one provider fails', async () => {
      const successResults = {
        results: [
          {
            title: 'Product',
            url: 'https://success.com',
            snippet: 'Works',
            position: 1,
            domain: 'success.com',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const successAdapter = new MockSearchAdapter('brave', successResults);
      const failAdapter = new MockSearchAdapter('serper', { results: [], searchEngine: 'serper' }, false);

      const orchestrator = new SearchProviderOrchestrator([successAdapter, failAdapter], {
        continueOnAllFailures: true,
      });

      const result = await orchestrator.search({ query: 'test' });

      expect(result.status).toBe('PARTIAL');
      expect(result.results).toHaveLength(1);
      expect(result.providerOutcomes[1].status).toBe('not_configured');
    });

    it('should return FAILED status when all providers fail', async () => {
      const failAdapter1 = new MockSearchAdapter('brave', { results: [], searchEngine: 'brave' }, false);
      const failAdapter2 = new MockSearchAdapter('serper', { results: [], searchEngine: 'serper' }, false);

      const orchestrator = new SearchProviderOrchestrator([failAdapter1, failAdapter2], {
        timeoutPerProviderMs: 100,
      });

      const result = await orchestrator.search({ query: 'test' });

      expect(result.status).toBe('FAILED');
      expect(result.results).toHaveLength(0);
    }, 10000);

    it('should handle timeouts gracefully', async () => {
      const successResults = {
        results: [
          {
            title: 'Product',
            url: 'https://success.com',
            snippet: 'Works',
            position: 1,
            domain: 'success.com',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const successAdapter = new MockSearchAdapter('brave', successResults);
      const timeoutAdapter = new TimeoutMockAdapter();

      const orchestrator = new SearchProviderOrchestrator([successAdapter, timeoutAdapter], {
        timeoutPerProviderMs: 100,
        continueOnAllFailures: true,
      });

      const result = await orchestrator.search({ query: 'test' });

      expect(result.status).toBe('PARTIAL');
      expect(result.results).toHaveLength(1);
      expect(result.providerOutcomes[1].status).toBe('timeout');
    });
  });

  describe('metadata tracking', () => {
    it('should track provider outcomes correctly', async () => {
      const results = {
        results: [
          {
            title: 'Product',
            url: 'https://example.com',
            snippet: 'Test',
            position: 1,
            domain: 'example.com',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const adapter = new MockSearchAdapter('brave', results);
      const orchestrator = new SearchProviderOrchestrator([adapter]);

      const result = await orchestrator.search({ query: 'test' });

      expect(result.providerOutcomes).toHaveLength(1);
      expect(result.providerOutcomes[0]).toEqual(
        expect.objectContaining({
          providerName: 'brave',
          status: 'success',
          resultsCount: 1,
        })
      );
      expect(result.providerOutcomes[0].elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should track merge metadata', async () => {
      const results = {
        results: [
          {
            title: 'Product 1',
            url: 'https://example1.com',
            snippet: 'Test 1',
            position: 1,
            domain: 'example1.com',
          },
          {
            title: 'Product 2',
            url: 'https://example2.com',
            snippet: 'Test 2',
            position: 2,
            domain: 'example2.com',
          },
        ],
        searchEngine: 'brave' as const,
      };

      const adapter = new MockSearchAdapter('brave', results);
      const orchestrator = new SearchProviderOrchestrator([adapter]);

      const result = await orchestrator.search({ query: 'test' });

      expect(result.mergeMetadata).toEqual(
        expect.objectContaining({
          totalCandidatesBeforeMerge: 2,
          totalCandidatesAfterDedup: 2,
          dedupByUrlCount: 0,
          conflictsDetected: 0,
        })
      );
    });
  });

  describe('confidence scoring', () => {
    it('should calculate confidence based on provider agreement', async () => {
      const commonUrl = 'https://example.com/product';

      const braveResults = {
        results: [{ title: 'P', url: commonUrl, snippet: 'B', position: 1, domain: 'brave.com' }],
        searchEngine: 'brave' as const,
      };

      const serperResults = {
        results: [{ title: 'P', url: commonUrl, snippet: 'S', position: 1, domain: 'serper.com' }],
        searchEngine: 'serper' as const,
      };

      const braveAdapter = new MockSearchAdapter('brave', braveResults);
      const serperAdapter = new MockSearchAdapter('serper', serperResults);

      const orchestrator = new SearchProviderOrchestrator([braveAdapter, serperAdapter]);

      const result = await orchestrator.search({ query: 'test' });

      // Both providers found it = high confidence (foundBy.length = 2, providers = 2, so 2/2 = 1.0)
      expect(result.results[0].confidence).toBe(1.0);
      expect(result.results[0].foundBy).toHaveLength(2);
    });
  });
});
