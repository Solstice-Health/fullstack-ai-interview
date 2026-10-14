import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import type { AssetNode, InsertError, Suggestion } from '../shared/types';
import { useClaimsApi, type AssetView } from './api';
import { SuggestionsDropdown } from './SuggestionsDropdown';
import { useClaimSuggestions } from './useClaimSuggestions';

const INSERT_ERRORS: Record<InsertError, string> = {
  REVOKED: 'That claim has been revoked and can no longer be used.',
  EXPIRED: 'That claim has expired and can no longer be used.',
  FORBIDDEN: 'That claim is not approved for this asset.',
  STALE_VERSION: 'That claim has changed since it was suggested. Pick it again.',
};

export interface EditorProps {
  assetId: string;
  /** Shows dev controls (revoke buttons). */
  dev?: boolean;
  /** Override for tests of the editor shell. */
  useSuggestions?: typeof useClaimSuggestions;
}

/** Asset content (read-only claim chips and text) plus a composer with claim suggestions. */
export function Editor({ assetId, dev = false, useSuggestions = useClaimSuggestions }: EditorProps) {
  const api = useClaimsApi();
  const [view, setView] = useState<AssetView | null>(null);
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const { suggestions, status } = useSuggestions(draft, assetId);

  const reload = useCallback(() => {
    api.getAsset(assetId).then(setView, (err: unknown) => setMessage({ kind: 'error', text: String(err) }));
  }, [api, assetId]);

  useEffect(() => {
    setView(null);
    setDraft('');
    reload();
  }, [reload]);

  useEffect(() => setActive(0), [suggestions]);

  const append = (node: AssetNode) => setView((v) => (v ? { ...v, content: [...v.content, node] } : v));

  const pick = async (s: Suggestion) => {
    try {
      const result = await api.insertClaim(assetId, s.claimId, s.version);
      if (result.ok) {
        append(result.node);
        setDraft('');
        setMessage(null);
      } else {
        setMessage({ kind: 'error', text: INSERT_ERRORS[result.error] });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Insert failed: ${String(err)}` });
    }
  };

  const addText = async () => {
    const text = draft.trim();
    if (!text) return;
    await api.addText(assetId, text);
    append({ type: 'text', text });
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const s = open ? suggestions[active] : undefined;
      if (s) void pick(s);
      else void addText();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <section className="editor">
      {view && (
        <header>
          <h2>{view.asset.title}</h2>
          <p className="muted">
            {view.brand.name} · market {view.asset.market} · channel {view.asset.channel}
          </p>
        </header>
      )}
      <article className="content" aria-label="Asset content">
        {view?.content.length === 0 && <p className="muted">Nothing here yet. Start typing below.</p>}
        {view?.content.map((node, i) =>
          node.type === 'claim' ? (
            <p key={i} className="claim-node" title={`${node.claimId} v${node.version} (locked)`}>
              {node.text}
              {node.citations.map((c) => (
                <sup key={c.id} title={c.ref}>
                  [{c.id}]
                </sup>
              ))}
            </p>
          ) : (
            <p key={i}>{node.text}</p>
          ),
        )}
      </article>
      <div className="composer">
        <textarea
          aria-label="Write copy"
          placeholder="Type a claim fragment, e.g. “reduced the risk of heart attack”…"
          value={draft}
          rows={2}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setMessage(null);
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <SuggestionsDropdown
            suggestions={suggestions}
            status={status}
            activeIndex={active}
            onHover={setActive}
            onPick={(s) => void pick(s)}
            onRevoke={
              dev
                ? (s) => {
                    void api.revokeClaim(s.claimId).then(() => setMessage({ kind: 'info', text: `Revoked ${s.claimId}.` }));
                  }
                : undefined
            }
          />
        )}
        <div className="composer-actions">
          <span className="muted">↑↓ to choose · Enter to insert · Esc to close</span>
          <button type="button" onClick={() => void addText()} disabled={!draft.trim()}>
            Add as plain text
          </button>
        </div>
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={`message ${message.kind}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
