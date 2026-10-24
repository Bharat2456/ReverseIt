import { startsWith, u32be, u32le, decodeUtf8 } from './bytes';
import { readZip } from './zip';

export interface Sniffed {
  format: string;
  label: string;
}

const TEXT_EXT_JS = /\.(?:m?js|cjs|jsx|tsx?|mts|cts)$/i;

/** True when the first KiB look like text (no NULs, few control characters). */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  if (n === 0) return true;
  // UTF-16 BOM
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  return ctrl / n < 0.03;
}

export function sniffFormat(name: string, bytes: Uint8Array): Sniffed {
  const n = bytes.length;
  const lower = name.toLowerCase();
  if (n >= 4 && startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return { format: 'elf', label: 'ELF executable (Linux/Unix)' };
  if (n >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const off = bytes[0x3c] | (bytes[0x3d] << 8) | (bytes[0x3e] << 16) | (bytes[0x3f] << 24);
    if (off > 0 && off + 4 <= n && startsWith(bytes, [0x50, 0x45, 0, 0], off)) return { format: 'pe', label: 'Windows executable (PE)' };
    return { format: 'binary-unknown', label: 'DOS/legacy executable' };
  }
  if (n >= 8) {
    const m = u32be(bytes, 0);
    if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe) return { format: 'macho', label: 'macOS/iOS executable (Mach-O)' };
    if (m === 0xcafebabe) {
      const v = u32be(bytes, 4);
      if (v > 0 && v <= 30) return { format: 'macho', label: 'macOS/iOS universal binary (Mach-O fat)' };
      return { format: 'java-class', label: 'Java class file' };
    }
    if (m === 0xcafebabf) return { format: 'macho', label: 'macOS/iOS universal binary (Mach-O fat64)' };
  }
  if (n >= 8 && startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) return { format: 'wasm', label: 'WebAssembly module' };
  if (n >= 16 && startsWith(bytes, 'SQLite format 3\0')) return { format: 'sqlite', label: 'SQLite database' };
  if (n >= 4 && startsWith(bytes, 'dex\n')) return { format: 'dex', label: 'Android Dalvik bytecode (DEX)' };
  if (n >= 4 && startsWith(bytes, 'PK')) {
    const sig = u32le(bytes, 0);
    if (sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x02014b50) return refineZip(name, bytes);
  }
  if (isAsarHeader(bytes)) return { format: 'asar', label: 'Electron app archive (ASAR)' };
  if (n >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return { format: 'gzip', label: 'gzip-compressed data' };
  if (n >= 262 && startsWith(bytes, 'ustar', 257)) return { format: 'tar', label: 'tar archive' };
  if (n >= 5 && startsWith(bytes, '%PDF-')) return { format: 'pdf', label: 'PDF document' };
  if (n >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { format: 'png', label: 'PNG image' };
  if (n >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return { format: 'jpeg', label: 'JPEG image' };
  if (n >= 6 && startsWith(bytes, 'GIF8')) return { format: 'gif', label: 'GIF image' };
  if (n >= 12 && startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)) return { format: 'webp', label: 'WebP image' };
  if (n >= 4 && (startsWith(bytes, '7z\xbc\xaf') || startsWith(bytes, 'Rar!'))) return { format: 'archive-unsupported', label: 'Archive (7z/RAR) — unpack it first' };

  if (looksLikeText(bytes)) return sniffText(lower, bytes);
  return { format: 'binary-unknown', label: 'Unrecognized binary data' };
}

function sniffText(lower: string, bytes: Uint8Array): Sniffed {
  const head = decodeUtf8(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const trimmed = head.trimStart();
  const startsJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (lower.endsWith('.har') || (startsJson && /"log"\s*:\s*\{/.test(head) && /"entries"\s*:/.test(head))) {
    if (/"entries"\s*:|"log"\s*:/.test(head)) return { format: 'har', label: 'HTTP Archive (HAR) network capture' };
  }
  if (lower.endsWith('.map') || (startsJson && /"version"\s*:\s*3/.test(head) && /"(?:sources|sections)"\s*:/.test(head))) {
    return { format: 'sourcemap', label: 'JavaScript source map' };
  }
  if (lower.endsWith('.json') || lower.endsWith('.webmanifest') || (startsJson && looksJson(head))) return { format: 'json', label: 'JSON data' };
  if (/\.(?:html?|xhtml)$/.test(lower) || /^<!doctype html|^<html[\s>]/i.test(trimmed)) return { format: 'html', label: 'HTML page' };
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return { format: 'css', label: 'Stylesheet' };
  if (TEXT_EXT_JS.test(lower)) return { format: 'js', label: 'JavaScript / TypeScript source' };
  if (/(?:^|\n)\s*(?:import\s.+from\s|export\s|const\s+\w+\s*=|function\s+\w+\(|\(function\s*\(|"use strict"|!function\()/.test(head) && /[;{}]/.test(head)) {
    return { format: 'js', label: 'JavaScript source (detected from content)' };
  }
  if (/^<\?xml|^<[a-z][\w-]*[\s>]/i.test(trimmed)) return { format: 'text', label: 'XML / markup text' };
  return { format: 'text', label: 'Plain text' };
}

function looksJson(head: string): boolean {
  const t = head.trim();
  if (t.length < 2) return false;
  return /^[{[]\s*(?:"|\{|\[|\]|\}|\d|-|true|false|null)/.test(t);
}

/** Electron ASAR: Chromium pickle header, then a JSON tree. */
export function isAsarHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  if (u32le(bytes, 0) !== 4) return false;
  const headerSize = u32le(bytes, 4);
  const payload = u32le(bytes, 8);
  const strLen = u32le(bytes, 12);
  if (headerSize < 8 || headerSize > bytes.length) return false;
  if (payload < 4 || strLen === 0 || strLen > payload || 16 + strLen > bytes.length) return false;
  return startsWith(bytes, '{"files"', 16) || startsWith(bytes, '{ "files"', 16);
}

function refineZip(name: string, bytes: Uint8Array): Sniffed {
  const lower = name.toLowerCase();
  const byExt = (): Sniffed | undefined => {
    if (lower.endsWith('.apk') || lower.endsWith('.apks') || lower.endsWith('.xapk') || lower.endsWith('.aab')) return { format: 'apk', label: 'Android app package (APK)' };
    if (lower.endsWith('.ipa')) return { format: 'zip', label: 'iOS app package (IPA)' };
    if (/\.(?:jar|war|ear|aar)$/.test(lower)) return { format: 'zip', label: 'Java archive' };
    return undefined;
  };
  try {
    const z = readZip(bytes);
    if (z.ok) {
      const names = new Set<string>();
      for (const e of z.entries) {
        names.add(e.name);
        if (names.size > 5000) break;
      }
      if (names.has('AndroidManifest.xml') && [...names].some((x) => /^classes\d*\.dex$/.test(x) || x === 'resources.arsc')) {
        return { format: 'apk', label: 'Android app package (APK)' };
      }
      if (names.has('AndroidManifest.xml')) return { format: 'apk', label: 'Android package (manifest present)' };
      if ([...names].some((x) => /^Payload\/[^/]+\.app\//.test(x))) return { format: 'zip', label: 'iOS app package (IPA)' };
      if (names.has('[Content_Types].xml')) return { format: 'zip', label: 'Office Open XML document (zip)' };
      if (names.has('META-INF/MANIFEST.MF')) return { format: 'zip', label: 'Java archive (JAR/WAR)' };
      if (names.has('manifest.json') && (lower.endsWith('.crx') || lower.endsWith('.xpi') || lower.endsWith('.zip'))) return { format: 'zip', label: 'Browser extension / zip with manifest.json' };
    }
  } catch {
    /* fall through */
  }
  return byExt() ?? { format: 'zip', label: 'ZIP archive' };
}
