/**
 * Fake network between the browser and the upload server, like hotel Wi-Fi.
 *
 * Each request is delivered to the server at once; its response comes back
 * after `latencyMs`. When the connection drops, every response still in
 * flight is lost (the server already processed those requests) and new
 * requests fail with `NetworkError` until the connection comes back
 * `outageMs` later.
 */
import { NetworkError, type UploadApi } from './uploadApi';

export interface FlakyNetworkOptions {
  /** Delay before each response arrives. Default: 20 ms. */
  latencyMs: number;
  /** The connection drops when this many requests have been sent. Default: [6]. Use [] for a stable network. */
  dropAfterRequests: number[];
  /** How long the connection stays down after a drop. Default: 300 ms. */
  outageMs: number;
}

export class FlakyNetwork implements UploadApi {
  readonly options: FlakyNetworkOptions;
  /** Requests sent, including those that failed. */
  requests = 0;
  /** How many times the connection has dropped. */
  drops = 0;
  private offlineUntil = 0;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly server: UploadApi,
    options: Partial<FlakyNetworkOptions> = {},
  ) {
    this.options = {
      latencyMs: options.latencyMs ?? 20,
      dropAfterRequests: options.dropAfterRequests ?? [6],
      outageMs: options.outageMs ?? 300,
    };
  }

  get online(): boolean {
    return Date.now() >= this.offlineUntil;
  }

  /** Drops the connection now. */
  dropNow(): void {
    this.drops += 1;
    this.generation += 1;
    this.offlineUntil = Date.now() + this.options.outageMs;
    for (const l of this.listeners) l();
  }

  /** Subscribes to drops; returns an unsubscribe function. */
  onDrop(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createMultipartUpload(key: string) {
    return this.send(() => this.server.createMultipartUpload(key));
  }

  uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array, crc32c: string) {
    return this.send(() => this.server.uploadPart(uploadId, partNumber, bytes, crc32c));
  }

  listParts(uploadId: string) {
    return this.send(() => this.server.listParts(uploadId));
  }

  completeMultipartUpload(uploadId: string, parts: { partNumber: number; etag: string }[]) {
    return this.send(() => this.server.completeMultipartUpload(uploadId, parts));
  }

  private async send<T>(request: () => Promise<T>): Promise<T> {
    this.requests += 1;
    if (!this.online) {
      await sleep(Math.min(this.options.latencyMs, 5));
      throw new NetworkError('Network is offline');
    }
    const generation = this.generation;
    const response = request().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (this.options.dropAfterRequests.includes(this.requests)) queueMicrotask(() => this.dropNow());
    await sleep(this.options.latencyMs);
    const settled = await response;
    if (generation !== this.generation) throw new NetworkError('Connection reset');
    if (!settled.ok) throw settled.error;
    return settled.value;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
