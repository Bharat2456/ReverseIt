import { useEffect, useRef, useState } from 'react';
import { Panel, PageHead, Progress, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { platform } from '../lib/platform';
import { navigate } from '../lib/router';
import { appPath } from '../lib/paths';
import { runInvestigation, type Source } from '../lib/run';
import { normalizeUrlInput } from '../../core/website';

type Mode = 'website' | 'file' | 'paste' | 'capture';

export function NewInvestigation() {
  const p = platform();
  const toast = useToast();
  const [mode, setMode] = useState((p.canFetchSites ? 'website' : 'file') as Mode);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null as File | null);
  const [text, setText] = useState('');
  const [pasteName, setPasteName] = useState('pasted-code.js');
  const [ok, setOk] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ pct: 0, msg: '' });
  const [err, setErr] = useState('');
  const [eng, setEng] = useState(null as any);
  const [useEng, setUseEng] = useState(false);
  const [deep, setDeep] = useState(false);
  useEffect(() => { p.engine?.status().then(setEng).catch(() => setEng(null)); }, []);
  const abort = useRef(null as AbortController | null);
  const input = useRef(null as any);

  const modes: { id: Mode; title: string; blurb: string; icon: string; off?: boolean }[] = [
    { id: 'website', title: 'A website', blurb: p.canFetchSites ? 'Type a web address. ReverseIt reads the public page, scripts and styles.' : 'Not in this edition: browsers block reading other sites. Use a saved page or HAR file.', icon: 'globe', off: !p.canFetchSites },
    { id: 'file', title: 'An app or file', blurb: 'Upload a program (.exe, .apk, .asar, .zip, .wasm…), a saved web page, a script or a database.', icon: 'file' },
    { id: 'paste', title: 'Paste code', blurb: 'Paste JavaScript, HTML, CSS or JSON straight in.', icon: 'paste' },
    { id: 'capture', title: 'Network capture', blurb: 'Upload a HAR file exported from your browser to map how an app talks to its servers.', icon: 'net' },
  ];

  const valid = !busy && ok && (mode === 'website' ? !!normalizeUrlInput(url) : mode === 'paste' ? text.trim().length > 3 : !!file);

  async function go() {
    setErr('');
    let src: Source;
    if (mode === 'website') src = { type: 'website', url };
    else if (mode === 'paste') src = { type: 'paste', name: pasteName || 'pasted.txt', text };
    else src = { type: 'file', file: file! };
    setBusy(true);
    setProg({ pct: 2, msg: 'Starting' });
    abort.current = new AbortController();
    try {
      const inv = await runInvestigation(src, (e) => setProg({ pct: e.pct, msg: e.message ?? e.phase }), abort.current.signal, mode === 'file' && useEng && eng?.built ? { deep } : undefined);
      toast('Investigation ready');
      navigate(appPath('/investigations/' + inv.id));
    } catch (e: any) {
      setErr(e?.name === 'AbortError' || e?.name === 'AbortedError' ? 'Cancelled.' : e?.message ?? 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead kicker="Step 1 of 3 · Start" title="New investigation" why="Tell ReverseIt what you want to understand. This is the only place you start work: pick a source, confirm you are allowed to study it, and press the button." />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Panel title="1 · What do you want to understand?" mod="SOURCE">
            <div className="grid" style={{ gap: 10 }}>
              {modes.map((m) => (
                <button key={m.id} className={'choice' + (mode === m.id ? ' on' : '')} disabled={busy || m.off} style={m.off ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} onClick={() => { setMode(m.id); setErr(''); }}>
                  <span className="ic"><Icon name={m.icon} /></span>
                  <span><h3>{m.title}</h3><p>{m.blurb}</p></span>
                </button>
              ))}
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="2 · Give it to ReverseIt" mod="INPUT" tone="orange">
            {mode === 'website' && (
              <div className="field">
                <label className="lbl" htmlFor="u">Website address</label>
                <input id="u" className="input" placeholder="example.com" value={url} onChange={(e: any) => setUrl(e.target.value)} disabled={busy} onKeyDown={(e: any) => e.key === 'Enter' && valid && go()} />
                <div className="hint" style={{ marginTop: 6 }}>Only the public front end is read. Nothing is logged in or submitted.</div>
              </div>
            )}
            {(mode === 'file' || mode === 'capture') && (
              <div>
                <div
                  className={'drop' + (over ? ' over' : '')}
                  onClick={() => input.current?.click()}
                  onDragOver={(e: any) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e: any) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
                  role="button" tabIndex={0} onKeyDown={(e: any) => e.key === 'Enter' && input.current?.click()}
                >
                  <div className="big">{file ? file.name : mode === 'capture' ? 'Drop a .har file here' : 'Drop a file here'}</div>
                  <div className="hint">{file ? `${(file.size / 1024).toFixed(file.size > 1048576 ? 0 : 1)} KB · click to change` : 'or click to choose · stays on your device in this step'}</div>
                  <input ref={input} type="file" hidden accept={mode === 'capture' ? '.har,application/json' : undefined} onChange={(e: any) => setFile(e.target.files?.[0] ?? null)} />
                </div>
              </div>
            )}
            {mode === 'file' && p.engine && (
              <div className="notice info" style={{ marginTop: 12 }}>
                <label className="check"><input type="checkbox" checked={useEng && !!eng?.built} disabled={!eng?.built || busy} onChange={(e: any) => setUseEng(e.target.checked)} /><span><strong>Also run the REA engine</strong> (deeper checks for .NET, Go, Rust, Electron and SQLite){eng ? ` — v${eng.version ?? '?'}` : ''}</span></label>
                {useEng && eng?.built && <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={deep} onChange={(e: any) => setDeep(e.target.checked)} /><span>Deep native analysis (needs Ghidra, Hopper or IDA installed; can take many minutes)</span></label>}
                {!eng?.built && <div className="hint" style={{ marginTop: 6 }}>{eng ? eng.hint : 'Engine status unavailable.'}</div>}
              </div>
            )}
            {mode === 'paste' && (
              <div>
                <div className="field"><label className="lbl" htmlFor="pn">File name (helps ReverseIt recognise the type)</label><input id="pn" className="input" value={pasteName} onChange={(e: any) => setPasteName(e.target.value)} disabled={busy} /></div>
                <div className="field"><label className="lbl" htmlFor="pt">Code or text</label><textarea id="pt" className="input" rows={9} value={text} onChange={(e: any) => setText(e.target.value)} disabled={busy} placeholder="Paste here…" /></div>
              </div>
            )}
          </Panel>
          <Panel title="3 · Confirm and run" mod="GO">
            <label className="check"><input type="checkbox" checked={ok} onChange={(e: any) => setOk(e.target.checked)} disabled={busy} />
              <span>I own this, or I have permission to study it. I will not use ReverseIt to bypass licences or copy protection, cheat, or access systems without authorisation.</span></label>
            {err && <div className="notice err" style={{ marginTop: 12 }} role="alert">{err}</div>}
            {busy && <div style={{ marginTop: 14 }}><Progress pct={prog.pct} /><div className="hint" style={{ marginTop: 6 }}>{prog.msg}</div></div>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn primary lg" disabled={!valid} onClick={go}><Icon name="play" size={16} /> Start investigation</button>
              {busy && <button className="btn ghost" onClick={() => abort.current?.abort()}>Cancel</button>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
