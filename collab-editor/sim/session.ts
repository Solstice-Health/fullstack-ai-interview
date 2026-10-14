import { CollabClient } from '../client/CollabClient';
import { CollabServer } from '../server/CollabServer';
import { AuditLog } from '../server/auditLog';
import { FakeAI, type FakeAIOptions } from '../server/fakeAI';
import { SimNetwork, type NetworkOptions, type Transport } from './network';

/** The parts of a client the harness needs. `CollabClient` satisfies it. */
export interface SessionClient {
  readonly clientId: string;
  readonly userId: string;
  getText(): string;
}

/** The parts of a server the harness needs. `CollabServer` satisfies it. */
export interface SessionServer {
  connect(clientId: string, userId: string, transport: Transport): void;
}

export interface SessionOptions<C extends SessionClient = CollabClient, S extends SessionServer = CollabServer> {
  seed: number;
  /** Client ids. Each client's user id is `user-<clientId>`. Default ['alice', 'bob']. */
  clients?: string[];
  network?: Omit<NetworkOptions, 'seed'>;
  ai?: FakeAIOptions;
  /** Override how the server is built (the harness's own tests use this). */
  createServer?: (deps: { audit: AuditLog }) => S;
  /** Override how a client is built (the harness's own tests use this). */
  createClient?: (options: { clientId: string; userId: string; transport: Transport }) => C;
}

export interface Session<C extends SessionClient = CollabClient, S extends SessionServer = CollabServer> {
  net: SimNetwork;
  server: S;
  audit: AuditLog;
  ai: FakeAI;
  clients: C[];
  /** The client with this id. */
  client(clientId: string): C;
  /** Every client's text, in client order. */
  texts(): string[];
  runUntilQuiet(): void;
}

export function userIdFor(clientId: string): string {
  return `user-${clientId}`;
}

/**
 * Builds a server and clients wired through a seeded `SimNetwork`.
 * All clients join before anything is edited.
 */
export function createSession<C extends SessionClient = CollabClient, S extends SessionServer = CollabServer>(
  options: SessionOptions<C, S>,
): Session<C, S> {
  const net = new SimNetwork({ seed: options.seed, ...options.network });
  const audit = new AuditLog(() => net.now);
  const createServer = options.createServer ?? ((deps) => new CollabServer(deps) as unknown as S);
  const createClient = options.createClient ?? ((o) => new CollabClient(o) as unknown as C);
  const server = createServer({ audit });
  const ids = options.clients ?? ['alice', 'bob'];
  const clients = ids.map((clientId) => {
    const userId = userIdFor(clientId);
    const connection = net.connect(clientId);
    server.connect(clientId, userId, connection.server);
    return createClient({ clientId, userId, transport: connection.client });
  });
  const byId = new Map(clients.map((c) => [c.clientId, c]));
  return {
    net,
    server,
    audit,
    ai: new FakeAI(net, options.ai),
    clients,
    client(clientId) {
      const client = byId.get(clientId);
      if (!client) throw new Error(`no client ${clientId}`);
      return client;
    },
    texts: () => clients.map((c) => c.getText()),
    runUntilQuiet: () => net.runUntilQuiet(),
  };
}
