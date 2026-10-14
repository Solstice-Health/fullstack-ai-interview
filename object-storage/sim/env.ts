/**
 * Wires the simulated world together.
 *
 *   const sim = await Simulation.create();
 *   const store = new ObjectStore(sim.env());
 *
 * `sim.env()` is what the server process gets. Every call through it is
 * recorded as a step by `sim.crash` (see crash.ts). `sim.restartProcess()`
 * simulates the server process dying and starting again: a new env over the
 * same cluster, database and queue. In-memory state of the old process is gone.
 */
import type { Clock } from '../shared/clock';
import { FakeClock } from '../shared/clock';
import type { StorageCluster } from './cluster';
import { SimCluster, type ClusterOptions } from './cluster';
import { CrashController } from './crash';
import type { MediaProcessor } from './mediaProcessor';
import { SimMediaProcessor } from './mediaProcessor';
import { MetadataDb, isWriteStatement, type SqlDatabase } from './metadataDb';
import type { MessageQueue } from './queue';
import { SimQueue, type QueueOptions } from './queue';

/** Everything the server process can use. */
export interface StoreEnv {
  /** 9 storage nodes in 3 AZs. */
  cluster: StorageCluster;
  /** Metadata database (SQLite syntax, standing in for Postgres). */
  db: SqlDatabase;
  clock: Clock;
  /** At-least-once message queue. */
  queue: MessageQueue;
  /** Thumbnails, text extraction and search indexing for one object version. */
  mediaProcessor: MediaProcessor;
  /** Server-side secret, e.g. for signing URLs. Never sent to clients. */
  secret: string;
}

export interface SimulationOptions {
  /** Simulated start time. Default: 2026-01-01T00:00:00Z. */
  startTime?: number;
  cluster?: Partial<Omit<ClusterOptions, 'clock'>>;
  queue?: Partial<Omit<QueueOptions, 'clock'>>;
}

export class Simulation {
  readonly crash = new CrashController();
  private current: StoreEnv;

  private constructor(
    readonly clock: FakeClock,
    readonly cluster: SimCluster,
    readonly db: MetadataDb,
    readonly queue: SimQueue,
    readonly mediaProcessor: SimMediaProcessor,
    readonly secret: string,
  ) {
    this.current = this.makeEnv(this.crash.currentGeneration);
  }

  static async create(opts: SimulationOptions = {}): Promise<Simulation> {
    const clock = new FakeClock(opts.startTime ?? Date.UTC(2026, 0, 1));
    const cluster = new SimCluster({ ...opts.cluster, clock });
    const db = await MetadataDb.create();
    const queue = new SimQueue({ ...opts.queue, clock });
    const processor = new SimMediaProcessor(clock);
    return new Simulation(clock, cluster, db, queue, processor, 'sim-secret-7f3a9c2e5b1d');
  }

  /** The env of the live server process. */
  env(): StoreEnv {
    return this.current;
  }

  /** Simulates a process restart and returns the new process's env. */
  restartProcess(): StoreEnv {
    const generation = this.crash.restart();
    this.current = this.makeEnv(generation);
    return this.current;
  }

  private makeEnv(generation: number): StoreEnv {
    const crash = this.crash;
    const cluster = this.cluster;
    const db = this.db;
    const queue = this.queue;
    const processor = this.mediaProcessor;
    const alive = () => crash.assertAlive(generation);
    // A crash cannot interrupt the middle of a synchronous transaction, so the
    // whole transaction is one step, checked before it starts.
    const step = (kind: Parameters<CrashController['step']>[1], detail: string) =>
      crash.step(generation, kind, detail);
    const after = async <T>(p: Promise<T>): Promise<T> => {
      const v = await p;
      alive();
      return v;
    };

    const envCluster: StorageCluster = {
      nodes: cluster.nodes,
      putChunk: async (nodeId, chunkId, bytes) => {
        step('chunk.write', nodeId);
        return after(cluster.putChunk(nodeId, chunkId, bytes));
      },
      getChunk: async (nodeId, chunkId) => {
        alive();
        return after(cluster.getChunk(nodeId, chunkId));
      },
      deleteChunk: async (nodeId, chunkId) => {
        step('chunk.delete', nodeId);
        return after(cluster.deleteChunk(nodeId, chunkId));
      },
      listChunks: async (nodeId) => {
        alive();
        return after(cluster.listChunks(nodeId));
      },
    };

    const sqlDetail = (sql: string) => sql.trim().replace(/\s+/g, ' ').slice(0, 60);
    const envDb: SqlDatabase = {
      exec: (sql) => {
        if (!db.inTransaction) step('db.write', sqlDetail(sql));
        else alive();
        db.exec(sql);
      },
      run: (sql, params) => {
        if (!db.inTransaction) step('db.write', sqlDetail(sql));
        else alive();
        return db.run(sql, params);
      },
      get: (sql, params) => {
        if (!db.inTransaction && isWriteStatement(sql)) step('db.write', sqlDetail(sql));
        else alive();
        return db.get(sql, params);
      },
      all: (sql, params) => {
        if (!db.inTransaction && isWriteStatement(sql)) step('db.write', sqlDetail(sql));
        else alive();
        return db.all(sql, params);
      },
      transaction: (fn) => {
        if (!db.inTransaction) step('db.write', 'transaction');
        else alive();
        return db.transaction(fn);
      },
    };

    const envQueue: MessageQueue = {
      publish: async (topic, body) => {
        step('queue.publish', topic);
        return after(queue.publish(topic, body));
      },
      receive: async (topic, opts) => {
        alive();
        return after(queue.receive(topic, opts));
      },
      ack: async (deliveryId) => {
        step('queue.ack', deliveryId);
        return after(queue.ack(deliveryId));
      },
    };

    const envProcessor: MediaProcessor = {
      process: async (job) => {
        alive();
        return after(processor.process(job));
      },
    };

    return {
      cluster: envCluster,
      db: envDb,
      clock: this.clock,
      queue: envQueue,
      mediaProcessor: envProcessor,
      secret: this.secret,
    };
  }
}
