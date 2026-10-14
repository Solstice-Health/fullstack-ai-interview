import { describe, expect, it } from 'vitest';
import { createSession, userIdFor } from '../../sim/session';
import { runFuzz } from '../../sim/fuzz';
import { applyOp } from '../../shared/ops';
import { AI_AUTHOR } from '../../server/fakeAI';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import type { Proposal } from '../../shared/types';
import { seedText } from './helpers';

describe('audit', () => {
  it.skip('#12 (stretch) Audit: replaying the audit log from empty reproduces the text at every checkpoint exactly; every entry names a person, and AI entries also name who accepted them', () => {
    const session = createSession({ seed: 12, clients: ['alice', 'bob', 'carol'] });
    const { server } = session;
    const bob = session.client('bob');
    seedText(session, EMAIL_BODY);

    runFuzz(session.net, session.clients, { seed: 12, edits: 100 });
    session.runUntilQuiet();
    const checkpoints = [server.checkpoint('after drafting', userIdFor('alice')).checkpointId];

    let proposal: Proposal | undefined;
    const bobText = bob.getText();
    session.ai.request({ baseVersion: bob.getVersion(), text: bobText, start: 0, end: 12 }, (p) => {
      proposal = p;
      bob.receiveProposal(p);
    });
    session.net.advanceUntil(() => proposal !== undefined);
    session.runUntilQuiet();
    bob.acceptProposal(proposal!.id);
    session.runUntilQuiet();
    checkpoints.push(server.checkpoint('after AI edit', userIdFor('bob')).checkpointId);
    server.approve(checkpoints[1]!, 'reviewer-rita');

    runFuzz(session.net, session.clients, { seed: 121, edits: 100 });
    session.runUntilQuiet();
    checkpoints.push(server.checkpoint('final', userIdFor('carol')).checkpointId);

    const log = server.auditLog();
    const people = new Set(['user-alice', 'user-bob', 'user-carol', 'reviewer-rita']);
    let text = '';
    const replayedAt = new Map<string, string>();
    let aiEdits = 0;
    for (const entry of log) {
      if (entry.kind === 'edit') {
        text = applyOp(text, entry.op);
        if (entry.author === AI_AUTHOR) {
          aiEdits++;
          expect(entry.acceptedBy).toBe('user-bob');
        } else {
          expect(people, `edit #${entry.seq} author`).toContain(entry.author);
        }
      } else {
        expect(people, `${entry.kind} #${entry.seq} author`).toContain(entry.author);
        if (entry.kind === 'checkpoint') replayedAt.set(entry.checkpointId, text);
      }
    }

    expect(aiEdits).toBeGreaterThan(0);
    expect(text).toBe(server.getText());
    for (const id of checkpoints) {
      expect(replayedAt.has(id), `checkpoint ${id} is in the log`).toBe(true);
      expect(replayedAt.get(id), `checkpoint ${id}`).toBe(server.textAt(id));
    }
    expect(log.some((e) => e.kind === 'approval' && e.checkpointId === checkpoints[1])).toBe(true);
  });
});
