import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../shared/checksum';
import {
  BUCKET,
  KiB,
  alice,
  bytes,
  crc32cHex,
  expectBytes,
  expectStoreError,
  inParallel,
  isNotFound,
  restart,
  retrying,
  setup,
  shuffled,
  splitParts,
} from '../helpers/setup';
import { ResponseLostError } from '../helpers/testClient';

describe('multipart uploads', () => {
  it.skip('#3 Multipart: parts uploaded out of order and in parallel assemble into the exact original bytes; a wrong etag or a missing part fails the complete', async () => {
    const { client } = await setup();
    const data = bytes(1024 * KiB + 333, 3);
    const parts = splitParts(data, 64 * KiB); // 17 parts, the last one short
    const { uploadId } = await client.createMultipartUpload(alice, BUCKET, 'launch/video.mp4');

    // A part whose bytes don't match its checksum is rejected.
    const p1 = parts[0]!;
    await expectStoreError(client.uploadPart(uploadId, 1, p1.bytes, crc32cHex(parts[1]!.bytes)), 'BadDigest');
    // Re-uploading a part number replaces it.
    await client.uploadPart(uploadId, 1, bytes(64 * KiB, 999), crc32cHex(bytes(64 * KiB, 999)));

    const etags = new Map<number, string>();
    await inParallel(shuffled(parts), 6, async (p) => {
      const { etag } = await client.uploadPart(uploadId, p.partNumber, p.bytes, crc32cHex(p.bytes));
      etags.set(p.partNumber, etag);
    });

    const listed = await client.listParts(uploadId);
    expect(listed.map((p) => p.partNumber)).toEqual(parts.map((p) => p.partNumber));
    for (const p of listed) {
      expect(p.size).toBe(parts[p.partNumber - 1]!.bytes.length);
      expect(p.etag).toBe(etags.get(p.partNumber));
    }

    const good = parts.map((p) => ({ partNumber: p.partNumber, etag: etags.get(p.partNumber)! }));
    const wrongEtag = good.map((p) => (p.partNumber === 5 ? { ...p, etag: etags.get(6)! } : p));
    await expectStoreError(retrying(() => client.completeMultipartUpload(uploadId, wrongEtag)), 'InvalidPart');
    const missingPart = [...good, { partNumber: 18, etag: etags.get(17)! }];
    await expectStoreError(retrying(() => client.completeMultipartUpload(uploadId, missingPart)), 'InvalidPart');
    expect(await isNotFound(client.getObject(alice, BUCKET, 'launch/video.mp4'))).toBe(true);

    const { versionId } = await retrying(() => client.completeMultipartUpload(uploadId, good));
    expectBytes(await client.getObject(alice, BUCKET, 'launch/video.mp4'), data, 'assembled object');
    expectBytes(await client.getObject(alice, BUCKET, 'launch/video.mp4', { versionId }), data, 'by versionId');
  });

  it.skip('#4 Resume: after a connection drop mid-upload, listParts lets the client send only the missing parts, and the final checksum matches', async () => {
    const { client } = await setup();
    const data = bytes(40 * 64 * KiB + 100, 4);
    const parts = splitParts(data, 64 * KiB); // 41 parts
    const { uploadId } = await client.createMultipartUpload(alice, BUCKET, 'conference/keynote.mov');

    client.dropConnectionAfter(15);
    let failures = 0;
    await inParallel(parts, 4, async (p) => {
      try {
        await client.uploadPart(uploadId, p.partNumber, p.bytes, crc32cHex(p.bytes));
      } catch {
        failures += 1;
      }
    });
    expect(failures).toBeGreaterThan(0);

    // The browser reconnects. It has lost track of which parts made it.
    client.reconnect();
    const listed = await client.listParts(uploadId);
    expect(listed.length).toBeGreaterThanOrEqual(16);
    expect(listed.map((p) => p.partNumber)).toEqual([...listed.map((p) => p.partNumber)].sort((a, b) => a - b));
    for (const p of listed) expect(p.size).toBe(parts[p.partNumber - 1]!.bytes.length);

    const have = new Set(listed.map((p) => p.partNumber));
    const missing = parts.filter((p) => !have.has(p.partNumber));
    expect(missing.length).toBeGreaterThan(0);
    const sentBefore = client.calls.uploadPart ?? 0;
    await inParallel(missing, 4, (p) => client.uploadPart(uploadId, p.partNumber, p.bytes, crc32cHex(p.bytes)));
    expect((client.calls.uploadPart ?? 0) - sentBefore).toBe(missing.length);

    const all = await client.listParts(uploadId);
    expect(all.map((p) => p.partNumber)).toEqual(parts.map((p) => p.partNumber));
    await retrying(() => client.completeMultipartUpload(uploadId, all.map(({ partNumber, etag }) => ({ partNumber, etag }))));

    const got = await client.getObject(alice, BUCKET, 'conference/keynote.mov');
    expect(sha256Hex(got)).toBe(sha256Hex(data));
  });

  it.skip('#5 Idempotent complete: a complete retried after a timeout returns the same versionId and creates no second version', async () => {
    const s = await setup(); // the first completeMultipartUpload response is lost
    const { client } = s;
    const key = 'campaign/hero.mp4';
    const data = bytes(300 * KiB, 5);
    const { uploadId } = await client.createMultipartUpload(alice, BUCKET, key);
    const parts = splitParts(data, 64 * KiB);
    const list: { partNumber: number; etag: string }[] = [];
    for (const p of parts) {
      const { etag } = await client.uploadPart(uploadId, p.partNumber, p.bytes, crc32cHex(p.bytes));
      list.push({ partNumber: p.partNumber, etag });
    }

    await expect(client.completeMultipartUpload(uploadId, list)).rejects.toBeInstanceOf(ResponseLostError);
    const lost = client.lost[0]!;
    expect(lost.error).toBeUndefined();
    const firstVersionId = (lost.result as { versionId: string }).versionId;

    const retry = await client.completeMultipartUpload(uploadId, list);
    expect(retry.versionId).toBe(firstVersionId);
    expect((await client.completeMultipartUpload(uploadId, list)).versionId).toBe(firstVersionId);

    // Still the same after the server restarts.
    const r = restart(s, { lostResponses: {} });
    expect((await r.client.completeMultipartUpload(uploadId, list)).versionId).toBe(firstVersionId);
    expectBytes(await r.client.getObject(alice, BUCKET, key), data);

    // Only one version exists: removing it leaves nothing.
    await r.client.deleteObject(alice, BUCKET, key, { versionId: firstVersionId });
    expect(await isNotFound(r.client.getObject(alice, BUCKET, key))).toBe(true);

    // Two completes racing (a client timeout fires while the first is still running).
    const { uploadId: u2 } = await r.client.createMultipartUpload(alice, BUCKET, 'campaign/teaser.mp4');
    const list2: { partNumber: number; etag: string }[] = [];
    for (const p of parts) {
      const { etag } = await r.client.uploadPart(u2, p.partNumber, p.bytes, crc32cHex(p.bytes));
      list2.push({ partNumber: p.partNumber, etag });
    }
    const [a, b] = await Promise.all([
      r.client.completeMultipartUpload(u2, list2),
      r.client.completeMultipartUpload(u2, list2),
    ]);
    expect(a.versionId).toBe(b.versionId);
    await r.client.deleteObject(alice, BUCKET, 'campaign/teaser.mp4', { versionId: a.versionId });
    expect(await isNotFound(r.client.getObject(alice, BUCKET, 'campaign/teaser.mp4'))).toBe(true);
  });
});
