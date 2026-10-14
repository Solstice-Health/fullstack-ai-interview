import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, evalQueries, HEALTHY_EMBEDDER, runPool, stopAllApps } from '../helpers/app';

afterEach(stopAllApps);

describe('retrieval quality', () => {
  it.skip('#15 (stretch) recall@5 ≥ 0.80 on eval_queries.json', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    const queries = evalQueries();
    const hits = await runPool(queries, 8, async (q) => {
      const results = await app.suggest(q.userId, q.assetId, q.query, { k: 5 });
      return results.some((s) => s.claimId === q.targetClaimId);
    });
    const byKind = new Map<string, { hit: number; total: number }>();
    queries.forEach((q, i) => {
      const k = byKind.get(q.kind) ?? { hit: 0, total: 0 };
      k.total++;
      if (hits[i]) k.hit++;
      byKind.set(q.kind, k);
    });
    const recall = hits.filter(Boolean).length / queries.length;
    console.log(
      `recall@5 = ${recall.toFixed(3)} (` +
        [...byKind].map(([kind, k]) => `${kind} ${(k.hit / k.total).toFixed(2)}`).join(', ') +
        ')',
    );
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });
});
