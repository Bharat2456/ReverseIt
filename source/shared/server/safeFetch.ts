/**
 * SSRF-safe outbound fetch for Node (V2 server and V3 serverless functions).
 * - Resolves DNS itself and refuses private / loopback / link-local / metadata addresses
 *   (the check happens inside the socket's lookup, so DNS-rebinding cannot swap the address afterwards).
 * - Never follows redirects automatically: callers re-validate each hop (see fetchFollow).
 * - Caps time and decoded size.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import type { Fetcher } from '../ai/adapters';

export class BlockedUrlError extends Error {
  code = 'blocked_url' as const;
}

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || /^fe[89ab]/.test(l) || l.startsWith('ff') || l.startsWith('2001:db8');
  }
  return true;
}

export interface SafeFetchOptions {
  /** Allow loopback/private targets (V2 local mode: Ollama, LM Studio). Default false. */
  allowPrivate?: boolean;
  /** Allowed destination ports. Default any when allowPrivate, else 80/443. */
  allowedPorts?: number[];
  timeoutMs?: number;
  /** Max decoded response bytes (the stream errors past this). Default 8 MiB. */
  maxBytes?: number;
}

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: any, cb: any) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      const ok = (addrs as dns.LookupAddress[]).filter((a) => allowPrivate || !isPrivateIp(a.address));
      if (!ok.length) return cb(new BlockedUrlError('That address points to a private or internal network and is blocked.'));
      if (options?.all) return cb(null, ok);
      cb(null, ok[0].address, ok[0].family);
    });
  };
}

export function makeSafeFetch(o: SafeFetchOptions = {}): Fetcher {
  const allowPrivate = !!o.allowPrivate;
  const ports = o.allowedPorts ?? (allowPrivate ? undefined : [80, 443]);
  const timeoutMs = o.timeoutMs ?? 60_000;
  const maxBytes = o.maxBytes ?? 8 * 1024 * 1024;
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      let u: URL;
      try { u = new URL(url); } catch { return reject(new BlockedUrlError('Invalid address.')); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new BlockedUrlError('Only http and https addresses are allowed.'));
      if (u.username || u.password) return reject(new BlockedUrlError('Addresses with embedded passwords are not allowed.'));
      const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      if (ports && !ports.includes(port)) return reject(new BlockedUrlError(`Port ${port} is not allowed.`));
      const host = u.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(host) && !allowPrivate && isPrivateIp(host)) return reject(new BlockedUrlError('That address points to a private or internal network and is blocked.'));
      if (!allowPrivate && /^(localhost|.*\.local|.*\.internal)$/i.test(host)) return reject(new BlockedUrlError('Local addresses are blocked.'));
      const lib = u.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = { 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'ReverseIt/1.0 (+https://github.com/Bharat2456)', ...(init.headers ?? {}) };
      const req = lib.request(u, { method: init.method ?? 'GET', headers, lookup: guardedLookup(allowPrivate) as any, timeout: timeoutMs }, (res) => {
        let stream: Readable = res;
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        let seen = 0;
        const limited = new Readable({ read() {} });
        stream.on('data', (c: Buffer) => {
          seen += c.length;
          if (seen > maxBytes) { limited.destroy(new Error('Response too large')); req.destroy(); return; }
          limited.push(c);
        });
        stream.on('end', () => limited.push(null));
        stream.on('error', (e) => limited.destroy(e));
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v != null && k !== 'content-encoding' && k !== 'content-length') h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = res.statusCode ?? 502;
        const nullBody = status === 204 || status === 304 || (status >= 100 && status < 200);
        resolve(new Response(nullBody ? null : (Readable.toWeb(limited) as any), { status: status < 200 ? 502 : status, headers: h }));
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('Timed out'), { name: 'AbortError' })));
      req.on('error', reject);
      if (init.signal) {
        if (init.signal.aborted) req.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        else init.signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
      }
      if (init.body) req.write(init.body);
      req.end();
    });
}

/** GET that follows redirects by re-running the safety checks on every hop. */
export async function fetchFollow(f: Fetcher, url: string, init: Parameters<Fetcher>[1], maxRedirects = 5): Promise<{ res: Response; finalUrl: string }> {
  let cur = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await f(cur, { ...init, method: 'GET' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      cur = new URL(res.headers.get('location')!, cur).href;
      continue;
    }
    return { res, finalUrl: cur };
  }
  throw new Error('Too many redirects');
}

export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) {
      chunks.push(value.subarray(0, value.length - (n - maxBytes)));
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(n, maxBytes));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
