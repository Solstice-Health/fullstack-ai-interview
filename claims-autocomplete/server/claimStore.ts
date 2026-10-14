import type { Clock } from '../shared/clock';
import { createRng } from '../shared/random';
import type { Citation, Claim } from '../shared/types';

/**
 * In-memory source of truth for claims (stands in for the claims table in Postgres).
 *
 * Reads are synchronous and always current. Claim objects are frozen: a change
 * replaces the object, it never mutates it, so it is safe to keep references.
 *
 * Every change also produces a ClaimChangeEvent, delivered to `onChange`
 * listeners asynchronously, like rows read from an outbox table by a relay.
 * All events produced by one write call are delivered together, in `seq` order.
 *
 * Expiry is not a change: a claim whose `expiresAt` passes keeps its status and
 * no event is produced.
 */
export interface ClaimStoreOptions {
  /** Fraction of change events that are never delivered. */
  eventDropRate?: number;
  /** Seed for event delivery decisions. */
  seed?: number;
}

export const DEFAULT_CLAIM_STORE_OPTIONS: Required<ClaimStoreOptions> = {
  eventDropRate: 0.02,
  seed: 11,
};

export interface ClaimChangeEvent {
  /** Increases by 1 for every change, across all claims. */
  seq: number;
  type: 'approved' | 'revoked';
  claimId: string;
  brandId: string;
  /** The claim's version after the change. */
  version: number;
  /** Clock time of the change (ms since epoch). */
  at: number;
}

/** A claim as sent by the MLR tool. Omit `id` for a new claim; pass an existing id to publish a new version. */
export interface ClaimDraft {
  id?: string;
  brandId: string;
  text: string;
  markets: string[];
  channels: string[];
  expiresAt: string;
  citations: Citation[];
}

export interface ClaimStoreStats {
  /** Number of read calls (get, getMany, listByBrand, listAll). */
  reads: number;
  /** Number of claims written. */
  writes: number;
}

export type ChangeListener = (event: ClaimChangeEvent) => void;

export class ClaimStore {
  readonly stats: ClaimStoreStats = { reads: 0, writes: 0 };
  private claims = new Map<string, Claim>();
  private byBrand = new Map<string, Set<string>>();
  private brandClient = new Map<string, string>();
  private listeners = new Set<ChangeListener>();
  private seq = 0;
  private nextId: number;
  private options: Required<ClaimStoreOptions>;
  private rng: () => number;
  private outbox: ClaimChangeEvent[] = [];
  private flushScheduled = false;

  constructor(
    claims: readonly Claim[],
    private readonly clock: Clock,
    options: ClaimStoreOptions = {},
  ) {
    this.options = { ...DEFAULT_CLAIM_STORE_OPTIONS, ...options };
    this.rng = createRng(this.options.seed);
    let maxId = 0;
    for (const claim of claims) {
      this.put(deepFreeze(claim));
      this.brandClient.set(claim.brandId, claim.clientId);
      maxId = Math.max(maxId, Number(claim.id.replace(/\D/g, '')) || 0);
    }
    this.nextId = maxId + 1;
  }

  /** Changes options from now on. */
  setOptions(options: ClaimStoreOptions): void {
    this.options = { ...this.options, ...options };
  }

  get(id: string): Claim | undefined {
    this.stats.reads++;
    return this.claims.get(id);
  }

  getMany(ids: readonly string[]): (Claim | undefined)[] {
    this.stats.reads++;
    return ids.map((id) => this.claims.get(id));
  }

  /** All claims of a brand, any status, in no particular order. */
  listByBrand(brandId: string): Claim[] {
    this.stats.reads++;
    return [...(this.byBrand.get(brandId) ?? [])].map((id) => this.claims.get(id)!);
  }

  /** Every claim, any status, in no particular order. */
  listAll(): Claim[] {
    this.stats.reads++;
    return [...this.claims.values()];
  }

  /** Seq of the most recent change (0 if none yet). */
  lastSeq(): number {
    return this.seq;
  }

  /** Revokes a claim. Its version increases by 1. */
  revoke(id: string): Claim {
    const current = this.claims.get(id);
    if (!current) throw new Error(`unknown claim ${id}`);
    const next = deepFreeze({ ...current, status: 'revoked' as const, version: current.version + 1 });
    this.put(next);
    this.emit('revoked', next);
    return next;
  }

  /**
   * Approves a batch of claims in one transaction (e.g. after an MLR meeting).
   * New claims get an id and version 1; existing ids get version + 1. All come back as approved.
   */
  approveBatch(drafts: readonly ClaimDraft[]): Claim[] {
    const out: Claim[] = [];
    for (const d of drafts) {
      const clientId = this.brandClient.get(d.brandId);
      if (!clientId) throw new Error(`unknown brand ${d.brandId}`);
      const existing = d.id ? this.claims.get(d.id) : undefined;
      if (existing && existing.brandId !== d.brandId) throw new Error(`claim ${d.id} belongs to ${existing.brandId}`);
      const id = d.id ?? `clm_${String(this.nextId++).padStart(6, '0')}`;
      const claim = deepFreeze<Claim>({
        id,
        brandId: d.brandId,
        clientId,
        text: d.text,
        status: 'approved',
        markets: [...d.markets],
        channels: [...d.channels],
        expiresAt: d.expiresAt,
        version: existing ? existing.version + 1 : 1,
        citations: d.citations.map((c) => ({ ...c })),
      });
      this.put(claim);
      out.push(claim);
    }
    for (const claim of out) this.emit('approved', claim);
    return out;
  }

  /** Subscribes to change events. Returns an unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private put(claim: Claim): void {
    this.stats.writes++;
    this.claims.set(claim.id, claim);
    let ids = this.byBrand.get(claim.brandId);
    if (!ids) this.byBrand.set(claim.brandId, (ids = new Set()));
    ids.add(claim.id);
  }

  private emit(type: ClaimChangeEvent['type'], claim: Claim): void {
    const event: ClaimChangeEvent = {
      seq: ++this.seq,
      type,
      claimId: claim.id,
      brandId: claim.brandId,
      version: claim.version,
      at: this.clock.now(),
    };
    if (this.rng() < this.options.eventDropRate) return;
    this.outbox.push(event);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => this.flush());
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    const events = this.outbox;
    this.outbox = [];
    for (const event of events) {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error('claimStore: onChange listener threw', err);
        }
      }
    }
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}
