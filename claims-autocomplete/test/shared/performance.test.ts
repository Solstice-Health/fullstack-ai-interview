import { afterEach, describe, expect, it } from 'vitest';
import type { ClaimDraft } from '../../server/claimStore';
import {
  assets,
  createTestApp,
  disallowed,
  eligibleClaims,
  evalQueries,
  HEALTHY_EMBEDDER,
  p95,
  queryFor,
  runPool,
  settle,
  stopAllApps,
  userFor,
} from '../helpers/app';

afterEach(stopAllApps);

const BUDGET_MS = 100;

describe('latency and degradation', () => {
  it.skip('#12 (stretch) with the embedder failing 100% of the time, suggest still returns lexical results within the latency budget', async () => {
    const app = await createTestApp({ embedder: { timeoutRate: 1 } });
    const typed = evalQueries()
      .filter((q) => q.kind !== 'paraphrase')
      .slice(0, 30);
    const latencies: number[] = [];
    let found = 0;
    for (const q of typed) {
      const started = performance.now();
      // Calls slower than 4x the budget are cut short and count as empty.
      const results = await Promise.race([app.suggest(q.userId, q.assetId, q.query), settle(4 * BUDGET_MS).then(() => [])]);
      latencies.push(performance.now() - started);
      expect(disallowed(app, q.userId, q.assetId, results)).toEqual([]);
      if (results.some((s) => s.claimId === q.targetClaimId)) found++;
    }
    expect(p95(latencies)).toBeLessThan(BUDGET_MS);
    expect(Math.max(...latencies)).toBeLessThan(3 * BUDGET_MS);
    expect(found / typed.length).toBeGreaterThanOrEqual(0.8);
  });

  it.skip('#13 (stretch) p95 of suggest over the eval set stays under 100 ms with the embedder at its default 80 ms latency', async () => {
    const app = await createTestApp(); // default embedder
    const queries = evalQueries();
    await runPool(queries.slice(0, 10), 4, (q) => app.suggest(q.userId, q.assetId, q.query)); // warm-up
    const latencies = await runPool(queries, 4, async (q) => {
      const started = performance.now();
      await app.suggest(q.userId, q.assetId, q.query);
      return performance.now() - started;
    });
    expect(p95(latencies)).toBeLessThan(BUDGET_MS);
  });

  it.skip('#14 (stretch) 300 claims approved in one batch become suggestible within 60 s, and p95 holds during the update', async () => {
    const app = await createTestApp(); // default embedder and store
    const { store, entitlements } = app.deps;

    // The biggest brand, and one of its assets.
    const brandSizes = new Map<string, number>();
    for (const c of store.listAll()) brandSizes.set(c.brandId, (brandSizes.get(c.brandId) ?? 0) + 1);
    const brandId = [...brandSizes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    const asset = assets((a) => a.brandId === brandId).sort((a, b) => eligibleClaims(app, b).length - eligibleClaims(app, a).length)[0]!;
    const user = userFor(asset);
    const brand = entitlements.getBrand(brandId)!;

    // What writers keep typing during the update.
    const load = eligibleClaims(app, asset)
      .slice(0, 40)
      .map((c) => queryFor(c).split(' ').slice(0, 5).join(' '));

    const syllables = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'ze', 'qu'];
    const word = (i: number) => 'xa' + [...String(i).padStart(3, '0')].map((d) => syllables[Number(d)]).join('') + 'ine';
    const drafts: ClaimDraft[] = Array.from({ length: 300 }, (_, i) => ({
      brandId,
      text: `${brand.name}® ${word(i)} reduced the risk of severe exacerbations by ${10 + (i % 40)}% vs placebo (MLR batch ${i + 1}).`,
      markets: [asset.market],
      channels: [asset.channel],
      expiresAt: new Date(app.clock.now() + 365 * 86_400_000).toISOString(),
      citations: [{ id: `CIT-B${i}`, ref: `Batch reference ${i + 1}.` }],
    }));

    const latencies: number[] = [];
    let approved: { id: string; text: string }[] = [];
    const traffic = runPool(
      Array.from({ length: 120 }, (_, i) => load[i % load.length]!),
      6,
      async (q, i) => {
        if (i === 12) approved = store.approveBatch(drafts).map((c) => ({ id: c.id, text: c.text }));
        const started = performance.now();
        await app.suggest(user.id, asset.id, q);
        latencies.push(performance.now() - started);
      },
    );
    await traffic;
    expect(approved).toHaveLength(300);
    expect(p95(latencies)).toBeLessThan(BUDGET_MS);

    app.clock.advance(60_000);
    await settle(300);
    app.deps.embedder.setOptions(HEALTHY_EMBEDDER);

    const missing: string[] = [];
    await runPool(approved, 8, async (c) => {
      const results = await app.suggest(user.id, asset.id, c.text);
      if (!results.some((s) => s.claimId === c.id)) missing.push(c.id);
    });
    expect(missing).toEqual([]);
  });
});
