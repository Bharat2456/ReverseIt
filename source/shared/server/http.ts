import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AiError } from '../ai/types';

export class HttpError extends Error {
  constructor(public status: number, public err: AiError) {
    super(err.message);
  }
}

export async function readJson(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<any> {
  const pre = (req as any).body;
  if (pre !== undefined && pre !== null) {
    if (typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre;
    try { return JSON.parse(Buffer.isBuffer(pre) ? pre.toString('utf8') : String(pre)); } catch { throw new HttpError(400, { code: 'bad_request', message: 'Request body is not valid JSON.' }); }
  }
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > maxBytes) throw new HttpError(413, { code: 'bad_request', message: 'Request is too large.' });
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, { code: 'bad_request', message: 'Request body is not valid JSON.' }); }
}

const SEC: Record<string, string> = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SEC });
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, e: unknown) {
  if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
  if (e instanceof HttpError) return sendJson(res, e.status, { error: e.err });
  sendJson(res, 500, { error: { code: 'internal', message: 'Something went wrong on the server.' } });
}

export function startStream(res: ServerResponse, kind: 'sse' | 'ndjson') {
  res.writeHead(200, { 'content-type': kind === 'sse' ? 'text/event-stream; charset=utf-8' : 'application/x-ndjson; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no', ...SEC });
  (res as any).flushHeaders?.();
}

export const writeSse = (res: ServerResponse, ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
export const writeLine = (res: ServerResponse, ev: unknown) => res.write(JSON.stringify(ev) + '\n');

/** Tiny in-memory per-IP limiter (best effort on serverless, exact on a long-running server). */
export function makeLimiter(perMinute: number) {
  const hits = new Map<string, number[]>();
  return (ip: string): boolean => {
    if (!perMinute) return true;
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= perMinute) { hits.set(ip, arr); return false; }
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60_000) hits.delete(k);
    return true;
  };
}

export function clientIp(req: IncomingMessage): string {
  const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'unknown';
}
