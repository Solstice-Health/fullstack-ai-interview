/**
 * Simulated message queue with at-least-once delivery.
 *
 * `receive` hands out messages; a received message is hidden from other
 * receivers until it is acked or its visibility timeout passes, after which it
 * is delivered again. Like most real queues, it can also deliver a message more
 * than once even when consumers ack promptly (see `duplicateDeliveries`).
 */
import type { Clock } from '../shared/clock';
import { FakeClock } from '../shared/clock';
import { tick } from './tick';

export interface Delivery<T = unknown> {
  /** Unique per delivery. Pass it to `ack`. */
  deliveryId: string;
  /** Unique per published message; duplicates share it. */
  messageId: string;
  body: T;
  /** 1 on first delivery of this copy, then 2, 3... after visibility timeouts. */
  attempt: number;
}

export interface MessageQueue {
  /** Publishes a JSON-serialisable message to `topic`. */
  publish(topic: string, body: unknown): Promise<void>;
  /** Receives up to `max` (default 10) available messages from `topic`. */
  receive<T = unknown>(topic: string, opts?: { max?: number }): Promise<Delivery<T>[]>;
  /** Acknowledges a delivery so it is not delivered again. Acking twice is a no-op. */
  ack(deliveryId: string): Promise<void>;
}

export interface QueueOptions {
  clock: Clock;
  /** How long a received, unacked message stays hidden. Default: 30 seconds. */
  visibilityTimeoutMs: number;
  /**
   * Extra copies of every published message that consumers will receive.
   * Copies of one message never arrive in the same `receive` batch. Default: 1.
   */
  duplicateDeliveries: number;
}

interface Entry {
  messageId: string;
  body: unknown;
  attempt: number;
  hiddenUntil: number;
  deliveryId: string | null;
}

export class SimQueue implements MessageQueue {
  readonly options: QueueOptions;
  private readonly topics = new Map<string, Entry[]>();
  private seq = 0;
  /** Every message ever published, for tests. */
  readonly published: { topic: string; messageId: string; body: unknown }[] = [];

  constructor(options: Partial<QueueOptions> = {}) {
    this.options = {
      clock: options.clock ?? new FakeClock(),
      visibilityTimeoutMs: options.visibilityTimeoutMs ?? 30_000,
      duplicateDeliveries: options.duplicateDeliveries ?? 1,
    };
  }

  async publish(topic: string, body: unknown): Promise<void> {
    const copy = JSON.parse(JSON.stringify(body)) as unknown;
    await tick();
    const messageId = `msg-${++this.seq}`;
    const entries = this.entries(topic);
    for (let i = 0; i <= this.options.duplicateDeliveries; i++) {
      entries.push({ messageId, body: structuredClone(copy), attempt: 0, hiddenUntil: 0, deliveryId: null });
    }
    this.published.push({ topic, messageId, body: copy });
  }

  async receive<T = unknown>(topic: string, opts: { max?: number } = {}): Promise<Delivery<T>[]> {
    await tick();
    const max = opts.max ?? 10;
    const now = this.options.clock.now();
    const out: Delivery<T>[] = [];
    const inBatch = new Set<string>();
    for (const e of this.entries(topic)) {
      if (out.length >= max) break;
      if (e.hiddenUntil > now || inBatch.has(e.messageId)) continue;
      inBatch.add(e.messageId);
      e.attempt += 1;
      e.hiddenUntil = now + this.options.visibilityTimeoutMs;
      e.deliveryId = `dlv-${++this.seq}`;
      out.push({ deliveryId: e.deliveryId, messageId: e.messageId, body: structuredClone(e.body) as T, attempt: e.attempt });
    }
    return out;
  }

  async ack(deliveryId: string): Promise<void> {
    await tick();
    for (const entries of this.topics.values()) {
      const i = entries.findIndex((e) => e.deliveryId === deliveryId);
      if (i >= 0) {
        entries.splice(i, 1);
        return;
      }
    }
  }

  /** Messages not yet acked on `topic`, for tests. */
  pending(topic: string): number {
    return this.entries(topic).length;
  }

  private entries(topic: string): Entry[] {
    let e = this.topics.get(topic);
    if (!e) {
      e = [];
      this.topics.set(topic, e);
    }
    return e;
  }
}
