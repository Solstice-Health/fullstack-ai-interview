// Test harness: builds the app on a FakeClock and gives tests ground truth to check against.
import { loadClaims, loadEntitlements, loadEvalQueries } from '../../data/load';
import { createApp, type AppDeps } from '../../server/app';
import type { ClaimStoreOptions } from '../../server/claimStore';
import type { EmbedderOptions } from '../../server/fakeEmbedder';
import { insertClaim } from '../../server/insertClaim';
import type { SuggestService } from '../../server/suggestService';
import { FakeClock } from '../../shared/clock';
import { createRng } from '../../shared/random';
import type { Asset, Claim, InsertResult, Suggestion, User } from '../../shared/types';

/** Embedder that answers instantly and never fails. */
export const HEALTHY_EMBEDDER: EmbedderOptions = { latencyMs: 0, latencyJitter: 0, timeoutRate: 0 };

export interface TestAppOptions {
  store?: ClaimStoreOptions;
  embedder?: EmbedderOptions;
  claims?: readonly Claim[];
}

export interface TestApp {
  clock: FakeClock;
  deps: AppDeps;
  service: SuggestService;
  suggest(userId: string, assetId: string, query: string, opts?: { k?: number; brandId?: string }): Promise<Suggestion[]>;
  insert(userId: string, assetId: string, claimId: string, version: number): Promise<InsertResult>;
  stop(): void;
}

const running = new Set<TestApp>();

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const clock = new FakeClock();
  const { deps, service } = await createApp({ clock, store: options.store, embedder: options.embedder, claims: options.claims });
  const app: TestApp = {
    clock,
    deps,
    service,
    suggest: (userId, assetId, query, opts = {}) =>
      service.suggest({ query, userId, assetId, k: opts.k ?? 5, brandId: opts.brandId }),
    insert: (userId, assetId, claimId, version) => insertClaim(deps, userId, assetId, claimId, version),
    stop: () => {
      if (running.delete(app)) service.stop();
    },
  };
  running.add(app);
  return app;
}

/** Stops every app created by createTestApp (call from afterEach/afterAll). */
export function stopAllApps(): void {
  for (const app of [...running]) app.stop();
}

/** Lets pending async work (event delivery, promises, real timers) run. */
export function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Ground truth, computed straight from the data (never from the code under test)
// ---------------------------------------------------------------------------

export const entitlementsData = () => loadEntitlements();
export const evalQueries = () => loadEvalQueries();

/** May `userId` insert `claim` into `assetId` right now? */
export function isAllowed(app: TestApp, userId: string, assetId: string, claimId: string): boolean {
  const { entitlements, store, clock } = app.deps;
  const asset = entitlements.getAsset(assetId);
  const claim = store.get(claimId);
  if (!asset || !claim || !entitlements.canAccessAsset(userId, assetId)) return false;
  return (
    claim.brandId === asset.brandId &&
    claim.clientId === asset.clientId &&
    claim.markets.includes(asset.market) &&
    claim.channels.includes(asset.channel) &&
    claim.status === 'approved' &&
    Date.parse(claim.expiresAt) > clock.now()
  );
}

/** Ids of suggestions that the user may NOT use in this asset (should always be empty). */
export function disallowed(app: TestApp, userId: string, assetId: string, results: Suggestion[]): string[] {
  return results.filter((s) => !isAllowed(app, userId, assetId, s.claimId)).map((s) => s.claimId);
}

export function fitsAsset(claim: Claim, asset: Asset): boolean {
  return claim.brandId === asset.brandId && claim.markets.includes(asset.market) && claim.channels.includes(asset.channel);
}

/** Approved claims usable in the asset from now until at least `validForMs` from now. */
export function eligibleClaims(app: TestApp, asset: Asset, validForMs = 30 * 86_400_000): Claim[] {
  const until = app.clock.now() + validForMs;
  return app.deps.store
    .listByBrand(asset.brandId)
    .filter((c) => fitsAsset(c, asset) && c.status === 'approved' && Date.parse(c.expiresAt) > until)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** A query a writer could type to find this exact claim: its text, cut to at most 150 characters. */
export function queryFor(claim: Claim): string {
  if (claim.text.length <= 150) return claim.text;
  const cut = claim.text.slice(0, 150);
  return cut.slice(0, cut.lastIndexOf(' '));
}

/** A user entitled to the asset's client (prefers users with exactly one client). */
export function userFor(asset: Asset): User {
  const users = loadEntitlements().users.filter((u) => u.clientIds.includes(asset.clientId));
  return users.find((u) => u.clientIds.length === 1) ?? users[0]!;
}

/** An asset this claim could be inserted into, if there is one. */
export function assetFor(claim: Claim): Asset | undefined {
  return loadEntitlements().assets.find((a) => fitsAsset(claim, a));
}

/** Assets sorted by id, optionally filtered. */
export function assets(filter: (a: Asset) => boolean = () => true): Asset[] {
  return loadEntitlements().assets.filter(filter);
}

/** Deterministic shuffle. */
export function shuffled<T>(xs: readonly T[], seed = 1): T[] {
  const rng = createRng(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function allClaims(): readonly Claim[] {
  return loadClaims();
}

export function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

/** Runs `fn` over items with at most `concurrency` in flight. */
export async function runPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
