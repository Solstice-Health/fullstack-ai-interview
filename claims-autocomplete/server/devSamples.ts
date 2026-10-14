// Example queries for the demo UI, so there is always something to type.
import { loadEvalQueries, type EvalQuery } from '../data/load';
import type { Claim } from '../shared/types';
import type { AppDeps } from './app';

export interface SampleQuery {
  query: string;
  kind: EvalQuery['kind'];
  /** The claim the writer meant, so you can check what your suggestions return. */
  expected?: { claimId: string; text: string };
}

/** Labelled queries for this asset, then for other claims it may use, then opening words of usable claims. */
export function samplesForAsset(deps: AppDeps, assetId: string, limit = 6): SampleQuery[] {
  const asset = deps.entitlements.getAsset(assetId);
  if (!asset) return [];
  const now = deps.clock.now();
  const usable = (c: Claim | undefined): c is Claim =>
    !!c &&
    c.brandId === asset.brandId &&
    c.status === 'approved' &&
    c.markets.includes(asset.market) &&
    c.channels.includes(asset.channel) &&
    Date.parse(c.expiresAt) > now;

  const out: SampleQuery[] = [];
  const seen = new Set<string>();
  const add = (query: string, kind: EvalQuery['kind'], c: Claim) => {
    if (out.length < limit && !seen.has(query)) {
      seen.add(query);
      out.push({ query, kind, expected: { claimId: c.id, text: c.text } });
    }
  };

  const evalQueries = loadEvalQueries();
  const labelled = [
    ...evalQueries.filter((q) => q.assetId === assetId),
    ...evalQueries.filter((q) => q.assetId !== assetId),
  ];
  // Paraphrases first: they are the hardest case to get right.
  labelled.sort((a, b) => Number(b.kind === 'paraphrase') - Number(a.kind === 'paraphrase'));
  for (const q of labelled) {
    const c = deps.store.get(q.targetClaimId);
    if (usable(c)) add(q.query, q.kind, c);
  }
  for (const c of deps.store.listByBrand(asset.brandId)) {
    if (out.length >= limit) break;
    if (!usable(c)) continue;
    const words = c.text.split(/\s+/).slice(1, 6).join(' ').replace(/[^\p{L}\p{N}\s%-]/gu, '').toLowerCase();
    if (words.length >= 12) add(words, 'prefix', c);
  }
  return out;
}

/** A writer and asset whose examples include paraphrases, to open the demo on. */
export function defaultStart(deps: AppDeps): { userId: string; assetId: string } | null {
  let best: { score: number; userId: string; assetId: string } | null = null;
  const tried = new Set<string>();
  for (const q of loadEvalQueries()) {
    const key = `${q.userId} ${q.assetId}`;
    if (tried.has(key) || !deps.entitlements.canAccessAsset(q.userId, q.assetId)) continue;
    tried.add(key);
    const samples = samplesForAsset(deps, q.assetId);
    const score = samples.length + 2 * samples.filter((s) => s.kind === 'paraphrase').length;
    if (!best || score > best.score) best = { score, userId: q.userId, assetId: q.assetId };
  }
  return best && { userId: best.userId, assetId: best.assetId };
}
