import { describe, expect, it } from 'vitest';
import { createSession, userIdFor } from '../../sim/session';
import { runFuzz } from '../../sim/fuzz';
import { EMAIL_BODY } from '../../fixtures/emailBody';
import { seedText } from './helpers';

describe('approval', () => {
  it.skip('#11 (stretch) Approval: textAt(checkpoint) never changes after later edits; an edit after approval sets status to changed_since_approval', () => {
    const session = createSession({ seed: 11, clients: ['alice', 'bob'] });
    const { server } = session;
    seedText(session, EMAIL_BODY);
    expect(server.status()).toBe('draft');

    const v1 = server.checkpoint('MLR round 1', userIdFor('alice'));
    expect(server.textAt(v1.checkpointId)).toBe(EMAIL_BODY);
    expect(server.status()).toBe('draft');
    server.approve(v1.checkpointId, 'reviewer-rita');
    expect(server.status()).toBe('approved');

    // Checkpointing unchanged text gives the same hash.
    const again = server.checkpoint('no changes', userIdFor('alice'));
    expect(again.hash).toBe(v1.hash);

    runFuzz(session.net, session.clients, { seed: 11, edits: 50 });
    session.runUntilQuiet();
    expect(server.getText()).not.toBe(EMAIL_BODY);
    expect(server.textAt(v1.checkpointId)).toBe(EMAIL_BODY);
    expect(server.status()).toBe('changed_since_approval');

    const v2 = server.checkpoint('MLR round 2', userIdFor('bob'));
    expect(v2.hash).not.toBe(v1.hash);
    expect(server.textAt(v2.checkpointId)).toBe(server.getText());
    server.approve(v2.checkpointId, 'reviewer-rita');
    expect(server.status()).toBe('approved');

    session.client('bob').localInsert(0, 'x');
    session.runUntilQuiet();
    expect(server.status()).toBe('changed_since_approval');
    expect(server.textAt(v1.checkpointId)).toBe(EMAIL_BODY);
    expect(server.textAt(v2.checkpointId)).toBe(server.getText().slice(1));
  });
});
