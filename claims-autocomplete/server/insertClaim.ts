import type { InsertResult } from '../shared/types';
import type { AppDeps } from './app';

/**
 * Inserts a claim into an asset on behalf of a user.
 *
 * `version` is the version the writer saw in the suggestion they picked.
 *
 * On success, appends a ClaimNode with the claim's exact text and citations to the
 * asset (`deps.assets.appendNode`) and returns `{ ok: true, node }`.
 *
 * Otherwise returns `{ ok: false, error }` and changes nothing. When several
 * errors apply, the first one in this list wins:
 * - FORBIDDEN: unknown user, asset or claim; the user is not entitled to the
 *   asset's client; or the claim is not for the asset's brand, market and channel.
 * - REVOKED: the claim has been revoked.
 * - EXPIRED: the claim's status is expired or its `expiresAt` has passed.
 * - STALE_VERSION: `version` is not the claim's current version.
 */
export async function insertClaim(
  deps: AppDeps,
  userId: string,
  assetId: string,
  claimId: string,
  version: number,
): Promise<InsertResult> {
  throw new Error('Not implemented');
}
