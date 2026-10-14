/**
 * Fake clock. All simulated components read time from here, so tests can
 * jump forward by days or years without waiting.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** The current time as a Date. */
  date(): Date;
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const YEAR = 365 * DAY;

export class FakeClock implements Clock {
  private ms: number;

  constructor(start: number | Date = Date.UTC(2026, 0, 1)) {
    this.ms = typeof start === 'number' ? start : start.getTime();
  }

  now(): number {
    return this.ms;
  }

  date(): Date {
    return new Date(this.ms);
  }

  /** Move time forward. Time never goes backwards. */
  advance(ms: number): void {
    if (ms < 0) throw new Error('FakeClock cannot go backwards');
    this.ms += ms;
  }

  /** Jump to an absolute time, which must not be in the past. */
  set(to: number | Date): void {
    const target = typeof to === 'number' ? to : to.getTime();
    if (target < this.ms) throw new Error('FakeClock cannot go backwards');
    this.ms = target;
  }
}
