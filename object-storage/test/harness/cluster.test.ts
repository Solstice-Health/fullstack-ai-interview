import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock';
import { ChunkNotFoundError, NodeUnavailableError, SimCluster } from '../../sim/cluster';

const b = (...xs: number[]) => new Uint8Array(xs);

describe('harness: simulated cluster', () => {
  it('has 9 nodes, 3 in each of 3 AZs', () => {
    const c = new SimCluster();
    expect(c.nodes).toHaveLength(9);
    for (const az of ['az1', 'az2', 'az3']) expect(c.nodes.filter((n) => n.az === az)).toHaveLength(3);
    expect(new Set(c.nodes.map((n) => n.id)).size).toBe(9);
  });

  it('stores, lists, reads and deletes chunks, copying bytes in and out', async () => {
    const c = new SimCluster({ writeCacheNodes: [] });
    const data = b(1, 2, 3);
    await c.putChunk('az2-n1', 'c1', data);
    data[0] = 99;
    const got = await c.getChunk('az2-n1', 'c1');
    expect(got).toEqual(b(1, 2, 3));
    got[1] = 99;
    expect(await c.getChunk('az2-n1', 'c1')).toEqual(b(1, 2, 3));
    expect(await c.listChunks('az2-n1')).toEqual([{ chunkId: 'c1', size: 3, writtenAt: expect.any(Number) }]);
    await expect(c.getChunk('az2-n2', 'c1')).rejects.toBeInstanceOf(ChunkNotFoundError);
    await c.deleteChunk('az2-n1', 'c1');
    await c.deleteChunk('az2-n1', 'c1');
    expect(await c.listChunks('az2-n1')).toEqual([]);
  });

  it('a killed node is unavailable and keeps its flushed data across restart', async () => {
    const c = new SimCluster({ writeCacheNodes: [] });
    await c.putChunk('az1-n2', 'c1', b(7));
    c.kill('az1-n2');
    expect(c.status('az1-n2')).toBe('down');
    await expect(c.getChunk('az1-n2', 'c1')).rejects.toBeInstanceOf(NodeUnavailableError);
    await expect(c.putChunk('az1-n2', 'c2', b(1))).rejects.toBeInstanceOf(NodeUnavailableError);
    c.revive('az1-n2');
    expect(await c.getChunk('az1-n2', 'c1')).toEqual(b(7));
  });

  it('a partitioned node keeps running but cannot be reached until healed', async () => {
    const c = new SimCluster();
    await c.putChunk('az3-n3', 'c1', b(5));
    c.partition('az3-n3');
    await expect(c.getChunk('az3-n3', 'c1')).rejects.toBeInstanceOf(NodeUnavailableError);
    c.heal('az3-n3');
    expect(await c.getChunk('az3-n3', 'c1')).toEqual(b(5));
  });

  it('killAz and partitionAz affect exactly the nodes of that AZ', async () => {
    const c = new SimCluster();
    c.killAz('az2');
    c.partitionAz('az3');
    for (const n of c.nodes) {
      expect(c.status(n.id)).toBe(n.az === 'az1' ? 'up' : n.az === 'az2' ? 'down' : 'partitioned');
    }
    c.reviveAz('az2');
    c.healAz('az3');
    for (const n of c.nodes) expect(c.status(n.id)).toBe('up');
  });

  it('a call in flight when its node restarts fails', async () => {
    const c = new SimCluster({ writeCacheNodes: [] });
    const p = c.putChunk('az1-n3', 'c1', b(1));
    c.restart('az1-n3');
    await expect(p).rejects.toBeInstanceOf(NodeUnavailableError);
    expect(c.hasChunk('az1-n3', 'c1')).toBe(false);
  });

  it('replaceNode loses the disk for good', async () => {
    const c = new SimCluster();
    await c.putChunk('az2-n2', 'c1', b(1, 2));
    c.replaceNode('az2-n2');
    expect(c.status('az2-n2')).toBe('up');
    expect(await c.listChunks('az2-n2')).toEqual([]);
  });

  it('flipBit changes exactly one bit, in place', async () => {
    const c = new SimCluster();
    await c.putChunk('az1-n2', 'c1', b(0, 0, 0, 0));
    c.flipBit('az1-n2', 'c1');
    expect(await c.getChunk('az1-n2', 'c1')).toEqual(b(0, 0, 1, 0));
    c.flipBit('az1-n2', 'c1', 3);
    expect(await c.getChunk('az1-n2', 'c1')).toEqual(b(8, 0, 1, 0));
  });

  it('write-cache nodes lose unflushed writes on restart and keep flushed ones', async () => {
    const clock = new FakeClock();
    const c = new SimCluster({ clock });
    expect(c.options.writeCacheNodes).toEqual(['az1-n1']);
    await c.putChunk('az1-n1', 'old', b(1));
    await c.putChunk('az2-n1', 'other', b(1));
    clock.advance(c.options.cacheFlushIntervalMs);
    await c.putChunk('az1-n1', 'new', b(2));
    expect(c.hasChunk('az1-n1', 'new')).toBe(true);
    c.restart('az1-n1');
    expect(c.hasChunk('az1-n1', 'old')).toBe(true);
    expect(c.hasChunk('az1-n1', 'new')).toBe(false);
    c.restartAll();
    expect(c.hasChunk('az2-n1', 'other')).toBe(true);
  });

  it('with no write-cache nodes, restarts lose nothing', async () => {
    const c = new SimCluster({ writeCacheNodes: [] });
    await c.putChunk('az1-n1', 'c1', b(1));
    c.restartAll();
    expect(c.hasChunk('az1-n1', 'c1')).toBe(true);
  });

  it('setLatency slows calls to a node or an AZ', async () => {
    const c = new SimCluster();
    c.setLatency('az2', 5);
    const order: string[] = [];
    await Promise.all([
      c.putChunk('az2-n1', 'slow', b(1)).then(() => order.push('slow')),
      c.putChunk('az1-n2', 'fast', b(1)).then(() => order.push('fast')),
    ]);
    expect(order).toEqual(['fast', 'slow']);
  });

  it('reports stored chunks and bytes', async () => {
    const c = new SimCluster();
    await c.putChunk('az1-n2', 'a', b(1, 2, 3));
    await c.putChunk('az3-n1', 'b', b(4));
    expect(c.storedBytes()).toBe(4);
    expect(c.storedChunks()).toHaveLength(2);
  });
});
