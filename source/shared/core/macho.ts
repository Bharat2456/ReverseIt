import type { AnalysisPart, ByteCtx, Finding, Graph } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, table, tags, fmtBytes } from './sections';
import { Reader } from './bytes';
import { safeAnalyze, rootId, clean, hexs, capabilitySummary } from './common';

const CPU: Record<number, string> = {
  7: 'x86 (32-bit)',
  0x01000007: 'x86-64',
  12: 'ARM (32-bit)',
  0x0100000c: 'ARM64 (Apple Silicon / iPhone)',
  0x0200000c: 'ARM64 (32-bit pointers)',
  18: 'PowerPC',
  0x01000012: 'PowerPC 64',
};
const FILETYPE: Record<number, string> = { 1: 'object file', 2: 'executable', 3: 'fixed VM library', 4: 'core dump', 5: 'preloaded executable', 6: 'dynamic library', 7: 'dynamic linker', 8: 'bundle / plug-in', 10: 'debug symbols (dSYM)', 11: 'kernel extension' };
const PLATFORM: Record<number, string> = { 1: 'macOS', 2: 'iOS', 3: 'tvOS', 4: 'watchOS', 5: 'bridgeOS', 6: 'Mac Catalyst', 7: 'iOS Simulator', 11: 'visionOS' };

interface Slice {
  arch: string;
  offset: number;
  size: number;
}

interface SliceInfo {
  arch: string;
  fileType: string;
  flags: string[];
  dylibs: string[];
  rpaths: string[];
  segments: { name: string; vmsize: number; sections: string[] }[];
  uuid?: string;
  entry?: string;
  signed: boolean;
  encrypted: boolean;
  minOs?: string;
  platform?: string;
  imports: string[];
  exports: string[];
  symbolCount: number;
  notes: string[];
}

function fmtVersion(v: number): string {
  return `${v >>> 16}.${(v >>> 8) & 0xff}.${v & 0xff}`;
}

function parseSlice(bytes: Uint8Array, base: number, size: number, arch: string): SliceInfo {
  const info: SliceInfo = { arch, fileType: 'unknown', flags: [], dylibs: [], rpaths: [], segments: [], signed: false, encrypted: false, imports: [], exports: [], symbolCount: 0, notes: [] };
  const sub = bytes.subarray(base, base + size);
  const magic = new DataView(sub.buffer, sub.byteOffset, Math.min(4, sub.length)).getUint32(0, false);
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const wide = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const r = new Reader(sub, le);
  const cpu = r.u32(4);
  info.arch = CPU[cpu] ?? `cpu ${hexs(cpu)}`;
  info.fileType = FILETYPE[r.u32(12)] ?? 'unknown type';
  const ncmds = r.u32(16);
  const flags = r.u32(24);
  if (flags & 0x200000) info.flags.push('PIE (randomised address space)');
  else if (r.u32(12) === 2) info.notes.push('Not position-independent (no PIE).');
  if (flags & 0x20000) info.flags.push('allows executable stack');
  if (flags & 0x1000000) info.flags.push('no heap execution');
  let off = wide ? 32 : 28;
  let symoff = 0, nsyms = 0, stroff = 0, strsize = 0;
  for (let i = 0; i < Math.min(ncmds, 4096); i++) {
    if (!r.has(off, 8)) {
      info.notes.push('Load command table is truncated.');
      break;
    }
    const cmd = r.u32(off);
    const cmdsize = r.u32(off + 4);
    if (cmdsize < 8) break;
    switch (cmd) {
      case 0x1:
      case 0x19: {
        const name = r.cstring(off + 8, 16);
        const sw = cmd === 0x19;
        const vmsize = sw ? r.u64n(off + 32) : r.u32(off + 28);
        const nsects = r.u32(off + (sw ? 64 : 48));
        const secs: string[] = [];
        let so = off + (sw ? 72 : 56);
        for (let s = 0; s < Math.min(nsects, 64); s++) {
          secs.push(r.cstring(so, 16));
          so += sw ? 80 : 68;
        }
        info.segments.push({ name, vmsize, sections: secs });
        break;
      }
      case 0xc:
      case 0x80000018:
      case 0x8000001f:
      case 0xd: {
        const nameOff = r.u32(off + 8);
        const n = r.cstring(off + nameOff, 512);
        if (cmd !== 0xd && n) info.dylibs.push(n);
        break;
      }
      case 0x8000001c:
        info.rpaths.push(r.cstring(off + r.u32(off + 8), 512));
        break;
      case 0x1b: {
        const u = Array.from(r.slice(off + 8, 16), (b) => b.toString(16).padStart(2, '0')).join('');
        info.uuid = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
        break;
      }
      case 0x80000028:
        info.entry = hexs(r.u64n(off + 8));
        break;
      case 0x1d:
        info.signed = true;
        break;
      case 0x21:
      case 0x2c:
        info.encrypted = r.u32(off + 16) !== 0;
        break;
      case 0x32:
        info.platform = PLATFORM[r.u32(off + 8)] ?? `platform ${r.u32(off + 8)}`;
        info.minOs = fmtVersion(r.u32(off + 12));
        break;
      case 0x24:
      case 0x25:
        info.platform = cmd === 0x24 ? 'macOS' : 'iOS';
        info.minOs = fmtVersion(r.u32(off + 8));
        break;
      case 0x2:
        symoff = r.u32(off + 8);
        nsyms = r.u32(off + 12);
        stroff = r.u32(off + 16);
        strsize = r.u32(off + 20);
        break;
    }
    off += cmdsize;
  }
  info.symbolCount = nsyms;
  if (nsyms > 0 && symoff > 0 && stroff > 0) {
    const entry = wide ? 16 : 12;
    for (let i = 0; i < Math.min(nsyms, 60000); i++) {
      const o = symoff + i * entry;
      if (!r.has(o, entry)) break;
      const strx = r.u32(o);
      const type = r.u8(o + 4);
      if (type & 0xe0) continue; // debug (stab) symbols
      if (!(type & 0x01)) continue; // not external
      if (strx === 0 || strx >= strsize) continue;
      const nm = r.cstring(stroff + strx, 256);
      if (!nm) continue;
      if ((type & 0x0e) === 0) {
        if (info.imports.length < 2000) info.imports.push(nm);
      } else if (info.exports.length < 2000) info.exports.push(nm);
    }
  }
  return info;
}

export async function analyzeMacho(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_macho', 'macOS / iOS executable layout', ctx, async () => {
    const { bytes } = ctx;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = dv.getUint32(0, false);
    const slices: Slice[] = [];
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const wide = magic === 0xcafebabf;
      const n = Math.min(dv.getUint32(4, false), 16);
      for (let i = 0; i < n; i++) {
        const o = 8 + i * (wide ? 32 : 20);
        if (o + 20 > bytes.length) break;
        const cpu = dv.getUint32(o, false);
        const offset = wide ? Number(dv.getBigUint64(o + 8, false)) : dv.getUint32(o + 8, false);
        const size = wide ? Number(dv.getBigUint64(o + 16, false)) : dv.getUint32(o + 12, false);
        if (offset + size <= bytes.length && size > 32) slices.push({ arch: CPU[cpu] ?? hexs(cpu), offset, size });
      }
    } else slices.push({ arch: '', offset: 0, size: bytes.length });
    const infos = slices.map((s) => parseSlice(bytes, s.offset, s.size, s.arch));
    const first = infos[0];
    if (!first) throw new Error('No readable Mach-O slice found');
    const allImports = [...new Set(infos.flatMap((i) => i.imports))];
    const caps = capabilitySummary(allImports);
    const segNames = new Set(first.segments.flatMap((s) => s.sections));
    const hints: string[] = [];
    if ([...segNames].some((s) => s.startsWith('__swift'))) hints.push('Swift');
    if ([...segNames].some((s) => /objc/i.test(s))) hints.push('Objective-C');
    if (allImports.some((s) => /^_?(NSApplication|UIApplication|SwiftUI)/.test(s)) || first.dylibs.some((d) => /SwiftUI|AppKit|UIKit/.test(d))) hints.push(first.dylibs.some((d) => /UIKit/.test(d)) ? 'UIKit app' : 'AppKit/SwiftUI app');
    const findings: Finding[] = [];
    for (const i of infos) {
      if (!i.signed) findings.push(finding(`${i.arch}: no code signature`, 'notice', 'Unsigned binaries are blocked by Gatekeeper on most Macs unless the user overrides it.'));
      if (i.encrypted) findings.push(finding(`${i.arch}: contents are encrypted (App Store DRM)`, 'warning', 'The code section is encrypted, so disassembly is meaningless until it is decrypted by its owner on a device they control.', ['drm']));
    }
    if (caps.has('Network access')) findings.push(finding('Makes network connections', 'info', caps.get('Network access')!.slice(0, 5).join(', ')));
    const root = rootId(ctx);
    const graph: Graph = { nodes: [{ id: root, label: ctx.target.name, group: 'native', weight: 9 }], edges: [] };
    for (const d of first.dylibs.slice(0, 25)) {
      const nm = d.split('/').pop() || d;
      graph.nodes.push({ id: `lib:${nm}`, label: nm, group: 'lib', weight: 2 });
      graph.edges.push({ from: root, to: `lib:${nm}`, label: 'links' });
    }
    const summary = `${first.fileType[0].toUpperCase() + first.fileType.slice(1)} for ${infos.map((i) => i.arch).join(' + ')}${first.platform ? `, built for ${first.platform} ${first.minOs ?? ''}` : ''}; links ${first.dylibs.length} libraries${hints.length ? ` (${hints.join(', ')})` : ''}.`;
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_macho',
          title: 'macOS / iOS executable layout',
          target: ctx.target,
          summary,
          normalized_result: {
            slices: infos.map((i) => ({ arch: i.arch, type: i.fileType, flags: i.flags, uuid: i.uuid, entry: i.entry, signed: i.signed, encrypted: i.encrypted, min_os: i.minOs, platform: i.platform, libraries: i.dylibs, rpaths: i.rpaths, segments: i.segments.map((s) => ({ name: s.name, sections: s.sections })), symbol_count: i.symbolCount, imports: i.imports.slice(0, 300), exports: i.exports.slice(0, 300) })),
            capabilities: Object.fromEntries(caps),
            hints,
          },
          sections: [
            kv('Overview', { Architectures: infos.map((i) => i.arch).join(', '), Type: first.fileType, Platform: first.platform ? `${first.platform} ${first.minOs}` : null, 'Code signature': first.signed ? 'present' : 'missing', Encrypted: first.encrypted ? 'yes' : 'no', UUID: first.uuid ?? null, 'Entry point': first.entry ?? null, Size: fmtBytes(bytes.length) }),
            tags('Protections & flags', [...first.flags, ...first.notes].map((l) => ({ label: l, tone: l.startsWith('Not') ? 'orange' : 'green' }))),
            list('Linked libraries', first.dylibs),
            table('Segments', ['Segment', 'Size', 'Sections'], first.segments.map((s) => [s.name, fmtBytes(s.vmsize), s.sections.join(' ')])),
            list('Functions it calls from other libraries', allImports.slice(0, 300).map((s) => clean(s))),
            list('Functions it offers to others', first.exports.slice(0, 300).map((s) => clean(s))),
            tags('What it can do (inferred from imports)', [...caps.keys()].map((c) => ({ label: c, tone: 'cyan' as const }))),
          ],
          findings,
          graph,
          coverage: { status: 'partial', notes: ['Headers, load commands and symbol tables were read; machine code was not disassembled.'] },
          limitations: ['This reads the file structure only. To see what the code does, use a disassembler (Hopper, Ghidra) through the ReverseIt local engine.', 'Stripped binaries hide most function names.'],
        }),
      ],
    };
  });
}
