import { EMBEDDING_DIMS, vectorFor } from '../data/embeddingModel';
import { createRng } from '../shared/random';

/**
 * Stand-in for a hosted text-embedding API.
 *
 * Vectors are deterministic: the same text always gives the same unit vector, and
 * texts that mean the same thing (for example "heart attack" and "myocardial
 * infarction") point in nearly the same direction. Compare vectors with cosine
 * similarity (`cosine()` below). Text with no meaningful words embeds to the zero vector.
 *
 * Like the real thing, calls go over the network: each call takes time and some
 * calls time out. Calls are not affected by the FakeClock.
 */
export interface EmbedderOptions {
  /** Median latency of one call, in ms. */
  latencyMs?: number;
  /** Spread of the latency distribution (log-normal sigma). 0 = always exactly latencyMs. */
  latencyJitter?: number;
  /** Fraction of embed() calls that time out. */
  timeoutRate?: number;
  /** How long a timed-out call takes before it rejects with EmbedderTimeoutError, in ms. */
  timeoutMs?: number;
  /** Seed for latency and timeout decisions. */
  seed?: number;
}

export const DEFAULT_EMBEDDER_OPTIONS: Required<EmbedderOptions> = {
  latencyMs: 80,
  latencyJitter: 0.3,
  timeoutRate: 0.05,
  timeoutMs: 3000,
  seed: 7,
};

export class EmbedderTimeoutError extends Error {
  constructor() {
    super('embedding request timed out');
    this.name = 'EmbedderTimeoutError';
  }
}

export interface EmbedderStats {
  /** Number of embed() calls. */
  calls: number;
  /** Number of embedBatch() calls. */
  batchCalls: number;
  /** Total texts embedded by either method. */
  texts: number;
}

/**
 * What the app needs from an embedder. FakeEmbedder implements it; `npm run dev`
 * swaps in OpenRouterEmbedder when OPENROUTER_API_KEY is set.
 */
export interface Embedder {
  /** Length of every vector this embedder returns. */
  readonly dims: number;
  readonly stats: EmbedderStats;
  setOptions(options: EmbedderOptions): void;
  embed(text: string, opts?: { signal?: AbortSignal }): Promise<Float32Array>;
  embedBatch(texts: string[], opts?: { signal?: AbortSignal }): Promise<Float32Array[]>;
}

export class FakeEmbedder implements Embedder {
  readonly dims = EMBEDDING_DIMS;
  readonly stats: EmbedderStats = { calls: 0, batchCalls: 0, texts: 0 };
  private options: Required<EmbedderOptions>;
  private rng: () => number;

  constructor(options: EmbedderOptions = {}) {
    this.options = { ...DEFAULT_EMBEDDER_OPTIONS, ...options };
    this.rng = createRng(this.options.seed);
  }

  /** Changes options from now on (calls already in flight keep their old behaviour). */
  setOptions(options: EmbedderOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Embeds one text (typically a user query).
   * Rejects with EmbedderTimeoutError on timeout, or with an AbortError if `signal` aborts first.
   */
  embed(text: string, opts: { signal?: AbortSignal } = {}): Promise<Float32Array> {
    this.stats.calls++;
    this.stats.texts++;
    const timesOut = this.rng() < this.options.timeoutRate;
    const delay = timesOut ? this.options.timeoutMs : this.sampleLatency();
    return this.respond(delay, opts.signal, () => {
      if (timesOut) throw new EmbedderTimeoutError();
      return vectorFor(text);
    });
  }

  /** Embeds many texts in one call (typically claims, for indexing). One round trip for the whole batch. */
  embedBatch(texts: string[], opts: { signal?: AbortSignal } = {}): Promise<Float32Array[]> {
    this.stats.batchCalls++;
    this.stats.texts += texts.length;
    return this.respond(this.sampleLatency(), opts.signal, () => texts.map(vectorFor));
  }

  private sampleLatency(): number {
    const { latencyMs, latencyJitter } = this.options;
    if (latencyMs <= 0) return 0;
    // Box-Muller normal sample -> log-normal latency with median latencyMs.
    const u = Math.max(this.rng(), 1e-9);
    const v = this.rng();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return latencyMs * Math.exp(latencyJitter * z);
  }

  private respond<T>(delay: number, signal: AbortSignal | undefined, produce: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        try {
          resolve(produce());
        } catch (err) {
          reject(err);
        }
      }, delay);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/** Cosine similarity of two vectors (0 when either is the zero vector). */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

