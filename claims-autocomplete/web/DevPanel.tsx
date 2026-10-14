import { useState } from 'react';
import type { Suggestion } from '../shared/types';
import { useClaimsApi, type SampleQuery } from './api';

interface DevPanelProps {
  assetId: string;
  query: string;
  samples: SampleQuery[];
  onPickSample(query: string): void;
}

type RawResult = { ms: number; suggestions: Suggestion[] } | { ms: number; error: string };

/** Dev aids: example queries for this asset, and the raw /api/suggest response for the current text. */
export function DevPanel({ assetId, query, samples, onPickSample }: DevPanelProps) {
  const api = useClaimsApi();
  const [raw, setRaw] = useState<RawResult | null>(null);
  const [busy, setBusy] = useState(false);
  const expected = samples.find((s) => s.query === query)?.expected;

  const send = async () => {
    setBusy(true);
    const started = performance.now();
    try {
      const suggestions = await api.suggest({ query, assetId });
      setRaw({ ms: Math.round(performance.now() - started), suggestions });
    } catch (err) {
      setRaw({ ms: Math.round(performance.now() - started), error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="dev-panel" aria-label="Dev tools">
      {samples.length > 0 && (
        <div className="samples">
          <span className="muted">Try:</span>
          {samples.map((s) => (
            <button
              key={s.query}
              type="button"
              className={`chip${s.query === query ? ' active' : ''}`}
              title={s.expected ? `Meant to find ${s.expected.claimId}: ${s.expected.text}` : undefined}
              onClick={() => onPickSample(s.query)}
            >
              {s.query} <span className={`badge ${s.kind === 'paraphrase' ? 'semantic' : ''}`}>{s.kind}</span>
            </button>
          ))}
        </div>
      )}
      {expected && (
        <p className="muted">
          This example is meant to find <code>{expected.claimId}</code>: “{expected.text}”
        </p>
      )}
      <details open>
        <summary>Raw API response</summary>
        <div className="raw-actions">
          <button type="button" onClick={() => void send()} disabled={busy || !query.trim()}>
            {busy ? 'Calling…' : 'Call GET /api/suggest'}
          </button>
          {raw && <span className="muted">{raw.ms} ms</span>}
        </div>
        {raw && (
          <pre className={'error' in raw ? 'raw error' : 'raw'}>
            {'error' in raw ? `Error: ${raw.error}` : JSON.stringify(raw.suggestions, null, 2)}
          </pre>
        )}
      </details>
    </aside>
  );
}
