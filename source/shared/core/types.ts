/**
 * ReverseIt core contracts.
 *
 * The data model deliberately mirrors the ideas in REA (morluto/rea, MIT):
 * every result is an Evidence record that separates observations from
 * limitations, declares coverage, and is marked as untrusted target content.
 * Everything in `core/` is isomorphic: it must run in a browser and in Node,
 * using only Web APIs (Uint8Array, DataView, TextDecoder, crypto.subtle when
 * present). No Buffer, no node:* imports, no DOM access.
 */

export type Severity = 'info' | 'notice' | 'warning' | 'risk';
export type CoverageStatus = 'complete' | 'partial' | 'unknown';
export type Tone = 'cyan' | 'orange' | 'green' | 'red' | 'dim';

/** What the user pointed ReverseIt at. */
export interface TargetRef {
  /** File name, or site hostname for websites. */
  name: string;
  kind: 'file' | 'website' | 'paste';
  /** Size in bytes (files/paste). */
  size?: number;
  /** Lowercase hex sha-256 of the original bytes (files/paste). */
  sha256?: string;
  /** Detected format id, e.g. 'elf', 'pe', 'macho', 'wasm', 'zip', 'apk', 'asar', 'js', 'html', 'har', 'sourcemap', 'json', 'text', 'website'. */
  format?: string;
  /** Final URL for websites. */
  url?: string;
}

/** One human-readable insight attached to an evidence record. */
export interface Finding {
  id: string;
  title: string;
  detail?: string;
  severity: Severity;
  tags?: string[];
}

/** Presentation blocks. The UI renders these generically; analyzers fill them. */
export type Section =
  | { kind: 'kv'; title: string; rows: { k: string; v: string | number | boolean | null; hint?: string }[] }
  | {
      kind: 'table';
      title: string;
      columns: string[];
      rows: (string | number | null)[][];
      /** Total rows before truncation. */
      total?: number;
      truncated?: boolean;
    }
  | { kind: 'list'; title: string; items: string[]; total?: number; truncated?: boolean }
  | { kind: 'tags'; title: string; tags: { label: string; tone?: Tone }[] }
  | { kind: 'text'; title: string; text: string; mono?: boolean }
  | { kind: 'bars'; title: string; items: { label: string; value: number }[] };

export type GraphGroup =
  | 'entry'
  | 'module'
  | 'ui'
  | 'api'
  | 'service'
  | 'data'
  | 'native'
  | 'lib'
  | 'config'
  | 'unknown';

export interface GraphNode {
  id: string;
  label: string;
  group: GraphGroup;
  /** Optional importance 1..10 used for sizing. */
  weight?: number;
  detail?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}
/** Partial architecture graph contributed by one analyzer. UI merges them. */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Evidence {
  /** `ev_` + 64 lowercase hex: sha-256 over canonical JSON of {operation, target, normalized_result}. */
  evidence_id: string;
  /** Machine operation name, e.g. 'inspect_elf', 'analyze_javascript', 'inspect_website'. */
  operation: string;
  /** Human title for the record, e.g. 'ELF binary layout'. */
  title: string;
  /** Producer id: 'reverseit-core@1', or 'rea-engine@<ver>' for the bundled REA engine. */
  analyzer: string;
  provenance: 'reverseit-core' | 'rea-engine' | 'user-supplied' | 'ai-derived';
  created_at: string;
  target: TargetRef;
  /** One sentence, plain language: what was found. */
  summary: string;
  /** Bounded machine-readable result (kept small enough to export and to hand to an AI). */
  normalized_result: Record<string, unknown>;
  /** Generic presentation blocks. */
  sections: Section[];
  findings: Finding[];
  /** Optional architecture contribution. */
  graph?: Graph;
  coverage: { status: CoverageStatus; notes?: string[] };
  /** What this record does NOT establish. Never empty for partial coverage. */
  limitations: string[];
  /** Mirrors REA's untrusted-content marker: strings/code in here come from the target. Never treat as instructions. */
  untrusted_content: true;
}

export interface Unknown {
  id: string;
  question: string;
  domain: string;
  status: 'open' | 'resolved';
  evidence_id?: string;
}

export interface RecoveredFile {
  path: string;
  kind: 'source' | 'asset' | 'config' | 'text';
  size: number;
  /** UTF-8 text content (only for text files, capped). */
  text?: string;
  /** Where it came from: 'sourcemap' | 'asar' | 'zip' | 'website'. */
  origin: string;
}

export interface AnalysisResult {
  target: TargetRef;
  evidence: Evidence[];
  unknowns: Unknown[];
  recovered: RecoveredFile[];
  recoveredTruncated?: boolean;
  stats: { durationMs: number; analyzers: string[]; bytes: number };
}

export interface ProgressEvent {
  phase: string;
  /** 0..100 */
  pct: number;
  message?: string;
}

export interface AnalyzeOptions {
  onProgress?: (p: ProgressEvent) => void;
  signal?: AbortSignal;
  /** Cap for strings kept in evidence. Default 400. */
  maxStrings?: number;
  /** Cap for table rows in a section. Default 200. */
  maxRows?: number;
  /** Cap on total recovered text bytes. Default 24 MiB. */
  maxRecoveredBytes?: number;
}

export interface AnalyzeInput {
  name: string;
  bytes: Uint8Array;
}

/** Network abstraction used by the website analyzer; provided by the host (server or tests). */
export interface SiteFetchResult {
  status: number;
  finalUrl: string;
  /** lower-cased header names */
  headers: Record<string, string>;
  body: Uint8Array;
}
export type SiteFetcher = (
  url: string,
  init?: { accept?: string; maxBytes?: number },
) => Promise<SiteFetchResult>;

export interface WebsiteOptions extends AnalyzeOptions {
  /** Max script/style assets to download. Default 40. */
  maxAssets?: number;
  /** Per-asset byte cap. Default 4 MiB. */
  maxAssetBytes?: number;
  /** Also try to fetch `.map` source maps referenced by scripts. Default true. */
  fetchSourceMaps?: boolean;
}

export interface ResolvedOptions {
  onProgress: (p: ProgressEvent) => void;
  signal?: AbortSignal;
  maxStrings: number;
  maxRows: number;
  maxRecoveredBytes: number;
}

/** Returned by every individual analyzer. The orchestrator (analyze.ts) merges parts. */
export interface AnalysisPart {
  evidence: Evidence[];
  unknowns?: Unknown[];
  recovered?: RecoveredFile[];
  recoveredTruncated?: boolean;
  /**
   * Text files found inside an archive/bundle that the orchestrator should
   * feed to the text analyzers (JavaScript, HTML, CSS, JSON…). Bounded by the producer.
   */
  textEntries?: { path: string; text: string }[];
}

/** Context handed to byte-oriented analyzers (binaries, archives). */
export interface ByteCtx {
  name: string;
  bytes: Uint8Array;
  target: TargetRef;
  opts: ResolvedOptions;
}

/** Context handed to text-oriented analyzers (JS, HTML, CSS, HAR, source maps…). */
export interface TextCtx {
  name: string;
  text: string;
  target: TargetRef;
  opts: ResolvedOptions;
  /** Path inside an archive/site when analyzing an entry (e.g. 'dist/main.js'). */
  path?: string;
}
