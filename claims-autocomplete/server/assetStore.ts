import type { AssetNode, ClaimNode } from '../shared/types';

/**
 * Content of each asset as an ordered list of nodes (stands in for the documents table).
 * Inserted claims are stored as structured ClaimNodes so they can be found later.
 */
export class AssetStore {
  private content = new Map<string, AssetNode[]>();
  private usage = new Map<string, number>();

  getContent(assetId: string): AssetNode[] {
    return [...(this.content.get(assetId) ?? [])];
  }

  appendNode(assetId: string, node: AssetNode): void {
    const list = this.content.get(assetId) ?? [];
    list.push(node);
    this.content.set(assetId, list);
    if (node.type === 'claim') this.usage.set(node.claimId, (this.usage.get(node.claimId) ?? 0) + 1);
  }

  /** How many times a claim has been inserted, across all assets. */
  usageCount(claimId: string): number {
    return this.usage.get(claimId) ?? 0;
  }

  /** Every claim node in every asset. */
  allClaimNodes(): { assetId: string; node: ClaimNode }[] {
    const out: { assetId: string; node: ClaimNode }[] = [];
    for (const [assetId, nodes] of this.content) {
      for (const node of nodes) if (node.type === 'claim') out.push({ assetId, node });
    }
    return out;
  }
}
