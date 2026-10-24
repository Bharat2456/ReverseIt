import type { AnalysisPart, ByteCtx, Finding, Graph } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, table, tags, fmtBytes } from './sections';
import { decodeUtf8 } from './bytes';
import { safeAnalyze, rootId, clean } from './common';

const SECTION_NAMES: Record<number, string> = { 0: 'custom', 1: 'type', 2: 'import', 3: 'function', 4: 'table', 5: 'memory', 6: 'global', 7: 'export', 8: 'start', 9: 'element', 10: 'code', 11: 'data', 12: 'data count', 13: 'tag' };
const KIND = ['function', 'table', 'memory', 'global', 'tag'];

class Cur {
  constructor(public b: Uint8Array, public p = 0, public end = b.length) {}
  get done() {
    return this.p >= this.end;
  }
  byte(): number {
    if (this.p >= this.end) throw new Error('Unexpected end of WebAssembly data');
    return this.b[this.p++];
  }
  leb(): number {
    let r = 0, shift = 0, x: number;
    do {
      x = this.byte();
      r += (x & 0x7f) * 2 ** shift;
      shift += 7;
    } while (x & 0x80 && shift < 49);
    return r;
  }
  name(): string {
    const n = this.leb();
    if (this.p + n > this.end) throw new Error('Name runs past the section');
    const s = decodeUtf8(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
}

function skipLimits(c: Cur) {
  const f = c.byte();
  c.leb();
  if (f & 1) c.leb();
}

export async function analyzeWasm(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_wasm', 'WebAssembly module', ctx, async () => {
    const { bytes } = ctx;
    if (bytes.length < 8) throw new Error('Too small for a WebAssembly module');
    const version = bytes[4] | (bytes[5] << 8);
    const secs: { id: string; size: number }[] = [];
    const imports: { module: string; name: string; kind: string }[] = [];
    const exports: { name: string; kind: string }[] = [];
    const funcNames: string[] = [];
    const custom: string[] = [];
    let producers = '';
    let funcCount = 0, importedFuncs = 0, memories = 0, tables = 0, globals = 0, start: number | null = null, dataSegments = 0, types = 0;
    const notes: string[] = [];
    const c = new Cur(bytes, 8);
    try {
      while (!c.done) {
        const id = c.byte();
        const size = c.leb();
        const bodyStart = c.p;
        const bodyEnd = Math.min(bodyStart + size, bytes.length);
        if (bodyStart + size > bytes.length) notes.push('The last section is cut off.');
        const s = new Cur(bytes, bodyStart, bodyEnd);
        secs.push({ id: id === 0 ? 'custom' : SECTION_NAMES[id] ?? `id ${id}`, size });
        try {
          if (id === 1) types = s.leb();
          else if (id === 2) {
            const n = s.leb();
            for (let i = 0; i < n && !s.done; i++) {
              const mod = s.name(), nm = s.name(), k = s.byte();
              imports.push({ module: mod, name: nm, kind: KIND[k] ?? `kind ${k}` });
              if (k === 0) { s.leb(); importedFuncs++; }
              else if (k === 1) { s.byte(); skipLimits(s); }
              else if (k === 2) skipLimits(s);
              else if (k === 3) { s.byte(); s.byte(); }
              else if (k === 4) { s.byte(); s.leb(); }
            }
          } else if (id === 3) funcCount = s.leb();
          else if (id === 4) tables = s.leb();
          else if (id === 5) memories = s.leb();
          else if (id === 6) globals = s.leb();
          else if (id === 7) {
            const n = s.leb();
            for (let i = 0; i < n && !s.done; i++) {
              const nm = s.name(), k = s.byte();
              s.leb();
              exports.push({ name: nm, kind: KIND[k] ?? `kind ${k}` });
            }
          } else if (id === 8) start = s.leb();
          else if (id === 11) dataSegments = s.leb();
          else if (id === 0) {
            const nm = s.name();
            custom.push(nm);
            if (nm === 'producers') {
              const fields = s.leb();
              const parts: string[] = [];
              for (let i = 0; i < fields; i++) {
                const fname = s.name();
                const cnt = s.leb();
                for (let j = 0; j < cnt; j++) parts.push(`${fname}: ${s.name()} ${s.name()}`.trim());
              }
              producers = parts.join('; ');
            } else if (nm === 'name') {
              while (!s.done) {
                const sub = s.byte();
                const len = s.leb();
                const subEnd = s.p + len;
                if (sub === 1) {
                  const n = s.leb();
                  for (let i = 0; i < n && s.p < subEnd && funcNames.length < 400; i++) { s.leb(); funcNames.push(s.name()); }
                }
                s.p = subEnd;
              }
            }
          }
        } catch {
          notes.push(`Section "${SECTION_NAMES[id] ?? id}" could not be fully read.`);
        }
        c.p = bodyStart + size;
      }
    } catch (e: any) {
      notes.push(String(e?.message ?? e));
    }
    const toolchain = /wasm-bindgen|rustc/i.test(producers) || imports.some((i) => i.module.includes('wbindgen')) ? 'Rust (wasm-bindgen)' : /emscripten/i.test(producers) || imports.some((i) => i.module === 'env' && /emscripten/.test(i.name)) ? 'Emscripten (C/C++)' : /clang/i.test(producers) ? 'C/C++ (clang)' : /AssemblyScript/i.test(producers) ? 'AssemblyScript' : /go/i.test(producers) || imports.some((i) => i.module === 'gojs') ? 'Go' : undefined;
    const findings: Finding[] = [];
    if (imports.some((i) => i.module.startsWith('wasi'))) findings.push(finding('Uses WASI', 'info', 'It talks to the host through the WebAssembly System Interface (files, clock, random).'));
    if (!custom.includes('name')) findings.push(finding('Function names are stripped', 'notice', 'Only exported names are visible; internal functions are anonymous numbers.'));
    const root = rootId(ctx);
    const graph: Graph = { nodes: [{ id: root, label: ctx.target.name, group: 'native', weight: 8 }], edges: [] };
    for (const m of [...new Set(imports.map((i) => i.module))].slice(0, 8)) {
      graph.nodes.push({ id: `wimp:${m}`, label: m, group: 'lib', weight: 3 });
      graph.edges.push({ from: root, to: `wimp:${m}`, label: 'imports' });
    }
    for (const e of exports.filter((x) => x.kind === 'function').slice(0, 12)) {
      graph.nodes.push({ id: `wexp:${e.name}`, label: clean(e.name, 32), group: 'api', weight: 3 });
      graph.edges.push({ from: root, to: `wexp:${e.name}`, label: 'exports' });
    }
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_wasm',
          title: 'WebAssembly module',
          target: ctx.target,
          summary: `WebAssembly module (version ${version}) with ${funcCount + importedFuncs} functions, ${imports.length} imports and ${exports.length} exports${toolchain ? `, compiled from ${toolchain}` : ''}.`,
          normalized_result: { version, toolchain: toolchain ?? null, producers, counts: { types, functions: funcCount, imported_functions: importedFuncs, memories, tables, globals, data_segments: dataSegments }, start_function: start, sections: secs, imports: imports.slice(0, 300), exports: exports.slice(0, 300), function_names: funcNames.slice(0, 300), custom_sections: custom },
          sections: [
            kv('Overview', { Size: fmtBytes(bytes.length), Version: version, 'Compiled from': toolchain ?? 'unknown', Producers: producers || null, Functions: funcCount + importedFuncs, Memories: memories, Tables: tables, Globals: globals, 'Data segments': dataSegments, 'Start function': start }),
            table('Imports (what the host must provide)', ['Module', 'Name', 'Kind'], imports.map((i) => [i.module, clean(i.name), i.kind])),
            table('Exports (what it offers)', ['Name', 'Kind'], exports.map((e) => [clean(e.name), e.kind])),
            list('Named internal functions', funcNames.map((f) => clean(f))),
            table('Sections', ['Section', 'Size'], secs.map((s) => [s.id, fmtBytes(s.size)])),
            tags('Custom sections', custom.map((x) => ({ label: x, tone: 'dim' as const }))),
          ],
          findings,
          graph,
          coverage: { status: notes.length ? 'partial' : 'complete', notes },
          limitations: ['Instructions inside function bodies were not decoded. Use a WebAssembly text tool (WABT) through the local engine to read them.'],
        }),
      ],
    };
  });
}
