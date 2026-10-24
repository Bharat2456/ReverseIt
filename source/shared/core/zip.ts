/** ZIP reader/writer using only Web APIs (DecompressionStream / CompressionStream). */
import { Reader, decodeLatin1, decodeUtf8 } from './bytes';

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  crc: number;
  /** offset of the local file header */
  offset: number;
  isDir: boolean;
  encrypted: boolean;
  flags: number;
}

export interface ZipRead {
  entries: ZipEntry[];
  ok: boolean;
  notes: string[];
}

const MAX_ENTRIES = 200_000;

function decodeName(b: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return decodeUtf8(b);
  // Many tools write UTF-8 without the flag. Prefer UTF-8 when it round-trips cleanly.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return decodeLatin1(b);
  }
}

export function readZip(bytes: Uint8Array): ZipRead {
  const notes: string[] = [];
  const r = new Reader(bytes, true);
  const entries: ZipEntry[] = [];
  if (bytes.length < 22) return { entries, ok: false, notes: ['File is too small to be a ZIP archive.'] };

  // locate EOCD
  let eocd = -1;
  const minScan = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minScan; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) {
      eocd = i;
      break;
    }
  }
  if (eocd >= 0) {
    let total = r.u16(eocd + 10);
    let cdSize = r.u32(eocd + 12);
    let cdOff = r.u32(eocd + 16);
    if (total === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
      // zip64 locator sits 20 bytes before EOCD
      const loc = eocd - 20;
      if (loc >= 0 && r.u32(loc) === 0x07064b50) {
        const e64 = r.u64n(loc + 8);
        if (r.u32(e64) === 0x06064b50) {
          total = r.u64n(e64 + 32);
          cdSize = r.u64n(e64 + 40);
          cdOff = r.u64n(e64 + 48);
          notes.push('ZIP64 archive.');
        } else notes.push('ZIP64 record not found; using 32-bit values.');
      }
    }
    // Some archives have a prefix (self-extractors): correct the base offset.
    let base = 0;
    if (cdOff + cdSize !== eocd && r.u32(cdOff) !== 0x02014b50) {
      const guess = eocd - cdSize;
      if (guess >= 0 && r.u32(guess) === 0x02014b50) {
        base = guess - cdOff;
        cdOff = guess;
        notes.push(`Archive has ${base} bytes of data before it (self-extractor or appended stub).`);
      }
    }
    let p = cdOff;
    for (let n = 0; n < Math.min(total, MAX_ENTRIES); n++) {
      if (!r.has(p, 46) || r.u32(p) !== 0x02014b50) {
        notes.push('Central directory is damaged or truncated.');
        break;
      }
      const flags = r.u16(p + 8);
      const method = r.u16(p + 10);
      const crc = r.u32(p + 16);
      let comp = r.u32(p + 20);
      let size = r.u32(p + 24);
      const nameLen = r.u16(p + 28);
      const extraLen = r.u16(p + 30);
      const commentLen = r.u16(p + 32);
      let off = r.u32(p + 42);
      const nameBytes = r.slice(p + 46, nameLen);
      // zip64 extra
      if (size === 0xffffffff || comp === 0xffffffff || off === 0xffffffff) {
        let q = p + 46 + nameLen;
        const qEnd = q + extraLen;
        while (q + 4 <= qEnd) {
          const id = r.u16(q);
          const len = r.u16(q + 2);
          if (id === 1) {
            let z = q + 4;
            if (size === 0xffffffff) { size = r.u64n(z); z += 8; }
            if (comp === 0xffffffff) { comp = r.u64n(z); z += 8; }
            if (off === 0xffffffff) { off = r.u64n(z); z += 8; }
            break;
          }
          q += 4 + len;
        }
      }
      const name = decodeName(nameBytes, (flags & 0x800) !== 0);
      entries.push({
        name,
        size,
        compressedSize: comp,
        method,
        crc,
        offset: off + base,
        isDir: name.endsWith('/'),
        encrypted: (flags & 1) !== 0,
        flags,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.length) return { entries, ok: true, notes };
  } else {
    notes.push('End-of-central-directory record not found (archive may be truncated).');
  }

  // Fallback: forward scan of local headers.
  let p = 0;
  while (p + 30 <= bytes.length && entries.length < MAX_ENTRIES) {
    if (r.u32(p) !== 0x04034b50) {
      // look for the next signature
      let q = p + 1;
      while (q + 4 <= bytes.length && !(bytes[q] === 0x50 && bytes[q + 1] === 0x4b && bytes[q + 2] === 3 && bytes[q + 3] === 4)) q++;
      if (q + 4 > bytes.length) break;
      p = q;
      continue;
    }
    const flags = r.u16(p + 6);
    const method = r.u16(p + 8);
    const crc = r.u32(p + 14);
    const comp = r.u32(p + 18);
    const size = r.u32(p + 22);
    const nameLen = r.u16(p + 26);
    const extraLen = r.u16(p + 28);
    const name = decodeName(r.slice(p + 30, nameLen), (flags & 0x800) !== 0);
    const dataStart = p + 30 + nameLen + extraLen;
    if (!r.ok) break;
    entries.push({ name, size, compressedSize: comp, method, crc, offset: p, isDir: name.endsWith('/'), encrypted: (flags & 1) !== 0, flags });
    p = dataStart + comp;
    if (comp === 0 && (flags & 8) !== 0) p = dataStart; // sizes unknown (data descriptor); resume scanning
  }
  if (entries.length) notes.push('Entry list was rebuilt by scanning local headers; sizes may be unreliable.');
  return { entries, ok: entries.length > 0, notes };
}

async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array | undefined> {
  if (typeof DecompressionStream === 'undefined') return undefined;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    const writing = w.write(data as BufferSource).then(() => w.close()).catch(() => {});
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => {});
        await writing;
        return undefined;
      }
      chunks.push(value);
    }
    await writing;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Extract one entry. Returns undefined for encrypted, oversized, unsupported or damaged entries. */
export async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes = 64 * 1024 * 1024): Promise<Uint8Array | undefined> {
  if (entry.isDir || entry.encrypted) return undefined;
  if (entry.size > maxBytes) return undefined;
  const r = new Reader(bytes, true);
  if (r.u32(entry.offset) !== 0x04034b50) return undefined;
  const nameLen = r.u16(entry.offset + 26);
  const extraLen = r.u16(entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  if (!r.ok || start + entry.compressedSize > bytes.length) return undefined;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (entry.method === 8) return inflateRaw(data, maxBytes);
  return undefined;
}

// ---------------------------------------------------------------- writer

let CRC_TABLE: Uint32Array | undefined;
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Normalize a path for writing: forward slashes, no leading slash, no '.' or '..' segments. */
export function safeZipPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .join('/');
}

export interface ZipInputFile {
  path: string;
  data: Uint8Array | string;
}

interface Part {
  name: Uint8Array;
  method: number;
  crc: number;
  size: number;
  comp: Uint8Array;
}

function assemble(parts: Part[]): Uint8Array {
  let total = 22;
  for (const p of parts) total += 30 + p.name.length + p.comp.length + 46 + p.name.length;
  if (total > 0xffffffff || parts.length > 0xfffe) throw new Error('Archive too large for the ZIP writer (4 GiB / 65534 entries).');
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  for (const p of parts) {
    offsets.push(o);
    dv.setUint32(o, 0x04034b50, true);
    dv.setUint16(o + 4, 20, true);
    dv.setUint16(o + 6, 0x0800, true);
    dv.setUint16(o + 8, p.method, true);
    dv.setUint16(o + 10, 0, true);
    dv.setUint16(o + 12, 0x0021, true);
    dv.setUint32(o + 14, p.crc, true);
    dv.setUint32(o + 18, p.comp.length, true);
    dv.setUint32(o + 22, p.size, true);
    dv.setUint16(o + 26, p.name.length, true);
    dv.setUint16(o + 28, 0, true);
    out.set(p.name, o + 30);
    out.set(p.comp, o + 30 + p.name.length);
    o += 30 + p.name.length + p.comp.length;
  }
  const cdStart = o;
  parts.forEach((p, i) => {
    dv.setUint32(o, 0x02014b50, true);
    dv.setUint16(o + 4, 20, true);
    dv.setUint16(o + 6, 20, true);
    dv.setUint16(o + 8, 0x0800, true);
    dv.setUint16(o + 10, p.method, true);
    dv.setUint16(o + 12, 0, true);
    dv.setUint16(o + 14, 0x0021, true);
    dv.setUint32(o + 16, p.crc, true);
    dv.setUint32(o + 20, p.comp.length, true);
    dv.setUint32(o + 24, p.size, true);
    dv.setUint16(o + 28, p.name.length, true);
    dv.setUint32(o + 42, offsets[i], true);
    out.set(p.name, o + 46);
    o += 46 + p.name.length;
  });
  const cdSize = o - cdStart;
  dv.setUint32(o, 0x06054b50, true);
  dv.setUint16(o + 8, parts.length, true);
  dv.setUint16(o + 10, parts.length, true);
  dv.setUint32(o + 12, cdSize, true);
  dv.setUint32(o + 16, cdStart, true);
  return out;
}

function prepare(files: ZipInputFile[]): { name: Uint8Array; raw: Uint8Array }[] {
  const enc = new TextEncoder();
  const seen = new Set<string>();
  const res: { name: Uint8Array; raw: Uint8Array }[] = [];
  for (const f of files) {
    const p = safeZipPath(f.path);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    res.push({ name: enc.encode(p), raw: typeof f.data === 'string' ? enc.encode(f.data) : f.data });
  }
  return res;
}

/** STORE-only ZIP (synchronous). */
export function createZipStore(files: ZipInputFile[]): Uint8Array {
  return assemble(prepare(files).map((f) => ({ name: f.name, method: 0, crc: crc32(f.raw), size: f.raw.length, comp: f.raw })));
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    const writing = w.write(data as BufferSource).then(() => w.close()).catch(() => {});
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await writing;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Compressed ZIP (deflate where it helps, otherwise stored). */
export async function createZip(files: ZipInputFile[]): Promise<Uint8Array> {
  const parts: Part[] = [];
  for (const f of prepare(files)) {
    const crc = crc32(f.raw);
    let method = 0;
    let comp = f.raw;
    if (f.raw.length > 64) {
      const d = await deflateRaw(f.raw);
      if (d && d.length < f.raw.length) {
        method = 8;
        comp = d;
      }
    }
    parts.push({ name: f.name, method, crc, size: f.raw.length, comp });
  }
  return assemble(parts);
}
