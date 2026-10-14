import { describe, expect, it } from 'vitest';
import { createSession } from '../../sim/session';
import { runFuzz } from '../../sim/fuzz';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import { expectConverged, seedText, seedsFromEnv } from './helpers';

describe('convergence', () => {
  it.skip('#1 Convergence: after 500 random edits from 5 clients with random delays, all clients and the server have identical text', () => {
    for (const seed of seedsFromEnv(20)) {
      const session = createSession({ seed, clients: ['c1', 'c2', 'c3', 'c4', 'c5'] });
      seedText(session, EMAIL_BODY);
      runFuzz(session.net, session.clients, { seed, edits: 500 });
      session.runUntilQuiet();
      expectConverged(session, `seed ${seed}:`);
    }
  });

  it.skip('#2 Concurrent insert: two clients insert at the same position at the same time; every client shows both inserts in the same order', () => {
    for (const seed of seedsFromEnv(20)) {
      const session = createSession({ seed, clients: ['alice', 'bob', 'carol'] });
      seedText(session, EMAIL_BODY);
      const pos = EMAIL_BODY.indexOf('Dear');

      session.client('alice').localInsert(pos, '[alice]');
      session.client('bob').localInsert(pos, '[bob]');
      session.runUntilQuiet();

      expectConverged(session, `seed ${seed}:`);
      const text = session.server.getText();
      const before = EMAIL_BODY.slice(0, pos);
      const after = EMAIL_BODY.slice(pos);
      expect([before + '[alice][bob]' + after, before + '[bob][alice]' + after], `seed ${seed}`).toContain(text);
    }
  });

  it.skip('#3 Overlapping delete: two clients delete overlapping ranges; the overlap is deleted once, not twice', () => {
    for (const seed of seedsFromEnv(20)) {
      const session = createSession({ seed, clients: ['alice', 'bob', 'carol'] });
      seedText(session, EMAIL_BODY);
      const base = EMAIL_BODY.indexOf('Thank you');

      session.client('alice').localDelete(base, 20); // [base, base+20)
      session.client('bob').localDelete(base + 10, 20); // [base+10, base+30)
      session.client('carol').localDelete(base + 5, 10); // [base+5, base+15), inside both
      session.runUntilQuiet();

      expectConverged(session, `seed ${seed}:`);
      expect(session.server.getText(), `seed ${seed}`).toBe(EMAIL_BODY.slice(0, base) + EMAIL_BODY.slice(base + 30));
    }
  });
});
