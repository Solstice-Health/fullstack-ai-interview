# Collaborative editor with an AI co-editor

Build the collaboration layer for a shared plain-text editor. Several people type at once over a flaky network, reviewers attach comments to words, an AI assistant proposes edits that a person must accept, and the server keeps checkpoints, approvals and an audit log.

The network, the fake AI, the audit store, the test harness and the web UI are done. You implement two classes.

## Commands

```bash
npm install
npm test            # all tests; the shared checks start skipped
npm run typecheck
npm run dev         # web UI at http://localhost:5173: three simulated tabs on one in-browser server
```

Run one file or one check: `npx vitest run test/shared/convergence.test.ts -t "#2"`.
Fuzzed checks run several seeds. Pick your own with `FUZZ_SEED=42` (one seed) or `FUZZ_SEEDS=1-50`.

## Run with Docker

From this folder:

```bash
docker compose up   # web UI at http://localhost:5174
```

## Real AI (optional)

By default "Ask AI" uses the fake AI. For real proposals, copy `.env.example` to `.env` in the repo root and set `OPENROUTER_API_KEY`, then restart `npm run dev` or the container. The header shows which AI is active. The key stays in the dev server (`server/aiProxy.ts`); the browser only calls `/api/ai/*`.

Real proposals take a few seconds and reach `CollabClient.receiveProposal` the same way fake ones do, so other tabs may have edited the text by then. The tests always use the fake AI.

## What you implement

| File | Class | Called by |
| --- | --- | --- |
| `server/CollabServer.ts` | `CollabServer` | the session harness, the tests, the web UI |
| `client/CollabClient.ts` | `CollabClient` | the session harness, the tests, the web UI |

Every method currently throws `Not implemented`. Keep the public signatures; change anything private and add files as you like.

```ts
class CollabServer {
  constructor(deps: { audit: AuditLog });
  connect(clientId: string, userId: string, transport: Transport): void;
  getText(): string;
  checkpoint(label: string, userId: string): { checkpointId: string; hash: string };
  approve(checkpointId: string, reviewerId: string): void;
  status(): 'draft' | 'approved' | 'changed_since_approval';
  textAt(checkpointId: string): string;
  auditLog(): readonly AuditEntry[];
}

class CollabClient {
  constructor(options: { clientId: string; userId: string; transport: Transport });
  localInsert(pos: number, text: string): void;
  localDelete(pos: number, len: number): void;
  getText(): string;
  getVersion(): number;
  addComment(start: number, end: number, body: string): string; // returns the comment id
  getComments(): { id: string; start: number; end: number; body: string; orphaned: boolean }[];
  receiveProposal(p: { id: string; baseVersion: number; start: number; end: number; replacementText: string; author: string }): void;
  getProposals(): { id: string; start: number; end: number; replacementText: string; state: 'pending' | 'conflict' | 'accepted' | 'rejected' }[];
  acceptProposal(id: string): void;
  rejectProposal(id: string): void;
}
```

The doc comments in each file describe each method's contract. One server holds one document, which starts empty. All clients join before the first edit.

You choose how edits merge and what goes over the wire. Messages are opaque to the network, so locks, operational transformation (OT) and CRDTs all fit. Libraries such as Yjs or Automerge are allowed: `npm install` what you need.

## What is provided

| Path | Contents |
| --- | --- |
| `shared/ops.ts` | `Insert {pos, text}` and `Delete {pos, len}` on plain text, plus `applyOp`. Positions are UTF-16 code units, like `String.prototype.slice`. |
| `shared/types.ts` | `Proposal`, `ProposalView`, `CommentView`, `DocStatus`, `Checkpoint`. |
| `shared/hash.ts` | `contentHash(text)`: SHA-256 hex, works in Node and the browser. |
| `sim/network.ts` | `SimNetwork`: a seeded, simulated network with one server and any number of clients. Exposes the `Transport` your classes talk through. |
| `sim/session.ts` | `createSession({ seed, clients })`: builds a `CollabServer`, one `CollabClient` per id, the network, an `AuditLog` and a `FakeAI`, all on one simulated clock. |
| `sim/fuzz.ts` | `runFuzz(net, clients, { seed, edits })`: seeded random typing for convergence checks. |
| `sim/random.ts` | `Rng`: the seeded random number generator used everywhere. |
| `server/fakeAI.ts` | `FakeAI.request({ baseVersion, text, start, end }, onReady)`: returns a proposal after a delay (default 12 s simulated). |
| `server/aiProxy.ts` | Optional real AI for the web UI, served by the Vite dev server: `GET /api/ai/status`, `POST /api/ai/propose`. Not used by the tests. |
| `server/auditLog.ts` | `AuditLog`: append-only store. `AuditEntry` is the record format the audit check replays. |
| `fixtures/emailBody.ts` | `EMAIL_BODY`: the sample pharma email used by the tests and the UI. |
| `web/` | React UI: a textarea per tab, Online/Offline toggles, comment and proposal sidebars with Accept and Reject, a server panel with checkpoint, approve and the audit log. |
| `test/harness/` | Tests for everything above. They pass now. |
| `test/shared/` | The shared checks below, written but skipped. |

### The simulated network

```ts
const net = new SimNetwork({ seed: 1 });
const { client, server } = net.connect('alice'); // two ends of one connection
net.advance(100);           // move simulated time forward 100 ms, delivering what is due
net.runUntilQuiet();        // deliver everything and run all timers
net.disconnect('alice');    // messages in flight on this connection are lost
net.reconnect('alice');
net.schedule(500, () => {}); // a timer in simulated time
```

- Nothing moves until a test calls `advance` or `runUntilQuiet`.
- A `Transport` has `send(message)`, `onMessage(handler)`, `onConnectionChange(handler)` and `connected`. Messages are JSON-serialised.
- Messages on one connection arrive in the order they were sent. Each takes a random 5–150 ms, so messages on different connections interleave.
- `send` while disconnected loses the message.
- `NetworkOptions` (seed, delays, reconnect behaviour, and a `trace` callback for every network event, useful when a seed fails) are documented in `sim/network.ts`.

## Shared checks

Un-skip them as you go (`it.skip` → `it`). They check outcomes, not how you got there.

| # | Check | File |
| --- | --- | --- |
| 1 | Convergence: after 500 random edits from 5 clients with random delays, all clients and the server have identical text | `convergence.test.ts` |
| 2 | Concurrent insert: two clients insert at the same position at the same time; every client shows both inserts in the same order | `convergence.test.ts` |
| 3 | Overlapping delete: two clients delete overlapping ranges; the overlap is deleted once, not twice | `convergence.test.ts` |
| 4 | Idempotency: an edit resent after a reconnect is applied exactly once | `reconnect.test.ts` |
| 5 | Reconnect: a client offline for 2 simulated minutes, editing the whole time, reconnects without losing its edits or anyone else's | `reconnect.test.ts` |
| 6 | Proposal rebase: a proposal based on version 10 whose target text was untouched lands at the correctly shifted position after 30 other edits | `proposals.test.ts` |
| 7 | Proposal conflict: a proposal whose target text was edited after its base version is marked conflict and is not applied | `proposals.test.ts` |
| 8 | Human in the loop: no proposal changes the text until acceptProposal is called | `proposals.test.ts` |
| 9 | Comment anchors: a comment shifts with an insert before it, shrinks or grows with edits inside it, and is marked orphaned when its text is fully deleted | `comments.test.ts` |
| 10 | Comment anchors: a comment on the second of two identical phrases stays on the second phrase after edits around the first | `comments.test.ts` |
| 11 | (stretch) Approval: textAt(checkpoint) never changes after later edits; an edit after approval sets status to changed_since_approval | `approval.test.ts` |
| 12 | (stretch) Audit: replaying the audit log from empty reproduces the text at every checkpoint exactly; every entry names a person, and AI entries also name who accepted them | `audit.test.ts` |
| 13 | (stretch) Unicode: text containing emoji and ®™ symbols converges, and anchors on it stay correct | `unicode.test.ts` |

Checks 1–10 are the main goal. 11–13 are stretch.

## Using AI

AI tools are welcome. Read, run and question what they write: in the debrief we'll ask you to walk through your code and explain how it handles specific cases.
