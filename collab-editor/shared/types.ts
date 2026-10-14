/** Types shared by the client, the server, the tests and the web UI. */

/** An edit suggested by the AI assistant. Never applied until a person accepts it. */
export interface Proposal {
  id: string;
  /**
   * The client version (from `CollabClient.getVersion()`) whose text the AI read.
   * `start` and `end` are positions in the text as it was at that version.
   */
  baseVersion: number;
  start: number;
  end: number;
  replacementText: string;
  /** Who generated it, for the audit log. */
  author: string;
}

export type ProposalState = 'pending' | 'conflict' | 'accepted' | 'rejected';

/** A proposal as the client currently sees it. `start`/`end` are positions in the client's current text. */
export interface ProposalView {
  id: string;
  start: number;
  end: number;
  replacementText: string;
  state: ProposalState;
}

/** A comment as the client currently sees it. `start`/`end` are positions in the client's current text. */
export interface CommentView {
  id: string;
  start: number;
  end: number;
  body: string;
  /** True once all of the text the comment was attached to has been deleted. */
  orphaned: boolean;
}

export type DocStatus = 'draft' | 'approved' | 'changed_since_approval';

export interface Checkpoint {
  checkpointId: string;
  hash: string;
}
