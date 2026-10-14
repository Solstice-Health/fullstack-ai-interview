import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AppDeps } from './app';
import { defaultStart, samplesForAsset } from './devSamples';
import { ForbiddenError, InvalidQueryError } from './errors';
import { insertClaim } from './insertClaim';
import type { SuggestRequest } from './suggestService';
import type { InsertResult, Suggestion } from '../shared/types';

export interface RouteContext {
  deps: AppDeps;
  service: { suggest(req: SuggestRequest): Promise<Suggestion[]> };
  /** Defaults to insertClaim from ./insertClaim. */
  insert?: typeof insertClaim;
  /** Adds /api/dev/* routes used by the demo UI. */
  devRoutes?: boolean;
}

const DEFAULT_K = 5;
const MAX_K = 20;

/**
 * HTTP API. The caller is identified by the `x-user-id` header (auth is out of scope).
 *
 *   GET  /api/suggest?q=&assetId=&brandId=&k=   -> { suggestions: Suggestion[] }
 *   POST /api/assets/:id/claims {claimId, version} -> InsertResult
 *   GET  /api/users                             -> User[]
 *   GET  /api/assets                            -> Asset[] the caller may open
 *   GET  /api/assets/:id                        -> { asset, brand, content }
 *   POST /api/assets/:id/text {text}            -> appends a free-text node
 *   POST /api/dev/claims/:id/revoke             -> revokes a claim (dev only)
 *   GET  /api/dev/start                         -> { userId, assetId } to open the demo on (dev only)
 *   GET  /api/dev/samples?assetId=              -> example queries for an asset (dev only)
 */
export function registerRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, service } = ctx;
  const insert = ctx.insert ?? insertClaim;

  app.get('/api/suggest', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const k = Math.min(MAX_K, Math.max(1, Number(q.k ?? DEFAULT_K) || DEFAULT_K));
    try {
      const suggestions = await service.suggest({
        query: q.q ?? '',
        userId: userId(req),
        assetId: q.assetId ?? '',
        k,
        brandId: q.brandId,
      });
      return { suggestions };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/api/assets/:id/claims', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { claimId?: unknown; version?: unknown };
    if (typeof body.claimId !== 'string' || typeof body.version !== 'number') {
      return reply.code(400).send({ error: 'claimId (string) and version (number) are required' });
    }
    const result: InsertResult = await insert(deps, userId(req), id, body.claimId, body.version);
    if (result.ok) return result;
    return reply.code(result.error === 'FORBIDDEN' ? 403 : 409).send(result);
  });

  app.get('/api/users', async () => deps.entitlements.listUsers());

  app.get('/api/assets', async (req) =>
    deps.entitlements.listAssetsForUser(userId(req)).map((a) => ({
      ...a,
      brandName: deps.entitlements.getBrand(a.brandId)?.name ?? a.brandId,
    })),
  );

  app.get('/api/assets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.entitlements.canAccessAsset(userId(req), id)) return reply.code(403).send({ error: 'forbidden' });
    const asset = deps.entitlements.getAsset(id)!;
    return { asset, brand: deps.entitlements.getBrand(asset.brandId), content: deps.assets.getContent(id) };
  });

  app.post('/api/assets/:id/text', async (req, reply) => {
    const { id } = req.params as { id: string };
    const text = (req.body as { text?: unknown } | undefined)?.text;
    if (!deps.entitlements.canAccessAsset(userId(req), id)) return reply.code(403).send({ error: 'forbidden' });
    if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: 'text is required' });
    deps.assets.appendNode(id, { type: 'text', text });
    return { ok: true };
  });

  if (ctx.devRoutes) {
    app.post('/api/dev/claims/:id/revoke', async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!deps.store.get(id)) return reply.code(404).send({ error: 'unknown claim' });
      return deps.store.revoke(id);
    });

    app.get('/api/dev/start', async (_req, reply) => defaultStart(deps) ?? reply.code(404).send({ error: 'no example data' }));

    app.get('/api/dev/samples', async (req, reply) => {
      const assetId = (req.query as { assetId?: string }).assetId ?? '';
      if (!deps.entitlements.canAccessAsset(userId(req), assetId)) return reply.code(403).send({ error: 'forbidden' });
      return samplesForAsset(deps, assetId);
    });
  }
}

export function buildServer(ctx: RouteContext): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRoutes(app, ctx);
  return app;
}

function userId(req: FastifyRequest): string {
  const h = req.headers['x-user-id'];
  return Array.isArray(h) ? (h[0] ?? '') : (h ?? '');
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof InvalidQueryError) return reply.code(400).send({ error: err.message });
  if (err instanceof ForbiddenError) return reply.code(403).send({ error: err.message });
  reply.log.error(err);
  return reply.code(500).send({ error: err instanceof Error ? err.message : 'internal error' });
}
