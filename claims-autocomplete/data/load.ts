import { readFileSync } from 'node:fs';
import type { Claim } from '../shared/types';
import type { EntitlementsData } from '../server/entitlements';
import { DATA_FILES, type EvalQuery } from './files';

export type { EvalQuery };

let claims: Claim[] | null = null;
let entitlements: EntitlementsData | null = null;
let evalQueries: EvalQuery[] | null = null;

function read<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    throw new Error(`Could not read ${path}. Run \`npm run data\` to generate it.\n${String(err)}`);
  }
}

/** All 50k claims as generated. Parsed once per process; treat as read-only. */
export function loadClaims(): readonly Claim[] {
  return (claims ??= read<Claim[]>(DATA_FILES.claims));
}

export function loadEntitlements(): EntitlementsData {
  return (entitlements ??= read<EntitlementsData>(DATA_FILES.entitlements));
}

export function loadEvalQueries(): readonly EvalQuery[] {
  return (evalQueries ??= read<EvalQuery[]>(DATA_FILES.evalQueries));
}
