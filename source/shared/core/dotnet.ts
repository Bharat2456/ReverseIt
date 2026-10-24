import type { AnalysisPart, ByteCtx } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, tags } from './sections';
import { Reader, decodeUtf8 } from './bytes';
import { parsePeLayout } from './pe';
import { safeAnalyze, rootId, clean } from './common';

/** Reads .NET metadata streams and lists the names stored in the #Strings heap. */
export async function analyzeDotnet(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_dotnet', '.NET assembly names', ctx, async () => {
    const { bytes } = ctx;
    const layout = parsePeLayout(bytes);
    if (!layout) throw new Error('Not a readable PE file');
    const cliDir = layout.dirs[14];
    if (!cliDir || !cliDir.rva) throw new Error('No .NET (CLR) header');
    const rvaToOff = layout.rvaToOff;
    const r = new Reader(bytes, true);
    const cliOff = rvaToOff(cliDir.rva);
    const mdRva = r.u32(cliOff + 8);
    const mdOff = rvaToOff(mdRva);
    if (mdOff < 0 || r.u32(mdOff) !== 0x424a5342) throw new Error('Metadata root not found');
    const verLen = r.u32(mdOff + 12);
    const version = r.cstring(mdOff + 16, verLen);
    let p = mdOff + 16 + verLen;
    const nStreams = r.u16(p + 2);
    p += 4;
    const streams: Record<string, { off: number; size: number }> = {};
    for (let i = 0; i < Math.min(nStreams, 16); i++) {
      const off = r.u32(p);
      const size = r.u32(p + 4);
      const name = r.cstring(p + 8, 32);
      streams[name] = { off: mdOff + off, size };
      p += 8 + ((name.length + 1 + 3) & ~3);
    }
    const strs = streams['#Strings'];
    const idents: string[] = [];
    if (strs) {
      let s = strs.off;
      const end = Math.min(strs.off + strs.size, bytes.length);
      while (s < end && idents.length < 20000) {
        let e = s;
        while (e < end && bytes[e] !== 0) e++;
        if (e > s) idents.push(decodeUtf8(bytes.subarray(s, e)));
        s = e + 1;
      }
    }
    const us = streams['#US'];
    const userStrings: string[] = [];
    if (us) {
      let s = us.off + 1;
      const end = Math.min(us.off + us.size, bytes.length);
      while (s < end && userStrings.length < 600) {
        let len = bytes[s++];
        if (len & 0x80) len = ((len & 0x3f) << 8) | bytes[s++];
        if (len > 1) userStrings.push(new TextDecoder('utf-16le').decode(bytes.subarray(s, s + len - 1)));
        s += len;
      }
    }
    const dotted = idents.filter((i) => /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/.test(i));
    const namespaces = [...new Set(dotted)].slice(0, 200);
    const pascal = idents.filter((i) => /^[A-Z][A-Za-z0-9]{2,}$/.test(i));
    const obfuscated = idents.length > 50 && idents.filter((i) => i.length <= 2 || /[^\x20-\x7e]/.test(i)).length / idents.length > 0.4;
    const root = rootId(ctx);
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_dotnet',
          title: '.NET assembly names',
          target: ctx.target,
          summary: `.NET assembly (runtime ${version}) with ${idents.length} names${obfuscated ? '; names look obfuscated' : ''}.`,
          normalized_result: { runtime_version: version, streams: Object.keys(streams), identifier_count: idents.length, namespaces, identifiers: pascal.slice(0, 300), user_strings: userStrings.slice(0, 200), obfuscated },
          sections: [
            kv('Overview', { 'Runtime metadata': version, Streams: Object.keys(streams).join(' '), 'Identifiers in metadata': idents.length, 'String literals': userStrings.length }),
            list('Namespaces and dotted names', namespaces),
            list('Type / method / member names (sample)', [...new Set(pascal)].slice(0, 300)),
            list('String literals in code', userStrings.map((u) => clean(u, 160))),
            tags('Notes', obfuscated ? [{ label: 'Names look obfuscated', tone: 'orange' as const }] : [{ label: 'Names are readable', tone: 'green' as const }]),
          ],
          findings: obfuscated ? [finding('Obfuscated names', 'notice', 'Most identifiers are 1–2 characters or unreadable, which hides the program structure.')] : [],
          graph: { nodes: [{ id: root, label: ctx.target.name, group: 'module', weight: 8 }], edges: [] },
          coverage: { status: 'partial', notes: ['Names were read from the metadata string heap; the metadata tables (which type owns which method) and the IL code were not decoded.'] },
          limitations: ['Use ILSpy or dnSpy to decompile method bodies.'],
        }),
      ],
    };
  });
}
