import { useState } from 'react';
import { attempt, type Demo } from './demo';
import { describeOp } from '../shared/ops';
import type { AuditEntry } from '../server/auditLog';

export function ServerPanel({ demo }: { demo: Demo }) {
  const { server } = demo.session!;
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string }>>([]);

  const status = attempt(demo, 'server.status', () => server.status(), '?');
  const text = attempt(demo, 'server.getText', () => server.getText(), '');
  const log = attempt<readonly AuditEntry[]>(demo, 'server.auditLog', () => server.auditLog(), []);

  const checkpoint = () => {
    const label = `Checkpoint ${checkpoints.length + 1}`;
    const cp = attempt(demo, 'server.checkpoint', () => server.checkpoint(label, 'user-alice'));
    if (cp) setCheckpoints([...checkpoints, { id: cp.checkpointId, label }]);
  };

  const latest = checkpoints.at(-1);
  return (
    <section className="server">
      <h2>Server</h2>
      <div className="actions">
        <span className={`status ${status}`}>{status}</span>
        <span>{text.length} characters</span>
        <button onClick={checkpoint}>Create checkpoint</button>
        <button
          disabled={!latest}
          onClick={() => latest && attempt(demo, 'server.approve', () => server.approve(latest.id, 'reviewer-rita'))}
        >
          Approve {latest?.label ?? 'checkpoint'}
        </button>
      </div>
      <h3>Audit log ({log.length} entries, newest first)</h3>
      <ol className="audit" reversed>
        {log
          .slice(-12)
          .reverse()
          .map((e) => (
            <li key={e.seq}>
              <code>t={e.at}ms</code> {e.author}
              {e.kind === 'edit' && e.acceptedBy ? ` (accepted by ${e.acceptedBy})` : ''}:{' '}
              {e.kind === 'edit' ? describeOp(e.op).slice(0, 80) : `${e.kind} ${e.checkpointId}`}
            </li>
          ))}
      </ol>
    </section>
  );
}
