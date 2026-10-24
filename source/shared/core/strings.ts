import type { AnalysisPart, ByteCtx, Finding, GraphNode, GraphEdge, Section } from './types';
import { makeEvidence } from './evidence';
import { bars, finding, kv, list, table, tags } from './sections';
import { scanSecrets, type SecretHit } from './secrets';
import { throwIfAborted, yieldToUi } from './options';
import { rootId, clean } from './common';

const CHUNK = 8 * 1024 * 1024;
const MAX_KEEP_LEN = 400;

export interface ExtractedStrings {
  ascii: string[];
  utf16: string[];
  totalAscii: number;
  totalUtf16: number;
  truncated: boolean;
}

export interface ExtractOptions {
  minLen?: number;
  /** Max number of strings retained per encoding. */
  maxCount?: number;
  signal?: AbortSignal;
}

const latin1 = new TextDecoder('latin1');

function isPrintable(b: number): boolean {
  return (b >= 0x20 && b <= 0x7e) || b === 0x09;
}

/** Extract printable ASCII and UTF-16LE runs. Deduplicates, keeps first-seen order. */
export async function extractStrings(bytes: Uint8Array, opts: ExtractOptions = {}): Promise<ExtractedStrings> {
  const minLen = opts.minLen ?? 5;
  const maxCount = opts.maxCount ?? 60000;
  const seenA = new Set<string>();
  const seenU = new Set<string>();
  const ascii: string[] = [];
  const utf16: string[] = [];
  let totalAscii = 0;
  let totalUtf16 = 0;
  let truncated = false;
  const n = bytes.length;

  let runStart = -1;
  let nextYield = CHUNK;
  for (let i = 0; i <= n; i++) {
    const printable = i < n && isPrintable(bytes[i]);
    if (printable) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const len = i - runStart;
      if (len >= minLen) {
        totalAscii++;
        const s = latin1.decode(bytes.subarray(runStart, Math.min(i, runStart + MAX_KEEP_LEN)));
        if (!seenA.has(s)) {
          if (ascii.length < maxCount) {
            seenA.add(s);
            ascii.push(s);
          } else truncated = true;
        }
      }
      runStart = -1;
    }
    if (i >= nextYield) {
      nextYield += CHUNK;
      throwIfAborted(opts.signal);
      await yieldToUi();
    }
  }

  // UTF-16LE runs: printable byte followed by 0x00, repeated.
  let i = 0;
  nextYield = CHUNK;
  while (i + 1 < n) {
    if (isPrintable(bytes[i]) && bytes[i + 1] === 0) {
      const start = i;
      let chars = '';
      let count = 0;
      while (i + 1 < n && isPrintable(bytes[i]) && bytes[i + 1] === 0) {
        if (count < MAX_KEEP_LEN) chars += String.fromCharCode(bytes[i]);
        count++;
        i += 2;
      }
      if (count >= minLen) {
        totalUtf16++;
        if (!seenU.has(chars)) {
          if (utf16.length < maxCount) {
            seenU.add(chars);
            utf16.push(chars);
          } else truncated = true;
        }
      }
      if (i === start) i++;
    } else i++;
    if (i >= nextYield) {
      nextYield += CHUNK;
      throwIfAborted(opts.signal);
      await yieldToUi();
    }
  }
  return { ascii, utf16, totalAscii, totalUtf16, truncated };
}

export interface ClassifiedStrings {
  urls: string[];
  domains: string[];
  ipv4: string[];
  emails: string[];
  paths: string[];
  versions: string[];
  sql: string[];
  messages: string[];
  base64: number;
  secrets: SecretHit[];
}

const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s"'<>\\^`{|}]{4,200}/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|co|cloud|xyz|info|us|uk|in|de|fr|jp|cn|ru|br|edu|gov|tv|online|site|tech|store|me)\b/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]{1,40}@[A-Za-z0-9.-]{1,60}\.[A-Za-z]{2,}\b/g;
const PATH_RE = /(?:\/(?:usr|etc|var|home|tmp|opt|bin|lib|lib64|proc|sys|Users|Library|System|Applications|private)\/[\w.\-/]{2,100})|(?:\b[A-Za-z]:\\(?:[\w.\- ]+\\)+[\w.\- ]*)/g;
const VERSION_RE = /\b[A-Za-z][\w.+-]{2,30}[ /_-]v?\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?\b/g;
const SQL_RE = /\b(?:SELECT\s.{1,120}\sFROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
const MSG_RE = /\b(?:error|failed|failure|invalid|cannot|can't|unable|denied|usage:|warning|unsupported|not found|timeout|exception)\b/i;
const B64_RE = /^[A-Za-z0-9+/]{60,}={0,2}$/;
const KNOWN_FILE_EXT = /\.(?:so|dll|dylib|exe|js|ts|py|rb|go|rs|c|h|cpp|cc|hpp|java|kt|swift|json|xml|yml|yaml|md|txt|log)$/i;

function pushUnique(arr: string[], v: string, max: number): void {
  if (arr.length < max && !arr.includes(v)) arr.push(v);
}

export function classifyStrings(strings: string[], maxEach = 200): ClassifiedStrings {
  const out: ClassifiedStrings = { urls: [], domains: [], ipv4: [], emails: [], paths: [], versions: [], sql: [], messages: [], base64: 0, secrets: [] };
  const urlSet = new Set<string>();
  const domSet = new Set<string>();
  const ipSet = new Set<string>();
  const mailSet = new Set<string>();
  const pathSet = new Set<string>();
  const verSet = new Set<string>();
  let secretBudget = 4 * 1024 * 1024;
  const secretChunks: string[] = [];

  for (const s of strings) {
    if (s.length < 5) continue;
    if (s.includes('://')) {
      for (const m of s.matchAll(URL_RE)) {
        const u = m[0].replace(/[.,;)\]]+$/, '');
        if (!urlSet.has(u) && urlSet.size < maxEach * 3) urlSet.add(u);
      }
    }
    if (s.includes('.')) {
      for (const m of s.matchAll(DOMAIN_RE)) {
        const d = m[0].toLowerCase();
        if (KNOWN_FILE_EXT.test(d)) continue;
        if (!domSet.has(d) && domSet.size < maxEach * 3) domSet.add(d);
      }
      for (const m of s.matchAll(IPV4_RE)) {
        const ip = m[0];
        const first = Number(ip.split('.')[0]);
        if (first === 0 || first >= 224 || first === 127) continue;
        if (ip.split('.').every((o) => Number(o) < 10)) continue; // looks like a version number
        if (!ipSet.has(ip) && ipSet.size < maxEach) ipSet.add(ip);
      }
    }
    if (s.includes('@')) {
      for (const m of s.matchAll(EMAIL_RE)) {
        const [local, host] = m[0].split('@');
        const masked = `${local[0]}***@${host}`;
        if (!mailSet.has(masked) && mailSet.size < 100) mailSet.add(masked);
      }
    }
    if (s.includes('/') || s.includes('\\')) {
      for (const m of s.matchAll(PATH_RE)) {
        if (!pathSet.has(m[0]) && pathSet.size < maxEach) pathSet.add(m[0]);
      }
    }
    if (/\d\.\d/.test(s) && s.length < 80) {
      for (const m of s.matchAll(VERSION_RE)) {
        if (!verSet.has(m[0]) && verSet.size < maxEach) verSet.add(m[0]);
      }
    }
    if (s.length > 12 && SQL_RE.test(s)) pushUnique(out.sql, clean(s, 220), 60);
    else if (s.length > 14 && s.includes(' ') && MSG_RE.test(s)) pushUnique(out.messages, clean(s, 200), 120);
    if (s.length >= 60 && B64_RE.test(s)) out.base64++;
    if (secretBudget > 0 && s.length >= 16) {
      secretChunks.push(s);
      secretBudget -= s.length;
    }
  }
  out.urls = [...urlSet].slice(0, maxEach);
  out.domains = [...domSet].slice(0, maxEach);
  out.ipv4 = [...ipSet];
  out.emails = [...mailSet];
  out.paths = [...pathSet];
  out.versions = [...verSet];
  out.secrets = scanSecrets(secretChunks.join('\n'), 40);
  return out;
}

/** Hosts commonly present in strings that are not interesting backend services. */
const NOISE_DOMAINS = /(?:^|\.)(?:w3\.org|schemas\.microsoft\.com|schemas\.openxmlformats\.org|apache\.org|example\.com|xmlsoap\.org|mozilla\.org|gnu\.org|openssl\.org|digicert\.com|verisign\.com|symantec\.com|microsoft\.com|ocsp\.[a-z.]+|crl\.[a-z.]+)$/i;

export async function analyzeStrings(ctx: ByteCtx): Promise<AnalysisPart> {
  const { bytes, opts } = ctx;
  opts.onProgress({ phase: 'strings', pct: 5, message: 'Reading readable text inside the file' });
  const ex = await extractStrings(bytes, { signal: opts.signal });
  const all = ex.ascii.concat(ex.utf16);
  const cls = classifyStrings(all, Math.max(60, Math.min(opts.maxRows, 200)));
  opts.onProgress({ phase: 'strings', pct: 90, message: 'Classifying strings' });

  const services = cls.domains.filter((d) => !NOISE_DOMAINS.test(d)).slice(0, 40);
  const root = rootId(ctx);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const d of services.slice(0, 25)) {
    nodes.push({ id: `svc:${d}`, label: d, group: 'service', weight: 3 });
    edges.push({ from: root, to: `svc:${d}`, label: 'mentions' });
  }

  const longest = [...all].sort((a, b) => b.length - a.length).slice(0, 15).map((s) => clean(s, 160));
  const findings: Finding[] = [];
  if (cls.secrets.some((s) => s.severity === 'risk')) {
    findings.push(
      finding(
        `Possible secrets are embedded in this file (${cls.secrets.filter((s) => s.severity === 'risk').length})`,
        'risk',
        'Values are masked in this report. Anything shipped inside a file can be read by anyone who has the file.',
        ['secrets'],
      ),
    );
  }
  if (cls.urls.length) findings.push(finding(`${cls.urls.length} web address(es) found inside the file`, 'info', 'These show which servers the program may talk to.', ['network']));
  if (cls.sql.length) findings.push(finding('Database queries are embedded', 'info', 'The program builds SQL statements; see the list of fragments.', ['database']));

  const sections: Section[] = [
    kv('Readable text', {
      'Plain-text strings': ex.totalAscii,
      'Wide (UTF-16) strings': ex.totalUtf16,
      'Unique kept for analysis': ex.ascii.length + ex.utf16.length,
      'Web addresses': cls.urls.length,
      'Domains': cls.domains.length,
      'IP addresses': cls.ipv4.length,
    }),
    list('Web addresses', cls.urls),
    list('Servers and domains mentioned', services),
    list('IP addresses (public-looking)', cls.ipv4),
    list('Email addresses (masked)', cls.emails),
    list('File paths', cls.paths),
    list('Product / library versions', cls.versions),
    list('Embedded database queries', cls.sql),
    list('Messages the program can show or log', cls.messages, 60),
    list('Longest readable strings', longest, 15),
  ].filter((s) => (s.kind === 'list' ? s.items.length > 0 : true));
  if (cls.secrets.length) {
    sections.push(
      table(
        'Possible secrets (masked)',
        ['Kind', 'Preview', 'Severity', 'Note'],
        cls.secrets.map((s) => [s.kind, s.preview, s.severity, s.note ?? '']),
        opts.maxRows,
      ),
    );
  }
  if (cls.base64) sections.push(tags('Encoded data', [{ label: `${cls.base64} long base64-like blobs`, tone: 'orange' }]));
  sections.push(
    bars('What the text is about', [
      { label: 'URLs', value: cls.urls.length },
      { label: 'Domains', value: cls.domains.length },
      { label: 'Paths', value: cls.paths.length },
      { label: 'SQL', value: cls.sql.length },
      { label: 'Messages', value: cls.messages.length },
    ]),
  );

  const ev = makeEvidence({
    operation: 'extract_strings',
    title: 'Readable text inside the file',
    target: ctx.target,
    summary: `Found ${ex.totalAscii + ex.totalUtf16} readable text fragments; ${cls.urls.length} web address(es), ${services.length} server name(s), ${cls.secrets.length} possible secret(s).`,
    normalized_result: {
      counts: { ascii: ex.totalAscii, utf16: ex.totalUtf16, kept: ex.ascii.length + ex.utf16.length },
      urls: cls.urls.slice(0, 200),
      domains: services,
      ipv4: cls.ipv4,
      emails: cls.emails,
      paths: cls.paths.slice(0, 100),
      versions: cls.versions.slice(0, 100),
      sql: cls.sql,
      messages: cls.messages.slice(0, 60),
      secrets: cls.secrets.map((s) => ({ kind: s.kind, preview: s.preview, severity: s.severity })),
    },
    sections,
    findings,
    graph: nodes.length ? { nodes, edges } : undefined,
    coverage: ex.truncated ? { status: 'partial', notes: ['Very large file: only the first 60,000 unique strings per encoding were kept.'] } : { status: 'complete' },
    limitations: [
      'Strings are only text that is stored in readable form. Text that is encrypted, compressed or built at run time will not appear here.',
      'A string being present does not prove the program uses it.',
      ...(ex.truncated ? ['String list was capped for very large files.'] : []),
    ],
  });
  return { evidence: [ev] };
}
