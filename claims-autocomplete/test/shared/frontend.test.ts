// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaimsApiProvider } from '../../web/api';
import { createFakeNetwork, echoSuggestions, type FakeNetwork } from '../../web/fakeNetwork';
import { useClaimSuggestions, type ClaimSuggestionsState } from '../../web/useClaimSuggestions';

const ASSET = 'as_0001';

let net: FakeNetwork;

beforeEach(() => {
  vi.useFakeTimers();
  net = createFakeNetwork();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderSuggestions(initial = '') {
  const wrapper = ({ children }: { children?: ReactNode }) => createElement(ClaimsApiProvider, { api: net.api }, children);
  return renderHook(({ q }: { q: string }) => useClaimSuggestions(q, ASSET), { initialProps: { q: initial }, wrapper });
}

/** Moves fake time forward and lets React and promises catch up. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const textsOf = (s: ClaimSuggestionsState) => s.suggestions.map((x) => x.text);

describe('useClaimSuggestions', () => {
  it.skip('#9 responses for "car", "card" and "cardi" arrive in reverse; the UI only ever shows results for "cardi"', async () => {
    const view = renderSuggestions();
    const seen: string[][] = [];
    const record = () => seen.push(textsOf(view.result.current));

    // Each request is answered by the server right away, but the answers take
    // longer to arrive the earlier they were sent.
    const travel: Record<string, number> = { car: 3000, card: 1500, cardi: 0 };
    for (const q of ['car', 'card', 'cardi']) {
      view.rerender({ q });
      await wait(1000);
      for (const req of net.requests.filter((r) => !r.settled)) req.respond(undefined, { delayMs: travel[req.query] ?? 0 });
      record();
    }
    expect(net.requests.map((r) => r.query)).toContain('cardi');

    for (let t = 0; t < 40; t++) {
      await wait(100);
      record();
    }
    const cardi = echoSuggestions('cardi').map((s) => s.text);
    for (const snapshot of seen) {
      if (snapshot.length) expect(snapshot).toEqual(cardi);
    }
    expect(view.result.current.status).toBe('ready');
    expect(textsOf(view.result.current)).toEqual(cardi);
  });

  it.skip('#10 10 keystrokes within 200 ms produce at most 2 requests, and superseded requests are aborted', async () => {
    const view = renderSuggestions();
    const word = 'cardiovasc';
    for (let i = 1; i <= word.length; i++) {
      view.rerender({ q: word.slice(0, i) });
      await wait(20);
    }
    await wait(1000);
    expect(net.requests.length).toBeGreaterThanOrEqual(1);
    expect(net.requests.length).toBeLessThanOrEqual(2);
    expect(net.last()!.query).toBe(word);

    // A request still waiting for its response is aborted once the writer types on.
    const before = net.requests.length;
    view.rerender({ q: 'cardiovascular' });
    await wait(1000);
    expect(net.requests.length).toBe(before + 1);
    const superseded = net.requests[before]!;
    expect(superseded.settled).toBe(false);
    view.rerender({ q: 'cardiovascular d' });
    await wait(1000);
    expect(superseded.aborted).toBe(true);
    expect(net.last()!.query).toBe('cardiovascular d');
    expect(net.last()!.aborted).toBe(false);
  });

  it.skip('#11 clearing the input clears suggestions; a failed request shows a non-blocking error state', async () => {
    const view = renderSuggestions();

    view.rerender({ q: 'heart' });
    await wait(1000);
    net.last()!.respond();
    await wait(10);
    expect(view.result.current.status).toBe('ready');
    expect(textsOf(view.result.current)).toEqual(echoSuggestions('heart').map((s) => s.text));

    // Clear: nothing shown, nothing requested.
    const count = net.requests.length;
    view.rerender({ q: '' });
    await wait(1000);
    expect(view.result.current).toEqual({ suggestions: [], status: 'idle' });
    expect(net.requests.length).toBe(count);

    // A response that arrives after the input was cleared is not shown.
    view.rerender({ q: 'heart a' });
    await wait(1000);
    const late = net.last()!;
    late.respond(undefined, { delayMs: 500 });
    view.rerender({ q: '' });
    await wait(1000);
    expect(view.result.current).toEqual({ suggestions: [], status: 'idle' });

    // A failure shows an error state and does not stop the next query.
    view.rerender({ q: 'stroke' });
    await wait(1000);
    net.last()!.fail(new Error('503 Service Unavailable'));
    await wait(10);
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.suggestions).toEqual([]);

    view.rerender({ q: 'stroke r' });
    await wait(1000);
    expect(net.last()!.query).toBe('stroke r');
    net.last()!.respond();
    await wait(10);
    expect(view.result.current.status).toBe('ready');
    expect(textsOf(view.result.current)).toEqual(echoSuggestions('stroke r').map((s) => s.text));
  });
});
