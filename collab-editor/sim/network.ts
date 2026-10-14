import { Rng } from './random';

/**
 * One end of a connection between a client and the server.
 *
 * Messages are opaque to the network: send any JSON-serialisable value. The receiver
 * gets a deserialised copy, never the sender's object.
 */
export interface Transport {
  /** Whether the connection is currently up. */
  readonly connected: boolean;
  /**
   * Sends a message to the other end. Messages on one connection arrive in the order
   * they were sent. If the connection is down, or goes down before delivery, the
   * message is lost.
   */
  send(message: unknown): void;
  /** Registers a handler for messages from the other end. */
  onMessage(handler: (message: unknown) => void): void;
  /** Registers a handler called when the connection goes down (false) or comes back (true). */
  onConnectionChange(handler: (connected: boolean) => void): void;
}

/** Simulated clock and timers. */
export interface Scheduler {
  /** Current simulated time in ms. */
  readonly now: number;
  /** Runs `fn` after `delayMs` of simulated time. */
  schedule(delayMs: number, fn: () => void): void;
}

export interface NetworkOptions {
  /** Seed for every random choice the network makes. */
  seed: number;
  /** Smallest one-way delay in ms. Default 5. */
  minDelayMs?: number;
  /** Largest one-way delay in ms. Default 150. */
  maxDelayMs?: number;
  /**
   * After a reconnect, the network re-sends this many of the most recent messages the
   * client delivered to the server, before anything sent after the reconnect. Default 3.
   */
  resendOnReconnect?: number;
  /** Called for every network event. Useful when debugging a failing seed. */
  trace?: (event: NetworkEvent) => void;
}

export type Direction = 'toServer' | 'toClient';

export type NetworkEvent =
  | { type: 'send' | 'deliver' | 'drop' | 'resend'; at: number; clientId: string; direction: Direction; message: unknown }
  | { type: 'disconnect' | 'reconnect'; at: number; clientId: string };

export interface Connection {
  /** The client's end: messages sent here go to the server. */
  client: Transport;
  /** The server's end: messages sent here go to the client. */
  server: Transport;
}

export interface NetworkStats {
  sent: number;
  delivered: number;
  dropped: number;
  resent: number;
}

interface Endpoint extends Transport {
  readonly messageHandlers: Array<(message: unknown) => void>;
  readonly connectionHandlers: Array<(connected: boolean) => void>;
}

interface Link {
  clientId: string;
  connected: boolean;
  /** Bumped on every disconnect; deliveries from an older epoch are dropped. */
  epoch: number;
  lastDeliveryAt: Record<Direction, number>;
  /** Recent serialised client→server messages that reached the server. */
  recentToServer: string[];
  client: Endpoint;
  server: Endpoint;
}

interface TimedEvent {
  at: number;
  order: number;
  run: () => void;
}

/**
 * Deterministic network simulator: one server, any number of clients, simulated time.
 *
 * Nothing happens until the test (or the web UI) moves time forward with `advance` or
 * `runUntilQuiet`. Delivery order depends only on the seed.
 */
export class SimNetwork implements Scheduler {
  readonly stats: NetworkStats = { sent: 0, delivered: 0, dropped: 0, resent: 0 };

  private readonly rng: Rng;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly resendOnReconnect: number;
  private readonly trace?: (event: NetworkEvent) => void;
  private readonly links = new Map<string, Link>();
  private readonly queue = new EventQueue();
  private clock = 0;
  private order = 0;

  constructor(options: NetworkOptions) {
    this.rng = new Rng(options.seed);
    this.minDelayMs = options.minDelayMs ?? 5;
    this.maxDelayMs = options.maxDelayMs ?? 150;
    this.resendOnReconnect = options.resendOnReconnect ?? 3;
    this.trace = options.trace;
    if (this.minDelayMs < 0 || this.maxDelayMs < this.minDelayMs) {
      throw new Error('need 0 <= minDelayMs <= maxDelayMs');
    }
  }

  get now(): number {
    return this.clock;
  }

  /** Creates a connection for `clientId`. It starts connected. */
  connect(clientId: string): Connection {
    if (this.links.has(clientId)) throw new Error(`client ${clientId} is already connected`);
    const link: Link = {
      clientId,
      connected: true,
      epoch: 0,
      lastDeliveryAt: { toServer: 0, toClient: 0 },
      recentToServer: [],
      client: undefined as unknown as Endpoint,
      server: undefined as unknown as Endpoint,
    };
    link.client = this.makeEndpoint(link, 'toServer');
    link.server = this.makeEndpoint(link, 'toClient');
    this.links.set(clientId, link);
    return { client: link.client, server: link.server };
  }

  /** Drops the connection. Messages in flight in both directions are lost. */
  disconnect(clientId: string): void {
    const link = this.link(clientId);
    if (!link.connected) return;
    link.connected = false;
    link.epoch++;
    this.emit({ type: 'disconnect', at: this.clock, clientId });
    for (const handler of [...link.server.connectionHandlers]) handler(false);
    for (const handler of [...link.client.connectionHandlers]) handler(false);
  }

  /** Brings the connection back up. */
  reconnect(clientId: string): void {
    const link = this.link(clientId);
    if (link.connected) return;
    link.connected = true;
    this.emit({ type: 'reconnect', at: this.clock, clientId });
    const recent = this.resendOnReconnect > 0 ? link.recentToServer.slice(-this.resendOnReconnect) : [];
    for (const payload of recent) {
      this.stats.resent++;
      this.emit({ type: 'resend', at: this.clock, clientId, direction: 'toServer', message: JSON.parse(payload) });
      this.transmit(link, 'toServer', payload);
    }
    for (const handler of [...link.server.connectionHandlers]) handler(true);
    for (const handler of [...link.client.connectionHandlers]) handler(true);
  }

  isConnected(clientId: string): boolean {
    return this.link(clientId).connected;
  }

  schedule(delayMs: number, fn: () => void): void {
    if (!(delayMs >= 0)) throw new Error(`invalid delay ${delayMs}`);
    this.queue.push({ at: this.clock + delayMs, order: this.order++, run: fn });
  }

  /** Moves simulated time forward by `ms`, running everything due on the way. */
  advance(ms: number): void {
    const until = this.clock + ms;
    for (let next = this.queue.peek(); next && next.at <= until; next = this.queue.peek()) {
      this.queue.pop();
      this.clock = next.at;
      next.run();
    }
    this.clock = until;
  }

  /**
   * Runs until no messages are in flight and no timers are pending.
   * Throws if that takes more than `maxEvents` events.
   */
  runUntilQuiet(options: { maxEvents?: number } = {}): void {
    const maxEvents = options.maxEvents ?? 1_000_000;
    let count = 0;
    for (let next = this.queue.pop(); next; next = this.queue.pop()) {
      if (++count > maxEvents) {
        throw new Error(`network still busy after ${maxEvents} events (t=${this.clock}ms)`);
      }
      this.clock = Math.max(this.clock, next.at);
      next.run();
    }
  }

  /**
   * Advances time in `stepMs` steps until `predicate()` is true.
   * Throws if it is still false after `timeoutMs`.
   */
  advanceUntil(predicate: () => boolean, options: { timeoutMs?: number; stepMs?: number } = {}): void {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const stepMs = options.stepMs ?? 10;
    const deadline = this.clock + timeoutMs;
    while (!predicate()) {
      if (this.clock >= deadline) throw new Error(`condition still false after ${timeoutMs}ms`);
      this.advance(stepMs);
    }
  }

  /** Number of queued events (messages in flight plus timers). */
  pendingEvents(): number {
    return this.queue.size;
  }

  private link(clientId: string): Link {
    const link = this.links.get(clientId);
    if (!link) throw new Error(`unknown client ${clientId}`);
    return link;
  }

  private makeEndpoint(link: Link, direction: Direction): Endpoint {
    const messageHandlers: Array<(message: unknown) => void> = [];
    const connectionHandlers: Array<(connected: boolean) => void> = [];
    return {
      messageHandlers,
      connectionHandlers,
      get connected() {
        return link.connected;
      },
      send: (message: unknown) => {
        const payload = JSON.stringify(message);
        if (payload === undefined) throw new Error('message is not JSON-serialisable');
        this.stats.sent++;
        this.emit({ type: 'send', at: this.clock, clientId: link.clientId, direction, message: JSON.parse(payload) });
        if (!link.connected) {
          this.stats.dropped++;
          this.emit({ type: 'drop', at: this.clock, clientId: link.clientId, direction, message: JSON.parse(payload) });
          return;
        }
        this.transmit(link, direction, payload);
      },
      onMessage: (handler) => {
        messageHandlers.push(handler);
      },
      onConnectionChange: (handler) => {
        connectionHandlers.push(handler);
      },
    };
  }

  private transmit(link: Link, direction: Direction, payload: string): void {
    const delay = this.rng.int(this.minDelayMs, this.maxDelayMs);
    const at = Math.max(this.clock + delay, link.lastDeliveryAt[direction]);
    link.lastDeliveryAt[direction] = at;
    const epoch = link.epoch;
    this.queue.push({
      at,
      order: this.order++,
      run: () => {
        if (link.epoch !== epoch || !link.connected) {
          this.stats.dropped++;
          this.emit({ type: 'drop', at: this.clock, clientId: link.clientId, direction, message: JSON.parse(payload) });
          return;
        }
        this.stats.delivered++;
        if (direction === 'toServer') {
          link.recentToServer.push(payload);
          if (link.recentToServer.length > 32) link.recentToServer.shift();
        }
        const message = JSON.parse(payload) as unknown;
        this.emit({ type: 'deliver', at: this.clock, clientId: link.clientId, direction, message });
        const receiver = direction === 'toServer' ? link.server : link.client;
        for (const handler of [...receiver.messageHandlers]) handler(message);
      },
    });
  }

  private emit(event: NetworkEvent): void {
    this.trace?.(event);
  }
}

/** Min-heap ordered by (at, order). */
class EventQueue {
  private readonly heap: TimedEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  peek(): TimedEvent | undefined {
    return this.heap[0];
  }

  push(event: TimedEvent): void {
    const heap = this.heap;
    heap.push(event);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i]!, heap[parent]!)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
      i = parent;
    }
  }

  pop(): TimedEvent | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && before(heap[left]!, heap[smallest]!)) smallest = left;
        if (right < heap.length && before(heap[right]!, heap[smallest]!)) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

function before(a: TimedEvent, b: TimedEvent): boolean {
  return a.at < b.at || (a.at === b.at && a.order < b.order);
}
