import { useEffect, useMemo, useState } from 'react';
import type { User } from '../shared/types';
import { ClaimsApiProvider, httpClaimsApi, type AssetSummary, type ClaimsApi } from './api';
import { Editor } from './Editor';
import { ErrorBoundary } from './ErrorBoundary';
import { createFakeNetwork } from './fakeNetwork';

// URL options: ?user=u_001&asset=as_0001 opens that writer and asset (the page keeps them in the URL),
// and ?chaos=1 routes suggest calls through the fake network with random delays.
const params = new URLSearchParams(window.location.search);
const chaos = params.has('chaos');

function syncUrl(userId: string, assetId: string) {
  const next = new URLSearchParams(window.location.search);
  if (userId) next.set('user', userId);
  if (assetId) next.set('asset', assetId);
  else next.delete('asset');
  const url = `${window.location.pathname}?${next}`;
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
}

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

  // The asset to open once the writer's assets load: from the URL, else the demo default.
  const [wantedAsset, setWantedAsset] = useState(params.get('asset') ?? '');

  useEffect(() => {
    const start: Promise<{ userId?: string; assetId?: string }> = params.get('user')
      ? Promise.resolve({ userId: params.get('user')! })
      : fetch('/api/dev/start').then((r) => (r.ok ? r.json() : {}), () => ({}));
    Promise.all([fetch('/api/users').then((r) => r.json() as Promise<User[]>), start])
      .then(([list, s]) => {
        setUsers(list);
        if (s.assetId) setWantedAsset((a) => a || s.assetId!);
        setUserId(list.some((u) => u.id === s.userId) ? s.userId! : (list[0]?.id ?? ''));
      })
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!api) return;
    setAssetId('');
    api.listAssets().then((list) => {
      setAssets(list);
      setAssetId(list.some((a) => a.id === wantedAsset) ? wantedAsset : (list[0]?.id ?? ''));
      setWantedAsset('');
    });
    // wantedAsset is read once per writer change on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => syncUrl(userId, assetId), [userId, assetId]);

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
