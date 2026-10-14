import { describe, expect, it } from 'vitest';
import { cosine, EmbedderTimeoutError, FakeEmbedder } from '../../server/fakeEmbedder';

describe('FakeEmbedder', () => {
  it('is deterministic and puts paraphrases close together', async () => {
    const e = new FakeEmbedder({ latencyMs: 0, timeoutRate: 0 });
    const [a, again, para, other, empty] = await e.embedBatch([
      'reduced the risk of myocardial infarction by 26%',
      'reduced the risk of myocardial infarction by 26%',
      'cuts heart attack odds',
      'itchy eczema on the elbows',
      '%%',
    ]);
    expect(again).toEqual(a);
    expect(cosine(a!, para!)).toBeGreaterThan(0.6);
    expect(cosine(a!, other!)).toBeLessThan(0.3);
    expect(cosine(empty!, a!)).toBe(0);
  });

  it('embed() resolves after a delay', async () => {
    const e = new FakeEmbedder({ latencyMs: 30, latencyJitter: 0, timeoutRate: 0 });
    const started = performance.now();
    const v = await e.embed('heart attack');
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    expect(v).toHaveLength(e.dims);
    expect(e.stats.calls).toBe(1);
  });

  it('embedBatch() embeds many texts in one call', async () => {
    const e = new FakeEmbedder({ latencyMs: 0 });
    const vs = await e.embedBatch(['heart attack', 'stroke', 'asthma']);
    expect(vs).toHaveLength(3);
    expect(e.stats).toEqual({ calls: 0, batchCalls: 1, texts: 3 });
  });

  it('can be aborted', async () => {
    const e = new FakeEmbedder({ latencyMs: 1000, latencyJitter: 0, timeoutRate: 0 });
    const ctrl = new AbortController();
    const p = e.embed('heart attack', { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports timeouts', async () => {
    const e = new FakeEmbedder({ timeoutRate: 1, timeoutMs: 20 });
    await expect(e.embed('heart attack')).rejects.toBeInstanceOf(EmbedderTimeoutError);
  });
});
