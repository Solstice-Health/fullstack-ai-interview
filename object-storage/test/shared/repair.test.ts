import { describe, expect, it } from 'vitest';
import { AZS } from '../../sim/cluster';
import { BUCKET, KiB, MiB, alice, bytes, expectBytes, multipartUpload, setup } from '../helpers/setup';

describe('corruption and repair', () => {
  it.skip('#12 (stretch) Corruption: a read detects a chunk with flipped bits by checksum and serves a good copy instead', async () => {
    const data = bytes(2 * MiB + 1234, 12);
    // In each round, flip a bit in every chunk of the object held by one node.
    for (let round = 0; round < 9; round++) {
      const { sim, client } = await setup();
      const before = new Set(sim.cluster.storedChunks().map((c) => `${c.nodeId}/${c.chunkId}`));
      const { versionId } = await client.putObject(alice, BUCKET, 'scans/label.tiff', data);
      const mine = sim.cluster.storedChunks().filter((c) => !before.has(`${c.nodeId}/${c.chunkId}`) && c.size > 0);
      const nodes = [...new Set(mine.map((c) => c.nodeId))].sort();
      expect(nodes.length).toBeGreaterThan(0);
      if (round >= nodes.length) break;
      for (const c of mine.filter((c) => c.nodeId === nodes[round])) sim.cluster.flipBit(c.nodeId, c.chunkId);
      expectBytes(await client.getObject(alice, BUCKET, 'scans/label.tiff'), data, `corrupt copy on ${nodes[round]}`);
      expectBytes(await client.getObject(alice, BUCKET, 'scans/label.tiff', { versionId }), data, `corrupt copy on ${nodes[round]}, by versionId`);
    }
  });

  it.skip('#13 (stretch) Repair: after a node is lost for good, runRepair restores full redundancy for every object it held', async () => {
    const { sim, client } = await setup();
    const objects = new Map<string, Uint8Array>();
    const sizes = [10 * KiB, 200 * KiB, 1 * MiB, 1536 * KiB, 2 * MiB + 1];
    for (let i = 0; i < 12; i++) {
      const data = bytes(sizes[i % sizes.length]!, 130 + i);
      await client.putObject(alice, BUCKET, `library/${i}.pdf`, data);
      objects.set(`library/${i}.pdf`, data);
    }
    const mp = bytes(900 * KiB, 139);
    await multipartUpload(client, alice, BUCKET, 'library/video.mp4', mp, 128 * KiB);
    objects.set('library/video.mp4', mp);

    const healthyBytes = sim.cluster.storedBytes();
    const perNode = new Map<string, number>();
    for (const c of sim.cluster.storedChunks()) perNode.set(c.nodeId, (perNode.get(c.nodeId) ?? 0) + c.size);
    const [lost] = [...perNode.entries()].sort((a, b) => b[1] - a[1])[0]!;
    sim.cluster.replaceNode(lost);
    expect(sim.cluster.storedBytes()).toBeLessThan(healthyBytes);

    const { chunksRepaired } = await client.runRepair();
    expect(chunksRepaired).toBeGreaterThan(0);
    expect(sim.cluster.storedBytes(), 'every lost byte is stored again').toBeGreaterThanOrEqual(healthyBytes);
    expect((await client.runRepair()).chunksRepaired, 'a second run has nothing to do').toBe(0);

    for (const az of AZS) {
      sim.cluster.partitionAz(az);
      for (const [key, data] of objects) expectBytes(await client.getObject(alice, BUCKET, key), data, `${key} with ${az} unreachable`);
      sim.cluster.healAz(az);
    }
  });
});
