import { describe, expect, it } from 'vitest';
import { BUCKET, KiB, alice, bytes, crc32cHex, expectBytes, expectStoreError, retrying, setup } from '../helpers/setup';

describe('presigned URLs', () => {
  it.skip('#16 (stretch) Presigned URLs: a presigned URL that has expired, or is reused for another part or key, is rejected', async () => {
    const { sim, client } = await setup();
    const { uploadId } = await client.createMultipartUpload(alice, BUCKET, 'field/video.mp4');
    const { uploadId: otherUpload } = await client.createMultipartUpload(alice, BUCKET, 'field/other.mp4');
    const p1 = bytes(100 * KiB, 161);
    const p2 = bytes(50 * KiB, 162);
    const put = (url: string, data: Uint8Array) => client.uploadPartWithUrl(url, data, crc32cHex(data));
    const tamper = (url: string, param: string, value: string) => {
      const u = new URL(url);
      u.searchParams.set(param, value);
      return u.toString();
    };

    const url1 = client.presignPartUrl(uploadId, 1, 300);
    for (const param of ['uploadId', 'partNumber', 'expires', 'signature']) {
      expect(new URL(url1).searchParams.get(param), `URL parameter ${param}`).toBeTruthy();
    }
    const { etag: etag1 } = await put(url1, p1);

    const url2 = client.presignPartUrl(uploadId, 2, 300);
    const sig2 = new URL(url2).searchParams.get('signature')!;
    const expires1 = Number(new URL(url1).searchParams.get('expires'));
    await expectStoreError(put(tamper(url1, 'partNumber', '2'), p2), 'AccessDenied');
    await expectStoreError(put(tamper(url1, 'uploadId', otherUpload), p2), 'AccessDenied');
    await expectStoreError(put(tamper(url1, 'expires', String(expires1 + 3600)), p2), 'AccessDenied');
    await expectStoreError(put(tamper(url1, 'signature', sig2), p2), 'AccessDenied');
    await expectStoreError(put(tamper(url1, 'signature', '0'.repeat(sig2.length)), p2), 'AccessDenied');
    expect(await client.listParts(otherUpload)).toEqual([]);

    const { etag: etag2 } = await put(url2, p2);

    const url3 = client.presignPartUrl(uploadId, 3, 60);
    sim.clock.advance(61_000);
    await expectStoreError(put(url3, bytes(10, 163)), 'AccessDenied');

    expect((await client.listParts(uploadId)).map((p) => p.partNumber)).toEqual([1, 2]);
    await retrying(() =>
      client.completeMultipartUpload(uploadId, [
        { partNumber: 1, etag: etag1 },
        { partNumber: 2, etag: etag2 },
      ]),
    );
    const whole = new Uint8Array(p1.length + p2.length);
    whole.set(p1);
    whole.set(p2, p1.length);
    expectBytes(await client.getObject(alice, BUCKET, 'field/video.mp4'), whole);
  });
});
