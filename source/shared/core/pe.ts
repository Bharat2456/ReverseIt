import type { AnalysisPart, ByteCtx, Finding, GraphEdge, GraphNode, Section } from './types';
import { makeEvidence } from './evidence';
import { bars, finding, kv, list, table, tags } from './sections';
import { Reader, entropy } from './bytes';
import { capabilitySummary, hexs, isoTime, rootId, safeAnalyze, clean } from './common';

const MACHINES: Record<number, string> = { 0x14c: 'x86 (32-bit)', 0x8664: 'x86-64', 0x1c0: 'ARM', 0x1c4: 'ARM Thumb-2', 0xaa64: 'ARM 64-bit', 0x200: 'Itanium', 0x5064: 'RISC-V 64', 0x6232: 'LoongArch 32', 0x6264: 'LoongArch 64' };
const SUBSYSTEMS: Record<number, string> = { 1: 'Native (driver)', 2: 'Windows GUI', 3: 'Windows console', 5: 'OS/2 console', 7: 'POSIX console', 9: 'Windows CE GUI', 10: 'EFI application', 11: 'EFI boot driver', 12: 'EFI runtime driver', 13: 'EFI ROM', 14: 'Xbox' };
const PACKER_SECTIONS = /^(?:UPX\d|\.aspack|\.adata|\.themida|\.vmp\d|\.petite|\.nsp\d|\.MPRESS\d|\.enigma\d|\.boot|\.winlice|\.perplex|\.yP|\.packed)/i;

export interface PeLayout {
  r: Reader;
  plus: boolean;
  peOff: number;
  machine: number;
  nsec: number;
  timestamp: number;
  characteristics: number;
  optOff: number;
  entryRva: number;
  imageBase: number;
  subsystem: number;
  dllChars: number;
  dirs: { rva: number; size: number }[];
  secs: { name: string; vsize: number; vaddr: number; rawSize: number; rawPtr: number; chars: number }[];
  rvaToOff: (rva: number) => number;
  ok: boolean;
}

/** Shared PE header parse (also used by the .NET analyzer). */
export function parsePeLayout(bytes: Uint8Array): PeLayout | undefined {
  const r = new Reader(bytes, true);
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return undefined;
  const peOff = r.u32(0x3c);
  if (!r.has(peOff, 24) || r.u32(peOff) !== 0x00004550) return undefined;
  const machine = r.u16(peOff + 4);
  const nsec = r.u16(peOff + 6);
  const timestamp = r.u32(peOff + 8);
  const optSize = r.u16(peOff + 20);
  const characteristics = r.u16(peOff + 22);
  const optOff = peOff + 24;
  const magic = r.u16(optOff);
  const plus = magic === 0x20b;
  if (magic !== 0x10b && magic !== 0x20b) return undefined;
  const entryRva = r.u32(optOff + 16);
  const imageBase = plus ? r.u64n(optOff + 24) : r.u32(optOff + 28);
  const subsystem = r.u16(optOff + 68);
  const dllChars = r.u16(optOff + 70);
  const ndirs = Math.min(r.u32(optOff + (plus ? 108 : 92)), 16);
  const dirBase = optOff + (plus ? 112 : 96);
  const dirs: { rva: number; size: number }[] = [];
  for (let i = 0; i < 16; i++) dirs.push(i < ndirs ? { rva: r.u32(dirBase + i * 8), size: r.u32(dirBase + i * 8 + 4) } : { rva: 0, size: 0 });
  const secs: PeLayout['secs'] = [];
  const secBase = optOff + optSize;
  for (let i = 0; i < Math.min(nsec, 96); i++) {
    const o = secBase + i * 40;
    if (!r.has(o, 40)) break;
    const nm = r.slice(o, 8);
    let end = nm.indexOf(0);
    if (end < 0) end = 8;
    secs.push({ name: new TextDecoder('latin1').decode(nm.subarray(0, end)), vsize: r.u32(o + 8), vaddr: r.u32(o + 12), rawSize: r.u32(o + 16), rawPtr: r.u32(o + 20), chars: r.u32(o + 36) });
  }
  const rvaToOff = (rva: number): number => {
    for (const s of secs) {
      const span = Math.max(s.vsize, s.rawSize);
      if (rva >= s.vaddr && rva < s.vaddr + span) return s.rawPtr + (rva - s.vaddr);
    }
    return rva < 0x1000 ? rva : -1;
  };
  return { r, plus, peOff, machine, nsec, timestamp, characteristics, optOff, entryRva, imageBase, subsystem, dllChars, dirs, secs, rvaToOff, ok: r.ok };
}

export async function analyzePe(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_pe', 'Windows executable layout', ctx, async () => {
    const { bytes, opts } = ctx;
    const L = parsePeLayout(bytes);
    if (!L) throw new Error('Not a valid PE file (PE header not found)');
    const { r, plus } = L;
    const notes: string[] = [];

    // ---- imports
    const importsByDll = new Map<string, string[]>();
    let importCount = 0;
    const impDir = L.dirs[1];
    if (impDir.rva) {
      let o = L.rvaToOff(impDir.rva);
      for (let n = 0; n < 1024 && o >= 0 && r.has(o, 20); n++, o += 20) {
        const oft = r.u32(o), nameRva = r.u32(o + 12), ft = r.u32(o + 16);
        if (!oft && !nameRva && !ft) break;
        const dll = r.cstring(L.rvaToOff(nameRva), 128);
        if (!dll) continue;
        const names: string[] = importsByDll.get(dll) ?? [];
        let t = L.rvaToOff(oft || ft);
        const step = plus ? 8 : 4;
        for (let k = 0; k < 5000 && t >= 0 && r.has(t, step); k++, t += step) {
          const val = plus ? r.u64(t) : BigInt(r.u32(t));
          if (val === 0n) break;
          const ordFlag = plus ? 1n << 63n : 1n << 31n;
          if (val & ordFlag) names.push(`#${Number(val & 0xffffn)}`);
          else {
            const nm = r.cstring(L.rvaToOff(Number(val & 0x7fffffffn)) + 2, 200);
            if (nm) names.push(nm);
          }
          importCount++;
          if (importCount > 40000) {
            notes.push('Import list capped at 40,000 entries.');
            break;
          }
        }
        importsByDll.set(dll, names);
      }
    }
    // delay-load
    const delayDir = L.dirs[13];
    const delayDlls: string[] = [];
    if (delayDir.rva) {
      let o = L.rvaToOff(delayDir.rva);
      for (let n = 0; n < 256 && o >= 0 && r.has(o, 32); n++, o += 32) {
        const nameRva = r.u32(o + 4);
        if (!nameRva) break;
        const dll = r.cstring(L.rvaToOff(nameRva), 128);
        if (dll) delayDlls.push(dll);
      }
    }

    // ---- exports
    const exportNames: string[] = [];
    const expDir = L.dirs[0];
    let dllName = '';
    if (expDir.rva) {
      const o = L.rvaToOff(expDir.rva);
      if (o >= 0 && r.has(o, 40)) {
        dllName = r.cstring(L.rvaToOff(r.u32(o + 12)), 128);
        const nNames = Math.min(r.u32(o + 24), 20000);
        const namesOff = L.rvaToOff(r.u32(o + 32));
        for (let i = 0; i < nNames && namesOff >= 0; i++) {
          const nm = r.cstring(L.rvaToOff(r.u32(namesOff + i * 4)), 200);
          if (nm) exportNames.push(nm);
        }
      }
    }

    // ---- sections
    const secRows: (string | number | null)[][] = [];
    let packed = false;
    let highEntExec = false;
    for (const s of L.secs) {
      const ent = s.rawSize > 0 && s.rawPtr + s.rawSize <= bytes.length ? entropy(bytes, s.rawPtr, s.rawPtr + s.rawSize) : null;
      const exec = (s.chars & 0x20000000) !== 0;
      if (PACKER_SECTIONS.test(s.name)) packed = true;
      if (ent !== null && ent > 7.2 && exec && s.rawSize > 4096) highEntExec = true;
      secRows.push([s.name, hexs(L.imageBase + s.vaddr), s.vsize, s.rawSize, (s.chars & 0x40000000 ? 'R' : '-') + (s.chars & 0x80000000 ? 'W' : '-') + (exec ? 'X' : '-'), ent]);
    }

    // ---- misc facts
    const isDll = (L.characteristics & 0x2000) !== 0;
    const managed = L.dirs[14].rva !== 0;
    const signedCert = L.dirs[4].rva !== 0 && L.dirs[4].size > 0;
    const hasResources = L.dirs[2].rva !== 0;
    const hasLoadConfig = L.dirs[10].rva !== 0;
    const hasTls = L.dirs[9].rva !== 0;
    const richIdx = (() => {
      const lim = Math.min(L.peOff, 1024);
      for (let i = 0x40; i + 4 <= lim; i += 4) if (bytes[i] === 0x52 && bytes[i + 1] === 0x69 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x68) return i;
      return -1;
    })();
    const ts = isoTime(L.timestamp);
    const asr = (L.dllChars & 0x40) !== 0, dep = (L.dllChars & 0x100) !== 0, cfg = (L.dllChars & 0x4000) !== 0, heva = (L.dllChars & 0x20) !== 0, noseh = (L.dllChars & 0x400) !== 0;
    const allImports = [...importsByDll.values()].flat();
    const caps = capabilitySummary(allImports);

    const findings: Finding[] = [];
    if (!asr) findings.push(finding('ASLR is off', 'notice', 'The file does not ask Windows to randomize its load address.', ['hardening']));
    if (!dep) findings.push(finding('DEP/NX compatibility is off', 'notice', 'Data pages may be executable.', ['hardening']));
    if (!cfg && !managed) findings.push(finding('Control Flow Guard not enabled', 'info', undefined, ['hardening']));
    if (!signedCert) findings.push(finding('No digital signature', 'info', 'The publisher cannot be verified from the file alone.', ['signature']));
    else findings.push(finding('Contains a digital signature block', 'info', 'The signature was NOT cryptographically verified by ReverseIt.', ['signature']));
    if (packed || highEntExec) findings.push(finding('Looks packed or protected', 'warning', 'The real code is probably unpacked when the program starts, so this static view is incomplete.', ['packed']));
    if (managed) findings.push(finding('This is a .NET (managed) program', 'info', 'See the .NET report for type and method names. .NET programs can often be recovered to near-original code.', ['dotnet']));
    if (ts && Math.abs(Date.now() / 1000 - L.timestamp) > 60 * 24 * 3600 && L.timestamp > 0 && new Date(L.timestamp * 1000).getFullYear() > new Date().getFullYear() + 1) findings.push(finding('Build timestamp is in the future', 'notice', ts, ['timestamp']));
    if (!ts) findings.push(finding('Build timestamp is blank or invalid', 'info', 'Common for reproducible builds.', ['timestamp']));
    for (const [cat, names] of caps) if (['Network access', 'Starts other programs', 'Loads code at runtime', 'Memory permissions', 'Hooks & input', 'Debugger checks'].includes(cat)) findings.push(finding(`Uses: ${cat.toLowerCase()}`, ['Hooks & input', 'Debugger checks', 'Memory permissions'].includes(cat) ? 'notice' : 'info', names.slice(0, 6).join(', '), ['capability']));

    const machineName = MACHINES[L.machine] ?? `machine 0x${L.machine.toString(16)}`;
    const sec: Section[] = [
      kv('Overview', {
        Kind: isDll ? 'DLL (library)' : 'Executable program',
        Architecture: machineName,
        Format: plus ? 'PE32+ (64-bit)' : 'PE32 (32-bit)',
        Subsystem: SUBSYSTEMS[L.subsystem] ?? String(L.subsystem),
        'Entry point (RVA)': hexs(L.entryRva),
        'Preferred load address': hexs(L.imageBase),
        'Build timestamp': ts,
        'Library name (exports)': dllName || null,
        '.NET managed code': managed,
        'Has resources (icons, version info)': hasResources,
        'Thread-local storage (TLS)': hasTls,
        'Visual Studio “Rich” header': richIdx >= 0,
        'Signature block present': signedCert,
      }),
      kv('Security hardening', { 'ASLR (randomized address)': asr, 'High-entropy ASLR': heva, 'DEP / NX': dep, 'Control Flow Guard': cfg, 'Safe-SEH not required': noseh, 'Load-config (security cookie) present': hasLoadConfig }),
      tags('Packer / protector hints', packed || highEntExec ? [{ label: packed ? 'Known packer section names' : 'High-entropy code section', tone: 'orange' }] : [{ label: 'None detected', tone: 'dim' }]),
      table('Imported libraries', ['Library', 'Functions imported', 'Examples'], [...importsByDll.entries()].map(([dll, fn]) => [dll, fn.length, fn.slice(0, 5).join(', ')]), opts.maxRows),
      list('Libraries loaded on demand (delay-load)', delayDlls),
      list('Functions it offers to others (exports)', exportNames),
      table('Sections', ['Name', 'Address', 'Virtual size', 'File size', 'Flags', 'Entropy'], secRows, 96),
    ];
    if (caps.size) sec.push(table('What the imports suggest it can do', ['Capability', 'Examples'], [...caps.entries()].map(([k, v]) => [k, v.slice(0, 8).join(', ')]), 20));
    sec.push(bars('Imported functions per library', [...importsByDll.entries()].map(([k, v]) => ({ label: k, value: v.length })).sort((a, b) => b.value - a.value), 10));

    const root = rootId(ctx);
    const nodes: GraphNode[] = [{ id: root, label: ctx.target.name, group: 'entry', weight: 8, detail: `${machineName} ${isDll ? 'DLL' : 'program'}` }];
    const edges: GraphEdge[] = [];
    for (const dll of [...importsByDll.keys()].slice(0, 20)) {
      nodes.push({ id: `lib:${dll.toLowerCase()}`, label: dll, group: 'lib', weight: 3 });
      edges.push({ from: root, to: `lib:${dll.toLowerCase()}`, label: 'imports' });
    }
    for (const [cat] of [...caps.entries()].slice(0, 8)) {
      nodes.push({ id: `cap:${cat}`, label: cat, group: 'native', weight: 4 });
      edges.push({ from: root, to: `cap:${cat}`, label: 'uses' });
    }

    if (!r.ok) notes.push('Some header fields pointed outside the file.');
    const ev = makeEvidence({
      operation: 'inspect_pe',
      title: 'Windows executable layout',
      target: ctx.target,
      summary: `${plus ? '64' : '32'}-bit ${machineName} Windows ${isDll ? 'library' : 'program'}${managed ? ' written for .NET' : ''}; ${importsByDll.size} imported librar${importsByDll.size === 1 ? 'y' : 'ies'}, ${exportNames.length} export(s)${packed ? '; appears packed' : ''}.`,
      normalized_result: {
        machine: machineName, format: plus ? 'PE32+' : 'PE32', kind: isDll ? 'dll' : 'exe', subsystem: SUBSYSTEMS[L.subsystem] ?? L.subsystem,
        entry_rva: hexs(L.entryRva), image_base: hexs(L.imageBase), timestamp: ts, managed, signed_block: signedCert, packed: packed || highEntExec,
        mitigations: { aslr: asr, high_entropy_aslr: heva, dep, cfg, no_seh: noseh },
        sections: L.secs.map((s) => ({ name: s.name, vsize: s.vsize, raw_size: s.rawSize })),
        imports: Object.fromEntries([...importsByDll.entries()].map(([k, v]) => [k, v.slice(0, 200)])),
        delay_imports: delayDlls, exports: exportNames.slice(0, 300), dll_name: dllName || null,
        capabilities: Object.fromEntries([...caps.entries()].map(([k, v]) => [k, v.slice(0, 8)])),
      },
      sections: sec,
      findings,
      graph: { nodes, edges },
      coverage: notes.length ? { status: 'partial', notes } : { status: 'complete' },
      limitations: [
        'Structural reading only: the program was not run, disassembled or decompiled.',
        'Imports show what the program can call, not what it actually calls at run time.',
        ...(managed ? ['This is a managed .NET assembly; native-level details here describe only the launcher stub.'] : []),
        ...notes.map((n) => clean(n, 200)),
      ],
    });
    return { evidence: [ev] };
  });
}
