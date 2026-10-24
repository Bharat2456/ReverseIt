import { useState } from 'react';
import type { Evidence, Finding, Graph, GraphGroup, Section } from '../../core/types';
import { Tag } from './ui';

export function SectionView({ s }: { s: Section }) {
  switch (s.kind) {
    case 'kv':
      return <dl className="kvs">{s.rows.filter((r) => r.v !== null && r.v !== '').map((r, i) => <div key={i} style={{ display: 'contents' }}><dt>{r.k}</dt><dd>{String(r.v)}</dd></div>)}</dl>;
    case 'table':
      return (
        <div>
          <div className="tablewrap"><table><thead><tr>{s.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c === null ? '' : String(c)}</td>)}</tr>)}</tbody></table></div>
          {s.truncated && <div className="hint" style={{ marginTop: 6 }}>Showing {s.rows.length} of {s.total} rows. Export the investigation to get everything.</div>}
        </div>
      );
    case 'list':
      return (
        <div>
          <ul className="biglist">{s.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {s.truncated && <div className="hint" style={{ marginTop: 6 }}>Showing {s.items.length} of {s.total}.</div>}
        </div>
      );
    case 'tags':
      return <div>{s.tags.map((t, i) => <Tag key={i} tone={t.tone === 'cyan' ? '' : t.tone}>{t.label}</Tag>)}</div>;
    case 'text':
      return s.mono ? <pre><code>{s.text}</code></pre> : <p style={{ whiteSpace: 'pre-wrap' }}>{s.text}</p>;
    case 'bars': {
      const max = Math.max(1, ...s.items.map((i) => i.value));
      return <div>{s.items.map((b, i) => <div className="bar" key={i}><span title={b.label}>{b.label}</span><div><i style={{ width: (b.value / max) * 100 + '%' }} /></div><span style={{ textAlign: 'right' }}>{b.value}</span></div>)}</div>;
    }
  }
}

function isEmpty(s: Section): boolean {
  if (s.kind === 'kv') return !s.rows.some((r) => r.v !== null && r.v !== '');
  if (s.kind === 'table') return !s.rows.length;
  if (s.kind === 'list') return !s.items.length;
  if (s.kind === 'tags') return !s.tags.length;
  if (s.kind === 'bars') return !s.items.length;
  if (s.kind === 'text') return !s.text.trim();
  return false;
}

export function SectionList({ sections, openFirst = 2 }: { sections: Section[]; openFirst?: number }) {
  const shown = sections.filter((s) => !isEmpty(s));
  return (
    <div>
      {shown.map((s, i) => (
        <details className="sec" key={i} open={i < openFirst}>
          <summary><span>{s.title}</span><span className="muted" style={{ letterSpacing: 0 }}>{s.kind === 'table' ? `${s.total ?? s.rows.length} rows` : s.kind === 'list' ? `${s.total ?? s.items.length} items` : ''}</span></summary>
          <div className="body"><SectionView s={s} /></div>
        </details>
      ))}
    </div>
  );
}

export function Findings({ items }: { items: Finding[] }) {
  if (!items.length) return <div className="muted">Nothing notable was flagged.</div>;
  const order = { risk: 0, warning: 1, notice: 2, info: 3 } as Record<string, number>;
  return (
    <div>
      {[...items].sort((a, b) => order[a.severity] - order[b.severity]).map((f) => (
        <div key={f.id} style={{ padding: '8px 0', borderBottom: '1px dashed rgba(25,227,255,.12)' }}>
          <div><i className={'sev s-' + f.severity} /><strong>{f.title}</strong> <span className="muted" style={{ fontSize: '.72rem', letterSpacing: '.12em', textTransform: 'uppercase' }}>{f.severity}</span></div>
          {f.detail && <div className="muted" style={{ marginLeft: 16, fontSize: '.88rem' }}>{f.detail}</div>}
        </div>
      ))}
    </div>
  );
}

export function EvidenceCard({ ev, defaultOpen }: { ev: Evidence; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="row spread" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div>
          <div className="kicker">{ev.operation}</div>
          <h3 style={{ margin: '2px 0' }}>{ev.title}</h3>
          <div className="muted" style={{ fontSize: '.9rem' }}>{ev.summary}</div>
        </div>
        <div className="row"><Tag tone={ev.coverage.status === 'complete' ? 'green' : 'orange'}>{ev.coverage.status}</Tag><span className="muted">{open ? '▾' : '▸'}</span></div>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          {ev.findings.length > 0 && <details className="sec" open><summary><span>Findings</span><span className="muted">{ev.findings.length}</span></summary><div className="body"><Findings items={ev.findings} /></div></details>}
          <SectionList sections={ev.sections} openFirst={1} />
          <details className="sec"><summary><span>What this does NOT show</span></summary><div className="body"><ul className="biglist">{ev.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div></details>
          <div className="hint mono" style={{ marginTop: 8, wordBreak: 'break-all' }}>{ev.evidence_id} · {ev.analyzer}</div>
        </div>
      )}
    </div>
  );
}

const GROUP_COLOR: Record<GraphGroup, string> = { entry: '#ff8a1f', ui: '#19e3ff', module: '#4a9bff', api: '#3dffa0', service: '#ffd23f', data: '#c58bff', native: '#ff4d5e', lib: '#7f9bb0', config: '#9fb3c4', unknown: '#4b6377' };
const GROUP_LABEL: Record<GraphGroup, string> = { entry: 'Entry', ui: 'Screens', module: 'Code', api: 'APIs', service: 'Outside services', data: 'Data', native: 'System access', lib: 'Libraries', config: 'Config', unknown: 'Unknown' };
const ORDER: GraphGroup[] = ['entry', 'ui', 'module', 'api', 'service', 'data', 'native', 'lib', 'config', 'unknown'];

/** Layered architecture diagram: one column per kind of part, edges drawn as curves. */
export function GraphView({ graph }: { graph: Graph }) {
  const [sel, setSel] = useState('');
  if (!graph.nodes.length) return <div className="muted">No architecture could be drawn from this evidence.</div>;
  const cols = ORDER.filter((g) => graph.nodes.some((n) => n.group === g));
  const W = 176, H = 38, GX = 70, GY = 16, PAD = 24;
  const pos = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  cols.forEach((g, ci) => {
    const ns = graph.nodes.filter((n) => n.group === g).sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
    maxRows = Math.max(maxRows, ns.length);
    ns.forEach((n, ri) => pos.set(n.id, { x: PAD + ci * (W + GX), y: PAD + ri * (H + GY) }));
  });
  const width = PAD * 2 + cols.length * W + (cols.length - 1) * GX;
  const height = PAD * 2 + maxRows * H + (maxRows - 1) * GY;
  const node = graph.nodes.find((n) => n.id === sel);
  const touch = new Set<string>();
  if (sel) { touch.add(sel); graph.edges.forEach((e) => { if (e.from === sel) touch.add(e.to); if (e.to === sel) touch.add(e.from); }); }
  return (
    <div>
      <div className="graphbox">
        <svg width={width} height={Math.max(height, 120)} viewBox={`0 0 ${width} ${Math.max(height, 120)}`} role="img" aria-label="Architecture diagram">
          {graph.edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to);
            if (!a || !b) return null;
            const same = a.x === b.x;
            const x1 = same ? a.x + W : a.x < b.x ? a.x + W : a.x, y1 = a.y + H / 2;
            const x2 = same ? b.x + W : a.x < b.x ? b.x : b.x + W, y2 = b.y + H / 2;
            const dx = same ? 60 : Math.max(30, Math.abs(x2 - x1) / 2) * (a.x < b.x ? 1 : -1);
            const hot = !sel || (touch.has(e.from) && touch.has(e.to));
            return <path key={i} d={`M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - (same ? -60 : dx)} ${y2} ${x2} ${y2}`} fill="none" stroke="#19e3ff" strokeOpacity={hot ? 0.5 : 0.08} strokeWidth={hot && sel ? 1.8 : 1.1} />;
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const c = GROUP_COLOR[n.group];
            const dim = sel && !touch.has(n.id);
            return (
              <g key={n.id} className={'gnode' + (sel === n.id ? ' sel' : '')} transform={`translate(${p.x} ${p.y})`} onClick={() => setSel(sel === n.id ? '' : n.id)} opacity={dim ? 0.3 : 1} style={{ color: c }} tabIndex={0} role="button" aria-label={n.label} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') setSel(sel === n.id ? '' : n.id); }}>
                <rect width={W} height={H} fill="#07111f" stroke={c} strokeWidth="1.2" rx="3" />
                <rect width="4" height={H} fill={c} />
                <text x="14" y={H / 2 + 4.5} fill="#d3ebf7" fontSize="12" fontFamily="ui-monospace,Menlo,Consolas,monospace">{n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}</text>
                <title>{n.label}{n.detail ? ' — ' + n.detail : ''}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend">{cols.map((g) => <span key={g}><i style={{ background: GROUP_COLOR[g] }} />{GROUP_LABEL[g]}</span>)}</div>
      {node && <div className="notice info" style={{ marginTop: 10 }}><strong>{node.label}</strong> · {GROUP_LABEL[node.group]}{node.detail ? ' · ' + node.detail : ''} · connected to {Math.max(0, touch.size - 1)} other part(s)</div>}
    </div>
  );
}
