import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { Asset, AssetNode, Brand, InsertResult, Suggestion } from '../shared/types';
import type { SampleQuery } from '../server/devSamples';

export type { SampleQuery };

export interface AssetSummary extends Asset {
  brandName: string;
}

export interface AssetView {
  asset: Asset;
  brand: Brand;
  content: AssetNode[];
}

/** Everything the web app asks the server for. */
export interface ClaimsApi {
  /** GET /api/suggest. Rejects with ApiError on a non-2xx response, or with an AbortError if `signal` aborts first. */
  suggest(params: { query: string; assetId: string; brandId?: string }, opts?: { signal?: AbortSignal }): Promise<Suggestion[]>;
  insertClaim(assetId: string, claimId: string, version: number): Promise<InsertResult>;
  listAssets(): Promise<AssetSummary[]>;
  getAsset(assetId: string): Promise<AssetView>;
  addText(assetId: string, text: string): Promise<void>;
  /** Dev only: revokes a claim so you can watch what happens. */
  revokeClaim(claimId: string): Promise<void>;
  /** Dev only: example queries for an asset, with the claim each one is meant to find. */
  samples?(assetId: string): Promise<SampleQuery[]>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** ClaimsApi over HTTP, as user `userId`. */
export function httpClaimsApi(userId: string, baseUrl = ''): ClaimsApi {
  const call = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal, okStatuses: number[] = []): Promise<T> => {
    const res = await fetch(baseUrl + path, {
      method,
      signal,
      headers: { 'x-user-id': userId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok && !okStatuses.includes(res.status)) throw new ApiError(res.status, data.error ?? res.statusText);
    return data;
  };
  return {
    async suggest({ query, assetId, brandId }, opts) {
      const qs = new URLSearchParams({ q: query, assetId, ...(brandId ? { brandId } : {}) });
      const data = await call<{ suggestions: Suggestion[] }>('GET', `/api/suggest?${qs}`, undefined, opts?.signal);
      return data.suggestions;
    },
    insertClaim: (assetId, claimId, version) =>
      call<InsertResult>('POST', `/api/assets/${encodeURIComponent(assetId)}/claims`, { claimId, version }, undefined, [403, 409]),
    listAssets: () => call<AssetSummary[]>('GET', '/api/assets'),
    getAsset: (assetId) => call<AssetView>('GET', `/api/assets/${encodeURIComponent(assetId)}`),
    addText: async (assetId, text) => {
      await call('POST', `/api/assets/${encodeURIComponent(assetId)}/text`, { text });
    },
    revokeClaim: async (claimId) => {
      await call('POST', `/api/dev/claims/${encodeURIComponent(claimId)}/revoke`, {});
    },
    samples: (assetId) => call<SampleQuery[]>('GET', `/api/dev/samples?${new URLSearchParams({ assetId })}`),
  };
}

const ClaimsApiContext = createContext<ClaimsApi | null>(null);

export function ClaimsApiProvider({ api, children }: { api: ClaimsApi; children?: ReactNode }) {
  return createElement(ClaimsApiContext.Provider, { value: api }, children);
}

/** The ClaimsApi from the nearest ClaimsApiProvider. */
export function useClaimsApi(): ClaimsApi {
  const api = useContext(ClaimsApiContext);
  if (!api) throw new Error('useClaimsApi must be used inside <ClaimsApiProvider>');
  return api;
}
