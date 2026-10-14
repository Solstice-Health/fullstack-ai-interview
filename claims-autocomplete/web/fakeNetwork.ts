import type { Suggestion } from '../shared/types';
import type { ClaimsApi } from './api';

/**
 * In-memory stand-in for the network between the web app and /api/suggest.
 * Lets tests (and the dev "chaos" mode) control when each response arrives.
 *
 * Each suggest() call creates a FakeRequest. The request stays pending until
 * `respond()` or `fail()` is called (manual mode) or a random delay passes
 * (auto mode). Responding means the server has sent the response: it reaches
 * the caller after `delayMs`. If the caller aborts before the server responds,
 * the call rejects with an AbortError. A response that has already been sent is
 * delivered even if the request is aborted afterwards.
 *
 * Delays use the global setTimeout, so vi.useFakeTimers() controls them.
 */
export interface FakeRequest {
  readonly id: number;
  readonly query: string;
  readonly assetId: string;
  readonly brandId?: string;
  readonly signal?: AbortSignal;
  /** True once the caller's signal has aborted. */
  readonly aborted: boolean;
  /** True once respond() or fail() was called, or the request was aborted before that. */
  readonly settled: boolean;
  /** Sends a response (defaults to the responder's output) that arrives after `delayMs`. */
  respond(suggestions?: Suggestion[], opts?: { delayMs?: number }): void;
  /** Sends an error that arrives after `delayMs`. */
  fail(error?: Error, opts?: { delayMs?: number }): void;
}

export interface FakeNetworkOptions {
  /** Produces the response for a query. Default: two made-up suggestions that echo the query. */
  responder?: (query: string, assetId: string) => Suggestion[];
  /** 'manual' (default): the test calls respond()/fail(). 'auto': respond after a random delay. */
  mode?: 'manual' | 'auto';
  /** Auto mode delay range in ms. */
  delayMs?: [number, number];
  /** Optional real API to answer non-suggest calls (dev chaos mode). */
  fallback?: ClaimsApi;
}

export interface FakeNetwork {
  api: ClaimsApi;
  /** Every request so far, oldest first. */
  requests: FakeRequest[];
  /** Requests not yet responded to, failed or aborted. */
  pending(): FakeRequest[];
  /** The most recent request. */
  last(): FakeRequest | undefined;
}

export function echoSuggestions(query: string): Suggestion[] {
  return [
    { claimId: `echo:${query}:1`, version: 1, text: `Result 1 for "${query}"`, score: 2, matchedBy: 'lexical' },
    { claimId: `echo:${query}:2`, version: 1, text: `Result 2 for "${query}"`, score: 1, matchedBy: 'lexical' },
  ];
}

export function createFakeNetwork(options: FakeNetworkOptions = {}): FakeNetwork {
  const responder = options.responder ?? echoSuggestions;
  const mode = options.mode ?? 'manual';
  const [minDelay, maxDelay] = options.delayMs ?? [20, 400];
  const requests: FakeRequest[] = [];

  const fb = options.fallback;
  const unsupported = (name: string): Promise<never> =>
    Promise.reject(new Error(`${name} is not supported by the fake network`));

  const api: ClaimsApi = {
    suggest({ query, assetId, brandId }, opts) {
      return new Promise<Suggestion[]>((resolve, reject) => {
        const signal = opts?.signal;
        let sent = false;
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        const send = (fn: () => void, delayMs = 0) => {
          if (sent || settled) return;
          sent = true;
          setTimeout(() => settle(fn), delayMs);
        };
        const req: FakeRequest = {
          id: requests.length + 1,
          query,
          assetId,
          brandId,
          signal,
          get aborted() {
            return !!signal?.aborted;
          },
          get settled() {
            return sent || settled;
          },
          respond(suggestions, o) {
            const body = suggestions ?? responder(query, assetId);
            send(() => resolve(body), o?.delayMs);
          },
          fail(error, o) {
            send(() => reject(error ?? new Error('network error')), o?.delayMs);
          },
        };
        requests.push(req);
        const abort = () => {
          if (!sent) settle(() => reject(abortError()));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        if (mode === 'auto') req.respond(undefined, { delayMs: minDelay + Math.random() * (maxDelay - minDelay) });
      });
    },
    insertClaim: (...a) => (fb ? fb.insertClaim(...a) : unsupported('insertClaim')),
    listAssets: () => (fb ? fb.listAssets() : unsupported('listAssets')),
    getAsset: (id) => (fb ? fb.getAsset(id) : unsupported('getAsset')),
    addText: (id, text) => (fb ? fb.addText(id, text) : unsupported('addText')),
    revokeClaim: (id) => (fb ? fb.revokeClaim(id) : unsupported('revokeClaim')),
  };

  return {
    api,
    requests,
    pending: () => requests.filter((r) => !r.settled),
    last: () => requests[requests.length - 1],
  };
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}
