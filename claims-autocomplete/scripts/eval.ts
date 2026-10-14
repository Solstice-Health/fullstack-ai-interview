// Offline retrieval eval: runs every query in data/eval_queries.json through SuggestService.
//
//   npm run eval              embedder with no latency or failures
//   npm run eval -- --default embedder with its default latency and failure behaviour
import { loadEvalQueries, type EvalQuery } from '../data/load';
import { createApp } from '../server/app';
import { FakeClock } from '../shared/clock';

export interface EvalRow {
  query: EvalQuery;
  /** Claim ids returned by suggest(), best first (k = 10). */
  resultIds: string[];
  latencyMs: number;
}

/**
 * Turns eval rows into a printable report: recall@5 and MRR (mean reciprocal rank
 * of the target claim, 0 when it is not returned), overall and per query kind.
 */
export function report(rows: EvalRow[]): string {
  throw new Error('Not implemented');
}

async function main() {
  const healthy = !process.argv.includes('--default');
  const { service } = await createApp({
    clock: new FakeClock(),
    embedder: healthy ? { latencyMs: 0, latencyJitter: 0, timeoutRate: 0 } : undefined,
  });
  const rows: EvalRow[] = [];
  for (const query of loadEvalQueries()) {
    const started = performance.now();
    const results = await service.suggest({ query: query.query, userId: query.userId, assetId: query.assetId, k: 10 });
    rows.push({ query, resultIds: results.map((r) => r.claimId), latencyMs: performance.now() - started });
  }
  service.stop();
  console.log(report(rows));
}

await main();
