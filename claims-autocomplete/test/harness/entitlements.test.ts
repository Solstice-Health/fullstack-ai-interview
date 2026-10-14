import { describe, expect, it } from 'vitest';
import { loadEntitlements } from '../../data/load';
import { Entitlements } from '../../server/entitlements';

describe('Entitlements', () => {
  const data = loadEntitlements();
  const ent = new Entitlements(data);

  it('lets users open only assets of their clients', () => {
    const user = data.users.find((u) => u.clientIds.length === 1)!;
    const own = data.assets.find((a) => a.clientId === user.clientIds[0])!;
    const other = data.assets.find((a) => a.clientId !== user.clientIds[0])!;
    expect(ent.canAccessAsset(user.id, own.id)).toBe(true);
    expect(ent.canAccessAsset(user.id, other.id)).toBe(false);
    expect(ent.canAccessAsset('u_nobody', own.id)).toBe(false);
    expect(ent.canAccessAsset(user.id, 'as_nope')).toBe(false);
    expect(ent.listAssetsForUser(user.id).every((a) => a.clientId === user.clientIds[0])).toBe(true);
  });

  it('looks up assets and brands', () => {
    const asset = data.assets[0]!;
    expect(ent.getAsset(asset.id)).toEqual(asset);
    expect(ent.getBrand(asset.brandId)?.clientId).toBe(asset.clientId);
  });
});
