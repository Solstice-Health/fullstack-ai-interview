import { useEffect, useState } from 'react';
import { aiMode } from './ai';
import { CLIENT_IDS, attempt, getDemo } from './demo';
import { EditorPane } from './EditorPane';
import { ServerPanel } from './ServerPanel';

export function App() {
  const demo = getDemo();
  const [, setTick] = useState(0);

  // Drive simulated time from the real clock and re-render each frame.
  useEffect(() => {
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (demo.session) attempt(demo, 'network', () => demo.session!.net.advance(Math.round(now - last)));
      last = now;
      setTick((t) => t + 1);
    }, 50);
    return () => clearInterval(timer);
  }, [demo]);

  const { session, errors } = demo;
  const ai = aiMode();
  return (
    <div className="app">
      <header>
        <h1>Collaborative editor</h1>
        <span className="hint">Three simulated tabs on one in-browser server. Add ?seed=N to the URL for a different network.</span>
        <span className={`ai-mode ${ai.kind}`}>
          {ai.kind === 'real' ? `AI: ${ai.model} (OpenRouter)` : ai.kind === 'fake' ? 'AI: simulated (FakeAI)' : 'AI: checking…'}
        </span>
      </header>
      {errors.size > 0 && (
        <div className="errors">
          {[...errors].map(([where, message]) => (
            <div key={where}>
              <code>{where}</code>: {message}
            </div>
          ))}
        </div>
      )}
      {session && (
        <>
          <div className="panes">
            {CLIENT_IDS.map((id) => (
              <EditorPane key={id} demo={demo} clientId={id} refresh={() => setTick((t) => t + 1)} />
            ))}
          </div>
          <ServerPanel demo={demo} />
        </>
      )}
    </div>
  );
}
