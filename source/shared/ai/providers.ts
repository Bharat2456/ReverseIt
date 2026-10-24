import type { ApiFormat, AuthStyle, KnownProvider, ProviderConfig } from './types';

/**
 * Provider registry. ReverseIt is format-driven: a vendor is just a base URL +
 * one of three API formats + an auth style. Anything not listed here can still be
 * connected through the `custom-*` entries.
 */

interface KeyRule {
  re: RegExp;
  /** Higher = more specific. >= 90 means "this key can only belong to that vendor". */
  score: number;
}

const KEY_RULES: Record<string, KeyRule[]> = {
  anthropic: [{ re: /^sk-ant-/, score: 100 }],
  openrouter: [{ re: /^sk-or-/, score: 100 }],
  openai: [
    { re: /^sk-(?:proj|svcacct|admin)-/, score: 90 },
    { re: /^sk-[A-Za-z0-9_-]{40,}$/, score: 40 },
  ],
  deepseek: [{ re: /^sk-[a-f0-9]{32}$/, score: 60 }],
  dashscope: [{ re: /^sk-[a-f0-9]{32}$/, score: 58 }],
  moonshot: [{ re: /^sk-[A-Za-z0-9]{48}$/, score: 45 }],
  siliconflow: [{ re: /^sk-[a-z]{40,}$/, score: 50 }],
  groq: [{ re: /^gsk_[A-Za-z0-9]{20,}/, score: 100 }],
  gemini: [{ re: /^AIza[0-9A-Za-z_-]{35}$/, score: 100 }],
  xai: [{ re: /^xai-[A-Za-z0-9]{20,}/, score: 100 }],
  perplexity: [{ re: /^pplx-[A-Za-z0-9]{20,}/, score: 100 }],
  fireworks: [{ re: /^fw_[A-Za-z0-9]{16,}/, score: 95 }],
  nvidia: [{ re: /^nvapi-[A-Za-z0-9_-]{20,}/, score: 100 }],
  cerebras: [{ re: /^csk-[A-Za-z0-9]{20,}/, score: 100 }],
  huggingface: [{ re: /^hf_[A-Za-z0-9]{20,}$/, score: 100 }],
  github: [{ re: /^(?:ghp_|gho_|ghu_|github_pat_)[A-Za-z0-9_]{20,}/, score: 95 }],
  together: [
    { re: /^tgp_v1_[A-Za-z0-9_-]{20,}/, score: 95 },
    { re: /^[a-f0-9]{64}$/, score: 60 },
  ],
  zhipu: [{ re: /^[a-f0-9]{32}\.[A-Za-z0-9]{8,}$/, score: 90 }],
  sambanova: [{ re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, score: 70 }],
  mistral: [{ re: /^[A-Za-z0-9]{32}$/, score: 30 }],
  cohere: [{ re: /^[A-Za-z0-9]{40}$/, score: 30 }],
};

function patterns(id: string): RegExp[] {
  return (KEY_RULES[id] ?? []).map((r) => r.re);
}

const ANTHROPIC_HEADERS = { 'anthropic-version': '2023-06-01' };

export const KNOWN_PROVIDERS: KnownProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authStyle: 'x-api-key',
    keyPatterns: patterns('anthropic'),
    keyHint: 'starts with sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.claude.com/en/api/overview',
    fallbackModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-latest'],
    headers: ANTHROPIC_HEADERS,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('openai'),
    keyHint: 'starts with sk- or sk-proj-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs',
    fallbackModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    format: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authStyle: 'x-goog-api-key',
    keyPatterns: patterns('gemini'),
    keyHint: 'starts with AIza',
    consoleUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    fallbackModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('openrouter'),
    keyHint: 'starts with sk-or-',
    consoleUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
    fallbackModels: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    headers: { 'X-Title': 'ReverseIt' },
    note: 'One key, hundreds of models from many vendors.',
  },
  {
    id: 'groq',
    label: 'Groq',
    format: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('groq'),
    keyHint: 'starts with gsk_',
    consoleUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    fallbackModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    format: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('mistral'),
    keyHint: '32 letters and digits',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai',
    fallbackModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    format: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('deepseek'),
    keyHint: 'starts with sk- followed by 32 hex characters',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    format: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('xai'),
    keyHint: 'starts with xai-',
    consoleUrl: 'https://console.x.ai',
    docsUrl: 'https://docs.x.ai',
    fallbackModels: ['grok-4', 'grok-3', 'grok-3-mini'],
  },
  {
    id: 'together',
    label: 'Together AI',
    format: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('together'),
    keyHint: '64 hex characters',
    consoleUrl: 'https://api.together.ai/settings/api-keys',
    docsUrl: 'https://docs.together.ai',
    fallbackModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    format: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('fireworks'),
    keyHint: 'starts with fw_',
    consoleUrl: 'https://fireworks.ai/account/api-keys',
    docsUrl: 'https://docs.fireworks.ai',
    fallbackModels: [
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
      'accounts/fireworks/models/deepseek-v3',
      'accounts/fireworks/models/qwen2p5-72b-instruct',
    ],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    format: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    authStyle: 'bearer',
    keyPatterns: patterns('perplexity'),
    keyHint: 'starts with pplx-',
    consoleUrl: 'https://www.perplexity.ai/settings/api',
    docsUrl: 'https://docs.perplexity.ai',
    fallbackModels: ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro'],
    note: 'Search-grounded models. No model-list endpoint, so the key is checked with a 1-token request.',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    format: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('cerebras'),
    keyHint: 'starts with csk-',
    consoleUrl: 'https://cloud.cerebras.ai',
    docsUrl: 'https://inference-docs.cerebras.ai',
    fallbackModels: ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b'],
  },
  {
    id: 'sambanova',
    label: 'SambaNova',
    format: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('sambanova'),
    keyHint: 'looks like a UUID',
    consoleUrl: 'https://cloud.sambanova.ai/apis',
    docsUrl: 'https://docs.sambanova.ai',
    fallbackModels: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3-0324', 'Meta-Llama-3.1-8B-Instruct'],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    format: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('nvidia'),
    keyHint: 'starts with nvapi-',
    consoleUrl: 'https://build.nvidia.com',
    docsUrl: 'https://docs.api.nvidia.com',
    fallbackModels: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'deepseek-ai/deepseek-r1'],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    format: 'openai',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('cohere'),
    keyHint: '40 letters and digits',
    consoleUrl: 'https://dashboard.cohere.com/api-keys',
    docsUrl: 'https://docs.cohere.com/docs/compatibility-api',
    fallbackModels: ['command-a-03-2025', 'command-r-plus', 'command-r'],
    note: 'Uses Cohere\'s OpenAI-compatible endpoint.',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    format: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('huggingface'),
    keyHint: 'starts with hf_',
    consoleUrl: 'https://huggingface.co/settings/tokens',
    docsUrl: 'https://huggingface.co/docs/inference-providers',
    fallbackModels: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'github',
    label: 'GitHub Models',
    format: 'openai',
    baseUrl: 'https://models.github.ai/inference',
    authStyle: 'bearer',
    keyPatterns: patterns('github'),
    keyHint: 'a GitHub token (ghp_ / github_pat_) with models access',
    consoleUrl: 'https://github.com/settings/personal-access-tokens',
    docsUrl: 'https://docs.github.com/en/github-models',
    fallbackModels: ['openai/gpt-4.1', 'openai/gpt-4o-mini', 'meta/Llama-3.3-70B-Instruct'],
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    format: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('moonshot'),
    keyHint: 'starts with sk-',
    consoleUrl: 'https://platform.moonshot.ai/console/api-keys',
    docsUrl: 'https://platform.moonshot.ai/docs',
    fallbackModels: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'moonshot-v1-32k'],
  },
  {
    id: 'zhipu',
    label: 'Zhipu AI (GLM)',
    format: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authStyle: 'bearer',
    keyPatterns: patterns('zhipu'),
    keyHint: 'two parts separated by a dot',
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    docsUrl: 'https://docs.bigmodel.cn',
    fallbackModels: ['glm-4.6', 'glm-4.5', 'glm-4-flash'],
    note: 'No model-list endpoint, so the key is checked with a 1-token request.',
  },
  {
    id: 'dashscope',
    label: 'Alibaba Qwen (DashScope)',
    format: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('dashscope'),
    keyHint: 'starts with sk-',
    consoleUrl: 'https://bailian.console.alibabacloud.com',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio',
    fallbackModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-coder-plus'],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    format: 'openai',
    baseUrl: 'https://api.siliconflow.com/v1',
    authStyle: 'bearer',
    keyPatterns: patterns('siliconflow'),
    keyHint: 'starts with sk- followed by lowercase letters',
    consoleUrl: 'https://cloud.siliconflow.com/account/ak',
    docsUrl: 'https://docs.siliconflow.com',
    fallbackModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'THUDM/glm-4-9b-chat'],
  },
  {
    id: 'ollama',
    label: 'Ollama (on your computer)',
    format: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    authStyle: 'none',
    consoleUrl: 'https://ollama.com/download',
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    fallbackModels: ['llama3.2', 'qwen2.5-coder', 'mistral'],
    local: true,
    note: 'Free and private. Only works from the local version (Version 2) because it must reach your computer.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (on your computer)',
    format: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    authStyle: 'none',
    consoleUrl: 'https://lmstudio.ai',
    docsUrl: 'https://lmstudio.ai/docs/app/api',
    fallbackModels: ['local-model'],
    local: true,
    note: 'Free and private. Only works from the local version (Version 2).',
  },
  {
    id: 'custom-openai',
    label: 'Custom (OpenAI-compatible URL)',
    format: 'openai',
    baseUrl: '',
    authStyle: 'bearer',
    keyHint: 'any key your server accepts as a Bearer token',
    consoleUrl: '',
    fallbackModels: [],
    note: 'Works with vLLM, LiteLLM, Azure-compatible gateways, self-hosted servers and any vendor that copies the OpenAI API.',
  },
  {
    id: 'custom-anthropic',
    label: 'Custom (Anthropic-compatible URL)',
    format: 'anthropic',
    baseUrl: '',
    authStyle: 'x-api-key',
    consoleUrl: '',
    fallbackModels: [],
    headers: ANTHROPIC_HEADERS,
    note: 'For gateways and proxies that speak the Anthropic Messages API.',
  },
  {
    id: 'custom-gemini',
    label: 'Custom (Gemini-compatible URL)',
    format: 'gemini',
    baseUrl: '',
    authStyle: 'x-goog-api-key',
    consoleUrl: '',
    fallbackModels: [],
    note: 'For gateways and proxies that speak the Gemini generateContent API.',
  },
];

/** Vendors that cannot list models; they are verified with a 1-token chat request instead. */
export const NO_MODELS_ENDPOINT = new Set<string>(['perplexity', 'zhipu']);

/** Vendors whose model catalog lives at a non-standard URL. */
export const MODELS_URL_OVERRIDE: Record<string, string> = {
  github: 'https://models.github.ai/catalog/models',
};

export function findProvider(id: string): KnownProvider | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id);
}

export function isCustomProvider(id: string): boolean {
  return id.startsWith('custom-');
}

/** Cloud vendors that can be probed with a pasted key (no local, no custom). */
export function cloudProviders(): KnownProvider[] {
  return KNOWN_PROVIDERS.filter((p) => !p.local && !isCustomProvider(p.id));
}

export interface GuessResult {
  provider: KnownProvider;
  score: number;
}

/** Same as guessProviders but with the specificity score (>= 90 means unambiguous). */
export function scoreProviders(apiKey: string): GuessResult[] {
  const key = apiKey.trim();
  if (!key) return [];
  const out: GuessResult[] = [];
  for (const p of KNOWN_PROVIDERS) {
    const rules = KEY_RULES[p.id];
    if (!rules) continue;
    let best = -1;
    for (const r of rules) if (r.re.test(key)) best = Math.max(best, r.score);
    if (best >= 0) out.push({ provider: p, score: best });
  }
  // Stable sort: higher score first, registry order breaks ties.
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => b.x.score - a.x.score || a.i - b.i)
    .map((e) => e.x);
}

/**
 * Guess which vendor a key belongs to, most specific first. When nothing matches,
 * returns the generic OpenAI-compatible cloud set so the UI can still offer choices.
 */
export function guessProviders(apiKey: string): KnownProvider[] {
  const key = apiKey.trim();
  if (!key) return [];
  const scored = scoreProviders(key);
  if (scored.length) return scored.map((s) => s.provider);
  return cloudProviders().filter((p) => p.format === 'openai');
}

/**
 * Normalise a user-typed base URL: add a scheme, drop query/hash, drop trailing
 * slashes, and strip an endpoint suffix the user may have pasted by accident.
 * Returns '' for input that is not a usable URL.
 */
export function normalizeBaseUrl(input: string): string {
  let s = (input ?? '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(s);
    s = (isLocal ? 'http://' : 'https://') + s;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  let path = u.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:chat\/completions|completions|models|messages|responses)$/i, '');
  path = path.replace(/\/models\/[^/]+:(?:stream)?generateContent$/i, '');
  path = path.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

export interface MakeConfigInput {
  known?: KnownProvider | string;
  providerId?: string;
  label?: string;
  format?: ApiFormat;
  baseUrl?: string;
  authStyle?: AuthStyle;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  keyInQuery?: boolean;
  id?: string;
}

export function makeProviderConfig(input: MakeConfigInput): ProviderConfig {
  const known = typeof input.known === 'string' ? findProvider(input.known) : input.known;
  const providerId = input.providerId ?? known?.id ?? 'custom-openai';
  const format: ApiFormat = input.format ?? known?.format ?? 'openai';
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? known?.baseUrl ?? '');
  const authStyle: AuthStyle = input.authStyle ?? known?.authStyle ?? 'bearer';
  const model = input.model ?? known?.fallbackModels[0] ?? '';
  const headers = { ...(known?.headers ?? {}), ...(input.headers ?? {}) };
  return {
    id: input.id ?? `${providerId}-${Date.now()}`,
    providerId,
    label: input.label ?? known?.label ?? providerId,
    format,
    baseUrl,
    authStyle,
    apiKey: (input.apiKey ?? '').trim(),
    model,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(input.keyInQuery ? { keyInQuery: true } : {}),
  };
}

/** Remove a key (and common credential shapes) from text before it is logged or returned. */
export function redactKey(text: string, key?: string): string {
  let out = text ?? '';
  const k = (key ?? '').trim();
  if (k.length >= 6) {
    out = out.split(k).join('[redacted-key]');
    const enc = encodeURIComponent(k);
    if (enc !== k) out = out.split(enc).join('[redacted-key]');
    // Vendors often echo a masked form like "sk-abc***xyz"; hide the visible head too.
    if (k.length >= 12) out = out.split(k.slice(0, 10)).join('[redacted-key]');
  }
  out = out.replace(/([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi, '$1[redacted-key]');
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1[redacted-key]');
  return out;
}
