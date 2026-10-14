import { describe, expect, it } from 'vitest';
import { createSession, userIdFor } from '../../sim/session';
import type { Transport } from '../../sim/network';

/** Minimal stand-ins that only record what the harness wires up. */
class ProbeServer {
  readonly connections: Array<{ clientId: string; userId: string; transport: Transport }> = [];
  readonly received: Array<[string, unknown]> = [];
  connect(clientId: string, userId: string, transport: Transport) {
    this.connections.push({ clientId, userId, transport });
    transport.onMessage((m) => this.received.push([clientId, m]));
  }
}

class ProbeClient {
  readonly inbox: unknown[] = [];
  constructor(readonly o: { clientId: string; userId: string; transport: Transport }) {
    o.transport.onMessage((m) => this.inbox.push(m));
  }
  get clientId() {
    return this.o.clientId;
  }
  get userId() {
    return this.o.userId;
  }
  getText() {
    return '';
  }
}

describe('createSession', () => {
  it('connects every client to the server through the network', () => {
    const session = createSession({
      seed: 1,
      clients: ['alice', 'bob'],
      createServer: () => new ProbeServer(),
      createClient: (o) => new ProbeClient(o),
    });
    const { server } = session;
    expect(server.connections.map((c) => [c.clientId, c.userId])).toEqual([
      ['alice', userIdFor('alice')],
      ['bob', userIdFor('bob')],
    ]);

    session.client('alice').o.transport.send({ hello: 'server' });
    server.connections[1]!.transport.send({ hello: 'bob' });
    session.runUntilQuiet();
    expect(server.received).toEqual([['alice', { hello: 'server' }]]);
    expect(session.client('bob').inbox).toEqual([{ hello: 'bob' }]);
    expect(session.client('alice').inbox).toEqual([]);
    expect(session.texts()).toEqual(['', '']);
  });

  it('shares one simulated clock between the network, the audit log and the AI', () => {
    const session = createSession({
      seed: 2,
      createServer: () => new ProbeServer(),
      createClient: (o) => new ProbeClient(o),
      ai: { delayMs: 1_000 },
    });
    session.net.advance(500);
    session.audit.append({ kind: 'approval', checkpointId: 'c', author: 'r' });
    expect(session.audit.entries()[0]!.at).toBe(500);
    let at = -1;
    session.ai.request({ baseVersion: 0, text: 'abc', start: 0, end: 1 }, () => (at = session.net.now));
    session.runUntilQuiet();
    expect(at).toBe(1_500);
  });
});
