import type { AnalysisResult, Evidence, Section } from './types';

function sectionText(s: Section, maxItems: number): string {
  switch (s.kind) {
    case 'kv': return `${s.title}: ` + s.rows.filter((r) => r.v !== null && r.v !== '').slice(0, maxItems).map((r) => `${r.k}=${r.v}`).join('; ');
    case 'list': return `${s.title}: ` + s.items.slice(0, maxItems).join(' | ');
    case 'tags': return `${s.title}: ` + s.tags.slice(0, maxItems).map((t) => t.label).join(', ');
    case 'table': return `${s.title}:\n` + s.rows.slice(0, maxItems).map((r) => '  ' + r.join(' | ')).join('\n');
    case 'bars': return `${s.title}: ` + s.items.slice(0, maxItems).map((i) => `${i.label}(${i.value})`).join(', ');
    case 'text': return `${s.title}: ${s.text.slice(0, 600)}`;
  }
}

/** One-paragraph brief per evidence record. */
export function evidenceBrief(ev: Evidence): string {
  return `[${ev.operation}] ${ev.summary}`;
}

/**
 * Builds the compact, bounded description of an investigation that is handed to an AI model.
 * Target-derived text is fenced and labelled untrusted so the model treats it as data.
 */
export function evidenceToPrompt(r: AnalysisResult, opts: { maxChars?: number; maxItems?: number } = {}): string {
  const maxChars = opts.maxChars ?? 60000;
  const maxItems = opts.maxItems ?? 25;
  const head = `TARGET: ${r.target.name} (${r.target.kind}${r.target.format ? ', ' + r.target.format : ''}${r.target.size ? ', ' + r.target.size + ' bytes' : ''}${r.target.url ? ', ' + r.target.url : ''})\n`;
  const parts: string[] = [head];
  for (const ev of r.evidence) {
    let block = `\n### ${ev.title}\n${ev.summary}\n`;
    for (const f of ev.findings.slice(0, 10)) block += `- finding (${f.severity}): ${f.title}${f.detail ? ' - ' + f.detail : ''}\n`;
    for (const s of ev.sections) {
      const t = sectionText(s, maxItems);
      if (t.length > 8) block += t.slice(0, 2500) + '\n';
    }
    if (ev.limitations.length) block += `Limits: ${ev.limitations.slice(0, 3).join(' ')}\n`;
    parts.push(block);
  }
  if (r.unknowns.length) parts.push('\nOPEN QUESTIONS:\n' + r.unknowns.map((u) => `- ${u.question}`).join('\n'));
  let out = parts.join('');
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n[...truncated to fit the model context]';
  return `<untrusted_target_data>\n${out}\n</untrusted_target_data>`;
}
