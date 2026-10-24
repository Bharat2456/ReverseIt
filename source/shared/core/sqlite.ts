import type { AnalysisPart, ByteCtx, Finding } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, table, fmtBytes } from './sections';
import { Reader, decodeUtf8 } from './bytes';
import { safeAnalyze, rootId, clean } from './common';

function varint(b: Uint8Array, p: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const x = b[p + i];
    if (x === undefined) return [v, i];
    if (i === 8) return [v * 256 + x, 9];
    v = v * 128 + (x & 0x7f);
    if (!(x & 0x80)) return [v, i + 1];
  }
  return [v, 9];
}

/** Reads only the schema (sqlite_master). Never reads table rows. */
export async function analyzeSqlite(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_sqlite', 'SQLite database schema', ctx, async () => {
    const { bytes } = ctx;
    const r = new Reader(bytes, false);
    if (bytes.length < 100) throw new Error('Too small for a SQLite database');
    let pageSize = r.u16(16);
    if (pageSize === 1) pageSize = 65536;
    const pages = r.u32(28);
    const encoding = ({ 1: 'UTF-8', 2: 'UTF-16le', 3: 'UTF-16be' } as Record<number, string>)[r.u32(56)] ?? 'unknown';
    const userVersion = r.u32(60);
    const appId = r.u32(68);
    const objs: { type: string; name: string; table: string; sql: string }[] = [];
    const notes: string[] = [];
    const readPage = (pageNo: number, hdrOff: number, depth = 0) => {
      if (depth > 6) return;
      const base = (pageNo - 1) * pageSize;
      const h = base + hdrOff;
      if (h + 8 > bytes.length) return;
      const type = bytes[h];
      const cells = r.u16(h + 3);
      if (type === 0x0d) {
        for (let i = 0; i < Math.min(cells, 5000); i++) {
          let c = base + r.u16(h + 8 + i * 2);
          let [, n] = varint(bytes, c);
          c += n;
          [, n] = varint(bytes, c); // rowid
          c += n;
          const [hdrLen, hn] = varint(bytes, c);
          let hp = c + hn;
          const dataStart = c + hdrLen;
          const types: number[] = [];
          while (hp < dataStart && types.length < 12) {
            const [t, tn] = varint(bytes, hp);
            types.push(t);
            hp += tn;
          }
          let dp = dataStart;
          const vals: string[] = [];
          for (const t of types) {
            let len = 0;
            if (t >= 13 && t % 2 === 1) len = (t - 13) / 2;
            else if (t >= 12 && t % 2 === 0) len = (t - 12) / 2;
            else len = ([0, 1, 2, 3, 4, 6, 8, 8, 0, 0] as number[])[t] ?? 0;
            vals.push(t >= 13 && t % 2 === 1 ? decodeUtf8(bytes.subarray(dp, dp + len)) : '');
            dp += len;
          }
          if (vals[0]) objs.push({ type: vals[0], name: vals[1], table: vals[2], sql: vals[4] ?? '' });
        }
      } else if (type === 0x05) {
        for (let i = 0; i < Math.min(cells, 2000); i++) {
          const child = r.u32(base + r.u16(h + 12 + i * 2));
          if (child > 0) readPage(child, 0, depth + 1);
        }
        const right = r.u32(h + 8);
        if (right > 0) readPage(right, 0, depth + 1);
      }
    };
    try {
      readPage(1, 100);
    } catch {
      notes.push('Schema page could not be fully read.');
    }
    if (!objs.length) {
      const re = /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF NOT EXISTS\s+)?["`\[]?([\w.]+)["`\]]?[^\u0000]{0,600}?(?=\u0000|$)/gi;
      const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 8 * 1024 * 1024)));
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) && objs.length < 300) objs.push({ type: m[1].toLowerCase(), name: m[2], table: m[2], sql: m[0].slice(0, 400) });
      if (objs.length) notes.push('Schema recovered by text search (page structure was unusual).');
    }
    const tables = objs.filter((o) => o.type === 'table');
    const findings: Finding[] = [];
    if (tables.some((t) => /pass(word)?|token|secret|credential/i.test(t.sql))) findings.push(finding('Table columns mention passwords, tokens or secrets', 'notice', 'Check how they are stored (hashed or plain text) before shipping.'));
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_sqlite',
          title: 'SQLite database schema',
          target: ctx.target,
          summary: `SQLite database with ${tables.length} tables and ${objs.length - tables.length} other objects (${fmtBytes(bytes.length)}).`,
          normalized_result: { page_size: pageSize, pages, encoding, user_version: userVersion, application_id: appId, objects: objs.slice(0, 300).map((o) => ({ type: o.type, name: o.name, table: o.table, sql: clean(o.sql, 500) })) },
          sections: [
            kv('Database', { Size: fmtBytes(bytes.length), 'Page size': pageSize, Pages: pages, Encoding: encoding, 'user_version': userVersion, Tables: tables.length }),
            table('Tables', ['Table', 'Definition'], tables.map((t) => [clean(t.name), clean(t.sql, 260)])),
            table('Indexes, views and triggers', ['Type', 'Name', 'On'], objs.filter((o) => o.type !== 'table').map((o) => [o.type, clean(o.name), clean(o.table)])),
          ],
          findings,
          graph: { nodes: [{ id: rootId(ctx), label: ctx.target.name, group: 'data', weight: 8 }, ...tables.slice(0, 14).map((t) => ({ id: `tbl:${t.name}`, label: clean(t.name, 28), group: 'data' as const, weight: 3 }))], edges: tables.slice(0, 14).map((t) => ({ from: rootId(ctx), to: `tbl:${t.name}`, label: 'table' })) },
          coverage: { status: notes.length ? 'partial' : 'complete', notes },
          limitations: ['Only the schema is read. Row contents are intentionally never extracted.'],
        }),
      ],
    };
  });
}
