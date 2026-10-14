import { describe, expect, it } from 'vitest';
import { SimNetwork, type NetworkEvent } from '../../sim/network';

/** Sends `count` numbered messages from each of three clients and records arrival order at the server. */
function trafficTrace(seed: number, count = 20): string[] {
  const net = new SimNetwork({ seed });
  const arrivals: string[] = [];
  for (const id of ['a', 'b', 'c']) {
    const conn = net.connect(id);
    conn.server.onMessage((m) => arrivals.push(`${id}:${(m as { n: number }).n}@${net.now}`));
    for (let n = 0; n < count; n++) {
      net.schedule(n * 7, () => conn.client.send({ n }));
    }
  }
  net.runUntilQuiet();
  return arrivals;
}

describe('SimNetwork', () => {
  it('is deterministic for a seed', () => {
    expect(trafficTrace(1)).toEqual(trafficTrace(1));
    expect(trafficTrace(1)).not.toEqual(trafficTrace(2));
  });

  it('delivers in FIFO order per connection and in both directions', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const net = new SimNetwork({ seed, minDelayMs: 1, maxDelayMs: 500 });
      const conn = net.connect('a');
      const up: number[] = [];
      const down: number[] = [];
      conn.server.onMessage((m) => up.push(m as number));
      conn.client.onMessage((m) => down.push(m as number));
      for (let i = 0; i < 50; i++) {
        conn.client.send(i);
        conn.server.send(i);
        net.advance(3);
      }
      net.runUntilQuiet();
      expect(up).toEqual([...Array(50).keys()]);
      expect(down).toEqual([...Array(50).keys()]);
    }
  });

  it('reorders messages across different connections', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const trace = trafficTrace(seed, 5).map((s) => s.split('@')[0]!.split(':')[0]);
      orders.add(trace.join(''));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('delays each message between minDelayMs and maxDelayMs', () => {
    const net = new SimNetwork({ seed: 3, minDelayMs: 40, maxDelayMs: 60 });
    const conn = net.connect('a');
    const times: number[] = [];
    conn.server.onMessage(() => times.push(net.now));
    conn.client.send('x');
    net.advance(39);
    expect(times).toEqual([]);
    net.advance(21);
    expect(times).toHaveLength(1);
    expect(times[0]).toBeGreaterThanOrEqual(40);
    expect(times[0]).toBeLessThanOrEqual(60);
  });

  it('serialises messages: the receiver gets a copy', () => {
    const net = new SimNetwork({ seed: 4 });
    const conn = net.connect('a');
    const sent = { ops: [1, 2, 3] };
    let received: unknown;
    conn.server.onMessage((m) => (received = m));
    conn.client.send(sent);
    sent.ops.push(4);
    net.runUntilQuiet();
    expect(received).toEqual({ ops: [1, 2, 3] });
    expect(received).not.toBe(sent);
  });

  it('drops messages in flight and messages sent while disconnected', () => {
    const net = new SimNetwork({ seed: 5, resendOnReconnect: 0 });
    const conn = net.connect('a');
    const up: unknown[] = [];
    const down: unknown[] = [];
    conn.server.onMessage((m) => up.push(m));
    conn.client.onMessage((m) => down.push(m));
    conn.client.send('in flight up');
    conn.server.send('in flight down');
    net.disconnect('a');
    expect(conn.client.connected).toBe(false);
    expect(conn.server.connected).toBe(false);
    conn.client.send('while offline');
    conn.server.send('while offline');
    net.runUntilQuiet();
    expect(up).toEqual([]);
    expect(down).toEqual([]);
    expect(net.stats.dropped).toBe(4);

    net.reconnect('a');
    conn.client.send('after');
    net.runUntilQuiet();
    expect(up).toEqual(['after']);
  });

  it('notifies both ends when the connection goes down and comes back', () => {
    const net = new SimNetwork({ seed: 6 });
    const conn = net.connect('a');
    const events: string[] = [];
    conn.client.onConnectionChange((c) => events.push(`client:${c}`));
    conn.server.onConnectionChange((c) => events.push(`server:${c}`));
    net.disconnect('a');
    net.disconnect('a'); // no-op
    net.reconnect('a');
    expect(events).toEqual(['server:false', 'client:false', 'server:true', 'client:true']);
    expect(net.isConnected('a')).toBe(true);
  });

  it('re-sends the most recent delivered client messages after a reconnect, before newer ones', () => {
    const net = new SimNetwork({ seed: 7 });
    const conn = net.connect('a');
    const up: unknown[] = [];
    conn.server.onMessage((m) => up.push(m));
    for (let i = 1; i <= 5; i++) conn.client.send(i);
    net.runUntilQuiet();
    net.disconnect('a');
    net.reconnect('a');
    conn.client.send('new');
    net.runUntilQuiet();
    expect(up).toEqual([1, 2, 3, 4, 5, 3, 4, 5, 'new']);
    expect(net.stats.resent).toBe(3);
  });

  it('re-sends only messages that reached the server', () => {
    const net = new SimNetwork({ seed: 8, resendOnReconnect: 3 });
    const conn = net.connect('a');
    const up: unknown[] = [];
    conn.server.onMessage((m) => up.push(m));
    conn.client.send(1);
    net.runUntilQuiet();
    conn.client.send(2); // lost in flight
    net.disconnect('a');
    net.reconnect('a');
    net.runUntilQuiet();
    expect(up).toEqual([1, 1]);
  });

  it('runs timers in simulated time', () => {
    const net = new SimNetwork({ seed: 9 });
    const fired: number[] = [];
    net.schedule(100, () => fired.push(net.now));
    net.schedule(50, () => fired.push(net.now));
    net.advance(60);
    expect(fired).toEqual([50]);
    expect(net.now).toBe(60);
    net.runUntilQuiet();
    expect(fired).toEqual([50, 100]);
    expect(net.pendingEvents()).toBe(0);
  });

  it('advanceUntil stops as soon as the condition holds, and times out otherwise', () => {
    const net = new SimNetwork({ seed: 10 });
    let done = false;
    net.schedule(1_000, () => (done = true));
    net.advanceUntil(() => done, { stepMs: 100 });
    expect(net.now).toBe(1_000);
    expect(() => net.advanceUntil(() => false, { timeoutMs: 500 })).toThrow(/still false/);
  });

  it('runUntilQuiet gives up on endless traffic', () => {
    const net = new SimNetwork({ seed: 11 });
    const conn = net.connect('a');
    conn.server.onMessage((m) => conn.server.send(m));
    conn.client.onMessage((m) => conn.client.send(m));
    conn.client.send('ping');
    expect(() => net.runUntilQuiet({ maxEvents: 1_000 })).toThrow(/still busy/);
  });

  it('reports every event to trace', () => {
    const events: NetworkEvent['type'][] = [];
    const net = new SimNetwork({ seed: 12, trace: (e) => events.push(e.type) });
    const conn = net.connect('a');
    conn.client.send('x');
    net.runUntilQuiet();
    net.disconnect('a');
    net.reconnect('a');
    net.runUntilQuiet();
    expect(events).toEqual(['send', 'deliver', 'disconnect', 'reconnect', 'resend', 'deliver']);
  });
});
