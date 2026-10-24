import type { AnalysisPart, ByteCtx, Finding, GraphEdge, GraphNode, Section } from './types';
import { makeEvidence } from './evidence';
import { bars, finding, kv, list, table, tags } from './sections';
import { Reader, entropy, decodeUtf8 } from './bytes';
import { capabilitySummary, hexs, rootId, safeAnalyze, clean } from './common';

const MACHINES: Record<number, string> = {
  2: 'SPARC', 3: 'x86 (32-bit)', 4: 'Motorola 68k', 8: 'MIPS', 20: 'PowerPC', 21: 'PowerPC 64', 22: 'IBM S/390', 40: 'ARM (32-bit)',
  42: 'SuperH', 43: 'SPARC v9', 62: 'x86-64', 94: 'Xtensa', 183: 'ARM 64-bit (AArch64)', 243: 'RISC-V', 247: 'eBPF', 258: 'LoongArch',
};
const TYPES: Record<number, string> = { 1: 'Relocatable object', 2: 'Executable', 3: 'Shared object / PIE executable', 4: 'Core dump' };
const OSABI: Record<number, string> = { 0: 'System V', 3: 'Linux (GNU)', 6: 'Solaris', 9: 'FreeBSD', 12: 'OpenBSD', 97: 'ARM' };

interface Section_ {
  name: string;
  type: number;
  flags: number;
  addr: number;
  offset: number;
  size: number;
  link: number;
  info: number;
  entsize: number;
}
interface Phdr {
  type: number;
  flags: number;
  offset: number;
  vaddr: number;
  filesz: number;
  memsz: number;
}

const PT_LOAD = 1, PT_DYNAMIC = 2, PT_INTERP = 3, PT_NOTE = 4, PT_GNU_STACK = 0x6474e551, PT_GNU_RELRO = 0x6474e552;
const SHT_SYMTAB = 2, SHT_STRTAB = 3, SHT_NOTE = 7, SHT_NOBITS = 8, SHT_DYNAMIC = 6, SHT_DYNSYM = 11;
const MAX_SYMS = 250_000;

function sectionTypeName(t: number): string {
  const m: Record<number, string> = { 0: 'NULL', 1: 'PROGBITS', 2: 'SYMTAB', 3: 'STRTAB', 4: 'RELA', 5: 'HASH', 6: 'DYNAMIC', 7: 'NOTE', 8: 'NOBITS', 9: 'REL', 11: 'DYNSYM', 14: 'INIT_ARRAY', 15: 'FINI_ARRAY', 0x6ffffff6: 'GNU_HASH', 0x6fffffff: 'VERSYM', 0x6ffffffe: 'VERNEED' };
  return m[t] ?? `0x${t.toString(16)}`;
}
function flagStr(f: number): string {
  return (f & 2 ? 'A' : '') + (f & 1 ? 'W' : '') + (f & 4 ? 'X' : '') || '-';
}

export async function analyzeElf(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_elf', 'ELF executable layout', ctx, async () => {
    const { bytes, opts } = ctx;
    const notes: string[] = [];
    const r = new Reader(bytes, true);
    if (bytes.length < 52) throw new Error('File is too small for an ELF header');
    const wide = bytes[4] === 2;
    const le = bytes[5] !== 2;
    r.le = le;
    const osabi = bytes[7];
    const type = r.u16(16);
    const machine = r.u16(18);
    const entry = r.word(wide, wide ? 24 : 24);
    const phoff = wide ? r.u64n(32) : r.u32(28);
    const shoff = wide ? r.u64n(40) : r.u32(32);
    const phentsize = r.u16(wide ? 54 : 42);
    const phnum = r.u16(wide ? 56 : 44);
    const shentsize = r.u16(wide ? 58 : 46);
    let shnum = r.u16(wide ? 60 : 48);
    const shstrndx = r.u16(wide ? 62 : 50);

    // ---- program headers
    const phdrs: Phdr[] = [];
    for (let i = 0; i < Math.min(phnum, 256); i++) {
      const o = phoff + i * phentsize;
      if (!r.has(o, wide ? 56 : 32)) {
        notes.push('Program header table is truncated.');
        break;
      }
      if (wide) {
        phdrs.push({ type: r.u32(o), flags: r.u32(o + 4), offset: r.u64n(o + 8), vaddr: r.u64n(o + 16), filesz: r.u64n(o + 32), memsz: r.u64n(o + 40) });
      } else {
        phdrs.push({ type: r.u32(o), offset: r.u32(o + 4), vaddr: r.u32(o + 8), filesz: r.u32(o + 16), memsz: r.u32(o + 20), flags: r.u32(o + 24) });
      }
    }
    const vaddrToOff = (va: number): number => {
      for (const p of phdrs) if (p.type === PT_LOAD && va >= p.vaddr && va < p.vaddr + p.filesz) return va - p.vaddr + p.offset;
      return -1;
    };

    // ---- section headers
    const sections: Section_[] = [];
    if (shnum === 0 && shoff && r.has(shoff, wide ? 64 : 40)) shnum = wide ? r.u64n(shoff + 32) : r.u32(shoff + 20);
    const rawSecs: { nameOff: number; s: Section_ }[] = [];
    for (let i = 0; i < Math.min(shnum, 4096); i++) {
      const o = shoff + i * shentsize;
      if (!shoff || !r.has(o, wide ? 64 : 40)) {
        if (shoff) notes.push('Section header table is truncated or missing.');
        break;
      }
      const nameOff = r.u32(o);
      const s: Section_ = wide
        ? { name: '', type: r.u32(o + 4), flags: r.u64n(o + 8), addr: r.u64n(o + 16), offset: r.u64n(o + 24), size: r.u64n(o + 32), link: r.u32(o + 40), info: r.u32(o + 44), entsize: r.u64n(o + 56) }
        : { name: '', type: r.u32(o + 4), flags: r.u32(o + 8), addr: r.u32(o + 12), offset: r.u32(o + 16), size: r.u32(o + 20), link: r.u32(o + 24), info: r.u32(o + 28), entsize: r.u32(o + 36) };
      rawSecs.push({ nameOff, s });
    }
    const shstr = rawSecs[shstrndx]?.s;
    for (const { nameOff, s } of rawSecs) {
      s.name = shstr && shstr.type === SHT_STRTAB ? r.cstring(shstr.offset + nameOff, 64) : '';
      sections.push(s);
    }
    const secByName = (n: string) => sections.find((s) => s.name === n);
    const strAt = (sec: Section_ | undefined, off: number, max = 512): string => (sec ? r.cstring(sec.offset + off, max) : '');

    // ---- interpreter
    let interp = '';
    const pInterp = phdrs.find((p) => p.type === PT_INTERP);
    if (pInterp) interp = r.cstring(pInterp.offset, Math.min(pInterp.filesz, 256));

    // ---- dynamic section
    const needed: string[] = [];
    let soname = '', rpath = '', runpath = '';
    let flags = 0, flags1 = 0, bindNow = false;
    let dynstrSec: Section_ | undefined;
    const dynSec = sections.find((s) => s.type === SHT_DYNAMIC);
    let dynOff = -1, dynSize = 0;
    if (dynSec) {
      dynOff = dynSec.offset;
      dynSize = dynSec.size;
      dynstrSec = sections[dynSec.link];
    } else {
      const pd = phdrs.find((p) => p.type === PT_DYNAMIC);
      if (pd) {
        dynOff = pd.offset;
        dynSize = pd.filesz;
      }
    }
    if (dynOff >= 0) {
      const esz = wide ? 16 : 8;
      const entries: [number, number][] = [];
      for (let o = dynOff; o + esz <= dynOff + dynSize && entries.length < 4096; o += esz) {
        const tag = wide ? r.u64n(o) : r.u32(o);
        const val = wide ? r.u64n(o + 8) : r.u32(o + 4);
        if (tag === 0) break;
        entries.push([tag, val]);
      }
      let strtabOff = dynstrSec ? dynstrSec.offset : -1;
      if (strtabOff < 0) {
        const st = entries.find((e) => e[0] === 5);
        if (st) strtabOff = vaddrToOff(st[1]);
      }
      const dstr = (off: number) => (strtabOff >= 0 ? r.cstring(strtabOff + off, 256) : '');
      for (const [tag, val] of entries) {
        if (tag === 1) needed.push(dstr(val));
        else if (tag === 14) soname = dstr(val);
        else if (tag === 15) rpath = dstr(val);
        else if (tag === 29) runpath = dstr(val);
        else if (tag === 30) flags = val;
        else if (tag === 0x6ffffffb) flags1 = val;
        else if (tag === 24) bindNow = true;
      }
      if (flags & 8 || flags1 & 1) bindNow = true;
    }

    // ---- symbols
    interface Sym { name: string; bind: number; type: number; shndx: number; value: number; size: number }
    const readSyms = (sec: Section_ | undefined): Sym[] => {
      const out: Sym[] = [];
      if (!sec) return out;
      const strsec = sections[sec.link];
      const esz = wide ? 24 : 16;
      const count = Math.min(Math.floor(sec.size / esz), MAX_SYMS);
      for (let i = 1; i < count; i++) {
        const o = sec.offset + i * esz;
        if (!r.has(o, esz)) break;
        const nm = r.u32(o);
        const info = wide ? r.u8(o + 4) : r.u8(o + 12);
        const shndx = wide ? r.u16(o + 6) : r.u16(o + 14);
        const value = wide ? r.u64n(o + 8) : r.u32(o + 4);
        const size = wide ? r.u64n(o + 16) : r.u32(o + 8);
        out.push({ name: nm && strsec ? r.cstring(strsec.offset + nm, 300) : '', bind: info >> 4, type: info & 15, shndx, value, size });
      }
      return out;
    };
    const dynsyms = readSyms(sections.find((s) => s.type === SHT_DYNSYM));
    const symtabSec = sections.find((s) => s.type === SHT_SYMTAB);
    const symtab = readSyms(symtabSec);
    const imports = dynsyms.filter((s) => s.shndx === 0 && s.name && (s.bind === 1 || s.bind === 2)).map((s) => s.name.split('@')[0]);
    const exportsDyn = dynsyms.filter((s) => s.shndx !== 0 && s.name && (s.bind === 1 || s.bind === 2) && (s.type === 2 || s.type === 1));
    const exportNames = exportsDyn.map((s) => s.name);
    const funcSyms = symtab.filter((s) => s.type === 2 && s.size > 0 && s.name).sort((a, b) => b.size - a.size);

    // ---- notes (build-id)
    let buildId = '';
    for (const s of sections) {
      if (s.type === SHT_NOTE && s.name === '.note.gnu.build-id' && s.size >= 16) {
        const namesz = r.u32(s.offset), descsz = r.u32(s.offset + 4);
        const d = r.slice(s.offset + 12 + ((namesz + 3) & ~3), Math.min(descsz, 64));
        buildId = [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    }
    if (!buildId) {
      const pn = phdrs.find((p) => p.type === PT_NOTE);
      if (pn && pn.filesz >= 16 && pn.filesz < 4096) {
        const namesz = r.u32(pn.offset), descsz = r.u32(pn.offset + 4), t = r.u32(pn.offset + 8);
        if (t === 3) buildId = [...r.slice(pn.offset + 12 + ((namesz + 3) & ~3), Math.min(descsz, 64))].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    }

    // ---- compiler comment
    const comment = secByName('.comment');
    const compilers: string[] = [];
    if (comment && comment.size > 0 && comment.size < 8192) {
      for (const part of decodeUtf8(r.slice(comment.offset, comment.size)).split('\0')) {
        const p = clean(part, 160);
        if (p && !compilers.includes(p)) compilers.push(p);
      }
    }

    // ---- mitigations
    const gnuStack = phdrs.find((p) => p.type === PT_GNU_STACK);
    const nx = gnuStack ? (gnuStack.flags & 1) === 0 : undefined;
    const hasRelro = phdrs.some((p) => p.type === PT_GNU_RELRO);
    const pie = type === 3 && (!!interp || (flags1 & 0x08000000) !== 0);
    const allNames = new Set<string>([...imports, ...symtab.map((s) => s.name)]);
    const canary = allNames.has('__stack_chk_fail') || allNames.has('__stack_chk_guard');
    const fortify = [...allNames].some((n) => /^__\w+_chk$/.test(n) && n !== '__stack_chk_fail');
    const stripped = !symtabSec;
    const hasDebug = sections.some((s) => s.name.startsWith('.debug_'));
    const debugLink = !!secByName('.gnu_debuglink');

    // ---- language / packer hints
    const hints: string[] = [];
    if (secByName('.go.buildinfo') || secByName('.gopclntab') || secByName('.note.go.buildid')) hints.push('Go');
    if (secByName('.rustc') || allNames.has('rust_eh_personality') || [...allNames].some((n) => n.startsWith('_ZN') && /17h[0-9a-f]{16}E$/.test(n))) hints.push('Rust');
    if (allNames.has('__gxx_personality_v0') || [...allNames].some((n) => n.startsWith('_ZN') || n.startsWith('_ZS'))) hints.push('C++');
    if (compilers.some((c) => /gcc|clang/i.test(c)) && !hints.length) hints.push('C / C++ toolchain');
    if (sections.some((s) => /^UPX/i.test(s.name)) || r.slice(0, Math.min(bytes.length, 4096)).join(',').includes('85,80,88,33')) hints.push('Packed with UPX');
    const needsPython = needed.some((n) => /libpython/.test(n));
    if (needsPython) hints.push('Embeds Python');

    // ---- entropy per section
    const secRows: (string | number | null)[][] = [];
    let highEntropyExec = false;
    for (let i = 0; i < Math.min(sections.length, 200); i++) {
      const s = sections[i];
      if (!s.name && s.type === 0) continue;
      const ent = s.type !== SHT_NOBITS && s.size > 0 && s.offset + s.size <= bytes.length ? entropy(bytes, s.offset, s.offset + s.size) : null;
      if (ent !== null && ent > 7.2 && s.flags & 4 && s.size > 4096) highEntropyExec = true;
      secRows.push([s.name || `#${i}`, sectionTypeName(s.type), hexs(s.addr), s.size, flagStr(s.flags), ent]);
    }

    // ---- capabilities
    const caps = capabilitySummary(imports);
    const libsByImport = needed.slice(0, 100);

    // ---- findings
    const findings: Finding[] = [];
    if (nx === false) findings.push(finding('Stack is executable (NX off)', 'warning', 'Memory the program uses for data can also run code, which makes exploits easier.', ['hardening']));
    if (type === 2 && !pie) findings.push(finding('Not position-independent (no PIE)', 'notice', 'Addresses are fixed, so attackers know where code lives.', ['hardening']));
    if (!hasRelro) findings.push(finding('No RELRO protection', 'notice', 'Dynamic-linking tables stay writable.', ['hardening']));
    else if (!bindNow) findings.push(finding('Partial RELRO only', 'info', 'Full RELRO needs immediate binding.', ['hardening']));
    if (!canary && imports.length) findings.push(finding('No stack canary detected', 'notice', 'The compiler did not add stack-smashing checks (or symbols are hidden).', ['hardening']));
    if (stripped) findings.push(finding('Symbols are stripped', 'info', 'Function names were removed. Analysis of what each function does will be harder.', ['stripped']));
    if (debugLink && !hasDebug) findings.push(finding('Debug symbols live in a separate file', 'info', 'A .gnu_debuglink points to a detached debug file that is not part of this upload.', ['debug']));
    if (hasDebug) findings.push(finding('Debug information is present', 'info', 'Original function and variable names may be recoverable.', ['debug']));
    if (highEntropyExec || hints.includes('Packed with UPX')) findings.push(finding('Code looks packed or encrypted', 'warning', 'High-randomness executable sections usually mean the real program is unpacked at run time. A static view will be incomplete.', ['packed']));
    for (const [cat, names] of caps) {
      if (['Network access', 'Starts other programs', 'Loads code at runtime', 'Cryptography'].includes(cat)) findings.push(finding(`Uses: ${cat.toLowerCase()}`, 'info', names.slice(0, 6).join(', '), ['capability']));
    }
    if (rpath || runpath) findings.push(finding('Custom library search path set', 'notice', rpath || runpath, ['linking']));

    // ---- evidence sections
    const machineName = MACHINES[machine] ?? `machine ${machine}`;
    const sec: Section[] = [
      kv('Overview', {
        'File type': TYPES[type] ?? `type ${type}`,
        Architecture: machineName,
        'Word size': wide ? '64-bit' : '32-bit',
        Endianness: le ? 'little' : 'big',
        'Target OS ABI': OSABI[osabi] ?? String(osabi),
        'Entry point': hexs(entry),
        'Program interpreter': interp || '(none: static or shared object)',
        'Library name (soname)': soname || null,
        'Build ID': buildId || null,
        Stripped: stripped,
        'Debug info': hasDebug,
      }),
      tags('Detected', [...hints.map((h) => ({ label: h, tone: 'cyan' as const })), ...compilers.slice(0, 3).map((c) => ({ label: c, tone: 'dim' as const }))]),
      kv('Security hardening', {
        'NX (non-executable stack)': nx === undefined ? 'unknown' : nx,
        'PIE (randomized load address)': pie,
        RELRO: hasRelro ? (bindNow ? 'full' : 'partial') : 'none',
        'Stack canary': canary,
        'FORTIFY_SOURCE': fortify,
      }),
      list('Libraries it needs', libsByImport),
      table('Sections', ['Name', 'Type', 'Address', 'Size', 'Flags', 'Entropy'], secRows, opts.maxRows),
      table('Segments', ['Type', 'Flags', 'Offset', 'Virtual address', 'File size', 'Memory size'], phdrs.map((p) => [p.type === PT_LOAD ? 'LOAD' : p.type === PT_DYNAMIC ? 'DYNAMIC' : p.type === PT_INTERP ? 'INTERP' : p.type === PT_NOTE ? 'NOTE' : p.type === PT_GNU_STACK ? 'GNU_STACK' : p.type === PT_GNU_RELRO ? 'GNU_RELRO' : `0x${p.type.toString(16)}`, (p.flags & 4 ? 'R' : '-') + (p.flags & 2 ? 'W' : '-') + (p.flags & 1 ? 'X' : '-'), hexs(p.offset), hexs(p.vaddr), p.filesz, p.memsz]), 64),
      list('Functions it calls from libraries (imports)', [...new Set(imports)]),
      list('Functions it offers to others (exports)', exportNames),
    ];
    if (caps.size) sec.push(table('What the imports suggest it can do', ['Capability', 'Examples'], [...caps.entries()].map(([k, v]) => [k, v.slice(0, 8).join(', ')]), 20));
    if (funcSyms.length) sec.push(table('Largest named functions', ['Name', 'Size', 'Address'], funcSyms.slice(0, 30).map((s) => [clean(s.name, 120), s.size, hexs(s.value)]), 30));
    sec.push(bars('Section sizes (top 8)', sections.filter((s) => s.type !== SHT_NOBITS && s.size > 0).sort((a, b) => b.size - a.size).slice(0, 8).map((s) => ({ label: s.name || '?', value: s.size }))));

    // ---- graph
    const root = rootId(ctx);
    const nodes: GraphNode[] = [{ id: root, label: ctx.target.name, group: 'entry', weight: 8, detail: `${machineName} ${TYPES[type] ?? ''}` }];
    const edges: GraphEdge[] = [];
    for (const lib of needed.slice(0, 20)) {
      nodes.push({ id: `lib:${lib}`, label: lib, group: 'lib', weight: 3 });
      edges.push({ from: root, to: `lib:${lib}`, label: 'links' });
    }
    for (const [cat] of [...caps.entries()].slice(0, 8)) {
      nodes.push({ id: `cap:${cat}`, label: cat, group: 'native', weight: 4 });
      edges.push({ from: root, to: `cap:${cat}`, label: 'uses' });
    }

    const partial = notes.length > 0;
    const ev = makeEvidence({
      operation: 'inspect_elf',
      title: 'Linux/Unix executable layout',
      target: ctx.target,
      summary: `${wide ? '64' : '32'}-bit ${machineName} ${TYPES[type]?.toLowerCase() ?? 'ELF file'}${stripped ? ', stripped' : ', with symbols'}; needs ${needed.length} librar${needed.length === 1 ? 'y' : 'ies'}, calls ${new Set(imports).size} imported functions.`,
      normalized_result: {
        class: wide ? 64 : 32, endian: le ? 'little' : 'big', type: TYPES[type] ?? type, machine: machineName, entry: hexs(entry), interpreter: interp || null,
        needed, soname: soname || null, rpath: rpath || null, runpath: runpath || null, build_id: buildId || null,
        mitigations: { nx: nx ?? null, pie, relro: hasRelro ? (bindNow ? 'full' : 'partial') : 'none', canary, fortify },
        stripped, has_debug: hasDebug, language_hints: hints, compilers,
        counts: { sections: sections.length, segments: phdrs.length, imports: new Set(imports).size, exports: exportNames.length, symbols: symtab.length },
        imports: [...new Set(imports)].slice(0, 300), exports: exportNames.slice(0, 300),
        capabilities: Object.fromEntries([...caps.entries()].map(([k, v]) => [k, v.slice(0, 8)])),
      },
      sections: sec,
      findings,
      graph: { nodes, edges },
      coverage: partial ? { status: 'partial', notes } : { status: 'complete' },
      limitations: [
        'This is a structural reading of the file; no code was run and nothing was disassembled or decompiled.',
        'Import names show what the program may call, not what it actually does at run time.',
        ...(stripped ? ['The file is stripped, so internal function names are not available.'] : []),
        ...notes,
      ],
    });
    return { evidence: [ev] };
  });
}
