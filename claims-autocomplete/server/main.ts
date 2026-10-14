// Dev server: real clock, default fakes, all 50k claims. `npm run dev` starts it with the web app.
// With OPENROUTER_API_KEY set, real embeddings from OpenRouter replace the FakeEmbedder.
import { createDeps } from './app';
import type { Embedder } from './fakeEmbedder';
import { OpenRouterEmbedder } from './openRouterEmbedder';
import { buildServer } from './routes';
import { SuggestService } from './suggestService';

const PORT = Number(process.env.API_PORT ?? 3000);
const HOST = process.env.HOST || 'localhost';

const started = Date.now();
const embedder = await realEmbedder();
const deps = createDeps({ embedderInstance: embedder });
if (embedder instanceof OpenRouterEmbedder) await embedder.warm(deps.store.listAll().map((c) => c.text));
const service = new SuggestService(deps);
await service.start();
const server = buildServer({ deps, service, devRoutes: true });
await server.listen({ port: PORT, host: HOST });
console.log(`api: http://localhost:${PORT} (ready in ${Date.now() - started} ms)`);

/** OpenRouterEmbedder when OPENROUTER_API_KEY is set and working, otherwise undefined (FakeEmbedder). */
async function realEmbedder(): Promise<Embedder | undefined> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.log('embedder: fake (set OPENROUTER_API_KEY for real embeddings)');
    return undefined;
  }
  const real = new OpenRouterEmbedder({
    apiKey,
    baseUrl: process.env.OPENROUTER_BASE_URL || undefined,
    model: process.env.OPENROUTER_EMBEDDING_MODEL || undefined,
  });
  try {
    await real.init();
  } catch (err) {
    console.log(`embedder: fake (OpenRouter check failed: ${(err as Error).message})`);
    return undefined;
  }
  console.log(`embedder: OpenRouter ${real.model} (${real.dims} dims, ${real.cachedVectors} vectors cached)`);
  return real;
}

const shutdown = async () => {
  service.stop();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
