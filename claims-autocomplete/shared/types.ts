// Types shared by the server, the web app and the tests.

export type ClaimStatus = 'approved' | 'revoked' | 'expired';

export interface Citation {
  /** Citation marker shown after the claim text, e.g. "CIT-10422". */
  id: string;
  /** Full reference, e.g. "Okafor A, et al. N Engl J Med. 2024;390(4):312-321." */
  ref: string;
}

export interface Claim {
  id: string;
  brandId: string;
  clientId: string;
  /** Exact MLR-approved wording, 20–400 characters. */
  text: string;
  status: ClaimStatus;
  /** Market codes the claim is approved for, e.g. ["US", "UK"]. */
  markets: string[];
  /** Channels the claim is approved for, e.g. ["email", "banner"]. */
  channels: string[];
  /** ISO 8601 timestamp. */
  expiresAt: string;
  /** Starts at 1 and increases by 1 on every change to the claim. */
  version: number;
  citations: Citation[];
}

export interface Suggestion {
  claimId: string;
  version: number;
  text: string;
  score: number;
  matchedBy: 'lexical' | 'semantic' | 'both';
}

/** A claim as stored inside an asset's content once inserted. */
export interface ClaimNode {
  type: 'claim';
  claimId: string;
  version: number;
  text: string;
  citations: Citation[];
  insertedBy: string;
  /** ms since epoch, from the server clock. */
  insertedAt: number;
}

export interface TextNode {
  type: 'text';
  text: string;
}

export type AssetNode = ClaimNode | TextNode;

export type InsertError = 'REVOKED' | 'EXPIRED' | 'FORBIDDEN' | 'STALE_VERSION';

export type InsertResult = { ok: true; node: ClaimNode } | { ok: false; error: InsertError };

export interface Client {
  id: string;
  name: string;
}

export interface Brand {
  id: string;
  clientId: string;
  name: string;
}

export interface Asset {
  id: string;
  title: string;
  brandId: string;
  clientId: string;
  /** The one market this asset will run in. */
  market: string;
  /** The one channel this asset will run in. */
  channel: string;
}

export interface User {
  id: string;
  name: string;
  /** Pharma clients this user may work on. */
  clientIds: string[];
}
