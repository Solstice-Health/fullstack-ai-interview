import type { Suggestion } from '../shared/types';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useClaimsApi } from './api';

export type SuggestionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ClaimSuggestionsState {
  suggestions: Suggestion[];
  status: SuggestionStatus;
}

/**
 * Suggestions for what the writer is typing in an asset.
 *
 * Called on every render with the current text of the input. Fetches
 * suggestions through `useClaimsApi().suggest(...)`.
 *
 * - `suggestions`: results for the current `query` (never for an older one).
 * - `status`: 'idle' when there is nothing to look up, 'loading' while waiting,
 *   'ready' when `suggestions` hold results for the current query, 'error' when
 *   the request for the current query failed. An error never throws: the writer
 *   keeps typing and the next query is looked up as usual.
 */
export function useClaimSuggestions(query: string, assetId: string): ClaimSuggestionsState {
  throw new Error('Not implemented');
}
