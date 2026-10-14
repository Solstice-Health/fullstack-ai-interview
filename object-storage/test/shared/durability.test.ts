import { describe, expect, it } from 'vitest';
import { StoreError } from '../../src/errors';
import { AZS } from '../../sim/cluster';
import {
  BUCKET,
  KiB,
  MiB,
  alice,
  bytes,
  crc32cHex,
  expectBytes,
  isNotFound,
  listAll,
  multipartUpload,
  restart,
  setup,
  splitParts,
  text,
  type Setup,
} from '../helpers/setup';

/** After a crash and restart, `key` must be absent everywhere or present with exactly `data`. Returns whether it is visible. */
async function allOrNothing(r: Setup, key: string, data: Uint8Array): Promise<boolean> {
  let visible: boolean;
  try {
    expectBytes(await r.client.getObject(alice, BUCKET, key), data, `${key} after crash`);
    visible = true;
  } catch (e) {
    if (!(e instanceof StoreError && e.code === 'NotFound')) throw e;
    visible = false;
  }
  expect((await listAll(r.client, alice, BUCKET, '')).includes(key), 'LIST agrees with get').toBe(visible);
  return visible;
}

describe('durability', () => {
  it.skip('#6 Atomic visibility: a crash after the bytes are written but before the metadata commit leaves no visible object in get or LIST', async () => {
    const data = bytes(2 * MiB + 5, 6);

    // Crash after chunk writes, just before the next metadata write.
    {
      const s = await setup();
      await s.client.putObject(alice, BUCKET, 'other.txt', text('other'));
      s.sim.crash.crashBefore('db.write', { after: 'chunk.write' });
      await expect(s.store.putObject(alice, BUCKET, 'doc.pdf', data)).rejects.toThrow();
      expect(s.sim.crash.crashes, 'the put never wrote metadata after writing data').toBe(1);
      const r = restart(s);
      expect(await isNotFound(r.client.getObject(alice, BUCKET, 'doc.pdf'))).toBe(true);
      expect(await listAll(r.client, alice, BUCKET, '')).toEqual(['other.txt']);
      await r.client.putObject(alice, BUCKET, 'doc.pdf', data);
      expectBytes(await r.client.getObject(alice, BUCKET, 'doc.pdf'), data, 'put after restart');
    }

    // Crash before every step of a put in turn.
    const probe = await setup();
    probe.sim.crash.resetLog();
    await probe.store.putObject(alice, BUCKET, 'doc.pdf', data);
    const putSteps = probe.sim.crash.steps.length;
    for (let k = 1; k <= putSteps; k++) {
      const s = await setup();
      s.sim.crash.crashBeforeStep(k);
      const acked = await s.store.putObject(alice, BUCKET, 'doc.pdf', data).then(
        () => true,
        () => false,
      );
      s.sim.crash.disarm();
      const visible = await allOrNothing(restart(s), 'doc.pdf', data);
      if (acked) expect(visible, `put acknowledged with a crash before step ${k}`).toBe(true);
    }

    // Crash before every step of a multipart complete in turn; a retried complete then succeeds.
    const mpData = bytes(200 * KiB + 1, 66);
    const mpParts = splitParts(mpData, 64 * KiB);
    const prepare = async (s: Setup) => {
      const { uploadId } = await s.client.createMultipartUpload(alice, BUCKET, 'clip.mp4');
      const list: { partNumber: number; etag: string }[] = [];
      for (const p of mpParts) {
        const { etag } = await s.client.uploadPart(uploadId, p.partNumber, p.bytes, crc32cHex(p.bytes));
        list.push({ partNumber: p.partNumber, etag });
      }
      return { uploadId, list };
    };
    const mpProbe = await setup();
    const prepared = await prepare(mpProbe);
    mpProbe.sim.crash.resetLog();
    await mpProbe.store.completeMultipartUpload(prepared.uploadId, prepared.list);
    const completeSteps = mpProbe.sim.crash.steps.length;
    for (let k = 1; k <= completeSteps; k++) {
      const s = await setup();
      const { uploadId, list } = await prepare(s);
      s.sim.crash.crashBeforeStep(k);
      const first = await s.store.completeMultipartUpload(uploadId, list).then(
        (v) => v,
        () => null,
      );
      s.sim.crash.disarm();
      const r = restart(s);
      const visible = await allOrNothing(r, 'clip.mp4', mpData);
      if (first) expect(visible).toBe(true);
      const retried = await r.store.completeMultipartUpload(uploadId, list);
      if (first) expect(retried.versionId).toBe(first.versionId);
      expectBytes(await r.client.getObject(alice, BUCKET, 'clip.mp4'), mpData, `clip.mp4 after crash before step ${k}`);
    }
  });

  it.skip('#7 AZ loss: with any one whole AZ killed, every committed object reads back byte-identical', async () => {
    const { sim, client } = await setup();
    const objects = new Map<string, Uint8Array>();
    for (let i = 0; i < 2; i++) {
      const data = bytes(700 * KiB + i, 70 + i);
      await multipartUpload(client, alice, BUCKET, `videos/${i}.mp4`, data, 128 * KiB);
      objects.set(`videos/${i}.mp4`, data);
    }
    const sizes = [1, 100, 4 * KiB, 64 * KiB, 300 * KiB, 1 * MiB, 1536 * KiB, 2 * MiB + 3];
    for (let i = 0; i < 24; i++) {
      const key = `assets/${i}.bin`;
      const data = bytes(sizes[i % sizes.length]!, 700 + i);
      await client.putObject(alice, BUCKET, key, data);
      objects.set(key, data);
    }
    // Power cut right after the last acknowledgement.
    sim.cluster.restartAll();

    for (const az of AZS) {
      sim.cluster.killAz(az);
      for (const [key, data] of objects) {
        expectBytes(await client.getObject(alice, BUCKET, key), data, `${key} with ${az} down`);
      }
      sim.cluster.reviveAz(az);
    }
  });
});
