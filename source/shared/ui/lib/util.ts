import type { AnalysisResult, Evidence } from '../../core/types';
import { createZip } from '../../core/zip';
import { evidenceToPrompt } from '../../core/summarize';
import { platform } from './platform';

export function coverageScore(r: AnalysisResult): number {
  if (!r.evidence.length) return 0;
  const w = { complete: 1, partial: 0.55, unknown: 0.1 } as Record<string, number>;
  return Math.round((r.evidence.reduce((a, e) => a + (w[e.coverage.status] ?? 0.3), 0) / r.evidence.length) * 100);
}

export function riskScore(r: AnalysisResult): { level: 'low' | 'medium' | 'high'; n: number } {
  const f = r.evidence.flatMap((e) => e.findings);
  const risk = f.filter((x) => x.severity === 'risk').length, warn = f.filter((x) => x.severity === 'warning').length;
  return { n: risk + warn, level: risk ? 'high' : warn ? 'medium' : 'low' };
}

export function allFindings(r: AnalysisResult) {
  const seen = new Set<string>();
  return r.evidence.flatMap((e) => e.findings).filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

export function technologies(r: AnalysisResult): string[] {
  const out = new Set<string>();
  for (const e of r.evidence) {
    const t = (e.normalized_result as any)?.technologies;
    if (Array.isArray(t)) for (const x of t) out.add(typeof x === 'string' ? x : x.name);
  }
  return [...out].slice(0, 40);
}

export function relativeTime(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString();
}

export function safeName(s: string): string {
  return (s || 'reverseit').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'reverseit';
}

export async function downloadZip(name: string, files: { path: string; data: string | Uint8Array }[]) {
  const bytes = await createZip(files);
  await platform().saveFile(name, bytes, 'application/zip');
}

export function evidenceMarkdown(r: AnalysisResult): string {
  const lines = [`# ReverseIt report: ${r.target.name}`, '', `- Kind: ${r.target.kind}${r.target.format ? ' / ' + r.target.format : ''}`, r.target.sha256 ? `- SHA-256: ${r.target.sha256}` : '', r.target.url ? `- URL: ${r.target.url}` : '', ''];
  for (const e of r.evidence) {
    lines.push(`## ${e.title}`, '', e.summary, '');
    for (const f of e.findings) lines.push(`- **${f.severity}** ${f.title}${f.detail ? ': ' + f.detail : ''}`);
    if (e.limitations.length) lines.push('', '_Limits:_ ' + e.limitations.join(' '), '');
  }
  if (r.unknowns.length) lines.push('## Open questions', '', ...r.unknowns.map((u) => `- ${u.question}`));
  return lines.filter((l) => l !== undefined).join('\n');
}

export const promptFor = (r: AnalysisResult) => evidenceToPrompt(r);
export type { Evidence };
