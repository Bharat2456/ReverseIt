import { useEffect, useState } from 'react';
import { Panel, PageHead, Tag, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { Link, navigate } from '../lib/router';
import { appPath } from '../lib/paths';
import { clearInvestigations, deleteInvestigation, listInvestigations, saveInvestigation, type Investigation } from '../lib/db';
import { makeDemoInvestigation } from '../lib/demo';
import { coverageScore, relativeTime, riskScore } from '../lib/util';

export function Library() {
  const toast = useToast();
  const [items, setItems] = useState(null as Investigation[] | null);
  const [q, setQ] = useState('');
  const load = () => listInvestigations().then(setItems);
  useEffect(() => { load(); }, []);
  const shown = (items ?? []).filter((i) => (i.title + i.kind).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHead title="Investigations" why="Your saved work. Everything is stored privately in this browser only, so you can return to a result, regenerate AI output or export it later." actions={<Link to={appPath('/new')} className="btn primary"><Icon name="plus" size={16} /> New</Link>} />
      <Panel title="Library" mod={String((items ?? []).length).padStart(2, '0')}>
        {items && items.length > 0 && <input className="input" placeholder="Search…" aria-label="Search investigations" value={q} onChange={(e: any) => setQ(e.target.value)} style={{ marginBottom: 14 }} />}
        {items && !items.length && (
          <div className="center" style={{ padding: 30 }}>
            <p className="muted">No investigations yet.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link to={appPath('/new')} className="btn primary">Start one</Link>
              <button className="btn ghost" onClick={async () => { const d = await makeDemoInvestigation(); await saveInvestigation(d); navigate(appPath('/investigations/' + d.id)); }}>Open the demo</button>
            </div>
          </div>
        )}
        {shown.map((i) => {
          const r = riskScore(i.result);
          return (
            <div key={i.id} className="row spread" style={{ padding: '12px 0', borderBottom: '1px dashed rgba(25,227,255,.15)' }}>
              <Link to={appPath('/investigations/' + i.id)} style={{ color: 'var(--text)', flex: 1, minWidth: 200 }}>
                <strong>{i.title}</strong>
                <div className="hint">{i.kind}{i.result.target.format ? ' · ' + i.result.target.format : ''} · {relativeTime(i.createdAt)} · {i.result.evidence.length} evidence</div>
              </Link>
              <div className="row"><Tag>{coverageScore(i.result)}% coverage</Tag><Tag tone={r.level === 'high' ? 'red' : r.level === 'medium' ? 'orange' : 'green'}>{r.level}</Tag>
                {i.blueprint && <Tag tone="green">blueprint</Tag>}
                <button className="btn sm danger" aria-label={'Delete ' + i.title} onClick={async () => { await deleteInvestigation(i.id); toast('Deleted'); load(); }}><Icon name="trash" size={14} /></button></div>
            </div>
          );
        })}
        {items && items.length > 1 && <div style={{ marginTop: 16 }}><button className="btn sm ghost" onClick={async () => { if (confirm('Delete ALL investigations from this browser?')) { await clearInvestigations(); load(); } }}>Delete everything</button></div>}
      </Panel>
    </div>
  );
}
