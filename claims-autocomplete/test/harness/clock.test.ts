import { describe, expect, it } from 'vitest';
import { CLOCK_START, FakeClock } from '../../shared/clock';

describe('FakeClock', () => {
  it('starts at CLOCK_START and only moves when advanced', () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(CLOCK_START);
    clock.advance(1500);
    expect(clock.now()).toBe(CLOCK_START + 1500);
  });

  it('runs timeouts and intervals in time order while advancing', () => {
    const clock = new FakeClock(0);
    const log: string[] = [];
    clock.setTimeout(() => log.push(`t@${clock.now()}`), 250);
    const h = clock.setInterval(() => log.push(`i@${clock.now()}`), 100);
    clock.advance(350);
    expect(log).toEqual(['i@100', 'i@200', 't@250', 'i@300']);
    clock.clearTimer(h);
    clock.advance(1000);
    expect(log).toHaveLength(4);
    expect(clock.pendingTimers()).toBe(0);
  });
});
