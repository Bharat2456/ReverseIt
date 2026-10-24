import { useEffect, useRef, useState } from 'react';
import { Panel, PageHead, Gauge, Stat, Tag, Spinner, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { EvidenceCard, Findings, GraphView, SectionList } from '../components/Sections';
import { Markdown } from '../lib/md';
import { Link, navigate } from '../lib/router';
import { appPath } from '../lib/paths';
import { platform } from '../lib/platform';
import { deleteInvestigation, getInvestigation, saveInvestigation, type Investigation } from '../lib/db';
import { getActiveProvider } from '../lib/providersStore';
import { LAB_MODES, labPrompt, parseGeneratedFiles, type LabMode } from '../lib/prompts';
import { allFindings, coverageScore, downloadZip, evidenceMarkdown, promptFor, relativeTime, riskScore, safeName, technologies } from '../lib/util';
import { mergeGraphs } from '../../core/graph';
import { fmtBytes } from '../../core/sections';

const TABS = [['overview', 'Overview'], ['architecture', 'Architecture'], ['evidence', 'Evidence'], ['files', 'Files'], ['blueprint', 'Blueprint'], ['lab', 'Build Lab'], ['export', 'Export']] as const;

export function InvestigationPage({ id, tab }: { id: string; tab?: string }) {
  const [inv, setInv] = useState(undefined as Investigation | null | undefined);
  const t = TABS.some((x) => x[0] === tab) ? (tab as string) : 'overview';
  useEffect(() => { getInvestigation(id).then((r) => setInv(r ?? null)); }, [id]);
  if (inv === undefined) return <div className="muted"><Spinner /> Loading…</div>;
  if (inv === null) return <Panel title="Not found"><p>This investigation is not stored in this browser (it may have been deleted or made on another device).</p><Link className="btn" to={appPath('/investigations')}>Back to the library</Link></Panel>;
  const update = async (patch: Partial<Investigation>) => { const n = { ...inv, ...patch }; setInv(n); await saveInvestigation(n); };
  const r = inv.result;
  return (
    <div>
      <PageHead
        kicker={r.target.format && r.target.format !== inv.kind ? `${inv.kind.toUpperCase()} · ${r.target.format.toUpperCase()}` : inv.kind.toUpperCase()}
        title={inv.title}
        why="Everything ReverseIt learned about one target, split into tabs: a quick summary, a map of how it is built, the raw evidence, recovered files, and the AI-written Blueprint and clone starter."
        actions={<button className="btn sm danger" onClick={async () => { if (confirm('Delete this investigation from this browser?')) { await deleteInvestigation(inv.id); navigate(appPath('/investigations')); } }}><Icon name="trash" size={14} /> Delete</button>}
      />
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <Link key={k} to={appPath(`/investigations/${inv.id}/${k}`)} className={'tab' + (t === k ? ' on' : '')} role="tab" aria-selected={t === k}>{label}</Link>)}
      </div>
      {t === 'overview' && <Overview inv={inv} />}
      {t === 'architecture' && <Architecture inv={inv} />}
      {t === 'evidence' && <Evidence inv={inv} />}
      {t === 'files' && <Files inv={inv} />}
      {t === 'blueprint' && <AiTab inv={inv} mode="blueprint" update={update} />}
      {t === 'lab' && <Lab inv={inv} update={update} />}
      {t === 'export' && <Export inv={inv} />}
    </div>
  );
}

function Overview({ inv }: { inv: Investigation }) {
  const r = inv.result;
  const cov = coverageScore(r);
  const risk = riskScore(r);
  const findings = allFindings(r);
  const tech = technologies(r);
  return (
    <div className="stack">
      <div className="grid g4">
        <Panel><div className="row" style={{ flexWrap: 'nowrap' }}><Gauge value={cov} label="coverage" size={116} /><div className="hint">How much of the target the checks could fully read. Lower means more is hidden.</div></div></Panel>
        <Panel><Stat num={r.evidence.length} label="Evidence records" /></Panel>
        <Panel><Stat num={findings.length} label="Findings" tone="orange" /><Tag tone={risk.level === 'high' ? 'red' : risk.level === 'medium' ? 'orange' : 'green'}>{risk.level} risk</Tag></Panel>
        <Panel><Stat num={r.recovered.length} label="Files recovered" /><div className="hint">{fmtBytes(r.recovered.reduce((a, f) => a + f.size, 0))}</div></Panel>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="What was found" mod="SUMMARY">
          <ul className="biglist" style={{ maxHeight: 'none', fontFamily: 'inherit', fontSize: '.92rem' }}>{r.evidence.map((e) => <li key={e.evidence_id} style={{ wordBreak: 'normal' }}><strong>{e.title}.</strong> <span className="muted">{e.summary}</span></li>)}</ul>
          {tech.length > 0 && <div style={{ marginTop: 14 }}><div className="lbl">Technologies</div>{tech.map((x) => <Tag key={x}>{x}</Tag>)}</div>}
        </Panel>
        <Panel title="Findings" mod="NOTICES" tone="orange"><Findings items={findings} /></Panel>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Still unknown" mod="OPEN"><ul className="biglist" style={{ fontFamily: 'inherit', fontSize: '.9rem' }}>{r.unknowns.length ? r.unknowns.map((u) => <li key={u.id}>{u.question}</li>) : <li>No open questions recorded.</li>}</ul><p className="hint">Honest limits matter: ReverseIt reads what is publicly visible or inside the file. It does not run the code.</p></Panel>
        <Panel title="Next steps" mod="GUIDE">
          <div className="stack">
            <Link className="btn primary" to={appPath(`/investigations/${inv.id}/architecture`)}><Icon name="graph" size={16} /> See the architecture map</Link>
            <Link className="btn" to={appPath(`/investigations/${inv.id}/blueprint`)}><Icon name="doc" size={16} /> Write the Blueprint with AI</Link>
            <Link className="btn orange" to={appPath(`/investigations/${inv.id}/lab`)}><Icon name="cube" size={16} /> Open the Build Lab</Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Architecture({ inv }: { inv: Investigation }) {
  const g = mergeGraphs(inv.result.evidence);
  return (
    <Panel title="How the parts connect" mod={`${g.nodes.length} PARTS`}>
      <p className="hint" style={{ marginTop: 0 }}>Each box is one part found in the target. Click a box to highlight what it connects to. Only parts with evidence are drawn.</p>
      <GraphView graph={g} />
    </Panel>
  );
}

function Evidence({ inv }: { inv: Investigation }) {
  return <div>{inv.result.evidence.map((e, i) => <EvidenceCard key={e.evidence_id} ev={e} defaultOpen={i === 0} />)}</div>;
}

function Files({ inv }: { inv: Investigation }) {
  const files = inv.result.recovered;
  const [sel, setSel] = useState(files[0]?.path ?? '');
  const [q, setQ] = useState('');
  const f = files.find((x) => x.path === sel);
  const shown = files.filter((x) => x.path.toLowerCase().includes(q.toLowerCase())).slice(0, 400);
  if (!files.length) return <Panel title="Recovered files"><p className="muted">No files could be recovered from this target. (Websites with public source maps and archives with readable text files produce files here.)</p></Panel>;
  return (
    <div className="grid g2" style={{ gridTemplateColumns: 'minmax(240px,1fr) 2fr', alignItems: 'start' }}>
      <Panel title="Files" mod={String(files.length)}>
        <input className="input" placeholder="Filter…" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Filter files" />
        <ul className="biglist" style={{ marginTop: 10, maxHeight: 520 }}>{shown.map((x) => <li key={x.path}><a href="#f" style={{ color: sel === x.path ? 'var(--orange2)' : undefined }} onClick={(e: any) => { e.preventDefault(); setSel(x.path); }}>{x.path}</a> <span className="muted">{fmtBytes(x.size)}</span></li>)}</ul>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => downloadZip(`${safeName(inv.title)}-recovered.zip`, files.filter((x) => x.text != null).map((x) => ({ path: x.path, data: x.text! })))}><Icon name="download" size={14} /> Download all (.zip)</button>
        {inv.result.recoveredTruncated && <div className="notice" style={{ marginTop: 10 }}>Recovery stopped at the size limit, so some files are missing.</div>}
      </Panel>
      <Panel title={f?.path ?? 'Preview'} mod={f ? f.origin.toUpperCase() : ''}>
        {f?.text != null ? <pre><code>{f.text.length > 200000 ? f.text.slice(0, 200000) + '\n… (preview cut; download for the full file)' : f.text}</code></pre> : <div className="muted">No text preview for this file.</div>}
      </Panel>
    </div>
  );
}

function useAi() {
  const p = platform();
  const prov = getActiveProvider();
  const ready = p.aiMode === 'sample' || !!prov;
  return { p, prov, ready };
}

function Gen({ inv, mode, update, stack, extra }: { inv: Investigation; mode: LabMode; update: (p: Partial<Investigation>) => Promise<void>; stack?: string; extra?: string }) {
  const { p, prov, ready } = useAi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const ac = useRef(null as AbortController | null);
  const saved = mode === 'blueprint' ? inv.blueprint : inv.buildLab?.[mode]?.text;
  const shown = busy ? text : text || saved || '';
  const meta = LAB_MODES.find((m) => m.id === mode)!;

  async function run() {
    setBusy(true); setErr(''); setText('');
    ac.current = new AbortController();
    try {
      const out = await p.chat(labPrompt(mode, inv.result, { stack, extra }), { onText: setText, signal: ac.current.signal, maxTokens: meta.files ? 12000 : 6000 }, prov);
      if (mode === 'blueprint') await update({ blueprint: out });
      else await update({ buildLab: { ...(inv.buildLab ?? {}), [mode]: { text: out, at: Date.now() } } });
      setText(out);
      toast(`${meta.title} ready`);
    } catch (e: any) { if (e?.name !== 'AbortError') setErr(e?.message ?? 'The AI request failed.'); }
    setBusy(false);
  }
  const parsed = meta.files ? parseGeneratedFiles(shown) : null;
  return (
    <div className="stack">
      {!ready && (
        <div className="notice">No AI key is connected yet. <Link to={appPath('/connect')}><strong>Connect one</strong></Link> (any provider), or <a href="#c" onClick={async (e: any) => { e.preventDefault(); try { await navigator.clipboard.writeText(promptFor(inv.result)); toast('Prompt copied. Paste it into any AI chat.'); } catch { toast('Copy failed: use the Export tab.'); } }}>copy the prompt</a> and paste it into any AI tool yourself.</div>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy || !ready} onClick={run}>{busy ? <Spinner /> : <Icon name="spark" size={16} />} {saved ? 'Regenerate' : 'Generate'} {meta.title}</button>
        {busy && <button className="btn ghost" onClick={() => ac.current?.abort()}>Stop</button>}
        {shown && !busy && <button className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(shown); toast('Copied'); } catch { toast('Copy failed'); } }}><Icon name="copy" size={14} /> Copy</button>}
        {shown && !busy && !meta.files && <button className="btn ghost" onClick={() => p.saveFile(`${safeName(inv.title)}-${mode}.md`, shown, 'text/markdown')}><Icon name="download" size={14} /> .md</button>}
        {ready && p.aiMode === 'providers' && prov && <span className="hint">using {prov.label} · {prov.model}</span>}
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      {shown && !parsed?.files.length && <Panel><Markdown text={shown} streaming={busy} /></Panel>}
      {parsed && parsed.files.length > 0 && <FilesOut inv={inv} mode={mode} intro={parsed.intro} files={parsed.files} streaming={busy} />}
      {!shown && !busy && <div className="muted">{meta.blurb}</div>}
      <div className="hint">AI output can contain mistakes. Treat it as a draft and check it against the Evidence tab. Output is yours to use under your own responsibility and the licences of anything you study.</div>
    </div>
  );
}

function FilesOut({ inv, mode, intro, files, streaming }: { inv: Investigation; mode: string; intro: string; files: { path: string; lang: string; content: string }[]; streaming: boolean }) {
  const [sel, setSel] = useState(0);
  const f = files[Math.min(sel, files.length - 1)];
  return (
    <div className="stack">
      {intro && <Panel><Markdown text={intro} /></Panel>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(180px,1fr) 3fr', alignItems: 'start' }}>
        <Panel title="Files" mod={String(files.length)}>
          <ul className="biglist">{files.map((x, i) => <li key={x.path}><a href="#f" style={{ color: i === sel ? 'var(--orange2)' : undefined }} onClick={(e: any) => { e.preventDefault(); setSel(i); }}>{x.path}</a></li>)}</ul>
          <button className="btn sm primary" style={{ marginTop: 12 }} disabled={streaming} onClick={() => downloadZip(`${safeName(inv.title)}-${mode}.zip`, files.map((x) => ({ path: x.path, data: x.content })))}><Icon name="download" size={14} /> Download .zip</button>
        </Panel>
        <Panel title={f.path} mod={f.lang.toUpperCase()}><pre><code>{f.content}</code></pre></Panel>
      </div>
    </div>
  );
}

function AiTab({ inv, mode, update }: { inv: Investigation; mode: LabMode; update: (p: Partial<Investigation>) => Promise<void> }) {
  return <Panel title="Blueprint" mod="AI REPORT"><Gen inv={inv} mode={mode} update={update} /></Panel>;
}

function Lab({ inv, update }: { inv: Investigation; update: (p: Partial<Investigation>) => Promise<void> }) {
  const [mode, setMode] = useState('clone' as LabMode);
  const [stack, setStack] = useState('');
  const [extra, setExtra] = useState('');
  const modes = LAB_MODES.filter((m) => m.id !== 'blueprint');
  const cur = modes.find((m) => m.id === mode)!;
  return (
    <div className="grid g2" style={{ gridTemplateColumns: 'minmax(260px,1fr) 2.4fr', alignItems: 'start' }}>
      <Panel title="Choose what to build" mod="LAB">
        <div className="grid" style={{ gap: 8 }}>
          {modes.map((m) => (
            <button key={m.id} className={'choice' + (mode === m.id ? ' on' : '')} onClick={() => setMode(m.id)}><span className="ic"><Icon name={m.icon} /></span><span><h3>{m.title}</h3><p>{m.blurb}</p></span></button>
          ))}
        </div>
        {cur.files && <div className="field" style={{ marginTop: 14 }}><label className="lbl" htmlFor="st">Stack (optional)</label><input id="st" className="input" placeholder="e.g. React + Vite, Python Flask, Next.js" value={stack} onChange={(e: any) => setStack(e.target.value)} /></div>}
        <div className="field"><label className="lbl" htmlFor="ex">Extra instructions (optional)</label><textarea id="ex" className="input" style={{ minHeight: 80 }} placeholder="e.g. keep it to one page, use my brand name Acme" value={extra} onChange={(e: any) => setExtra(e.target.value)} /></div>
      </Panel>
      <Panel title={cur.title} mod="OUTPUT" tone="orange"><Gen key={mode} inv={inv} mode={mode} update={update} stack={stack} extra={extra} /></Panel>
    </div>
  );
}

function Export({ inv }: { inv: Investigation }) {
  const p = platform();
  const toast = useToast();
  const r = inv.result;
  const base = safeName(inv.title);
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Panel title="Take it with you" mod="EXPORT">
        <div className="stack">
          <button className="btn" onClick={() => p.saveFile(`${base}-evidence.json`, JSON.stringify(r, (k, v) => (k === 'text' && typeof v === 'string' && v.length > 20000 ? undefined : v), 2), 'application/json')}><Icon name="download" size={16} /> Evidence (.json)</button>
          <button className="btn" onClick={() => p.saveFile(`${base}-report.md`, evidenceMarkdown(r), 'text/markdown')}><Icon name="download" size={16} /> Plain report (.md)</button>
          <button className="btn" disabled={!r.recovered.length} onClick={() => downloadZip(`${base}-recovered.zip`, r.recovered.filter((x) => x.text != null).map((x) => ({ path: x.path, data: x.text! })))}><Icon name="download" size={16} /> Recovered files (.zip)</button>
          {inv.blueprint && <button className="btn" onClick={() => p.saveFile(`${base}-blueprint.md`, inv.blueprint!, 'text/markdown')}><Icon name="download" size={16} /> Blueprint (.md)</button>}
        </div>
      </Panel>
      <Panel title="Use any AI yourself" mod="PROMPT">
        <p style={{ marginTop: 0 }}>No key? Copy this ready-made prompt and paste it into any AI chat (ChatGPT, Claude, Gemini, a local model…). It carries only the findings, not your files.</p>
        <button className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(labPrompt('blueprint', r).map((m) => m.content).join('\n\n')); toast('Prompt copied'); } catch { toast('Copy failed'); } }}><Icon name="copy" size={16} /> Copy prompt</button>
        <div className="hint" style={{ marginTop: 10 }}>Investigation made {relativeTime(inv.createdAt)} · SHA-256 {r.target.sha256 ? r.target.sha256.slice(0, 16) + '…' : 'n/a'}</div>
      </Panel>
    </div>
  );
}
