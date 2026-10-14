import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../shared/checksum';
import { BUCKET, KiB, alice, bytes, isNotFound, multipartUpload, restart, setup } from '../helpers/setup';

describe('post-upload processing', () => {
  it.skip('#17 (stretch) Processing events: each committed version produces exactly one processed result, even when the event is delivered twice', async () => {
    const s = await setup();
    const committed: { key: string; versionId: string; data: Uint8Array }[] = [];
    const put = async (key: string, data: Uint8Array) => {
      const { versionId } = await s.client.putObject(alice, BUCKET, key, data);
      committed.push({ key, versionId, data });
    };
    await put('a.pdf', bytes(20 * KiB, 171));
    await put('b.png', bytes(30 * KiB, 172));
    await put('a.pdf', bytes(25 * KiB, 173));
    const c = bytes(300 * KiB, 174);
    const { versionId: vc } = await multipartUpload(s.client, alice, BUCKET, 'c.mp4', c, 64 * KiB);
    committed.push({ key: 'c.mp4', versionId: vc, data: c });
    await s.client.deleteObject(alice, BUCKET, 'b.png');

    // The process dies when it first tries to publish to the queue (if it does so during a put).
    const d = bytes(40 * KiB, 175);
    s.sim.crash.crashBefore('queue.publish');
    const dResult = await s.store.putObject(alice, BUCKET, 'd.pdf', d).then(
      (v) => v,
      () => null,
    );
    s.sim.crash.disarm();
    const r = s.sim.crash.crashes > 0 ? restart(s) : s;
    if (dResult) committed.push({ key: 'd.pdf', versionId: dResult.versionId, data: d });
    const dVisible = !(await isNotFound(r.client.getObject(alice, BUCKET, 'd.pdf')));

    // Several workers, several rounds; time passes so unacknowledged deliveries come back.
    await Promise.all([r.client.processEvents(), r.client.processEvents(), r.client.processEvents()]);
    s.sim.clock.advance(5 * 60_000);
    await Promise.all([r.client.processEvents(), r.client.processEvents()]);
    s.sim.clock.advance(5 * 60_000);
    await r.client.processEvents();

    const results = s.sim.mediaProcessor.results;
    for (const v of committed) {
      const mine = results.filter((x) => x.versionId === v.versionId);
      expect(mine, `results for ${v.key} ${v.versionId}`).toHaveLength(1);
      expect(mine[0]!.sha256).toBe(sha256Hex(v.data));
      expect(mine[0]!.key).toBe(v.key);
    }
    const dResults = results.filter((x) => x.key === 'd.pdf');
    expect(dResults, 'd.pdf processed once if it was committed').toHaveLength(dVisible ? 1 : 0);
    const expectedTotal = committed.length + (dVisible && !dResult ? 1 : 0);
    expect(results).toHaveLength(expectedTotal);

    // New versions keep flowing.
    const e = bytes(10 * KiB, 176);
    const { versionId: ve } = await r.client.putObject(alice, BUCKET, 'e.pdf', e);
    await Promise.all([r.client.processEvents(), r.client.processEvents()]);
    s.sim.clock.advance(5 * 60_000);
    await r.client.processEvents();
    expect(results.filter((x) => x.versionId === ve)).toHaveLength(1);
    expect(results).toHaveLength(expectedTotal + 1);
  });
});
