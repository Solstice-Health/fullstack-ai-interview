import type { Scheduler } from '../sim/network';
import type { Proposal } from '../shared/types';

/** The author recorded for AI-generated edits. */
export const AI_AUTHOR = 'ai-assistant';

export interface ProposalRequest {
  /** The version of the text the AI reads (from `CollabClient.getVersion()`). */
  baseVersion: number;
  /** The full text at `baseVersion`. */
  text: string;
  /** The selection the user asked about, as positions in `text`. */
  start: number;
  end: number;
  /** What the user asked for, e.g. "shorten". */
  instruction?: string;
}

export interface FakeAIOptions {
  /** Simulated time from request to proposal, in ms. Default 12,000 (real proposals take 5–20 s). */
  delayMs?: number;
  /** Produces the replacement text. Default: a canned rewrite of the selection. */
  rewrite?: (selected: string, instruction: string) => string;
}

/** Canned rewrites for phrases in the sample email. */
export const CANNED_REWRITES: Record<string, string> = {
  'once daily': 'once a day',
  'with or without food': 'with food or on an empty stomach',
  'Enrolment takes about five minutes.': 'Enrolment is quick.',
  'Zentravia can cause serious bleeding.': 'Zentravia can cause serious and sometimes fatal bleeding.',
};

export function defaultRewrite(selected: string, instruction: string): string {
  const canned = CANNED_REWRITES[selected];
  if (canned !== undefined) return canned;
  if (instruction === 'shorten') return selected.split(/\s+/).slice(0, 3).join(' ');
  return `${selected} (revised)`;
}

/**
 * Stand-in for the LLM. Reads a snapshot of the text, waits `delayMs` of simulated time,
 * then hands back one proposal. It does not touch the document.
 */
export class FakeAI {
  private readonly delayMs: number;
  private readonly rewrite: (selected: string, instruction: string) => string;
  private nextId = 1;

  constructor(
    private readonly scheduler: Scheduler,
    options: FakeAIOptions = {},
  ) {
    this.delayMs = options.delayMs ?? 12_000;
    this.rewrite = options.rewrite ?? defaultRewrite;
  }

  /** Starts generating. Returns the proposal id; `onReady` is called with the proposal later. */
  request(request: ProposalRequest, onReady: (proposal: Proposal) => void): string {
    const { baseVersion, text, start, end } = request;
    if (!(0 <= start && start <= end && end <= text.length)) {
      throw new RangeError(`selection ${start}..${end} is outside a text of length ${text.length}`);
    }
    const id = `proposal-${this.nextId++}`;
    const replacementText = this.rewrite(text.slice(start, end), request.instruction ?? 'rewrite');
    const proposal: Proposal = { id, baseVersion, start, end, replacementText, author: AI_AUTHOR };
    this.scheduler.schedule(this.delayMs, () => onReady({ ...proposal }));
    return id;
  }
}
