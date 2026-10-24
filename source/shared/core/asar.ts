import type { AnalysisPart, ByteCtx, Graph, RecoveredFile } from './types';
import { makeEvidence } from './evidence';
import { bars, finding, kv, list, table, tags, fmtBytes } from './sections';
import { decodeUtf8 } from './bytes';
import { safeAnalyze, rootId, clean, countBy, topN } from './common';

export function isAsar(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 4) return false;
  const headerSize = dv.getUint32(4, true);
  const jsonLen = dv.getUint32(12, true);
  if (headerSize < 8 || 16 + jsonLen > bytes.length || jsonLen > headerSize) return false;
  return bytes[16] === 0x7b; // '{'
}

interface AsarNode {
  files?: Record<string, AsarNode>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  link?: string;
  executable?: boolean;
}

export interface AsarFile {
  path: string;
  size: number;
  offset: number;
  unpacked: boolean;
}

export function parseAsar(bytes: Uint8Array): { files: AsarFile[]; base: number; dirs: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = dv.getUint32(4, true);
  const jsonLen = dv.getUint32(12, true);
  const header = JSON.parse(decodeUtf8(bytes.subarray(16, 16 + jsonLen))) as AsarNode;
  const base = 8 + headerSize;
  const files: AsarFile[] = [];
  let dirs = 0;
  const walk = (node: AsarNode, prefix: string) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) {
        dirs++;
        walk(child, p);
      } else if (!child.link) files.push({ path: p, size: child.size ?? 0, offset: Number(child.offset ?? 0), unpacked: !!child.unpacked });
    }
  };
  walk(header, '');
  return { files, base, dirs };
}

const TEXT_RE = /\.(?:m?js|cjs|jsx|tsx?|html?|css|json|map|md|txt|yml|yaml|xml|svg)$/i;

export async function analyzeAsar(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_asar', 'Electron app package (ASAR)', ctx, async () => {
    const { bytes, opts } = ctx;
    const { files, base, dirs } = parseAsar(bytes);
    const read = (f: AsarFile): Uint8Array | undefined => {
      if (f.unpacked) return undefined;
      const s = base + f.offset;
      return s + f.size <= bytes.length ? bytes.subarray(s, s + f.size) : undefined;
    };
    const appFiles = files.filter((f) => !f.path.startsWith('node_modules/'));
    const nm = files.filter((f) => f.path.startsWith('node_modules/'));
    const pkgFile = files.find((f) => f.path === 'package.json');
    let pkg: any = {};
    if (pkgFile) {
      const b = read(pkgFile);
      if (b) {
        try {
          pkg = JSON.parse(decodeUtf8(b));
        } catch {
          /* ignore */
        }
      }
    }
    const deps = Object.keys(pkg.dependencies ?? {});
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    const natives = files.filter((f) => /\.(node|dll|dylib|so)$/i.test(f.path) || f.unpacked);
    const main: string = pkg.main ?? 'index.js';
    const preloads = appFiles.filter((f) => /preload/i.test(f.path) && /\.(c|m)?js$/.test(f.path));
    const htmls = appFiles.filter((f) => /\.html?$/i.test(f.path));
    const ext = countBy(files, (f) => (f.path.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'none').toLowerCase());
    const frameworks: string[] = [];
    const names = new Set([...deps, ...devDeps, ...nm.map((f) => f.path.split('/')[1])]);
    for (const [n, label] of [['react', 'React'], ['vue', 'Vue'], ['@angular/core', 'Angular'], ['svelte', 'Svelte'], ['electron-updater', 'Auto-updates (electron-updater)'], ['electron-store', 'Local settings store'], ['better-sqlite3', 'SQLite database'], ['sqlite3', 'SQLite database'], ['electron-log', 'Logging'], ['@sentry/electron', 'Sentry crash reports']] as const) if (names.has(n)) frameworks.push(label);
    // choose text entries for deeper analysis
    const textEntries: { path: string; text: string }[] = [];
    const recovered: RecoveredFile[] = [];
    let recBytes = 0;
    let recTrunc = false;
    const priority = (f: AsarFile) => (f.path === 'package.json' ? 0 : f.path === main ? 1 : /preload/i.test(f.path) ? 2 : /\.html?$/i.test(f.path) ? 3 : /main/i.test(f.path) ? 4 : 5);
    const candidates = appFiles.filter((f) => TEXT_RE.test(f.path) && f.size <= 3 * 1024 * 1024 && !f.unpacked).sort((a, b) => priority(a) - priority(b) || a.size - b.size);
    for (const f of candidates) {
      const b = read(f);
      if (!b) continue;
      const t = decodeUtf8(b);
      if (recBytes + t.length > opts.maxRecoveredBytes) {
        recTrunc = true;
        break;
      }
      recBytes += t.length;
      recovered.push({ path: f.path, kind: /\.(?:m?js|cjs|jsx|tsx?|css|html?)$/i.test(f.path) ? 'source' : 'config', size: f.size, text: t, origin: 'asar' });
      if (textEntries.length < 40 && /\.(?:m?js|cjs|html?|css|json)$/i.test(f.path) && !f.path.endsWith('.map')) textEntries.push({ path: f.path, text: t });
    }
    const root = rootId(ctx);
    const graph: Graph = { nodes: [{ id: root, label: String(pkg.name ?? ctx.target.name), group: 'entry', weight: 9 }], edges: [] };
    graph.nodes.push({ id: 'asar:main', label: `Main process (${main})`, group: 'native', weight: 7 });
    graph.edges.push({ from: root, to: 'asar:main', label: 'starts' });
    for (const p of preloads.slice(0, 4)) {
      graph.nodes.push({ id: `asar:${p.path}`, label: `Preload ${p.path.split('/').pop()}`, group: 'native', weight: 5 });
      graph.edges.push({ from: 'asar:main', to: `asar:${p.path}`, label: 'injects' });
    }
    for (const h of htmls.slice(0, 5)) {
      graph.nodes.push({ id: `asar:${h.path}`, label: `Window ${h.path.split('/').pop()}`, group: 'ui', weight: 5 });
      graph.edges.push({ from: preloads[0] ? `asar:${preloads[0].path}` : 'asar:main', to: `asar:${h.path}`, label: 'loads' });
    }
    for (const n of natives.filter((f) => /\.node$/.test(f.path)).slice(0, 6)) {
      graph.nodes.push({ id: `asar:${n.path}`, label: n.path.split('/').pop() || n.path, group: 'native', weight: 3 });
      graph.edges.push({ from: 'asar:main', to: `asar:${n.path}`, label: 'native addon' });
    }
    const findings = [finding('This is an Electron desktop app', 'info', 'Electron apps are web technology (HTML, CSS, JavaScript) inside a desktop shell. Their logic is usually readable, so most features can be traced.')];
    if (!pkg.name) findings.push(finding('No package.json found at the archive root', 'notice'));
    if (natives.length) findings.push(finding(`${natives.length} native/unpacked file${natives.length > 1 ? 's' : ''}`, 'notice', 'Native add-ons run outside JavaScript; use the native engine to inspect them.'));
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_asar',
          title: 'Electron app package (ASAR)',
          target: ctx.target,
          summary: `Electron package "${pkg.name ?? 'unnamed'}"${pkg.version ? ` v${pkg.version}` : ''}: ${files.length} files (${nm.length} are third-party modules)${frameworks.length ? `; uses ${frameworks.slice(0, 3).join(', ')}` : ''}.`,
          normalized_result: { name: pkg.name ?? null, version: pkg.version ?? null, main, description: pkg.description ?? null, dependencies: deps.slice(0, 200), dev_dependencies: devDeps.slice(0, 100), electron_version: pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? null, file_count: files.length, directory_count: dirs, third_party_files: nm.length, native_files: natives.map((f) => f.path).slice(0, 100), preload_scripts: preloads.map((f) => f.path), html_entries: htmls.map((f) => f.path).slice(0, 30), extensions: Object.fromEntries(topN(ext, 20).map((e) => [e.label, e.value])), frameworks },
          sections: [
            kv('App', { Name: pkg.name ?? null, Version: pkg.version ?? null, Description: pkg.description ? clean(String(pkg.description)) : null, 'Main script': main, Author: typeof pkg.author === 'string' ? clean(pkg.author) : pkg.author?.name ?? null, Files: files.length, 'Third-party files': nm.length, Size: fmtBytes(bytes.length) }),
            tags('Detected', frameworks.map((f) => ({ label: f, tone: 'cyan' as const }))),
            list('Own dependencies (package.json)', deps),
            list('Preload scripts (bridge between web page and system)', preloads.map((f) => f.path)),
            list('Window pages (HTML)', htmls.map((f) => f.path)),
            list('Native add-ons and unpacked files', natives.map((f) => f.path)),
            bars('File types', topN(ext, 12)),
            table('Largest own files', ['File', 'Size'], appFiles.sort((a, b) => b.size - a.size).slice(0, 40).map((f) => [f.path, fmtBytes(f.size)])),
          ],
          findings,
          graph,
          coverage: { status: 'complete', notes: [] },
          limitations: ['Only files stored inside the archive are listed; files marked "unpacked" live next to it and were not provided.'],
        }),
      ],
      recovered,
      recoveredTruncated: recTrunc,
      textEntries,
    };
  });
}
