import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SiteFetcher } from '../core/types';
import { analyzeWebsite, normalizeUrlInput } from '../core/website';
import type { Fetcher } from '../ai/adapters';
import { fetchFollow, readCapped } from './safeFetch';
import { HttpError, readJson, startStream, writeLine } from './http';

export function makeSiteFetcher(f: Fetcher, signal?: AbortSignal): SiteFetcher {
  return async (url, init) => {
    const { res, finalUrl } = await fetchFollow(f, url, { headers: { accept: init?.accept ?? '*/*' }, signal });
    const body = await readCapped(res, init?.maxBytes ?? 4 * 1024 * 1024);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return { status: res.status, finalUrl, headers, body };
  };
}

export function makeSiteRoute(f: Fetcher) {
  return async function analyze(req: IncomingMessage, res: ServerResponse) {
    const b = await readJson(req, 16 * 1024);
    const url = normalizeUrlInput(String(b.url ?? ''));
    if (!url) throw new HttpError(400, { code: 'bad_request', message: 'That does not look like a web address. Try something like example.com' });
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const timer = setTimeout(() => ac.abort(), 55_000);
    startStream(res, 'ndjson');
    try {
      const result = await analyzeWebsite(url, makeSiteFetcher(f, ac.signal), {
        signal: ac.signal,
        maxAssets: 30,
        onProgress: (p) => { if (!res.destroyed) writeLine(res, { type: 'progress', ...p }); },
      });
      writeLine(res, { type: 'result', result });
    } catch (e: any) {
      const blocked = e?.code === 'blocked_url';
      const msg = blocked ? String(e.message) : e?.name === 'AbortedError' || e?.name === 'AbortError' ? 'The site took too long to answer.' : /ENOTFOUND|EAI_AGAIN/.test(String(e?.code ?? e?.message)) ? 'That website address could not be found.' : String(e?.message ?? 'Could not read that website.').slice(0, 240);
      writeLine(res, { type: 'error', error: { code: blocked ? 'blocked_url' : 'network', message: msg } });
    } finally {
      clearTimeout(timer);
      res.end();
    }
  };
}
