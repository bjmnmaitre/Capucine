/**
 * Health endpoint tests
 */
import { buildApp } from '../../src/api/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('GET /health', () => {
  let dir: string;
  let app: any;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-health-'));
    const { buildApp: buildAppImport } = await import('../../src/api/server');
    app = buildAppImport({ profileStoreDir: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 200 with status ok', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns cache info with maxSize 100', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).get('/health');
    expect(res.body.cache).toBeDefined();
    expect(res.body.cache.maxSize).toBe(100);
    expect(res.body.cache.size).toBeGreaterThanOrEqual(0);
    expect(res.body.cache.ttlMs).toBe(300000);
    expect(typeof res.body.cache.hitRate).toBe('string');
  });

  it('returns uptime as number with one decimal place', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).get('/health');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    // Check it has at most 1 decimal place
    const decimalPlaces = (res.body.uptime.toString().split('.')[1] || '').length;
    expect(decimalPlaces).toBeLessThanOrEqual(1);
  });

  it('returns providers info with current and fallback', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).get('/health');
    expect(res.body.aiProvider).toBeDefined();
    expect(typeof res.body.aiProvider.current).toBe('string');
    expect(typeof res.body.aiProvider.fallback).toBe('string');
    expect(typeof res.body.aiProvider.groqCooldown).toBe('boolean');
    expect(typeof res.body.aiProvider.openrouterCooldown).toBe('boolean');
  });

  it('includes timestamp and version', async () => {
    const { default: supertest } = await import('supertest');
    const res = await supertest(app).get('/health');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.version).toBe('0.1.0');
  });
});
