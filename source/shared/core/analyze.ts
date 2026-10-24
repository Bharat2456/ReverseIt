import type { AnalysisPart, AnalysisResult, AnalyzeInput, AnalyzeOptions, ByteCtx, Evidence, RecoveredFile, TargetRef, TextCtx, Unknown } from './types';
import { makeEvidence } from './evidence';
import { resolveOptions, throwIfAborted, yieldToUi } from './options';
import { sha256Hex } from './hash';
import { sniffFormat } from './sniff';
import { decodeUtf8 } from './bytes';
import { finding, kv, list } from './sections';
import { analyzeElf } from './elf';
import { analyzePe, parsePeLayout } from './pe';
import { analyzeMacho } from './macho';
import { analyzeWasm } from './wasm';
import { analyzeAsar } from './asar';
import { analyzeZip } from './archive';
import { analyzeApk } from './apk';
import { analyzeDotnet } from './dotnet';
import { analyzeSqlite } from './sqlite';
import { analyzeStrings } from './strings';
import { analyzeHtml } from './html';
import { analyzeCss, extractDesignTokens, tokensToSections } from './css';
import { analyzeSourceMap } from './sourcemap';
import { analyzeHar } from './har';
import { analyzeJson } from './json';
import { analyzeJavaScript, extractJsFacts, mergeJsFacts, factsToSections, factsToFindings, factsToGraph } from './javascript';
import { fmtBytes } from './sections';

const NATIVE = new Set(['elf', 'pe', 'macho', 'wasm', 'dex']);

async function bundleJs(entries: { path: string; text: string }[], target: TargetRef, opts: ReturnType<typeof resolveOptions>): Promise<Evidence | null> {
  if (!entries.length) return null;
  const facts: import("./javascript").JsFacts[] = [];
  for (const e of entries) {
    throwIfAborted(opts.signal);
    facts.push(await extractJsFacts(e.text, e.path, opts.signal));
    await yieldToUi();
  }
  const f = mergeJsFacts(facts);
  return makeEvidence({
    operation: 'analyze_javascript_application',
    title: `Application code (${entries.length} scripts)`,
    target,
    summary: `${entries.length} script files, ${fmtBytes(f.bytes)} of code: ${f.endpoints.length} endpoints, ${f.routes.length} routes, ${f.tech.filter((t) => t.confidence !== 'low').slice(0, 3).map((t) => t.name).join(', ') || 'no framework identified'}.`,
    normalized_result: {
      files: entries.map((e) => e.path).slice(0, 100),
      endpoints: f.endpoints.slice(0, 200).map((e) => ({ url: e.url, method: e.method, via: e.via })),
      routes: f.routes.slice(0, 120), env_vars: f.envVars.slice(0, 80), libraries: f.libraries.slice(0, 120).map((l) => (l.version ? `${l.name}@${l.version}` : l.name)),
      ipc: f.ipc, electron: { window_preferences: f.webPreferences, ...f.electron }, storage_keys: f.storageKeys.slice(0, 80).map((k) => `${k.kind}:${k.key}`),
      technologies: f.tech.slice(0, 40).map((t) => ({ name: t.name, category: t.category })), secrets: f.secrets.map((s) => ({ kind: s.kind, preview: s.preview })),
    },
    sections: [list('Files scanned', entries.map((e) => e.path)), ...factsToSections(f, opts.maxRows)],
    findings: factsToFindings(f, 'This application'),
    graph: factsToGraph(f, 'app', target.name, 'entry'),
    coverage: { status: 'partial', notes: ['Static scan of the readable scripts only.'] },
    limitations: ['Code was never run; dynamically built URLs, channels and keys are invisible.', 'Only up to the first scripts of a large bundle are scanned.'],
  });
}

async function runTextEntries(entries: { path: string; text: string }[], target: TargetRef, opts: ReturnType<typeof resolveOptions>, evidence: Evidence[]) {
  const js: { path: string; text: string }[] = [];
  const css: string[] = [];
  let htmls = 0, jsons = 0;
  for (const e of entries) {
    throwIfAborted(opts.signal);
    const p = e.path.toLowerCase();
    if (/\.(?:m?js|cjs|jsx|tsx?)$/.test(p)) js.push(e);
    else if (/\.css$/.test(p)) css.push(e.text);
    else if (/\.html?$/.test(p) && htmls < 4) { htmls++; evidence.push(...(await analyzeHtml({ name: e.path, text: e.text, target, opts, path: e.path })).evidence); }
    else if (/(?:^|\/)(?:package|manifest|app|config|tsconfig)\.json$|\.webmanifest$|openapi|swagger/.test(p) && jsons < 6) { jsons++; evidence.push(...(await analyzeJson({ name: e.path, text: e.text, target, opts, path: e.path })).evidence); }
  }
  const b = await bundleJs(js.slice(0, 80), target, opts);
  if (b) evidence.push(b);
  if (css.length) {
    const t = extractDesignTokens(css.join('\n'));
    evidence.push(makeEvidence({ operation: 'analyze_css', title: 'Styles of the app', target, summary: `${css.length} stylesheets with ${t.colors.length} distinct colours.`, normalized_result: { colors: t.colors.slice(0, 16).map((c) => c.value), fonts: t.fonts.map((f) => f.family), variables: t.variables.slice(0, 60) }, sections: tokensToSections(t, opts.maxRows), coverage: { status: 'partial' }, limitations: ['Counts reflect stylesheet text, not what is visible on screen.'] }));
  }
}

function nativeUnknowns(format: string): Unknown[] {
  if (!NATIVE.has(format)) return [];
  return [
    { id: 'unk_logic', question: 'What do the program\'s own functions actually do? (needs a decompiler)', domain: 'native', status: 'open' },
    { id: 'unk_flow', question: 'Which code paths run at start-up and which are only reached on certain input?', domain: 'native', status: 'open' },
  ];
}

export async function analyzeBytes(input: AnalyzeInput, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const t0 = Date.now();
  const opts = resolveOptions(options);
  const { name, bytes } = input;
  const progress = (phase: string, pct: number, message?: string) => opts.onProgress({ phase, pct, message });
  progress('identify', 3, 'Identifying the file');
  const sn = sniffFormat(name, bytes);
  const target: TargetRef = { name, kind: 'file', size: bytes.length, sha256: await sha256Hex(bytes), format: sn.format };
  const evidence: Evidence[] = [];
  const unknowns: Unknown[] = [...nativeUnknowns(sn.format)];
  const recovered: RecoveredFile[] = [];
  let truncated = false;
  const analyzers: string[] = [];
  const bctx: ByteCtx = { name, bytes, target, opts };
  const take = (p: AnalysisPart, label: string) => {
    analyzers.push(label);
    evidence.push(...p.evidence);
    if (p.unknowns) unknowns.push(...p.unknowns);
    if (p.recovered) recovered.push(...p.recovered);
    if (p.recoveredTruncated) truncated = true;
    return p;
  };
  progress('analyze', 10, `Reading ${sn.label}`);
  let entries: { path: string; text: string }[] = [];
  const textCtx = (): TextCtx => ({ name, text: decodeUtf8(bytes.length > 24 * 1024 * 1024 ? bytes.subarray(0, 24 * 1024 * 1024) : bytes), target, opts });
  switch (sn.format) {
    case 'elf': take(await analyzeElf(bctx), 'elf'); take(await analyzeStrings(bctx), 'strings'); break;
    case 'pe': {
      take(await analyzePe(bctx), 'pe');
      const L = parsePeLayout(bytes);
      if (L && L.ok && L.dirs[14] && L.dirs[14].rva) take(await analyzeDotnet(bctx), 'dotnet');
      take(await analyzeStrings(bctx), 'strings');
      break;
    }
    case 'macho': take(await analyzeMacho(bctx), 'macho'); take(await analyzeStrings(bctx), 'strings'); break;
    case 'wasm': take(await analyzeWasm(bctx), 'wasm'); take(await analyzeStrings(bctx), 'strings'); break;
    case 'sqlite': take(await analyzeSqlite(bctx), 'sqlite'); break;
    case 'asar': entries = take(await analyzeAsar(bctx), 'asar').textEntries ?? []; break;
    case 'apk': entries = take(await analyzeApk(bctx), 'apk').textEntries ?? []; break;
    case 'zip': entries = take(await analyzeZip(bctx), 'zip').textEntries ?? []; break;
    case 'html': take(await analyzeHtml(textCtx()), 'html'); break;
    case 'css': take(await analyzeCss(textCtx()), 'css'); break;
    case 'js': take(await analyzeJavaScript(textCtx()), 'javascript'); break;
    case 'json': take(await analyzeJson(textCtx()), 'json'); break;
    case 'har': take(await analyzeHar(textCtx()), 'har'); break;
    case 'sourcemap': entries = take(await analyzeSourceMap(textCtx()), 'sourcemap').textEntries ?? []; break;
    case 'dex': case 'binary-unknown': take(await analyzeStrings(bctx), 'strings'); break;
    default: {
      if (sn.format === 'text') {
        const t = textCtx();
        evidence.push(makeEvidence({ operation: 'inspect_text', title: 'Text file', target, summary: `${sn.label}, ${fmtBytes(bytes.length)}.`, normalized_result: { lines: t.text.split('\n').length }, sections: [kv('Overview', { Kind: sn.label, Size: fmtBytes(bytes.length), Lines: t.text.split('\n').length })], coverage: { status: 'complete' }, limitations: ['Plain text is shown as-is; nothing structured was found to analyse.'] }));
        analyzers.push('text');
      } else {
        evidence.push(makeEvidence({ operation: 'inspect_unsupported', title: sn.label, target, summary: `${sn.label} is not something ReverseIt can open directly.`, normalized_result: { format: sn.format }, sections: [], findings: [finding('Unsupported format', 'notice', 'Unpack or convert it (for example unzip a 7z/RAR, or export a PDF to text) and upload the result.')], coverage: { status: 'unknown' }, limitations: ['No analysis was possible for this format.'] }));
        analyzers.push('none');
      }
    }
  }
  if (entries.length) {
    progress('contents', 55, `Reading ${entries.length} files inside`);
    const before = evidence.length;
    await runTextEntries(entries, target, opts, evidence);
    analyzers.push(`contents(${evidence.length - before})`);
  }
  progress('done', 100, 'Done');
  return { target, evidence, unknowns, recovered, recoveredTruncated: truncated || undefined, stats: { durationMs: Date.now() - t0, analyzers, bytes: bytes.length } };
}

/** Pasted text (code, HTML, JSON, HAR…). */
export async function analyzeText(name: string, text: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const bytes = new TextEncoder().encode(text);
  const r = await analyzeBytes({ name, bytes }, options);
  r.target.kind = 'paste';
  return r;
}
