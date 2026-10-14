/**
 * Time source used by the server. Production code uses `systemClock`; tests use
 * `FakeClock` and move time forward explicitly with `advance()`.
 *
 * Timers scheduled through a clock fire according to that clock, so a
 * `setInterval(fn, 30_000)` on a FakeClock runs only when a test advances time.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

export type TimerHandle = { readonly id: number };

/** The instant every FakeClock starts at, and the "today" the dataset was generated for. */
export const CLOCK_START = Date.UTC(2026, 9, 13, 9, 0, 0); // 2026-10-13T09:00:00Z

const systemTimers = new Map<number, ReturnType<typeof setTimeout>>();
let systemTimerId = 1;

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const id = systemTimerId++;
    systemTimers.set(
      id,
      setTimeout(() => {
        systemTimers.delete(id);
        fn();
      }, ms),
    );
    return { id };
  },
  setInterval(fn, ms) {
    const id = systemTimerId++;
    systemTimers.set(id, setInterval(fn, ms));
    return { id };
  },
  clearTimer(handle) {
    const t = systemTimers.get(handle.id);
    if (t !== undefined) clearTimeout(t);
    systemTimers.delete(handle.id);
  },
};

interface FakeTimer {
  id: number;
  at: number;
  every: number | null;
  fn: () => void;
}

/**
 * Manually driven clock. Time only moves when `advance()` or `set()` is called.
 * Due timers run synchronously inside `advance()`, in time order.
 */
export class FakeClock implements Clock {
  private current: number;
  private timers = new Map<number, FakeTimer>();
  private nextId = 1;

  constructor(start: number = CLOCK_START) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    return this.schedule(fn, ms, null);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    if (ms <= 0) throw new Error('interval must be > 0');
    return this.schedule(fn, ms, ms);
  }

  clearTimer(handle: TimerHandle): void {
    this.timers.delete(handle.id);
  }

  /** Moves time forward by `ms`, running every timer that falls due on the way. */
  advance(ms: number): void {
    if (ms < 0) throw new Error('cannot go back in time');
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.current = Math.max(this.current, due.at);
      if (due.every === null) this.timers.delete(due.id);
      else due.at += due.every;
      due.fn();
    }
    this.current = target;
  }

  /** Jumps to an absolute time (must not be in the past). */
  set(time: number): void {
    this.advance(time - this.current);
  }

  /** Number of timers currently scheduled. */
  pendingTimers(): number {
    return this.timers.size;
  }

  private schedule(fn: () => void, ms: number, every: number | null): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.current + Math.max(0, ms), every, fn });
    return { id };
  }
}
