import type { AnalysisResult, ProgressEvent } from '../../core/types';
import { analyzeBytes, analyzeText } from '../../core/analyze';
import { platform } from './platform';
import { makeEvidence } from '../../core/evidence';
import { newId, saveInvestigation, type Investigation } from './db';

export type Source = { type: 'website'; url: string } | { type: 'file'; file: File } | { type: 'paste'; name: string; text: string };

export const MAX_FILE_BYTES = 300 * 1024 * 1024;

export function sourceTitle(r: AnalysisResult): string {
  return r.target.name || 'Untitled';
}

export async function runInvestigation(src: Source, onProgress: (p: ProgressEvent) => void, signal?: AbortSignal, engine?: { deep: boolean }): Promise<Investigation> {
  let result: AnalysisResult;
  let kind: Investigation['kind'];
  if (src.type === 'website') {
    const p = platform();
    if (!p.analyzeSite) throw new Error('Reading live websites is not available in this edition. Save the page (or a HAR capture) and upload it instead.');
    result = await p.analyzeSite(src.url, onProgress, signal);
    kind = 'website';
  } else if (src.type === 'file') {
    if (src.file.size > MAX_FILE_BYTES) throw new Error(`That file is ${(src.file.size / 1048576).toFixed(0)} MB. The limit in the browser is ${MAX_FILE_BYTES / 1048576} MB.`);
    onProgress({ phase: 'read', pct: 1, message: 'Loading the file' });
    const bytes = new Uint8Array(await src.file.arrayBuffer());
    result = await analyzeBytes({ name: src.file.name, bytes }, { onProgress, signal });
    kind = 'file';
    const pf = platform();
    if (engine && pf.engine) {
      try {
        onProgress({ phase: 'engine', pct: 1, message: 'Handing the file to the REA engine' });
        const evs = await pf.engine.run(src.file, engine.deep, onProgress, signal);
        result = { ...result, evidence: [...result.evidence, ...evs] };
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        result = { ...result, evidence: [...result.evidence, makeEvidence({ operation: 'rea:error', title: 'REA engine could not run', target: result.target, summary: String(e?.message ?? e).slice(0, 240), normalized_result: { error: String(e?.message ?? e).slice(0, 400) }, coverage: { status: 'unknown' }, limitations: ['The built-in analysis above is unaffected. The deeper REA results are missing.'], analyzer: 'reverseit-core@1' })] };
      }
    }
  } else {
    result = await analyzeText(src.name || 'pasted.txt', src.text, { onProgress, signal });
    kind = 'paste';
  }
  const inv: Investigation = { id: newId(), createdAt: Date.now(), title: sourceTitle(result), kind, result };
  await saveInvestigation(inv);
  return inv;
}
