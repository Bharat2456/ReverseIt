import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatMessage, ProviderConfig } from '../ai/types';
import { chatStream, listModels, testProvider, AiFailure, type Fetcher } from '../ai/adapters';
import { detectProviders } from '../ai/detect';
import { normalizeBaseUrl } from '../ai/providers';
import { HttpError, readJson, sendJson, startStream, writeSse } from './http';

const FORMATS = ['openai', 'anthropic', 'gemini'];
const AUTHS = ['bearer', 'x-api-key', 'x-goog-api-key', 'none'];

export function parseProvider(raw: any): ProviderConfig {
  const bad = (m: string) => new HttpError(400, { code: 'bad_request', message: m });
  if (!raw || typeof raw !== 'object') throw bad('Missing provider settings.');
  if (!FORMATS.includes(raw.format)) throw bad('Unknown provider format.');
  const authStyle = AUTHS.includes(raw.authStyle) ? raw.authStyle : 'bearer';
  const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ''));
  if (!baseUrl) throw bad('The provider address is not a valid web address.');
  const headers: Record<string, string> = {};
  if (raw.headers && typeof raw.headers === 'object') for (const [k, v] of Object.entries(raw.headers)) if (typeof v === 'string' && /^[\w-]{1,64}$/.test(k) && v.length < 300 && !/^(host|content-length|authorization|x-api-key|x-goog-api-key)$/i.test(k)) headers[k] = v;
  return { id: String(raw.id ?? 'p').slice(0, 80), providerId: String(raw.providerId ?? 'custom').slice(0, 60), label: String(raw.label ?? '').slice(0, 80), format: raw.format, baseUrl, authStyle, apiKey: String(raw.apiKey ?? '').trim().slice(0, 600), model: String(raw.model ?? '').slice(0, 200), ...(Object.keys(headers).length ? { headers } : {}), ...(raw.keyInQuery ? { keyInQuery: true } : {}) };
}

function parseMessages(raw: any): ChatMessage[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 60) throw new HttpError(400, { code: 'bad_request', message: 'Messages are missing or too many.' });
  let total = 0;
  return raw.map((m) => {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new HttpError(400, { code: 'bad_request', message: 'A message is malformed.' });
    total += m.content.length;
    if (total > 1_500_000) throw new HttpError(413, { code: 'bad_request', message: 'The conversation is too large for one request.' });
    return { role: m.role, content: m.content };
  });
}

export function makeAiRoutes(f: Fetcher) {
  return {
    async detect(req: IncomingMessage, res: ServerResponse) {
      const b = await readJson(req, 64 * 1024);
      const out = await detectProviders(String(b.apiKey ?? ''), f, { baseUrl: b.baseUrl ? String(b.baseUrl) : undefined, format: FORMATS.includes(b.format) ? b.format : undefined, probeAll: b.probeAll === true });
      sendJson(res, 200, out);
    },
    async models(req: IncomingMessage, res: ServerResponse) {
      const p = parseProvider((await readJson(req, 64 * 1024)).provider);
      try { sendJson(res, 200, { models: await listModels(p, f) }); } catch (e) {
        if (e instanceof AiFailure) return sendJson(res, 200, { models: [], error: e.err });
        const c = (e as any)?.code === 'blocked_url' ? 'blocked_url' : 'network';
        sendJson(res, 200, { models: [], error: { code: c, message: c === 'blocked_url' ? String((e as Error).message) : 'Could not reach that provider.' } });
      }
    },
    async test(req: IncomingMessage, res: ServerResponse) {
      const p = parseProvider((await readJson(req, 64 * 1024)).provider);
      try { sendJson(res, 200, await testProvider(p, f)); } catch (e: any) {
        sendJson(res, 200, { ok: false, models: [], error: { code: e?.code === 'blocked_url' ? 'blocked_url' : 'network', message: e?.code === 'blocked_url' ? e.message : 'Could not reach that provider.' } });
      }
    },
    async chat(req: IncomingMessage, res: ServerResponse) {
      const b = await readJson(req);
      const provider = parseProvider(b.provider);
      if (!provider.model) throw new HttpError(400, { code: 'bad_request', message: 'Choose a model first.' });
      const messages = parseMessages(b.messages);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      startStream(res, 'sse');
      const max = Math.min(Math.max(Number(b.maxTokens) || 4096, 16), 32000);
      for await (const ev of chatStream({ provider, messages, maxTokens: max, temperature: typeof b.temperature === 'number' ? b.temperature : undefined }, f, ac.signal)) {
        if (res.destroyed) break;
        writeSse(res, ev);
      }
      res.end();
    },
  };
}
