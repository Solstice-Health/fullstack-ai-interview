import { describe, expect, it } from 'vitest';
import { DAY, YEAR } from '../../shared/clock';
import { AZS } from '../../sim/cluster';
import {
  BUCKET,
  KiB,
  MiB,
  acmeAdmin,
  alice,
  bytes,
  crc32cHex,
  expectBytes,
  expectStoreError,
  isNotFound,
  multipartUpload,
  restart,
  retrying,
  setup,
  text,
} from '../helpers/setup';

describe('retention and garbage collection', () => {
  it.skip("#14 (stretch) Retention: a locked version can't be deleted by anyone, admins included, until its date; garbage collection never touches it", async () => {
    const { sim, client } = await setup();
    const key = 'approved/brochure-v1.pdf';
    const d1 = bytes(300 * KiB, 141);
    const { versionId: v1 } = await client.putObject(alice, BUCKET, key, d1);
    const lockedAt = sim.clock.now();
    await client.setRetention(acmeAdmin, BUCKET, key, v1, new Date(lockedAt + 7 * YEAR));

    for (const ctx of [alice, acmeAdmin]) {
      await expectStoreError(client.deleteObject(ctx, BUCKET, key, { versionId: v1 }), 'ObjectLocked');
    }
    await expectStoreError(client.setRetention(acmeAdmin, BUCKET, key, v1, new Date(lockedAt + DAY)), 'ObjectLocked');
    await client.setRetention(acmeAdmin, BUCKET, key, v1, new Date(lockedAt + 8 * YEAR));

    // A plain delete only adds a marker, and an overwrite adds a version.
    expect(await client.deleteObject(acmeAdmin, BUCKET, key)).toEqual({ deleteMarker: true });
    const d2 = bytes(100 * KiB, 142);
    await client.putObject(alice, BUCKET, key, d2);

    sim.clock.advance(6 * YEAR);
    await client.runGarbageCollection();
    sim.clock.advance(1 * YEAR + 30 * DAY);
    await client.runGarbageCollection();
    expectBytes(await client.getObject(alice, BUCKET, key, { versionId: v1 }), d1, 'locked version after 7 years');
    await expectStoreError(client.deleteObject(acmeAdmin, BUCKET, key, { versionId: v1 }), 'ObjectLocked');

    // After the lock expires the version can be deleted.
    sim.clock.advance(1 * YEAR);
    await client.runGarbageCollection();
    expectBytes(await client.getObject(alice, BUCKET, key, { versionId: v1 }), d1, 'after the lock expired');
    expect(await client.deleteObject(alice, BUCKET, key, { versionId: v1 })).toEqual({ deleteMarker: false });
    expect(await isNotFound(client.getObject(alice, BUCKET, key, { versionId: v1 }))).toBe(true);
    expectBytes(await client.getObject(alice, BUCKET, key), d2, 'latest');
  });

  it.skip('#15 (stretch) GC safety: garbage collection removes orphaned chunks and uploads abandoned for 7 days, and never removes anything a committed version references', async () => {
    const s = await setup();
    const { sim, client } = s;
    // Committed data, including old versions and a version hidden by a delete marker.
    const a1 = bytes(300 * KiB, 151);
    const a2 = bytes(1 * MiB + 5, 152);
    const b1 = bytes(2 * MiB, 153);
    const c1 = bytes(500 * KiB, 154);
    const { versionId: va1 } = await client.putObject(alice, BUCKET, 'keep/a', a1);
    const { versionId: va2 } = await client.putObject(alice, BUCKET, 'keep/a', a2);
    const { versionId: vb1 } = await client.putObject(alice, BUCKET, 'keep/b', b1);
    await client.deleteObject(alice, BUCKET, 'keep/b');
    const { versionId: vc1 } = await multipartUpload(client, alice, BUCKET, 'keep/c', c1, 128 * KiB);
    const committedBytes = sim.cluster.storedBytes();

    // An orphan: the process dies after writing data, before recording it.
    sim.crash.crashBefore('db.write', { after: 'chunk.write' });
    await expect(s.store.putObject(alice, BUCKET, 'crashed.bin', bytes(1 * MiB, 155))).rejects.toThrow();
    const r = restart(s);

    // An upload abandoned now, and one started 6 days later.
    const { uploadId: abandoned } = await r.client.createMultipartUpload(alice, BUCKET, 'abandoned.mov');
    for (const n of [1, 2]) {
      const part = bytes(128 * KiB, 160 + n);
      await r.client.uploadPart(abandoned, n, part, crc32cHex(part));
    }
    sim.clock.advance(6 * DAY);
    const recentPart = bytes(128 * KiB, 170);
    const beforeRecent = sim.cluster.storedBytes();
    const { uploadId: recent } = await r.client.createMultipartUpload(alice, BUCKET, 'recent.mov');
    const { etag } = await r.client.uploadPart(recent, 1, recentPart, crc32cHex(recentPart));
    const recentBytes = sim.cluster.storedBytes() - beforeRecent;

    await r.client.runGarbageCollection();
    expect((await r.client.listParts(abandoned)).length, 'a 6-day-old upload is kept').toBe(2);

    sim.clock.advance(2 * DAY);
    const result = await r.client.runGarbageCollection();
    expect(result.uploadsAborted).toBeGreaterThanOrEqual(1);
    expect(result.chunksDeleted).toBeGreaterThan(0);
    await expectStoreError(r.client.listParts(abandoned), 'NotFound');
    expect((await r.client.listParts(recent)).map((p) => p.partNumber)).toEqual([1]);
    expect(sim.cluster.storedBytes(), 'only committed data and the open upload remain').toBe(committedBytes + recentBytes);

    // Everything committed still reads back.
    const check = async () => {
      expectBytes(await r.client.getObject(alice, BUCKET, 'keep/a', { versionId: va1 }), a1, 'keep/a v1');
      expectBytes(await r.client.getObject(alice, BUCKET, 'keep/a', { versionId: va2 }), a2, 'keep/a v2');
      expectBytes(await r.client.getObject(alice, BUCKET, 'keep/b', { versionId: vb1 }), b1, 'keep/b v1');
      expectBytes(await r.client.getObject(alice, BUCKET, 'keep/c', { versionId: vc1 }), c1, 'keep/c');
    };
    await check();
    await retrying(() => r.client.completeMultipartUpload(recent, [{ partNumber: 1, etag }]));
    expectBytes(await r.client.getObject(alice, BUCKET, 'recent.mov'), recentPart, 'recent.mov');

    // GC running while a put is in flight (one AZ is slow to respond).
    const inFlight = bytes(1536 * KiB, 180);
    sim.cluster.setLatency('az3', 40);
    await Promise.all([
      r.client.putObject(alice, BUCKET, 'in-flight.bin', inFlight),
      r.client.runGarbageCollection(),
      r.client.runGarbageCollection(),
    ]);
    sim.cluster.setLatency('az3', 1);
    for (const az of AZS) {
      sim.cluster.partitionAz(az);
      expectBytes(await r.client.getObject(alice, BUCKET, 'in-flight.bin'), inFlight, `put that raced GC, ${az} unreachable`);
      sim.cluster.healAz(az);
    }

    sim.clock.advance(30 * DAY);
    await r.client.runGarbageCollection();
    await check();
    expectBytes(await r.client.getObject(alice, BUCKET, 'in-flight.bin'), inFlight, 'in-flight.bin after 30 days');
    await r.client.putObject(alice, BUCKET, 'after.txt', text('still works'));
  });
});
