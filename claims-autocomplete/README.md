# Approved-claims autocomplete

As a writer types promotional copy, suggest approved claims they can insert. When they pick one, insert its exact approved text and citations into the asset.

The harness, fakes, data and UI shell are done. You write the core: the suggest service, the insert check and the React hook. The tests check outcomes, not how you got there.

## Commands

```bash
npm install          # also generates data/claims.json (about 1 s)
npm test             # all tests (shared checks start skipped)
npm run typecheck
npm run dev          # API on :3000 (API_PORT to change) and web app on http://localhost:5173
npm run eval         # runs data/eval_queries.json through your SuggestService
npm run data         # regenerates the data (deterministic)
```

Run one file or one check while you work:

```bash
npx vitest run test/shared/tenancy.test.ts
npx vitest -t "#3"
```

## What you implement

| File | What |
| --- | --- |
| `server/suggestService.ts` | `SuggestService`: `start()`, `stop()` and `suggest(req)` |
| `server/insertClaim.ts` | `insertClaim(deps, userId, assetId, claimId, version)` |
| `web/useClaimSuggestions.ts` | `useClaimSuggestions(query, assetId)` React hook |
| `scripts/eval.ts` (optional) | `report(rows)`: recall@5 and MRR on the eval set |

Each stub has a doc comment with the full contract. In short:

```ts
// server
class SuggestService {
  constructor(deps: AppDeps);            // { clock, store, embedder, entitlements, assets }
  start(): Promise<void>;                // awaited once before the first suggest()
  stop(): void;
  suggest(req: { query: string; userId: string; assetId: string; k: number; brandId?: string }): Promise<Suggestion[]>;
}
interface Suggestion {
  claimId: string;
  version: number;
  text: string;
  score: number;
  matchedBy: 'lexical' | 'semantic' | 'both';
}
insertClaim(deps: AppDeps, userId: string, assetId: string, claimId: string, version: number):
  Promise<{ ok: true; node: ClaimNode } | { ok: false; error: 'REVOKED' | 'EXPIRED' | 'FORBIDDEN' | 'STALE_VERSION' }>;

// web
function useClaimSuggestions(query: string, assetId: string): {
  suggestions: Suggestion[];
  status: 'idle' | 'loading' | 'ready' | 'error';
};
```

You may add files, classes and helpers anywhere. Keep these signatures, because the routes and tests call them.

## What is provided

| Path | Contents |
| --- | --- |
| `data/claims.json` | 50,000 synthetic claims across 200 brands and 4 pharma clients (generated, not committed) |
| `data/entitlements.json` | Clients, brands, users (which clients they work for) and assets (brand, market, channel) |
| `data/eval_queries.json` | 300 typed fragments, each labelled with the claim the writer meant |
| `data/generate.ts`, `data/concepts.ts` | Seeded generator and the medical vocabulary it uses |
| `data/load.ts` | `loadClaims()`, `loadEntitlements()`, `loadEvalQueries()` |
| `shared/types.ts` | `Claim`, `Suggestion`, `ClaimNode`, `InsertResult`, `Asset`, `User`, ... |
| `shared/clock.ts` | `Clock` interface, `systemClock` and `FakeClock` |
| `server/claimStore.ts` | `ClaimStore`: in-memory source of truth for claims, with a change event stream |
| `server/fakeEmbedder.ts` | `FakeEmbedder`: stand-in for a hosted embedding API, plus `cosine()` |
| `server/entitlements.ts` | `Entitlements`: users to clients, assets to brand, market and channel |
| `server/assetStore.ts` | `AssetStore`: content of each asset; inserted claims go here |
| `server/errors.ts` | `InvalidQueryError` (HTTP 400), `ForbiddenError` (HTTP 403) |
| `server/app.ts` | `createDeps()` and `createApp()`: wires everything together |
| `server/routes.ts` | Fastify routes: `GET /api/suggest`, `POST /api/assets/:id/claims` and a few for the UI |
| `web/` | React editor: asset picker, content with locked claim nodes, composer, suggestions dropdown |
| `web/api.ts` | `ClaimsApi` (HTTP client), `ClaimsApiProvider`, `useClaimsApi()` |
| `web/fakeNetwork.ts` | Fake `ClaimsApi` for tests: you control when each response arrives |
| `test/helpers/app.ts` | `createTestApp()` (FakeClock plus your service) and ground-truth helpers |
| `test/harness/` | Tests for the provided pieces. They pass already. |
| `test/shared/` | The shared checks below, skipped. |

### The fakes in one minute

**ClaimStore** (`deps.store`). `get(id)`, `getMany(ids)`, `listByBrand(brandId)`, `listAll()` are synchronous and always current. Claims are frozen objects; a change replaces the object. `revoke(id)` and `approveBatch(drafts)` write, and every change bumps the claim's `version`. `onChange(listener)` delivers `ClaimChangeEvent`s (`seq`, `type`, `claimId`, `brandId`, `version`, `at`) asynchronously, like an outbox relay. Expiry is not a change: when `expiresAt` passes, nothing is emitted. `stats` counts reads and writes.

**FakeEmbedder** (`deps.embedder`). `embed(text, { signal })` for one text, `embedBatch(texts)` for many in one round trip. Both return unit `Float32Array` vectors; compare with `cosine(a, b)`. Texts that mean the same thing ("heart attack", "myocardial infarction") get similar vectors. Calls take real time, like a network call, and are not driven by the FakeClock. `stats` counts calls.

**Entitlements** (`deps.entitlements`). `getAsset`, `getUser`, `getBrand`, `canAccessAsset(userId, assetId)`, `listAssetsForUser(userId)`.

**FakeClock** (tests). `now()`, `setTimeout`, `setInterval`, `clearTimer` and `advance(ms)`. Timers scheduled on `deps.clock` fire when a test advances it. Use `deps.clock` for anything time-based in the server.

**Fake network** (web tests). `createFakeNetwork()` returns `{ api, requests, pending(), last() }`. Each `suggest` call becomes a request the test answers with `respond(suggestions?, { delayMs })` or `fail(error?, { delayMs })`.

All fakes accept options (see each file). The tests use them to set up scenarios. Treat the fakes as the remote services they stand in for: use their public methods, not their internals.

## Shared checks

Un-skip a check by changing `it.skip(` to `it(` in `test/shared/`. Don't change anything else in those files. Required checks first, then stretch.

| # | Check | File |
| --- | --- | --- |
| 1 | A query never returns a claim from another pharma client, even with a forged brandId; insertClaim refuses it with FORBIDDEN | `tenancy.test.ts` |
| 2 | A claim not approved for the asset's market or channel is never returned; insertClaim refuses it with FORBIDDEN | `tenancy.test.ts` |
| 3 | After revoke(id) and the clock advances 60 s, the claim never appears in results | `freshness.test.ts` |
| 4 | insertClaim on a revoked claim returns REVOKED, even when the revoke event was dropped and the index is stale | `freshness.test.ts` |
| 5 | A claim past its expiresAt is never suggested or insertable, though no event fired | `freshness.test.ts` |
| 6 | Inserting an outdated version returns STALE_VERSION | `freshness.test.ts` |
| 7 | Empty or whitespace query returns [] without touching the store; queries over 200 chars are rejected; %, _, (, * and quotes don't crash or match everything | `input.test.ts` |
| 8 | Same query against the same claims returns the same order (deterministic tie-break) | `input.test.ts` |
| 9 | Responses for "car", "card" and "cardi" arrive in reverse; the UI only ever shows results for "cardi" | `frontend.test.ts` |
| 10 | 10 keystrokes within 200 ms produce at most 2 requests, and superseded requests are aborted | `frontend.test.ts` |
| 11 | Clearing the input clears suggestions; a failed request shows a non-blocking error state | `frontend.test.ts` |
| 12 | (stretch) With the embedder failing 100% of the time, suggest still returns lexical results within the latency budget | `performance.test.ts` |
| 13 | (stretch) p95 of suggest over the eval set stays under 100 ms with the embedder at its default 80 ms latency | `performance.test.ts` |
| 14 | (stretch) 300 claims approved in one batch become suggestible within 60 s, and p95 holds during the update | `performance.test.ts` |
| 15 | (stretch) recall@5 ≥ 0.80 on eval_queries.json | `quality.test.ts` |

Add your own tests anywhere under `test/` (files ending in `.test.ts` or `.test.tsx`). Web tests need `// @vitest-environment jsdom` as their first line.

## Running the app

`npm run dev`, then open http://localhost:5173. The page opens on a writer and asset that have example queries, with the first example already typed in the composer.

- **Try chips** under the composer fill in example queries for the current asset, including paraphrases. Hover one to see the claim it is meant to find.
- **Raw API response** calls `GET /api/suggest` with the composer text and shows the JSON and timing. It works before `useClaimSuggestions` is implemented, so you can test the server on its own.
- Each suggestion has a "revoke (dev)" button so you can watch what happens after a revocation.
- The URL keeps the writer and asset (`?user=u_007&asset=as_0210`), so you can reload or share it. Add `&chaos=1` to deliver suggest responses late and out of order.

Until your code is in, the API answers suggest and insert with HTTP 500 and the editor shows the "Not implemented" error.

## Run with Docker

From the repo root:

```bash
docker compose up claims-autocomplete
```

Then open http://localhost:5173. The API is on http://localhost:3000.

## Real AI (optional)

By default the dev server uses `FakeEmbedder`. To use real embeddings from OpenRouter, copy `.env.example` (repo root) to `.env` and set `OPENROUTER_API_KEY`. Running `npm run dev` without Docker, export it in your shell instead. `OPENROUTER_EMBEDDING_MODEL` picks the model (default `openai/text-embedding-3-small`).

The server logs which embedder is active. Your code doesn't change: `deps.embedder` has the same methods either way. Real vectors have 1536 dimensions, and a real call takes a few hundred ms, much longer than the fake's 80 ms.

The first start embeds all claims (about 2 minutes) and caches the vectors in `data/.cache/`, so later starts are fast. Tests always use the fakes.
