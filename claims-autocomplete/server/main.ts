// Dev server: real clock, default fakes, all 50k claims. `npm run dev` starts it with the web app.
import { createApp } from './app';
import { buildServer } from './routes';

const PORT = Number(process.env.API_PORT ?? 3000);

const started = Date.now();
const { deps, service } = await createApp();
const server = buildServer({ deps, service, devRoutes: true });
await server.listen({ port: PORT, host: '0.0.0.0' });
console.log(`api: http://localhost:${PORT} (ready in ${Date.now() - started} ms)`);

const shutdown = async () => {
  service.stop();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
