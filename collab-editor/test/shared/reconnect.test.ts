import { describe, expect, it } from 'vitest';
import { createSession } from '../../sim/session';
import { snapToCodePoint } from '../../sim/fuzz';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import { Rng, countOccurrences, expectConverged, seedText, seedsFromEnv } from './helpers';

describe('reconnect', () => {
  it.skip('#4 Idempotency: an edit resent after a reconnect is applied exactly once', () => {
    for (const seed of seedsFromEnv(10)) {
      const session = createSession({ seed, clients: ['alice', 'bob'] });
      seedText(session, EMAIL_BODY);
      const alice = session.client('alice');
      const bob = session.client('bob');

      // Edits that have already reached everyone.
      alice.localInsert(0, '<a1>');
      alice.localInsert(10, '<a2>');
      alice.localInsert(alice.getText().length, '<a3>');
      session.runUntilQuiet();
      session.net.disconnect('alice');
      session.net.reconnect('alice');
      session.runUntilQuiet();
      session.net.disconnect('alice');
      session.net.reconnect('alice');
      session.runUntilQuiet();

      // Edits still in flight when the connection drops.
      alice.localInsert(30, '<a4>');
      alice.localInsert(40, '<a5>');
      session.net.advance(1);
      session.net.disconnect('alice');
      bob.localInsert(0, '<b1>');
      session.net.advance(5_000);
      session.net.reconnect('alice');
      session.runUntilQuiet();

      expectConverged(session, `seed ${seed}:`);
      const text = session.server.getText();
      for (const marker of ['<a1>', '<a2>', '<a3>', '<a4>', '<a5>', '<b1>']) {
        expect(countOccurrences(text, marker), `seed ${seed}: ${marker}`).toBe(1);
      }
      expect(text.length, `seed ${seed}`).toBe(EMAIL_BODY.length + 6 * 4);
    }
  });

  it.skip('#5 Reconnect: a client offline for 2 simulated minutes, editing the whole time, reconnects without losing its edits or anyone else\'s', () => {
    for (const seed of seedsFromEnv(5)) {
      const session = createSession({ seed, clients: ['alice', 'bob', 'carol'] });
      seedText(session, EMAIL_BODY);
      const rng = new Rng(seed);
      const tokens: string[] = [];
      const tokenPattern = /\[[a-z]+\d+\]/g;

      session.net.disconnect('alice');
      for (let t = 0; t < 120_000; t += 500) {
        for (const client of session.clients) {
          const text = client.getText();
          const spans = [...text.matchAll(tokenPattern)].map((m) => [m.index, m.index + m[0].length] as const);
          if (rng.chance(0.25)) {
            // Delete a little of the original copy, never any part of a token.
            const start = snapToCodePoint(text, rng.int(0, text.length - 4));
            const end = snapToCodePoint(text, start + rng.int(1, 3));
            if (end > start && !spans.some(([s, e]) => start < e && end > s)) {
              client.localDelete(start, end - start);
            }
          } else {
            let pos = snapToCodePoint(text, rng.int(0, text.length));
            const inside = spans.find(([s, e]) => pos > s && pos < e);
            if (inside) pos = inside[1];
            const token = `[${client.clientId}${tokens.length}]`;
            tokens.push(token);
            client.localInsert(pos, token);
          }
        }
        session.net.advance(500);
      }
      session.net.reconnect('alice');
      session.runUntilQuiet();

      expectConverged(session, `seed ${seed}:`);
      const text = session.server.getText();
      const lost = tokens.filter((token) => countOccurrences(text, token) !== 1);
      expect(lost, `seed ${seed}: tokens missing or duplicated`).toEqual([]);
    }
  });
});
