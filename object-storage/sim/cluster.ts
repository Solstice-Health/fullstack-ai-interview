/**
 * Simulated storage cluster: 9 storage nodes in 3 availability zones.
 *
 * Each node stores opaque chunks by id. Nodes know nothing about objects,
 * versions or replicas; that is the server's job.
 *
 * Every call takes one event-loop turn (see `setLatency`), like a network round trip. A call to a
 * node that is down or partitioned fails with `NodeUnavailableError`. A call
 * in flight when its node is killed or restarted also fails.
 */
import type { Clock } from '../shared/clock';
import { FakeClock } from '../shared/clock';
import { tick } from './tick';

export type AzId = 'az1' | 'az2' | 'az3';

export interface StorageNode {
  id: string;
  az: AzId;
}

export interface ChunkInfo {
  chunkId: string;
  size: number;
  /** Simulated time of the last write to this chunk, in ms since the epoch. */
  writtenAt: number;
}

/** What the server sees: the topology and four calls per node. */
export interface StorageCluster {
  readonly nodes: readonly StorageNode[];
  /** Stores `bytes` under `chunkId` on the node, replacing any existing chunk with that id. */
  putChunk(nodeId: string, chunkId: string, bytes: Uint8Array): Promise<void>;
  /** Returns the chunk's bytes as stored. Throws `ChunkNotFoundError` if the node does not have it. */
  getChunk(nodeId: string, chunkId: string): Promise<Uint8Array>;
  /** Deletes the chunk. Deleting a missing chunk is not an error. */
  deleteChunk(nodeId: string, chunkId: string): Promise<void>;
  /** Lists every chunk the node holds. */
  listChunks(nodeId: string): Promise<ChunkInfo[]>;
}

export class NodeUnavailableError extends Error {
  constructor(readonly nodeId: string) {
    super(`Storage node ${nodeId} is unavailable`);
    this.name = 'NodeUnavailableError';
  }
}

export class ChunkNotFoundError extends Error {
  constructor(
    readonly nodeId: string,
    readonly chunkId: string,
  ) {
    super(`Chunk ${chunkId} not found on node ${nodeId}`);
    this.name = 'ChunkNotFoundError';
  }
}

export type NodeStatus = 'up' | 'down' | 'partitioned';

export interface ClusterOptions {
  clock: Clock;
  /**
   * Nodes whose disks acknowledge a write once it reaches the drive's write
   * cache. The cache is flushed to stable storage `cacheFlushIntervalMs` after
   * the write. A kill or restart loses cached writes that were not yet flushed.
   * Default: `['az1-n1']`. Pass `[]` for nodes that only acknowledge flushed writes.
   */
  writeCacheNodes: string[];
  /** Default: 30 seconds of simulated time. */
  cacheFlushIntervalMs: number;
}

interface StoredChunk {
  bytes: Uint8Array;
  writtenAt: number;
  cached: boolean;
}

interface NodeState extends StorageNode {
  status: NodeStatus;
  /** Bumped on every kill/restart, so in-flight calls can tell they were cut off. */
  epoch: number;
  /** Event-loop turns per call. */
  latency: number;
  chunks: Map<string, StoredChunk>;
}

export const AZS: readonly AzId[] = ['az1', 'az2', 'az3'];

export class SimCluster implements StorageCluster {
  readonly nodes: readonly StorageNode[];
  readonly options: ClusterOptions;
  private readonly state = new Map<string, NodeState>();
  /** Call counters, for tests and debugging. */
  readonly stats = { puts: 0, gets: 0, deletes: 0, lists: 0 };

  constructor(options: Partial<ClusterOptions> = {}) {
    this.options = {
      clock: options.clock ?? new FakeClock(),
      writeCacheNodes: options.writeCacheNodes ?? ['az1-n1'],
      cacheFlushIntervalMs: options.cacheFlushIntervalMs ?? 30_000,
    };
    const nodes: StorageNode[] = [];
    for (const az of AZS) {
      for (let i = 1; i <= 3; i++) {
        const node: StorageNode = { id: `${az}-n${i}`, az };
        nodes.push(node);
        this.state.set(node.id, { ...node, status: 'up', epoch: 0, latency: 1, chunks: new Map() });
      }
    }
    this.nodes = Object.freeze(nodes.map((n) => Object.freeze({ ...n })));
  }

  // ---------- data plane ----------

  async putChunk(nodeId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
    this.stats.puts += 1;
    const copy = new Uint8Array(bytes);
    await this.roundTrip(nodeId, (node) => {
      const cached = this.options.writeCacheNodes.includes(nodeId);
      node.chunks.set(chunkId, { bytes: copy, writtenAt: this.options.clock.now(), cached });
    });
  }

  async getChunk(nodeId: string, chunkId: string): Promise<Uint8Array> {
    this.stats.gets += 1;
    return this.roundTrip(nodeId, (node) => {
      const chunk = node.chunks.get(chunkId);
      if (!chunk) throw new ChunkNotFoundError(nodeId, chunkId);
      return new Uint8Array(chunk.bytes);
    });
  }

  async deleteChunk(nodeId: string, chunkId: string): Promise<void> {
    this.stats.deletes += 1;
    await this.roundTrip(nodeId, (node) => {
      node.chunks.delete(chunkId);
    });
  }

  async listChunks(nodeId: string): Promise<ChunkInfo[]> {
    this.stats.lists += 1;
    return this.roundTrip(nodeId, (node) =>
      [...node.chunks.entries()].map(([chunkId, c]) => ({
        chunkId,
        size: c.bytes.length,
        writtenAt: c.writtenAt,
      })),
    );
  }

  private async roundTrip<T>(nodeId: string, fn: (node: NodeState) => T): Promise<T> {
    const node = this.node(nodeId);
    const epoch = node.epoch;
    for (let i = 0; i < node.latency; i++) await tick();
    if (node.status !== 'up' || node.epoch !== epoch) throw new NodeUnavailableError(nodeId);
    return fn(node);
  }

  // ---------- fault injection ----------

  /** Powers the node off. Its disk keeps flushed chunks. */
  kill(nodeId: string): void {
    const node = this.node(nodeId);
    this.loseUnflushed(node);
    node.status = 'down';
    node.epoch += 1;
  }

  /** Powers a killed node back on. */
  revive(nodeId: string): void {
    const node = this.node(nodeId);
    if (node.status === 'down') node.status = 'up';
  }

  /** Kill then revive. */
  restart(nodeId: string): void {
    this.kill(nodeId);
    this.revive(nodeId);
  }

  /** Restarts every node, as after a power cut. */
  restartAll(): void {
    for (const n of this.nodes) this.restart(n.id);
  }

  /** The node keeps running and keeps its chunks, but no call can reach it. */
  partition(nodeId: string): void {
    const node = this.node(nodeId);
    if (node.status === 'up') {
      node.status = 'partitioned';
      node.epoch += 1;
    }
  }

  heal(nodeId: string): void {
    const node = this.node(nodeId);
    if (node.status === 'partitioned') node.status = 'up';
  }

  killAz(az: AzId): void {
    for (const n of this.nodes) if (n.az === az) this.kill(n.id);
  }

  reviveAz(az: AzId): void {
    for (const n of this.nodes) if (n.az === az) this.revive(n.id);
  }

  partitionAz(az: AzId): void {
    for (const n of this.nodes) if (n.az === az) this.partition(n.id);
  }

  healAz(az: AzId): void {
    for (const n of this.nodes) if (n.az === az) this.heal(n.id);
  }

  /** The node's disk is lost for good. The node comes back up empty, with the same id. */
  replaceNode(nodeId: string): void {
    const node = this.node(nodeId);
    node.chunks.clear();
    node.epoch += 1;
    node.status = 'up';
  }

  /** Flips one bit of a stored chunk in place. Default bit: the lowest bit of the middle byte. */
  flipBit(nodeId: string, chunkId: string, bitIndex?: number): void {
    const chunk = this.node(nodeId).chunks.get(chunkId);
    if (!chunk) throw new ChunkNotFoundError(nodeId, chunkId);
    if (chunk.bytes.length === 0) throw new Error('Cannot flip a bit in an empty chunk');
    const bit = bitIndex ?? Math.floor(chunk.bytes.length / 2) * 8;
    const byte = Math.floor(bit / 8);
    if (byte >= chunk.bytes.length) throw new Error('bitIndex out of range');
    chunk.bytes[byte] = chunk.bytes[byte]! ^ (1 << (bit % 8));
  }

  /** Makes every call to a node (or to every node of an AZ) take `turns` event-loop turns. Default: 1. */
  setLatency(target: string, turns: number): void {
    if (!Number.isInteger(turns) || turns < 1) throw new Error('turns must be a positive integer');
    const nodes = AZS.includes(target as AzId) ? this.nodes.filter((n) => n.az === target) : [this.node(target)];
    for (const n of nodes) this.node(n.id).latency = turns;
  }

  // ---------- inspection (tests only) ----------

  status(nodeId: string): NodeStatus {
    return this.node(nodeId).status;
  }

  /** Every chunk on every node, regardless of node status. */
  storedChunks(): { nodeId: string; chunkId: string; size: number }[] {
    const out: { nodeId: string; chunkId: string; size: number }[] = [];
    for (const node of this.state.values()) {
      for (const [chunkId, c] of node.chunks) out.push({ nodeId: node.id, chunkId, size: c.bytes.length });
    }
    return out;
  }

  /** Total bytes stored across all nodes, regardless of node status. */
  storedBytes(): number {
    let total = 0;
    for (const node of this.state.values()) for (const c of node.chunks.values()) total += c.bytes.length;
    return total;
  }

  hasChunk(nodeId: string, chunkId: string): boolean {
    return this.node(nodeId).chunks.has(chunkId);
  }

  private loseUnflushed(node: NodeState): void {
    const now = this.options.clock.now();
    for (const [id, c] of node.chunks) {
      if (c.cached && now < c.writtenAt + this.options.cacheFlushIntervalMs) node.chunks.delete(id);
      else c.cached = false;
    }
  }

  private node(nodeId: string): NodeState {
    const node = this.state.get(nodeId);
    if (!node) throw new Error(`Unknown storage node ${nodeId}`);
    return node;
  }
}
