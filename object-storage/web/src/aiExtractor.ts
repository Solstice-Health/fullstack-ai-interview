/**
 * Post-upload processing for the dev UI. Uses the dev server's AI proxy
 * (server/aiProxy.ts) when OPENROUTER_API_KEY is set, otherwise the simulated
 * extractor. Tests never load this file.
 */
import type { Clock } from '../../shared/clock';
import {
  SimMediaProcessor,
  simulatedExtractor,
  type ContentExtractor,
} from '../../sim/mediaProcessor';

export interface AiStatus {
  enabled: boolean;
  model?: string;
  embeddingModel?: string;
}

const wallClock: Clock = { now: () => Date.now(), date: () => new Date() };
const TIMEOUT_MS = 45_000;

let status: Promise<AiStatus> | undefined;

/** Whether the dev server has a key. Any failure means simulated. */
export function aiStatus(): Promise<AiStatus> {
  status ??= fetch('/api/ai/status')
    .then((r) => (r.ok ? (r.json() as Promise<AiStatus>) : { enabled: false }))
    .catch(() => ({ enabled: false }));
  return status;
}

/** A processor for the dev UI: real AI when the dev server has a key, otherwise simulated. */
export function createDevProcessor(): SimMediaProcessor {
  return new SimMediaProcessor(wallClock, devExtractor);
}

const devExtractor: ContentExtractor = {
  async extract(job, sha256) {
    const s = await aiStatus();
    if (!s.enabled) return simulatedExtractor.extract(job, sha256);

    const contentType = contentTypeOf(job.key);
    const sample = await sampleOf(job.bytes, contentType);
    const described = await post<{ summary: string; tags: string[] }>('/api/ai/describe', {
      name: job.key,
      contentType,
      size: job.bytes.length,
      ...sample,
    });
    const { embedding } = await post<{ embedding: number[] }>('/api/ai/embed', {
      input: `${job.key}\n${described.summary}\n${described.tags.join(', ')}`,
    });
    return {
      mode: `openrouter (${s.model})`,
      thumbnail: sample.image ? 'downscaled-preview.jpg' : `thumb-${sha256.slice(0, 12)}.webp`,
      extractedText: sample.text ?? '',
      summary: described.summary,
      tags: described.tags,
      embedding,
    };
  },
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new Error(err instanceof Error && err.name === 'TimeoutError' ? `${url} timed out` : `${url} failed: ${String(err)}`);
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${url}: HTTP ${res.status}`);
  return data;
}

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
};

function contentTypeOf(key: string): string {
  return TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** A small sample to send: a downscaled image, or a text excerpt. */
async function sampleOf(bytes: Uint8Array, contentType: string): Promise<{ text?: string; image?: string }> {
  if (/^image\/(png|jpeg|gif|webp)$/.test(contentType)) {
    return { image: await downscale(new Blob([bytes as BlobPart], { type: contentType }), 768) };
  }
  const head = bytes.subarray(0, 64 * 1024);
  if (/^text\/|json|xml|svg/.test(contentType)) {
    return { text: new TextDecoder().decode(head).slice(0, 8000) };
  }
  // Binary (PDF, video, ...): printable runs, like `strings`.
  const runs = new TextDecoder('latin1').decode(head).match(/[\x20-\x7e]{6,}/g) ?? [];
  const text = runs.join('\n').slice(0, 8000);
  return { text: text || `(binary ${contentType}, no readable text in the first 64 KB)` };
}

async function downscale(blob: Blob, maxSide: number): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
