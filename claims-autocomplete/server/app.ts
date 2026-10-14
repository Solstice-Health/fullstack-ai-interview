import { loadClaims, loadEntitlements } from '../data/load';
import { systemClock, type Clock } from '../shared/clock';
import type { Claim } from '../shared/types';
import { AssetStore } from './assetStore';
import { ClaimStore, type ClaimStoreOptions } from './claimStore';
import { Entitlements, type EntitlementsData } from './entitlements';
import { FakeEmbedder, type Embedder, type EmbedderOptions } from './fakeEmbedder';
import { SuggestService } from './suggestService';

/** Everything the suggest and insert code may use. */
export interface AppDeps {
  clock: Clock;
  store: ClaimStore;
  embedder: Embedder;
  entitlements: Entitlements;
  assets: AssetStore;
}

export interface AppOptions {
  clock?: Clock;
  store?: ClaimStoreOptions;
  embedder?: EmbedderOptions;
  /** Use this embedder instead of a FakeEmbedder (the dev server passes OpenRouterEmbedder here). */
  embedderInstance?: Embedder;
  /** Defaults to data/claims.json. */
  claims?: readonly Claim[];
  /** Defaults to data/entitlements.json. */
  entitlements?: EntitlementsData;
}

export function createDeps(options: AppOptions = {}): AppDeps {
  const clock = options.clock ?? systemClock;
  return {
    clock,
    store: new ClaimStore(options.claims ?? loadClaims(), clock, options.store),
    embedder: options.embedderInstance ?? new FakeEmbedder(options.embedder),
    entitlements: new Entitlements(options.entitlements ?? loadEntitlements()),
    assets: new AssetStore(),
  };
}

/** Builds the dependencies and a started SuggestService. */
export async function createApp(options: AppOptions = {}): Promise<{ deps: AppDeps; service: SuggestService }> {
  const deps = createDeps(options);
  const service = new SuggestService(deps);
  await service.start();
  return { deps, service };
}
