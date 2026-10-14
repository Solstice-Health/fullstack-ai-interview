import { Rng } from './random';

/** Anything that can be edited like a client. `CollabClient` satisfies it. */
export interface FuzzEditor {
  getText(): string;
  localInsert(pos: number, text: string): void;
  localDelete(pos: number, len: number): void;
}

/** Something that moves time forward. `SimNetwork` satisfies it. */
export interface Clock {
  advance(ms: number): void;
}

/** Characters the fuzzer types. Each item is inserted whole. */
export const DEFAULT_ALPHABET: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'eeaaoinst'.split(''),
  ' ',
  ' ',
  ' ',
  '.',
  ',',
  '®',
  '™',
  '💊',
  '📅',
  '😀',
];

export interface FuzzOptions {
  seed: number;
  /** Total number of edits to make across all editors. */
  edits: number;
  /**
   * Share of steps where two or three editors edit at the same position in the same instant
   * (all inserting there, or deleting overlapping ranges). Default 0.2.
   */
  collisionRate?: number;
  /** What inserted text is made of. Default `DEFAULT_ALPHABET`. */
  alphabet?: readonly string[];
  /** Longest insert, in alphabet items. Default 6. */
  maxInsertLength?: number;
  /** Longest delete, in code units. Default 8. */
  maxDeleteLength?: number;
  /** Simulated ms between steps, chosen uniformly in [min, max]. Default [0, 40]. */
  pauseMs?: [number, number];
  /** Deletes become more likely once a text is longer than this. Default 800. */
  targetLength?: number;
}

export interface FuzzStats {
  inserts: number;
  deletes: number;
  /** Steps where several editors edited the same position at once. */
  collisions: number;
}

/**
 * Makes `options.edits` random edits spread over `editors`, advancing `clock` between steps.
 * Positions always fall on code point boundaries, like a real cursor. It does not wait for
 * the network to go quiet at the end.
 */
export function runFuzz(clock: Clock, editors: readonly FuzzEditor[], options: FuzzOptions): FuzzStats {
  if (editors.length === 0) throw new Error('runFuzz needs at least one editor');
  const rng = new Rng(options.seed);
  const collisionRate = options.collisionRate ?? 0.2;
  const alphabet = options.alphabet ?? DEFAULT_ALPHABET;
  const maxInsert = options.maxInsertLength ?? 6;
  const maxDelete = options.maxDeleteLength ?? 8;
  const [pauseMin, pauseMax] = options.pauseMs ?? [0, 40];
  const targetLength = options.targetLength ?? 800;
  const stats: FuzzStats = { inserts: 0, deletes: 0, collisions: 0 };

  const randomText = () => {
    let text = '';
    const n = rng.int(1, maxInsert);
    for (let i = 0; i < n; i++) text += rng.pick(alphabet);
    return text;
  };

  const doInsert = (editor: FuzzEditor, pos: number) => {
    const text = editor.getText();
    editor.localInsert(snapToCodePoint(text, Math.min(pos, text.length)), randomText());
    stats.inserts++;
  };

  /** Returns false if there was nothing to delete. */
  const doDelete = (editor: FuzzEditor, pos: number, len: number) => {
    const text = editor.getText();
    const start = snapToCodePoint(text, Math.min(pos, text.length));
    const end = snapToCodePointUp(text, Math.min(start + len, text.length));
    if (end <= start) return false;
    editor.localDelete(start, end - start);
    stats.deletes++;
    return true;
  };

  let remaining = options.edits;
  while (remaining > 0) {
    if (remaining >= 2 && editors.length >= 2 && rng.chance(collisionRate)) {
      const group = rng.sample(editors, Math.min(remaining, editors.length, rng.int(2, 3)));
      const pos = rng.int(0, group[0]!.getText().length);
      const deleting = rng.chance(0.5) && group.every((e) => e.getText().length > pos + 1);
      for (const editor of group) {
        if (!deleting || !doDelete(editor, pos + rng.int(0, 3), rng.int(2, maxDelete))) doInsert(editor, pos);
      }
      remaining -= group.length;
      stats.collisions++;
    } else {
      const editor = rng.pick(editors);
      const length = editor.getText().length;
      const deleteChance = length === 0 ? 0 : length > targetLength ? 0.7 : 0.35;
      const pos = rng.int(0, length);
      if (!rng.chance(deleteChance) || !doDelete(editor, pos, rng.int(1, maxDelete))) doInsert(editor, pos);
      remaining--;
    }
    clock.advance(rng.int(pauseMin, pauseMax));
  }
  return stats;
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Moves `pos` back one unit if it sits between the two halves of a surrogate pair. */
export function snapToCodePoint(text: string, pos: number): number {
  if (pos > 0 && pos < text.length && isLow(text.charCodeAt(pos)) && isHigh(text.charCodeAt(pos - 1))) {
    return pos - 1;
  }
  return pos;
}

/** Moves `pos` forward one unit if it sits between the two halves of a surrogate pair. */
export function snapToCodePointUp(text: string, pos: number): number {
  return snapToCodePoint(text, pos) === pos ? pos : pos + 1;
}

/** True if `text` has no unpaired surrogate halves. */
export function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isHigh(code)) {
      if (!isLow(text.charCodeAt(i + 1))) return false;
      i++;
    } else if (isLow(code)) {
      return false;
    }
  }
  return true;
}
