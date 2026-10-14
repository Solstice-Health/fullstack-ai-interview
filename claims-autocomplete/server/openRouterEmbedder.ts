// Real embeddings from OpenRouter (OpenAI-compatible POST {baseUrl}/embeddings).
// Only `npm run dev` uses this, and only when OPENROUTER_API_KEY is set. Tests always use FakeEmbedder.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbedderTimeoutError, type Embedder, type EmbedderOptions, type EmbedderStats } from './fakeEmbedder';

export interface OpenRouterEmbedderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Directory for the on-disk vector cache. Defaults to data/.cache/embeddings. */
  cacheDir?: string;
  /** Timeout of one embed() request, in ms. */
  timeoutMs?: number;
  /** Timeout of one batch request, in ms. */
  batchTimeoutMs?: number;
  /** Texts per HTTP request. */
  batchSize?: number;
  /** Batch requests in flight at once. */
  concurrency?: number;
  log?: (line: string) => void;
}

const DEFAULT_CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', '.cache', 'embeddings');
const MAGIC = 0x31424d45; // "EMB1"
const HEADER_BYTES = 8; // magic + dims
const HASH_BYTES = 16;
const QUERY_CACHE_SIZE = 5000;
const RETRIES = 3;

/**
 * Embedder backed by a hosted model. Same contract as FakeEmbedder: unit vectors,
 * `embed()` rejects with EmbedderTimeoutError on timeout or AbortError when `signal`
 * aborts, `embedBatch()` returns one vector per text in order.
 *
 * Every vector from embedBatch() is cached on disk per model, so restarts don't
 * re-embed the claims. Query vectors are cached in memory; a query whose caller
 * gave up still finishes in the background and lands in that cache.
 */
export class OpenRouterEmbedder implements Embedder {
  readonly stats: EmbedderStats = { calls: 0, batchCalls: 0, texts: 0 };
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly cacheFile: string;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly batchTimeoutMs: number;
  private readonly log: (line: string) => void;
  private timeoutMs: number;
  private dimsValue = 0;
  /** True once the cache file has a valid header for dimsValue. */
  private cacheOpen = false;
  private disk = new Map<string, Float32Array>();
  private queries = new Map<string, Float32Array>();
  private inflight = new Map<string, Promise<Float32Array>>();

  constructor(config: OpenRouterEmbedderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.model = config.model ?? 'openai/text-embedding-3-small';
    this.cacheFile = join(config.cacheDir ?? DEFAULT_CACHE_DIR, `${this.model.replace(/[^a-zA-Z0-9._-]+/g, '_')}.bin`);
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.batchTimeoutMs = config.batchTimeoutMs ?? 60_000;
    this.batchSize = config.batchSize ?? 256;
    this.concurrency = config.concurrency ?? 4;
    this.log = config.log ?? ((line) => console.log(line));
  }

  get dims(): number {
    return this.dimsValue;
  }

  get cachedVectors(): number {
    return this.disk.size;
  }

  /** Loads the disk cache and checks the API answers (also learns the vector size). */
  async init(): Promise<void> {
    this.loadCache();
    if (!this.dimsValue) {
      const [v] = await this.request(['dimension check'], this.timeoutMs);
      this.dimsValue = v!.length;
    }
  }

  /** Embeds and caches any of `texts` not cached yet, without counting toward stats. */
  async warm(texts: readonly string[]): Promise<void> {
    await this.fill(texts, undefined, true);
  }

  setOptions(options: EmbedderOptions): void {
    if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }

  embed(text: string, opts: { signal?: AbortSignal } = {}): Promise<Float32Array> {
    this.stats.calls++;
    this.stats.texts++;
    const key = hashText(text);
    const hit = this.queries.get(key) ?? this.disk.get(key);
    if (hit) return Promise.resolve(hit);
    let p = this.inflight.get(key);
    if (!p) {
      p = this.request([text], this.timeoutMs).then(
        ([v]) => {
          if (this.queries.size >= QUERY_CACHE_SIZE) this.queries.delete(this.queries.keys().next().value!);
          this.queries.set(key, v!);
          return v!;
        },
      );
      p.catch(() => {}).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return withSignal(p, opts.signal);
  }

  async embedBatch(texts: string[], opts: { signal?: AbortSignal } = {}): Promise<Float32Array[]> {
    this.stats.batchCalls++;
    this.stats.texts += texts.length;
    await this.fill(texts, opts.signal, false);
    return texts.map((t) => this.disk.get(hashText(t))!);
  }

  // ---------------------------------------------------------------------------

  private async fill(texts: readonly string[], signal: AbortSignal | undefined, progress: boolean): Promise<void> {
    const missing = new Map<string, string>();
    for (const t of texts) {
      const key = hashText(t);
      if (!this.disk.has(key)) missing.set(key, t);
    }
    if (missing.size === 0) return;
    const todo = [...missing.values()];
    const chunks: string[][] = [];
    for (let i = 0; i < todo.length; i += this.batchSize) chunks.push(todo.slice(i, i + this.batchSize));
    if (progress) this.log(`embedder: embedding ${todo.length} texts with ${this.model} (cached in ${relative(process.cwd(), this.cacheFile)})`);

    let done = 0;
    let lastLog = Date.now();
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++]!;
        const vectors = await this.requestWithRetry(chunk, signal);
        this.store(chunk, vectors);
        done += chunk.length;
        if (progress && (Date.now() - lastLog > 5000 || done === todo.length)) {
          lastLog = Date.now();
          this.log(`embedder: ${done}/${todo.length} embedded`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, chunks.length) }, worker));
  }

  private async requestWithRetry(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(texts, this.batchTimeoutMs, signal);
      } catch (err) {
        const retryable = err instanceof EmbedderTimeoutError || (err as { retryable?: boolean }).retryable;
        if (!retryable || attempt >= RETRIES || signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  private async request(input: string[], timeoutMs: number, signal?: AbortSignal): Promise<Float32Array[]> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    let body: { data?: { embedding: number[]; index: number }[]; error?: { message?: string } };
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      body = (await res.json().catch(() => ({}))) as typeof body;
    } catch (err) {
      if (timeout.aborted && !signal?.aborted) throw new EmbedderTimeoutError();
      if (signal?.aborted) throw abortError();
      throw Object.assign(new Error(`embeddings request failed: ${String(err)}`), { retryable: true });
    }
    if (!res.ok || !Array.isArray(body.data) || body.data.length !== input.length) {
      const msg = body.error?.message ?? `unexpected response (${body.data?.length ?? 0} of ${input.length} vectors)`;
      throw Object.assign(new Error(`embeddings HTTP ${res.status}: ${msg}`), {
        retryable: res.status === 429 || res.status >= 500 || res.ok,
      });
    }
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
  }

  private loadCache(): void {
    if (!existsSync(this.cacheFile)) return;
    const buf = readFileSync(this.cacheFile);
    if (buf.length < HEADER_BYTES || buf.readUInt32LE(0) !== MAGIC) {
      this.log(`embedder: ignoring unreadable cache ${this.cacheFile}`);
      return;
    }
    const dims = buf.readUInt32LE(4);
    const record = HASH_BYTES + dims * 4;
    const count = Math.floor((buf.length - HEADER_BYTES) / record);
    const whole = HEADER_BYTES + count * record;
    if (whole < buf.length) truncateSync(this.cacheFile, whole); // drop a half-written record
    for (let i = 0; i < count; i++) {
      const at = HEADER_BYTES + i * record;
      const key = buf.toString('hex', at, at + HASH_BYTES);
      const start = buf.byteOffset + at + HASH_BYTES;
      const vec =
        start % 4 === 0
          ? new Float32Array(buf.buffer, start, dims)
          : new Float32Array(buf.buffer.slice(start, start + dims * 4));
      this.disk.set(key, vec);
    }
    this.dimsValue = dims;
    this.cacheOpen = true;
  }

  private store(texts: string[], vectors: Float32Array[]): void {
    if (!this.dimsValue) this.dimsValue = vectors[0]!.length;
    mkdirSync(dirname(this.cacheFile), { recursive: true });
    if (!this.cacheOpen) {
      const header = Buffer.alloc(HEADER_BYTES);
      header.writeUInt32LE(MAGIC, 0);
      header.writeUInt32LE(this.dimsValue, 4);
      writeFileSync(this.cacheFile, header);
      this.cacheOpen = true;
    }
    const parts: Buffer[] = [];
    texts.forEach((t, i) => {
      const key = hashText(t);
      const v = vectors[i]!;
      if (this.disk.has(key) || v.length !== this.dimsValue) return;
      this.disk.set(key, v);
      parts.push(Buffer.from(key, 'hex'), Buffer.from(v.buffer, v.byteOffset, v.byteLength));
    });
    if (parts.length) appendFileSync(this.cacheFile, Buffer.concat(parts));
  }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, HASH_BYTES * 2);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/** Resolves with `p`, or rejects with AbortError as soon as `signal` aborts (`p` keeps running). */
function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}
