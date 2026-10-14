import { createSession, type Session } from '../sim/session';
import { EMAIL_BODY } from '../fixtures/emailBody';

export const CLIENT_IDS = ['alice', 'bob', 'carol'];

export interface Demo {
  session: Session | null;
  /** Latest error per place, e.g. "bob.getText": "Not implemented". */
  errors: Map<string, string>;
}

let demo: Demo | undefined;

/** Builds the in-browser session once: a server and three clients on a simulated network. */
export function getDemo(): Demo {
  if (demo) return demo;
  const errors = new Map<string, string>();
  let session: Session | null = null;
  try {
    session = createSession({
      seed: Number(new URLSearchParams(location.search).get('seed') ?? 1),
      clients: CLIENT_IDS,
      network: { minDelayMs: 30, maxDelayMs: 400 },
      ai: { delayMs: 6_000 },
    });
  } catch (e) {
    errors.set('createSession (CollabServer / CollabClient)', String((e as Error).message ?? e));
  }
  demo = { session, errors };
  if (session) attempt(demo, 'alice.localInsert', () => session.client('alice').localInsert(0, EMAIL_BODY));
  return demo;
}

/** Runs `fn`, recording any error under `where`. Returns `fallback` on error. */
export function attempt<T>(d: Demo, where: string, fn: () => T, fallback?: T): T {
  try {
    const result = fn();
    d.errors.delete(where);
    return result;
  } catch (e) {
    d.errors.set(where, String((e as Error).message ?? e));
    return fallback as T;
  }
}
