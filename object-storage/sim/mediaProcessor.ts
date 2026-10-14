/**
 * Simulated post-upload processing: thumbnails, text extraction and
 * embeddings for AI search. Every call to `process` does the work again and
 * adds one entry to the search index.
 */
import { sha256Hex } from '../shared/checksum';
import type { Clock } from '../shared/clock';
import { tick } from './tick';

export interface ProcessingJob {
  tenantId: string;
  bucket: string;
  key: string;
  versionId: string;
  bytes: Uint8Array;
}

export interface ProcessingResult {
  tenantId: string;
  bucket: string;
  key: string;
  versionId: string;
  size: number;
  sha256: string;
  thumbnail: string;
  extractedText: string;
  processedAt: number;
}

export interface MediaProcessor {
  /** Generates derivatives for one object version and writes them to the search index. */
  process(job: ProcessingJob): Promise<ProcessingResult>;
}

export class SimMediaProcessor implements MediaProcessor {
  /** The search index: one entry per `process` call. */
  readonly results: ProcessingResult[] = [];

  constructor(private readonly clock: Clock) {}

  async process(job: ProcessingJob): Promise<ProcessingResult> {
    await tick();
    const sha256 = sha256Hex(job.bytes);
    const result: ProcessingResult = {
      tenantId: job.tenantId,
      bucket: job.bucket,
      key: job.key,
      versionId: job.versionId,
      size: job.bytes.length,
      sha256,
      thumbnail: `thumb-${sha256.slice(0, 12)}.webp`,
      extractedText: `text extracted from ${job.key}`,
      processedAt: this.clock.now(),
    };
    await tick();
    this.results.push(result);
    return result;
  }
}
