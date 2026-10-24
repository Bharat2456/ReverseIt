import type { DetectCandidate, DetectResponse, ProviderConfig } from './types';
import { AiFailure, listModels, type Fetcher } from './adapters';
import { cloudProviders, findProvider, guessProviders, makeProviderConfig, normalizeBaseUrl, scoreProviders } from './providers';

export interface DetectOptions {
  /** User supplied address for self-hosted / unknown vendors. */
  baseUrl?: string;
  /** Force a format when a base URL is given. */
  format?: 'openai' | 'anthropic' | 'gemini';
  /** Send the key to every cloud vendor in turn (explicit user opt-in only). */
  probeAll?: boolean;
  signal?: AbortSignal;
  maxProbes?: number;
}

async function probe(cfg: ProviderConfig, f: Fetcher, signal?: AbortSignal): Promise<{ ok: boolean; models: DetectCandidate['models']; error?: string }> {
  try {
    const models = await listModels(cfg, f, signal);
    return { ok: true, models };
  } catch (e: any) {
    if (e instanceof AiFailure) return { ok: false, models: [], error: e.err.code === 'unauthorized' ? 'key rejected' : e.err.message.slice(0, 120) };
    return { ok: false, models: [], error: 'could not connect' };
  }
}

/**
 * Works out where an API key belongs. By default the key is only sent to vendors
 * whose key format matches (never broadcast). `probeAll` is an explicit opt-in.
 */
export async function detectProviders(apiKey: string, f: Fetcher, o: DetectOptions = {}): Promise<DetectResponse> {
  const key = apiKey.trim();
  const base = o.baseUrl ? normalizeBaseUrl(o.baseUrl) : '';
  if (o.baseUrl && !base) return { ok: false, candidates: [], message: 'That does not look like a valid web address.' };
  const targets: { cfg: ProviderConfig; pattern: boolean }[] = [];
  if (base) {
    const formats = o.format ? [o.format] : (['openai', 'anthropic', 'gemini'] as const);
    for (const format of formats) {
      const id = `custom-${format}`;
      targets.push({ cfg: makeProviderConfig({ known: findProvider(id), providerId: id, label: `Custom (${format}-style)`, baseUrl: base, apiKey: key, format, authStyle: format === 'anthropic' ? 'x-api-key' : format === 'gemini' ? 'x-goog-api-key' : key ? 'bearer' : 'none', model: '' }), pattern: false });
    }
  } else {
    if (!key) return { ok: false, candidates: [], message: 'Paste an API key first.' };
    const scored = scoreProviders(key);
    const picks = scored.length ? guessProviders(key) : [];
    const list = o.probeAll ? [...new Map([...picks, ...cloudProviders()].map((p) => [p.id, p])).values()] : picks;
    for (const p of list.slice(0, o.maxProbes ?? (o.probeAll ? 30 : 5))) targets.push({ cfg: makeProviderConfig({ known: p, apiKey: key }), pattern: scored.some((s) => s.provider.id === p.id) });
  }
  if (!targets.length) {
    return { ok: false, candidates: [], message: 'ReverseIt does not recognise this key format. Choose the provider from the list, enter its base URL, or let ReverseIt try every known provider (your key will be sent to each).' };
  }
  const results = await Promise.all(targets.map(async (t) => ({ t, r: await probe(t.cfg, f, o.signal) })));
  const candidates: DetectCandidate[] = results.map(({ t, r }) => ({
    providerId: t.cfg.providerId, label: t.cfg.label, format: t.cfg.format, baseUrl: t.cfg.baseUrl, authStyle: t.cfg.authStyle,
    patternMatch: t.pattern, verified: r.ok, models: r.models, ...(r.error ? { error: r.error } : {}),
  }));
  candidates.sort((a, b) => Number(b.verified) - Number(a.verified) || Number(b.patternMatch) - Number(a.patternMatch));
  const best = candidates.find((c) => c.verified);
  return { ok: !!best, candidates, best: best?.providerId, message: best ? undefined : 'No provider accepted this key. Check the key, or pick the provider manually.' };
}
