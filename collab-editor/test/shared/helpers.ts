import { expect } from 'vitest';
import { Rng } from '../../sim/random';
import { snapToCodePoint, snapToCodePointUp } from '../../sim/fuzz';
import type { Session } from '../../sim/session';
import type { CollabClient } from '../../client/CollabClient';
import type { Proposal } from '../../shared/types';

/** Every client shows exactly the server's text. */
export function expectConverged(session: Session, label = ''): void {
  const serverText = session.server.getText();
  for (const client of session.clients) {
    expect(client.getText(), `${label} client ${client.clientId} differs from the server`).toBe(serverText);
  }
}

/** The first client types `text` into the empty document and everyone syncs. */
export function seedText(session: Session, text: string): void {
  session.clients[0]!.localInsert(0, text);
  session.runUntilQuiet();
}

/** Index of the `n`th (1-based) occurrence of `phrase`, or -1. */
export function nthIndexOf(text: string, phrase: string, n: number): number {
  let index = -1;
  for (let i = 0; i < n; i++) {
    index = text.indexOf(phrase, index + 1);
    if (index === -1) return -1;
  }
  return index;
}

export function countOccurrences(text: string, phrase: string): number {
  let count = 0;
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) count++;
  return count;
}

/**
 * Seeds to run. Override with FUZZ_SEED=7 (one seed) or FUZZ_SEEDS=1-50 / FUZZ_SEEDS=3,9,12.
 */
export function seedsFromEnv(defaultCount: number): number[] {
  const one = process.env.FUZZ_SEED;
  if (one) return [Number(one)];
  const many = process.env.FUZZ_SEEDS;
  if (many) {
    const range = /^(\d+)-(\d+)$/.exec(many);
    if (range) {
      const out: number[] = [];
      for (let s = Number(range[1]); s <= Number(range[2]); s++) out.push(s);
      return out;
    }
    return many.split(',').map(Number);
  }
  return Array.from({ length: defaultCount }, (_, i) => i + 1);
}

const WORDS = ['note ', 'MLR ', 'tablet ', 'review ', 'copy ', 'brand ', 'x', 'patients ', '™', '💊'];

/**
 * One random edit by `client` that never touches the given phrases or the character on
 * either side of them.
 */
export function editAwayFrom(rng: Rng, client: CollabClient, phrases: readonly string[]): void {
  const text = client.getText();
  const guarded: Array<[number, number]> = [];
  for (const phrase of phrases) {
    for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
      guarded.push([i - 1, i + phrase.length + 1]);
    }
  }
  const touches = (start: number, end: number) => guarded.some(([s, e]) => start < e && end > s);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (rng.chance(0.4) && text.length > 20) {
      const start = snapToCodePoint(text, rng.int(0, text.length - 1));
      const end = snapToCodePointUp(text, Math.min(text.length, start + rng.int(1, 6)));
      if (end > start && !touches(start, end)) {
        client.localDelete(start, end - start);
        return;
      }
    } else {
      const pos = snapToCodePoint(text, rng.int(0, text.length));
      if (!guarded.some(([s, e]) => pos > s && pos < e)) {
        client.localInsert(pos, rng.pick(WORDS));
        return;
      }
    }
  }
  throw new Error('could not find a safe edit');
}

/** Asks the session's AI to rewrite the `n`th occurrence of `phrase` in `client`'s current text. */
export function requestProposal(
  session: Session,
  client: CollabClient,
  phrase: string,
  n: number,
  onReady: (proposal: Proposal) => void,
): string {
  const text = client.getText();
  const start = nthIndexOf(text, phrase, n);
  if (start === -1) throw new Error(`"${phrase}" #${n} not found`);
  return session.ai.request(
    { baseVersion: client.getVersion(), text, start, end: start + phrase.length },
    onReady,
  );
}

export { Rng };
