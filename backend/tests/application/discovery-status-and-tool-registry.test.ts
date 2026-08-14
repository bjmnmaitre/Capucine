/**
 * Tests for:
 *  1. DiscoveryStatus semantic layer — inferDiscoveryStatus, status on Orchestrator results
 *  2. ToolRegistry security hardening — name validation, timeout, rate limiting, audit trail
 *
 * SECURITY INVARIANTS TESTED:
 * - Tool names are validated; invalid names are rejected at register() and execute()
 * - Timeouts are enforced — a stalling tool cannot block the engine forever
 * - Rate limits are enforced — tight loops cannot burn paid API quotas
 * - Every call is logged; audit log is append-only
 * - Tool availability check prevents silent no-ops when config is missing
 * - DiscoveryStatus is always set on Orchestrator-produced results
 * - NO_RESULTS vs FAILED are distinct and surfaced correctly
 */

import {
  DiscoveryOrchestrator,
  IDiscoveryStrategy,
  DiscoveryResult,
  DiscoveryCriteria,
  inferDiscoveryStatus,
} from '../../src/application/discovery';

import {
  ToolRegistry,
  Tool,
  ToolRequest,
  ToolResponse,
} from '../../src/application/tools';

import { DataProvenance } from '../../src/domain/types';

// ============================================================================
// HELPERS
// ============================================================================

function makeResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    id: 'test',
    timestamp: new Date(),
    criteria: {},
    candidates: [],
    statistics: {
      queriedSources: 1,
      candidatesFound: 0,
      candidatesFiltered: 0,
      searchTimeMs: 0,
      relevanceEstimate: 'low',
    },
    strategy: 'mock',
    ...overrides,
  };
}

function makeProvenance(): DataProvenance {
  return { source: 'test', retrievedAt: new Date() };
}

/** Minimal strategy that returns 0 candidates */
class ZeroStrategy implements IDiscoveryStrategy {
  readonly name: string;
  readonly version = '1.0.0';
  readonly isReady = true;
  constructor(name: string) { this.name = name; }
  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    return makeResult({ strategy: this.name, criteria });
  }
  discoverSync(criteria: DiscoveryCriteria): DiscoveryResult {
    return makeResult({ strategy: this.name, criteria });
  }
  async health() { return { status: 'healthy' as const }; }
}

/** Strategy that always throws */
class ThrowingStrategy implements IDiscoveryStrategy {
  readonly name = 'throw';
  readonly version = '1.0.0';
  readonly isReady = true;
  async discover(): Promise<DiscoveryResult> { throw new Error('simulated failure'); }
  discoverSync(): DiscoveryResult { throw new Error('simulated failure'); }
  async health() { return { status: 'unavailable' as const }; }
}

/** Minimal compliant tool */
function makeTool(name: string, options: { available?: boolean; delayMs?: number; throws?: boolean } = {}): Tool {
  return {
    name,
    description: 'Test tool',
    version: '1.0.0',
    requiresApiKey: false,
    available: () => options.available ?? true,
    execute: async (req: ToolRequest): Promise<ToolResponse> => {
      if (options.throws) throw new Error('tool exploded');
      if (options.delayMs) {
        await new Promise(res => setTimeout(res, options.delayMs));
      }
      return {
        success: true,
        data: { result: 'ok' },
        provenance: makeProvenance(),
        durationMs: 1,
        fromCache: false,
        toolName: name,
      };
    },
  };
}

// ============================================================================
// DISCOVERY STATUS
// ============================================================================

describe('DiscoveryStatus — inferDiscoveryStatus()', () => {
  it('returns RESULTS when status is explicitly set', () => {
    const r = makeResult({ status: 'RESULTS', candidates: [{ offer: {} as any, matchScore: 1 }] });
    expect(inferDiscoveryStatus(r)).toBe('RESULTS');
  });

  it('returns NO_RESULTS when no candidates and no warnings', () => {
    const r = makeResult({ candidates: [] });
    expect(inferDiscoveryStatus(r)).toBe('NO_RESULTS');
  });

  it('returns SEARCH_PROVIDER_NOT_CONFIGURED when warning mentions not configured', () => {
    const r = makeResult({ warnings: ['Tool not configured — no API key'] });
    expect(inferDiscoveryStatus(r)).toBe('SEARCH_PROVIDER_NOT_CONFIGURED');
  });

  it('returns FAILED when warning mentions error/threw', () => {
    const r = makeResult({ warnings: ['Strategy threw an error during search'] });
    expect(inferDiscoveryStatus(r)).toBe('FAILED');
  });

  it('returns ESCALATION_EXHAUSTED when warning mentions exhausted', () => {
    const r = makeResult({ warnings: ['Escalation exhausted all levels without finding candidates'] });
    expect(inferDiscoveryStatus(r)).toBe('ESCALATION_EXHAUSTED');
  });

  it('honours explicit status over inferred', () => {
    const r = makeResult({ status: 'CACHED', warnings: ['some warning'] });
    expect(inferDiscoveryStatus(r)).toBe('CACHED');
  });
});

describe('DiscoveryStatus — DiscoveryOrchestrator sets status', () => {
  it('sets FAILED on the result when all strategies throw', async () => {
    const orchestrator = new DiscoveryOrchestrator();
    orchestrator.registerStrategy(new ThrowingStrategy());
    const result = await orchestrator.discover({});
    expect(result.status).toBe('FAILED');
  });

  it('sets NO_RESULTS when a strategy returns 0 candidates without throwing', async () => {
    const orchestrator = new DiscoveryOrchestrator();
    orchestrator.registerStrategy(new ZeroStrategy('zero'));
    const result = await orchestrator.discover({});
    expect(result.status).toBe('NO_RESULTS');
  });

  it('sets FAILED on sync path too', () => {
    const orchestrator = new DiscoveryOrchestrator();
    orchestrator.registerStrategy(new ThrowingStrategy());
    const result = orchestrator.discoverSync({});
    expect(result.status).toBe('FAILED');
  });

  it('sets NO_RESULTS on sync path with 0 candidates', () => {
    const orchestrator = new DiscoveryOrchestrator();
    orchestrator.registerStrategy(new ZeroStrategy('zero'));
    const result = orchestrator.discoverSync({});
    expect(result.status).toBe('NO_RESULTS');
  });
});

// ============================================================================
// TOOL REGISTRY — SECURITY
// ============================================================================

describe('ToolRegistry — tool name validation', () => {
  it('accepts valid tool names', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeTool('web-search'))).not.toThrow();
    expect(() => reg.register(makeTool('product_db'))).not.toThrow();
    expect(() => reg.register(makeTool('catalog123'))).not.toThrow();
  });

  it('rejects tool names with spaces', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeTool('bad name'))).toThrow();
  });

  it('rejects tool names with uppercase', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeTool('WebSearch'))).toThrow();
  });

  it('rejects tool names with path traversal characters', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeTool('../../../etc/passwd'))).toThrow();
  });

  it('rejects empty tool name', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeTool(''))).toThrow();
  });

  it('rejects tool name longer than 64 chars', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeTool('a'.repeat(65)))).toThrow();
  });

  it('rejects execute() call with invalid tool name', async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute('../evil', { requestId: 'r1', params: {} });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNSUPPORTED');
  });
});

describe('ToolRegistry — availability check', () => {
  it('returns API_KEY_MISSING when tool.available() = false', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('unavailable-tool', { available: false }));
    const result = await reg.execute('unavailable-tool', { requestId: 'r1', params: {} });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('API_KEY_MISSING');
  });

  it('isAvailable() returns false for invalid tool name', () => {
    const reg = new ToolRegistry();
    expect(reg.isAvailable('../evil')).toBe(false);
  });

  it('isAvailable() returns false for unregistered tool', () => {
    const reg = new ToolRegistry();
    expect(reg.isAvailable('nonexistent')).toBe(false);
  });

  it('isAvailable() returns true for registered available tool', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('my-tool'));
    expect(reg.isAvailable('my-tool')).toBe(true);
  });
});

describe('ToolRegistry — timeout enforcement', () => {
  it('returns TIMEOUT error when tool exceeds timeoutMs', async () => {
    const reg = new ToolRegistry({ defaultTimeoutMs: 5000 });
    reg.register(makeTool('slow-tool', { delayMs: 200 }));
    const result = await reg.execute('slow-tool', {
      requestId: 'r1',
      params: {},
      timeoutMs: 50, // will be exceeded by 200ms delay
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
  }, 3000);

  it('succeeds when tool responds within timeoutMs', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('fast-tool', { delayMs: 5 }));
    const result = await reg.execute('fast-tool', {
      requestId: 'r1',
      params: {},
      timeoutMs: 500,
    });
    expect(result.success).toBe(true);
  }, 3000);

  it('returns INTERNAL_ERROR when tool throws unexpectedly', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('exploding-tool', { throws: true }));
    const result = await reg.execute('exploding-tool', { requestId: 'r1', params: {} });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INTERNAL_ERROR');
  });
});

describe('ToolRegistry — rate limiting', () => {
  it('allows calls within the rate limit', async () => {
    const reg = new ToolRegistry({ rateLimitPerTool: { maxCalls: 5, windowMs: 60_000 } });
    reg.register(makeTool('rate-tool'));

    let successCount = 0;
    for (let i = 0; i < 5; i++) {
      const result = await reg.execute('rate-tool', { requestId: `r${i}`, params: {} });
      if (result.success) successCount++;
    }
    expect(successCount).toBe(5);
  });

  it('blocks calls that exceed the rate limit', async () => {
    const reg = new ToolRegistry({ rateLimitPerTool: { maxCalls: 3, windowMs: 60_000 } });
    reg.register(makeTool('limited-tool'));

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        reg.execute('limited-tool', { requestId: `r${i}`, params: {} })
      )
    );

    const rateLimited = results.filter(r => r.errorCode === 'RATE_LIMITED');
    expect(rateLimited.length).toBeGreaterThanOrEqual(2); // at least calls 4 and 5 should be blocked
  });

  it('rate limit window resets after windowMs', async () => {
    const reg = new ToolRegistry({ rateLimitPerTool: { maxCalls: 2, windowMs: 50 } });
    reg.register(makeTool('window-tool'));

    // Exhaust limit
    await reg.execute('window-tool', { requestId: 'r1', params: {} });
    await reg.execute('window-tool', { requestId: 'r2', params: {} });
    const blocked = await reg.execute('window-tool', { requestId: 'r3', params: {} });
    expect(blocked.errorCode).toBe('RATE_LIMITED');

    // Wait for window to expire
    await new Promise(res => setTimeout(res, 60));

    // Should succeed again
    const afterReset = await reg.execute('window-tool', { requestId: 'r4', params: {} });
    expect(afterReset.success).toBe(true);
  }, 3000);
});

describe('ToolRegistry — audit trail', () => {
  it('logs every call (success)', async () => {
    const reg = new ToolRegistry({ auditEnabled: true });
    reg.register(makeTool('audit-tool'));
    await reg.execute('audit-tool', { requestId: 'req-1', params: {} });
    const log = reg.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].toolName).toBe('audit-tool');
    expect(log[0].requestId).toBe('req-1');
    expect(log[0].success).toBe(true);
    expect(log[0].timedOut).toBe(false);
  });

  it('logs failed calls too', async () => {
    const reg = new ToolRegistry({ auditEnabled: true });
    const result = await reg.execute('nonexistent', { requestId: 'req-2', params: {} });
    // nonexistent has invalid name — still logged
    const log = reg.getAuditLog();
    expect(log.some(e => e.requestId === 'req-2' && !e.success)).toBe(true);
  });

  it('getAuditLog() returns a copy — mutations do not affect internal log', async () => {
    const reg = new ToolRegistry({ auditEnabled: true });
    reg.register(makeTool('safe-tool'));
    await reg.execute('safe-tool', { requestId: 'req-3', params: {} });

    const copy = reg.getAuditLog();
    copy.pop(); // mutate the copy

    expect(reg.getAuditLog()).toHaveLength(1); // internal log unchanged
  });

  it('audit is disabled when auditEnabled = false', async () => {
    const reg = new ToolRegistry({ auditEnabled: false });
    reg.register(makeTool('quiet-tool'));
    await reg.execute('quiet-tool', { requestId: 'req-4', params: {} });
    expect(reg.getAuditLog()).toHaveLength(0);
  });

  it('listTools() includes error rate', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('stat-tool'));
    const tools = reg.listTools();
    const stat = tools.find(t => t.name === 'stat-tool');
    expect(stat?.stats.errorRate).toBe(0);
  });
});
