import type { Suggestion } from '../shared/types';
import type { AppDeps } from './app';

export interface SuggestRequest {
  /** What the writer has typed so far. */
  query: string;
  userId: string;
  assetId: string;
  /** Maximum number of suggestions to return. */
  k: number;
  /** Brand currently shown in the editor, as sent by the web client. Optional. */
  brandId?: string;
}

/**
 * Suggests approved claims while a writer types.
 *
 * One instance serves all users. It is constructed once with the app's
 * dependencies, `start()` is awaited before the first `suggest()`, and `stop()`
 * is called on shutdown.
 */
export class SuggestService {
  constructor(private readonly deps: AppDeps) {}

  /** Called once before the first suggest(). */
  async start(): Promise<void> {}

  /** Called once on shutdown. */
  stop(): void {}

  /**
   * Returns up to `req.k` claims for what the writer typed, best first.
   *
   * Every returned claim must be one the user may put in this asset right now:
   * the user is entitled to the asset's client, the claim belongs to the asset's
   * brand and is approved for the asset's market and channel, its status is
   * approved and it has not passed `expiresAt` (per `deps.clock`).
   *
   * - `text` and `version` are the claim's exact current text and version.
   * - `score`: higher is better. `matchedBy`: which matching found the claim.
   * - The same query against the same claims returns the same order.
   * - An empty or whitespace-only query returns [].
   *
   * @throws InvalidQueryError when the query is longer than 200 characters.
   * @throws ForbiddenError when the user may not work on the asset.
   */
  async suggest(req: SuggestRequest): Promise<Suggestion[]> {
    throw new Error('Not implemented');
  }
}
