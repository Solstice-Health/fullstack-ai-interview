import { describe, expect, it } from 'vitest';
import { BUCKET, KiB, MiB, alice, bytes, expectBytes, multipartUpload, setup } from '../helpers/setup';

describe('concurrency', () => {
  it.skip('#11 Concurrent writes: two concurrent puts to the same key both become versions; the latest is the last to commit; no object mixes bytes from both', async () => {
    const { client } = await setup();
    const key = 'shared/deck.pptx';
    const rounds: [number, number][] = [
      [2 * MiB, 2 * MiB + 7],
      [3 * MiB, 10],
      [10, 3 * MiB],
      [1536 * KiB, 1536 * KiB],
    ];
    for (const [i, [sizeA, sizeB]] of rounds.entries()) {
      const a = bytes(sizeA, 1000 + i);
      const b = bytes(sizeB, 2000 + i);
      const order: string[] = [];
      const [ra, rb] = await Promise.all([
        client.putObject(alice, BUCKET, key, a).then((r) => (order.push('a'), r)),
        client.putObject(alice, BUCKET, key, b).then((r) => (order.push('b'), r)),
      ]);
      expect(ra.versionId).not.toBe(rb.versionId);
      expectBytes(await client.getObject(alice, BUCKET, key, { versionId: ra.versionId }), a, `round ${i} version a`);
      expectBytes(await client.getObject(alice, BUCKET, key, { versionId: rb.versionId }), b, `round ${i} version b`);
      expectBytes(await client.getObject(alice, BUCKET, key), order[1] === 'a' ? a : b, `round ${i} latest`);
    }

    // Two multipart uploads of the same key at once.
    const m1 = bytes(600 * KiB, 31);
    const m2 = bytes(600 * KiB, 32);
    const [u1, u2] = await Promise.all([
      multipartUpload(client, alice, BUCKET, 'shared/cut.mp4', m1, 64 * KiB),
      multipartUpload(client, alice, BUCKET, 'shared/cut.mp4', m2, 64 * KiB),
    ]);
    expectBytes(await client.getObject(alice, BUCKET, 'shared/cut.mp4', { versionId: u1.versionId }), m1, 'upload 1');
    expectBytes(await client.getObject(alice, BUCKET, 'shared/cut.mp4', { versionId: u2.versionId }), m2, 'upload 2');
  });
});
