import { describe, expect, it } from 'vitest';
import { crc32cHex } from '../../shared/checksum';
import { FakeUploadServer } from '../../web/src/fakeServer';
import { FlakyNetwork } from '../../web/src/flakyNetwork';
import { NetworkError, ServerError } from '../../web/src/uploadApi';

const b = (...xs: number[]) => new Uint8Array(xs);

describe('harness: web fakes', () => {
  it('the fake server assembles parts in part-number order, and complete is idempotent', async () => {
    const s = new FakeUploadServer();
    const { uploadId } = await s.createMultipartUpload('f.bin');
    const e2 = (await s.uploadPart(uploadId, 2, b(3, 4), crc32cHex(b(3, 4)))).etag;
    const e1 = (await s.uploadPart(uploadId, 1, b(1, 2), crc32cHex(b(1, 2)))).etag;
    await expect(s.uploadPart(uploadId, 3, b(9), '00000000')).rejects.toBeInstanceOf(ServerError);
    expect((await s.listParts(uploadId)).map((p) => p.partNumber)).toEqual([1, 2]);
    const parts = [
      { partNumber: 1, etag: e1 },
      { partNumber: 2, etag: e2 },
    ];
    const v = await s.completeMultipartUpload(uploadId, parts);
    expect(await s.completeMultipartUpload(uploadId, parts)).toEqual(v);
    expect(s.objects.get('f.bin')).toEqual(b(1, 2, 3, 4));
  });

  it('the flaky network drops the connection after the configured request and recovers', async () => {
    const s = new FakeUploadServer();
    const net = new FlakyNetwork(s, { latencyMs: 2, dropAfterRequests: [2], outageMs: 30 });
    const { uploadId } = await net.createMultipartUpload('f.bin');
    // Request 2 reaches the server, but its response is lost.
    await expect(net.uploadPart(uploadId, 1, b(1), crc32cHex(b(1)))).rejects.toBeInstanceOf(NetworkError);
    expect(net.drops).toBe(1);
    expect(s.partRequests).toBe(1);
    await expect(net.listParts(uploadId)).rejects.toBeInstanceOf(NetworkError);
    await new Promise((r) => setTimeout(r, 40));
    expect((await net.listParts(uploadId)).map((p) => p.partNumber)).toEqual([1]);
  });

  it('dropNow loses every response in flight', async () => {
    const s = new FakeUploadServer();
    const net = new FlakyNetwork(s, { latencyMs: 5, dropAfterRequests: [], outageMs: 10 });
    const { uploadId } = await net.createMultipartUpload('f.bin');
    const inFlight = [1, 2, 3].map((n) => net.uploadPart(uploadId, n, b(n), crc32cHex(b(n))));
    net.dropNow();
    const settled = await Promise.allSettled(inFlight);
    expect(settled.every((r) => r.status === 'rejected')).toBe(true);
    expect(s.partRequests).toBe(3);
  });
});
