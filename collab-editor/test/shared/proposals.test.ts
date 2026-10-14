import { describe, expect, it } from 'vitest';
import { createSession } from '../../sim/session';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import type { Proposal } from '../../shared/types';
import {
  Rng,
  countOccurrences,
  editAwayFrom,
  expectConverged,
  nthIndexOf,
  requestProposal,
  seedText,
  seedsFromEnv,
} from './helpers';

const PHRASE = 'once daily';
const REPLACEMENT = 'once a day';

/** Tries to accept; whether it throws or quietly does nothing is up to the implementation. */
function tryAccept(accept: () => void): void {
  try {
    accept();
  } catch {
    // either behaviour is fine
  }
}

describe('AI proposals', () => {
  it.skip('#6 Proposal rebase: a proposal based on version 10 whose target text was untouched lands at the correctly shifted position after 30 other edits', () => {
    for (const seed of seedsFromEnv(5)) {
      const session = createSession({ seed, clients: ['alice', 'bob'] });
      const alice = session.client('alice');
      const bob = session.client('bob');
      const rng = new Rng(seed);
      seedText(session, EMAIL_BODY);
      for (let i = 0; i < 9; i++) editAwayFrom(rng, i % 2 ? alice : bob, [PHRASE]);
      session.runUntilQuiet();

      // The AI is asked about the second "once daily" and takes a while to answer.
      let arrived: Proposal | undefined;
      requestProposal(session, alice, PHRASE, 2, (p) => {
        arrived = p;
        alice.receiveProposal(p);
      });
      for (let i = 0; i < 30; i++) {
        editAwayFrom(rng, rng.chance(0.5) ? alice : bob, [PHRASE]);
        session.net.advance(150);
      }
      expect(arrived, 'the proposal should still be generating').toBeUndefined();
      session.net.advanceUntil(() => arrived !== undefined);
      // A few more edits while it waits for a human.
      for (let i = 0; i < 5; i++) {
        editAwayFrom(rng, rng.chance(0.5) ? alice : bob, [PHRASE]);
        session.net.advance(150);
      }
      session.runUntilQuiet();
      expectConverged(session, `seed ${seed}:`);

      const before = alice.getText();
      const expectedStart = nthIndexOf(before, PHRASE, 2);
      const view = alice.getProposals().find((p) => p.id === arrived!.id)!;
      expect(view.state, `seed ${seed}`).toBe('pending');
      expect(view.start, `seed ${seed}`).toBe(expectedStart);
      expect(before.slice(view.start, view.end), `seed ${seed}`).toBe(PHRASE);

      alice.acceptProposal(view.id);
      session.runUntilQuiet();
      expectConverged(session, `seed ${seed}:`);
      expect(alice.getText(), `seed ${seed}`).toBe(
        before.slice(0, expectedStart) + REPLACEMENT + before.slice(expectedStart + PHRASE.length),
      );
      expect(alice.getProposals().find((p) => p.id === view.id)!.state).toBe('accepted');
    }
  });

  it.skip('#7 Proposal conflict: a proposal whose target text was edited after its base version is marked conflict and is not applied', () => {
    for (const seed of seedsFromEnv(5)) {
      const session = createSession({ seed, clients: ['alice', 'bob'] });
      const alice = session.client('alice');
      const bob = session.client('bob');
      const rng = new Rng(seed);
      seedText(session, EMAIL_BODY);

      // Case 1: the target is edited while the AI is still generating, 50 edits go by.
      let first: Proposal | undefined;
      requestProposal(session, alice, PHRASE, 2, (p) => {
        first = p;
        alice.receiveProposal(p);
      });
      for (let i = 0; i < 50; i++) {
        if (i === 25) {
          const text = bob.getText();
          const daily = nthIndexOf(text, PHRASE, 2) + 'once '.length;
          bob.localInsert(daily, 'nightly');
          bob.localDelete(daily + 'nightly'.length, 'daily'.length);
        } else {
          editAwayFrom(rng, rng.chance(0.5) ? alice : bob, [PHRASE, 'once nightly']);
        }
        session.net.advance(150);
      }
      session.net.advanceUntil(() => first !== undefined);
      session.runUntilQuiet();
      expect(alice.getProposals().find((p) => p.id === first!.id)!.state, `seed ${seed}`).toBe('conflict');
      const textBefore = alice.getText();
      tryAccept(() => alice.acceptProposal(first!.id));
      session.runUntilQuiet();
      expectConverged(session, `seed ${seed}:`);
      expect(alice.getText(), `seed ${seed}`).toBe(textBefore);
      expect(alice.getText()).toContain('once nightly');

      // Case 2: the proposal arrives intact, then someone edits its target before it is accepted.
      let second: Proposal | undefined;
      requestProposal(session, alice, PHRASE, 1, (p) => {
        second = p;
        alice.receiveProposal(p);
      });
      session.net.advanceUntil(() => second !== undefined);
      session.runUntilQuiet();
      expect(alice.getProposals().find((p) => p.id === second!.id)!.state, `seed ${seed}`).toBe('pending');
      const text = bob.getText();
      bob.localInsert(text.indexOf(PHRASE) + 'once'.length, ' or twice');
      session.runUntilQuiet();
      expect(alice.getProposals().find((p) => p.id === second!.id)!.state, `seed ${seed}`).toBe('conflict');
      const textBefore2 = alice.getText();
      tryAccept(() => alice.acceptProposal(second!.id));
      session.runUntilQuiet();
      expectConverged(session, `seed ${seed}:`);
      expect(alice.getText(), `seed ${seed}`).toBe(textBefore2);
    }
  });

  it.skip('#8 Human in the loop: no proposal changes the text until acceptProposal is called', () => {
    const session = createSession({ seed: 8, clients: ['alice', 'bob', 'carol'] });
    const alice = session.client('alice');
    const bob = session.client('bob');
    seedText(session, EMAIL_BODY);

    const received: Proposal[] = [];
    const receiveOn = (client: typeof alice) => (p: Proposal) => {
      received.push(p);
      client.receiveProposal(p);
    };
    const p1 = requestProposal(session, alice, PHRASE, 1, receiveOn(alice));
    const p2 = requestProposal(session, alice, 'with or without food', 1, receiveOn(alice));
    const p3 = requestProposal(session, bob, 'Enrolment takes about five minutes.', 1, receiveOn(bob));
    session.net.advanceUntil(() => received.length === 3);
    session.net.advance(60_000);
    session.runUntilQuiet();

    expectConverged(session);
    expect(session.server.getText()).toBe(EMAIL_BODY);
    expect(alice.getProposals().map((p) => p.state)).toEqual(['pending', 'pending']);
    expect(bob.getProposals().map((p) => p.state)).toEqual(['pending']);

    alice.rejectProposal(p2);
    session.runUntilQuiet();
    expect(alice.getProposals().find((p) => p.id === p2)!.state).toBe('rejected');
    expect(session.server.getText()).toBe(EMAIL_BODY);

    bob.acceptProposal(p3);
    session.runUntilQuiet();
    expectConverged(session);
    expect(session.server.getText()).toBe(
      EMAIL_BODY.replace('Enrolment takes about five minutes.', 'Enrolment is quick.'),
    );
    expect(alice.getProposals().find((p) => p.id === p1)!.state).toBe('pending');
    expect(countOccurrences(session.server.getText(), PHRASE)).toBe(2);
  });
});
