import { describe, expect, it } from 'vitest';
import { createSession } from '../../sim/session';
import { isWellFormed, runFuzz } from '../../sim/fuzz';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import { expectConverged, seedText, seedsFromEnv } from './helpers';

const NURSE = '👩‍⚕️';

describe('unicode', () => {
  it.skip('#13 (stretch) Unicode: text containing emoji and ®™ symbols converges, and anchors on it stay correct', () => {
    // Concurrent edits right next to surrogate pairs land where the users put them.
    const session = createSession({ seed: 13, clients: ['alice', 'bob'] });
    const alice = session.client('alice');
    const bob = session.client('bob');
    seedText(session, EMAIL_BODY);

    const word = 'Support Program';
    const at = alice.getText().indexOf(word);
    const commentId = alice.addComment(at, at + word.length, 'Name check');
    alice.localInsert(alice.getText().indexOf('💊') + '💊'.length, ' ✔');
    bob.localInsert(0, `${NURSE} `);
    bob.localDelete(bob.getText().indexOf('®'), '®'.length);
    bob.localInsert(bob.getText().indexOf('™'), '📅');
    session.runUntilQuiet();

    expectConverged(session);
    const expected = `${NURSE} ${EMAIL_BODY}`.replace('®', '').replace('💊', '💊 ✔').replace('™', '📅™');
    expect(alice.getText()).toBe(expected);
    const comment = alice.getComments().find((c) => c.id === commentId)!;
    expect(alice.getText().slice(comment.start, comment.end)).toBe(word);

    // Random edits over emoji-heavy text converge and never split a character in half.
    for (const seed of seedsFromEnv(5)) {
      const fuzzed = createSession({ seed, clients: ['c1', 'c2', 'c3'] });
      seedText(fuzzed, EMAIL_BODY);
      runFuzz(fuzzed.net, fuzzed.clients, {
        seed,
        edits: 300,
        alphabet: ['a', ' ', '®', '™', '💊', '📅', NURSE, '🇺🇸'],
      });
      fuzzed.runUntilQuiet();
      expectConverged(fuzzed, `seed ${seed}:`);
      for (const text of fuzzed.texts()) expect(isWellFormed(text), `seed ${seed}`).toBe(true);
    }
  });
});
