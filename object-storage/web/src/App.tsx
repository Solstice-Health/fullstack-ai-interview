import { Component, useMemo, useState, type ReactNode } from 'react';
import { sha256Hex } from '../../shared/checksum';
import { FakeUploadServer } from './fakeServer';
import { FlakyNetwork } from './flakyNetwork';
import { useResumableUpload } from './useResumableUpload';

const styles = `
  body { font-family: system-ui, sans-serif; margin: 0; background: #f6f6f4; color: #1a1a1a; }
  main { max-width: 640px; margin: 40px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #ddd; padding: 20px; margin-top: 16px; }
  .bar { height: 12px; background: #eee; margin: 12px 0; }
  .bar > div { height: 100%; background: #2f6fde; transition: width 80ms linear; }
  button { margin-right: 8px; padding: 6px 12px; }
  .muted { color: #666; font-size: 13px; }
  .error { color: #b00020; }
  code { font-size: 12px; word-break: break-all; }
`;

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState(0);
  const [flaky, setFlaky] = useState(true);
  const server = useMemo(() => new FakeUploadServer(), []);
  // A new network for each file; the checkbox applies to the next file.
  const network = useMemo(() => new FlakyNetwork(server, flaky ? {} : { dropAfterRequests: [] }), [server, run]);

  return (
    <main>
      <style>{styles}</style>
      <h1>Resumable uploader</h1>
      <p className="muted">
        Uploads go to an in-browser fake server over a fake network. With a flaky network, the connection drops a
        few requests in. Use the button to drop it again at any time.
      </p>
      <div className="card">
        <input
          type="file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setRun((r) => r + 1);
          }}
        />
        <label style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={flaky} onChange={(e) => setFlaky(e.target.checked)} /> Flaky network (next file)
        </label>
      </div>
      {file && (
        <ErrorBoundary key={run}>
          <Upload key={run} file={file} network={network} server={server} />
        </ErrorBoundary>
      )}
    </main>
  );
}

function Upload({ file, network, server }: { file: File; network: FlakyNetwork; server: FakeUploadServer }) {
  const upload = useResumableUpload(file, network, { partSize: Math.max(64 * 1024, Math.ceil(file.size / 40)) });
  const [check, setCheck] = useState<string | null>(null);
  const pct = Math.round(upload.progress * 1000) / 10;

  const verify = async () => {
    const stored = server.objects.get(file.name);
    const local = new Uint8Array(await file.arrayBuffer());
    if (!stored) return setCheck('Not found on the server.');
    setCheck(sha256Hex(stored) === sha256Hex(local) ? 'SHA-256 matches the local file.' : 'SHA-256 MISMATCH.');
  };

  return (
    <div className="card">
      <div>
        <strong>{file.name}</strong> <span className="muted">({file.size.toLocaleString()} bytes)</span>
      </div>
      <div className="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div>
        {pct}% · {upload.state}
        {upload.error && <span className="error"> · {upload.error}</span>}
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={upload.pause} disabled={upload.state !== 'uploading'}>
          Pause
        </button>
        <button onClick={upload.resume} disabled={upload.state !== 'paused' && upload.state !== 'error'}>
          Resume
        </button>
        <button onClick={() => network.dropNow()}>Drop connection</button>
        {upload.state === 'done' && <button onClick={verify}>Verify</button>}
      </div>
      <p className="muted">
        Requests: {network.requests} · drops: {network.drops} · part bytes received by server:{' '}
        {server.bytesReceived.toLocaleString()}
      </p>
      {upload.versionId && (
        <p className="muted">
          versionId: <code>{upload.versionId}</code>
        </p>
      )}
      {check && <p>{check}</p>}
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="card error">
          {this.state.error.message === 'Not implemented'
            ? 'useResumableUpload is not implemented yet (web/src/useResumableUpload.ts).'
            : this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
