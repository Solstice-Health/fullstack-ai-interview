import { describe, expect, it } from 'vitest';
import { createSession } from '../../sim/session';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import type { CollabClient } from '../../client/CollabClient';
import { expectConverged, nthIndexOf, seedText } from './helpers';

const PHRASE = 'once daily';

function commentText(client: CollabClient, id: string): { text: string; orphaned: boolean } {
  const comment = client.getComments().find((c) => c.id === id);
  if (!comment) throw new Error(`comment ${id} is missing`);
  return { text: client.getText().slice(comment.start, comment.end), orphaned: comment.orphaned };
}

describe('comment anchors', () => {
  it.skip('#9 Comment anchors: a comment shifts with an insert before it, shrinks or grows with edits inside it, and is marked orphaned when its text is fully deleted', () => {
    const session = createSession({ seed: 9, clients: ['alice', 'bob'] });
    const alice = session.client('alice');
    const bob = session.client('bob');
    seedText(session, EMAIL_BODY);

    const start = nthIndexOf(alice.getText(), PHRASE, 1);
    const id = alice.addComment(start, start + PHRASE.length, 'Check against the label');
    const safety = alice.getText().indexOf('IMPORTANT SAFETY INFORMATION');
    const other = alice.addComment(safety, safety + 'IMPORTANT SAFETY INFORMATION'.length, 'Keep in caps');
    expect(commentText(alice, id)).toEqual({ text: PHRASE, orphaned: false });

    // Shifts: someone else inserts before it.
    bob.localInsert(bob.getText().indexOf('Headline'), 'NEW ');
    session.runUntilQuiet();
    expect(commentText(alice, id)).toEqual({ text: PHRASE, orphaned: false });

    // Grows: an insert inside it.
    bob.localInsert(nthIndexOf(bob.getText(), PHRASE, 1) + 'once'.length, ' a');
    session.runUntilQuiet();
    expect(commentText(alice, id)).toEqual({ text: 'once a daily', orphaned: false });

    // Shrinks: a delete that covers its first word and the text before it.
    const s = bob.getText().indexOf('once a daily');
    bob.localDelete(s - 3, 3 + 'once '.length);
    session.runUntilQuiet();
    expect(commentText(alice, id)).toEqual({ text: 'a daily', orphaned: false });

    // A comment added while a remote insert before it is still in flight.
    bob.localInsert(0, 'URGENT ');
    const food = alice.getText().indexOf('with or without food');
    const foodId = alice.addComment(food, food + 'with or without food'.length, 'Per label?');
    session.runUntilQuiet();
    expect(commentText(alice, foodId)).toEqual({ text: 'with or without food', orphaned: false });

    // Orphaned: all of its text is deleted (here by the comment's own author).
    const t = alice.getText().indexOf('a daily');
    alice.localDelete(t - 2, 'a daily'.length + 4);
    session.runUntilQuiet();
    expect(commentText(alice, id).orphaned).toBe(true);
    expect(commentText(alice, other)).toEqual({ text: 'IMPORTANT SAFETY INFORMATION', orphaned: false });
    expectConverged(session);
  });

  it.skip('#10 Comment anchors: a comment on the second of two identical phrases stays on the second phrase after edits around the first', () => {
    const session = createSession({ seed: 10, clients: ['alice', 'bob'] });
    const alice = session.client('alice');
    const bob = session.client('bob');
    seedText(session, EMAIL_BODY);

    const second = nthIndexOf(alice.getText(), PHRASE, 2);
    const id = alice.addComment(second, second + PHRASE.length, 'Is this the renal dose?');

    // Text appears before the first occurrence.
    bob.localInsert(nthIndexOf(bob.getText(), PHRASE, 1), 'Take it ');
    session.runUntilQuiet();
    // The first occurrence is deleted...
    const first = nthIndexOf(bob.getText(), PHRASE, 1);
    bob.localDelete(first, PHRASE.length);
    session.runUntilQuiet();
    // ...and typed again, so the text has two occurrences once more.
    bob.localInsert(first, PHRASE);
    session.runUntilQuiet();

    const text = alice.getText();
    expect(nthIndexOf(text, PHRASE, 2)).toBeGreaterThan(-1);
    const comment = alice.getComments().find((c) => c.id === id)!;
    expect(comment.orphaned).toBe(false);
    expect(comment.start).toBe(nthIndexOf(text, PHRASE, 2));
    expect(text.slice(comment.start, comment.end)).toBe(PHRASE);
    expectConverged(session);
  });
});
