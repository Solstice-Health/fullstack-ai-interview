/**
 * Process crashes.
 *
 * Every call the server makes to the cluster, the metadata database and the
 * queue is a "step". A test can arm a crash so the server process dies just
 * before a chosen step. After a crash, every further call from that process
 * throws `CrashError`, as if the machine had lost power. The cluster, database
 * and queue keep whatever reached them. `Simulation.restartProcess()` starts a
 * new process against the same cluster, database and queue.
 */

export type StepKind =
  | 'chunk.write'
  | 'chunk.delete'
  | 'db.write'
  | 'queue.publish'
  | 'queue.ack';

export interface StepRecord {
  kind: StepKind;
  /** Free-form detail for debugging, e.g. the node id or the start of the SQL. */
  detail: string;
}

export class CrashError extends Error {
  constructor(message = 'Simulated process crash') {
    super(message);
    this.name = 'CrashError';
  }
}

type Trigger =
  | { type: 'nth'; remaining: number }
  | { type: 'kind'; kind: StepKind; after?: StepKind; seenAfter: boolean };

export class CrashController {
  private generation = 0;
  private dead = false;
  private trigger: Trigger | null = null;
  private log: StepRecord[] = [];
  /** How many crashes have fired so far. */
  crashes = 0;

  /** Steps recorded since the last `resetLog()`. Only steps from the live process are recorded. */
  get steps(): readonly StepRecord[] {
    return this.log;
  }

  resetLog(): void {
    this.log = [];
  }

  /** Crash just before the n-th step (1-based) from now. */
  crashBeforeStep(n: number): void {
    if (!Number.isInteger(n) || n < 1) throw new Error('n must be a positive integer');
    this.trigger = { type: 'nth', remaining: n };
  }

  /**
   * Crash just before the next step of `kind`. With `after`, only a step of
   * `kind` that comes after at least one step of the `after` kind counts.
   */
  crashBefore(kind: StepKind, opts: { after?: StepKind } = {}): void {
    this.trigger = { type: 'kind', kind, after: opts.after, seenAfter: false };
  }

  /** Cancel an armed crash that has not fired. */
  disarm(): void {
    this.trigger = null;
  }

  get armed(): boolean {
    return this.trigger !== null;
  }

  /** The generation number of the live process. */
  get currentGeneration(): number {
    return this.generation;
  }

  /** Starts a new process generation. Used by `Simulation.restartProcess()`. */
  restart(): number {
    this.generation += 1;
    this.dead = false;
    return this.generation;
  }

  /** Throws if the process of `generation` is no longer alive. */
  assertAlive(generation: number): void {
    if (generation !== this.generation || this.dead) {
      throw new CrashError('This process has crashed; restart it with Simulation.restartProcess()');
    }
  }

  /** Records a step from the process of `generation`. Throws `CrashError` if a crash fires here. */
  step(generation: number, kind: StepKind, detail = ''): void {
    this.assertAlive(generation);
    const t = this.trigger;
    let fire = false;
    if (t?.type === 'nth') {
      t.remaining -= 1;
      fire = t.remaining === 0;
    } else if (t?.type === 'kind') {
      if (kind === t.kind && (!t.after || t.seenAfter)) fire = true;
      if (t.after && kind === t.after) t.seenAfter = true;
    }
    if (fire) {
      this.trigger = null;
      this.dead = true;
      this.crashes += 1;
      throw new CrashError(`Simulated crash before ${kind}${detail ? ` (${detail})` : ''}`);
    }
    this.log.push({ kind, detail });
  }
}
