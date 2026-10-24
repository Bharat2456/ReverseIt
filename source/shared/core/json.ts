import type { AnalysisPart, TextCtx, Finding } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, table, tags } from './sections';
import { inferShape, parseJsonLoose, shapePaths, shapeToString, truncate } from './webutil';
import { scanSecrets } from './secrets';

export async function analyzeJson(ctx: TextCtx): Promise<AnalysisPart> {
  const v: any = parseJsonLoose(ctx.text);
  const nm = (ctx.path ?? ctx.name).toLowerCase();
  const findings: Finding[] = [];
  let kind = 'JSON data';
  const rows: Record<string, string | number | boolean | null> = {};
  const extra: any[] = [];
  const result: Record<string, unknown> = {};
  if (v === undefined) {
    return { evidence: [makeEvidence({ operation: 'analyze_json', title: 'JSON', target: ctx.target, summary: 'Could not parse as JSON.', normalized_result: {}, sections: [], coverage: { status: 'partial' }, limitations: ['Invalid JSON.'] })] };
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.openapi || v.swagger) {
      kind = 'API description (OpenAPI)';
      const paths = Object.entries(v.paths ?? {}).flatMap(([p, o]: [string, any]) => Object.keys(o).filter((m) => /^(get|post|put|patch|delete)$/i.test(m)).map((m) => [m.toUpperCase(), p, truncate(String(o[m]?.summary ?? ''), 80)]));
      rows['API title'] = v.info?.title ?? null; rows['Version'] = v.info?.version ?? null; rows['Operations'] = paths.length;
      extra.push(table('API operations', ['Method', 'Path', 'Summary'], paths, ctx.opts.maxRows));
      result.operations = paths.slice(0, 300);
    } else if (/package\.json$/.test(nm) || (v.name && (v.dependencies || v.scripts || v.main))) {
      kind = 'Node package manifest';
      const deps = { ...v.dependencies, ...v.devDependencies };
      rows['Name'] = v.name ?? null; rows['Version'] = v.version ?? null; rows['Main file'] = v.main ?? null; rows['Dependencies'] = Object.keys(deps).length;
      extra.push(table('Dependencies', ['Package', 'Version'], Object.entries(deps).map(([k, x]) => [k, String(x)]), ctx.opts.maxRows));
      extra.push(table('Scripts', ['Name', 'Command'], Object.entries(v.scripts ?? {}).map(([k, x]) => [k, truncate(String(x), 120)])));
      result.dependencies = deps; result.scripts = v.scripts ?? {}; result.name = v.name; result.main = v.main;
    } else if (v.manifest_version || (v.start_url && v.name) || v.display) {
      kind = v.manifest_version ? 'Browser extension manifest' : 'Web app manifest';
      rows['Name'] = v.name ?? null; rows['Version'] = v.version ?? null; rows['Start URL'] = v.start_url ?? null; rows['Theme colour'] = v.theme_color ?? null; rows['Background'] = v.background_color ?? null; rows['Display'] = v.display ?? null;
      const perms = [...(v.permissions ?? []), ...(v.host_permissions ?? [])].map(String);
      if (perms.length) extra.push(list('Permissions requested', perms));
      result.manifest = { name: v.name, display: v.display, theme_color: v.theme_color, permissions: perms };
    } else if (v.compilerOptions) kind = 'TypeScript config';
  }
  const shape = inferShape(v, 0, 4);
  const secrets = scanSecrets(ctx.text.slice(0, 500000), 20);
  if (secrets.length) findings.push(finding(`${secrets.length} possible secret(s) in this file`, 'risk', secrets.slice(0, 5).map((s) => `${s.kind} ${s.preview}`).join(', ')));
  return {
    evidence: [makeEvidence({
      operation: 'analyze_json',
      title: `${kind}: ${ctx.path ?? ctx.name}`,
      target: ctx.target,
      summary: `${kind}${rows['Name'] ? ` "${rows['Name']}"` : ''}; structure: ${truncate(shapeToString(shape, 140), 140)}.`,
      normalized_result: { kind, shape: shapeToString(shape, 800), paths: shapePaths(shape), ...result, secrets: secrets.map((s) => ({ kind: s.kind, preview: s.preview })) },
      sections: [kv('Overview', { Kind: kind, ...rows }), ...extra, list('Field paths', shapePaths(shape, '', [], 120))],
      findings,
      coverage: { status: 'complete' },
      limitations: ['Structure only: values are summarised, not interpreted.'],
    })],
  };
}
