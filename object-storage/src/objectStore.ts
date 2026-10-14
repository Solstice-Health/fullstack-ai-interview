import type { StoreEnv } from '../sim/env';
import type { Ctx, ListResult, PartInfo } from './types';

/**
 * The object store's API, as clients see it. Errors are `StoreError`s (src/errors.ts).
 *
 * Model:
 * - A bucket belongs to one tenant. Only that tenant's users can use it.
 * - A key is an opaque, non-empty string. Two keys are the same only if they are equal strings.
 * - Every successful put or multipart complete creates a new version with a new `versionId`.
 * - The latest version of a key is the one committed last.
 */
export interface ObjectStoreApi {
  /** Creates a bucket owned by `ctx.tenantId`. Bucket names are global. */
  createBucket(ctx: Ctx, bucket: string): Promise<void>;

  /** Stores `bytes` as a new version of `key`. Once this resolves, the version is durable and readable. */
  putObject(ctx: Ctx, bucket: string, key: string, bytes: Uint8Array): Promise<{ versionId: string }>;

  /**
   * Returns the bytes of the latest version, or of `opts.versionId`.
   * `NotFound` if the key has no versions, the version does not exist, or the
   * requested version (or the latest, when no versionId is given) is a delete marker.
   */
  getObject(ctx: Ctx, bucket: string, key: string, opts?: { versionId?: string }): Promise<Uint8Array>;

  /**
   * Without `versionId`: adds a delete marker as the new latest version; older
   * versions stay readable by versionId. Returns `{ deleteMarker: true }`.
   * With `versionId`: permanently removes that version. Returns `{ deleteMarker: false }`.
   * `ObjectLocked` if that version is under a retention lock.
   */
  deleteObject(ctx: Ctx, bucket: string, key: string, opts?: { versionId?: string }): Promise<{ deleteMarker: boolean }>;

  /**
   * Keys whose latest version is not a delete marker and that start with
   * `prefix`, in ascending order of their UTF-8 bytes, at most `limit` (1 to 1,000) per page.
   * `nextCursor` is present when there may be more keys.
   */
  listObjects(ctx: Ctx, bucket: string, prefix: string, opts: { cursor?: string; limit: number }): Promise<ListResult>;

  /** Starts a multipart upload of `key`. The `uploadId` lets the holder upload parts and complete. */
  createMultipartUpload(ctx: Ctx, bucket: string, key: string): Promise<{ uploadId: string }>;

  /**
   * Stores one part. `partNumber` is 1 to 10,000; parts may arrive in any order
   * and in parallel; uploading the same part number again replaces it. There is
   * no minimum part size. `crc32c` is the client's CRC32C of `bytes` as 8 hex
   * characters (shared/checksum.ts `crc32cHex`); `BadDigest` if it does not match.
   */
  uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array, crc32c: string): Promise<{ etag: string }>;

  /** Parts stored so far for an upload that is still open, sorted by part number. */
  listParts(uploadId: string): Promise<PartInfo[]>;

  /**
   * Creates the object version from the listed parts, concatenated in part-number order.
   * `InvalidPart` if a listed part was never uploaded or its etag does not match.
   * Clients retry this call when they don't get a response.
   */
  completeMultipartUpload(uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<{ versionId: string }>;

  /**
   * Locks a version until `until`. While locked, nobody (admins included) can
   * permanently delete it. A lock can be extended, never shortened (`ObjectLocked`).
   */
  setRetention(ctx: Ctx, bucket: string, key: string, versionId: string, until: Date): Promise<void>;

  /**
   * Returns a URL that lets a browser upload one part of one upload without
   * other credentials, valid for `expiresInSec`. The URL's query string must
   * carry the parameters `uploadId`, `partNumber`, `expires` and `signature`.
   */
  presignPartUrl(uploadId: string, partNumber: number, expiresInSec: number): string;

  /** Uploads a part through a URL from `presignPartUrl`. `AccessDenied` if the URL is not valid for this part. */
  uploadPartWithUrl(url: string, bytes: Uint8Array, crc32c: string): Promise<{ etag: string }>;

  /** Background job: restores full redundancy for data that lost copies. */
  runRepair(): Promise<{ chunksRepaired: number }>;

  /**
   * Background job: deletes stored data no committed version or open upload
   * needs, and aborts uploads abandoned for 7 days.
   */
  runGarbageCollection(): Promise<{ chunksDeleted: number; uploadsAborted: number }>;

  /**
   * Background job: runs post-upload processing (`env.mediaProcessor.process`)
   * for committed versions. Delete markers are not processed. May run on
   * several workers at once.
   */
  processEvents(): Promise<{ processed: number }>;
}

/**
 * Your implementation. Tests construct it with `new ObjectStore(sim.env())`.
 * A process restart constructs a new instance over the same cluster and database,
 * so the constructor must cope with tables that already exist.
 */
export class ObjectStore implements ObjectStoreApi {
  constructor(private readonly env: StoreEnv) {}

  async createBucket(ctx: Ctx, bucket: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async putObject(ctx: Ctx, bucket: string, key: string, bytes: Uint8Array): Promise<{ versionId: string }> {
    throw new Error('Not implemented');
  }

  async getObject(ctx: Ctx, bucket: string, key: string, opts?: { versionId?: string }): Promise<Uint8Array> {
    throw new Error('Not implemented');
  }

  async deleteObject(ctx: Ctx, bucket: string, key: string, opts?: { versionId?: string }): Promise<{ deleteMarker: boolean }> {
    throw new Error('Not implemented');
  }

  async listObjects(ctx: Ctx, bucket: string, prefix: string, opts: { cursor?: string; limit: number }): Promise<ListResult> {
    throw new Error('Not implemented');
  }

  async createMultipartUpload(ctx: Ctx, bucket: string, key: string): Promise<{ uploadId: string }> {
    throw new Error('Not implemented');
  }

  async uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array, crc32c: string): Promise<{ etag: string }> {
    throw new Error('Not implemented');
  }

  async listParts(uploadId: string): Promise<PartInfo[]> {
    throw new Error('Not implemented');
  }

  async completeMultipartUpload(uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<{ versionId: string }> {
    throw new Error('Not implemented');
  }

  async setRetention(ctx: Ctx, bucket: string, key: string, versionId: string, until: Date): Promise<void> {
    throw new Error('Not implemented');
  }

  presignPartUrl(uploadId: string, partNumber: number, expiresInSec: number): string {
    throw new Error('Not implemented');
  }

  async uploadPartWithUrl(url: string, bytes: Uint8Array, crc32c: string): Promise<{ etag: string }> {
    throw new Error('Not implemented');
  }

  async runRepair(): Promise<{ chunksRepaired: number }> {
    throw new Error('Not implemented');
  }

  async runGarbageCollection(): Promise<{ chunksDeleted: number; uploadsAborted: number }> {
    throw new Error('Not implemented');
  }

  async processEvents(): Promise<{ processed: number }> {
    throw new Error('Not implemented');
  }
}
