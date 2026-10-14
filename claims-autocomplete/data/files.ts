import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DATA_FILES = {
  claims: join(HERE, 'claims.json'),
  entitlements: join(HERE, 'entitlements.json'),
  evalQueries: join(HERE, 'eval_queries.json'),
};

/** One labelled query from eval_queries.json. */
export interface EvalQuery {
  id: string;
  /** What the writer typed. */
  query: string;
  kind: 'prefix' | 'fragment' | 'paraphrase';
  userId: string;
  assetId: string;
  /** The claim the writer meant. */
  targetClaimId: string;
}
