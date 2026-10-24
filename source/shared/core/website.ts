import type { AnalysisResult, Evidence, RecoveredFile, SiteFetcher, TargetRef, Unknown, WebsiteOptions } from './types';
import { makeEvidence } from './evidence';
import { resolveOptions, throwIfAborted, yieldToUi } from './options';
import { finding, kv, list, table, tags, fmtBytes } from './sections';
import { decodeUtf8 } from './bytes';
import { sha256Hex } from './hash';
import { parseHtml, inventorySections, htmlFindings } from './html';
import { extractDesignTokens, tokensToSections, paletteRoles } from './css';
import { extractJsFacts, mergeJsFacts, factsToSections, factsToFindings, factsToGraph, techTags, type JsFacts } from './javascript';
import { parseSourceMap, mapToRecovered } from './sourcemap';
import { detectTech } from './techfp';
import { hostCategory, isFirstParty, registrableDomain, safeUrl, truncate } from './webutil';
import { mergeGraphs } from './graph';
import { parseJsonLoose } from './webutil';

export function normalizeUrlInput(input: string): string | null {
  let s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(s) ? 'http://' : 'https://') + s;
  const u = safeUrl(s);
  if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
  u.hash = '';
  return u.href;
}

const SEC_HEADERS: [string, string][] = [
  ['strict-transport-security', 'Forces HTTPS (HSTS)'],
  ['content-security-policy', 'Limits what scripts can run (CSP)'],
  ['x-content-type-options', 'Stops MIME sniffing'],
  ['x-frame-options', 'Blocks clickjacking frames'],
  ['referrer-policy', 'Controls referrer leakage'],
  ['permissions-policy', 'Limits browser features'],
];

export async function analyzeWebsite(urlIn: string, fetcher: SiteFetcher, options: WebsiteOptions = {}): Promise<AnalysisResult> {
  const t0 = Date.now();
  const opts = resolveOptions(options);
  const maxAssets = options.maxAssets ?? 40;
  const maxAssetBytes = options.maxAssetBytes ?? 4 * 1024 * 1024;
  const wantMaps = options.fetchSourceMaps ?? true;
  const url = normalizeUrlInput(urlIn);
  if (!url) throw new Error('That does not look like a web address. Try something like example.com');
  const progress = (phase: string, pct: number, message?: string) => opts.onProgress({ phase, pct, message });
  progress('fetch', 3, 'Opening the page');
  const page = await fetcher(url, { accept: 'text/html,application/xhtml+xml,*/*;q=0.5', maxBytes: 6 * 1024 * 1024 });
  throwIfAborted(opts.signal);
  const html = decodeUtf8(page.body);
  const finalUrl = page.finalUrl || url;
  const host = safeUrl(finalUrl)?.host ?? '';
  const target: TargetRef = { name: host, kind: 'website', url: finalUrl, size: page.body.length, sha256: await sha256Hex(page.body), format: 'website' };
  const inv = parseHtml(html, finalUrl);
  const evidence: Evidence[] = [];
  const recovered: RecoveredFile[] = [{ path: 'index.html', kind: 'source', size: html.length, text: html.slice(0, 2_000_000), origin: 'website' }];
  const unknowns: Unknown[] = [];
  const limits: string[] = [];
  if (page.status >= 400) limits.push(`The site answered with status ${page.status}; the page may be an error or a block page.`);

  // --- assets
  const jsUrls = [...new Set(inv.scripts.map((s) => s.src).filter((s): s is string => !!s))];
  const cssUrls = [...new Set(inv.styleSheets)];
  const queue = [...jsUrls.map((u) => ({ u, k: 'js' as const })), ...cssUrls.map((u) => ({ u, k: 'css' as const }))].filter((a) => /^https?:/i.test(a.u));
  queue.sort((a, b) => Number(isFirstParty(safeUrl(b.u)?.host ?? '', host)) - Number(isFirstParty(safeUrl(a.u)?.host ?? '', host)));
  const todo = queue.slice(0, maxAssets);
  if (queue.length > maxAssets) limits.push(`Only the first ${maxAssets} of ${queue.length} scripts/styles were downloaded.`);
  const jsFacts: JsFacts[] = [];
  const cssTokens: ReturnType<typeof extractDesignTokens>[] = [];
  const jsTexts: string[] = [];
  const mapUrls: string[] = [];
  const failed: string[] = [];
  let done = 0, assetBytes = 0, usedRecovered = 0;
  for (const a of todo) {
    throwIfAborted(opts.signal);
    progress('assets', 10 + Math.round((done++ / Math.max(1, todo.length)) * 55), `Reading ${truncate(a.u, 70)}`);
    try {
      const r = await fetcher(a.u, { accept: '*/*', maxBytes: maxAssetBytes });
      if (r.status >= 400) { failed.push(a.u); continue; }
      const text = decodeUtf8(r.body);
      assetBytes += r.body.length;
      const rel = (safeUrl(a.u)?.pathname ?? a.u).replace(/^\/+/, '') || 'asset';
      if (usedRecovered + text.length <= opts.maxRecoveredBytes) { usedRecovered += text.length; recovered.push({ path: rel, kind: 'source', size: text.length, text, origin: 'website' }); }
      if (a.k === 'js') {
        jsTexts.push(text.slice(0, 600_000));
        const f = await extractJsFacts(text, rel, opts.signal);
        jsFacts.push(f);
        for (const m of f.sourceMapUrls) { const abs = safeUrl(m, a.u)?.href; if (abs && /^https?:/.test(abs)) mapUrls.push(abs); }
        if (f.sourceMapUrls.length === 0 && wantMaps) mapUrls.push(a.u + '.map');
      } else cssTokens.push(extractDesignTokens(text));
    } catch (e: any) {
      if (e?.name === 'AbortedError') throw e;
      failed.push(a.u);
    }
    await yieldToUi();
  }
  for (const s of inv.inlineScripts) { jsFacts.push(await extractJsFacts(s, 'inline', opts.signal)); jsTexts.push(s.slice(0, 200_000)); }
  if (inv.inlineStyleBytes) { /* inline styles are part of html tokens */ }
  const htmlCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  if (htmlCss) cssTokens.push(extractDesignTokens(htmlCss));

  // --- source maps
  let mapFiles = 0;
  let mapNote = '';
  if (wantMaps) {
    progress('maps', 70, 'Looking for source maps');
    const tried = [...new Set(mapUrls)].slice(0, 6);
    for (const mu of tried) {
      throwIfAborted(opts.signal);
      try {
        const r = await fetcher(mu, { accept: 'application/json,*/*', maxBytes: 12 * 1024 * 1024 });
        if (r.status >= 400) continue;
        const pm = parseSourceMap(decodeUtf8(r.body));
        if (!pm) continue;
        const rf = mapToRecovered(pm, Math.max(0, opts.maxRecoveredBytes - usedRecovered));
        usedRecovered += rf.bytes;
        recovered.push(...rf.files.map((f) => ({ ...f, path: 'sourcemap/' + f.path })));
        mapFiles += rf.files.length;
        for (const f of rf.files.slice(0, 80)) if (/\.[mc]?[jt]sx?$/.test(f.path) && !/node_modules/.test(f.path) && f.text) jsFacts.push(await extractJsFacts(f.text, f.path, opts.signal));
      } catch (e: any) { if (e?.name === 'AbortedError') throw e; }
    }
    mapNote = mapFiles ? `Original source code for ${mapFiles} files was recovered from published source maps.` : 'No public source maps were found, so original (un-minified) code could not be recovered.';
    if (!mapFiles) unknowns.push({ id: 'unk_sourcemaps', question: 'The original source code is not published. How is the app structured internally?', domain: 'website', status: 'open' });
  }

  // --- side files
  progress('files', 78, 'Checking manifest, robots and sitemap');
  const origin = safeUrl(finalUrl)?.origin ?? '';
  const side: Record<string, string | null> = {};
  for (const p of ['/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/.well-known/security.txt']) {
    try {
      const r = await fetcher(origin + p, { accept: '*/*', maxBytes: 400_000 });
      side[p] = r.status < 400 && !/^\s*<!doctype html/i.test(decodeUtf8(r.body.subarray(0, 200))) ? decodeUtf8(r.body) : null;
    } catch (e: any) { if (e?.name === 'AbortedError') throw e; side[p] = null; }
  }
  const manifestLink = inv.links.find((l) => l.rel.includes('manifest'))?.href;
  if (manifestLink && !side['/manifest.webmanifest']) {
    try { const r = await fetcher(manifestLink, { maxBytes: 200_000 }); if (r.status < 400) side['/manifest.webmanifest'] = decodeUtf8(r.body); } catch (e: any) { if (e?.name === 'AbortedError') throw e; }
  }
  const sitemapUrls = [...(side['/sitemap.xml'] ?? '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
  const disallow = [...(side['/robots.txt'] ?? '').matchAll(/^\s*disallow:\s*(\S+)/gim)].map((m) => m[1]);
  const manifest: any = side['/manifest.webmanifest'] ? parseJsonLoose(side['/manifest.webmanifest']!) : undefined;

  // --- merge + tech
  progress('analysis', 88, 'Putting it together');
  const facts = mergeJsFacts(jsFacts);
  const tech = detectTech({ urls: [finalUrl, ...jsUrls, ...cssUrls], headers: Object.fromEntries(Object.entries(page.headers).map(([k, v]) => [k, v])), html, scripts: jsTexts.slice(0, 30), cookies: (page.headers['set-cookie'] ?? '').split(/,(?=\s*[\w-]+=)/).map((c) => c.split('=')[0].trim().toLowerCase()) });
  const allTech = [...new Map([...tech, ...facts.tech].map((t) => [t.name, t])).values()];
  // merge CSS tokens by summing colour counts
  const mergedColors = new Map<string, number>();
  const mergedFonts = new Map<string, number>();
  const vars = new Map<string, string>();
  const bps = new Set<string>();
  const kfs = new Set<string>();
  for (const t of cssTokens) {
    t.colors.forEach((c) => mergedColors.set(c.value, (mergedColors.get(c.value) ?? 0) + c.count));
    t.fonts.forEach((c) => mergedFonts.set(c.family, (mergedFonts.get(c.family) ?? 0) + c.count));
    t.variables.forEach((v) => !vars.has(v.name) && vars.set(v.name, v.value));
    t.breakpoints.forEach((b) => bps.add(b)); t.keyframes.forEach((k) => kfs.add(k));
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
    usesFlex: cssTokens.some((t) => t.usesFlex), usesGrid: cssTokens.some((t) => t.usesGrid),
    utilityDensity: Math.max(...cssTokens.map((t) => t.utilityDensity)),
    bytes: cssTokens.reduce((a, t) => a + t.bytes, 0),
  } : null;

  // third parties
  const thirdHosts = new Map<string, string>();
  for (const u of [...jsUrls, ...cssUrls, ...inv.iframes, ...inv.images.srcs, ...facts.endpoints.map((e) => e.url)]) {
    const h = safeUrl(u, finalUrl)?.host;
    if (h && !isFirstParty(h, host)) thirdHosts.set(h, hostCategory(h) ?? 'external service');
  }
  const headerRows = SEC_HEADERS.map(([h, why]) => [h, page.headers[h] ? truncate(page.headers[h], 120) : 'missing', why]);
  const missing = SEC_HEADERS.filter(([h]) => !page.headers[h]).map(([h]) => h);
  const hf = [...htmlFindings(inv), ...factsToFindings(facts, 'This site')];
  if (missing.length >= 4) hf.push(finding(`${missing.length} common security headers are missing`, 'notice', missing.join(', ')));

  const summary = `${inv.title || host}: ${allTech.filter((t) => t.confidence !== 'low').slice(0, 4).map((t) => t.name).join(', ') || 'technology not identified'}; ${jsUrls.length} scripts, ${cssUrls.length} stylesheets, ${facts.endpoints.length} API endpoints found${mapFiles ? `, ${mapFiles} original source files recovered` : ''}.`;
  const rootLabel = host;
  const g = factsToGraph(facts, 'site', rootLabel, 'entry');
  for (const [h, cat] of [...thirdHosts.entries()].slice(0, 10)) { g.nodes.push({ id: 'ext:' + h, label: h, group: 'service', weight: 3, detail: cat }); g.edges.push({ from: 'site', to: 'ext:' + h, label: 'uses' }); }

  const sections = [
    kv('Site at a glance', { Address: finalUrl, Status: page.status, Server: page.headers.server ?? null, Powered: page.headers['x-powered-by'] ?? null, 'Page size': fmtBytes(page.body.length), 'Scripts downloaded': jsTexts.length, 'Script data read': fmtBytes(assetBytes), 'Source maps': mapFiles ? `${mapFiles} files recovered` : 'none public', 'Installable app (PWA)': manifest ? 'yes' : 'no' }),
    techTags(allTech),
    ...inventorySections(inv, opts.maxRows),
    ...(design ? tokensToSections(design, opts.maxRows) : []),
    ...factsToSections(facts, opts.maxRows),
    table('Security headers', ['Header', 'Value', 'Purpose'], headerRows),
    table('Third-party services', ['Host', 'Kind'], [...thirdHosts.entries()].map(([h, c]) => [h, c]), opts.maxRows),
    list('Sitemap pages', sitemapUrls),
    list('Paths the site asks robots to skip', disallow),
    list('Assets that could not be downloaded', failed),
  ];
  const roles = design ? paletteRoles(design.colors) : {};
  evidence.push(makeEvidence({
    operation: 'inspect_website',
    title: `Website: ${host}`,
    target,
    summary,
    normalized_result: {
      url: finalUrl, status: page.status, title: inv.title, description: inv.meta.description ?? null,
      technologies: allTech.slice(0, 40).map((t) => ({ name: t.name, category: t.category, confidence: t.confidence })),
      scripts: jsUrls.slice(0, 80), stylesheets: cssUrls.slice(0, 40), forms: inv.forms.slice(0, 20),
      endpoints: facts.endpoints.slice(0, 150).map((e) => ({ url: e.url, method: e.method, via: e.via })),
      routes: facts.routes.slice(0, 100), env_vars: facts.envVars.slice(0, 60), storage_keys: facts.storageKeys.slice(0, 60).map((k) => `${k.kind}:${k.key}`), websockets: facts.websockets,
      design: design ? { colors: design.colors.slice(0, 16).map((c) => c.value), fonts: design.fonts.map((f) => f.family), roles, breakpoints: design.breakpoints, variables: design.variables.slice(0, 60) } : null,
      third_parties: Object.fromEntries(thirdHosts), security_headers_missing: missing, source_maps_recovered: mapFiles,
      manifest: manifest && typeof manifest === 'object' ? { name: (manifest as any).name, theme_color: (manifest as any).theme_color, display: (manifest as any).display } : null,
      sitemap_count: sitemapUrls.length,
      secrets: facts.secrets.map((s) => ({ kind: s.kind, preview: s.preview })),
    },
    sections,
    findings: hf,
    graph: g,
    coverage: { status: 'partial', notes: [mapNote, ...limits].filter(Boolean) },
    limitations: [
      'Only the public front end was read. Server code, databases and anything behind login cannot be seen from outside.',
      'Content created by JavaScript after the page loads is not captured because the page was not run in a browser.',
      ...limits,
    ],
  }));
  progress('done', 100, 'Done');
  return { target, evidence, unknowns, recovered, recoveredTruncated: usedRecovered >= opts.maxRecoveredBytes, stats: { durationMs: Date.now() - t0, analyzers: ['inspect_website'], bytes: page.body.length + assetBytes } };
}
