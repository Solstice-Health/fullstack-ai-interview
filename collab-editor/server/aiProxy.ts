import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Optional real AI for the web UI. Runs in Node inside the Vite dev server, so the API key
 * never reaches the browser. The tests never load this file: they always use `FakeAI`.
 *
 *   GET  /api/ai/status   -> { enabled, model }
 *   POST /api/ai/propose  { baseVersion, text, start, end, instruction } -> Proposal | { error }
 *
 * Imports nothing from the rest of the project so Vite can load it with the config.
 */

/** Same shapes as `ProposalRequest` in fakeAI.ts and `Proposal` in shared/types.ts. */
export interface ProposalRequest {
  baseVersion: number;
  text: string;
  start: number;
  end: number;
  instruction?: string;
}
export interface Proposal {
  id: string;
  baseVersion: number;
  start: number;
  end: number;
  replacementText: string;
  author: string;
}

/** Same as `AI_AUTHOR` in fakeAI.ts. */
const AI_AUTHOR = 'ai-assistant';

export interface AIConfig {
  /** Unset means the UI uses FakeAI. */
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1_000_000;

export function aiConfigFromEnv(env: Record<string, string | undefined>): AIConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
    baseUrl: (env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.OPENROUTER_CHAT_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: TIMEOUT_MS,
  };
}

const SYSTEM_PROMPT = `You are an AI co-editor inside a collaborative editor used by a pharmaceutical marketing team.
You rewrite one selected passage of a promotional email according to the user's instruction.

Rules:
- Keep every medical and product claim accurate. Never add claims, efficacy numbers or benefits that are not in the original.
- Never remove, soften or shorten safety information, warnings, contraindications, side effects or fair-balance text. If the instruction asks for that, put the safety text inside the tags exactly as it is (an empty replacement deletes the passage).
- Rewrite only the selected passage. Never replace it with text copied from elsewhere in the document.
- Keep labels that belong to the passage (for example a leading "Headline:" or "Subject:"), product names, dosing, trademarks (® ™) and references exactly as written.
- Keep the tone professional and compliant with pharmaceutical promotional standards.
- The replacement must fit grammatically where the selection was.

Output format: put the replacement text, and nothing else, between <replacement> and </replacement>.
Everything inside the tags is inserted into the document as is, so never put explanations, quotes or markdown inside them.
If you could not follow the instruction, you may add one short sentence after the closing tag saying why.

Example. Instruction: "shorten". Selected passage: "Lumexa may cause severe liver injury, including liver failure."
Reply: <replacement>Lumexa may cause severe liver injury, including liver failure.</replacement> This is safety information, so it stays unchanged.`;

function userPrompt({ text, start, end, instruction }: ProposalRequest): string {
  return [
    `Instruction: ${instruction?.trim() || 'rewrite'}`,
    '',
    'Full document, with the selected passage between <<< and >>>:',
    `${text.slice(0, start)}<<<${text.slice(start, end)}>>>${text.slice(end)}`,
    '',
    'Selected passage:',
    text.slice(start, end),
    '',
    'Follow the rules: safety and fair-balance text must survive unchanged.',
  ].join('\n');
}

/** Takes the text between the <replacement> tags and keeps the selection's own outer whitespace. */
function extractReplacement(raw: string, selected: string): string {
  const match = /<replacement>([\s\S]*?)<\/replacement>/.exec(raw);
  if (!match) throw new AIError(`AI did not propose an edit: ${raw.trim().slice(0, 300)}`, 422);
  const out = match[1]!.trim();
  if (selected.trim() === '') return out;
  return `${/^\s*/.exec(selected)![0]}${out}${/\s*$/.exec(selected)![0]}`;
}

export class AIError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function validateRequest(body: unknown): ProposalRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const { text, start, end, baseVersion, instruction } = b;
  if (typeof text !== 'string') throw new AIError('text must be a string', 400);
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(baseVersion)) {
    throw new AIError('start, end and baseVersion must be integers', 400);
  }
  const s = start as number;
  const e = end as number;
  if (!(0 <= s && s < e && e <= text.length)) {
    throw new AIError(`selection ${s}..${e} is empty or outside a text of length ${text.length}`, 400);
  }
  if (instruction !== undefined && typeof instruction !== 'string') throw new AIError('instruction must be a string', 400);
  return { text, start: s, end: e, baseVersion: baseVersion as number, instruction: instruction as string | undefined };
}

/** Asks the model for a replacement of `text[start, end)`. Returns a proposal in FakeAI's shape. */
export async function proposeEdit(config: AIConfig, request: ProposalRequest): Promise<Proposal> {
  if (!config.apiKey) throw new AIError('Real AI is off: OPENROUTER_API_KEY is not set', 503);
  const selected = request.text.slice(request.start, request.end);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(request) },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new AIError(`AI request timed out after ${config.timeoutMs / 1000} s`, 504);
    }
    throw new AIError(`AI request failed: ${err.message}`, 502);
  }
  const raw = await response.text();
  if (!response.ok) {
    throw new AIError(`AI provider returned ${response.status}: ${raw.slice(0, 300)}`, 502);
  }
  let content: unknown;
  try {
    content = JSON.parse(raw)?.choices?.[0]?.message?.content;
  } catch {
    throw new AIError('AI provider returned invalid JSON', 502);
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AIError('AI provider returned an empty answer', 502);
  }
  return {
    id: `ai-${randomUUID().slice(0, 8)}`,
    baseVersion: request.baseVersion,
    start: request.start,
    end: request.end,
    replacementText: extractReplacement(content, selected),
    author: AI_AUTHOR,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AIError('request body too large', 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AIError('request body must be JSON', 400);
  }
}

/** Vite plugin that serves the two endpoints above from the dev server. */
export function aiProxy(config: AIConfig): Plugin {
  return {
    name: 'collab-editor-ai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai', (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method === 'GET' && path === '/status') {
          return sendJson(res, 200, { enabled: Boolean(config.apiKey), model: config.apiKey ? config.model : null });
        }
        if (req.method === 'POST' && path === '/propose') {
          readJson(req)
            .then((body) => proposeEdit(config, validateRequest(body)))
            .then((proposal) => sendJson(res, 200, proposal))
            .catch((e: unknown) => {
              const status = e instanceof AIError ? e.status : 500;
              const message = e instanceof Error ? e.message : String(e);
              if (status >= 500) server.config.logger.warn(`[ai] ${message}`);
              sendJson(res, status, { error: message });
            });
          return;
        }
        next();
      });
    },
  };
}
