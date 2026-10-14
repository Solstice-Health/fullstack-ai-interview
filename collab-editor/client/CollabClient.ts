import type { Transport } from '../sim/network';
import type { CommentView, Proposal, ProposalView } from '../shared/types';

export interface CollabClientOptions {
  /** Unique per client (one browser tab). */
  clientId: string;
  /** The person using this client. */
  userId: string;
  /** The client's end of its connection to the server. */
  transport: Transport;
}

/**
 * One participant's view of the shared document. The document starts empty.
 *
 * Local edits show up in `getText()` immediately. Other participants' edits show up as their
 * messages arrive. Positions are UTF-16 code units (see `shared/ops.ts`).
 *
 * TODO: implement. You may change private internals freely and add files; keep the public
 * method signatures, because the tests, the session harness and the web UI use them.
 */
export class CollabClient {
  readonly clientId: string;
  readonly userId: string;

  constructor(options: CollabClientOptions) {
    this.clientId = options.clientId;
    this.userId = options.userId;
  }

  /** The user typed `text` at `pos`. */
  localInsert(pos: number, text: string): void {
    void pos;
    void text;
    throw new Error('Not implemented');
  }

  /** The user deleted `len` code units starting at `pos`. */
  localDelete(pos: number, len: number): void {
    void pos;
    void len;
    throw new Error('Not implemented');
  }

  /** The text this client currently shows. */
  getText(): string {
    throw new Error('Not implemented');
  }

  /**
   * A number identifying the text this client shows right now. It changes whenever the text
   * changes. Proposals carry the version their positions refer to (`Proposal.baseVersion`).
   */
  getVersion(): number {
    throw new Error('Not implemented');
  }

  /** Attaches a comment to the text between `start` and `end` (end exclusive). Returns its id. */
  addComment(start: number, end: number, body: string): string {
    void start;
    void end;
    void body;
    throw new Error('Not implemented');
  }

  /** This client's comments, with positions in the current text. */
  getComments(): CommentView[] {
    throw new Error('Not implemented');
  }

  /**
   * An AI proposal has arrived. Its positions refer to the text at `proposal.baseVersion`,
   * a version this client has already shown. It must not change the text by itself.
   */
  receiveProposal(proposal: Proposal): void {
    void proposal;
    throw new Error('Not implemented');
  }

  /** Proposals this client has received, with positions in the current text. */
  getProposals(): ProposalView[] {
    throw new Error('Not implemented');
  }

  /** The user accepted a proposal: apply it for everyone. */
  acceptProposal(id: string): void {
    void id;
    throw new Error('Not implemented');
  }

  /** The user rejected a proposal. */
  rejectProposal(id: string): void {
    void id;
    throw new Error('Not implemented');
  }
}
