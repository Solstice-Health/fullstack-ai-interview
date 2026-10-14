import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../server/routes';
import {
  assets,
  createTestApp,
  disallowed,
  eligibleClaims,
  evalQueries,
  HEALTHY_EMBEDDER,
  queryFor,
  stopAllApps,
  userFor,
  type TestApp,
} from '../helpers/app';
import type { Suggestion } from '../../shared/types';

afterEach(stopAllApps);

/** suggest() for an asset the user may not open must reject or return nothing. */
async function expectNothing(app: TestApp, userId: string, assetId: string, query: string, brandId?: string) {
  const outcome = await app.suggest(userId, assetId, query, { brandId }).then(
    (r) => ({ ok: true as const, results: r }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  if (outcome.ok) expect(outcome.results).toEqual([]);
}

describe('tenancy', () => {
  it.skip('#1 a query never returns a claim from another pharma client, even with a forged brandId; insertClaim refuses it with FORBIDDEN', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    const home = assets().find((a) => eligibleClaims(app, a).length >= 20)!;
    const user = userFor(home);
    expect(user.clientIds).toEqual([home.clientId]);

    // Claims of other clients, approved for the same market and channel as the user's asset.
    const foreignAssets = assets((a) => !user.clientIds.includes(a.clientId) && a.market === home.market && a.channel === home.channel);
    const foreign = foreignAssets.slice(0, 6).flatMap((a) => eligibleClaims(app, a).slice(0, 3).map((c) => ({ claim: c, asset: a })));
    expect(foreign.length).toBeGreaterThanOrEqual(10);

    for (const { claim, asset } of foreign) {
      // Writer on their own asset types another client's claim word for word and forges the brand.
      const results = await app.suggest(user.id, home.id, queryFor(claim), { brandId: claim.brandId });
      expect(results.map((s) => s.claimId)).not.toContain(claim.id);
      expect(disallowed(app, user.id, home.id, results)).toEqual([]);

      // Writer opens an asset of a client they are not entitled to.
      await expectNothing(app, user.id, asset.id, queryFor(claim), claim.brandId);

      expect(await app.insert(user.id, home.id, claim.id, claim.version)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await app.insert(user.id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'FORBIDDEN' });
    }

    // Unknown user or asset.
    const claim = foreign[0]!.claim;
    await expectNothing(app, 'u_nobody', home.id, queryFor(claim));
    await expectNothing(app, user.id, 'as_nope', queryFor(claim), claim.brandId);
    expect(await app.insert('u_nobody', home.id, claim.id, claim.version)).toEqual({ ok: false, error: 'FORBIDDEN' });

    // Over HTTP, with the brand forged in the query string.
    const server = buildServer({ deps: app.deps, service: app.service });
    for (const { claim: c, asset } of foreign.slice(0, 5)) {
      const own = await server.inject({
        method: 'GET',
        url: `/api/suggest?${new URLSearchParams({ q: queryFor(c), assetId: home.id, brandId: c.brandId })}`,
        headers: { 'x-user-id': user.id },
      });
      expect(own.statusCode).toBe(200);
      expect(disallowed(app, user.id, home.id, own.json<{ suggestions: Suggestion[] }>().suggestions)).toEqual([]);

      const other = await server.inject({
        method: 'GET',
        url: `/api/suggest?${new URLSearchParams({ q: queryFor(c), assetId: asset.id, brandId: c.brandId })}`,
        headers: { 'x-user-id': user.id },
      });
      if (other.statusCode === 200) expect(other.json<{ suggestions: Suggestion[] }>().suggestions).toEqual([]);
      else expect(other.statusCode).toBeGreaterThanOrEqual(400);
    }
    await server.close();

    // Across the whole eval set, nothing outside what the user may use.
    for (const q of evalQueries()) {
      expect(disallowed(app, q.userId, q.assetId, await app.suggest(q.userId, q.assetId, q.query))).toEqual([]);
    }
  });

  it.skip('#2 a claim not approved for the asset\'s market or channel is never returned; insertClaim refuses it with FORBIDDEN', async () => {
    const app = await createTestApp({ embedder: HEALTHY_EMBEDDER });
    let checked = 0;
    for (const asset of assets().filter((_, i) => i % 40 === 0)) {
      const user = userFor(asset);
      const wrongPlace = app.deps.store
        .listByBrand(asset.brandId)
        .filter(
          (c) =>
            c.status === 'approved' &&
            Date.parse(c.expiresAt) > app.clock.now() &&
            (!c.markets.includes(asset.market) || !c.channels.includes(asset.channel)),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 4);
      for (const claim of wrongPlace) {
        const results = await app.suggest(user.id, asset.id, queryFor(claim));
        expect(results.map((s) => s.claimId)).not.toContain(claim.id);
        expect(disallowed(app, user.id, asset.id, results)).toEqual([]);
        expect(await app.insert(user.id, asset.id, claim.id, claim.version)).toEqual({ ok: false, error: 'FORBIDDEN' });
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(80);
  });
});
