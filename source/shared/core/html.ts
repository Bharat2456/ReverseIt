import type { AnalysisPart, Finding, TextCtx } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, table, tags, fmtBytes } from './sections';
import { safeUrl, truncate } from './webutil';

export interface HtmlInventory {
  title: string;
  lang: string | null;
  meta: Record<string, string>;
  links: { rel: string; href: string; as?: string }[];
  scripts: { src: string | null; type: string; async: boolean; defer: boolean; inlineBytes: number }[];
  styleSheets: string[];
  inlineStyleBytes: number;
  images: { total: number; missingAlt: number; srcs: string[] };
  iframes: string[];
  media: string[];
  forms: { action: string; method: string; inputs: { name: string; type: string }[] }[];
  headings: { level: number; text: string }[];
  anchors: { total: number; internal: number; external: number; sample: string[] };
  inlineHandlers: number;
  jsonLd: string[];
  base: string | null;
  frameworks: string[];
  landmarks: string[];
  noscript: boolean;
  bytes: number;
  inlineScripts: string[];
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(s)) && n++ < 60) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const strip = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function parseHtml(html: string, baseUrl?: string): HtmlInventory {
  const src = html.length > 8_000_000 ? html.slice(0, 8_000_000) : html;
  const inv: HtmlInventory = { title: '', lang: null, meta: {}, links: [], scripts: [], styleSheets: [], inlineStyleBytes: 0, images: { total: 0, missingAlt: 0, srcs: [] }, iframes: [], media: [], forms: [], headings: [], anchors: { total: 0, internal: 0, external: 0, sample: [] }, inlineHandlers: 0, jsonLd: [], base: null, frameworks: [], landmarks: [], noscript: false, bytes: html.length, inlineScripts: [] };
  const resolve = (u: string | undefined | null) => {
    if (!u) return '';
    const r = safeUrl(u, inv.base ?? baseUrl);
    return r ? r.href : u;
  };
  const baseHost = baseUrl ? safeUrl(baseUrl)?.host : undefined;
  const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m: RegExpExecArray | null;
  let formIdx = -1;
  const landmarks = new Set<string>();
  let guard = 0;
  while ((m = tagRe.exec(src)) && guard++ < 400000) {
    if (m[0].startsWith('<!--')) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (closing) {
      if (tag === 'form') formIdx = -1;
      continue;
    }
    const a = parseAttrs(m[3]);
    for (const k in a) if (k.length > 2 && k.startsWith('on')) inv.inlineHandlers++;
    if (tag === 'script' || tag === 'style') {
      const end = src.toLowerCase().indexOf('</' + tag, tagRe.lastIndex);
      const body = end === -1 ? src.slice(tagRe.lastIndex) : src.slice(tagRe.lastIndex, end);
      if (tag === 'script') {
        const type = (a.type ?? '').toLowerCase();
        if (type === 'application/ld+json') inv.jsonLd.push(truncate(body.trim(), 4000));
        else {
          inv.scripts.push({ src: a.src ? resolve(a.src) : null, type: type || 'classic', async: 'async' in a, defer: 'defer' in a, inlineBytes: a.src ? 0 : body.length });
          if (!a.src && body.length > 40 && inv.inlineScripts.length < 20) inv.inlineScripts.push(body.length > 400000 ? body.slice(0, 400000) : body);
        }
      } else inv.inlineStyleBytes += body.length;
      tagRe.lastIndex = end === -1 ? src.length : end;
      continue;
    }
    switch (tag) {
      case 'html':
        inv.lang = a.lang ?? null;
        break;
      case 'base':
        if (a.href) inv.base = resolve(a.href);
        break;
      case 'meta': {
        const key = (a.name ?? a.property ?? a['http-equiv'] ?? '').toLowerCase();
        if (key && a.content !== undefined && Object.keys(inv.meta).length < 80) inv.meta[key] = truncate(a.content, 240);
        if (a.charset) inv.meta.charset = a.charset;
        break;
      }
      case 'link': {
        const rel = (a.rel ?? '').toLowerCase();
        if (rel.includes('stylesheet') && a.href) inv.styleSheets.push(resolve(a.href));
        if (inv.links.length < 120 && a.href) inv.links.push({ rel, href: resolve(a.href), ...(a.as ? { as: a.as } : {}) });
        break;
      }
      case 'img':
        inv.images.total++;
        if (a.alt === undefined) inv.images.missingAlt++;
        if (inv.images.srcs.length < 60 && (a.src || a['data-src'])) inv.images.srcs.push(resolve(a.src ?? a['data-src']));
        break;
      case 'iframe':
        if (a.src && inv.iframes.length < 30) inv.iframes.push(resolve(a.src));
        break;
      case 'video':
      case 'audio':
      case 'source':
        if (a.src && inv.media.length < 30) inv.media.push(resolve(a.src));
        break;
      case 'form':
        inv.forms.push({ action: resolve(a.action) || '(same page)', method: (a.method ?? 'get').toLowerCase(), inputs: [] });
        formIdx = inv.forms.length - 1;
        break;
      case 'input':
      case 'select':
      case 'textarea':
        if (formIdx >= 0 && inv.forms[formIdx].inputs.length < 40) inv.forms[formIdx].inputs.push({ name: a.name ?? a.id ?? '(unnamed)', type: tag === 'input' ? (a.type ?? 'text') : tag });
        break;
      case 'a':
        inv.anchors.total++;
        if (a.href && !/^(#|javascript:|mailto:|tel:)/i.test(a.href)) {
          const u = safeUrl(a.href, inv.base ?? baseUrl);
          if (u && baseHost && u.host !== baseHost) inv.anchors.external++;
          else inv.anchors.internal++;
          if (inv.anchors.sample.length < 40) inv.anchors.sample.push(u ? u.href : a.href);
        }
        break;
      case 'noscript':
        inv.noscript = true;
        break;
      case 'nav':
      case 'main':
      case 'header':
      case 'footer':
      case 'aside':
      case 'article':
      case 'section':
        landmarks.add(tag);
        break;
    }
    if (a.role) landmarks.add(`role=${a.role}`);
  }
  inv.landmarks = [...landmarks].slice(0, 20);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  inv.title = t ? truncate(strip(t[1]), 200) : '';
  const hre = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let h: RegExpExecArray | null;
  while ((h = hre.exec(src)) && inv.headings.length < 40) {
    const text = strip(h[2]);
    if (text) inv.headings.push({ level: +h[1], text: truncate(text, 120) });
  }
  const fw: [string, string][] = [['data-reactroot', 'React'], ['__NEXT_DATA__', 'Next.js'], ['id="__nuxt"', 'Nuxt'], ['__NUXT__', 'Nuxt'], ['ng-version', 'Angular'], ['data-v-', 'Vue'], ['x-data=', 'Alpine.js'], ['hx-get', 'htmx'], ['hx-post', 'htmx'], ['data-svelte', 'Svelte'], ['astro-island', 'Astro'], ['data-turbo', 'Hotwire Turbo'], ['wp-content', 'WordPress'], ['cdn.shopify.com', 'Shopify'], ['data-wf-page', 'Webflow'], ['___gatsby', 'Gatsby'], ['id="root"', 'React-style root element'], ['id="app"', 'Vue-style root element']];
  for (const [needle, name] of fw) if (src.includes(needle) && !inv.frameworks.includes(name)) inv.frameworks.push(name);
  return inv;
}

export function inventorySections(inv: HtmlInventory, rowMax = 200) {
  return [
    kv('Page', { Title: inv.title || null, Language: inv.lang, Description: inv.meta.description ?? inv.meta['og:description'] ?? null, 'Social title': inv.meta['og:title'] ?? null, 'Theme colour': inv.meta['theme-color'] ?? null, Generator: inv.meta.generator ?? null, Size: fmtBytes(inv.bytes), 'Needs JavaScript?': inv.noscript || inv.scripts.length > 3 ? 'yes (uses scripts heavily)' : 'mostly not' }),
    tags('Frameworks hinted by the HTML', inv.frameworks.map((f) => ({ label: f, tone: 'cyan' as const }))),
    list('Headings outline', inv.headings.map((h) => `${'  '.repeat(h.level - 1)}H${h.level}  ${h.text}`)),
    table('Scripts', ['Source', 'Type', 'Loading', 'Inline size'], inv.scripts.map((s) => [s.src ?? '(inline)', s.type, s.async ? 'async' : s.defer ? 'defer' : 'blocking', s.inlineBytes || null]), rowMax),
    list('Stylesheets', inv.styleSheets),
    table('Forms (field names only, never values)', ['Action', 'Method', 'Fields'], inv.forms.map((f) => [f.action, f.method, f.inputs.map((i) => `${i.name}:${i.type}`).join(', ')]), rowMax),
    list('Embedded frames', inv.iframes),
    kv('Content counts', { Images: inv.images.total, 'Images without alt text': inv.images.missingAlt, Links: inv.anchors.total, 'Internal links': inv.anchors.internal, 'External links': inv.anchors.external, 'Inline event handlers': inv.inlineHandlers, 'Inline style size': fmtBytes(inv.inlineStyleBytes) }),
    list('Landmarks', inv.landmarks),
    list('Preload / connect hints', inv.links.filter((l) => /preload|prefetch|preconnect|dns-prefetch|manifest|icon|canonical|alternate/.test(l.rel)).map((l) => `${l.rel}: ${l.href}`)),
    list('Structured data (JSON-LD, first 4000 chars each)', inv.jsonLd),
  ];
}

export function htmlFindings(inv: HtmlInventory): Finding[] {
  const f: Finding[] = [];
  if (!inv.meta.viewport) f.push(finding('No viewport tag', 'notice', 'The page may not scale correctly on phones.'));
  if (!inv.lang) f.push(finding('No language set on <html>', 'notice'));
  if (inv.images.total && inv.images.missingAlt / inv.images.total > 0.3) f.push(finding(`${inv.images.missingAlt} images have no alt text`, 'notice', 'Screen readers cannot describe them.', ['accessibility']));
  if (inv.inlineHandlers > 5) f.push(finding(`${inv.inlineHandlers} inline event handlers`, 'notice', 'Inline onclick-style attributes make a strict Content-Security-Policy impossible.'));
  if (inv.forms.some((x) => /^http:/.test(x.action))) f.push(finding('A form posts over plain HTTP', 'warning'));
  return f;
}

export async function analyzeHtml(ctx: TextCtx): Promise<AnalysisPart> {
  const inv = parseHtml(ctx.text, ctx.target.url);
  return {
    evidence: [
      makeEvidence({
        operation: 'analyze_html',
        title: `Page: ${ctx.path ?? ctx.name}`,
        target: ctx.target,
        summary: `HTML page${inv.title ? ` "${inv.title}"` : ''} with ${inv.scripts.length} scripts, ${inv.styleSheets.length} stylesheets, ${inv.forms.length} forms and ${inv.images.total} images${inv.frameworks.length ? `; hints of ${inv.frameworks.slice(0, 3).join(', ')}` : ''}.`,
        normalized_result: { title: inv.title, lang: inv.lang, meta: inv.meta, scripts: inv.scripts.map((s) => s.src ?? '(inline)').slice(0, 100), stylesheets: inv.styleSheets.slice(0, 100), forms: inv.forms.slice(0, 40), headings: inv.headings, frameworks: inv.frameworks, images: { total: inv.images.total, missing_alt: inv.images.missingAlt }, anchors: { total: inv.anchors.total, internal: inv.anchors.internal, external: inv.anchors.external }, inline_handlers: inv.inlineHandlers, json_ld_blocks: inv.jsonLd.length },
        sections: inventorySections(inv, ctx.opts.maxRows),
        findings: htmlFindings(inv),
        coverage: { status: 'partial', notes: ['Static markup only: content rendered by JavaScript after load is not in this file.'] },
        limitations: ['Parsed without running the page, so elements created by scripts are missing.'],
      }),
    ],
  };
}
