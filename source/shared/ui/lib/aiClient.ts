import type { ChatMessage, ChatStreamEvent, DetectResponse, ModelInfo, ProviderConfig, AiError } from '../../ai/types';
import type { AnalysisResult } from '../../core/types';

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Cannot reach the ReverseIt server. Check your connection (or that the local server is still running).');
  }
  const text = await res.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`The server sent an unexpected reply (HTTP ${res.status}).`); }
  if (!res.ok) throw new Error(j?.error?.message ?? `Server error (HTTP ${res.status}).`);
  return j;
}

export const apiDetect = (apiKey: string, o: { baseUrl?: string; format?: string; probeAll?: boolean } = {}, signal?: AbortSignal): Promise<DetectResponse> => postJson('/api/ai/detect', { apiKey, ...o }, signal);
export const apiModels = (provider: ProviderConfig, signal?: AbortSignal): Promise<{ models: ModelInfo[]; error?: AiError }> => postJson('/api/ai/models', { provider }, signal);
export const apiTest = (provider: ProviderConfig, signal?: AbortSignal): Promise<{ ok: boolean; models: ModelInfo[]; reply?: string; error?: AiError }> => postJson('/api/ai/test', { provider }, signal);

/** Streams /api/ai/chat (SSE). Resolves with the full text. */
export async function apiChat(provider: ProviderConfig, messages: ChatMessage[], o: { onText: (t: string) => void; signal?: AbortSignal; maxTokens?: number }): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, messages, maxTokens: o.maxTokens }), signal: o.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Cannot reach the ReverseIt server. Check your connection.');
  }
  if (!res.ok || !res.body) {
    let msg = `Server error (HTTP ${res.status}).`;
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data:')) continue;
      let ev: ChatStreamEvent;
      try { ev = JSON.parse(chunk.slice(5)); } catch { continue; }
      if ('delta' in ev) { full += ev.delta; o.onText(full); }
      else if ('error' in ev) throw new Error(ev.error.message);
    }
  }
  return full;
}

/** Streams /api/site/analyze (NDJSON). */
export async function apiAnalyzeSite(url: string, onProgress: (p: { phase: string; pct: number; message?: string }) => void, signal?: AbortSignal): Promise<AnalysisResult> {
  let res: Response;
  try {
    res = await fetch('/api/site/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }), signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Cannot reach the ReverseIt server.');
  }
  if (!res.ok || !res.body) {
    let msg = `Server error (HTTP ${res.status}).`;
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result: AnalysisResult | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'progress') onProgress({ phase: m.phase, pct: m.pct, message: m.message });
    else if (m.type === 'result') result = m.result;
    else if (m.type === 'error') throw new Error(m.error?.message ?? 'Could not read that website.');
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);
  if (!result) throw new Error('The server finished without a result. Try again.');
  return result;
}

export async function apiEngineStatus() {
  const r = await fetch('/api/engine/status');
  if (!r.ok) throw new Error('Engine status unavailable.');
  return r.json();
}

/** Uploads a file to the local server, which runs REA on it. Resolves with REA evidence records. */
export async function apiEngineRun(file: File, deep: boolean, onProgress: (p: { phase: string; pct: number; message?: string }) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`/api/engine/run?name=${encodeURIComponent(file.name)}&deep=${deep ? 1 : 0}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Cannot reach the local ReverseIt server.');
  }
  if (!res.ok || !res.body) {
    let msg = `Engine error (HTTP ${res.status}).`;
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let evidence: any[] | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'progress') onProgress({ phase: m.phase, pct: m.pct, message: m.message });
    else if (m.type === 'result') evidence = m.evidence ?? [];
    else if (m.type === 'error') throw new Error(m.error?.message ?? 'The engine failed.');
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);
  return evidence ?? [];
}
