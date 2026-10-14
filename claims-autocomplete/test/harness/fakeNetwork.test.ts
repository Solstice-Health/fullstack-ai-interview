import { describe, expect, it } from 'vitest';
import { createFakeNetwork, echoSuggestions } from '../../web/fakeNetwork';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('fake network', () => {
  it('holds requests until the test responds', async () => {
    const net = createFakeNetwork();
    const p = net.api.suggest({ query: 'car', assetId: 'as_1' });
    expect(net.pending()).toHaveLength(1);
    net.last()!.respond();
    await expect(p).resolves.toEqual(echoSuggestions('car'));
    expect(net.pending()).toHaveLength(0);
  });

  it('delivers responses in the order they arrive, not the order they were sent', async () => {
    const net = createFakeNetwork();
    const order: string[] = [];
    const a = net.api.suggest({ query: 'a', assetId: 'x' }).then(() => order.push('a'));
    const b = net.api.suggest({ query: 'b', assetId: 'x' }).then(() => order.push('b'));
    net.requests[0]!.respond(undefined, { delayMs: 30 });
    net.requests[1]!.respond(undefined, { delayMs: 0 });
    await Promise.all([a, b]);
    expect(order).toEqual(['b', 'a']);
  });

  it('rejects with AbortError when aborted before the response is sent', async () => {
    const net = createFakeNetwork();
    const ctrl = new AbortController();
    const p = net.api.suggest({ query: 'car', assetId: 'x' }, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(net.last()!.aborted).toBe(true);
    net.last()!.respond(); // no effect
  });

  it('still delivers a response that was already sent', async () => {
    const net = createFakeNetwork();
    const ctrl = new AbortController();
    const p = net.api.suggest({ query: 'car', assetId: 'x' }, { signal: ctrl.signal });
    net.last()!.respond(undefined, { delayMs: 10 });
    ctrl.abort();
    await expect(p).resolves.toEqual(echoSuggestions('car'));
  });

  it('can fail requests and answer automatically', async () => {
    const net = createFakeNetwork({ mode: 'auto', delayMs: [1, 5] });
    await expect(net.api.suggest({ query: 'auto', assetId: 'x' })).resolves.toEqual(echoSuggestions('auto'));
    const manual = createFakeNetwork();
    const p = manual.api.suggest({ query: 'x', assetId: 'x' });
    manual.last()!.fail(new Error('503'));
    await expect(p).rejects.toThrow('503');
    await tick();
  });
});
