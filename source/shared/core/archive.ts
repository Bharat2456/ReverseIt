import type { AnalysisPart, ByteCtx, Finding, RecoveredFile } from './types';
import { makeEvidence } from './evidence';
import { bars, finding, kv, list, table, fmtBytes } from './sections';
import { decodeUtf8 } from './bytes';
import { readZip, extractZipEntry, type ZipEntry } from './zip';
import { safeAnalyze, rootId, countBy, topN } from './common';

const TEXT_EXT = /\.(?:m?js|cjs|jsx|tsx?|html?|css|json|map|xml|ya?ml|md|txt|properties|gradle)$/i;

export async function zipTextEntries(bytes: Uint8Array, entries: ZipEntry[], maxFiles = 60, maxEach = 2 * 1024 * 1024, budget = 24 * 1024 * 1024) {
  const textEntries: { path: string; text: string }[] = [];
  const recovered: RecoveredFile[] = [];
  let used = 0;
  let truncated = false;
  let vendor = 0;
  const cands = entries.filter((e) => !e.isDir && !e.encrypted && TEXT_EXT.test(e.name) && e.size <= maxEach);
  cands.sort((a, b) => (/node_modules|vendor/.test(a.name) ? 1 : 0) - (/node_modules|vendor/.test(b.name) ? 1 : 0) || a.size - b.size);
  for (const e of cands) {
    if (textEntries.length >= maxFiles) break;
    if (/node_modules|vendor/.test(e.name) && ++vendor > 10) continue;
    const b = await extractZipEntry(bytes, e, maxEach);
    if (!b) continue;
    const t = decodeUtf8(b);
    if (used + t.length > budget) {
      truncated = true;
      break;
    }
    used += t.length;
    textEntries.push({ path: e.name, text: t });
    recovered.push({ path: e.name, kind: /\.(?:m?js|cjs|jsx|tsx?|css|html?)$/i.test(e.name) ? 'source' : 'config', size: e.size, text: t, origin: 'zip' });
  }
  return { textEntries, recovered, truncated };
}

export async function analyzeZip(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_archive', 'Archive contents', ctx, async () => {
    const { bytes } = ctx;
    const z = readZip(bytes);
    const files = z.entries.filter((e) => !e.isDir);
    const total = files.reduce((a, e) => a + e.size, 0);
    const ext = countBy(files, (e) => (e.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'none').toLowerCase());
    const nested = files.filter((e) => /\.(zip|jar|apk|aar|war|gz|tgz|asar|7z|rar)$/i.test(e.name));
    const encrypted = files.filter((e) => e.encrypted);
    const top = countBy(z.entries, (e) => e.name.split('/')[0]);
    let manifest = '';
    const mf = z.entries.find((e) => e.name === 'META-INF/MANIFEST.MF');
    if (mf) {
      const b = await extractZipEntry(bytes, mf, 64 * 1024);
      if (b) manifest = decodeUtf8(b);
    }
    const mainClass = manifest.match(/^Main-Class:\s*(.+)$/im)?.[1]?.trim();
    const { textEntries, recovered, truncated } = await zipTextEntries(bytes, z.entries, 60, 2 * 1024 * 1024, ctx.opts.maxRecoveredBytes);
    const findings: Finding[] = [];
    if (encrypted.length) findings.push(finding(`${encrypted.length} entries are password-protected`, 'warning', 'Their contents cannot be read without the password.'));
    if (total > 0 && bytes.length > 0 && total / bytes.length > 100) findings.push(finding('Extremely high compression ratio', 'warning', 'This can indicate a "zip bomb". ReverseIt only reads small entries.'));
    if (mainClass) findings.push(finding(`Runnable Java archive (Main-Class ${mainClass})`, 'info'));
    const kind = z.entries.some((e) => e.name === 'AndroidManifest.xml') ? 'Android package' : z.entries.some((e) => e.name.startsWith('Payload/')) ? 'iOS app package' : z.entries.some((e) => e.name === '[Content_Types].xml') ? 'Office document' : mainClass || z.entries.some((e) => /\.class$/.test(e.name)) ? 'Java archive' : 'ZIP archive';
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_archive',
          title: 'Archive contents',
          target: ctx.target,
          summary: `${kind} with ${files.length} files (${fmtBytes(total)} unpacked, ${fmtBytes(bytes.length)} packed).`,
          normalized_result: { kind, file_count: files.length, unpacked_bytes: total, packed_bytes: bytes.length, extensions: Object.fromEntries(topN(ext, 25).map((e) => [e.label, e.value])), top_level: [...top.keys()].slice(0, 50), nested_archives: nested.map((e) => e.name).slice(0, 50), main_class: mainClass ?? null, encrypted_entries: encrypted.length, notes: z.notes },
          sections: [
            kv('Overview', { Kind: kind, Files: files.length, 'Unpacked size': fmtBytes(total), 'Packed size': fmtBytes(bytes.length), 'Main class': mainClass ?? null, 'Password-protected entries': encrypted.length }),
            bars('File types', topN(ext, 14)),
            list('Top-level items', [...top.keys()]),
            list('Nested archives', nested.map((e) => e.name)),
            table('Largest files', ['File', 'Size'], [...files].sort((a, b) => b.size - a.size).slice(0, 40).map((e) => [e.name, fmtBytes(e.size)])),
          ],
          findings,
          graph: { nodes: [{ id: rootId(ctx), label: ctx.target.name, group: 'entry', weight: 8 }], edges: [] },
          coverage: { status: z.ok ? 'complete' : 'partial', notes: z.notes },
          limitations: ['Only the file list and small text files are read; nested archives are not unpacked.'],
        }),
      ],
      recovered,
      recoveredTruncated: truncated,
      textEntries,
    };
  });
}
