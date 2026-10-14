import type { Transport } from '../sim/network';
import type { AuditEntry, AuditLog } from './auditLog';
import type { Checkpoint, DocStatus } from '../shared/types';

export interface CollabServerDeps {
  /** Append-only store for the change log. Its timestamps come from the simulated clock. */
  audit: AuditLog;
}

/**
 * The server for one shared document. The document starts empty.
 *
 * TODO: implement. You may change private internals freely and add files; keep the public
 * method signatures, because the tests, the session harness and the web UI use them.
 */
export class CollabServer {
  constructor(deps: CollabServerDeps) {
    void deps;
  }

  /**
   * Called once per client when it joins, before any edits. `transport` is the server's end
   * of that client's connection; it stays the same object across disconnects and reconnects.
   * `userId` is the person using that client.
   */
  connect(clientId: string, userId: string, transport: Transport): void {
    void clientId;
    void userId;
    void transport;
    throw new Error('Not implemented');
  }

  /** The server's current text. */
  getText(): string {
    throw new Error('Not implemented');
  }

  /**
   * Freezes the current text as a named checkpoint. `hash` identifies the content.
   * `userId` is the person who created it.
   */
  checkpoint(label: string, userId: string): Checkpoint {
    void label;
    void userId;
    throw new Error('Not implemented');
  }

  /** Records that `reviewerId` approved the text of `checkpointId`. */
  approve(checkpointId: string, reviewerId: string): void {
    void checkpointId;
    void reviewerId;
    throw new Error('Not implemented');
  }

  /**
   * 'draft' until something is approved; 'approved' while the text is still the approved
   * checkpoint; 'changed_since_approval' once it has been edited after approval.
   */
  status(): DocStatus {
    throw new Error('Not implemented');
  }

  /** The text exactly as it was when `checkpointId` was created. */
  textAt(checkpointId: string): string {
    void checkpointId;
    throw new Error('Not implemented');
  }

  /**
   * Every change, checkpoint and approval, oldest first. Applying the `edit` entries in order
   * to an empty string gives the server's text at any point in the log.
   */
  auditLog(): readonly AuditEntry[] {
    throw new Error('Not implemented');
  }
}
