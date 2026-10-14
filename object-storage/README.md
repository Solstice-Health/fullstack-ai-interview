# Versioned object storage (S3-style)

Build the core of a small S3: versioned objects in per-tenant buckets, multipart uploads, durable placement across availability zones, and a resumable browser uploader.

Everything runs in one Node process against a simulated cluster, so tests are fast and repeatable and can inject failures. The simulator, the metadata database, the test client and the uploader UI shell are done. You write the core.

## Commands

```bash
npm install
npm test            # all tests (shared checks start skipped)
npm run test:watch  # re-run on save
npm run typecheck
npm run dev         # uploader UI at http://localhost:5173, against an in-browser fake server
```

Requires Node 22 or newer.

## What you implement

| File | What |
| --- | --- |
| `src/objectStore.ts` | `class ObjectStore implements ObjectStoreApi`. The interface and its contract are in the same file. |
| `web/src/useResumableUpload.ts` | `useResumableUpload(file, api, options)`: a React hook that uploads a file as a multipart upload. |

You may add files, tables, helpers and background logic as you see fit. Don't change `sim/`, `shared/` or `test/helpers/`.

```ts
interface ObjectStoreApi {
  createBucket(ctx, bucket): Promise<void>;
  putObject(ctx, bucket, key, bytes): Promise<{ versionId }>;
  getObject(ctx, bucket, key, opts?: { versionId? }): Promise<Uint8Array>;
  deleteObject(ctx, bucket, key, opts?: { versionId? }): Promise<{ deleteMarker }>;
  listObjects(ctx, bucket, prefix, opts: { cursor?, limit }): Promise<{ keys, nextCursor? }>;

  createMultipartUpload(ctx, bucket, key): Promise<{ uploadId }>;
  uploadPart(uploadId, partNumber, bytes, crc32c): Promise<{ etag }>;
  listParts(uploadId): Promise<{ partNumber, etag, size }[]>;
  completeMultipartUpload(uploadId, parts: { partNumber, etag }[]): Promise<{ versionId }>;

  setRetention(ctx, bucket, key, versionId, until: Date): Promise<void>;
  presignPartUrl(uploadId, partNumber, expiresInSec): string;
  uploadPartWithUrl(url, bytes, crc32c): Promise<{ etag }>;
  runRepair(): Promise<{ chunksRepaired }>;
  runGarbageCollection(): Promise<{ chunksDeleted, uploadsAborted }>;
  processEvents(): Promise<{ processed }>;
}
// Ctx = { tenantId, userId, role: 'member' | 'admin' }
// Errors: throw StoreError with a code (src/errors.ts).
```

The constructor gets a `StoreEnv` (`sim/env.ts`): everything the server process may use.

| `env.` | What |
| --- | --- |
| `cluster` | 9 storage nodes in 3 AZs (`az1-n1` … `az3-n3`). `putChunk`, `getChunk`, `deleteChunk`, `listChunks` per node. Nodes store opaque chunks by id; they know nothing about objects. |
| `db` | In-memory SQL database standing in for Postgres (SQLite syntax, via sql.js). `exec`, `run`, `get`, `all`, and `transaction(fn)` with a synchronous callback. |
| `clock` | Fake clock. Use it for every timestamp. |
| `queue` | Message queue with at-least-once delivery: `publish`, `receive`, `ack`. |
| `mediaProcessor` | Post-upload processing (thumbnails, text extraction, search indexing) for one version. |
| `secret` | Server-side secret, e.g. for signing URLs. |

## What's provided

| Path | Contents |
| --- | --- |
| `sim/cluster.ts` | The simulated cluster. Tests can kill, restart, partition or replace a node, kill a whole AZ, slow nodes down, and flip bits in stored chunks. Options are documented in the file. |
| `sim/metadataDb.ts` | The SQL database. |
| `sim/crash.ts` | Process crashes. Every cluster write, database write and queue publish from the server is a step; a test can kill the process just before any step, then restart it with `sim.restartProcess()` over the same cluster, database and queue. |
| `sim/queue.ts`, `sim/mediaProcessor.ts` | The queue and the processor. |
| `sim/env.ts` | `Simulation`: wires it all together and hands out the `StoreEnv`. |
| `shared/clock.ts` | Fake clock. |
| `shared/checksum.ts` | CRC32C and SHA-256 (pure TypeScript, Node and browser). |
| `test/helpers/` | `setup()`, the test client, byte helpers. The shared checks call the store through the test client, which behaves like a remote client on a real network (see the file). |
| `test/fixtures/keys.ts` | Keys that real clients send. |
| `test/harness/` | Tests for the simulator itself. These pass from the start. |
| `test/shared/` | The shared checks below, skipped. |
| `web/` | Uploader UI (`App.tsx`), an in-browser fake upload server and a fake network that drops connections. |

A process restart builds a new `ObjectStore` over the same `env.db`, `env.cluster` and `env.queue`. The constructor must cope with tables that already exist.

## Shared checks

Turn a check on by changing `it.skip(` to `it(`. Each check tests an outcome, not an implementation.

| # | Check | File |
| --- | --- | --- |
| 1 | Read-after-write | `basics.test.ts` |
| 2 | Versioning | `basics.test.ts` |
| 3 | Multipart | `multipart.test.ts` |
| 4 | Resume | `multipart.test.ts` |
| 5 | Idempotent complete | `multipart.test.ts` |
| 6 | Atomic visibility | `durability.test.ts` |
| 7 | AZ loss | `durability.test.ts` |
| 8 | LIST pagination | `list.test.ts` |
| 9 | LIST prefix | `list.test.ts` |
| 10 | Tenancy | `tenancy.test.ts` |
| 11 | Concurrent writes | `concurrency.test.ts` |
| 12 (stretch) | Corruption | `repair.test.ts` |
| 13 (stretch) | Repair | `repair.test.ts` |
| 14 (stretch) | Retention | `retention.test.ts` |
| 15 (stretch) | GC safety | `retention.test.ts` |
| 16 (stretch) | Presigned URLs | `presign.test.ts` |
| 17 (stretch) | Processing events | `events.test.ts` |
| 18 (stretch) | Uploader UI | `uploader.test.tsx` |

Start with 1 to 11. Run one file with `npx vitest run test/shared/basics.test.ts`, or one check with `npx vitest run -t "#5"`.
