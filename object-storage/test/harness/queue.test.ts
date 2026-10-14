import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock';
import { SimMediaProcessor } from '../../sim/mediaProcessor';
import { SimQueue } from '../../sim/queue';

describe('harness: message queue', () => {
  it('delivers each message, and by default one extra copy of it in another batch', async () => {
    const q = new SimQueue();
    await q.publish('events', { id: 1 });
    await q.publish('events', { id: 2 });
    const first = await q.receive<{ id: number }>('events');
    const second = await q.receive<{ id: number }>('events');
    expect(first.map((x) => x.body)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(second.map((x) => x.body)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(first[0]!.messageId).toBe(second[0]!.messageId);
    expect(first[0]!.deliveryId).not.toBe(second[0]!.deliveryId);
    for (const x of [...first, ...second]) await q.ack(x.deliveryId);
    expect(await q.receive('events')).toEqual([]);
  });

  it('with duplicateDeliveries: 0, delivers each message once', async () => {
    const q = new SimQueue({ duplicateDeliveries: 0 });
    await q.publish('events', 'x');
    expect(await q.receive('events')).toHaveLength(1);
  });

  it('redelivers an unacked message after the visibility timeout', async () => {
    const clock = new FakeClock();
    const q = new SimQueue({ clock, duplicateDeliveries: 0, visibilityTimeoutMs: 1000 });
    await q.publish('events', 'x');
    const [first] = await q.receive('events');
    expect(await q.receive('events')).toEqual([]);
    clock.advance(1000);
    const [again] = await q.receive('events');
    expect(again!.messageId).toBe(first!.messageId);
    expect(again!.attempt).toBe(2);
    await q.ack(again!.deliveryId);
    clock.advance(5000);
    expect(await q.receive('events')).toEqual([]);
  });

  it('respects max', async () => {
    const q = new SimQueue({ duplicateDeliveries: 0 });
    for (let i = 0; i < 5; i++) await q.publish('t', i);
    expect(await q.receive('t', { max: 2 })).toHaveLength(2);
  });
});

describe('harness: media processor', () => {
  it('adds one search-index entry per call', async () => {
    const p = new SimMediaProcessor(new FakeClock());
    const job = { tenantId: 't', bucket: 'b', key: 'k', versionId: 'v1', bytes: new Uint8Array([1, 2, 3]) };
    await p.process(job);
    await p.process(job);
    expect(p.results).toHaveLength(2);
    expect(p.results[0]).toMatchObject({ versionId: 'v1', size: 3 });
  });
});
