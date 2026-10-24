"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// entries/api.ts
var api_exports = {};
__export(api_exports, {
  default: () => api_default
});
module.exports = __toCommonJS(api_exports);

// shared/server/safeFetch.ts
var import_node_http = __toESM(require("node:http"));
var import_node_https = __toESM(require("node:https"));
var import_node_dns = __toESM(require("node:dns"));
var import_node_net = __toESM(require("node:net"));
var import_node_zlib = __toESM(require("node:zlib"));
var import_node_stream = require("node:stream");
var BlockedUrlError = class extends Error {
  code = "blocked_url";
};
function isPrivateIp(ip) {
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));
  const v = import_node_net.default.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 192 && b === 0 || a === 198 && (b === 18 || b === 19) || a >= 224;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    return l === "::" || l === "::1" || l.startsWith("fc") || l.startsWith("fd") || /^fe[89ab]/.test(l) || l.startsWith("ff") || l.startsWith("2001:db8");
  }
  return true;
}
function guardedLookup(allowPrivate) {
  return (hostname, options, cb) => {
    import_node_dns.default.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      const ok = addrs.filter((a) => allowPrivate || !isPrivateIp(a.address));
      if (!ok.length) return cb(new BlockedUrlError("That address points to a private or internal network and is blocked."));
      if (options?.all) return cb(null, ok);
      cb(null, ok[0].address, ok[0].family);
    });
  };
}
function makeSafeFetch(o = {}) {
  const allowPrivate = !!o.allowPrivate;
  const ports = o.allowedPorts ?? (allowPrivate ? void 0 : [80, 443]);
  const timeoutMs = o.timeoutMs ?? 6e4;
  const maxBytes = o.maxBytes ?? 8 * 1024 * 1024;
  return (url, init) => new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new BlockedUrlError("Invalid address."));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new BlockedUrlError("Only http and https addresses are allowed."));
    if (u.username || u.password) return reject(new BlockedUrlError("Addresses with embedded passwords are not allowed."));
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    if (ports && !ports.includes(port)) return reject(new BlockedUrlError(`Port ${port} is not allowed.`));
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (import_node_net.default.isIP(host) && !allowPrivate && isPrivateIp(host)) return reject(new BlockedUrlError("That address points to a private or internal network and is blocked."));
    if (!allowPrivate && /^(localhost|.*\.local|.*\.internal)$/i.test(host)) return reject(new BlockedUrlError("Local addresses are blocked."));
    const lib = u.protocol === "https:" ? import_node_https.default : import_node_http.default;
    const headers = { "accept-encoding": "gzip, deflate, br", "user-agent": "ReverseIt/1.0 (+https://github.com/Bharat2456)", ...init.headers ?? {} };
    const req = lib.request(u, { method: init.method ?? "GET", headers, lookup: guardedLookup(allowPrivate), timeout: timeoutMs }, (res) => {
      let stream = res;
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      if (enc === "gzip") stream = res.pipe(import_node_zlib.default.createGunzip());
      else if (enc === "br") stream = res.pipe(import_node_zlib.default.createBrotliDecompress());
      else if (enc === "deflate") stream = res.pipe(import_node_zlib.default.createInflate());
      let seen = 0;
      const limited = new import_node_stream.Readable({ read() {
      } });
      stream.on("data", (c) => {
        seen += c.length;
        if (seen > maxBytes) {
          limited.destroy(new Error("Response too large"));
          req.destroy();
          return;
        }
        limited.push(c);
      });
      stream.on("end", () => limited.push(null));
      stream.on("error", (e) => limited.destroy(e));
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v != null && k !== "content-encoding" && k !== "content-length") h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode ?? 502;
      const nullBody = status === 204 || status === 304 || status >= 100 && status < 200;
      resolve(new Response(nullBody ? null : import_node_stream.Readable.toWeb(limited), { status: status < 200 ? 502 : status, headers: h }));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("Timed out"), { name: "AbortError" })));
    req.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) req.destroy(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      else init.signal.addEventListener("abort", () => req.destroy(Object.assign(new Error("Aborted"), { name: "AbortError" })), { once: true });
    }
    if (init.body) req.write(init.body);
    req.end();
  });
}
async function fetchFollow(f, url, init, maxRedirects = 5) {
  let cur = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await f(cur, { ...init, method: "GET" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      try {
        await res.body?.cancel();
      } catch {
      }
      cur = new URL(res.headers.get("location"), cur).href;
      continue;
    }
    return { res, finalUrl: cur };
  }
  throw new Error("Too many redirects");
}
async function readCapped(res, maxBytes) {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) {
      chunks.push(value.subarray(0, value.length - (n - maxBytes)));
      try {
        await reader.cancel();
      } catch {
      }
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(n, maxBytes));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// shared/ai/providers.ts
var KEY_RULES = {
  anthropic: [{ re: /^sk-ant-/, score: 100 }],
  openrouter: [{ re: /^sk-or-/, score: 100 }],
  openai: [
    { re: /^sk-(?:proj|svcacct|admin)-/, score: 90 },
    { re: /^sk-[A-Za-z0-9_-]{40,}$/, score: 40 }
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
    { re: /^[a-f0-9]{64}$/, score: 60 }
  ],
  zhipu: [{ re: /^[a-f0-9]{32}\.[A-Za-z0-9]{8,}$/, score: 90 }],
  sambanova: [{ re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, score: 70 }],
  mistral: [{ re: /^[A-Za-z0-9]{32}$/, score: 30 }],
  cohere: [{ re: /^[A-Za-z0-9]{40}$/, score: 30 }]
};
function patterns(id) {
  return (KEY_RULES[id] ?? []).map((r) => r.re);
}
var ANTHROPIC_HEADERS = { "anthropic-version": "2023-06-01" };
var KNOWN_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    format: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authStyle: "x-api-key",
    keyPatterns: patterns("anthropic"),
    keyHint: "starts with sk-ant-",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.claude.com/en/api/overview",
    fallbackModels: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-4-5", "claude-3-5-haiku-latest"],
    headers: ANTHROPIC_HEADERS
  },
  {
    id: "openai",
    label: "OpenAI",
    format: "openai",
    baseUrl: "https://api.openai.com/v1",
    authStyle: "bearer",
    keyPatterns: patterns("openai"),
    keyHint: "starts with sk- or sk-proj-",
    consoleUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    fallbackModels: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    format: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authStyle: "x-goog-api-key",
    keyPatterns: patterns("gemini"),
    keyHint: "starts with AIza",
    consoleUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    fallbackModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    format: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    authStyle: "bearer",
    keyPatterns: patterns("openrouter"),
    keyHint: "starts with sk-or-",
    consoleUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    fallbackModels: [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4.5",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct"
    ],
    headers: { "X-Title": "ReverseIt" },
    note: "One key, hundreds of models from many vendors."
  },
  {
    id: "groq",
    label: "Groq",
    format: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    authStyle: "bearer",
    keyPatterns: patterns("groq"),
    keyHint: "starts with gsk_",
    consoleUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs",
    fallbackModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"]
  },
  {
    id: "mistral",
    label: "Mistral AI",
    format: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    authStyle: "bearer",
    keyPatterns: patterns("mistral"),
    keyHint: "32 letters and digits",
    consoleUrl: "https://console.mistral.ai/api-keys",
    docsUrl: "https://docs.mistral.ai",
    fallbackModels: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    format: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    authStyle: "bearer",
    keyPatterns: patterns("deepseek"),
    keyHint: "starts with sk- followed by 32 hex characters",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com",
    fallbackModels: ["deepseek-chat", "deepseek-reasoner"]
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    format: "openai",
    baseUrl: "https://api.x.ai/v1",
    authStyle: "bearer",
    keyPatterns: patterns("xai"),
    keyHint: "starts with xai-",
    consoleUrl: "https://console.x.ai",
    docsUrl: "https://docs.x.ai",
    fallbackModels: ["grok-4", "grok-3", "grok-3-mini"]
  },
  {
    id: "together",
    label: "Together AI",
    format: "openai",
    baseUrl: "https://api.together.xyz/v1",
    authStyle: "bearer",
    keyPatterns: patterns("together"),
    keyHint: "64 hex characters",
    consoleUrl: "https://api.together.ai/settings/api-keys",
    docsUrl: "https://docs.together.ai",
    fallbackModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3"]
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    format: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    authStyle: "bearer",
    keyPatterns: patterns("fireworks"),
    keyHint: "starts with fw_",
    consoleUrl: "https://fireworks.ai/account/api-keys",
    docsUrl: "https://docs.fireworks.ai",
    fallbackModels: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/deepseek-v3",
      "accounts/fireworks/models/qwen2p5-72b-instruct"
    ]
  },
  {
    id: "perplexity",
    label: "Perplexity",
    format: "openai",
    baseUrl: "https://api.perplexity.ai",
    authStyle: "bearer",
    keyPatterns: patterns("perplexity"),
    keyHint: "starts with pplx-",
    consoleUrl: "https://www.perplexity.ai/settings/api",
    docsUrl: "https://docs.perplexity.ai",
    fallbackModels: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"],
    note: "Search-grounded models. No model-list endpoint, so the key is checked with a 1-token request."
  },
  {
    id: "cerebras",
    label: "Cerebras",
    format: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    authStyle: "bearer",
    keyPatterns: patterns("cerebras"),
    keyHint: "starts with csk-",
    consoleUrl: "https://cloud.cerebras.ai",
    docsUrl: "https://inference-docs.cerebras.ai",
    fallbackModels: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-32b"]
  },
  {
    id: "sambanova",
    label: "SambaNova",
    format: "openai",
    baseUrl: "https://api.sambanova.ai/v1",
    authStyle: "bearer",
    keyPatterns: patterns("sambanova"),
    keyHint: "looks like a UUID",
    consoleUrl: "https://cloud.sambanova.ai/apis",
    docsUrl: "https://docs.sambanova.ai",
    fallbackModels: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3-0324", "Meta-Llama-3.1-8B-Instruct"]
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    format: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    authStyle: "bearer",
    keyPatterns: patterns("nvidia"),
    keyHint: "starts with nvapi-",
    consoleUrl: "https://build.nvidia.com",
    docsUrl: "https://docs.api.nvidia.com",
    fallbackModels: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct", "deepseek-ai/deepseek-r1"]
  },
  {
    id: "cohere",
    label: "Cohere",
    format: "openai",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    authStyle: "bearer",
    keyPatterns: patterns("cohere"),
    keyHint: "40 letters and digits",
    consoleUrl: "https://dashboard.cohere.com/api-keys",
    docsUrl: "https://docs.cohere.com/docs/compatibility-api",
    fallbackModels: ["command-a-03-2025", "command-r-plus", "command-r"],
    note: "Uses Cohere's OpenAI-compatible endpoint."
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    format: "openai",
    baseUrl: "https://router.huggingface.co/v1",
    authStyle: "bearer",
    keyPatterns: patterns("huggingface"),
    keyHint: "starts with hf_",
    consoleUrl: "https://huggingface.co/settings/tokens",
    docsUrl: "https://huggingface.co/docs/inference-providers",
    fallbackModels: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"]
  },
  {
    id: "github",
    label: "GitHub Models",
    format: "openai",
    baseUrl: "https://models.github.ai/inference",
    authStyle: "bearer",
    keyPatterns: patterns("github"),
    keyHint: "a GitHub token (ghp_ / github_pat_) with models access",
    consoleUrl: "https://github.com/settings/personal-access-tokens",
    docsUrl: "https://docs.github.com/en/github-models",
    fallbackModels: ["openai/gpt-4.1", "openai/gpt-4o-mini", "meta/Llama-3.3-70B-Instruct"]
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    format: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    authStyle: "bearer",
    keyPatterns: patterns("moonshot"),
    keyHint: "starts with sk-",
    consoleUrl: "https://platform.moonshot.ai/console/api-keys",
    docsUrl: "https://platform.moonshot.ai/docs",
    fallbackModels: ["kimi-k2-0905-preview", "kimi-k2-turbo-preview", "moonshot-v1-32k"]
  },
  {
    id: "zhipu",
    label: "Zhipu AI (GLM)",
    format: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    authStyle: "bearer",
    keyPatterns: patterns("zhipu"),
    keyHint: "two parts separated by a dot",
    consoleUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    docsUrl: "https://docs.bigmodel.cn",
    fallbackModels: ["glm-4.6", "glm-4.5", "glm-4-flash"],
    note: "No model-list endpoint, so the key is checked with a 1-token request."
  },
  {
    id: "dashscope",
    label: "Alibaba Qwen (DashScope)",
    format: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    authStyle: "bearer",
    keyPatterns: patterns("dashscope"),
    keyHint: "starts with sk-",
    consoleUrl: "https://bailian.console.alibabacloud.com",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio",
    fallbackModels: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-coder-plus"]
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    format: "openai",
    baseUrl: "https://api.siliconflow.com/v1",
    authStyle: "bearer",
    keyPatterns: patterns("siliconflow"),
    keyHint: "starts with sk- followed by lowercase letters",
    consoleUrl: "https://cloud.siliconflow.com/account/ak",
    docsUrl: "https://docs.siliconflow.com",
    fallbackModels: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "THUDM/glm-4-9b-chat"]
  },
  {
    id: "ollama",
    label: "Ollama (on your computer)",
    format: "openai",
    baseUrl: "http://localhost:11434/v1",
    authStyle: "none",
    consoleUrl: "https://ollama.com/download",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
    fallbackModels: ["llama3.2", "qwen2.5-coder", "mistral"],
    local: true,
    note: "Free and private. Only works from the local version (Version 2) because it must reach your computer."
  },
  {
    id: "lmstudio",
    label: "LM Studio (on your computer)",
    format: "openai",
    baseUrl: "http://localhost:1234/v1",
    authStyle: "none",
    consoleUrl: "https://lmstudio.ai",
    docsUrl: "https://lmstudio.ai/docs/app/api",
    fallbackModels: ["local-model"],
    local: true,
    note: "Free and private. Only works from the local version (Version 2)."
  },
  {
    id: "custom-openai",
    label: "Custom (OpenAI-compatible URL)",
    format: "openai",
    baseUrl: "",
    authStyle: "bearer",
    keyHint: "any key your server accepts as a Bearer token",
    consoleUrl: "",
    fallbackModels: [],
    note: "Works with vLLM, LiteLLM, Azure-compatible gateways, self-hosted servers and any vendor that copies the OpenAI API."
  },
  {
    id: "custom-anthropic",
    label: "Custom (Anthropic-compatible URL)",
    format: "anthropic",
    baseUrl: "",
    authStyle: "x-api-key",
    consoleUrl: "",
    fallbackModels: [],
    headers: ANTHROPIC_HEADERS,
    note: "For gateways and proxies that speak the Anthropic Messages API."
  },
  {
    id: "custom-gemini",
    label: "Custom (Gemini-compatible URL)",
    format: "gemini",
    baseUrl: "",
    authStyle: "x-goog-api-key",
    consoleUrl: "",
    fallbackModels: [],
    note: "For gateways and proxies that speak the Gemini generateContent API."
  }
];
var NO_MODELS_ENDPOINT = /* @__PURE__ */ new Set(["perplexity", "zhipu"]);
var MODELS_URL_OVERRIDE = {
  github: "https://models.github.ai/catalog/models"
};
function findProvider(id) {
  return KNOWN_PROVIDERS.find((p) => p.id === id);
}
function isCustomProvider(id) {
  return id.startsWith("custom-");
}
function cloudProviders() {
  return KNOWN_PROVIDERS.filter((p) => !p.local && !isCustomProvider(p.id));
}
function scoreProviders(apiKey) {
  const key = apiKey.trim();
  if (!key) return [];
  const out = [];
  for (const p of KNOWN_PROVIDERS) {
    const rules = KEY_RULES[p.id];
    if (!rules) continue;
    let best = -1;
    for (const r of rules) if (r.re.test(key)) best = Math.max(best, r.score);
    if (best >= 0) out.push({ provider: p, score: best });
  }
  return out.map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score || a.i - b.i).map((e) => e.x);
}
function guessProviders(apiKey) {
  const key = apiKey.trim();
  if (!key) return [];
  const scored = scoreProviders(key);
  if (scored.length) return scored.map((s) => s.provider);
  return cloudProviders().filter((p) => p.format === "openai");
}
function normalizeBaseUrl(input) {
  let s = (input ?? "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(s);
    s = (isLocal ? "http://" : "https://") + s;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(?:chat\/completions|completions|models|messages|responses)$/i, "");
  path = path.replace(/\/models\/[^/]+:(?:stream)?generateContent$/i, "");
  path = path.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}`;
}
function makeProviderConfig(input) {
  const known = typeof input.known === "string" ? findProvider(input.known) : input.known;
  const providerId = input.providerId ?? known?.id ?? "custom-openai";
  const format = input.format ?? known?.format ?? "openai";
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? known?.baseUrl ?? "");
  const authStyle = input.authStyle ?? known?.authStyle ?? "bearer";
  const model = input.model ?? known?.fallbackModels[0] ?? "";
  const headers = { ...known?.headers ?? {}, ...input.headers ?? {} };
  return {
    id: input.id ?? `${providerId}-${Date.now()}`,
    providerId,
    label: input.label ?? known?.label ?? providerId,
    format,
    baseUrl,
    authStyle,
    apiKey: (input.apiKey ?? "").trim(),
    model,
    ...Object.keys(headers).length ? { headers } : {},
    ...input.keyInQuery ? { keyInQuery: true } : {}
  };
}
function redactKey(text, key) {
  let out = text ?? "";
  const k = (key ?? "").trim();
  if (k.length >= 6) {
    out = out.split(k).join("[redacted-key]");
    const enc = encodeURIComponent(k);
    if (enc !== k) out = out.split(enc).join("[redacted-key]");
    if (k.length >= 12) out = out.split(k.slice(0, 10)).join("[redacted-key]");
  }
  out = out.replace(/([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi, "$1[redacted-key]");
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1[redacted-key]");
  return out;
}

// shared/ai/adapters.ts
var AiFailure = class extends Error {
  constructor(err) {
    super(err.message);
    this.err = err;
    this.name = "AiFailure";
  }
  err;
};
function buildHeaders(p, json = true) {
  const h = { ...p.headers ?? {} };
  if (json) h["content-type"] = "application/json";
  const key = p.apiKey.trim();
  if (key && !p.keyInQuery) {
    if (p.authStyle === "bearer") h.authorization = `Bearer ${key}`;
    else if (p.authStyle === "x-api-key") h["x-api-key"] = key;
    else if (p.authStyle === "x-goog-api-key") h["x-goog-api-key"] = key;
  }
  if (p.format === "anthropic" && !h["anthropic-version"]) h["anthropic-version"] = "2023-06-01";
  return h;
}
function withKeyQuery(url, p) {
  if (!p.keyInQuery || !p.apiKey) return url;
  return url + (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(p.apiKey);
}
function mapHttpError(status, body, key) {
  let msg = "";
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail ?? "";
    if (typeof msg !== "string") msg = JSON.stringify(msg);
  } catch {
    msg = body;
  }
  msg = redactKey(String(msg).replace(/\s+/g, " ").trim().slice(0, 300), key);
  if (status === 401) return { code: "unauthorized", status, message: "The provider rejected this API key. Check it was copied completely." + (msg ? ` (${msg})` : "") };
  if (status === 403) return { code: "forbidden", status, message: "The key is valid but not allowed to do this (region, plan or permissions)." + (msg ? ` (${msg})` : "") };
  if (status === 404) return { code: "model_not_found", status, message: "The provider could not find that model or address. Pick another model or check the base URL." + (msg ? ` (${msg})` : "") };
  if (status === 429) return { code: "rate_limited", status, message: "The provider says you are out of quota or sending too fast. " + (msg || "Wait a bit or check your plan.") };
  if (status === 400 || status === 422) return { code: "bad_request", status, message: msg || "The provider rejected the request." };
  return { code: "upstream_error", status, message: msg || `The provider returned HTTP ${status}.` };
}
async function readText(res, max = 2e4) {
  try {
    return (await res.text()).slice(0, max);
  } catch {
    return "";
  }
}
function modelsUrl(p) {
  if (MODELS_URL_OVERRIDE[p.providerId]) return MODELS_URL_OVERRIDE[p.providerId];
  return p.format === "gemini" ? `${p.baseUrl}/models?pageSize=200` : `${p.baseUrl}/models`;
}
async function listModels(p, f, signal) {
  const known = findProvider(p.providerId);
  if (NO_MODELS_ENDPOINT.has(p.providerId)) return (known?.fallbackModels ?? []).map((id) => ({ id }));
  const res = await f(withKeyQuery(modelsUrl(p), p), { method: "GET", headers: buildHeaders(p, false), signal });
  if (!res.ok) throw new AiFailure(mapHttpError(res.status, await readText(res), p.apiKey));
  let j;
  try {
    j = JSON.parse(await readText(res, 4e6));
  } catch {
    throw new AiFailure({ code: "unsupported", message: "That address answered, but not like an AI provider (no model list)." });
  }
  let out = [];
  if (Array.isArray(j?.data)) out = j.data.map((m) => ({ id: String(m.id ?? m.name), label: m.display_name ?? m.name }));
  else if (Array.isArray(j?.models)) {
    out = j.models.filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map((m) => ({ id: String(m.name ?? m.id ?? m.model).replace(/^models\//, ""), label: m.displayName }));
  } else if (Array.isArray(j)) out = j.map((m) => ({ id: String(m.id ?? m.name), label: m.name }));
  else throw new AiFailure({ code: "unsupported", message: "That address answered, but not like an AI provider (no model list)." });
  out = out.filter((m) => m.id && m.id !== "undefined");
  const notChat = /embed|whisper|tts|dall-e|moderation|rerank|transcribe|image|audio|realtime|guard/i;
  const chatty = out.filter((m) => !notChat.test(m.id));
  return (chatty.length ? chatty : out).sort((a, b) => a.id.localeCompare(b.id));
}
function splitSystem(msgs) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = msgs.filter((m) => m.role !== "system");
  return { system, rest };
}
function buildChatRequest(req) {
  const p = req.provider;
  const maxTokens = req.maxTokens ?? 4096;
  if (p.format === "anthropic") {
    const { system, rest } = splitSystem(req.messages);
    return {
      url: `${p.baseUrl}/messages`,
      body: { model: p.model, max_tokens: maxTokens, stream: true, ...system ? { system } : {}, ...req.temperature != null ? { temperature: req.temperature } : {}, messages: rest.map((m) => ({ role: m.role, content: m.content })) }
    };
  }
  if (p.format === "gemini") {
    const { system, rest } = splitSystem(req.messages);
    return {
      url: `${p.baseUrl}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`,
      body: {
        ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
        contents: rest.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, ...req.temperature != null ? { temperature: req.temperature } : {} }
      }
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
      ...isOpenAI ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens },
      ...req.temperature != null && !(isOpenAI && reasoning) ? { temperature: req.temperature } : {}
    }
  };
}
async function* sse(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + (buf[i] === "\r" ? 2 : 1));
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith("data:")) yield buf.slice(5).trim();
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
async function* chatStream(req, f, signal) {
  const p = req.provider;
  try {
    const { url, body } = buildChatRequest(req);
    const res = await f(withKeyQuery(url, p), { method: "POST", headers: { ...buildHeaders(p), accept: "text/event-stream" }, body: JSON.stringify(body), signal });
    if (!res.ok) {
      yield { error: mapHttpError(res.status, await readText(res), p.apiKey) };
      return;
    }
    if (!res.body) {
      yield { error: { code: "upstream_error", message: "The provider sent an empty reply." } };
      return;
    }
    let usage;
    let any = false;
    for await (const data of sse(res.body)) {
      if (!data || data === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j?.error) {
        yield { error: { code: "upstream_error", message: redactKey(String(j.error.message ?? JSON.stringify(j.error)).slice(0, 300), p.apiKey) } };
        return;
      }
      let delta = "";
      if (p.format === "anthropic") {
        if (j.type === "content_block_delta" && typeof j.delta?.text === "string") delta = j.delta.text;
        if (j.type === "message_start" && j.message?.usage) usage = { ...usage, inputTokens: j.message.usage.input_tokens };
        if (j.type === "message_delta" && j.usage) usage = { ...usage, outputTokens: j.usage.output_tokens };
      } else if (p.format === "gemini") {
        delta = (j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("");
        if (j.usageMetadata) usage = { inputTokens: j.usageMetadata.promptTokenCount, outputTokens: j.usageMetadata.candidatesTokenCount };
      } else {
        delta = j.choices?.[0]?.delta?.content ?? "";
        if (typeof delta !== "string") delta = "";
        if (j.usage) usage = { inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens };
      }
      if (delta) {
        any = true;
        yield { delta };
      }
    }
    if (!any) {
      yield { error: { code: "upstream_error", message: "The model replied with no text. It may not support chat, or it refused. Try another model." } };
      return;
    }
    yield { done: true, ...usage ? { usage } : {} };
  } catch (e) {
    if (e instanceof AiFailure) {
      yield { error: e.err };
      return;
    }
    if (e?.name === "AbortError") {
      yield { error: { code: "timeout", message: "Cancelled or timed out." } };
      return;
    }
    yield { error: { code: "network", message: redactKey(String(e?.message ?? e).slice(0, 240), p.apiKey) } };
  }
}
async function testProvider(p, f, signal) {
  let models = [];
  try {
    models = await listModels(p, f, signal);
  } catch (e) {
    if (e instanceof AiFailure && (e.err.code === "unauthorized" || e.err.code === "blocked_url")) return { ok: false, models, error: e.err };
  }
  let reply = "";
  for await (const ev of chatStream({ provider: p, messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 16 }, f, signal)) {
    if ("delta" in ev) reply += ev.delta;
    else if ("error" in ev) return { ok: false, models, error: ev.error };
  }
  return { ok: true, models, reply: reply.trim().slice(0, 60) };
}

// shared/ai/detect.ts
async function probe(cfg, f, signal) {
  try {
    const models = await listModels(cfg, f, signal);
    return { ok: true, models };
  } catch (e) {
    if (e instanceof AiFailure) return { ok: false, models: [], error: e.err.code === "unauthorized" ? "key rejected" : e.err.message.slice(0, 120) };
    return { ok: false, models: [], error: "could not connect" };
  }
}
async function detectProviders(apiKey, f, o = {}) {
  const key = apiKey.trim();
  const base = o.baseUrl ? normalizeBaseUrl(o.baseUrl) : "";
  if (o.baseUrl && !base) return { ok: false, candidates: [], message: "That does not look like a valid web address." };
  const targets = [];
  if (base) {
    const formats = o.format ? [o.format] : ["openai", "anthropic", "gemini"];
    for (const format of formats) {
      const id = `custom-${format}`;
      targets.push({ cfg: makeProviderConfig({ known: findProvider(id), providerId: id, label: `Custom (${format}-style)`, baseUrl: base, apiKey: key, format, authStyle: format === "anthropic" ? "x-api-key" : format === "gemini" ? "x-goog-api-key" : key ? "bearer" : "none", model: "" }), pattern: false });
    }
  } else {
    if (!key) return { ok: false, candidates: [], message: "Paste an API key first." };
    const scored = scoreProviders(key);
    const picks = scored.length ? guessProviders(key) : [];
    const list2 = o.probeAll ? [...new Map([...picks, ...cloudProviders()].map((p) => [p.id, p])).values()] : picks;
    for (const p of list2.slice(0, o.maxProbes ?? (o.probeAll ? 30 : 5))) targets.push({ cfg: makeProviderConfig({ known: p, apiKey: key }), pattern: scored.some((s) => s.provider.id === p.id) });
  }
  if (!targets.length) {
    return { ok: false, candidates: [], message: "ReverseIt does not recognise this key format. Choose the provider from the list, enter its base URL, or let ReverseIt try every known provider (your key will be sent to each)." };
  }
  const results = await Promise.all(targets.map(async (t) => ({ t, r: await probe(t.cfg, f, o.signal) })));
  const candidates = results.map(({ t, r }) => ({
    providerId: t.cfg.providerId,
    label: t.cfg.label,
    format: t.cfg.format,
    baseUrl: t.cfg.baseUrl,
    authStyle: t.cfg.authStyle,
    patternMatch: t.pattern,
    verified: r.ok,
    models: r.models,
    ...r.error ? { error: r.error } : {}
  }));
  candidates.sort((a, b) => Number(b.verified) - Number(a.verified) || Number(b.patternMatch) - Number(a.patternMatch));
  const best = candidates.find((c) => c.verified);
  return { ok: !!best, candidates, best: best?.providerId, message: best ? void 0 : "No provider accepted this key. Check the key, or pick the provider manually." };
}

// shared/server/http.ts
var HttpError = class extends Error {
  constructor(status, err) {
    super(err.message);
    this.status = status;
    this.err = err;
  }
  status;
  err;
};
async function readJson(req, maxBytes = 2 * 1024 * 1024) {
  const pre = req.body;
  if (pre !== void 0 && pre !== null) {
    if (typeof pre === "object" && !Buffer.isBuffer(pre)) return pre;
    try {
      return JSON.parse(Buffer.isBuffer(pre) ? pre.toString("utf8") : String(pre));
    } catch {
      throw new HttpError(400, { code: "bad_request", message: "Request body is not valid JSON." });
    }
  }
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > maxBytes) throw new HttpError(413, { code: "bad_request", message: "Request is too large." });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, { code: "bad_request", message: "Request body is not valid JSON." });
  }
}
var SEC = { "x-content-type-options": "nosniff", "cache-control": "no-store", "referrer-policy": "no-referrer" };
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...SEC });
  res.end(JSON.stringify(body));
}
function sendError(res, e) {
  if (res.headersSent) {
    try {
      res.end();
    } catch {
    }
    return;
  }
  if (e instanceof HttpError) return sendJson(res, e.status, { error: e.err });
  sendJson(res, 500, { error: { code: "internal", message: "Something went wrong on the server." } });
}
function startStream(res, kind) {
  res.writeHead(200, { "content-type": kind === "sse" ? "text/event-stream; charset=utf-8" : "application/x-ndjson; charset=utf-8", connection: "keep-alive", "x-accel-buffering": "no", ...SEC });
  res.flushHeaders?.();
}
var writeSse = (res, ev) => res.write(`data: ${JSON.stringify(ev)}

`);
var writeLine = (res, ev) => res.write(JSON.stringify(ev) + "\n");
function makeLimiter(perMinute) {
  const hits = /* @__PURE__ */ new Map();
  return (ip) => {
    if (!perMinute) return true;
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < 6e4);
    if (arr.length >= perMinute) {
      hits.set(ip, arr);
      return false;
    }
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5e3) {
      for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 6e4) hits.delete(k);
    }
    return true;
  };
}
function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return xf || req.socket?.remoteAddress || "unknown";
}

// shared/server/aiRoutes.ts
var FORMATS = ["openai", "anthropic", "gemini"];
var AUTHS = ["bearer", "x-api-key", "x-goog-api-key", "none"];
function parseProvider(raw) {
  const bad = (m) => new HttpError(400, { code: "bad_request", message: m });
  if (!raw || typeof raw !== "object") throw bad("Missing provider settings.");
  if (!FORMATS.includes(raw.format)) throw bad("Unknown provider format.");
  const authStyle = AUTHS.includes(raw.authStyle) ? raw.authStyle : "bearer";
  const baseUrl = normalizeBaseUrl(String(raw.baseUrl ?? ""));
  if (!baseUrl) throw bad("The provider address is not a valid web address.");
  const headers = {};
  if (raw.headers && typeof raw.headers === "object") {
    for (const [k, v] of Object.entries(raw.headers)) if (typeof v === "string" && /^[\w-]{1,64}$/.test(k) && v.length < 300 && !/^(host|content-length|authorization|x-api-key|x-goog-api-key)$/i.test(k)) headers[k] = v;
  }
  return { id: String(raw.id ?? "p").slice(0, 80), providerId: String(raw.providerId ?? "custom").slice(0, 60), label: String(raw.label ?? "").slice(0, 80), format: raw.format, baseUrl, authStyle, apiKey: String(raw.apiKey ?? "").trim().slice(0, 600), model: String(raw.model ?? "").slice(0, 200), ...Object.keys(headers).length ? { headers } : {}, ...raw.keyInQuery ? { keyInQuery: true } : {} };
}
function parseMessages(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 60) throw new HttpError(400, { code: "bad_request", message: "Messages are missing or too many." });
  let total = 0;
  return raw.map((m) => {
    if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string") throw new HttpError(400, { code: "bad_request", message: "A message is malformed." });
    total += m.content.length;
    if (total > 15e5) throw new HttpError(413, { code: "bad_request", message: "The conversation is too large for one request." });
    return { role: m.role, content: m.content };
  });
}
function makeAiRoutes(f) {
  return {
    async detect(req, res) {
      const b = await readJson(req, 64 * 1024);
      const out = await detectProviders(String(b.apiKey ?? ""), f, { baseUrl: b.baseUrl ? String(b.baseUrl) : void 0, format: FORMATS.includes(b.format) ? b.format : void 0, probeAll: b.probeAll === true });
      sendJson(res, 200, out);
    },
    async models(req, res) {
      const p = parseProvider((await readJson(req, 64 * 1024)).provider);
      try {
        sendJson(res, 200, { models: await listModels(p, f) });
      } catch (e) {
        if (e instanceof AiFailure) return sendJson(res, 200, { models: [], error: e.err });
        const c = e?.code === "blocked_url" ? "blocked_url" : "network";
        sendJson(res, 200, { models: [], error: { code: c, message: c === "blocked_url" ? String(e.message) : "Could not reach that provider." } });
      }
    },
    async test(req, res) {
      const p = parseProvider((await readJson(req, 64 * 1024)).provider);
      try {
        sendJson(res, 200, await testProvider(p, f));
      } catch (e) {
        sendJson(res, 200, { ok: false, models: [], error: { code: e?.code === "blocked_url" ? "blocked_url" : "network", message: e?.code === "blocked_url" ? e.message : "Could not reach that provider." } });
      }
    },
    async chat(req, res) {
      const b = await readJson(req);
      const provider = parseProvider(b.provider);
      if (!provider.model) throw new HttpError(400, { code: "bad_request", message: "Choose a model first." });
      const messages = parseMessages(b.messages);
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      startStream(res, "sse");
      const max = Math.min(Math.max(Number(b.maxTokens) || 4096, 16), 32e3);
      for await (const ev of chatStream({ provider, messages, maxTokens: max, temperature: typeof b.temperature === "number" ? b.temperature : void 0 }, f, ac.signal)) {
        if (res.destroyed) break;
        writeSse(res, ev);
      }
      res.end();
    }
  };
}

// shared/core/hash.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
  return s;
}
function sha256Bytes(data) {
  const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const w = new Uint32Array(64);
  const len = data.length;
  const fullBlocks = Math.floor(len / 64);
  const process = (block, off) => {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = block[j] << 24 | block[j + 1] << 16 | block[j + 2] << 8 | block[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a2 = w[i - 15];
      const b2 = w[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K[i] + w[i] | 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj | 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    h[0] = h[0] + a | 0;
    h[1] = h[1] + b | 0;
    h[2] = h[2] + c | 0;
    h[3] = h[3] + d | 0;
    h[4] = h[4] + e | 0;
    h[5] = h[5] + f | 0;
    h[6] = h[6] + g | 0;
    h[7] = h[7] + hh | 0;
  };
  for (let i = 0; i < fullBlocks; i++) process(data, i * 64);
  const rem = len - fullBlocks * 64;
  const tail = new Uint8Array(rem + 9 <= 64 ? 64 : 128);
  tail.set(data.subarray(fullBlocks * 64));
  tail[rem] = 128;
  const bitsHi = Math.floor(len * 8 / 4294967296);
  const bitsLo = len * 8 >>> 0;
  const tv = new DataView(tail.buffer);
  tv.setUint32(tail.length - 8, bitsHi);
  tv.setUint32(tail.length - 4, bitsLo);
  process(tail, 0);
  if (tail.length === 128) process(tail, 64);
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}
function sha256HexSync(data) {
  return toHex(sha256Bytes(data));
}
async function sha256Hex(data) {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle && data.length > 0) {
      const copy = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
      const digest = await subtle.digest("SHA-256", copy);
      return toHex(new Uint8Array(digest));
    }
  } catch {
  }
  return sha256HexSync(data);
}
function sha256HexOfString(s) {
  return sha256HexSync(new TextEncoder().encode(s));
}

// shared/core/evidence.ts
function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (x !== void 0) o[k] = sortValue(x);
    }
    return o;
  }
  if (typeof v === "bigint") return v.toString();
  return v;
}
var CORE_ANALYZER = "reverseit-core@1";
function makeEvidence(init) {
  const coverage = init.coverage ?? { status: "complete" };
  const limitations = init.limitations ?? [];
  if (coverage.status !== "complete" && limitations.length === 0) {
    limitations.push("Coverage is not complete; absence of an item in this record does not prove it is absent from the target.");
  }
  const id = "ev_" + sha256HexOfString(stableStringify({ operation: init.operation, target: init.target, normalized_result: init.normalized_result }));
  return {
    evidence_id: id,
    operation: init.operation,
    title: init.title,
    analyzer: init.analyzer ?? CORE_ANALYZER,
    provenance: init.provenance ?? "reverseit-core",
    created_at: init.created_at ?? (/* @__PURE__ */ new Date()).toISOString(),
    target: init.target,
    summary: init.summary,
    normalized_result: init.normalized_result,
    sections: init.sections ?? [],
    findings: init.findings ?? [],
    ...init.graph ? { graph: init.graph } : {},
    coverage,
    limitations,
    untrusted_content: true
  };
}

// shared/core/options.ts
var DEFAULT_MAX_STRINGS = 400;
var DEFAULT_MAX_ROWS = 200;
var DEFAULT_MAX_RECOVERED_BYTES = 24 * 1024 * 1024;
function resolveOptions(o) {
  return {
    onProgress: o?.onProgress ?? (() => {
    }),
    signal: o?.signal,
    maxStrings: o?.maxStrings ?? DEFAULT_MAX_STRINGS,
    maxRows: o?.maxRows ?? DEFAULT_MAX_ROWS,
    maxRecoveredBytes: o?.maxRecoveredBytes ?? DEFAULT_MAX_RECOVERED_BYTES
  };
}
var AbortedError = class extends Error {
  constructor() {
    super("Analysis cancelled");
    this.name = "AbortedError";
  }
};
function throwIfAborted(signal) {
  if (signal?.aborted) throw new AbortedError();
}
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// shared/core/sections.ts
function kv(title, rows, hints) {
  return {
    kind: "kv",
    title,
    rows: Object.entries(rows).filter(([, v]) => v !== void 0).map(([k, v]) => ({ k, v, ...hints?.[k] ? { hint: hints[k] } : {} }))
  };
}
function table(title, columns, rows, max = 200) {
  const truncated = rows.length > max;
  return { kind: "table", title, columns, rows: truncated ? rows.slice(0, max) : rows, total: rows.length, truncated };
}
function list(title, items, max = 300) {
  const truncated = items.length > max;
  return { kind: "list", title, items: truncated ? items.slice(0, max) : items, total: items.length, truncated };
}
function tags(title, t) {
  return { kind: "tags", title, tags: t.map((x) => typeof x === "string" ? { label: x } : x) };
}
function bars(title, items, max = 20) {
  return { kind: "bars", title, items: items.slice(0, max) };
}
var findingCounter = 0;
function finding(title, severity = "info", detail, tagList) {
  findingCounter += 1;
  return { id: `f${findingCounter}`, title, severity, ...detail ? { detail } : {}, ...tagList?.length ? { tags: tagList } : {} };
}
function fmtBytes(n) {
  if (!Number.isFinite(n)) return String(n);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

// shared/core/bytes.ts
var latin1 = new TextDecoder("latin1");
var utf8 = new TextDecoder("utf-8", { fatal: false });
function decodeUtf8(b) {
  return utf8.decode(b);
}

// shared/core/webutil.ts
function safeUrl(u, base) {
  try {
    return base ? new URL(u, base) : new URL(u);
  } catch {
    return null;
  }
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
function uniqueLimited(items, max) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}
function templateToPath(raw) {
  return raw.replace(/\$\{\s*([^}]{0,80})\}/g, (_m, inner) => {
    const id = /([A-Za-z_$][\w$]*)\s*(?:\)|\]|\?\.?\w*)?\s*$/.exec(inner.trim());
    return `{${id ? id[1] : "expr"}}`;
  });
}
var HOST_CATEGORIES = [
  [/(^|\.)(google-analytics|googletagmanager|analytics\.google|segment\.(io|com)|cdn\.segment|mixpanel|amplitude|posthog|plausible|matomo|heap(analytics)?|hotjar|clarity\.ms|fullstory|mouseflow|statcounter|umami|fathom|simpleanalytics)\./i, "analytics"],
  [/(^|\.)(sentry\.io|ingest\.sentry|datadoghq|datadog|logrocket|bugsnag|rollbar|newrelic|nr-data|honeybadger|raygun|trackjs|elastic-apm)\./i, "monitoring"],
  [/(^|\.)(doubleclick|googlesyndication|googleadservices|adservice\.google|adnxs|criteo|taboola|outbrain|facebook\.net|connect\.facebook|ads-twitter|snap\.licdn|linkedin\.com\/px|tiktok\.com|pinterest\.com\/ct|amazon-adsystem)/i, "ads"],
  [/(^|\.)(stripe\.com|js\.stripe|paypal|paypalobjects|braintree|razorpay|checkout\.com|adyen|squareup|klarna|paddle|lemonsqueezy)\./i, "payments"],
  [/(^|\.)(auth0\.com|clerk\.(com|dev|accounts)|okta|firebaseapp|identitytoolkit|cognito|accounts\.google|login\.microsoftonline|supabase\.(co|com|io)|workos)\./i, "auth"],
  [/(^|\.)(cloudflare|cloudfront|fastly|akamai|jsdelivr|unpkg|cdnjs|bootstrapcdn|azureedge|bunnycdn|b-cdn|stackpath|vercel\.app|netlify\.app|imgix|cloudinary|imagekit)/i, "cdn"],
  [/(^|\.)(fonts\.googleapis|fonts\.gstatic|use\.typekit|use\.fontawesome|fontawesome|fonts\.bunny)/i, "fonts"],
  [/(^|\.)(maps\.googleapis|maps\.google|mapbox|tile\.openstreetmap|here\.com|arcgis)/i, "maps"],
  [/(^|\.)(intercom|drift|crisp\.chat|zendesk|freshchat|tawk\.to|hubspot|helpscout|livechat)/i, "chat"],
  [/(^|\.)(youtube|youtu\.be|vimeo|twitter|x\.com|facebook|instagram|linkedin|tiktok|reddit)\./i, "social"],
  [/(^|\.)(openai\.com|anthropic\.com|generativelanguage\.googleapis|api\.mistral|groq\.com|openrouter\.ai|huggingface\.co|replicate\.com)/i, "ai"],
  [/(^|\.)(firebaseio|firestore\.googleapis|supabase|amazonaws\.com|appspot\.com|herokuapp|railway\.app|fly\.dev|render\.com)/i, "backend"]
];
function hostCategory(host) {
  const h = host.toLowerCase() + ".";
  for (const [re, cat] of HOST_CATEGORIES) if (re.test(h) || re.test(host.toLowerCase())) return cat;
  return void 0;
}
var TWO_PART_TLDS = /* @__PURE__ */ new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.in", "co.jp", "com.br", "co.nz", "co.za", "com.cn", "com.mx", "com.tr"]);
function registrableDomain(host) {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return h;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(last2)) return parts.slice(-3).join(".");
  return last2;
}
function isFirstParty(host, siteHost) {
  return registrableDomain(host) === registrableDomain(siteHost);
}
function parseJsonLoose(text) {
  const t = text.replace(/^﻿/, "");
  try {
    return JSON.parse(t);
  } catch {
  }
  try {
    let out = "";
    let i = 0;
    let inStr = false;
    let q = "";
    while (i < t.length) {
      const c = t[i];
      if (inStr) {
        out += c;
        if (c === "\\") {
          out += t[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === q) inStr = false;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        q = c;
        out += c;
        i++;
        continue;
      }
      if (c === "/" && t[i + 1] === "/") {
        while (i < t.length && t[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && t[i + 1] === "*") {
        i += 2;
        while (i < t.length && !(t[i] === "*" && t[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return void 0;
  }
}

// shared/core/html.ts
function parseAttrs(s) {
  const out = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  let n = 0;
  while ((m = re.exec(s)) && n++ < 60) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
var strip = (s) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function parseHtml(html, baseUrl) {
  const src = html.length > 8e6 ? html.slice(0, 8e6) : html;
  const inv = { title: "", lang: null, meta: {}, links: [], scripts: [], styleSheets: [], inlineStyleBytes: 0, images: { total: 0, missingAlt: 0, srcs: [] }, iframes: [], media: [], forms: [], headings: [], anchors: { total: 0, internal: 0, external: 0, sample: [] }, inlineHandlers: 0, jsonLd: [], base: null, frameworks: [], landmarks: [], noscript: false, bytes: html.length, inlineScripts: [] };
  const resolve = (u) => {
    if (!u) return "";
    const r = safeUrl(u, inv.base ?? baseUrl);
    return r ? r.href : u;
  };
  const baseHost = baseUrl ? safeUrl(baseUrl)?.host : void 0;
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  let formIdx = -1;
  const landmarks = /* @__PURE__ */ new Set();
  let guard = 0;
  while ((m = tagRe.exec(src)) && guard++ < 4e5) {
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (closing) {
      if (tag === "form") formIdx = -1;
      continue;
    }
    const a = parseAttrs(m[3]);
    for (const k in a) if (k.length > 2 && k.startsWith("on")) inv.inlineHandlers++;
    if (tag === "script" || tag === "style") {
      const end = src.toLowerCase().indexOf("</" + tag, tagRe.lastIndex);
      const body = end === -1 ? src.slice(tagRe.lastIndex) : src.slice(tagRe.lastIndex, end);
      if (tag === "script") {
        const type = (a.type ?? "").toLowerCase();
        if (type === "application/ld+json") inv.jsonLd.push(truncate(body.trim(), 4e3));
        else {
          inv.scripts.push({ src: a.src ? resolve(a.src) : null, type: type || "classic", async: "async" in a, defer: "defer" in a, inlineBytes: a.src ? 0 : body.length });
          if (!a.src && body.length > 40 && inv.inlineScripts.length < 20) inv.inlineScripts.push(body.length > 4e5 ? body.slice(0, 4e5) : body);
        }
      } else inv.inlineStyleBytes += body.length;
      tagRe.lastIndex = end === -1 ? src.length : end;
      continue;
    }
    switch (tag) {
      case "html":
        inv.lang = a.lang ?? null;
        break;
      case "base":
        if (a.href) inv.base = resolve(a.href);
        break;
      case "meta": {
        const key = (a.name ?? a.property ?? a["http-equiv"] ?? "").toLowerCase();
        if (key && a.content !== void 0 && Object.keys(inv.meta).length < 80) inv.meta[key] = truncate(a.content, 240);
        if (a.charset) inv.meta.charset = a.charset;
        break;
      }
      case "link": {
        const rel = (a.rel ?? "").toLowerCase();
        if (rel.includes("stylesheet") && a.href) inv.styleSheets.push(resolve(a.href));
        if (inv.links.length < 120 && a.href) inv.links.push({ rel, href: resolve(a.href), ...a.as ? { as: a.as } : {} });
        break;
      }
      case "img":
        inv.images.total++;
        if (a.alt === void 0) inv.images.missingAlt++;
        if (inv.images.srcs.length < 60 && (a.src || a["data-src"])) inv.images.srcs.push(resolve(a.src ?? a["data-src"]));
        break;
      case "iframe":
        if (a.src && inv.iframes.length < 30) inv.iframes.push(resolve(a.src));
        break;
      case "video":
      case "audio":
      case "source":
        if (a.src && inv.media.length < 30) inv.media.push(resolve(a.src));
        break;
      case "form":
        inv.forms.push({ action: resolve(a.action) || "(same page)", method: (a.method ?? "get").toLowerCase(), inputs: [] });
        formIdx = inv.forms.length - 1;
        break;
      case "input":
      case "select":
      case "textarea":
        if (formIdx >= 0 && inv.forms[formIdx].inputs.length < 40) inv.forms[formIdx].inputs.push({ name: a.name ?? a.id ?? "(unnamed)", type: tag === "input" ? a.type ?? "text" : tag });
        break;
      case "a":
        inv.anchors.total++;
        if (a.href && !/^(#|javascript:|mailto:|tel:)/i.test(a.href)) {
          const u = safeUrl(a.href, inv.base ?? baseUrl);
          if (u && baseHost && u.host !== baseHost) inv.anchors.external++;
          else inv.anchors.internal++;
          if (inv.anchors.sample.length < 40) inv.anchors.sample.push(u ? u.href : a.href);
        }
        break;
      case "noscript":
        inv.noscript = true;
        break;
      case "nav":
      case "main":
      case "header":
      case "footer":
      case "aside":
      case "article":
      case "section":
        landmarks.add(tag);
        break;
    }
    if (a.role) landmarks.add(`role=${a.role}`);
  }
  inv.landmarks = [...landmarks].slice(0, 20);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  inv.title = t ? truncate(strip(t[1]), 200) : "";
  const hre = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let h;
  while ((h = hre.exec(src)) && inv.headings.length < 40) {
    const text = strip(h[2]);
    if (text) inv.headings.push({ level: +h[1], text: truncate(text, 120) });
  }
  const fw = [["data-reactroot", "React"], ["__NEXT_DATA__", "Next.js"], ['id="__nuxt"', "Nuxt"], ["__NUXT__", "Nuxt"], ["ng-version", "Angular"], ["data-v-", "Vue"], ["x-data=", "Alpine.js"], ["hx-get", "htmx"], ["hx-post", "htmx"], ["data-svelte", "Svelte"], ["astro-island", "Astro"], ["data-turbo", "Hotwire Turbo"], ["wp-content", "WordPress"], ["cdn.shopify.com", "Shopify"], ["data-wf-page", "Webflow"], ["___gatsby", "Gatsby"], ['id="root"', "React-style root element"], ['id="app"', "Vue-style root element"]];
  for (const [needle, name] of fw) if (src.includes(needle) && !inv.frameworks.includes(name)) inv.frameworks.push(name);
  return inv;
}
function inventorySections(inv, rowMax = 200) {
  return [
    kv("Page", { Title: inv.title || null, Language: inv.lang, Description: inv.meta.description ?? inv.meta["og:description"] ?? null, "Social title": inv.meta["og:title"] ?? null, "Theme colour": inv.meta["theme-color"] ?? null, Generator: inv.meta.generator ?? null, Size: fmtBytes(inv.bytes), "Needs JavaScript?": inv.noscript || inv.scripts.length > 3 ? "yes (uses scripts heavily)" : "mostly not" }),
    tags("Frameworks hinted by the HTML", inv.frameworks.map((f) => ({ label: f, tone: "cyan" }))),
    list("Headings outline", inv.headings.map((h) => `${"  ".repeat(h.level - 1)}H${h.level}  ${h.text}`)),
    table("Scripts", ["Source", "Type", "Loading", "Inline size"], inv.scripts.map((s) => [s.src ?? "(inline)", s.type, s.async ? "async" : s.defer ? "defer" : "blocking", s.inlineBytes || null]), rowMax),
    list("Stylesheets", inv.styleSheets),
    table("Forms (field names only, never values)", ["Action", "Method", "Fields"], inv.forms.map((f) => [f.action, f.method, f.inputs.map((i) => `${i.name}:${i.type}`).join(", ")]), rowMax),
    list("Embedded frames", inv.iframes),
    kv("Content counts", { Images: inv.images.total, "Images without alt text": inv.images.missingAlt, Links: inv.anchors.total, "Internal links": inv.anchors.internal, "External links": inv.anchors.external, "Inline event handlers": inv.inlineHandlers, "Inline style size": fmtBytes(inv.inlineStyleBytes) }),
    list("Landmarks", inv.landmarks),
    list("Preload / connect hints", inv.links.filter((l) => /preload|prefetch|preconnect|dns-prefetch|manifest|icon|canonical|alternate/.test(l.rel)).map((l) => `${l.rel}: ${l.href}`)),
    list("Structured data (JSON-LD, first 4000 chars each)", inv.jsonLd)
  ];
}
function htmlFindings(inv) {
  const f = [];
  if (!inv.meta.viewport) f.push(finding("No viewport tag", "notice", "The page may not scale correctly on phones."));
  if (!inv.lang) f.push(finding("No language set on <html>", "notice"));
  if (inv.images.total && inv.images.missingAlt / inv.images.total > 0.3) f.push(finding(`${inv.images.missingAlt} images have no alt text`, "notice", "Screen readers cannot describe them.", ["accessibility"]));
  if (inv.inlineHandlers > 5) f.push(finding(`${inv.inlineHandlers} inline event handlers`, "notice", "Inline onclick-style attributes make a strict Content-Security-Policy impossible."));
  if (inv.forms.some((x) => /^http:/.test(x.action))) f.push(finding("A form posts over plain HTTP", "warning"));
  return f;
}

// shared/core/css.ts
function toHex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + toHex2(f(0) * 255) + toHex2(f(8) * 255) + toHex2(f(4) * 255);
}
function normalizeColor(raw) {
  const s = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return "#" + [...h].map((c) => c + c).join("").slice(0, 6);
    if (h.length === 6) return "#" + h;
    if (h.length === 8) return h.endsWith("ff") ? "#" + h.slice(0, 6) : "#" + h;
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const base = "#" + toHex2(+m[1]) + toHex2(+m[2]) + toHex2(+m[3]);
    const a = m[4] ? m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]) : 1;
    return a >= 0.999 ? base : base + toHex2(a * 255);
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s);
  if (m) return hslToHex(+m[1], +m[2], +m[3]);
  return null;
}
function bump(m, k) {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function top(m, n, key) {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, count]) => ({ [key]: v, count }));
}
function extractDesignTokens(cssIn) {
  const css = cssIn.length > 12e6 ? cssIn.slice(0, 12e6) : cssIn;
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const colors = /* @__PURE__ */ new Map();
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)/g;
  let m;
  let guard = 0;
  while ((m = re.exec(noComments)) && guard++ < 2e5) {
    const c = normalizeColor(m[0]);
    if (c) bump(colors, c);
  }
  const vars = [];
  const vre = /(--[\w-]+)\s*:\s*([^;}{]{1,160})/g;
  const seenVars = /* @__PURE__ */ new Set();
  while ((m = vre.exec(noComments)) && vars.length < 200) {
    if (seenVars.has(m[1])) continue;
    seenVars.add(m[1]);
    vars.push({ name: m[1], value: m[2].trim() });
  }
  const fonts = /* @__PURE__ */ new Map();
  const fre = /font-family\s*:\s*([^;}{]{1,200})/gi;
  while (m = fre.exec(noComments)) {
    const first = m[1].split(",")[0].replace(/["'!important]/g, "").trim();
    if (first && !first.startsWith("var(") && !/^(inherit|initial|unset)$/i.test(first)) bump(fonts, first);
  }
  const sizes = /* @__PURE__ */ new Map();
  const sre = /font-size\s*:\s*([\d.]+(?:px|rem|em|%))/gi;
  while (m = sre.exec(noComments)) bump(sizes, m[1].toLowerCase());
  const spacing = /* @__PURE__ */ new Map();
  const pre = /(?:margin|padding|gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;}{]{1,60})/gi;
  while (m = pre.exec(noComments)) for (const v of m[1].match(/-?[\d.]+(?:px|rem|em)/g) ?? []) bump(spacing, v);
  const radii = /* @__PURE__ */ new Map();
  const rre = /border-radius\s*:\s*([^;}{]{1,40})/gi;
  while (m = rre.exec(noComments)) bump(radii, m[1].trim().toLowerCase());
  const shadows = /* @__PURE__ */ new Set();
  const shre = /box-shadow\s*:\s*([^;}{]{3,200})/gi;
  while ((m = shre.exec(noComments)) && shadows.size < 12) shadows.add(m[1].trim());
  const bps = /* @__PURE__ */ new Set();
  const bre = /@media[^{]*?\(\s*(?:min|max)-width\s*:\s*([\d.]+(?:px|em|rem))/gi;
  while (m = bre.exec(noComments)) bps.add(m[1]);
  const kf = /* @__PURE__ */ new Set();
  const kre = /@keyframes\s+([\w-]+)/g;
  while (m = kre.exec(noComments)) kf.add(m[1]);
  const ff = [];
  const ffre = /@font-face\s*\{([^}]*)\}/g;
  while ((m = ffre.exec(noComments)) && ff.length < 30) {
    const fam = /font-family\s*:\s*([^;]+)/.exec(m[1])?.[1]?.replace(/["']/g, "").trim() ?? "?";
    const src = /url\(\s*["']?([^"')]+)/.exec(m[1])?.[1] ?? "";
    ff.push({ family: fam, src: truncate(src, 120) });
  }
  let z = 0;
  const zre = /z-index\s*:\s*(-?\d+)/g;
  while (m = zre.exec(noComments)) z = Math.max(z, parseInt(m[1], 10));
  const classRules = (noComments.match(/\.[\w\\:\/\[\]-]+\s*\{/g) ?? []).length;
  const utility = (noComments.match(/\.(?:[a-z]+:)?\\?(?:[mp][trblxy]?-\d|text-(?:xs|sm|lg|xl)|bg-|flex|grid|w-\d|h-\d|gap-)/g) ?? []).length;
  return {
    colors: top(colors, 24, "value"),
    variables: vars,
    fonts: top(fonts, 12, "family"),
    fontSizes: top(sizes, 12, "value"),
    spacing: top(spacing, 12, "value"),
    radii: top(radii, 8, "value"),
    shadows: [...shadows],
    breakpoints: [...bps].sort((a, b) => parseFloat(a) - parseFloat(b)),
    keyframes: [...kf].slice(0, 40),
    fontFaces: ff,
    zIndexMax: z,
    usesGrid: /display\s*:\s*(?:inline-)?grid/.test(noComments),
    usesFlex: /display\s*:\s*(?:inline-)?flex/.test(noComments),
    utilityDensity: classRules ? Math.round(utility / classRules * 100) / 100 : 0,
    bytes: cssIn.length
  };
}
function paletteRoles(colors) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  };
  const sat = (hex) => {
    const n = parseInt(hex.slice(1, 7), 16);
    const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const six = colors.filter((c) => c.value.length === 7);
  const light = six.find((c) => lum(c.value) > 0.85);
  const dark = six.find((c) => lum(c.value) < 0.2);
  const accent = six.find((c) => sat(c.value) > 0.45 && lum(c.value) > 0.15 && lum(c.value) < 0.85);
  return { background: light?.value ?? dark?.value, text: dark?.value ?? light?.value, accent: accent?.value };
}
function tokensToSections(t, rowMax = 200) {
  const roles = paletteRoles(t.colors);
  return [
    kv("Look & feel at a glance", { "Likely background": roles.background ?? null, "Likely text colour": roles.text ?? null, "Likely accent colour": roles.accent ?? null, "Largest layer (z-index)": t.zIndexMax || null, "Uses flexbox": t.usesFlex, "Uses CSS grid": t.usesGrid, "Utility-class style (Tailwind-like)": t.utilityDensity > 0.35 ? "likely" : "unlikely" }),
    { kind: "tags", title: "Colour palette (most used first)", tags: t.colors.map((c) => ({ label: `${c.value} \xD7${c.count}`, tone: "cyan" })) },
    table("Fonts", ["Family", "Uses"], t.fonts.map((f) => [f.family, f.count]), rowMax),
    table("Font sizes", ["Size", "Uses"], t.fontSizes.map((f) => [f.value, f.count]), rowMax),
    table("Spacing values", ["Value", "Uses"], t.spacing.map((f) => [f.value, f.count]), rowMax),
    table("Corner radii", ["Value", "Uses"], t.radii.map((f) => [f.value, f.count]), rowMax),
    list("Shadows", t.shadows),
    list("Responsive breakpoints", t.breakpoints),
    list("Animations", t.keyframes),
    table("Custom fonts", ["Family", "File"], t.fontFaces.map((f) => [f.family, f.src]), rowMax),
    table("CSS variables (design tokens)", ["Name", "Value"], t.variables.map((v) => [v.name, truncate(v.value, 80)]), rowMax)
  ];
}

// shared/core/secrets.ts
var RULES = [
  { kind: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "risk" },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g, severity: "notice", note: "Google browser keys are usually public by design but should be restricted by referrer." },
  { kind: "Stripe secret key", re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g, severity: "risk" },
  { kind: "Stripe publishable key", re: /\bpk_(?:live|test)_[0-9a-zA-Z]{20,}\b/g, severity: "notice", note: "Publishable keys are meant to be public." },
  { kind: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, severity: "risk" },
  { kind: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, severity: "risk" },
  { kind: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, severity: "risk" },
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g, severity: "risk" },
  { kind: "OpenAI-style API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}\b/g, severity: "risk" },
  { kind: "SendGrid key", re: /\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b/g, severity: "risk" },
  { kind: "Twilio API key", re: /\bSK[0-9a-f]{32}\b/g, severity: "risk" },
  { kind: "JSON Web Token", re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g, severity: "notice", note: "A JWT may be a sample, an anonymous key (e.g. Supabase anon) or a live session token." },
  { kind: "Private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, severity: "risk" },
  {
    kind: "Hard-coded credential assignment",
    re: /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|passwd|password)["']?\s*[:=]\s*["']([^"'\s]{8,64})["']/gi,
    severity: "risk",
    group: 1
  }
];
function maskSecret(value) {
  const head = value.slice(0, 4);
  return `${head}****(${value.length})`;
}
function scanSecrets(text, max = 60) {
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const value = rule.group ? m[rule.group] : m[0];
      if (!value) continue;
      if (isPlaceholder(value)) continue;
      const key = rule.kind + ":" + value;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        kind: rule.kind,
        preview: rule.kind === "Private key block" ? "PRIVATE KEY block" : maskSecret(value),
        index: m.index,
        severity: rule.severity,
        ...rule.note ? { note: rule.note } : {}
      });
      if (hits.length >= max) return hits;
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
  return hits;
}
function isPlaceholder(v) {
  const s = v.toLowerCase();
  if (/^(x+|\*+|0+|1+|\.+|_+|-+)$/.test(s)) return true;
  return /(your|example|changeme|placeholder|xxxx|<.*>|\{\{|process\.env|undefined|null|test1234|password)/.test(s);
}

// shared/core/techfp.ts
var R = (name, cat, ...tests) => ({ name, cat, tests });
var RULES2 = [
  // ---- frontend frameworks ----
  R("React", "Framework", ["j", 'Symbol.for("react.element")', "high"], ["j", "react.transitional.element", "high"], ["j", "__reactFiber$", "high"], ["j", "__reactProps$", "high"], ["j", "_reactRootContainer", "high"], ["j", "react-dom.production", "high"], ["m", "data-reactroot", "high"], ["j", "__REACT_DEVTOOLS_GLOBAL_HOOK__", "medium"]),
  R("Next.js", "Framework", ["m", "__NEXT_DATA__", "high"], ["u", "/_next/static/", "high"], ["h", "x-powered-by: next.js", "high"], ["j", "__next_f", "medium"], ["j", "next/dist/", "medium"]),
  R("Remix", "Framework", ["m", "__remixContext", "high"], ["j", "__remixContext", "high"]),
  R("Vue", "Framework", ["j", "__vue_app__", "high"], ["j", "__VUE_DEVTOOLS_GLOBAL_HOOK__", "high"], ["j", "__VUE__", "medium"], ["m", /data-v-[0-9a-f]{6,8}/, "high"], ["j", "vue.runtime", "medium"]),
  R("Nuxt", "Framework", ["m", "__NUXT__", "high"], ["u", "/_nuxt/", "high"], ["j", "__NUXT__", "high"]),
  R("Angular", "Framework", ["m", "ng-version=", "high"], ["j", "\u0275\u0275defineComponent", "high"], ["j", "@angular/core", "high"], ["m", "ng-app", "medium"]),
  R("Svelte", "Framework", ["m", /class="svelte-[a-z0-9]+/, "high"], ["j", "SvelteComponent", "high"], ["j", "svelte/internal", "high"]),
  R("SvelteKit", "Framework", ["m", "__sveltekit", "high"], ["u", "/_app/immutable/", "high"]),
  R("Solid", "Framework", ["j", "_$delegateEvents", "high"], ["j", "solid-js", "high"]),
  R("Astro", "Framework", ["m", "astro-island", "high"], ["m", "data-astro-cid", "high"], ["u", "/_astro/", "high"]),
  R("Gatsby", "Framework", ["m", "___gatsby", "high"], ["j", "gatsby-", "low"]),
  R("Ember", "Framework", ["j", "Ember.", "medium"], ["m", "ember-application", "high"], ["j", "ember-cli", "medium"]),
  R("Preact", "Framework", ["j", "__PREACT_DEVTOOLS__", "high"], ["j", "preact", "low"]),
  R("Qwik", "Framework", ["m", "q:container", "high"]),
  R("htmx", "Framework", ["m", /\bhx-(?:get|post|swap|trigger|target)=/, "high"], ["u", "htmx", "medium"]),
  R("Alpine.js", "Framework", ["m", /\sx-data=/, "high"], ["j", "Alpine.start", "high"]),
  R("jQuery", "Library", ["j", "jQuery.fn.jquery", "high"], ["u", "jquery", "medium"], ["j", "jquery.fn", "medium"]),
  R("Backbone.js", "Library", ["j", "Backbone.", "medium"]),
  R("Redux", "State", ["j", "__REDUX_DEVTOOLS_EXTENSION__", "high"], ["j", "redux-toolkit", "medium"]),
  R("MobX", "State", ["j", "mobx", "low"], ["j", "$mobx", "high"]),
  // ---- bundlers / build ----
  R("webpack", "Bundler", ["j", "__webpack_require__", "high"], ["j", "webpackChunk", "high"], ["j", "webpackJsonp", "high"]),
  R("Vite", "Bundler", ["j", "__vite__", "high"], ["j", "import.meta.env", "medium"], ["j", "__vitePreload", "high"], ["u", /\/assets\/[\w-]+-[A-Za-z0-9_-]{8}\.js/, "medium"]),
  R("Parcel", "Bundler", ["j", "parcelRequire", "high"]),
  R("Turbopack", "Bundler", ["j", "TURBOPACK", "high"], ["j", "[turbopack]", "high"]),
  R("Rspack", "Bundler", ["j", "rspack", "medium"]),
  R("esbuild", "Bundler", ["j", "__commonJS", "low"], ["j", "__toESM", "low"]),
  R("Browserify", "Bundler", ["j", "browserify", "low"]),
  // ---- UI kits ----
  R("Tailwind CSS", "UI kit", ["j", "tailwindcss", "high"], ["m", /\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|blue|green|indigo|violet|emerald|sky)-\d{2,3}\b/, "medium"], ["m", /\bgrid-cols-\d+\b/, "low"]),
  R("Bootstrap", "UI kit", ["u", "bootstrap", "high"], ["m", /\bbtn btn-(?:primary|secondary|outline|success|danger)/, "medium"], ["j", "bootstrap.Modal", "high"]),
  R("Material UI", "UI kit", ["m", "MuiButton-root", "high"], ["m", /\bMui[A-Z][A-Za-z]+-root\b/, "high"], ["j", "@mui/", "high"]),
  R("Chakra UI", "UI kit", ["m", "chakra-", "medium"], ["j", "@chakra-ui", "high"]),
  R("Ant Design", "UI kit", ["m", "ant-btn", "high"], ["j", "antd", "medium"]),
  R("Radix UI", "UI kit", ["m", "data-radix-", "high"], ["j", "@radix-ui", "high"]),
  R("shadcn/ui", "UI kit", ["j", "shadcn", "medium"], ["m", "data-slot=", "low"]),
  R("Bulma", "UI kit", ["u", "bulma", "high"]),
  R("Font Awesome", "UI kit", ["u", "fontawesome", "high"], ["m", /class="fa[srb]? fa-/, "high"]),
  // ---- hosting / backend / CMS ----
  R("Vercel", "Hosting", ["h", "server: vercel", "high"], ["h", "x-vercel-id", "high"]),
  R("Netlify", "Hosting", ["h", "server: netlify", "high"], ["h", "x-nf-request-id", "high"]),
  R("Cloudflare", "CDN", ["h", "cf-ray", "high"], ["h", "server: cloudflare", "high"]),
  R("Amazon CloudFront", "CDN", ["h", "x-amz-cf-id", "high"], ["h", "cloudfront", "medium"]),
  R("Amazon S3", "Hosting", ["h", "server: amazons3", "high"], ["u", ".s3.amazonaws.com", "medium"]),
  R("Fastly", "CDN", ["h", "x-served-by: cache-", "medium"], ["h", "fastly", "medium"]),
  R("GitHub Pages", "Hosting", ["h", "server: github.com", "high"], ["u", ".github.io", "medium"]),
  R("Firebase", "Backend", ["u", "firebaseapp.com", "high"], ["u", "firebaseio.com", "high"], ["u", "firebasestorage", "high"], ["j", "firebase", "low"]),
  R("Supabase", "Backend", ["u", "supabase.co", "high"], ["j", "supabase", "low"]),
  R("Heroku", "Hosting", ["h", "via: 1.1 vegur", "high"], ["u", "herokuapp.com", "high"]),
  R("Express", "Backend", ["h", "x-powered-by: express", "high"]),
  R("PHP", "Backend", ["h", "x-powered-by: php", "high"], ["c", "phpsessid", "high"]),
  R("ASP.NET", "Backend", ["h", "x-powered-by: asp.net", "high"], ["h", "x-aspnet-version", "high"], ["c", "asp.net_sessionid", "high"]),
  R("Ruby on Rails", "Backend", ["m", "csrf-param", "medium"], ["h", "x-runtime", "low"], ["m", "authenticity_token", "medium"]),
  R("Laravel", "Backend", ["c", "laravel_session", "high"], ["c", "xsrf-token", "low"]),
  R("Django", "Backend", ["c", "csrftoken", "medium"], ["m", "csrfmiddlewaretoken", "high"]),
  R("WordPress", "CMS", ["m", "wp-content", "high"], ["m", "wp-includes", "high"], ["u", "/wp-content/", "high"], ["h", "wp-json", "high"]),
  R("Drupal", "CMS", ["m", "Drupal.settings", "high"], ["h", "x-generator: drupal", "high"], ["m", "sites/default/files", "medium"]),
  R("Shopify", "CMS", ["u", "cdn.shopify.com", "high"], ["m", "Shopify.theme", "high"], ["h", "x-shopid", "high"]),
  R("Wix", "CMS", ["u", "static.parastorage.com", "high"], ["m", "wix.com", "medium"]),
  R("Squarespace", "CMS", ["m", "squarespace", "medium"], ["u", "squarespace", "medium"]),
  R("Webflow", "CMS", ["m", "data-wf-page", "high"], ["m", "webflow.com", "medium"]),
  R("nginx", "Server", ["h", "server: nginx", "high"]),
  R("Apache", "Server", ["h", "server: apache", "high"]),
  R("Microsoft IIS", "Server", ["h", "server: microsoft-iis", "high"]),
  // ---- data layer / realtime ----
  R("GraphQL", "Data", ["u", "/graphql", "high"], ["j", "__typename", "medium"], ["j", "graphql", "low"]),
  R("Apollo Client", "Data", ["j", "ApolloClient", "high"], ["m", "__APOLLO_STATE__", "high"], ["j", "__APOLLO_CLIENT__", "high"]),
  R("Relay", "Data", ["j", "relay-runtime", "high"]),
  R("tRPC", "Data", ["j", "@trpc", "high"], ["u", "/api/trpc", "high"]),
  R("TanStack Query", "Data", ["j", "@tanstack/react-query", "high"], ["j", "react-query", "medium"]),
  R("Socket.IO", "Realtime", ["u", "/socket.io/", "high"], ["j", "socket.io", "medium"]),
  R("Pusher", "Realtime", ["u", "js.pusher.com", "high"], ["j", "pusher-js", "high"]),
  R("Ably", "Realtime", ["u", "ably.io", "high"], ["j", "ably", "low"]),
  // ---- auth / payments ----
  R("Auth0", "Auth", ["u", "auth0.com", "high"], ["j", "auth0", "low"]),
  R("Clerk", "Auth", ["j", "__clerk", "high"], ["u", "clerk.accounts", "high"]),
  R("Firebase Auth", "Auth", ["j", "identitytoolkit", "high"]),
  R("NextAuth", "Auth", ["c", "next-auth.session-token", "high"], ["u", "/api/auth/session", "high"]),
  R("Stripe", "Payments", ["u", "js.stripe.com", "high"], ["j", "Stripe(", "low"], ["j", "api.stripe.com", "high"]),
  R("PayPal", "Payments", ["u", "paypal.com/sdk", "high"], ["u", "paypalobjects.com", "medium"]),
  R("Razorpay", "Payments", ["u", "checkout.razorpay.com", "high"], ["j", "Razorpay", "medium"]),
  // ---- analytics / monitoring ----
  R("Google Analytics", "Analytics", ["u", "google-analytics.com", "high"], ["u", "googletagmanager.com/gtag", "high"], ["j", "gtag(", "medium"]),
  R("Google Tag Manager", "Analytics", ["u", "googletagmanager.com/gtm.js", "high"], ["m", /GTM-[A-Z0-9]{5,8}/, "high"]),
  R("Segment", "Analytics", ["u", "cdn.segment.com", "high"], ["j", "analytics.identify", "medium"]),
  R("Mixpanel", "Analytics", ["j", "mixpanel", "medium"], ["u", "mixpanel", "high"]),
  R("Amplitude", "Analytics", ["j", "amplitude", "low"], ["u", "amplitude.com", "high"]),
  R("PostHog", "Analytics", ["j", "posthog", "medium"], ["u", "posthog.com", "high"]),
  R("Hotjar", "Analytics", ["u", "static.hotjar.com", "high"], ["j", "hotjar", "medium"]),
  R("Microsoft Clarity", "Analytics", ["u", "clarity.ms", "high"]),
  R("Plausible", "Analytics", ["u", "plausible.io", "high"]),
  R("Facebook Pixel", "Analytics", ["j", "fbq(", "high"], ["u", "connect.facebook.net", "high"]),
  R("Sentry", "Monitoring", ["j", "Sentry.init", "high"], ["j", "@sentry/", "high"], ["u", "sentry.io", "high"]),
  R("Datadog", "Monitoring", ["j", "DD_RUM", "high"], ["u", "datadoghq", "high"]),
  R("LogRocket", "Monitoring", ["j", "LogRocket", "high"], ["u", "logrocket", "high"]),
  // ---- maps / media / graphics ----
  R("Mapbox", "Maps", ["j", "mapboxgl", "high"], ["u", "api.mapbox.com", "high"]),
  R("Google Maps", "Maps", ["u", "maps.googleapis.com", "high"], ["j", "google.maps.", "high"]),
  R("Leaflet", "Maps", ["j", "leaflet", "low"], ["m", "leaflet-container", "high"]),
  R("Three.js", "Graphics", ["j", "WebGLRenderer", "medium"], ["j", "THREE.", "medium"], ["j", "three.module", "high"]),
  R("D3", "Graphics", ["j", "d3-selection", "high"], ["j", "d3.select", "high"]),
  R("Chart.js", "Graphics", ["j", "Chart.js", "high"], ["u", "chart.js", "high"]),
  R("Lottie", "Graphics", ["j", "bodymovin", "high"], ["u", "lottie", "medium"]),
  R("GSAP", "Graphics", ["j", "GreenSock", "high"], ["u", "gsap", "medium"]),
  R("Framer Motion", "Graphics", ["j", "framer-motion", "high"]),
  R("Video.js", "Media", ["j", "videojs", "high"]),
  R("PixiJS", "Graphics", ["j", "PIXI.", "medium"]),
  // ---- AI SDKs / APIs ----
  R("OpenAI API", "AI", ["j", "api.openai.com", "high"], ["u", "api.openai.com", "high"]),
  R("Anthropic API", "AI", ["j", "api.anthropic.com", "high"], ["j", "anthropic-version", "high"]),
  R("Google Gemini API", "AI", ["j", "generativelanguage.googleapis.com", "high"]),
  R("Vercel AI SDK", "AI", ["j", "@ai-sdk/", "high"]),
  R("LangChain", "AI", ["j", "langchain", "medium"]),
  // ---- desktop / mobile shells ----
  R("Electron", "Desktop shell", ["j", 'require("electron")', "high"], ["j", "require('electron')", "high"], ["j", "ipcRenderer", "high"], ["j", "ipcMain", "high"], ["j", "contextBridge", "high"], ["h", "electron/", "medium"]),
  R("Tauri", "Desktop shell", ["j", "__TAURI__", "high"], ["j", "@tauri-apps", "high"], ["j", "tauri://", "high"]),
  R("Capacitor", "Mobile shell", ["j", "Capacitor.", "medium"], ["j", "@capacitor/", "high"], ["j", "capacitor://", "high"]),
  R("Cordova", "Mobile shell", ["j", "cordova.exec", "high"], ["u", "cordova.js", "high"], ["j", "deviceready", "medium"]),
  R("React Native", "Mobile shell", ["j", "AppRegistry.registerComponent", "high"], ["u", "index.android.bundle", "high"], ["j", "react-native", "medium"]),
  R("Ionic", "Mobile shell", ["m", "<ion-", "high"], ["j", "@ionic/", "high"]),
  R("Flutter (web)", "Mobile shell", ["u", "flutter.js", "high"], ["u", "flutter_service_worker", "high"], ["j", "canvaskit", "medium"]),
  R("Expo", "Mobile shell", ["j", "expo-", "low"], ["j", "ExpoModulesCore", "high"]),
  R("Blazor", "Framework", ["u", "_framework/blazor", "high"]),
  R("Unity WebGL", "Game engine", ["j", "createUnityInstance", "high"], ["j", "UnityLoader", "high"]),
  R("Emscripten (WebAssembly)", "Toolchain", ["j", "Emscripten", "high"], ["j", "emscripten_", "medium"]),
  R("wasm-bindgen (Rust)", "Toolchain", ["j", "wasm_bindgen", "high"], ["j", "__wbindgen", "high"]),
  R("Service worker / PWA", "Platform", ["j", "serviceWorker.register", "high"], ["m", 'rel="manifest"', "medium"], ["j", "workbox", "medium"])
];
var CONF_RANK = { high: 3, medium: 2, low: 1 };
var MAX_SCRIPT = 3 * 1024 * 1024;
var MAX_TOTAL_JS = 12 * 1024 * 1024;
function snippet(s, idx, len) {
  const from = Math.max(0, idx - 8);
  return s.slice(from, Math.min(s.length, idx + len + 24)).replace(/\s+/g, " ").trim().slice(0, 70);
}
function detectTech(input) {
  const urlText = (input.urls ?? []).join("\n").toLowerCase();
  const hdrText = Object.entries(input.headers ?? {}).map(([k, v]) => `${k.toLowerCase()}: ${String(v).toLowerCase()}`).join("\n");
  const cookieText = (input.cookies ?? []).join("\n").toLowerCase();
  const html = (input.html ?? "").slice(0, 4 * 1024 * 1024);
  let total = 0;
  const js = [];
  for (const s of input.scripts ?? []) {
    if (total >= MAX_TOTAL_JS) break;
    const part = s.length > MAX_SCRIPT ? s.slice(0, MAX_SCRIPT) : s;
    js.push(part);
    total += part.length;
  }
  const hay = { u: [urlText], h: [hdrText], m: [html], j: js, c: [cookieText] };
  const hits = [];
  for (const rule of RULES2) {
    let best = null;
    for (const [where, pat, conf = "medium"] of rule.tests) {
      if (best && CONF_RANK[best.confidence] >= CONF_RANK[conf]) continue;
      for (const h of hay[where]) {
        if (!h) continue;
        let idx = -1;
        let len = 0;
        if (typeof pat === "string") {
          const needle = where === "m" || where === "j" ? pat : pat.toLowerCase();
          idx = h.indexOf(needle);
          len = needle.length;
        } else {
          pat.lastIndex = 0;
          const m = pat.exec(h);
          if (m) {
            idx = m.index;
            len = m[0].length;
          }
        }
        if (idx >= 0) {
          const label = where === "u" ? "URL" : where === "h" ? "response header" : where === "m" ? "HTML" : where === "c" ? "cookie" : "JavaScript";
          best = { name: rule.name, category: rule.cat, confidence: conf, evidence: `${label}: ${snippet(h, idx, len)}` };
          break;
        }
      }
    }
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => CONF_RANK[b.confidence] - CONF_RANK[a.confidence] || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
var TECH_RULE_COUNT = RULES2.length;

// shared/core/javascript.ts
var CAP = 300;
var LIT = /(?:'([^'\\\n]{1,300})'|"([^"\\\n]{1,300})"|`([^`\\]{1,300})`)/.source;
function litOf(m, g) {
  const raw = m[g] ?? m[g + 1] ?? m[g + 2] ?? "";
  const isTpl = m[g + 2] !== void 0;
  return isTpl ? templateToPath(raw) : raw;
}
function scan(re, text, fn, cap = 8e3) {
  re.lastIndex = 0;
  let n = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) re.lastIndex++;
    if (fn(m) === false) break;
    if (++n >= cap) break;
  }
}
function countOcc(text, needle, boundary = false, cap = 2e5) {
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    if (boundary) {
      const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
      const isId = prev >= 48 && prev <= 57 || prev >= 65 && prev <= 90 || prev >= 97 && prev <= 122 || prev === 95 || prev === 36 || prev === 46;
      if (isId) {
        i += needle.length;
        continue;
      }
    }
    n++;
    i += needle.length;
    if (n >= cap) break;
  }
  return n;
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function pkgRoot(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || /^[a-z]+:\/\//i.test(spec) || /\s/.test(spec)) return null;
  const parts = spec.replace(/^node:/, "node:").split("/");
  if (spec.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}
var NODE_BUILTINS = /* @__PURE__ */ new Set(["fs", "path", "os", "child_process", "crypto", "http", "https", "net", "tls", "dns", "stream", "zlib", "util", "events", "url", "querystring", "buffer", "assert", "cluster", "readline", "worker_threads", "vm", "electron", "process", "module", "v8", "perf_hooks", "timers", "string_decoder", "dgram", "tty", "fs/promises"]);
function objectKeys(text, start, maxScan = 6e3) {
  const keys = [];
  const end = Math.min(text.length, start + maxScan);
  let depth = 0;
  let expectKey = false;
  let i = start;
  while (i < end) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < end && text[j] !== q) {
        if (text[j] === "\\") j++;
        j++;
      }
      if (depth === 1 && expectKey && q !== "`") {
        const lit = text.slice(i + 1, j);
        let k = j + 1;
        while (k < end && /\s/.test(text[k])) k++;
        if (text[k] === ":" || text[k] === "(") keys.push(lit);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      if (depth === 1 && c === "{") expectKey = true;
      i++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth <= 0) break;
      i++;
      continue;
    }
    if (depth === 1) {
      if (c === ",") {
        expectKey = true;
        i++;
        continue;
      }
      if (expectKey && /[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < end && /[\w$]/.test(text[j])) j++;
        let ident = text.slice(i, j);
        let k = j;
        while (k < end && /\s/.test(text[k])) k++;
        if ((ident === "async" || ident === "get" || ident === "set") && /[A-Za-z_$]/.test(text[k] ?? "")) {
          let m = k;
          while (m < end && /[\w$]/.test(text[m])) m++;
          ident = text.slice(k, m);
          k = m;
          while (k < end && /\s/.test(text[k])) k++;
        }
        if (text[k] === ":" || text[k] === "(" || text[k] === "," || text[k] === "}") keys.push(ident);
        expectKey = false;
        i = j;
        continue;
      }
    }
    i++;
  }
  return keys;
}
function parseBool(v) {
  const s = v.trim();
  if (s === "!0" || s === "true") return true;
  if (s === "!1" || s === "false") return false;
  return truncate(s, 80);
}
var URLISH_CALL = /^(?:\/|https?:|wss?:|\$\{|\{)/;
async function maybeYield(len, signal) {
  throwIfAborted(signal);
  if (len > 15e5) await yieldToUi();
}
async function extractJsFacts(text, name = "", signal) {
  const bytes = text.length;
  let lines = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
  const minified = bytes > 2e3 && (lines <= 3 || bytes / lines > 400);
  const moduleSystems = [];
  const hasIt = (s) => text.includes(s);
  if (hasIt("export default ") || hasIt("export{") || hasIt("export {") || hasIt("import.meta") || /(?:^|[;\n}])\s*import\s*(?:[\w$*{]|["'])/.test(text.slice(0, 2e6))) moduleSystems.push("ES modules");
  if (hasIt("require(") || hasIt("module.exports") || hasIt("exports.")) moduleSystems.push("CommonJS");
  if (hasIt("typeof define") && hasIt("define.amd") || hasIt("typeof exports") && hasIt("typeof module")) moduleSystems.push("UMD");
  if (hasIt("__webpack_require__") || hasIt("webpackChunk") || hasIt("webpackJsonp")) moduleSystems.push("webpack bundle");
  if (hasIt("__vite") || hasIt("import.meta.env")) moduleSystems.push("Vite bundle");
  if (hasIt("parcelRequire")) moduleSystems.push("Parcel bundle");
  if (hasIt("__commonJS") || hasIt("__esm(")) moduleSystems.push("esbuild bundle");
  if (hasIt("System.register")) moduleSystems.push("SystemJS");
  await maybeYield(bytes, signal);
  const importSet = /* @__PURE__ */ new Set();
  const builtinSet = /* @__PURE__ */ new Set();
  const addSpec = (spec) => {
    const bare = spec.replace(/^node:/, "");
    if (NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split("/")[0])) {
      builtinSet.add(bare);
      return;
    }
    const root = pkgRoot(spec);
    if (root && importSet.size < 600) importSet.add(root);
  };
  if (hasIt("import")) scan(new RegExp(String.raw`\bimport\s+(?:[\w$*{},\s]{1,200}\s+from\s+)?(?:'([^'\n]{1,120})'|"([^"\n]{1,120})")`, "g"), text, (m) => addSpec(m[1] ?? m[2]), 4e3);
  if (hasIt("require(")) scan(/\brequire\(\s*(?:'([^'\n]{1,120})'|"([^"\n]{1,120})")\s*\)/g, text, (m) => addSpec(m[1] ?? m[2]), 6e3);
  if (hasIt("import(")) scan(/\bimport\(\s*(?:'([^'\n]{1,120})'|"([^"\n]{1,120})")\s*\)/g, text, (m) => addSpec(m[1] ?? m[2]), 2e3);
  const libraries = [];
  const libSeen = /* @__PURE__ */ new Set();
  const addLib = (n, v, source) => {
    const k = n.toLowerCase();
    if (libSeen.has(k) || libraries.length >= CAP) return;
    libSeen.add(k);
    libraries.push({ name: n, ...v ? { version: v } : {}, source });
  };
  if (hasIt("/*")) {
    scan(/\/\*[!*]?\s*(?:@license\s+)?(?:\*\s*)?([A-Za-z][\w.@/-]{1,50})\s+(?:v|version\s+)?(\d+\.\d+\.\d+)/g, text, (m) => {
      const n = m[1];
      if (/^(copyright|license|version|released|updated|build|generated|author)$/i.test(n)) return;
      addLib(n, m[2], "banner comment");
    }, 3e3);
  }
  if (hasIt("node_modules/")) {
    scan(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//g, text, (m) => addLib(m[1], void 0, "bundled path"), 6e3);
  }
  await maybeYield(bytes, signal);
  const endpoints = [];
  const epSeen = /* @__PURE__ */ new Set();
  const addEp = (url, method, via, guess) => {
    const u = url.trim();
    if (!u || u.length > 300 || endpoints.length >= 1500) return;
    const k = `${method} ${u}`;
    if (epSeen.has(k)) return;
    epSeen.add(k);
    endpoints.push({ url: u, method, via, ...guess ? { guess } : {} });
  };
  const routes = [];
  const routeSeen = /* @__PURE__ */ new Set();
  const addRoute = (r) => {
    if (routeSeen.has(r) || routes.length >= 1e3) return;
    routeSeen.add(r);
    routes.push(r);
  };
  if (hasIt("fetch(")) {
    scan(new RegExp(String.raw`\bfetch\(\s*` + LIT, "g"), text, (m) => {
      const url = litOf(m, 1);
      const win = text.slice(m.index, m.index + 320);
      const mm = /method\s*:\s*["'`]([A-Za-z]{3,7})["'`]/.exec(win);
      if (mm) addEp(url, mm[1].toUpperCase(), "fetch");
      else if (/\bbody\s*:/.test(win)) addEp(url, "POST", "fetch", true);
      else addEp(url, "GET", "fetch");
    });
    scan(new RegExp(String.raw`\bfetch\(\s*([A-Za-z_$][\w$.]{0,40})\s*\+\s*(?:'([^'\\\n]{1,200})'|"([^"\\\n]{1,200})")`, "g"), text, (m) => {
      addEp(`{${m[1].split(".").pop()}}${m[2] ?? m[3]}`, /\bbody\s*:/.test(text.slice(m.index, m.index + 320)) ? "POST" : "GET", "fetch");
    });
  }
  const clientRe = new RegExp(String.raw`\b([A-Za-z_$][\w$]{0,30})\.(get|post|put|patch|delete|head|options|request)\(\s*` + LIT, "g");
  if (hasIt(".get(") || hasIt(".post(") || hasIt(".put(") || hasIt(".patch(") || hasIt(".delete(")) {
    scan(clientRe, text, (m) => {
      const recv = m[1];
      const verb = m[2].toUpperCase();
      const lit = litOf(m, 3);
      if (!URLISH_CALL.test(lit)) return;
      if (/^(app|router|server|route|routes|r|api_router|apiRouter|fastify|koa)$/.test(recv)) {
        if (lit.startsWith("/")) addRoute(`${verb} ${lit}`);
        return;
      }
      addEp(lit, verb === "REQUEST" ? "GET" : verb, recv === "axios" ? "axios" : `${recv}.${m[2]}`);
    }, 12e3);
  }
  if (hasIt(".open(")) {
    scan(new RegExp(String.raw`\.open\(\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*,\s*` + LIT, "gi"), text, (m) => addEp(litOf(m, 2), m[1].toUpperCase(), "XMLHttpRequest"));
  }
  if (hasIt("$.ajax") || hasIt("$.get") || hasIt("$.post") || hasIt("$.getJSON") || hasIt("jQuery.ajax")) {
    scan(new RegExp(String.raw`\$\.(get|post|getJSON)\(\s*` + LIT, "g"), text, (m) => addEp(litOf(m, 2), m[1] === "post" ? "POST" : "GET", "jQuery"));
    scan(new RegExp(String.raw`\$\.ajax\(\s*\{[^}]{0,300}?\burl\s*:\s*` + LIT, "g"), text, (m) => {
      const mt = /\b(?:type|method)\s*:\s*["'](\w+)["']/i.exec(m[0]);
      addEp(litOf(m, 1), (mt?.[1] ?? "GET").toUpperCase(), "jQuery");
    });
  }
  const websockets = [];
  const eventSources = [];
  if (hasIt("WebSocket(")) scan(new RegExp(String.raw`new\s+WebSocket\(\s*` + LIT, "g"), text, (m) => void websockets.push(litOf(m, 1)), 400);
  if (hasIt("EventSource(")) scan(new RegExp(String.raw`new\s+EventSource\(\s*` + LIT, "g"), text, (m) => void eventSources.push(litOf(m, 1)), 400);
  scan(/['"`](\/(?:api|v\d{1,2}|graphql|rest|auth|oauth2?|rpc|trpc|ajax|services|gateway)(?:\/[\w\-./:{}$%@]{0,150})?)['"`]/g, text, (m) => {
    const u = m[1];
    if (![...epSeen].some((k) => k.endsWith(" " + u))) addEp(u, "?", "literal");
  }, 4e3);
  const hostCounts = /* @__PURE__ */ new Map();
  scan(/\bhttps?:\/\/([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5})(?::\d{2,5})?(\/[^\s'"`<>\\)]{0,140})?/g, text, (m) => {
    const host = m[1].toLowerCase();
    if (/^(www\.w3\.org|schemas?\.|purl\.org|example\.(com|org)|json-schema\.org|xmlns\.|ns\.adobe\.com|www\.example)/.test(host)) return;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    const path = m[2] ?? "";
    if (/^\/(?:api|v\d{1,2}|graphql|rest|rpc|trpc)\b/.test(path) || /^api[.-]/.test(host)) addEp(`https://${host}${path}`.replace(/[.,;]+$/, ""), "?", "url literal");
  }, 12e3);
  await maybeYield(bytes, signal);
  const graphql = /* @__PURE__ */ new Set();
  let persistedQueries = 0;
  if (hasIt("graphql") || hasIt("gql") || hasIt("__typename") || hasIt("operationName")) {
    scan(/\b(query|mutation|subscription)\s+([A-Za-z_]\w{2,60})\s*(?:\([^)]{0,200}\))?\s*\{/g, text, (m) => void (graphql.size < 400 && graphql.add(`${m[1]} ${m[2]}`)), 3e3);
    scan(/operationName["']?\s*:\s*["']([A-Za-z_]\w{1,60})["']/g, text, (m) => void (graphql.size < 400 && graphql.add(`operation ${m[1]}`)), 2e3);
    scan(/["']?sha256Hash["']?\s*:\s*["'][0-9a-f]{64}["']/g, text, () => void persistedQueries++, 5e3);
  }
  if (hasIt("path")) {
    scan(/\bpath\s*[:=]\s*\{?\s*["'](\/[A-Za-z0-9_\-/:*.?[\]]{0,100}|\*)["']/g, text, (m) => void addRoute(`PAGE ${m[1]}`), 3e3);
  }
  if (hasIt(".get(") || hasIt(".post(") || hasIt(".use(") || hasIt(".all(")) {
    scan(new RegExp(String.raw`\b(?:app|router|server|route|routes|fastify)\.(get|post|put|patch|delete|all|use)\(\s*["'](\/[^"'\n]{0,120})["']`, "g"), text, (m) => void addRoute(`${m[1].toUpperCase()} ${m[2]}`), 3e3);
  }
  const envVars = /* @__PURE__ */ new Set();
  const configGlobals = /* @__PURE__ */ new Set();
  if (hasIt("process.env")) {
    scan(/process\.env\.([A-Za-z_]\w{1,60})/g, text, (m) => void (envVars.size < CAP && envVars.add(m[1])), 6e3);
    scan(/process\.env\[\s*["']([A-Za-z_]\w{1,60})["']\s*\]/g, text, (m) => void (envVars.size < CAP && envVars.add(m[1])), 3e3);
  }
  if (hasIt("import.meta.env")) scan(/import\.meta\.env\.([A-Za-z_]\w{1,60})/g, text, (m) => void (envVars.size < CAP && envVars.add(m[1])), 3e3);
  if (hasIt("Deno.env")) scan(/Deno\.env\.get\(\s*["']([A-Za-z_]\w{1,60})["']/g, text, (m) => void envVars.add(m[1]), 500);
  if (hasIt("window.")) {
    scan(/window\.(__[A-Za-z_]{2,40}__|ENV|APP_CONFIG|CONFIG|appConfig|dataLayer|__INITIAL_STATE__)\b/g, text, (m) => void (configGlobals.size < 60 && configGlobals.add("window." + m[1])), 800);
  }
  await maybeYield(bytes, signal);
  const ipc = { main_handles: [], main_listens: [], renderer_invokes: [], renderer_sends: [], renderer_listens: [], main_sends: [], exposed_bridge: [] };
  const ipcSets = {
    main_handles: /* @__PURE__ */ new Set(),
    main_listens: /* @__PURE__ */ new Set(),
    renderer_invokes: /* @__PURE__ */ new Set(),
    renderer_sends: /* @__PURE__ */ new Set(),
    renderer_listens: /* @__PURE__ */ new Set(),
    main_sends: /* @__PURE__ */ new Set(),
    exposed_bridge: /* @__PURE__ */ new Set()
  };
  const webPreferences = [];
  const electron = { browserWindows: 0, openExternal: 0, loadedUrls: [], autoUpdater: false, customProtocols: [] };
  if (hasIt("ipcMain") || hasIt("ipcRenderer") || hasIt("exposeInMainWorld") || hasIt("webContents") || hasIt("BrowserWindow")) {
    const mainNames = /* @__PURE__ */ new Set(["ipcMain"]);
    const rendNames = /* @__PURE__ */ new Set(["ipcRenderer"]);
    scan(/\bipcMain\s*:\s*([A-Za-z_$][\w$]*)/g, text, (m) => void mainNames.add(m[1]), 20);
    scan(/\bipcRenderer\s*:\s*([A-Za-z_$][\w$]*)/g, text, (m) => void rendNames.add(m[1]), 20);
    scan(/([A-Za-z_$][\w$]*)\s*=\s*[\w$.()"']{1,60}?\.ipcMain\b/g, text, (m) => void mainNames.add(m[1]), 20);
    scan(/([A-Za-z_$][\w$]*)\s*=\s*[\w$.()"']{1,60}?\.ipcRenderer\b/g, text, (m) => void rendNames.add(m[1]), 20);
    const alt = (s) => [...s].map(escapeRe).join("|");
    const put = (k, v) => {
      if (ipcSets[k].size < CAP) ipcSets[k].add(v);
    };
    if (hasIt("ipcMain") || mainNames.size > 1) {
      scan(new RegExp(String.raw`(?<![\w$])(?:${alt(mainNames)})\.(handle|handleOnce|on|once|addListener)\(\s*` + LIT, "g"), text, (m) => {
        put(m[1].startsWith("handle") ? "main_handles" : "main_listens", litOf(m, 2));
      }, 3e3);
    }
    if (hasIt("ipcRenderer") || rendNames.size > 1) {
      scan(new RegExp(String.raw`(?<![\w$])(?:${alt(rendNames)})\.(invoke|send|sendSync|sendTo|postMessage|on|once|addListener)\(\s*` + LIT, "g"), text, (m) => {
        const v = m[1];
        put(v === "invoke" ? "renderer_invokes" : v === "on" || v === "once" || v === "addListener" ? "renderer_listens" : "renderer_sends", litOf(m, 2));
      }, 3e3);
    }
    if (hasIt("webContents") || hasIt(".sender.send")) {
      scan(new RegExp(String.raw`(?:\.webContents|\.sender)\.send\(\s*` + LIT, "g"), text, (m) => void put("main_sends", litOf(m, 1)), 2e3);
    }
    if (hasIt("exposeInMainWorld")) {
      scan(/exposeInMainWorld\(\s*(?:'([^'\\\n]{1,80})'|"([^"\\\n]{1,80})")\s*,\s*/g, text, (m) => {
        const apiName = m[1] ?? m[2];
        put("exposed_bridge", apiName);
        const after = m.index + m[0].length;
        if (text[after] === "{") for (const k of objectKeys(text, after)) put("exposed_bridge", `${apiName}.${k}`);
      }, 200);
    }
    if (hasIt("webPreferences")) {
      scan(/webPreferences\s*:\s*\{/g, text, (m) => {
        const body = text.slice(m.index + m[0].length - 1, m.index + m[0].length + 900);
        const end = body.indexOf("}");
        const seg = end >= 0 ? body.slice(0, end) : body;
        const wp = {};
        scan(/\b(nodeIntegration|contextIsolation|sandbox|webSecurity|enableRemoteModule|nodeIntegrationInWorker|allowRunningInsecureContent|preload)\s*:\s*([^,}]{1,120})/g, seg, (mm) => {
          wp[mm[1]] = mm[1] === "preload" ? truncate(mm[2].trim(), 80) : parseBool(mm[2]);
        }, 20);
        if (Object.keys(wp).length && webPreferences.length < 20) webPreferences.push(wp);
      }, 40);
    }
    electron.browserWindows = countOcc(text, "new BrowserWindow(") + countOcc(text, "BrowserWindow({");
    electron.openExternal = countOcc(text, "shell.openExternal(");
    electron.autoUpdater = hasIt("autoUpdater") || hasIt("electron-updater");
    if (hasIt(".loadURL(")) scan(new RegExp(String.raw`\.loadURL\(\s*` + LIT, "g"), text, (m) => void (electron.loadedUrls.length < 20 && electron.loadedUrls.push(litOf(m, 1))), 100);
    if (hasIt("registerSchemesAsPrivileged") || hasIt("registerFileProtocol") || hasIt("protocol.handle(") || hasIt("setAsDefaultProtocolClient")) {
      scan(new RegExp(String.raw`(?:registerFileProtocol|protocol\.handle|setAsDefaultProtocolClient|registerStringProtocol)\(\s*` + LIT, "g"), text, (m) => void electron.customProtocols.push(litOf(m, 1)), 40);
    }
    for (const k of Object.keys(ipcSets)) ipc[k] = [...ipcSets[k]];
  }
  await maybeYield(bytes, signal);
  const storageKeys = [];
  const storSeen = /* @__PURE__ */ new Set();
  const addStore = (kind, key) => {
    const k = kind + ":" + key;
    if (storSeen.has(k) || storageKeys.length >= CAP) return;
    storSeen.add(k);
    storageKeys.push({ kind, key });
  };
  if (hasIt("localStorage") || hasIt("sessionStorage")) {
    scan(new RegExp(String.raw`\b(localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*` + LIT, "g"), text, (m) => addStore(m[1], litOf(m, 2)), 4e3);
    scan(new RegExp(String.raw`\b(localStorage|sessionStorage)\[\s*` + LIT + String.raw`\s*\]`, "g"), text, (m) => addStore(m[1], litOf(m, 2)), 2e3);
  }
  if (hasIt("indexedDB")) scan(new RegExp(String.raw`indexedDB\.open\(\s*` + LIT, "g"), text, (m) => addStore("indexedDB", litOf(m, 1)), 200);
  let cookieWrites = 0;
  if (hasIt("document.cookie")) {
    scan(/document\.cookie\s*=\s*(?:'([A-Za-z0-9_\-.]{1,60})=|"([A-Za-z0-9_\-.]{1,60})=|`([A-Za-z0-9_\-.]{1,60})=)/g, text, (m) => {
      cookieWrites++;
      addStore("cookie", m[1] ?? m[2] ?? m[3]);
    }, 400);
  }
  if (hasIt("Cookies.")) scan(new RegExp(String.raw`\bCookies\.(?:get|set|remove)\(\s*` + LIT, "g"), text, (m) => addStore("cookie", litOf(m, 1)), 200);
  const pm = { sends: countOcc(text, ".postMessage("), listeners: 0, uncheckedListeners: 0 };
  if (hasIt('"message"') || hasIt("'message'")) {
    scan(/addEventListener\(\s*["']message["']/g, text, (m) => {
      pm.listeners++;
      if (!/\.origin\b/.test(text.slice(m.index, m.index + 500))) pm.uncheckedListeners++;
    }, 400);
  }
  const serviceWorker = [];
  if (hasIt("serviceWorker")) scan(new RegExp(String.raw`serviceWorker\.register\(\s*` + LIT, "g"), text, (m) => void serviceWorker.push(litOf(m, 1)), 20);
  const featureFlags = /* @__PURE__ */ new Set();
  scan(new RegExp(String.raw`\b(?:isFeatureEnabled|featureEnabled|useFeatureFlag|useFlag|getFeatureFlag|boolVariation|isFeatureOn|hasFeature|checkGate|getBooleanValue)\(\s*` + LIT, "g"), text, (m) => void (featureFlags.size < 200 && featureFlags.add(litOf(m, 1))), 800);
  const sourceMapUrls = [];
  if (hasIt("sourceMappingURL")) scan(/\/[/*][#@]\s*sourceMappingURL=([^\s'"*]+)/g, text, (m) => void (sourceMapUrls.length < 10 && sourceMapUrls.push(m[1])), 20);
  await maybeYield(bytes, signal);
  const sinks = {};
  const sinkDefs = [
    ["eval()", "eval(", true],
    ["new Function()", "new Function(", false],
    ["innerHTML assignment", ".innerHTML=", false],
    ["innerHTML assignment ", ".innerHTML =", false],
    ["outerHTML assignment", ".outerHTML=", false],
    ["document.write()", "document.write(", false],
    ["insertAdjacentHTML()", "insertAdjacentHTML(", false],
    ["dangerouslySetInnerHTML", "dangerouslySetInnerHTML", false],
    ["child_process", "child_process", false],
    ["shell.openExternal()", "shell.openExternal(", false]
  ];
  for (const [label, needle, boundary] of sinkDefs) {
    const n = countOcc(text, needle, boundary);
    if (n > 0) sinks[label.trim()] = (sinks[label.trim()] ?? 0) + n;
  }
  let functions = 0;
  for (let i = text.indexOf("function"); i !== -1 && functions < 5e6; i = text.indexOf("function", i + 8)) {
    const nx = text.charCodeAt(i + 8);
    const isId = nx >= 48 && nx <= 57 || nx >= 65 && nx <= 90 || nx >= 97 && nx <= 122 || nx === 95 || nx === 36;
    if (!isId) functions++;
  }
  let classes = 0;
  if (hasIt("class ")) scan(/\bclass\s+[A-Za-z_$]/g, text, () => void classes++, 2e5);
  const counts = { functions, arrows: countOcc(text, "=>"), classes };
  const hosts = [...hostCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([host, count]) => ({ host, count, ...hostCategory(host) ? { category: hostCategory(host) } : {} }));
  await maybeYield(bytes, signal);
  const secrets = scanSecrets(text, 40).map((s) => ({ kind: s.kind, preview: s.preview, severity: s.severity, ...s.note ? { note: s.note } : {} }));
  const tech = detectTech({ urls: name ? [name] : [], scripts: [text] });
  for (const t of tech) if (t.confidence !== "low") addLib(t.name, void 0, "fingerprint");
  return {
    bytes,
    lines,
    minified,
    moduleSystems,
    imports: [...importSet].sort(),
    nodeBuiltins: [...builtinSet].sort(),
    libraries,
    endpoints,
    websockets: uniqueLimited(websockets, 100),
    eventSources: uniqueLimited(eventSources, 100),
    graphql: [...graphql],
    persistedQueries,
    routes,
    envVars: [...envVars].sort(),
    configGlobals: [...configGlobals],
    ipc,
    webPreferences,
    electron,
    storageKeys,
    cookieWrites,
    postMessage: pm,
    serviceWorker,
    featureFlags: [...featureFlags],
    sourceMapUrls,
    sinks,
    hosts,
    secrets,
    counts,
    tech
  };
}
function mergeJsFacts(all) {
  const uni = (sel, key, cap = 1500) => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const f of all) for (const t of sel(f)) {
      const k = key(t);
      if (seen.has(k) || out.length >= cap) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };
  const ipc = {
    main_handles: uni((f) => f.ipc.main_handles, (s) => s),
    main_listens: uni((f) => f.ipc.main_listens, (s) => s),
    renderer_invokes: uni((f) => f.ipc.renderer_invokes, (s) => s),
    renderer_sends: uni((f) => f.ipc.renderer_sends, (s) => s),
    renderer_listens: uni((f) => f.ipc.renderer_listens, (s) => s),
    main_sends: uni((f) => f.ipc.main_sends, (s) => s),
    exposed_bridge: uni((f) => f.ipc.exposed_bridge, (s) => s)
  };
  const hostMap = /* @__PURE__ */ new Map();
  for (const f of all) for (const h of f.hosts) {
    const cur = hostMap.get(h.host);
    if (cur) cur.count += h.count;
    else hostMap.set(h.host, { ...h });
  }
  const sinks = {};
  for (const f of all) for (const [k, v] of Object.entries(f.sinks)) sinks[k] = (sinks[k] ?? 0) + v;
  const techMap = /* @__PURE__ */ new Map();
  for (const f of all) for (const t of f.tech) if (!techMap.has(t.name)) techMap.set(t.name, t);
  return {
    bytes: all.reduce((a, f) => a + f.bytes, 0),
    lines: all.reduce((a, f) => a + f.lines, 0),
    minified: all.some((f) => f.minified),
    moduleSystems: uni((f) => f.moduleSystems, (s) => s, 20),
    imports: uni((f) => f.imports, (s) => s, 600),
    nodeBuiltins: uni((f) => f.nodeBuiltins, (s) => s, 100),
    libraries: uni((f) => f.libraries, (l) => l.name.toLowerCase(), CAP),
    endpoints: uni((f) => f.endpoints, (e) => `${e.method} ${e.url}`, 1500),
    websockets: uni((f) => f.websockets, (s) => s, 100),
    eventSources: uni((f) => f.eventSources, (s) => s, 100),
    graphql: uni((f) => f.graphql, (s) => s, 400),
    persistedQueries: all.reduce((a, f) => a + f.persistedQueries, 0),
    routes: uni((f) => f.routes, (s) => s, 1e3),
    envVars: uni((f) => f.envVars, (s) => s, CAP).sort(),
    configGlobals: uni((f) => f.configGlobals, (s) => s, 60),
    ipc,
    webPreferences: all.flatMap((f) => f.webPreferences).slice(0, 20),
    electron: {
      browserWindows: all.reduce((a, f) => a + f.electron.browserWindows, 0),
      openExternal: all.reduce((a, f) => a + f.electron.openExternal, 0),
      loadedUrls: uni((f) => f.electron.loadedUrls, (s) => s, 20),
      autoUpdater: all.some((f) => f.electron.autoUpdater),
      customProtocols: uni((f) => f.electron.customProtocols, (s) => s, 40)
    },
    storageKeys: uni((f) => f.storageKeys, (s) => `${s.kind}:${s.key}`, CAP),
    cookieWrites: all.reduce((a, f) => a + f.cookieWrites, 0),
    postMessage: {
      sends: all.reduce((a, f) => a + f.postMessage.sends, 0),
      listeners: all.reduce((a, f) => a + f.postMessage.listeners, 0),
      uncheckedListeners: all.reduce((a, f) => a + f.postMessage.uncheckedListeners, 0)
    },
    serviceWorker: uni((f) => f.serviceWorker, (s) => s, 20),
    featureFlags: uni((f) => f.featureFlags, (s) => s, 200),
    sourceMapUrls: uni((f) => f.sourceMapUrls, (s) => s, 40),
    sinks,
    hosts: [...hostMap.values()].sort((a, b) => b.count - a.count).slice(0, 80),
    secrets: uni((f) => f.secrets, (s) => s.kind + s.preview, 60),
    counts: {
      functions: all.reduce((a, f) => a + f.counts.functions, 0),
      arrows: all.reduce((a, f) => a + f.counts.arrows, 0),
      classes: all.reduce((a, f) => a + f.counts.classes, 0)
    },
    tech: [...techMap.values()]
  };
}
var TECH_TONE = { Framework: "cyan", Bundler: "dim", "UI kit": "cyan", Hosting: "orange", CDN: "orange", Backend: "orange", CMS: "orange", Analytics: "dim", Monitoring: "dim", Payments: "green", Auth: "green", AI: "orange", "Desktop shell": "orange", "Mobile shell": "orange" };
function techTags(tech, title = "Detected technologies", max = 40) {
  return tags(title, tech.slice(0, max).map((t) => ({ label: `${t.name}${t.confidence === "low" ? " (maybe)" : ""}`, tone: TECH_TONE[t.category] ?? "dim" })));
}
function factsToSections(f, rowMax = 200) {
  const s = [];
  s.push(
    kv("Overview", {
      Size: fmtBytes(f.bytes),
      Lines: f.lines,
      "Minified (names shortened)": f.minified,
      "Module system": f.moduleSystems.join(", ") || "plain script",
      "Functions (approx.)": f.counts.functions,
      "Arrow functions": f.counts.arrows,
      Classes: f.counts.classes
    })
  );
  if (f.tech.length) s.push(techTags(f.tech));
  if (f.endpoints.length) {
    s.push(table("Network calls found in the code", ["Method", "URL or path", "Found via"], f.endpoints.map((e) => [e.guess ? e.method + "?" : e.method, e.url, e.via]), rowMax));
  }
  if (f.routes.length) s.push(list("Screens and server routes", f.routes));
  const ipcRows = [];
  const dir = [
    ["renderer_invokes", "window \u2192 main (invoke, expects reply)"],
    ["renderer_sends", "window \u2192 main (send)"],
    ["main_handles", "main handles (replies to invoke)"],
    ["main_listens", "main listens"],
    ["main_sends", "main \u2192 window (push)"],
    ["renderer_listens", "window listens"]
  ];
  for (const [k, label] of dir) for (const ch of f.ipc[k]) ipcRows.push([label, ch]);
  if (ipcRows.length) s.push(table("Electron messages between app parts (IPC)", ["Direction", "Channel"], ipcRows, rowMax));
  if (f.ipc.exposed_bridge.length) s.push(list("Functions the app exposes to its web pages (preload bridge)", f.ipc.exposed_bridge));
  if (f.webPreferences.length) {
    const wp = f.webPreferences[0];
    s.push(kv("Electron window security settings", { nodeIntegration: String(wp.nodeIntegration ?? "default (off)"), contextIsolation: String(wp.contextIsolation ?? "default (on)"), sandbox: String(wp.sandbox ?? "default"), webSecurity: String(wp.webSecurity ?? "default (on)"), preload: wp.preload ?? null }));
  }
  if (f.envVars.length) s.push(list("Environment variables the code reads", f.envVars));
  if (f.configGlobals.length) s.push(list("Global configuration objects", f.configGlobals));
  if (f.storageKeys.length) s.push(table("What it stores in the browser", ["Where", "Key"], f.storageKeys.map((k) => [k.kind, k.key]), rowMax));
  if (f.graphql.length) s.push(list("GraphQL operations", f.graphql));
  if (f.websockets.length || f.eventSources.length) s.push(list("Live connections (WebSocket / event stream)", [...f.websockets.map((w) => `ws  ${w}`), ...f.eventSources.map((w) => `sse ${w}`)]));
  if (f.hosts.length) s.push(table("Outside services mentioned", ["Host", "Mentions", "Kind"], f.hosts.map((h) => [h.host, h.count, h.category ?? null]), rowMax));
  if (f.imports.length) s.push(list("Packages imported", f.imports));
  if (f.libraries.length) s.push(list("Libraries identified inside the bundle", f.libraries.map((l) => l.version ? `${l.name} ${l.version}` : l.name)));
  if (f.featureFlags.length) s.push(list("Feature flags", f.featureFlags));
  if (Object.keys(f.sinks).length) s.push(bars("Risky code patterns (count)", Object.entries(f.sinks).map(([label, value]) => ({ label, value }))));
  if (f.secrets.length) s.push(table("Possible secrets (masked)", ["Kind", "Preview", "Severity"], f.secrets.map((x) => [x.kind, x.preview, x.severity]), rowMax));
  if (f.sourceMapUrls.length) s.push(list("Source map references", f.sourceMapUrls));
  return s;
}
function factsToFindings(f, label = "This code") {
  const out = [];
  const risk = f.secrets.filter((x) => x.severity === "risk");
  const notice = f.secrets.filter((x) => x.severity === "notice");
  if (risk.length) out.push(finding(`${risk.length} possible secret${risk.length > 1 ? "s" : ""} embedded in the code`, "risk", `Kinds: ${[...new Set(risk.map((x) => x.kind))].join(", ")}. Values are masked here. Anything shipped to users can be read by users.`, ["secrets"]));
  if (notice.length) out.push(finding(`${notice.length} key${notice.length > 1 ? "s" : ""} that are often public by design`, "notice", [...new Set(notice.map((x) => x.kind))].join(", "), ["secrets"]));
  for (const wp of f.webPreferences) {
    if (wp.nodeIntegration === true) out.push(finding("Electron window runs web content with full system access (nodeIntegration on)", "risk", "If the window ever shows untrusted content, that content can run programs on the computer.", ["electron"]));
    if (wp.contextIsolation === false) out.push(finding("Electron context isolation is switched off", "risk", "Web pages can reach the preload scripts\u2019 internals.", ["electron"]));
    if (wp.webSecurity === false) out.push(finding("Electron web security is switched off", "risk", "The same-origin protection is disabled for that window.", ["electron"]));
    if (wp.sandbox === false) out.push(finding("Electron sandbox is switched off for a window", "warning", void 0, ["electron"]));
  }
  if (f.ipc.exposed_bridge.length) out.push(finding(`The app exposes ${f.ipc.exposed_bridge.length} bridge item${f.ipc.exposed_bridge.length > 1 ? "s" : ""} to its web pages`, "info", f.ipc.exposed_bridge.slice(0, 8).join(", "), ["electron"]));
  const ipcCount = Object.values(f.ipc).reduce((a, v) => a + v.length, 0) - f.ipc.exposed_bridge.length;
  if (ipcCount > 0) out.push(finding(`${ipcCount} internal message channel${ipcCount > 1 ? "s" : ""} (Electron IPC) found`, "info", void 0, ["electron"]));
  if (f.endpoints.length) out.push(finding(`${f.endpoints.length} network endpoint${f.endpoints.length > 1 ? "s" : ""} referenced in the code`, "info", f.endpoints.slice(0, 5).map((e) => `${e.method} ${e.url}`).join("\n"), ["api"]));
  const plain = f.endpoints.filter((e) => /^http:\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(e.url));
  if (plain.length) out.push(finding(`${plain.length} endpoint${plain.length > 1 ? "s" : ""} use unencrypted http://`, "warning", plain.slice(0, 4).map((e) => e.url).join("\n"), ["transport"]));
  if (f.sinks["eval()"] || f.sinks["new Function()"]) out.push(finding(`${label} builds code from text at run time (eval / new Function)`, "warning", `eval: ${f.sinks["eval()"] ?? 0}, new Function: ${f.sinks["new Function()"] ?? 0}`, ["injection"]));
  const htmlSinks = (f.sinks["innerHTML assignment"] ?? 0) + (f.sinks["dangerouslySetInnerHTML"] ?? 0) + (f.sinks["document.write()"] ?? 0) + (f.sinks["insertAdjacentHTML()"] ?? 0);
  if (htmlSinks) out.push(finding(`${htmlSinks} place${htmlSinks > 1 ? "s" : ""} insert raw HTML into the page`, "notice", "Safe only when the inserted text is trusted or sanitised.", ["xss"]));
  if (f.postMessage.uncheckedListeners > 0) out.push(finding(`${f.postMessage.uncheckedListeners} message listener${f.postMessage.uncheckedListeners > 1 ? "s" : ""} without an obvious origin check`, "warning", "Cross-window messages should confirm who sent them.", ["postmessage"]));
  if (f.minified) out.push(finding("Code is minified", "notice", "Variable and function names are shortened, so the logic is harder to read, but strings, URLs and structure remain visible."));
  if (f.sourceMapUrls.length) out.push(finding("A source map is referenced", "notice", "If the map file is published, the original source code can usually be recovered from it.", ["sourcemap"]));
  return out;
}
var SHORT = (s, n = 48) => truncate(s, n);
function factsToGraph(f, rootId, rootLabel, rootGroup = "module") {
  const nodes = [{ id: rootId, label: SHORT(rootLabel, 36), group: rootGroup, weight: 8 }];
  const edges = [];
  const add = (n, from, to, label) => {
    if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
    edges.push({ from, to, ...label ? { label } : {} });
  };
  const eps = [...f.endpoints].sort((a, b) => (a.via === "literal" ? 1 : 0) - (b.via === "literal" ? 1 : 0)).slice(0, 20);
  for (const e of eps) add({ id: `api:${e.method} ${e.url}`, label: SHORT(`${e.method} ${e.url}`, 44), group: "api", weight: 4 }, rootId, `api:${e.method} ${e.url}`, e.via);
  for (const h of f.hosts.filter((x) => x.category !== "cdn" && x.category !== "fonts").slice(0, 10)) add({ id: `svc:${h.host}`, label: h.host, group: "service", weight: Math.min(7, 2 + Math.round(Math.log2(h.count + 1))) }, rootId, `svc:${h.host}`, h.category ?? "calls");
  const chan = (arr, dir, label) => {
    for (const ch of arr.slice(0, 10)) {
      const id = `ipc:${ch}`;
      if (!nodes.some((x) => x.id === id)) nodes.push({ id, label: SHORT(ch, 36), group: "native", weight: 3 });
      edges.push(dir === "out" ? { from: rootId, to: id, label } : { from: id, to: rootId, label });
    }
  };
  chan(f.ipc.renderer_invokes, "out", "invoke");
  chan(f.ipc.renderer_sends, "out", "send");
  chan(f.ipc.main_handles, "in", "handled here");
  chan(f.ipc.main_listens, "in", "listens");
  chan(f.ipc.main_sends, "out", "pushes");
  for (const b of f.ipc.exposed_bridge.filter((x) => !x.includes(".")).slice(0, 4)) add({ id: `bridge:${b}`, label: `window.${b}`, group: "native", weight: 5 }, rootId, `bridge:${b}`, "exposes");
  for (const k of f.storageKeys.slice(0, 8)) add({ id: `data:${k.kind}:${k.key}`, label: SHORT(`${k.kind}: ${k.key}`, 36), group: "data", weight: 2 }, rootId, `data:${k.kind}:${k.key}`, "stores");
  for (const t of f.tech.filter((x) => x.confidence !== "low" && !["Server", "Platform"].includes(x.category)).slice(0, 10)) add({ id: `lib:${t.name}`, label: t.name, group: "lib", weight: 3 }, rootId, `lib:${t.name}`, "built with");
  return { nodes, edges };
}

// shared/core/sourcemap.ts
function parseSourceMap(text) {
  const j = parseJsonLoose(text);
  if (!j || typeof j !== "object") return null;
  if (Array.isArray(j.sections)) {
    const sources = [];
    const contents = [];
    for (const s of j.sections) {
      const m = s?.map;
      if (m && Array.isArray(m.sources)) m.sources.forEach((p, i) => {
        sources.push(String(p));
        contents.push(typeof m.sourcesContent?.[i] === "string" ? m.sourcesContent[i] : null);
      });
    }
    return { sources, contents, names: 0, file: j.file };
  }
  if (!Array.isArray(j.sources)) return null;
  return {
    sources: j.sources.map(String),
    contents: j.sources.map((_, i) => typeof j.sourcesContent?.[i] === "string" ? j.sourcesContent[i] : null),
    names: Array.isArray(j.names) ? j.names.length : 0,
    file: typeof j.file === "string" ? j.file : void 0,
    sourceRoot: typeof j.sourceRoot === "string" ? j.sourceRoot : void 0
  };
}
function cleanSourcePath(p) {
  let s = p.replace(/^[a-z-]+:\/\/\/?/i, "").replace(/[?#].*$/, "").replace(/\\/g, "/");
  s = s.replace(/^\(webpack\)\/?/, "webpack/").replace(/^\.\//, "");
  const out = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part.replace(/[^\w.@+\- ~]/g, "_"));
  }
  return out.join("/") || "unnamed";
}
function mapToRecovered(m, maxBytes) {
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  let used = 0;
  let truncated = false;
  m.sources.forEach((src, i) => {
    const t = m.contents[i];
    if (t == null) return;
    let path = cleanSourcePath((m.sourceRoot ? m.sourceRoot + "/" : "") + src);
    if (seen.has(path)) path = `${i}_${path}`;
    seen.add(path);
    if (used + t.length > maxBytes) {
      truncated = true;
      return;
    }
    used += t.length;
    files.push({ path, kind: /\.(?:[mc]?[jt]sx?|vue|svelte|css|scss|less|html?)$/i.test(path) ? "source" : "text", size: t.length, text: t, origin: "sourcemap" });
  });
  return { files, truncated, bytes: used };
}

// shared/core/website.ts
function normalizeUrlInput(input) {
  let s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(s) ? "http://" : "https://") + s;
  const u = safeUrl(s);
  if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes(".") && u.hostname !== "localhost") return null;
  u.hash = "";
  return u.href;
}
var SEC_HEADERS = [
  ["strict-transport-security", "Forces HTTPS (HSTS)"],
  ["content-security-policy", "Limits what scripts can run (CSP)"],
  ["x-content-type-options", "Stops MIME sniffing"],
  ["x-frame-options", "Blocks clickjacking frames"],
  ["referrer-policy", "Controls referrer leakage"],
  ["permissions-policy", "Limits browser features"]
];
async function analyzeWebsite(urlIn, fetcher, options = {}) {
  const t0 = Date.now();
  const opts = resolveOptions(options);
  const maxAssets = options.maxAssets ?? 40;
  const maxAssetBytes = options.maxAssetBytes ?? 4 * 1024 * 1024;
  const wantMaps = options.fetchSourceMaps ?? true;
  const url = normalizeUrlInput(urlIn);
  if (!url) throw new Error("That does not look like a web address. Try something like example.com");
  const progress = (phase, pct, message) => opts.onProgress({ phase, pct, message });
  progress("fetch", 3, "Opening the page");
  const page = await fetcher(url, { accept: "text/html,application/xhtml+xml,*/*;q=0.5", maxBytes: 6 * 1024 * 1024 });
  throwIfAborted(opts.signal);
  const html = decodeUtf8(page.body);
  const finalUrl = page.finalUrl || url;
  const host = safeUrl(finalUrl)?.host ?? "";
  const target = { name: host, kind: "website", url: finalUrl, size: page.body.length, sha256: await sha256Hex(page.body), format: "website" };
  const inv = parseHtml(html, finalUrl);
  const evidence = [];
  const recovered = [{ path: "index.html", kind: "source", size: html.length, text: html.slice(0, 2e6), origin: "website" }];
  const unknowns = [];
  const limits = [];
  if (page.status >= 400) limits.push(`The site answered with status ${page.status}; the page may be an error or a block page.`);
  const jsUrls = [...new Set(inv.scripts.map((s) => s.src).filter((s) => !!s))];
  const cssUrls = [...new Set(inv.styleSheets)];
  const queue = [...jsUrls.map((u) => ({ u, k: "js" })), ...cssUrls.map((u) => ({ u, k: "css" }))].filter((a) => /^https?:/i.test(a.u));
  queue.sort((a, b) => Number(isFirstParty(safeUrl(b.u)?.host ?? "", host)) - Number(isFirstParty(safeUrl(a.u)?.host ?? "", host)));
  const todo = queue.slice(0, maxAssets);
  if (queue.length > maxAssets) limits.push(`Only the first ${maxAssets} of ${queue.length} scripts/styles were downloaded.`);
  const jsFacts = [];
  const cssTokens = [];
  const jsTexts = [];
  const mapUrls = [];
  const failed = [];
  let done = 0, assetBytes = 0, usedRecovered = 0;
  for (const a of todo) {
    throwIfAborted(opts.signal);
    progress("assets", 10 + Math.round(done++ / Math.max(1, todo.length) * 55), `Reading ${truncate(a.u, 70)}`);
    try {
      const r = await fetcher(a.u, { accept: "*/*", maxBytes: maxAssetBytes });
      if (r.status >= 400) {
        failed.push(a.u);
        continue;
      }
      const text = decodeUtf8(r.body);
      assetBytes += r.body.length;
      const rel = (safeUrl(a.u)?.pathname ?? a.u).replace(/^\/+/, "") || "asset";
      if (usedRecovered + text.length <= opts.maxRecoveredBytes) {
        usedRecovered += text.length;
        recovered.push({ path: rel, kind: "source", size: text.length, text, origin: "website" });
      }
      if (a.k === "js") {
        jsTexts.push(text.slice(0, 6e5));
        const f = await extractJsFacts(text, rel, opts.signal);
        jsFacts.push(f);
        for (const m of f.sourceMapUrls) {
          const abs = safeUrl(m, a.u)?.href;
          if (abs && /^https?:/.test(abs)) mapUrls.push(abs);
        }
        if (f.sourceMapUrls.length === 0 && wantMaps) mapUrls.push(a.u + ".map");
      } else cssTokens.push(extractDesignTokens(text));
    } catch (e) {
      if (e?.name === "AbortedError") throw e;
      failed.push(a.u);
    }
    await yieldToUi();
  }
  for (const s of inv.inlineScripts) {
    jsFacts.push(await extractJsFacts(s, "inline", opts.signal));
    jsTexts.push(s.slice(0, 2e5));
  }
  if (inv.inlineStyleBytes) {
  }
  const htmlCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  if (htmlCss) cssTokens.push(extractDesignTokens(htmlCss));
  let mapFiles = 0;
  let mapNote = "";
  if (wantMaps) {
    progress("maps", 70, "Looking for source maps");
    const tried = [...new Set(mapUrls)].slice(0, 6);
    for (const mu of tried) {
      throwIfAborted(opts.signal);
      try {
        const r = await fetcher(mu, { accept: "application/json,*/*", maxBytes: 12 * 1024 * 1024 });
        if (r.status >= 400) continue;
        const pm = parseSourceMap(decodeUtf8(r.body));
        if (!pm) continue;
        const rf = mapToRecovered(pm, Math.max(0, opts.maxRecoveredBytes - usedRecovered));
        usedRecovered += rf.bytes;
        recovered.push(...rf.files.map((f) => ({ ...f, path: "sourcemap/" + f.path })));
        mapFiles += rf.files.length;
        for (const f of rf.files.slice(0, 80)) if (/\.[mc]?[jt]sx?$/.test(f.path) && !/node_modules/.test(f.path) && f.text) jsFacts.push(await extractJsFacts(f.text, f.path, opts.signal));
      } catch (e) {
        if (e?.name === "AbortedError") throw e;
      }
    }
    mapNote = mapFiles ? `Original source code for ${mapFiles} files was recovered from published source maps.` : "No public source maps were found, so original (un-minified) code could not be recovered.";
    if (!mapFiles) unknowns.push({ id: "unk_sourcemaps", question: "The original source code is not published. How is the app structured internally?", domain: "website", status: "open" });
  }
  progress("files", 78, "Checking manifest, robots and sitemap");
  const origin = safeUrl(finalUrl)?.origin ?? "";
  const side = {};
  for (const p of ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/.well-known/security.txt"]) {
    try {
      const r = await fetcher(origin + p, { accept: "*/*", maxBytes: 4e5 });
      side[p] = r.status < 400 && !/^\s*<!doctype html/i.test(decodeUtf8(r.body.subarray(0, 200))) ? decodeUtf8(r.body) : null;
    } catch (e) {
      if (e?.name === "AbortedError") throw e;
      side[p] = null;
    }
  }
  const manifestLink = inv.links.find((l) => l.rel.includes("manifest"))?.href;
  if (manifestLink && !side["/manifest.webmanifest"]) {
    try {
      const r = await fetcher(manifestLink, { maxBytes: 2e5 });
      if (r.status < 400) side["/manifest.webmanifest"] = decodeUtf8(r.body);
    } catch (e) {
      if (e?.name === "AbortedError") throw e;
    }
  }
  const sitemapUrls = [...(side["/sitemap.xml"] ?? "").matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
  const disallow = [...(side["/robots.txt"] ?? "").matchAll(/^\s*disallow:\s*(\S+)/gim)].map((m) => m[1]);
  const manifest = side["/manifest.webmanifest"] ? parseJsonLoose(side["/manifest.webmanifest"]) : void 0;
  progress("analysis", 88, "Putting it together");
  const facts = mergeJsFacts(jsFacts);
  const tech = detectTech({ urls: [finalUrl, ...jsUrls, ...cssUrls], headers: Object.fromEntries(Object.entries(page.headers).map(([k, v]) => [k, v])), html, scripts: jsTexts.slice(0, 30), cookies: (page.headers["set-cookie"] ?? "").split(/,(?=\s*[\w-]+=)/).map((c) => c.split("=")[0].trim().toLowerCase()) });
  const allTech = [...new Map([...tech, ...facts.tech].map((t) => [t.name, t])).values()];
  const mergedColors = /* @__PURE__ */ new Map();
  const mergedFonts = /* @__PURE__ */ new Map();
  const vars = /* @__PURE__ */ new Map();
  const bps = /* @__PURE__ */ new Set();
  const kfs = /* @__PURE__ */ new Set();
  for (const t of cssTokens) {
    t.colors.forEach((c) => mergedColors.set(c.value, (mergedColors.get(c.value) ?? 0) + c.count));
    t.fonts.forEach((c) => mergedFonts.set(c.family, (mergedFonts.get(c.family) ?? 0) + c.count));
    t.variables.forEach((v) => !vars.has(v.name) && vars.set(v.name, v.value));
    t.breakpoints.forEach((b) => bps.add(b));
    t.keyframes.forEach((k) => kfs.add(k));
  }
  const base = cssTokens[0];
  const design = base ? {
    ...base,
    colors: [...mergedColors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([value, count]) => ({ value, count })),
    fonts: [...mergedFonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([family, count]) => ({ family, count })),
    variables: [...vars.entries()].slice(0, 120).map(([name, value]) => ({ name, value })),
    breakpoints: [...bps].sort((a, b) => parseFloat(a) - parseFloat(b)),
    keyframes: [...kfs].slice(0, 40),
    fontSizes: cssTokens.flatMap((t) => t.fontSizes).slice(0, 12),
    spacing: cssTokens.flatMap((t) => t.spacing).slice(0, 12),
    radii: cssTokens.flatMap((t) => t.radii).slice(0, 8),
    shadows: [...new Set(cssTokens.flatMap((t) => t.shadows))].slice(0, 12),
    fontFaces: cssTokens.flatMap((t) => t.fontFaces).slice(0, 30),
    zIndexMax: Math.max(...cssTokens.map((t) => t.zIndexMax)),
    usesFlex: cssTokens.some((t) => t.usesFlex),
    usesGrid: cssTokens.some((t) => t.usesGrid),
    utilityDensity: Math.max(...cssTokens.map((t) => t.utilityDensity)),
    bytes: cssTokens.reduce((a, t) => a + t.bytes, 0)
  } : null;
  const thirdHosts = /* @__PURE__ */ new Map();
  for (const u of [...jsUrls, ...cssUrls, ...inv.iframes, ...inv.images.srcs, ...facts.endpoints.map((e) => e.url)]) {
    const h = safeUrl(u, finalUrl)?.host;
    if (h && !isFirstParty(h, host)) thirdHosts.set(h, hostCategory(h) ?? "external service");
  }
  const headerRows = SEC_HEADERS.map(([h, why]) => [h, page.headers[h] ? truncate(page.headers[h], 120) : "missing", why]);
  const missing = SEC_HEADERS.filter(([h]) => !page.headers[h]).map(([h]) => h);
  const hf = [...htmlFindings(inv), ...factsToFindings(facts, "This site")];
  if (missing.length >= 4) hf.push(finding(`${missing.length} common security headers are missing`, "notice", missing.join(", ")));
  const summary = `${inv.title || host}: ${allTech.filter((t) => t.confidence !== "low").slice(0, 4).map((t) => t.name).join(", ") || "technology not identified"}; ${jsUrls.length} scripts, ${cssUrls.length} stylesheets, ${facts.endpoints.length} API endpoints found${mapFiles ? `, ${mapFiles} original source files recovered` : ""}.`;
  const rootLabel = host;
  const g = factsToGraph(facts, "site", rootLabel, "entry");
  for (const [h, cat] of [...thirdHosts.entries()].slice(0, 10)) {
    g.nodes.push({ id: "ext:" + h, label: h, group: "service", weight: 3, detail: cat });
    g.edges.push({ from: "site", to: "ext:" + h, label: "uses" });
  }
  const sections = [
    kv("Site at a glance", { Address: finalUrl, Status: page.status, Server: page.headers.server ?? null, Powered: page.headers["x-powered-by"] ?? null, "Page size": fmtBytes(page.body.length), "Scripts downloaded": jsTexts.length, "Script data read": fmtBytes(assetBytes), "Source maps": mapFiles ? `${mapFiles} files recovered` : "none public", "Installable app (PWA)": manifest ? "yes" : "no" }),
    techTags(allTech),
    ...inventorySections(inv, opts.maxRows),
    ...design ? tokensToSections(design, opts.maxRows) : [],
    ...factsToSections(facts, opts.maxRows),
    table("Security headers", ["Header", "Value", "Purpose"], headerRows),
    table("Third-party services", ["Host", "Kind"], [...thirdHosts.entries()].map(([h, c]) => [h, c]), opts.maxRows),
    list("Sitemap pages", sitemapUrls),
    list("Paths the site asks robots to skip", disallow),
    list("Assets that could not be downloaded", failed)
  ];
  const roles = design ? paletteRoles(design.colors) : {};
  evidence.push(makeEvidence({
    operation: "inspect_website",
    title: `Website: ${host}`,
    target,
    summary,
    normalized_result: {
      url: finalUrl,
      status: page.status,
      title: inv.title,
      description: inv.meta.description ?? null,
      technologies: allTech.slice(0, 40).map((t) => ({ name: t.name, category: t.category, confidence: t.confidence })),
      scripts: jsUrls.slice(0, 80),
      stylesheets: cssUrls.slice(0, 40),
      forms: inv.forms.slice(0, 20),
      endpoints: facts.endpoints.slice(0, 150).map((e) => ({ url: e.url, method: e.method, via: e.via })),
      routes: facts.routes.slice(0, 100),
      env_vars: facts.envVars.slice(0, 60),
      storage_keys: facts.storageKeys.slice(0, 60).map((k) => `${k.kind}:${k.key}`),
      websockets: facts.websockets,
      design: design ? { colors: design.colors.slice(0, 16).map((c) => c.value), fonts: design.fonts.map((f) => f.family), roles, breakpoints: design.breakpoints, variables: design.variables.slice(0, 60) } : null,
      third_parties: Object.fromEntries(thirdHosts),
      security_headers_missing: missing,
      source_maps_recovered: mapFiles,
      manifest: manifest && typeof manifest === "object" ? { name: manifest.name, theme_color: manifest.theme_color, display: manifest.display } : null,
      sitemap_count: sitemapUrls.length,
      secrets: facts.secrets.map((s) => ({ kind: s.kind, preview: s.preview }))
    },
    sections,
    findings: hf,
    graph: g,
    coverage: { status: "partial", notes: [mapNote, ...limits].filter(Boolean) },
    limitations: [
      "Only the public front end was read. Server code, databases and anything behind login cannot be seen from outside.",
      "Content created by JavaScript after the page loads is not captured because the page was not run in a browser.",
      ...limits
    ]
  }));
  progress("done", 100, "Done");
  return { target, evidence, unknowns, recovered, recoveredTruncated: usedRecovered >= opts.maxRecoveredBytes, stats: { durationMs: Date.now() - t0, analyzers: ["inspect_website"], bytes: page.body.length + assetBytes } };
}

// shared/server/siteRoute.ts
function makeSiteFetcher(f, signal) {
  return async (url, init) => {
    const { res, finalUrl } = await fetchFollow(f, url, { headers: { accept: init?.accept ?? "*/*" }, signal });
    const body = await readCapped(res, init?.maxBytes ?? 4 * 1024 * 1024);
    const headers = {};
    res.headers.forEach((v, k) => headers[k.toLowerCase()] = v);
    return { status: res.status, finalUrl, headers, body };
  };
}
function makeSiteRoute(f) {
  return async function analyze(req, res) {
    const b = await readJson(req, 16 * 1024);
    const url = normalizeUrlInput(String(b.url ?? ""));
    if (!url) throw new HttpError(400, { code: "bad_request", message: "That does not look like a web address. Try something like example.com" });
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    const timer = setTimeout(() => ac.abort(), 55e3);
    startStream(res, "ndjson");
    try {
      const result = await analyzeWebsite(url, makeSiteFetcher(f, ac.signal), {
        signal: ac.signal,
        maxAssets: 30,
        onProgress: (p) => {
          if (!res.destroyed) writeLine(res, { type: "progress", ...p });
        }
      });
      writeLine(res, { type: "result", result });
    } catch (e) {
      const blocked = e?.code === "blocked_url";
      const msg = blocked ? String(e.message) : e?.name === "AbortedError" || e?.name === "AbortError" ? "The site took too long to answer." : /ENOTFOUND|EAI_AGAIN/.test(String(e?.code ?? e?.message)) ? "That website address could not be found." : String(e?.message ?? "Could not read that website.").slice(0, 240);
      writeLine(res, { type: "error", error: { code: blocked ? "blocked_url" : "network", message: msg } });
    } finally {
      clearTimeout(timer);
      res.end();
    }
  };
}

// shared/server/router.ts
function createApiHandler(cfg) {
  const aiFetch = cfg.fetcher ?? makeSafeFetch({ allowPrivate: cfg.mode === "local", timeoutMs: 9e4, maxBytes: 16 * 1024 * 1024, ...cfg.safeFetch ?? {} });
  const siteFetch = cfg.fetcher ?? makeSafeFetch({ allowPrivate: !!cfg.siteAllowPrivate, ...cfg.siteAllowPrivate ? {} : { allowedPorts: [80, 443, 8080, 8443] }, timeoutMs: 15e3, maxBytes: 12 * 1024 * 1024 });
  const ai = makeAiRoutes(aiFetch);
  const site = makeSiteRoute(siteFetch);
  const limit = makeLimiter(cfg.ratePerMinute ?? 0);
  return async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/\/+$/, "") || "/";
    if (!path.startsWith("/api")) return false;
    try {
      if (path === "/api/health") {
        sendJson(res, 200, { ok: true, name: "ReverseIt", version: cfg.version, mode: cfg.mode });
        return true;
      }
      if (cfg.extra && await cfg.extra(req, res, path)) return true;
      const post = {
        "/api/ai/detect": ai.detect,
        "/api/ai/models": ai.models,
        "/api/ai/test": ai.test,
        "/api/ai/chat": ai.chat,
        "/api/site/analyze": site
      };
      const h = post[path];
      if (!h) {
        sendJson(res, 404, { error: { code: "bad_request", message: "Unknown endpoint." } });
        return true;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, { error: { code: "bad_request", message: "Use POST." } });
        return true;
      }
      if (!limit(clientIp(req))) throw new HttpError(429, { code: "rate_limited", message: "Too many requests from this address. Wait a minute and try again." });
      await h(req, res);
    } catch (e) {
      sendError(res, e);
    }
    return true;
  };
}

// entries/api.ts
var handler = createApiHandler({ mode: "cloud", version: "1.0.0", ratePerMinute: 40 });
async function api_default(req, res) {
  const done = await handler(req, res);
  if (!done) {
    res.statusCode = 404;
    res.end("Not found");
  }
}
module.exports=module.exports.default||module.exports;
