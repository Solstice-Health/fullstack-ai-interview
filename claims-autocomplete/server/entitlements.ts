import type { Asset, Brand, Client, User } from '../shared/types';

export interface EntitlementsData {
  clients: Client[];
  brands: Brand[];
  users: User[];
  assets: Asset[];
}

/**
 * Who may work on what (stands in for the users/assets tables).
 *
 * A user works for an agency and is entitled to one or more pharma clients.
 * An asset (an email, a banner, ...) belongs to one brand of one client and runs
 * in exactly one market and one channel.
 */
export class Entitlements {
  private users = new Map<string, User>();
  private assets = new Map<string, Asset>();
  private brands = new Map<string, Brand>();
  private clients = new Map<string, Client>();

  constructor(data: EntitlementsData) {
    for (const c of data.clients) this.clients.set(c.id, c);
    for (const b of data.brands) this.brands.set(b.id, b);
    for (const u of data.users) this.users.set(u.id, u);
    for (const a of data.assets) this.assets.set(a.id, a);
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getAsset(assetId: string): Asset | undefined {
    return this.assets.get(assetId);
  }

  getBrand(brandId: string): Brand | undefined {
    return this.brands.get(brandId);
  }

  getClient(clientId: string): Client | undefined {
    return this.clients.get(clientId);
  }

  /** True when both exist and the user is entitled to the asset's client. */
  canAccessAsset(userId: string, assetId: string): boolean {
    const user = this.users.get(userId);
    const asset = this.assets.get(assetId);
    return !!user && !!asset && user.clientIds.includes(asset.clientId);
  }

  listUsers(): User[] {
    return [...this.users.values()];
  }

  listAssetsForUser(userId: string): Asset[] {
    const user = this.users.get(userId);
    if (!user) return [];
    return [...this.assets.values()].filter((a) => user.clientIds.includes(a.clientId));
  }

  listAssets(): Asset[] {
    return [...this.assets.values()];
  }
}
