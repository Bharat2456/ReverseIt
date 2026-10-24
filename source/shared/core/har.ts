import type { AnalysisPart, TextCtx, Finding } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, table, list, bars, fmtBytes } from './sections';
import { detectTech } from './techfp';
import { hostCategory, inferShape, mergeShapes, parseJsonLoose, safeUrl, shapeToString, templatePath, truncate, type Shape } from './webutil';
import { techTags } from './javascript';
import { scanSecrets } from './secrets';

const SENSITIVE = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/i;

export async function analyzeHar(ctx: TextCtx): Promise<AnalysisPart> {
  const j: any = parseJsonLoose(ctx.text);
  const entries: any[] = j?.log?.entries ?? [];
  if (!Array.isArray(entries) || !entries.length) {
    return { evidence: [makeEvidence({ operation: 'analyze_har', title: 'Network capture', target: ctx.target, summary: 'HAR file has no recorded requests.', normalized_result: {}, sections: [], coverage: { status: 'partial' }, limitations: ['Empty or malformed HAR.'] })] };
  }
  const hosts = new Map<string, number>();
  const eps = new Map<string, { method: string; host: string; path: string; count: number; statuses: Set<number>; mime: string; shape: Shape | null; auth: boolean; bytes: number }>();
  const types = new Map<string, number>();
  const authHeaders = new Set<string>();
  const cookieNames = new Set<string>();
  const urls: string[] = [];
  const headerBag: Record<string, string> = {};
  const secrets: { kind: string; preview: string; where: string }[] = [];
  let total = 0, slow = 0, failed = 0, thirdParty = 0;
  const first = safeUrl(entries[0]?.request?.url ?? '')?.host ?? '';
  for (const e of entries) {
    const u = safeUrl(e?.request?.url ?? '');
    if (!u) continue;
    urls.push(u.href);
    hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
    const method = String(e.request.method ?? 'GET').toUpperCase();
    const mime = String(e.response?.content?.mimeType ?? '').split(';')[0] || 'unknown';
    types.set(mime, (types.get(mime) ?? 0) + 1);
    const status = Number(e.response?.status ?? 0);
    if (status >= 400 || status === 0) failed++;
    if ((e.time ?? 0) > 1500) slow++;
    const size = Math.max(0, Number(e.response?.content?.size ?? e.response?.bodySize ?? 0));
    total += size;
    if (u.host !== first && hostCategory(u.host)) thirdParty++;
    let auth = false;
    for (const h of e.request.headers ?? []) {
      if (SENSITIVE.test(h.name)) { authHeaders.add(h.name.toLowerCase()); auth = true; }
    }
    for (const c of e.request.cookies ?? []) cookieNames.add(c.name);
    for (const h of e.response?.headers ?? []) if (!SENSITIVE.test(h.name) && Object.keys(headerBag).length < 80) headerBag[String(h.name).toLowerCase()] = String(h.value).slice(0, 200);
    const isApi = /json|xml|graphql|protobuf|event-stream/.test(mime) || method !== 'GET' || /\/(api|graphql|v\d)\b/.test(u.pathname);
    if (!isApi) continue;
    const path = templatePath(u.pathname);
    const key = `${method} ${u.host}${path}`;
    let ep = eps.get(key);
    if (!ep) eps.set(key, (ep = { method, host: u.host, path, count: 0, statuses: new Set(), mime, shape: null, auth, bytes: 0 }));
    ep.count++; ep.statuses.add(status); ep.bytes += size; ep.auth ||= auth;
    const body = e.response?.content?.text;
    if (typeof body === 'string' && /json/.test(mime) && body.length < 400000) {
      const v = parseJsonLoose(e.response.content.encoding === 'base64' ? '' : body);
      if (v !== undefined) ep.shape = mergeShapes(ep.shape, inferShape(v));
      for (const s of scanSecrets(body.slice(0, 200000), 3)) secrets.push({ kind: s.kind, preview: s.preview, where: `${method} ${u.host}${path} (response)` });
    }
  }
  const tech = detectTech({ urls, headers: headerBag });
  const epList = [...eps.values()].sort((a, b) => b.count - a.count);
  const findings: Finding[] = [];
  if (authHeaders.size) findings.push(finding('Requests carry credentials', 'notice', `Headers seen: ${[...authHeaders].join(', ')}. Values were not stored.`));
  if (secrets.length) findings.push(finding(`${secrets.length} possible secret(s) in responses`, 'risk', 'Values are masked. Rotate them if they are real.'));
  if (failed > entries.length * 0.2) findings.push(finding(`${failed} requests failed or errored`, 'notice'));
  if (slow) findings.push(finding(`${slow} requests took over 1.5 s`, 'info'));
  return {
    evidence: [makeEvidence({
      operation: 'analyze_har',
      title: 'Network capture (HAR)',
      target: ctx.target,
      summary: `${entries.length} recorded requests to ${hosts.size} hosts; ${epList.length} look like API calls${tech.length ? `; tech: ${tech.slice(0, 3).map((t) => t.name).join(', ')}` : ''}.`,
      normalized_result: {
        requests: entries.length, hosts: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40), total_bytes: total,
        endpoints: epList.slice(0, 120).map((e) => ({ method: e.method, host: e.host, path: e.path, count: e.count, statuses: [...e.statuses], authenticated: e.auth, response_shape: e.shape ? shapeToString(e.shape, 300) : null })),
        credential_headers_seen: [...authHeaders], cookie_names: [...cookieNames].slice(0, 60), technologies: tech.map((t) => t.name),
        secrets: secrets.slice(0, 20),
      },
      sections: [
        kv('Overview', { Requests: entries.length, Hosts: hosts.size, 'Data transferred': fmtBytes(total), 'API-like calls': epList.length, Failed: failed, Slow: slow, 'Third-party trackers/services': thirdParty }),
        table('API calls', ['Method', 'Host', 'Path', 'Count', 'Status', 'Auth', 'Response shape'], epList.map((e) => [e.method, e.host, e.path, e.count, [...e.statuses].join(','), e.auth ? 'yes' : 'no', e.shape ? truncate(shapeToString(e.shape, 160), 160) : '']), ctx.opts.maxRows),
        bars('Hosts', [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, value]) => ({ label, value }))),
        bars('Content types', [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value]) => ({ label, value }))),
        techTags(tech),
        list('Cookie names (values never stored)', [...cookieNames]),
      ],
      findings,
      graph: {
        nodes: [{ id: 'app', label: first || 'App', group: 'ui', weight: 8 }, ...[...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).filter(([h]) => h !== first).map(([h, c]) => ({ id: 'h:' + h, label: h, group: (hostCategory(h) ? 'service' : 'api') as 'service' | 'api', weight: Math.min(8, 2 + Math.log2(c + 1)) }))],
        edges: [...hosts.keys()].filter((h) => h !== first).slice(0, 12).map((h) => ({ from: 'app', to: 'h:' + h, label: 'calls' })),
      },
      coverage: { status: 'partial', notes: ['Only what the capture recorded: actions the user did not perform are missing.'] },
      limitations: ['Response shapes come from sampled recorded responses; optional fields may be absent.', 'Credential values are intentionally never stored.'],
    })],
  };
}
