import { describe, expect, it } from 'vitest';
import { isWellFormed, runFuzz, snapToCodePoint, snapToCodePointUp, type FuzzEditor } from '../../sim/fuzz';
import { SimNetwork } from '../../sim/network';
import { applyOp, del, insert, type Op } from '../../shared/ops';
import { EMAIL_BODY } from '../../fixtures/emailBody';

/** A local, non-networked editor that records what it was asked to do. */
class RecordingEditor implements FuzzEditor {
  readonly ops: Array<{ at: number; op: Op }> = [];
  constructor(
    private text: string,
    private readonly clock: { now: number },
  ) {}
  getText() {
    return this.text;
  }
  localInsert(pos: number, text: string) {
    this.record(insert(pos, text));
  }
  localDelete(pos: number, len: number) {
    this.record(del(pos, len));
  }
  private record(op: Op) {
    this.text = applyOp(this.text, op);
    this.ops.push({ at: this.clock.now, op });
  }
}

function run(seed: number, editorCount = 3, edits = 300) {
  const net = new SimNetwork({ seed });
  const editors = Array.from({ length: editorCount }, () => new RecordingEditor(EMAIL_BODY, net));
  const stats = runFuzz(net, editors, { seed, edits });
  return { editors, stats };
}

describe('runFuzz', () => {
  it('is deterministic for a seed', () => {
    const a = run(1);
    const b = run(1);
    expect(a.editors.map((e) => e.ops)).toEqual(b.editors.map((e) => e.ops));
    expect(run(2).editors.map((e) => e.ops)).not.toEqual(a.editors.map((e) => e.ops));
  });

  it('makes exactly the requested number of edits', () => {
    const { editors, stats } = run(3, 5, 500);
    expect(editors.reduce((n, e) => n + e.ops.length, 0)).toBe(500);
    expect(stats.inserts + stats.deletes).toBe(500);
    expect(stats.deletes).toBeGreaterThan(50);
  });

  it('regularly has several editors edit the same position at the same instant', () => {
    const { editors, stats } = run(4, 3, 500);
    expect(stats.collisions).toBeGreaterThan(20);
    const byTime = new Map<number, Op[]>();
    for (const e of editors) for (const { at, op } of e.ops) byTime.set(at, [...(byTime.get(at) ?? []), op]);
    const samePosInserts = [...byTime.values()].filter(
      (ops) => ops.length >= 2 && ops.every((o) => o.type === 'insert' && o.pos === ops[0]!.pos),
    );
    const overlappingDeletes = [...byTime.values()].filter(
      (ops) => ops.length >= 2 && ops.every((o) => o.type === 'delete'),
    );
    expect(samePosInserts.length).toBeGreaterThan(5);
    expect(overlappingDeletes.length).toBeGreaterThan(5);
  });

  it('never splits a surrogate pair', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { editors } = run(seed, 2, 400);
      for (const e of editors) expect(isWellFormed(e.getText())).toBe(true);
    }
  });

  it('can be told not to collide', () => {
    const net = new SimNetwork({ seed: 5 });
    const editors = [new RecordingEditor('', net), new RecordingEditor('', net)];
    expect(runFuzz(net, editors, { seed: 5, edits: 200, collisionRate: 0 }).collisions).toBe(0);
  });

  it('snaps positions to code point boundaries', () => {
    const text = 'a💊b';
    expect(snapToCodePoint(text, 2)).toBe(1);
    expect(snapToCodePointUp(text, 2)).toBe(3);
    expect(snapToCodePoint(text, 3)).toBe(3);
    expect(isWellFormed(text)).toBe(true);
    expect(isWellFormed(text.slice(0, 2))).toBe(false);
  });
});
