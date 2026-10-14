import { describe, expect, it } from 'vitest';
import { SimNetwork } from '../../sim/network';
import { AI_AUTHOR, FakeAI } from '../../server/fakeAI';
import { AuditLog } from '../../server/auditLog';
import { applyOp, applyOps, del, insert } from '../../shared/ops';
import { contentHash } from '../../shared/hash';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import type { Proposal } from '../../shared/types';

describe('FakeAI', () => {
  it('answers after the configured delay with positions from the request', () => {
    const net = new SimNetwork({ seed: 1 });
    const ai = new FakeAI(net, { delayMs: 5_000 });
    const start = EMAIL_BODY.indexOf('once daily');
    let proposal: Proposal | undefined;
    const id = ai.request({ baseVersion: 7, text: EMAIL_BODY, start, end: start + 10 }, (p) => (proposal = p));
    net.advance(4_999);
    expect(proposal).toBeUndefined();
    net.advance(1);
    expect(proposal).toEqual({
      id,
      baseVersion: 7,
      start,
      end: start + 10,
      replacementText: 'once a day',
      author: AI_AUTHOR,
    });
  });

  it('defaults to a 12 s delay and unique ids', () => {
    const net = new SimNetwork({ seed: 2 });
    const ai = new FakeAI(net);
    const got: Proposal[] = [];
    const a = ai.request({ baseVersion: 1, text: 'hello world', start: 0, end: 5 }, (p) => got.push(p));
    const b = ai.request({ baseVersion: 1, text: 'hello world', start: 6, end: 11 }, (p) => got.push(p));
    expect(a).not.toBe(b);
    net.advance(11_999);
    expect(got).toHaveLength(0);
    net.advance(1);
    expect(got.map((p) => p.replacementText)).toEqual(['hello (revised)', 'world (revised)']);
  });

  it('rejects selections outside the text', () => {
    const ai = new FakeAI(new SimNetwork({ seed: 3 }));
    expect(() => ai.request({ baseVersion: 0, text: 'abc', start: 2, end: 9 }, () => {})).toThrow(RangeError);
  });
});

describe('AuditLog', () => {
  it('stamps entries with a sequence number and the clock, and keeps them in order', () => {
    let now = 100;
    const log = new AuditLog(() => now);
    log.append({ kind: 'edit', op: insert(0, 'hi'), author: 'u1' });
    now = 250;
    log.append({ kind: 'checkpoint', checkpointId: 'c1', hash: 'h', author: 'u1' });
    expect(log.entries().map((e) => [e.seq, e.at, e.kind])).toEqual([
      [1, 100, 'edit'],
      [2, 250, 'checkpoint'],
    ]);
    expect(log.size).toBe(2);
  });

  it('is append-only', () => {
    const log = new AuditLog(() => 0);
    const op = insert(0, 'hi');
    log.append({ kind: 'edit', op, author: 'u1' });
    op.text = 'changed';
    const entries = log.entries() as unknown as Array<Record<string, unknown>>;
    expect(() => {
      entries[0]!.author = 'someone else';
    }).toThrow();
    entries.pop();
    expect(log.entries()).toHaveLength(1);
    const first = log.entries()[0]!;
    expect(first.kind === 'edit' && first.op).toEqual(insert(0, 'hi'));
  });
});

describe('ops', () => {
  it('applies inserts and deletes in UTF-16 code units', () => {
    expect(applyOp('a💊b', insert(3, 'X'))).toBe('a💊Xb');
    expect(applyOp('a💊b', del(1, 2))).toBe('ab');
    expect(applyOps('', [insert(0, 'hello'), del(1, 3), insert(1, 'ipp')])).toBe('hippo');
  });

  it('rejects ops that do not fit', () => {
    expect(() => applyOp('abc', insert(4, 'x'))).toThrow(RangeError);
    expect(() => applyOp('abc', del(2, 2))).toThrow(RangeError);
    expect(() => applyOp('abc', del(-1, 1))).toThrow(RangeError);
  });

  it('contentHash is SHA-256 of the UTF-8 text', () => {
    expect(contentHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(contentHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(contentHash('💊')).not.toBe(contentHash('💊 '));
  });
});

describe('fixtures', () => {
  it('the sample email has the phrases and characters the tests rely on', () => {
    expect(EMAIL_BODY.split('once daily')).toHaveLength(3);
    expect(EMAIL_BODY).toContain('®');
    expect(EMAIL_BODY).toContain('™');
    expect(EMAIL_BODY.split('💊')).toHaveLength(2);
    expect(EMAIL_BODY).toContain('👩‍⚕️');
    expect(EMAIL_BODY.length).toBeGreaterThan([...EMAIL_BODY].length);
  });
});
