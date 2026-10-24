/** Shared helpers for the web/text analyzers (fork A2). Isomorphic, no DOM. */

export function safeUrl(u: string, base?: string): URL | null {
  try {
    return base ? new URL(u, base) : new URL(u);
  } catch {
    return null;
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function countMap<T>(items: Iterable<T>, key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function topEntries(m: Map<string, number>, n: number): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

export function uniqueLimited<T>(items: Iterable<T>, max: number): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

/** `${a.b}` → `{b}` ; used for template literals found in code. */
export function templateToPath(raw: string): string {
  return raw.replace(/\$\{\s*([^}]{0,80})\}/g, (_m, inner: string) => {
    const id = /([A-Za-z_$][\w$]*)\s*(?:\)|\]|\?\.?\w*)?\s*$/.exec(inner.trim());
    return `{${id ? id[1] : 'expr'}}`;
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Turn /users/123/orders/9f8e... into /users/:id/orders/:hash. */
export function templatePath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      let s = seg;
      try {
        s = decodeURIComponent(seg);
      } catch {
        /* keep raw */
      }
      if (/^\d+$/.test(s)) return ':id';
      if (UUID_RE.test(s)) return ':uuid';
      if (/^[0-9a-f]{16,}$/i.test(s)) return ':hash';
      if (/^\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]*)?$/.test(s)) return ':date';
      if (s.length >= 22 && /^[A-Za-z0-9_-]+$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s)) return ':token';
      if (s.length >= 8 && /^[A-Za-z0-9_-]+$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 3 && /[A-Za-z]/.test(s)) return ':id';
      if (/^\{[^}]*\}$/.test(s) || s.startsWith(':')) return seg;
      return seg;
    })
    .join('/');
}

// ---- shapes (structure only, never values) ----------------------------------

export type Shape =
  | { t: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { t: 'array'; items: Shape | null; len?: number }
  | { t: 'object'; keys: Record<string, Shape>; more?: number };

const MAX_KEYS = 25;

export function inferShape(value: unknown, depth = 0, maxDepth = 3): Shape {
  if (value === null) return { t: 'null' };
  const ty = typeof value;
  if (ty === 'string' || ty === 'number' || ty === 'boolean') return { t: ty as 'string' | 'number' | 'boolean' };
  if (Array.isArray(value)) {
    if (depth >= maxDepth) return { t: 'array', items: null, len: value.length };
    let merged: Shape | null = null;
    for (const el of value.slice(0, 12)) merged = mergeShapes(merged, inferShape(el, depth + 1, maxDepth));
    return { t: 'array', items: merged, len: value.length };
  }
  if (ty === 'object') {
    const keys: Record<string, Shape> = {};
    const entries = Object.keys(value as object);
    const lim = entries.slice(0, MAX_KEYS);
    for (const k of lim) keys[k] = depth >= maxDepth ? { t: 'unknown' } : inferShape((value as any)[k], depth + 1, maxDepth);
    return { t: 'object', keys, ...(entries.length > lim.length ? { more: entries.length - lim.length } : {}) };
  }
  return { t: 'unknown' };
}

export function mergeShapes(a: Shape | null, b: Shape): Shape {
  if (!a) return b;
  if (a.t !== b.t) return { t: 'unknown' };
  if (a.t === 'array' && b.t === 'array') return { t: 'array', items: a.items && b.items ? mergeShapes(a.items, b.items) : (a.items ?? b.items), len: Math.max(a.len ?? 0, b.len ?? 0) };
  if (a.t === 'object' && b.t === 'object') {
    const keys: Record<string, Shape> = { ...a.keys };
    for (const [k, v] of Object.entries(b.keys)) keys[k] = keys[k] ? mergeShapes(keys[k], v) : v;
    return { t: 'object', keys };
  }
  return a;
}

export function shapeToString(s: Shape | null, max = 400): string {
  const out = render(s);
  return truncate(out, max);
}

function render(s: Shape | null): string {
  if (!s) return 'unknown';
  switch (s.t) {
    case 'array':
      return (s.items ? (s.items.t === 'object' ? `${render(s.items)}` : render(s.items)) : 'unknown') + '[]';
    case 'object': {
      const parts = Object.entries(s.keys).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${render(v)}`);
      if (s.more) parts.push(`…+${s.more}`);
      return `{ ${parts.join(', ')} }`;
    }
    default:
      return s.t;
  }
}

/** Dotted key paths (bounded) for an inferred shape. */
export function shapePaths(s: Shape, prefix = '', out: string[] = [], max = 80): string[] {
  if (out.length >= max) return out;
  if (s.t === 'object') {
    for (const [k, v] of Object.entries(s.keys)) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(`${p}: ${v.t === 'array' ? 'array' : v.t}`);
      if (out.length >= max) return out;
      if (v.t === 'object') shapePaths(v, p, out, max);
      else if (v.t === 'array' && v.items && v.items.t === 'object') shapePaths(v.items, p + '[]', out, max);
    }
  }
  return out;
}

// ---- hosts -------------------------------------------------------------------

const HOST_CATEGORIES: [RegExp, string][] = [
  [/(^|\.)(google-analytics|googletagmanager|analytics\.google|segment\.(io|com)|cdn\.segment|mixpanel|amplitude|posthog|plausible|matomo|heap(analytics)?|hotjar|clarity\.ms|fullstory|mouseflow|statcounter|umami|fathom|simpleanalytics)\./i, 'analytics'],
  [/(^|\.)(sentry\.io|ingest\.sentry|datadoghq|datadog|logrocket|bugsnag|rollbar|newrelic|nr-data|honeybadger|raygun|trackjs|elastic-apm)\./i, 'monitoring'],
  [/(^|\.)(doubleclick|googlesyndication|googleadservices|adservice\.google|adnxs|criteo|taboola|outbrain|facebook\.net|connect\.facebook|ads-twitter|snap\.licdn|linkedin\.com\/px|tiktok\.com|pinterest\.com\/ct|amazon-adsystem)/i, 'ads'],
  [/(^|\.)(stripe\.com|js\.stripe|paypal|paypalobjects|braintree|razorpay|checkout\.com|adyen|squareup|klarna|paddle|lemonsqueezy)\./i, 'payments'],
  [/(^|\.)(auth0\.com|clerk\.(com|dev|accounts)|okta|firebaseapp|identitytoolkit|cognito|accounts\.google|login\.microsoftonline|supabase\.(co|com|io)|workos)\./i, 'auth'],
  [/(^|\.)(cloudflare|cloudfront|fastly|akamai|jsdelivr|unpkg|cdnjs|bootstrapcdn|azureedge|bunnycdn|b-cdn|stackpath|vercel\.app|netlify\.app|imgix|cloudinary|imagekit)/i, 'cdn'],
  [/(^|\.)(fonts\.googleapis|fonts\.gstatic|use\.typekit|use\.fontawesome|fontawesome|fonts\.bunny)/i, 'fonts'],
  [/(^|\.)(maps\.googleapis|maps\.google|mapbox|tile\.openstreetmap|here\.com|arcgis)/i, 'maps'],
  [/(^|\.)(intercom|drift|crisp\.chat|zendesk|freshchat|tawk\.to|hubspot|helpscout|livechat)/i, 'chat'],
  [/(^|\.)(youtube|youtu\.be|vimeo|twitter|x\.com|facebook|instagram|linkedin|tiktok|reddit)\./i, 'social'],
  [/(^|\.)(openai\.com|anthropic\.com|generativelanguage\.googleapis|api\.mistral|groq\.com|openrouter\.ai|huggingface\.co|replicate\.com)/i, 'ai'],
  [/(^|\.)(firebaseio|firestore\.googleapis|supabase|amazonaws\.com|appspot\.com|herokuapp|railway\.app|fly\.dev|render\.com)/i, 'backend'],
];

export function hostCategory(host: string): string | undefined {
  const h = host.toLowerCase() + '.';
  for (const [re, cat] of HOST_CATEGORIES) if (re.test(h) || re.test(host.toLowerCase())) return cat;
  return undefined;
}

const TWO_PART_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.in', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.cn', 'com.mx', 'com.tr']);

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (TWO_PART_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

export function isFirstParty(host: string, siteHost: string): boolean {
  return registrableDomain(host) === registrableDomain(siteHost);
}

/** Parse a JSON string with a few tolerances (BOM, comments, trailing commas). Returns undefined on failure. */
export function parseJsonLoose(text: string): unknown | undefined {
  const t = text.replace(/^﻿/, '');
  try {
    return JSON.parse(t);
  } catch {
    /* try tolerant */
  }
  try {
    let out = '';
    let i = 0;
    let inStr = false;
    let q = '';
    while (i < t.length) {
      const c = t[i];
      if (inStr) {
        out += c;
        if (c === '\\') {
          out += t[i + 1] ?? '';
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
      if (c === '/' && t[i + 1] === '/') {
        while (i < t.length && t[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && t[i + 1] === '*') {
        i += 2;
        while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return undefined;
  }
}

export function lang(path: string): string {
  const m = /\.([A-Za-z0-9]+)(?:\?.*)?$/.exec(path);
  const ext = (m?.[1] ?? '').toLowerCase();
  const map: Record<string, string> = {
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript (JSX)', ts: 'TypeScript', tsx: 'TypeScript (TSX)', vue: 'Vue', svelte: 'Svelte',
    css: 'CSS', scss: 'Sass', sass: 'Sass', less: 'Less', html: 'HTML', json: 'JSON', md: 'Markdown', py: 'Python', rs: 'Rust', go: 'Go', java: 'Java',
    kt: 'Kotlin', swift: 'Swift', dart: 'Dart', rb: 'Ruby', php: 'PHP', c: 'C', cc: 'C++', cpp: 'C++', h: 'C/C++ header', cs: 'C#', graphql: 'GraphQL', gql: 'GraphQL',
    svg: 'SVG', png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image', woff: 'Font', woff2: 'Font', ttf: 'Font', yml: 'YAML', yaml: 'YAML',
  };
  return map[ext] ?? (ext ? ext.toUpperCase() : 'Other');
}
