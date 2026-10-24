import type { AiError, ChatMessage, ChatRequest, ChatStreamEvent, ModelInfo, ProviderConfig } from './types';
import { MODELS_URL_OVERRIDE, NO_MODELS_ENDPOINT, findProvider, redactKey } from './providers';

/** Injected network function. Servers pass an SSRF-safe one; tests pass a mock. */
export type Fetcher = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export class AiFailure extends Error {
  constructor(public err: AiError) {
    super(err.message);
    this.name = 'AiFailure';
  }
}

export function buildHeaders(p: ProviderConfig, json = true): Record<string, string> {
  const h: Record<string, string> = { ...(p.headers ?? {}) };
  if (json) h['content-type'] = 'application/json';
  const key = p.apiKey.trim();
  if (key && !p.keyInQuery) {
    if (p.authStyle === 'bearer') h.authorization = `Bearer ${key}`;
    else if (p.authStyle === 'x-api-key') h['x-api-key'] = key;
    else if (p.authStyle === 'x-goog-api-key') h['x-goog-api-key'] = key;
  }
  if (p.format === 'anthropic' && !h['anthropic-version']) h['anthropic-version'] = '2023-06-01';
  return h;
}

function withKeyQuery(url: string, p: ProviderConfig): string {
  if (!p.keyInQuery || !p.apiKey) return url;
  return url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(p.apiKey);
}

export function mapHttpError(status: number, body: string, key?: string): AiError {
  let msg = '';
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail ?? '';
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {
    msg = body;
  }
  msg = redactKey(String(msg).replace(/\s+/g, ' ').trim().slice(0, 300), key);
  if (status === 401) return { code: 'unauthorized', status, message: 'The provider rejected this API key. Check it was copied completely.' + (msg ? ` (${msg})` : '') };
  if (status === 403) return { code: 'forbidden', status, message: 'The key is valid but not allowed to do this (region, plan or permissions).' + (msg ? ` (${msg})` : '') };
  if (status === 404) return { code: 'model_not_found', status, message: 'The provider could not find that model or address. Pick another model or check the base URL.' + (msg ? ` (${msg})` : '') };
  if (status === 429) return { code: 'rate_limited', status, message: 'The provider says you are out of quota or sending too fast. ' + (msg || 'Wait a bit or check your plan.') };
  if (status === 400 || status === 422) return { code: 'bad_request', status, message: msg || 'The provider rejected the request.' };
  return { code: 'upstream_error', status, message: msg || `The provider returned HTTP ${status}.` };
}

async function readText(res: Response, max = 20000): Promise<string> {
  try {
    return (await res.text()).slice(0, max);
  } catch {
    return '';
  }
}

function modelsUrl(p: ProviderConfig): string {
  if (MODELS_URL_OVERRIDE[p.providerId]) return MODELS_URL_OVERRIDE[p.providerId];
  return p.format === 'gemini' ? `${p.baseUrl}/models?pageSize=200` : `${p.baseUrl}/models`;
}

export async function listModels(p: ProviderConfig, f: Fetcher, signal?: AbortSignal): Promise<ModelInfo[]> {
  const known = findProvider(p.providerId);
  if (NO_MODELS_ENDPOINT.has(p.providerId)) return (known?.fallbackModels ?? []).map((id) => ({ id }));
  const res = await f(withKeyQuery(modelsUrl(p), p), { method: 'GET', headers: buildHeaders(p, false), signal });
  if (!res.ok) throw new AiFailure(mapHttpError(res.status, await readText(res), p.apiKey));
  let j: any;
  try {
    j = JSON.parse(await readText(res, 4_000_000));
  } catch {
    throw new AiFailure({ code: 'unsupported', message: 'That address answered, but not like an AI provider (no model list).' });
  }
  let out: ModelInfo[] = [];
  if (Array.isArray(j?.data)) out = j.data.map((m: any) => ({ id: String(m.id ?? m.name), label: m.display_name ?? m.name }));
  else if (Array.isArray(j?.models)) {
    out = j.models
      .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m: any) => ({ id: String(m.name ?? m.id ?? m.model).replace(/^models\//, ''), label: m.displayName }));
  } else if (Array.isArray(j)) out = j.map((m: any) => ({ id: String(m.id ?? m.name), label: m.name }));
  else throw new AiFailure({ code: 'unsupported', message: 'That address answered, but not like an AI provider (no model list).' });
  out = out.filter((m) => m.id && m.id !== 'undefined');
  const notChat = /embed|whisper|tts|dall-e|moderation|rerank|transcribe|image|audio|realtime|guard/i;
  const chatty = out.filter((m) => !notChat.test(m.id));
  return (chatty.length ? chatty : out).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- request builders ----------
function splitSystem(msgs: ChatMessage[]) {
  const system = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = msgs.filter((m) => m.role !== 'system');
  return { system, rest };
}

export function buildChatRequest(req: ChatRequest): { url: string; body: unknown } {
  const p = req.provider;
  const maxTokens = req.maxTokens ?? 4096;
  if (p.format === 'anthropic') {
    const { system, rest } = splitSystem(req.messages);
    return {
      url: `${p.baseUrl}/messages`,
      body: { model: p.model, max_tokens: maxTokens, stream: true, ...(system ? { system } : {}), ...(req.temperature != null ? { temperature: req.temperature } : {}), messages: rest.map((m) => ({ role: m.role, content: m.content })) },
    };
  }
  if (p.format === 'gemini') {
    const { system, rest } = splitSystem(req.messages);
    return {
      url: `${p.baseUrl}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`,
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: rest.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, ...(req.temperature != null ? { temperature: req.temperature } : {}) },
      },
    };
  }
  const isOpenAI = /(^|\.)api\.openai\.com$/.test(new URL(p.baseUrl).host);
  const reasoning = /^(o\d|gpt-5)/i.test(p.model);
  return {
    url: `${p.baseUrl}/chat/completions`,
    body: {
      model: p.model,
      messages: req.messages,
      stream: true,
      ...(isOpenAI ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...(req.temperature != null && !(isOpenAI && reasoning) ? { temperature: req.temperature } : {}),
    },
  };
}

/** Parses an SSE byte stream into JSON payloads of `data:` lines. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith('data:')) yield buf.slice(5).trim();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

export async function* chatStream(req: ChatRequest, f: Fetcher, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  const p = req.provider;
  try {
    const { url, body } = buildChatRequest(req);
    const res = await f(withKeyQuery(url, p), { method: 'POST', headers: { ...buildHeaders(p), accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
    if (!res.ok) {
      yield { error: mapHttpError(res.status, await readText(res), p.apiKey) };
      return;
    }
    if (!res.body) {
      yield { error: { code: 'upstream_error', message: 'The provider sent an empty reply.' } };
      return;
    }
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let any = false;
    for await (const data of sse(res.body)) {
      if (!data || data === '[DONE]') continue;
      let j: any;
      try { j = JSON.parse(data); } catch { continue; }
      if (j?.error) {
        yield { error: { code: 'upstream_error', message: redactKey(String(j.error.message ?? JSON.stringify(j.error)).slice(0, 300), p.apiKey) } };
        return;
      }
      let delta = '';
      if (p.format === 'anthropic') {
        if (j.type === 'content_block_delta' && typeof j.delta?.text === 'string') delta = j.delta.text;
        if (j.type === 'message_start' && j.message?.usage) usage = { ...usage, inputTokens: j.message.usage.input_tokens };
        if (j.type === 'message_delta' && j.usage) usage = { ...usage, outputTokens: j.usage.output_tokens };
      } else if (p.format === 'gemini') {
        delta = (j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('');
        if (j.usageMetadata) usage = { inputTokens: j.usageMetadata.promptTokenCount, outputTokens: j.usageMetadata.candidatesTokenCount };
      } else {
        delta = j.choices?.[0]?.delta?.content ?? '';
        if (typeof delta !== 'string') delta = '';
        if (j.usage) usage = { inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens };
      }
      if (delta) { any = true; yield { delta }; }
    }
    if (!any) {
      yield { error: { code: 'upstream_error', message: 'The model replied with no text. It may not support chat, or it refused. Try another model.' } };
      return;
    }
    yield { done: true, ...(usage ? { usage } : {}) };
  } catch (e: any) {
    if (e instanceof AiFailure) { yield { error: e.err }; return; }
    if (e?.name === 'AbortError') { yield { error: { code: 'timeout', message: 'Cancelled or timed out.' } }; return; }
    yield { error: { code: 'network', message: redactKey(String(e?.message ?? e).slice(0, 240), p.apiKey) } };
  }
}

/** Cheap end-to-end check: lists models, then asks for one word. */
export async function testProvider(p: ProviderConfig, f: Fetcher, signal?: AbortSignal): Promise<{ ok: boolean; models: ModelInfo[]; reply?: string; error?: AiError }> {
  let models: ModelInfo[] = [];
  try { models = await listModels(p, f, signal); } catch (e) { if (e instanceof AiFailure && (e.err.code === 'unauthorized' || e.err.code === 'blocked_url')) return { ok: false, models, error: e.err }; }
  let reply = '';
  for await (const ev of chatStream({ provider: p, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 16 }, f, signal)) {
    if ('delta' in ev) reply += ev.delta;
    else if ('error' in ev) return { ok: false, models, error: ev.error };
  }
  return { ok: true, models, reply: reply.trim().slice(0, 60) };
}
