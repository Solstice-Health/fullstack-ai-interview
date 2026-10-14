import { afterEach, describe, expect, it } from 'vitest';
import { InvalidQueryError } from '../../server/errors';
import { buildServer } from '../../server/routes';
import {
  allClaims,
  assets,
  createTestApp,
  disallowed,
  eligibleClaims,
  evalQueries,
  HEALTHY_EMBEDDER,
  queryFor,
  shuffled,
  stopAllApps,
  userFor,
} from '../helpers/app';
import type { Asset, Claim } from '../../shared/types';

afterEach(stopAllApps);

const HOSTILE = ['%', '%%', '_', '__', '%_%', '(', ')', '()', '*', '.*', '"', "'", '\\', '[', ']', '?', '+', '^$', '|', '{}', '®', '%"(_*'];

describe('input handling and determinism', () => {
  it.skip('#7 empty or whitespace query returns [] without touching the store; queries over 200 chars are rejected; %, _, (, * and quotes don\'t crash or match everything', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    const asset = assets().find((a) => eligibleClaims(app, a).length >= 30)!;
    const user = userFor(asset);
    const { store, embedder } = app.deps;

    // Empty and whitespace-only.
    const reads = store.stats.reads;
    const calls = embedder.stats.calls + embedder.stats.batchCalls;
    for (const q of ['', ' ', '   ', '\t\n ']) expect(await app.suggest(user.id, asset.id, q)).toEqual([]);
    expect(store.stats.reads).toBe(reads);
    expect(embedder.stats.calls + embedder.stats.batchCalls).toBe(calls);

    // Length limit.
    await expect(app.suggest(user.id, asset.id, 'a'.repeat(201))).rejects.toBeInstanceOf(InvalidQueryError);
    await expect(app.suggest(user.id, asset.id, 'reduced the risk '.repeat(13))).rejects.toBeInstanceOf(InvalidQueryError);
    expect(Array.isArray(await app.suggest(user.id, asset.id, 'risk '.repeat(40)))).toBe(true); // exactly 200
    const server = buildServer({ deps: app.deps, service: app.service });
    const tooLong = await server.inject({
      method: 'GET',
      url: `/api/suggest?${new URLSearchParams({ q: 'x'.repeat(201), assetId: asset.id })}`,
      headers: { 'x-user-id': user.id },
    });
    expect(tooLong.statusCode).toBe(400);
    await server.close();

    // Special characters are plain text: no crash, and no "match everything".
    for (const q of HOSTILE) {
      const results = await app.suggest(user.id, asset.id, q);
      expect(disallowed(app, user.id, asset.id, results)).toEqual([]);
      for (const s of results) expect(s.text.toLowerCase(), `query ${JSON.stringify(q)}`).toContain(q.toLowerCase());
    }

    // Claims that contain those characters can still be found by typing them.
    const tricky = assets()
      .filter((_, i) => i % 9 === 0)
      .flatMap((a) => eligibleClaims(app, a).map((c) => ({ claim: c, asset: a })))
      .filter(({ claim }) => /[%_®"'(]/.test(queryFor(claim)))
      .slice(0, 25);
    expect(tricky.length).toBe(25);
    for (const { claim, asset: a } of tricky) {
      const results = await app.suggest(userFor(a).id, a.id, queryFor(claim));
      expect(results.map((s) => s.claimId)).toContain(claim.id);
    }
  });

  it.skip('#8 same query against the same claims returns the same order (deterministic tie-break)', async () => {
    const a = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    // Same claims, loaded in a different order.
    const b = await createTestApp({ embedder: HEALTHY_EMBEDDER, claims: shuffled(allClaims(), 99) });

    // Claims approved more than once with the same wording tie on any text score.
    const ties: { asset: Asset; text: string; ids: string[] }[] = [];
    for (const asset of assets()) {
      const byText = new Map<string, Claim[]>();
      for (const c of eligibleClaims(a, asset)) byText.set(c.text, [...(byText.get(c.text) ?? []), c]);
      for (const [text, group] of byText) {
        if (group.length > 1 && text.length <= 200) ties.push({ asset, text, ids: group.map((c) => c.id) });
      }
      if (ties.length >= 12) break;
    }
    expect(ties.length).toBeGreaterThanOrEqual(12);

    const cases = [
      ...ties.map((t) => ({ asset: t.asset, query: t.text, mustInclude: t.ids })),
      ...evalQueries()
        .slice(0, 40)
        .map((q) => ({ asset: assets().find((x) => x.id === q.assetId)!, query: q.query, mustInclude: [] as string[] })),
    ];
    for (const { asset, query, mustInclude } of cases) {
      const user = userFor(asset);
      const first = (await a.suggest(user.id, asset.id, query)).map((s) => s.claimId);
      const again = (await a.suggest(user.id, asset.id, query)).map((s) => s.claimId);
      const other = (await b.suggest(user.id, asset.id, query)).map((s) => s.claimId);
      expect(again, query).toEqual(first);
      expect(other, query).toEqual(first);
      for (const id of mustInclude) expect(first).toContain(id);
    }
  });
});
