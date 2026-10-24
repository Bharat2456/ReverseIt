import type { AnalysisPart, RecoveredFile, TextCtx, Finding } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, table, fmtBytes } from './sections';
import { parseJsonLoose } from './webutil';

export interface ParsedMap {
  sources: string[];
  contents: (string | null)[];
  names: number;
  file?: string;
  sourceRoot?: string;
}

export function parseSourceMap(text: string): ParsedMap | null {
  const j: any = parseJsonLoose(text);
  if (!j || typeof j !== 'object') return null;
  if (Array.isArray(j.sections)) {
    const sources: string[] = [];
    const contents: (string | null)[] = [];
    for (const s of j.sections) {
      const m = s?.map;
      if (m && Array.isArray(m.sources)) m.sources.forEach((p: string, i: number) => { sources.push(String(p)); contents.push(typeof m.sourcesContent?.[i] === 'string' ? m.sourcesContent[i] : null); });
    }
    return { sources, contents, names: 0, file: j.file };
  }
  if (!Array.isArray(j.sources)) return null;
  return {
    sources: j.sources.map(String),
    contents: j.sources.map((_: unknown, i: number) => (typeof j.sourcesContent?.[i] === 'string' ? j.sourcesContent[i] : null)),
    names: Array.isArray(j.names) ? j.names.length : 0,
    file: typeof j.file === 'string' ? j.file : undefined,
    sourceRoot: typeof j.sourceRoot === 'string' ? j.sourceRoot : undefined,
  };
}

/** Turn "webpack:///./src/../x.js?abc" into a safe relative path. Never escapes the root. */
export function cleanSourcePath(p: string): string {
  let s = p.replace(/^[a-z-]+:\/\/\/?/i, '').replace(/[?#].*$/, '').replace(/\\/g, '/');
  s = s.replace(/^\(webpack\)\/?/, 'webpack/').replace(/^\.\//, '');
  const out: string[] = [];
  for (const part of s.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part.replace(/[^\w.@+\- ~]/g, '_'));
  }
  return out.join('/') || 'unnamed';
}

export function mapToRecovered(m: ParsedMap, maxBytes: number): { files: RecoveredFile[]; truncated: boolean; bytes: number } {
  const files: RecoveredFile[] = [];
  const seen = new Set<string>();
  let used = 0;
  let truncated = false;
  m.sources.forEach((src, i) => {
    const t = m.contents[i];
    if (t == null) return;
    let path = cleanSourcePath((m.sourceRoot ? m.sourceRoot + '/' : '') + src);
    if (seen.has(path)) path = `${i}_${path}`;
    seen.add(path);
    if (used + t.length > maxBytes) { truncated = true; return; }
    used += t.length;
    files.push({ path, kind: /\.(?:[mc]?[jt]sx?|vue|svelte|css|scss|less|html?)$/i.test(path) ? 'source' : 'text', size: t.length, text: t, origin: 'sourcemap' });
  });
  return { files, truncated, bytes: used };
}

export async function analyzeSourceMap(ctx: TextCtx): Promise<AnalysisPart> {
  const m = parseSourceMap(ctx.text);
  if (!m) {
    return { evidence: [makeEvidence({ operation: 'analyze_sourcemap', title: 'Source map', target: ctx.target, summary: 'File looks like a source map but could not be parsed.', normalized_result: { error: 'parse' }, sections: [], coverage: { status: 'partial' }, limitations: ['Not valid JSON source map.'] })] };
  }
  const { files, truncated, bytes } = mapToRecovered(m, ctx.opts.maxRecoveredBytes);
  const mine = m.sources.filter((s) => !/node_modules|webpack\/runtime|^webpack:\/\/\/webpack|\(webpack\)/.test(s));
  const withContent = m.contents.filter((c) => c != null).length;
  const findings: Finding[] = [];
  if (withContent > 0) findings.push(finding(`Original source code recovered (${files.length} files)`, 'info', 'The source map embeds the original files, so the real project structure and code are readable.'));
  else findings.push(finding('Source map has no embedded source code', 'notice', 'Only file names are available; the original code is not inside this map.'));
  const tree = new Map<string, number>();
  for (const f of files) { const d = f.path.split('/').slice(0, 2).join('/'); tree.set(d, (tree.get(d) ?? 0) + 1); }
  return {
    evidence: [makeEvidence({
      operation: 'analyze_sourcemap',
      title: `Source map: ${ctx.path ?? ctx.name}`,
      target: ctx.target,
      summary: `Source map listing ${m.sources.length} original files (${mine.length} yours, ${m.sources.length - mine.length} libraries); ${withContent} include readable code.`,
      normalized_result: { source_count: m.sources.length, with_content: withContent, names: m.names, first_party: mine.slice(0, 200).map(cleanSourcePath), recovered_bytes: bytes },
      sections: [
        kv('Overview', { 'Original files': m.sources.length, 'App files (not libraries)': mine.length, 'Files with readable code': withContent, 'Recovered size': fmtBytes(bytes), 'Output file': m.file ?? null }),
        list('App source files', mine.map(cleanSourcePath)),
        table('Folders', ['Folder', 'Files'], [...tree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
      ],
      findings,
      coverage: { status: truncated ? 'partial' : 'complete', notes: truncated ? ['Recovery stopped at the size limit.'] : [] },
      limitations: ['Comments and formatting are only as good as what the map embedded.'],
    })],
    recovered: files,
    recoveredTruncated: truncated,
    textEntries: files.filter((f) => /\.(?:[mc]?[jt]sx?)$/i.test(f.path) && !/node_modules/.test(f.path) && f.text).slice(0, 60).map((f) => ({ path: f.path, text: f.text! })),
  };
}
