import { useEffect, useMemo, useState } from 'react';
import type { User } from '../shared/types';
import { ClaimsApiProvider, httpClaimsApi, type AssetSummary, type ClaimsApi } from './api';
import { Editor } from './Editor';
import { ErrorBoundary } from './ErrorBoundary';
import { createFakeNetwork } from './fakeNetwork';

// Add ?chaos=1 to the URL to route suggest calls through the fake network with random delays.
const chaos = new URLSearchParams(window.location.search).has('chaos');

export function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState('');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [assetId, setAssetId] = useState('');

  const api: ClaimsApi | null = useMemo(() => {
    if (!userId) return null;
    const http = httpClaimsApi(userId);
    if (!chaos) return http;
    // Real answers from the server, delivered late and out of order by the fake network.
    const net = createFakeNetwork();
    const jitter = () => 20 + Math.random() * 600;
    return {
      ...http,
      suggest(params, opts) {
        const pending = net.api.suggest(params, opts);
        const req = net.last()!;
        http.suggest(params).then(
          (res) => req.respond(res, { delayMs: jitter() }),
          (err: Error) => req.fail(err, { delayMs: jitter() }),
        );
        return pending;
      },
    };
  }, [userId]);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((list: User[]) => {
        setUsers(list);
        setUserId((id) => id || list[0]?.id || '');
      })
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!api) return;
    setAssetId('');
    api.listAssets().then((list) => {
      setAssets(list);
      setAssetId(list[0]?.id ?? '');
    });
  }, [api]);

  return (
    <main>
      <nav className="toolbar">
        <strong>Claims autocomplete</strong>
        <label>
          Writer{' '}
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.clientIds.join(', ')})
              </option>
            ))}
          </select>
        </label>
        <label>
          Asset{' '}
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.brandName} · {a.market} · {a.channel} · {a.id}
              </option>
            ))}
          </select>
        </label>
        {chaos && <span className="badge semantic">chaos network</span>}
      </nav>
      {api && assetId ? (
        <ClaimsApiProvider api={api}>
          <ErrorBoundary key={assetId}>
            <Editor assetId={assetId} dev />
          </ErrorBoundary>
        </ClaimsApiProvider>
      ) : (
        <p className="muted">Loading… (is the API running on port 3000?)</p>
      )}
    </main>
  );
}
