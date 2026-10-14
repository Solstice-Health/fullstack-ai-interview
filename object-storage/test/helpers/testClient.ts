/**
 * Client used by the shared tests. It calls the store the way a remote client
 * would over a real network: some responses never arrive, and connections drop.
 *
 * - `lostResponses`: per method, how many calls have their response lost. The
 *   store processes the request, then the caller gets `ResponseLostError`.
 *   The value the store returned is recorded in `client.lost`.
 *   Default: `{ completeMultipartUpload: 1 }`.
 * - `dropConnectionAfter(n)`: after `n` more calls succeed, the next call
 *   reaches the store but its response is lost, and every call after that fails
 *   with `ConnectionDroppedError` without reaching the store, until `reconnect()`.
 */
import type { ObjectStoreApi } from '../../src/objectStore';

type AsyncMethod = {
  [K in keyof ObjectStoreApi]: ObjectStoreApi[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof ObjectStoreApi];

export class ResponseLostError extends Error {
  constructor(readonly method: string) {
    super(`${method}: connection reset before the response arrived`);
    this.name = 'ResponseLostError';
  }
}

export class ConnectionDroppedError extends Error {
  constructor(readonly method: string) {
    super(`${method}: connection dropped`);
    this.name = 'ConnectionDroppedError';
  }
}

export interface TestClientOptions {
  lostResponses?: Partial<Record<AsyncMethod, number>>;
}

export class TestClient implements ObjectStoreApi {
  /** Responses that were lost: what the store returned or threw. */
  readonly lost: { method: AsyncMethod; result?: unknown; error?: unknown }[] = [];
  /** Calls that reached the store, per method. */
  readonly calls: Partial<Record<AsyncMethod, number>> = {};
  private readonly lostLeft: Partial<Record<AsyncMethod, number>>;
  private dropIn: number | null = null;
  private disconnected = false;

  constructor(
    readonly store: ObjectStoreApi,
    opts: TestClientOptions = {},
  ) {
    this.lostLeft = { ...(opts.lostResponses ?? { completeMultipartUpload: 1 }) };
  }

  dropConnectionAfter(n: number): void {
    this.dropIn = n;
  }

  reconnect(): void {
    this.disconnected = false;
    this.dropIn = null;
  }

  private async call<M extends AsyncMethod>(
    method: M,
    args: Parameters<ObjectStoreApi[M]>,
  ): Promise<Awaited<ReturnType<ObjectStoreApi[M]>>> {
    if (this.disconnected) throw new ConnectionDroppedError(method);
    let loseThis = false;
    if (this.dropIn !== null) {
      if (this.dropIn === 0) {
        loseThis = true;
        this.disconnected = true;
        this.dropIn = null;
      } else {
        this.dropIn -= 1;
      }
    }
    const left = this.lostLeft[method] ?? 0;
    if (left > 0) {
      this.lostLeft[method] = left - 1;
      loseThis = true;
    }
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    const fn = this.store[method] as (...a: unknown[]) => Promise<Awaited<ReturnType<ObjectStoreApi[M]>>>;
    if (!loseThis) return fn.apply(this.store, args as unknown[]);
    try {
      const result = await fn.apply(this.store, args as unknown[]);
      this.lost.push({ method, result });
    } catch (error) {
      this.lost.push({ method, error });
    }
    throw new ResponseLostError(method);
  }

  createBucket(...a: Parameters<ObjectStoreApi['createBucket']>) {
    return this.call('createBucket', a);
  }
  putObject(...a: Parameters<ObjectStoreApi['putObject']>) {
    return this.call('putObject', a);
  }
  getObject(...a: Parameters<ObjectStoreApi['getObject']>) {
    return this.call('getObject', a);
  }
  deleteObject(...a: Parameters<ObjectStoreApi['deleteObject']>) {
    return this.call('deleteObject', a);
  }
  listObjects(...a: Parameters<ObjectStoreApi['listObjects']>) {
    return this.call('listObjects', a);
  }
  createMultipartUpload(...a: Parameters<ObjectStoreApi['createMultipartUpload']>) {
    return this.call('createMultipartUpload', a);
  }
  uploadPart(...a: Parameters<ObjectStoreApi['uploadPart']>) {
    return this.call('uploadPart', a);
  }
  listParts(...a: Parameters<ObjectStoreApi['listParts']>) {
    return this.call('listParts', a);
  }
  completeMultipartUpload(...a: Parameters<ObjectStoreApi['completeMultipartUpload']>) {
    return this.call('completeMultipartUpload', a);
  }
  setRetention(...a: Parameters<ObjectStoreApi['setRetention']>) {
    return this.call('setRetention', a);
  }
  presignPartUrl(...a: Parameters<ObjectStoreApi['presignPartUrl']>): string {
    if (this.disconnected) throw new ConnectionDroppedError('presignPartUrl');
    return this.store.presignPartUrl(...a);
  }
  uploadPartWithUrl(...a: Parameters<ObjectStoreApi['uploadPartWithUrl']>) {
    return this.call('uploadPartWithUrl', a);
  }
  runRepair() {
    return this.call('runRepair', []);
  }
  runGarbageCollection() {
    return this.call('runGarbageCollection', []);
  }
  processEvents() {
    return this.call('processEvents', []);
  }
}

/** Calls `fn` until it does not fail with a network error (at most `attempts` times). */
export async function retrying<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const network = err instanceof ResponseLostError || err instanceof ConnectionDroppedError;
      if (!network || i >= attempts) throw err;
    }
  }
}
