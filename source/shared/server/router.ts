import type { IncomingMessage, ServerResponse } from 'node:http';
import { makeSafeFetch, type SafeFetchOptions } from './safeFetch';
import { makeAiRoutes } from './aiRoutes';
import { makeSiteRoute } from './siteRoute';
import { clientIp, makeLimiter, sendError, sendJson, HttpError } from './http';
import type { Fetcher } from '../ai/adapters';

export interface RouterConfig {
  mode: 'local' | 'cloud';
  version: string;
  safeFetch?: SafeFetchOptions;
  /** Allow the website analyzer to reach private/loopback addresses (localhost edition only). */
  siteAllowPrivate?: boolean;
  /** Test hook / alternative network layer. */
  fetcher?: Fetcher;
  ratePerMinute?: number;
  /** Extra routes (V2 adds jobs, REA engine, provider store). Return true if handled. */
  extra?: (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean> | boolean;
}

/** Returns an async handler for every /api/* request. Resolves true when it handled the request. */
export function createApiHandler(cfg: RouterConfig) {
  const aiFetch = cfg.fetcher ?? makeSafeFetch({ allowPrivate: cfg.mode === 'local', timeoutMs: 90_000, maxBytes: 16 * 1024 * 1024, ...(cfg.safeFetch ?? {}) });
  const siteFetch = cfg.fetcher ?? makeSafeFetch({ allowPrivate: !!cfg.siteAllowPrivate, ...(cfg.siteAllowPrivate ? {} : { allowedPorts: [80, 443, 8080, 8443] }), timeoutMs: 15_000, maxBytes: 12 * 1024 * 1024 });
  const ai = makeAiRoutes(aiFetch);
  const site = makeSiteRoute(siteFetch);
  const limit = makeLimiter(cfg.ratePerMinute ?? 0);
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '') || '/';
    if (!path.startsWith('/api')) return false;
    try {
      if (path === '/api/health') { sendJson(res, 200, { ok: true, name: 'ReverseIt', version: cfg.version, mode: cfg.mode }); return true; }
      if (cfg.extra && (await cfg.extra(req, res, path))) return true;
      const post: Record<string, (q: IncomingMessage, s: ServerResponse) => Promise<void>> = {
        '/api/ai/detect': ai.detect, '/api/ai/models': ai.models, '/api/ai/test': ai.test, '/api/ai/chat': ai.chat, '/api/site/analyze': site,
      };
      const h = post[path];
      if (!h) { sendJson(res, 404, { error: { code: 'bad_request', message: 'Unknown endpoint.' } }); return true; }
      if (req.method !== 'POST') { sendJson(res, 405, { error: { code: 'bad_request', message: 'Use POST.' } }); return true; }
      if (!limit(clientIp(req))) throw new HttpError(429, { code: 'rate_limited', message: 'Too many requests from this address. Wait a minute and try again.' });
      await h(req, res);
    } catch (e) {
      sendError(res, e);
    }
    return true;
  };
}
