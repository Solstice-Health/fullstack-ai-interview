import type { ProposalRequest } from '../server/fakeAI';
import type { Proposal } from '../shared/types';
import type { Session } from '../sim/session';

/**
 * Which AI the "Ask AI" button uses. The dev server reports whether OPENROUTER_API_KEY is set
 * (GET /api/ai/status); without it, or if the check fails, the UI uses the session's FakeAI.
 */
export type AIMode = { kind: 'checking' } | { kind: 'fake' } | { kind: 'real'; model: string };

let mode: AIMode = { kind: 'checking' };

fetch('/api/ai/status')
  .then((r) => (r.ok ? r.json() : null))
  .then((s: { enabled?: boolean; model?: string } | null) => {
    mode = s?.enabled && s.model ? { kind: 'real', model: s.model } : { kind: 'fake' };
  })
  .catch(() => {
    mode = { kind: 'fake' };
  });

export function aiMode(): AIMode {
  return mode;
}

/**
 * Asks for a proposal like `FakeAI.request` does, using the real AI when it is on.
 * Either way `onReady` runs from a timer on the simulated clock, so a real proposal lands
 * the same way a fake one does: late, while the other tabs keep editing.
 */
export function requestProposal(
  session: Session,
  request: ProposalRequest,
  onReady: (proposal: Proposal) => void,
  onError: (message: string) => void,
): void {
  if (mode.kind !== 'real') {
    session.ai.request(request, onReady);
    return;
  }
  fetch('/api/ai/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
    .then(async (r) => {
      const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      return body as Proposal;
    })
    .then((proposal) => session.net.schedule(0, () => onReady(proposal)))
    .catch((e: Error) => onError(e.message));
}
