import { expect } from 'vitest';
import { StoreError, type StoreErrorCode } from '../../src/errors';
import { ObjectStore } from '../../src/objectStore';
import type { Ctx } from '../../src/types';
import { crc32cHex } from '../../shared/checksum';
import { Simulation, type SimulationOptions } from '../../sim/env';
import { TestClient, retrying, type TestClientOptions } from './testClient';

export const alice: Ctx = { tenantId: 'acme', userId: 'alice', role: 'member' };
export const acmeAdmin: Ctx = { tenantId: 'acme', userId: 'root', role: 'admin' };
export const bob: Ctx = { tenantId: 'globex', userId: 'bob', role: 'member' };
export const globexAdmin: Ctx = { tenantId: 'globex', userId: 'groot', role: 'admin' };

export const BUCKET = 'acme-assets';

export interface Setup {
  sim: Simulation;
  store: ObjectStore;
  client: TestClient;
}

/** A fresh simulation, a store, a test client and the bucket `acme-assets` owned by alice's tenant. */
export async function setup(opts: { sim?: SimulationOptions; client?: TestClientOptions } = {}): Promise<Setup> {
  const sim = await Simulation.create(opts.sim);
  const store = new ObjectStore(sim.env());
  const client = new TestClient(store, opts.client);
  await client.createBucket(alice, BUCKET);
  return { sim, store, client };
}

/** Simulates a server process restart: a new store over the same cluster, database and queue. */
export function restart(s: Setup, opts?: TestClientOptions): Setup {
  const store = new ObjectStore(s.sim.restartProcess());
  return { sim: s.sim, store, client: new TestClient(store, opts) };
}

/** Deterministic pseudo-random bytes. */
export function bytes(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

export const text = (s: string) => new TextEncoder().encode(s);

export const KiB = 1024;
export const MiB = 1024 * 1024;

/** Expects `p` to reject with a StoreError whose code is one of `codes`. */
export async function expectStoreError(p: Promise<unknown>, ...codes: StoreErrorCode[]): Promise<StoreError> {
  let error: unknown;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  expect(error, `expected a StoreError (${codes.join(' or ')}) but the call succeeded`).toBeDefined();
  expect(error).toBeInstanceOf(StoreError);
  expect(codes).toContain((error as StoreError).code);
  return error as StoreError;
}

/** Splits `data` into parts of `partSize` bytes (the last may be shorter). */
export function splitParts(data: Uint8Array, partSize: number): { partNumber: number; bytes: Uint8Array }[] {
  const parts: { partNumber: number; bytes: Uint8Array }[] = [];
  const count = Math.max(1, Math.ceil(data.length / partSize));
  for (let i = 0; i < count; i++) {
    parts.push({ partNumber: i + 1, bytes: data.slice(i * partSize, (i + 1) * partSize) });
  }
  return parts;
}

/** Uploads `data` with a multipart upload: parts in reverse order, `concurrency` at a time; completes with retries. */
export async function multipartUpload(
  client: TestClient,
  ctx: Ctx,
  bucket: string,
  key: string,
  data: Uint8Array,
  partSize: number,
  concurrency = 4,
): Promise<{ versionId: string; uploadId: string }> {
  const { uploadId } = await client.createMultipartUpload(ctx, bucket, key);
  const parts = splitParts(data, partSize);
  const queue = [...parts].reverse();
  const etags = new Map<number, string>();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const { etag } = await client.uploadPart(uploadId, p.partNumber, p.bytes, crc32cHex(p.bytes));
        etags.set(p.partNumber, etag);
      }
    }),
  );
  const list = parts.map((p) => ({ partNumber: p.partNumber, etag: etags.get(p.partNumber)! }));
  const { versionId } = await retrying(() => client.completeMultipartUpload(uploadId, list));
  return { versionId, uploadId };
}

/** Reads every page of a listing. */
export async function listAll(client: TestClient, ctx: Ctx, bucket: string, prefix: string, limit = 1000): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page++) {
    const res = await client.listObjects(ctx, bucket, prefix, { cursor, limit });
    keys.push(...res.keys);
    if (!res.nextCursor) return keys;
    cursor = res.nextCursor;
  }
  throw new Error('listing did not terminate');
}

/** Sorts keys by their UTF-8 bytes. */
export function byUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** True if a read of `key` fails with NotFound. Other errors are rethrown. */
export async function isNotFound(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    if (e instanceof StoreError && e.code === 'NotFound') return true;
    throw e;
  }
}

export { retrying, crc32cHex };

/** Fails with the first differing offset if `actual` is not byte-identical to `expected`. */
export function expectBytes(actual: Uint8Array, expected: Uint8Array, label = 'bytes'): void {
  expect(actual, `${label}: expected a Uint8Array`).toBeInstanceOf(Uint8Array);
  if (actual.length === expected.length && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0) return;
  let i = 0;
  while (i < Math.min(actual.length, expected.length) && actual[i] === expected[i]) i++;
  expect.fail(
    `${label}: got ${actual.length} bytes, expected ${expected.length}; first difference at offset ${i}`,
  );
}

/** Deterministic shuffle. */
export function shuffled<T>(items: readonly T[], seed = 42): T[] {
  const out = [...items];
  let x = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Runs `fn` over `items`, `concurrency` at a time. */
export async function inParallel<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}
