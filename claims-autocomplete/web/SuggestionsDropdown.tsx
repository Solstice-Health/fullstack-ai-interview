import type { Suggestion } from '../shared/types';
import type { SuggestionStatus } from './useClaimSuggestions';

export interface SuggestionsDropdownProps {
  suggestions: Suggestion[];
  status: SuggestionStatus;
  activeIndex: number;
  onPick(s: Suggestion): void;
  onHover(index: number): void;
  /** Dev only: shows a revoke button per row. */
  onRevoke?(s: Suggestion): void;
}

export function SuggestionsDropdown({ suggestions, status, activeIndex, onPick, onHover, onRevoke }: SuggestionsDropdownProps) {
  if (status === 'idle') return null;
  return (
    <div className="dropdown" data-status={status}>
      {status === 'error' && <div className="dropdown-note error">Suggestions are unavailable right now. Keep typing to retry.</div>}
      {status === 'loading' && suggestions.length === 0 && <div className="dropdown-note">Searching…</div>}
      {status === 'ready' && suggestions.length === 0 && <div className="dropdown-note">No approved claims match.</div>}
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Approved claims">
          {suggestions.map((s, i) => (
            <li
              key={s.claimId}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'active' : undefined}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(s);
              }}
            >
              <span className="suggestion-text">{s.text}</span>
              <span className="suggestion-meta">
                <span className={`badge ${s.matchedBy}`}>{s.matchedBy}</span>
                <span className="muted">
                  {s.claimId} v{s.version} · {s.score.toFixed(3)}
                </span>
                {onRevoke && (
                  <button
                    type="button"
                    className="link"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRevoke(s);
                    }}
                  >
                    revoke (dev)
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
