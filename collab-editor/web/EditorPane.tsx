import { useLayoutEffect, useRef } from 'react';
import { attempt, type Demo } from './demo';
import { diffText } from './textDiff';
import type { CommentView, ProposalView } from '../shared/types';

export function EditorPane({ demo, clientId, refresh }: { demo: Demo; clientId: string; refresh: () => void }) {
  const session = demo.session!;
  const client = session.client(clientId);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });

  const text = attempt(demo, `${clientId}.getText`, () => client.getText(), '');
  const comments = attempt<CommentView[]>(demo, `${clientId}.getComments`, () => client.getComments(), []);
  const proposals = attempt<ProposalView[]>(demo, `${clientId}.getProposals`, () => client.getProposals(), []);
  const online = session.net.isConnected(clientId);

  // Keep the selection at the same offsets when the text changes underneath it.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(selection.current.start, selection.current.end);
    }
  }, [text]);

  const rememberSelection = () => {
    const el = textarea.current;
    if (el) selection.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const onChange = (value: string) => {
    const change = diffText(text, value);
    if (change) {
      if (change.deleteLen > 0) {
        attempt(demo, `${clientId}.localDelete`, () => client.localDelete(change.pos, change.deleteLen));
      }
      if (change.insertText) {
        attempt(demo, `${clientId}.localInsert`, () => client.localInsert(change.pos, change.insertText));
      }
    }
    rememberSelection();
    refresh(); // re-render now so React keeps the textarea's new value
  };

  const addComment = () => {
    const { start, end } = selection.current;
    if (start === end) return alert('Select some text first.');
    const body = prompt('Comment');
    if (body) attempt(demo, `${clientId}.addComment`, () => client.addComment(start, end, body));
  };

  const askAI = () => {
    const { start, end } = selection.current;
    if (start === end) return alert('Select some text first.');
    attempt(demo, `${clientId}.askAI`, () =>
      session.ai.request(
        { baseVersion: client.getVersion(), text: client.getText(), start, end, instruction: 'rewrite' },
        (p) => attempt(demo, `${clientId}.receiveProposal`, () => client.receiveProposal(p)),
      ),
    );
  };

  return (
    <section className="pane">
      <div className="pane-header">
        <strong>{client.userId}</strong>
        <button
          className={online ? 'online' : 'offline'}
          onClick={() => (online ? session.net.disconnect(clientId) : session.net.reconnect(clientId))}
        >
          {online ? 'Online' : 'Offline'}
        </button>
        <span className="version">v{attempt<number | string>(demo, `${clientId}.getVersion`, () => client.getVersion(), '?')}</span>
      </div>
      <textarea
        ref={textarea}
        value={text}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onSelect={rememberSelection}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
      />
      <div className="actions">
        <button onClick={addComment}>Comment on selection</button>
        <button onClick={askAI}>Ask AI to rewrite selection</button>
      </div>
      <div className="sidebar">
        <h3>Comments</h3>
        {comments.length === 0 && <p className="empty">None</p>}
        {comments.map((c) => (
          <div key={c.id} className={`card ${c.orphaned ? 'orphaned' : ''}`}>
            <q>{c.orphaned ? '(text deleted)' : text.slice(c.start, c.end)}</q>
            <div>{c.body}</div>
          </div>
        ))}
        <h3>AI proposals</h3>
        {proposals.length === 0 && <p className="empty">None</p>}
        {proposals.map((p) => (
          <div key={p.id} className={`card ${p.state}`}>
            <div>
              <del>{text.slice(p.start, p.end)}</del> → <ins>{p.replacementText}</ins>
            </div>
            <div className="state">{p.state}</div>
            {p.state === 'pending' && (
              <div className="actions">
                <button onClick={() => attempt(demo, `${clientId}.acceptProposal`, () => client.acceptProposal(p.id))}>
                  Accept
                </button>
                <button onClick={() => attempt(demo, `${clientId}.rejectProposal`, () => client.rejectProposal(p.id))}>
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
