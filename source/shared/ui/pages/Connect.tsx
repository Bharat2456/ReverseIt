import { useEffect, useState } from 'react';
import { Panel, PageHead, Spinner, Tag, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { apiDetect, apiModels, apiTest } from '../lib/aiClient';
import { getActiveProvider, listProviders, removeProvider, saveProvider, setActiveProvider, subscribeProviders } from '../lib/providersStore';
import { KNOWN_PROVIDERS, cloudProviders, findProvider, makeProviderConfig, normalizeBaseUrl } from '../../ai/providers';
import type { DetectCandidate, ModelInfo, ProviderConfig } from '../../ai/types';
import { platform } from '../lib/platform';

function useProviders() {
  const [, tick] = useState(0);
  useEffect(() => subscribeProviders(() => tick((n) => n + 1)), []);
  return { list: listProviders(), active: getActiveProvider() };
}

export function Connect() {
  const p = platform();
  const toast = useToast();
  const { list, active } = useProviders();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [adv, setAdv] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [format, setFormat] = useState('openai');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [cands, setCands] = useState([] as DetectCandidate[]);
  const [pick, setPick] = useState('');
  const [model, setModel] = useState('');
  const [manualProv, setManualProv] = useState('');
  const [testing, setTesting] = useState('');

  if (p.aiMode === 'sample') {
    return (
      <div>
        <PageHead title="AI engine" why="Shows which AI writes the Blueprint and Build Lab results in this edition." />
        <Panel title="Built-in AI" mod="READY"><p>This edition of ReverseIt uses the built-in Claude model of the chat it is hosted in. <strong>No API key is needed</strong> and nothing is stored.</p><Tag tone="green">Connected</Tag></Panel>
      </div>
    );
  }

  const current = cands.find((c) => c.providerId === pick);
  const needsKey = !(findProvider(manualProv)?.local) && !(adv && baseUrl && !key);

  async function detect(probeAll = false) {
    setBusy(true); setMsg(''); setCands([]); setPick('');
    try {
      const r = await apiDetect(key.trim(), { baseUrl: adv && baseUrl ? baseUrl : undefined, format: adv && baseUrl ? format : undefined, probeAll });
      setCands(r.candidates);
      if (r.best) { setPick(r.best); const c = r.candidates.find((x) => x.providerId === r.best)!; setModel(c.models[0]?.id ?? ''); }
      setMsg(r.ok ? '' : r.message ?? 'No provider accepted this key.');
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  async function chooseManual(id: string) {
    setManualProv(id);
    const kp = findProvider(id);
    if (!kp) return;
    setBusy(true); setMsg('');
    try {
      const cfg = makeProviderConfig({ known: kp, apiKey: key.trim() });
      const r = await apiModels(cfg);
      const models: ModelInfo[] = r.models.length ? r.models : kp.fallbackModels.map((m) => ({ id: m }));
      const cand: DetectCandidate = { providerId: kp.id, label: kp.label, format: kp.format, baseUrl: kp.baseUrl, authStyle: kp.authStyle, patternMatch: false, verified: !r.error, models, error: r.error?.message };
      setCands([cand]); setPick(kp.id); setModel(models[0]?.id ?? '');
      if (r.error) setMsg(r.error.message);
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  function save() {
    if (!current) return;
    const cfg = makeProviderConfig({ providerId: current.providerId, known: findProvider(current.providerId), label: current.label, format: current.format, baseUrl: current.baseUrl, authStyle: current.authStyle, apiKey: key.trim(), model });
    saveProvider(cfg, true);
    toast(`${current.label} connected`);
    setKey(''); setCands([]); setPick(''); setMsg('');
  }

  async function test(c: ProviderConfig) {
    setTesting(c.id);
    try {
      const r = await apiTest(c);
      toast(r.ok ? `${c.label}: working (${r.reply || 'ok'})` : `${c.label}: ${r.error?.message ?? 'failed'}`);
    } catch (e: any) { toast(e.message); }
    setTesting('');
  }

  return (
    <div>
      <PageHead kicker="AI engine" title="AI Connect" why="ReverseIt needs an AI model to write the Blueprint and generate clone code. Paste any API key from any provider here; ReverseIt works out where it belongs." />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Connect a key" mod="ANY PROVIDER" tone="orange">
          <div className="field">
            <label className="lbl" htmlFor="k">API key</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="k" className="input mono" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="Paste your key (sk-…, AIza…, gsk_…)" value={key} onChange={(e: any) => setKey(e.target.value)} />
              <button className="btn ghost sm" onClick={() => setShow(!show)} type="button">{show ? 'Hide' : 'Show'}</button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>Stored only in this browser. It is sent with each AI request through this site's server to the provider, and never saved or logged on the server.</div>
          </div>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={adv} onChange={(e: any) => setAdv(e.target.checked)} /><span>My provider is not on the list / self-hosted (enter its address)</span></label>
          {adv && (
            <div className="grid g2" style={{ marginBottom: 12 }}>
              <div><label className="lbl" htmlFor="b">Base URL</label><input id="b" className="input mono" placeholder="https://api.myprovider.com/v1" value={baseUrl} onChange={(e: any) => setBaseUrl(e.target.value)} /><div className="hint">{baseUrl && normalizeBaseUrl(baseUrl) ? '→ ' + normalizeBaseUrl(baseUrl) : 'The address ending in /v1 (or similar).'}</div></div>
              <div><label className="lbl" htmlFor="f">Speaks like</label><select id="f" className="select" value={format} onChange={(e: any) => setFormat(e.target.value)}><option value="openai">OpenAI-style (most providers)</option><option value="anthropic">Anthropic-style</option><option value="gemini">Gemini-style</option></select></div>
            </div>
          )}
          <div className="row">
            <button className="btn primary" disabled={busy || (!key.trim() && !(adv && baseUrl))} onClick={() => detect(false)}>{busy ? <Spinner /> : <Icon name="eye" size={16} />} Detect &amp; verify</button>
          </div>
          {msg && <div className="notice err" style={{ marginTop: 12 }} role="alert">{msg}</div>}
          {!cands.length && msg && !adv && key.trim() && (
            <div style={{ marginTop: 14 }}>
              <div className="hint" style={{ marginBottom: 6 }}>Don't know the provider? Choose it here:</div>
              <select className="select" value={manualProv} onChange={(e: any) => chooseManual(e.target.value)}>
                <option value="">Select a provider…</option>
                {cloudProviders().map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm ghost" disabled={busy} onClick={() => { if (confirm('ReverseIt will send this key to each known provider\'s model-list endpoint, one after another, to find the one that accepts it. Only continue if you accept that. Proceed?')) detect(true); }}>Try every known provider</button>
              </div>
            </div>
          )}
          {cands.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="lbl">Result</div>
              {cands.map((c) => (
                <label key={c.providerId} className="check" style={{ padding: '8px 0' }}>
                  <input type="radio" name="cand" checked={pick === c.providerId} onChange={() => { setPick(c.providerId); setModel(c.models[0]?.id ?? ''); }} disabled={!c.verified} />
                  <span><strong>{c.label}</strong> {c.verified ? <Tag tone="green">key accepted · {c.models.length} models</Tag> : <Tag tone="red">{c.error ?? 'not accepted'}</Tag>}</span>
                </label>
              ))}
              {current && current.verified && (
                <div className="field" style={{ marginTop: 10 }}>
                  <label className="lbl" htmlFor="m">Model</label>
                  {current.models.length ? (
                    <select id="m" className="select" value={model} onChange={(e: any) => setModel(e.target.value)}>{current.models.map((m) => <option key={m.id} value={m.id}>{m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}</option>)}</select>
                  ) : <input id="m" className="input mono" placeholder="model name" value={model} onChange={(e: any) => setModel(e.target.value)} />}
                  <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={!model} onClick={save}><Icon name="check" size={16} /> Save &amp; use this</button></div>
                </div>
              )}
            </div>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Connected" mod={String(list.length).padStart(2, '0')}>
            {!list.length && <div className="muted">Nothing connected yet. Without a key the Blueprint and Build Lab cannot run, but all analysis still works, and you can copy the AI prompt into any chat tool yourself.</div>}
            {list.map((c) => (
              <div key={c.id} className="row spread" style={{ padding: '10px 0', borderBottom: '1px dashed rgba(25,227,255,.15)' }}>
                <div><strong>{c.label}</strong> {active?.id === c.id && <Tag tone="green">in use</Tag>}<div className="hint mono">{c.model} · {c.apiKey ? c.apiKey.slice(0, 4) + '••••' : 'no key'}</div></div>
                <div className="row">
                  {active?.id !== c.id && <button className="btn sm ghost" onClick={() => setActiveProvider(c.id)}>Use</button>}
                  <button className="btn sm ghost" onClick={() => test(c)} disabled={testing === c.id}>{testing === c.id ? <Spinner /> : 'Test'}</button>
                  <button className="btn sm danger" onClick={() => removeProvider(c.id)} aria-label={'Remove ' + c.label}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="Supported out of the box" mod={String(KNOWN_PROVIDERS.filter((k) => !k.id.startsWith('custom')).length)}>
            <div>{KNOWN_PROVIDERS.filter((k) => !k.id.startsWith('custom')).map((k) => <Tag key={k.id} tone={k.local ? 'orange' : ''}>{k.label}</Tag>)}</div>
            <p className="hint">Anything else that speaks the OpenAI, Anthropic or Gemini format works through “not on the list”.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
