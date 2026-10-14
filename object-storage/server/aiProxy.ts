/**
 * Dev-server AI proxy (Vite plugin). Runs in Node inside `npm run dev`, so the
 * OpenRouter key never reaches the browser. Tests do not load it.
 *
 *   GET  /api/ai/status    -> { enabled, model, embeddingModel }
 *   POST /api/ai/describe  { name, contentType, size, text?, image? } -> { summary, tags, safetyText, model }
 *   POST /api/ai/embed     { input: string } -> { embedding, model }
 *
 * Errors come back as { error } with a 4xx/5xx status.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface AiConfig {
  apiKey?: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  timeoutMs: number;
}

export function aiConfigFrom(env: Record<string, string | undefined>): AiConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
    baseUrl: (env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    chatModel: env.OPENROUTER_CHAT_MODEL?.trim() || 'anthropic/claude-haiku-4.5',
    embeddingModel: env.OPENROUTER_EMBEDDING_MODEL?.trim() || 'openai/text-embedding-3-small',
    timeoutMs: 30_000,
  };
}

export interface DescribeRequest {
  name: string;
  contentType?: string;
  size?: number;
  /** A text excerpt of the file. */
  text?: string;
  /** A downscaled image as a data URL (png, jpeg, gif or webp). */
  image?: string;
}

export interface DescribeResponse {
  summary: string;
  tags: string[];
  /** True if the asset appears to contain safety / ISI (Important Safety Information) text. */
  safetyText: boolean;
  model: string;
}

const MAX_BODY = 4 * 1024 * 1024;
const MAX_TEXT = 12_000;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const SYSTEM_PROMPT = `You catalogue assets in a pharmaceutical marketing asset library.
Given a sample of an uploaded file (a text excerpt or a downscaled image) and its file name, reply with JSON only:
{"summary": string, "tags": string[], "safetyText": boolean}
- summary: one or two plain sentences on what the asset is and what it shows or says.
- tags: 3 to 8 short lowercase tags (asset type, topic, audience, brand or product names if visible).
- safetyText: true if the sample appears to contain safety information, an ISI (Important Safety Information) block, boxed warning, contraindications, adverse reactions or prescribing-information language; otherwise false. If true, include the tag "safety-isi".
Describe only what is in the sample. Do not invent claims.`;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function aiProxy(config: AiConfig): Plugin {
  return {
    name: 'ai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai', (req, res) => {
        handle(config, req, res).catch((err: unknown) => {
          const status = err instanceof HttpError ? err.status : 500;
          sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        });
      });
    },
  };
}

async function handle(config: AiConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && path === '/status') {
    return sendJson(res, 200, {
      enabled: Boolean(config.apiKey),
      model: config.chatModel,
      embeddingModel: config.embeddingModel,
    });
  }
  if (req.method === 'POST' && path === '/describe') {
    requireKey(config);
    return sendJson(res, 200, await describe(config, parseDescribe(await readJson(req))));
  }
  if (req.method === 'POST' && path === '/embed') {
    requireKey(config);
    const body = (await readJson(req)) as { input?: unknown };
    if (typeof body.input !== 'string' || !body.input.trim()) throw new HttpError(400, '`input` must be a non-empty string');
    return sendJson(res, 200, await embed(config, body.input.slice(0, MAX_TEXT)));
  }
  throw new HttpError(404, `No route ${req.method} /api/ai${path}`);
}

function requireKey(config: AiConfig): void {
  if (!config.apiKey) throw new HttpError(503, 'AI is disabled: OPENROUTER_API_KEY is not set');
}

function parseDescribe(body: unknown): DescribeRequest {
  const b = body as Partial<DescribeRequest>;
  if (typeof b.name !== 'string' || !b.name) throw new HttpError(400, '`name` is required');
  if (b.image !== undefined && (typeof b.image !== 'string' || !IMAGE_DATA_URL.test(b.image))) {
    throw new HttpError(400, '`image` must be a base64 png, jpeg, gif or webp data URL');
  }
  if (b.text !== undefined && typeof b.text !== 'string') throw new HttpError(400, '`text` must be a string');
  if (!b.image && !b.text?.trim()) throw new HttpError(400, 'Send a `text` excerpt or an `image` data URL');
  return { name: b.name, contentType: b.contentType, size: b.size, text: b.text?.slice(0, MAX_TEXT), image: b.image };
}

async function describe(config: AiConfig, req: DescribeRequest): Promise<DescribeResponse> {
  const header = `File: ${req.name}${req.contentType ? ` (${req.contentType})` : ''}${req.size ? `, ${req.size} bytes` : ''}`;
  const content: unknown[] = [{ type: 'text', text: req.text ? `${header}\n\nText excerpt:\n${req.text}` : header }];
  if (req.image) content.push({ type: 'image_url', image_url: { url: req.image } });

  const data = (await callOpenRouter(config, '/chat/completions', {
    model: config.chatModel,
    max_tokens: 400,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
  })) as { choices?: { message?: { content?: string } }[] };

  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new HttpError(502, 'OpenRouter returned no content');
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let parsed: { summary?: unknown; tags?: unknown; safetyText?: unknown };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new HttpError(502, `Model reply was not JSON: ${raw.slice(0, 200)}`);
  }
  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 10) : [];
  const safetyText = parsed.safetyText === true;
  if (safetyText && !tags.includes('safety-isi')) tags.push('safety-isi');
  return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', tags, safetyText, model: config.chatModel };
}

async function embed(config: AiConfig, input: string): Promise<{ embedding: number[]; model: string }> {
  const data = (await callOpenRouter(config, '/embeddings', { model: config.embeddingModel, input })) as {
    data?: { embedding?: number[] }[];
  };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new HttpError(502, 'OpenRouter returned no embedding');
  return { embedding, model: config.embeddingModel };
}

async function callOpenRouter(config: AiConfig, path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new HttpError(504, `OpenRouter did not answer within ${config.timeoutMs / 1000}s`);
    }
    throw new HttpError(502, `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, `OpenRouter sent a non-JSON response: ${text.slice(0, 200)}`);
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return reject(new HttpError(413, `Request body over ${MAX_BODY} bytes`));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
