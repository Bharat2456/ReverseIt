import { useEffect, useState } from 'react';
import { Panel, PageHead, Gauge, Stat, Tag, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { Link, navigate } from '../lib/router';
import { appPath } from '../lib/paths';
import { platform } from '../lib/platform';
import { listInvestigations, saveInvestigation, type Investigation } from '../lib/db';
import { getActiveProvider } from '../lib/providersStore';
import { makeDemoInvestigation } from '../lib/demo';
import { relativeTime, coverageScore } from '../lib/util';

export function Home() {
  const p = platform();
  const toast = useToast();
  const [items, setItems] = useState([] as Investigation[]);
  useEffect(() => { listInvestigations().then(setItems); }, []);
  const prov = getActiveProvider();
  const aiReady = p.aiMode === 'sample' || !!prov;
  const evid = items.reduce((a, i) => a + i.result.evidence.length, 0);
  async function demo() {
    const d = await makeDemoInvestigation();
    await saveInvestigation(d);
    toast('Demo loaded');
    navigate(appPath('/investigations/' + d.id));
  }
  return (
    <div>
      <PageHead kicker={`Command centre · ${p.edition}`} title="ReverseIt" why="Your starting point. See what you have done so far, whether the AI is ready, and jump straight into a new investigation." actions={<Link to={appPath('/new')} className="btn primary"><Icon name="plus" size={16} /> New investigation</Link>} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Panel><Stat num={items.length} label="Investigations" /></Panel>
        <Panel><Stat num={evid} label="Evidence records" /></Panel>
        <Panel><div className="row" style={{ flexWrap: 'nowrap' }}><Gauge size={84} value={aiReady ? 100 : 0} tone={aiReady ? 'green' : 'orange'} suffix="" /><div><div className="lbl">AI engine</div><Tag tone={aiReady ? 'green' : 'orange'}>{aiReady ? (p.aiMode === 'sample' ? 'built-in' : prov!.label) : 'not connected'}</Tag></div></div></Panel>
        <Panel><div className="lbl">Edition</div><div style={{ fontSize: '1.1rem' }}>{p.edition}</div><div className="hint">{p.canFetchSites ? 'Websites, files and captures' : 'Files, pasted code and captures'}</div></Panel>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="How it works" mod="3 STEPS" tone="orange">
          <ol className="steps" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="step" style={{ marginBottom: 18 }}><strong>Point it at something</strong><div className="muted">A website, an app file, some code, or a network capture.</div></li>
            <li className="step" style={{ marginBottom: 18 }}><strong>Read the evidence</strong><div className="muted">A map of how it is built, what it talks to, and what could not be seen.</div></li>
            <li className="step"><strong>Build your own</strong><div className="muted">AI turns the evidence into a Blueprint and an original clone starter.</div></li>
          </ol>
          <div className="row" style={{ marginTop: 18 }}><Link to={appPath('/new')} className="btn primary">Start now</Link><button className="btn ghost" onClick={demo}>Try the demo</button></div>
          {!aiReady && <div className="notice" style={{ marginTop: 16 }}>AI is not connected. Analysis still works; <Link to={appPath('/connect')}><strong>connect a key</strong></Link> to unlock the Blueprint and Build Lab.</div>}
        </Panel>
        <Panel title="Recent investigations" mod={String(Math.min(items.length, 5)).padStart(2, '0')}>
          {!items.length && <div className="muted">Nothing yet. Start a new investigation, or open the demo to see what a finished one looks like.</div>}
          {items.slice(0, 5).map((i) => (
            <Link key={i.id} to={appPath('/investigations/' + i.id)} className="row spread" style={{ padding: '10px 0', borderBottom: '1px dashed rgba(25,227,255,.15)', color: 'var(--text)' }}>
              <span><strong>{i.title}</strong><div className="hint">{i.kind} · {relativeTime(i.createdAt)}</div></span>
              <Tag>{coverageScore(i.result)}% coverage</Tag>
            </Link>
          ))}
          {items.length > 5 && <Link to={appPath('/investigations')} className="btn sm ghost" style={{ marginTop: 12 }}>See all</Link>}
        </Panel>
      </div>
      <Panel title="Use it responsibly" mod="NOTE" style={{ marginTop: 16 }}>
        <p style={{ margin: 0 }} className="muted">ReverseIt is for learning how things work, rebuilding original versions, auditing your own software and interoperability. It reads what is publicly visible or inside files you provide. Do not use it to bypass licences or copy protection, cheat in games, copy someone's protected code or assets, or reach systems you are not authorised to test.</p>
      </Panel>
    </div>
  );
}
