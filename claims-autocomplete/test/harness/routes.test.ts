import { describe, expect, it } from 'vitest';
import { createDeps } from '../../server/app';
import { ForbiddenError, InvalidQueryError } from '../../server/errors';
import { buildServer } from '../../server/routes';
import type { SuggestRequest } from '../../server/suggestService';
import { FakeClock } from '../../shared/clock';
import type { InsertResult, Suggestion } from '../../shared/types';

describe('HTTP routes', () => {
  const deps = createDeps({ clock: new FakeClock() });
  const user = deps.entitlements.listUsers()[0]!;
  const asset = deps.entitlements.listAssetsForUser(user.id)[0]!;

  it('passes suggest requests through and maps errors', async () => {
    const seen: SuggestRequest[] = [];
    const reply: Suggestion[] = [{ claimId: 'clm_1', version: 1, text: 'x', score: 1, matchedBy: 'lexical' }];
    const server = buildServer({
      deps,
      service: {
        async suggest(req) {
          seen.push(req);
          if (req.query === 'long') throw new InvalidQueryError('too long');
          if (req.query === 'nope') throw new ForbiddenError();
          return reply;
        },
      },
    });
    const get = (q: string) =>
      server.inject({ method: 'GET', url: `/api/suggest?q=${q}&assetId=${asset.id}&brandId=br_009&k=3`, headers: { 'x-user-id': user.id } });

    const ok = await get('heart%20attack');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ suggestions: reply });
    expect(seen[0]).toEqual({ query: 'heart attack', userId: user.id, assetId: asset.id, k: 3, brandId: 'br_009' });
    expect((await get('long')).statusCode).toBe(400);
    expect((await get('nope')).statusCode).toBe(403);
    await server.close();
  });

  it('passes inserts through and maps results to status codes', async () => {
    const results: Record<string, InsertResult> = {
      a: { ok: false, error: 'FORBIDDEN' },
      b: { ok: false, error: 'REVOKED' },
    };
    const server = buildServer({
      deps,
      service: { suggest: async () => [] },
      insert: async (_d, _u, _a, claimId) => results[claimId]!,
    });
    const post = (claimId: string) =>
      server.inject({ method: 'POST', url: `/api/assets/${asset.id}/claims`, headers: { 'x-user-id': user.id }, payload: { claimId, version: 1 } });
    expect((await post('a')).statusCode).toBe(403);
    const revoked = await post('b');
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json()).toEqual({ ok: false, error: 'REVOKED' });
    await server.close();
  });

  it('serves assets only to entitled users', async () => {
    const server = buildServer({ deps, service: { suggest: async () => [] } });
    const other = deps.entitlements.listAssets().find((a) => !user.clientIds.includes(a.clientId))!;
    const mine = await server.inject({ method: 'GET', url: `/api/assets/${asset.id}`, headers: { 'x-user-id': user.id } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ asset: { id: asset.id }, content: [] });
    const theirs = await server.inject({ method: 'GET', url: `/api/assets/${other.id}`, headers: { 'x-user-id': user.id } });
    expect(theirs.statusCode).toBe(403);
    await server.close();
  });
});
