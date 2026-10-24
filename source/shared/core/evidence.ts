import type { Evidence, Graph, Finding, Section, TargetRef, CoverageStatus } from './types';
import { sha256HexOfString } from './hash';

/** Deterministic JSON: sorted keys, no undefined. Used for evidence identity. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = sortValue(x);
    }
    return o;
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export interface EvidenceInit {
  operation: string;
  title: string;
  target: TargetRef;
  summary: string;
  normalized_result: Record<string, unknown>;
  sections?: Section[];
  findings?: Finding[];
  graph?: Graph;
  coverage?: { status: CoverageStatus; notes?: string[] };
  limitations?: string[];
  analyzer?: string;
  provenance?: Evidence['provenance'];
  created_at?: string;
}

export const CORE_ANALYZER = 'reverseit-core@1';

/** Build a complete Evidence record with a content-derived id. */
export function makeEvidence(init: EvidenceInit): Evidence {
  const coverage = init.coverage ?? { status: 'complete' as CoverageStatus };
  const limitations = init.limitations ?? [];
  if (coverage.status !== 'complete' && limitations.length === 0) {
    limitations.push('Coverage is not complete; absence of an item in this record does not prove it is absent from the target.');
  }
  const id = 'ev_' + sha256HexOfString(stableStringify({ operation: init.operation, target: init.target, normalized_result: init.normalized_result }));
  return {
    evidence_id: id,
    operation: init.operation,
    title: init.title,
    analyzer: init.analyzer ?? CORE_ANALYZER,
    provenance: init.provenance ?? 'reverseit-core',
    created_at: init.created_at ?? new Date().toISOString(),
    target: init.target,
    summary: init.summary,
    normalized_result: init.normalized_result,
    sections: init.sections ?? [],
    findings: init.findings ?? [],
    ...(init.graph ? { graph: init.graph } : {}),
    coverage,
    limitations,
    untrusted_content: true,
  };
}
