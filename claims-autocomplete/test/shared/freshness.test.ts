import { afterEach, describe, expect, it } from 'vitest';
import {
  allClaims,
  assetFor,
  assets,
  createTestApp,
  disallowed,
  eligibleClaims,
  HEALTHY_EMBEDDER,
  queryFor,
  settle,
  stopAllApps,
  userFor,
  type TestApp,
} from '../helpers/app';
import { CLOCK_START } from '../../shared/clock';
import type { Asset, Claim } from '../../shared/types';

afterEach(stopAllApps);

const MINUTE = 60_000;

/** Up to `n` claims usable in assets right now, with the asset to use each in. */
function usableClaims(app: TestApp, n: number, filter: (c: Claim) => boolean = () => true): { claim: Claim; asset: Asset }[] {
  const out: { claim: Claim; asset: Asset }[] = [];
  for (const asset of assets().filter((_, i) => i % 7 === 0)) {
    for (const claim of eligibleClaims(app, asset).filter(filter).slice(0, 2)) {
      if (!out.some((x) => x.claim.id === claim.id)) out.push({ claim, asset });
      if (out.length === n) return out;
    }
  }
  return out;
}

async function ids(app: TestApp, asset: Asset, query: string): Promise<string[]> {
  const user = userFor(asset);
  const results = await app.suggest(user.id, asset.id, query);
  expect(disallowed(app, user.id, asset.id, results)).toEqual([]);
  return results.map((s) => s.claimId);
}

describe('freshness and the authoritative check', () => {
  it.skip('#3 after revoke(id) and the clock advances 60 s, the claim never appears in results', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    const picked = usableClaims(app, 60);
    expect(picked).toHaveLength(60);
    for (const { claim, asset } of picked) expect(await ids(app, asset, queryFor(claim))).toContain(claim.id);

    for (const { claim } of picked) app.deps.store.revoke(claim.id);
    app.clock.advance(60_000);
    await settle(100);

    for (const { claim, asset } of picked) expect(await ids(app, asset, queryFor(claim))).not.toContain(claim.id);
  });

  it.skip('#4 insertClaim on a revoked claim returns REVOKED, even when the revoke event was dropped and the index is stale', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    const picked = usableClaims(app, 10);
    const seen = new Map<string, number>();
    for (const { claim, asset } of picked) {
      const user = userFor(asset);
      const hit = (await app.suggest(user.id, asset.id, queryFor(claim))).find((s) => s.claimId === claim.id);
      expect(hit).toBeDefined();
      seen.set(claim.id, hit!.version);
    }

    app.deps.store.setOptions({ eventDropRate: 1 }); // nothing about these revocations reaches listeners
    for (const { claim } of picked) app.deps.store.revoke(claim.id);
    await settle();

    for (const { claim, asset } of picked) {
      const user = userFor(asset);
      expect(await app.insert(user.id, asset.id, claim.id, seen.get(claim.id)!)).toEqual({ ok: false, error: 'REVOKED' });
      expect(app.deps.assets.getContent(asset.id)).toEqual([]);
    }

    // Claims that were already revoked in the data.
    const revoked = allClaims()
      .filter((c) => c.status === 'revoked')
      .map((c) => ({ claim: c, asset: assetFor(c) }))
      .filter((x): x is { claim: Claim; asset: Asset } => !!x.asset)
      .slice(0, 10);
    for (const { claim, asset } of revoked) {
      expect(await app.insert(userFor(asset).id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'REVOKED' });
    }
  });

  it.skip('#5 a claim past its expiresAt is never suggested or insertable, though no event fired', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    const fresh = (c: Claim) => c.status === 'approved';

    // Valid now, expiring within the next 30 minutes.
    const soon = allClaims()
      .filter((c) => fresh(c) && Date.parse(c.expiresAt) > CLOCK_START && Date.parse(c.expiresAt) <= CLOCK_START + 30 * MINUTE)
      .map((c) => ({ claim: c, asset: assetFor(c) }))
      .filter((x): x is { claim: Claim; asset: Asset } => !!x.asset)
      .slice(0, 15);
    expect(soon.length).toBeGreaterThanOrEqual(10);
    for (const { claim, asset } of soon) expect(await ids(app, asset, queryFor(claim))).toContain(claim.id);

    const events: unknown[] = [];
    app.deps.store.onChange((e) => events.push(e));
    app.clock.advance(31 * MINUTE);
    await settle();
    expect(events).toEqual([]);

    for (const { claim, asset } of soon) {
      expect(await ids(app, asset, queryFor(claim))).not.toContain(claim.id);
      expect(await app.insert(userFor(asset).id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'EXPIRED' });
    }

    // Still marked approved, but expiresAt was already in the past when the data was loaded.
    const stale = allClaims()
      .filter((c) => fresh(c) && Date.parse(c.expiresAt) < CLOCK_START)
      .map((c) => ({ claim: c, asset: assetFor(c) }))
      .filter((x): x is { claim: Claim; asset: Asset } => !!x.asset)
      .slice(0, 15);
    expect(stale.length).toBeGreaterThanOrEqual(10);
    for (const { claim, asset } of stale) {
      expect(await ids(app, asset, queryFor(claim))).not.toContain(claim.id);
      expect(await app.insert(userFor(asset).id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'EXPIRED' });
    }

    // Status already says expired.
    const expired = allClaims()
      .filter((c) => c.status === 'expired')
      .map((c) => ({ claim: c, asset: assetFor(c) }))
      .filter((x): x is { claim: Claim; asset: Asset } => !!x.asset)
      .slice(0, 5);
    for (const { claim, asset } of expired) {
      expect(await app.insert(userFor(asset).id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'EXPIRED' });
    }
  });

  it.skip('#6 inserting an outdated version returns STALE_VERSION', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    for (const { claim, asset } of usableClaims(app, 5)) {
      const user = userFor(asset);
      const before = app.deps.assets.getContent(asset.id);
      const [updated] = app.deps.store.approveBatch([
        { id: claim.id, brandId: claim.brandId, text: `${claim.text} Updated per label change.`, markets: [...claim.markets], channels: [...claim.channels], expiresAt: claim.expiresAt, citations: [...claim.citations] },
      ]);
      expect(updated!.version).toBe(claim.version + 1);

      expect(await app.insert(user.id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'STALE_VERSION' });
      expect(await app.insert(user.id, asset.id, claim.id, claim.version + 2)).toEqual({ ok: false, error: 'STALE_VERSION' });
      expect(app.deps.assets.getContent(asset.id)).toEqual(before);

      const ok = await app.insert(user.id, asset.id, claim.id, updated!.version);
      expect(ok.ok).toBe(true);
      if (!ok.ok) continue;
      expect(ok.node).toMatchObject({
        type: 'claim',
        claimId: claim.id,
        version: updated!.version,
        text: updated!.text,
        citations: updated!.citations,
        insertedBy: user.id,
        insertedAt: app.clock.now(),
      });
      expect(app.deps.assets.getContent(asset.id)).toEqual([...before, ok.node]);
    }
  });
});
