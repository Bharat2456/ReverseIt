/** Bounds-checked binary reader. Out-of-range reads return 0 / '' and flip `ok` to false; they never throw. */
export class Reader {
  readonly view: DataView;
  ok = true;
  constructor(public readonly bytes: Uint8Array, public le = true, public pos = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.bytes.length;
  }
  has(at: number, n: number): boolean {
    return Number.isFinite(at) && at >= 0 && n >= 0 && at + n <= this.bytes.length;
  }
  private chk(at: number, n: number): boolean {
    if (!this.has(at, n)) {
      this.ok = false;
      return false;
    }
    return true;
  }
  seek(at: number): this {
    this.pos = at;
    return this;
  }
  u8(at = this.pos): number {
    if (!this.chk(at, 1)) return 0;
    if (at === this.pos) this.pos += 1;
    return this.bytes[at];
  }
  u16(at = this.pos): number {
    if (!this.chk(at, 2)) return 0;
    if (at === this.pos) this.pos += 2;
    return this.view.getUint16(at, this.le);
  }
  u32(at = this.pos): number {
    if (!this.chk(at, 4)) return 0;
    if (at === this.pos) this.pos += 4;
    return this.view.getUint32(at, this.le);
  }
  i32(at = this.pos): number {
    if (!this.chk(at, 4)) return 0;
    if (at === this.pos) this.pos += 4;
    return this.view.getInt32(at, this.le);
  }
  u64(at = this.pos): bigint {
    if (!this.chk(at, 8)) return 0n;
    if (at === this.pos) this.pos += 8;
    return this.view.getBigUint64(at, this.le);
  }
  /** u64 narrowed to a JS number (saturates at MAX_SAFE_INTEGER). */
  u64n(at = this.pos): number {
    const v = this.u64(at);
    return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
  }
  /** 4 or 8 byte unsigned depending on `wide`. */
  word(wide: boolean, at = this.pos): number {
    return wide ? this.u64n(at) : this.u32(at);
  }
  slice(at: number, n: number): Uint8Array {
    if (!this.chk(at, n)) return new Uint8Array(0);
    return this.bytes.subarray(at, at + n);
  }
  /** NUL-terminated latin1/utf8-ish string, bounded by `max`. */
  cstring(at: number, max = 4096): string {
    if (at < 0 || at >= this.bytes.length) {
      this.ok = false;
      return '';
    }
    let end = at;
    const lim = Math.min(this.bytes.length, at + max);
    while (end < lim && this.bytes[end] !== 0) end++;
    return decodeLatin1(this.bytes.subarray(at, end));
  }
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8', { fatal: false });
export function decodeLatin1(b: Uint8Array): string {
  return latin1.decode(b);
}
export function decodeUtf8(b: Uint8Array): string {
  return utf8.decode(b);
}

/** Shannon entropy in bits/byte (0..8) over a range, sampled for large ranges. */
export function entropy(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const s = Math.max(0, start);
  const e = Math.min(bytes.length, end);
  if (e <= s) return 0;
  const counts = new Uint32Array(256);
  const step = e - s > 8 * 1024 * 1024 ? Math.ceil((e - s) / (8 * 1024 * 1024)) : 1;
  let n = 0;
  for (let i = s; i < e; i += step) {
    counts[bytes[i]]++;
    n++;
  }
  let h = 0;
  for (let i = 0; i < 256; i++) {
    if (counts[i]) {
      const p = counts[i] / n;
      h -= p * Math.log2(p);
    }
  }
  return Math.round(h * 100) / 100;
}

export function u32be(b: Uint8Array, at: number): number {
  if (at + 4 > b.length || at < 0) return 0;
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}
export function u32le(b: Uint8Array, at: number): number {
  if (at + 4 > b.length || at < 0) return 0;
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}
export function startsWith(b: Uint8Array, sig: number[] | string, at = 0): boolean {
  const s = typeof sig === 'string' ? Array.from(sig, (c) => c.charCodeAt(0)) : sig;
  if (at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s[i]) return false;
  return true;
}
