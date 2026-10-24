import type { Finding, Section, Severity, Tone } from './types';

/** Small constructors so analyzers stay short and consistently bounded. */

export function kv(title: string, rows: Record<string, string | number | boolean | null | undefined>, hints?: Record<string, string>): Section {
  return {
    kind: 'kv',
    title,
    rows: Object.entries(rows)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ({ k, v: v as string | number | boolean | null, ...(hints?.[k] ? { hint: hints[k] } : {}) })),
  };
}

export function table(title: string, columns: string[], rows: (string | number | null)[][], max = 200): Section {
  const truncated = rows.length > max;
  return { kind: 'table', title, columns, rows: truncated ? rows.slice(0, max) : rows, total: rows.length, truncated };
}

export function list(title: string, items: string[], max = 300): Section {
  const truncated = items.length > max;
  return { kind: 'list', title, items: truncated ? items.slice(0, max) : items, total: items.length, truncated };
}

export function tags(title: string, t: (string | { label: string; tone?: Tone })[]): Section {
  return { kind: 'tags', title, tags: t.map((x) => (typeof x === 'string' ? { label: x } : x)) };
}

export function text(title: string, body: string, mono = false): Section {
  return { kind: 'text', title, text: body, mono };
}

export function bars(title: string, items: { label: string; value: number }[], max = 20): Section {
  return { kind: 'bars', title, items: items.slice(0, max) };
}

let findingCounter = 0;
export function finding(title: string, severity: Severity = 'info', detail?: string, tagList?: string[]): Finding {
  findingCounter += 1;
  return { id: `f${findingCounter}`, title, severity, ...(detail ? { detail } : {}), ...(tagList?.length ? { tags: tagList } : {}) };
}

/** Human-friendly byte size. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function hex(n: number | bigint, pad = 0): string {
  return '0x' + n.toString(16).padStart(pad, '0');
}
