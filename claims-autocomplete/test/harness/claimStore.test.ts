import { describe, expect, it } from 'vitest';
import { loadClaims } from '../../data/load';
import { ClaimStore, type ClaimChangeEvent } from '../../server/claimStore';
import { FakeClock } from '../../shared/clock';

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('ClaimStore', () => {
  const claims = loadClaims().slice(0, 500);

  it('reads claims by id and by brand', () => {
    const store = new ClaimStore(claims, new FakeClock());
    const first = claims[0]!;
    expect(store.get(first.id)).toEqual(first);
    expect(store.get('clm_missing')).toBeUndefined();
    expect(store.listByBrand(first.brandId).map((c) => c.id)).toContain(first.id);
    expect(store.listAll()).toHaveLength(500);
    expect(store.getMany([first.id, 'nope'])).toEqual([first, undefined]);
    expect(store.stats.reads).toBe(5);
  });

  it('hands out frozen claims', () => {
    const store = new ClaimStore(claims, new FakeClock());
    const c = store.get(claims[0]!.id)!;
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.markets)).toBe(true);
  });

  it('revoke and approveBatch produce new versions and change events', async () => {
    const clock = new FakeClock();
    const store = new ClaimStore(claims, clock, { eventDropRate: 0 });
    const events: ClaimChangeEvent[] = [];
    store.onChange((e) => events.push(e));

    const target = claims.find((c) => c.status === 'approved')!;
    const revoked = store.revoke(target.id);
    expect(revoked).toMatchObject({ id: target.id, status: 'revoked', version: target.version + 1 });
    expect(store.get(target.id)).toBe(revoked);

    const [created, updated] = store.approveBatch([
      { brandId: target.brandId, text: 'A brand new approved claim (NEW_1).', markets: ['US'], channels: ['email'], expiresAt: '2030-01-01T00:00:00.000Z', citations: [{ id: 'CIT-1', ref: 'Ref.' }] },
      { id: target.id, brandId: target.brandId, text: target.text, markets: target.markets, channels: target.channels, expiresAt: target.expiresAt, citations: target.citations },
    ]);
    expect(created).toMatchObject({ status: 'approved', version: 1, clientId: target.clientId });
    expect(updated).toMatchObject({ id: target.id, status: 'approved', version: target.version + 2 });

    expect(events).toEqual([]); // delivered asynchronously
    await settle();
    expect(events.map((e) => [e.type, e.claimId, e.version])).toEqual([
      ['revoked', target.id, target.version + 1],
      ['approved', created!.id, 1],
      ['approved', target.id, target.version + 2],
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(store.lastSeq()).toBe(3);
    expect(events[0]!.at).toBe(clock.now());
  });

  it('unsubscribes listeners', async () => {
    const store = new ClaimStore(claims, new FakeClock(), { eventDropRate: 0 });
    const events: ClaimChangeEvent[] = [];
    const off = store.onChange((e) => events.push(e));
    off();
    store.revoke(claims[1]!.id);
    await settle();
    expect(events).toEqual([]);
  });
});
