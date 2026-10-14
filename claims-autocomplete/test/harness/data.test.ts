import { describe, expect, it } from 'vitest';
import { loadClaims, loadEntitlements, loadEvalQueries } from '../../data/load';

describe('generated data', () => {
  const claims = loadClaims();
  const ent = loadEntitlements();
  const evals = loadEvalQueries();

  it('has 50k claims across 200 brands and 4 clients', () => {
    expect(claims).toHaveLength(50_000);
    expect(new Set(claims.map((c) => c.brandId)).size).toBe(200);
    expect(new Set(claims.map((c) => c.clientId)).size).toBe(4);
    expect(ent.brands).toHaveLength(200);
    expect(ent.clients).toHaveLength(4);
  });

  it('claims have the documented shape', () => {
    const ids = new Set<string>();
    const brandClient = new Map(ent.brands.map((b) => [b.id, b.clientId]));
    for (const c of claims) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.text.length).toBeGreaterThanOrEqual(20);
      expect(c.text.length).toBeLessThanOrEqual(400);
      expect(['approved', 'revoked', 'expired']).toContain(c.status);
      expect(c.markets.length).toBeGreaterThan(0);
      expect(c.channels.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(c.expiresAt))).toBe(false);
      expect(c.version).toBeGreaterThanOrEqual(1);
      expect(c.citations.length).toBeGreaterThan(0);
      expect(brandClient.get(c.brandId)).toBe(c.clientId);
    }
  });

  it('brand libraries hold 50 to 2,000 claims', () => {
    const sizes = new Map<string, number>();
    for (const c of claims) sizes.set(c.brandId, (sizes.get(c.brandId) ?? 0) + 1);
    expect(Math.min(...sizes.values())).toBeGreaterThanOrEqual(50);
    expect(Math.max(...sizes.values())).toBeLessThanOrEqual(2000);
  });

  it('eval queries point at existing claims, assets and entitled users', () => {
    expect(evals).toHaveLength(300);
    const claimIds = new Set(claims.map((c) => c.id));
    const assets = new Map(ent.assets.map((a) => [a.id, a]));
    const users = new Map(ent.users.map((u) => [u.id, u]));
    for (const q of evals) {
      expect(claimIds.has(q.targetClaimId)).toBe(true);
      const asset = assets.get(q.assetId)!;
      expect(asset).toBeDefined();
      expect(users.get(q.userId)!.clientIds).toContain(asset.clientId);
      expect(q.query.length).toBeGreaterThan(0);
      expect(q.query.length).toBeLessThanOrEqual(200);
    }
  });
});
