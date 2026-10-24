import { useState } from 'react';
import { Panel } from '../components/ui';
import { Icon } from '../components/icons';
import { Logo } from '../components/Logo';
import { Link } from '../lib/router';
import { appPath } from '../lib/paths';
import { platform } from '../lib/platform';
import { PublicLayout } from './Public';

function HudHero() {
  const ticks = Array.from({ length: 72 }, (_, i) => i);
  return (
    <svg viewBox="0 0 400 400" width="100%" style={{ maxWidth: 460, display: 'block', margin: '0 auto' }} role="img" aria-label="Animated HUD display with the ReverseIt logo">
      <g transform="translate(200 200)">
        <g className="spin" style={{ animationDuration: '40s' }}>{ticks.map((i) => <line key={i} x1="0" y1="-190" x2="0" y2={i % 6 === 0 ? -172 : -180} stroke="#19e3ff" strokeOpacity={i % 6 === 0 ? 0.9 : 0.4} transform={`rotate(${i * 5})`} />)}</g>
        <circle r="158" fill="none" stroke="#19e3ff" strokeOpacity=".25" strokeDasharray="3 6" />
        <g className="spinr" style={{ animationDuration: '22s' }}><circle r="140" fill="none" stroke="#ff8a1f" strokeWidth="5" strokeDasharray="120 760" style={{ filter: 'drop-shadow(0 0 6px #ff8a1f)' }} /><circle r="140" fill="none" stroke="#19e3ff" strokeWidth="5" strokeDasharray="200 680" strokeDashoffset="-330" style={{ filter: 'drop-shadow(0 0 6px #19e3ff)' }} /></g>
        <g className="spin" style={{ animationDuration: '16s' }}><circle r="112" fill="none" stroke="#19e3ff" strokeOpacity=".6" strokeWidth="2" strokeDasharray="6 10" /><circle r="96" fill="none" stroke="#ffd23f" strokeWidth="3" strokeDasharray="50 560" /></g>
        <circle r="80" fill="#050b16" stroke="#19e3ff" strokeOpacity=".5" />
        <g transform="translate(-52 -52)"><Logo size={104} bare /></g>
        <text y="124" textAnchor="middle" fill="#7f9bb0" fontSize="11" letterSpacing="5" fontFamily="ui-monospace,monospace">MODULE 654 · ONLINE</text>
      </g>
    </svg>
  );
}

const FEATURES = [
  ['globe', 'Read any website', 'Enter an address. ReverseIt reads the public page, scripts and styles, finds API calls, technologies, fonts and colours.'],
  ['file', 'Open apps and files', 'Windows, Linux, macOS, Android, Electron, WebAssembly, archives and databases, read for structure, libraries and behaviour.'],
  ['graph', 'See the architecture', 'A clear map of the parts and how they connect, with honest coverage and a list of what could not be seen.'],
  ['doc', 'Blueprint in plain words', 'AI turns the evidence into a report anyone can read: what it is, how it works, risks and a rebuild plan.'],
  ['cube', 'Build your own version', 'Generate an original, runnable clone starter, an API with mock server, or a full design system, as a zip.'],
  ['key', 'Any AI, your key', 'Paste a key from any provider. ReverseIt works out where it belongs. Local models too in the localhost edition.'],
] as const;

const SHOTS = [
  ['dashboard.png', 'Command centre'], ['new.png', 'Start an investigation'], ['overview.png', 'Overview and findings'], ['architecture.png', 'Architecture map'], ['blueprint.png', 'AI Blueprint'], ['connect.png', 'Connect any AI key'],
] as const;

export function Landing() {
  const p = platform();
  const [vidOk, setVidOk] = useState(true);
  const [hidden, setHidden] = useState({} as Record<string, boolean>);
  return (
    <PublicLayout>
      <div className="sect hero">
        <div>
          <div className="kicker">Open source · no accounts · bring your own AI</div>
          <h1>Take it <em>apart</em>.<br />Build it <b>yours</b>.</h1>
          <p className="lead">ReverseIt is a platform that reads websites, apps and programs, shows you how they are built, and helps you rebuild your own original version, with no technical knowledge needed.</p>
          <div className="row" style={{ marginTop: 22 }}>
            <Link to={appPath('/')} className="btn primary lg"><Icon name="bolt" size={18} /> Open the Dashboard</Link>
            <Link to="/docs" className="btn lg ghost">Read the docs</Link>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>Needs an AI API key for the Blueprint and Build Lab (any provider). Analysis itself works without one.</p>
        </div>
        <HudHero />
      </div>

      <div className="sect" id="how">
        <div className="kicker">How it works</div><h2>Three steps</h2>
        <div className="grid g3 steps">
          <Panel className="step"><h3>Point it at something</h3><p className="muted">A website, an app file, some code, or a network capture. Confirm you are allowed to study it.</p></Panel>
          <Panel className="step"><h3>Read the evidence</h3><p className="muted">ReverseIt inspects it and draws the architecture, listing findings, coverage and unknowns.</p></Panel>
          <Panel className="step" tone="orange"><h3>Build your own</h3><p className="muted">AI writes the Blueprint and generates an original clone starter you can download and run.</p></Panel>
        </div>
      </div>

      <div className="sect" id="features">
        <div className="kicker">What it builds</div><h2>Everything between “how does this work?” and “I built it”</h2>
        <div className="grid g3">{FEATURES.map(([ic, t, d]) => <Panel key={t}><div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><span className="choice ic" style={{ border: '1px solid var(--line2)', width: 42, height: 42, display: 'grid', placeItems: 'center', color: 'var(--cyan)', flex: 'none' }}><Icon name={ic} /></span><div><h3 style={{ marginBottom: 4 }}>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div></div></Panel>)}</div>
      </div>

      <div className="sect" id="showcase">
        <div className="kicker">Showcase</div><h2>See it working</h2>
        {vidOk && (
          <div className="shot" style={{ marginBottom: 26 }}>
            <video autoPlay muted loop playsInline preload="metadata" poster={p.asset('shots/overview.png')} onError={() => setVidOk(false)} aria-label="Animated tour of the ReverseIt dashboard">
              <source src={p.asset('tour.webm')} type="video/webm" /><source src={p.asset('tour.mp4')} type="video/mp4" />
            </video>
            <div className="shotcap" style={{ padding: '0 12px 10px' }}>Live tour: from a website address to architecture map and Blueprint</div>
          </div>
        )}
        <div className="grid g3">{SHOTS.filter(([f]) => !hidden[f]).map(([f, cap]) => <figure key={f} style={{ margin: 0 }}><div className="shot"><img src={p.asset('shots/' + f)} alt={cap} loading="lazy" onError={() => setHidden({ ...hidden, [f]: true })} /></div><figcaption className="shotcap">{cap}</figcaption></figure>)}</div>
      </div>

      <div className="sect">
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <Panel title="An AI key is required for AI features" mod="NOTE" tone="orange">
            <p style={{ marginTop: 0 }}>ReverseIt has no accounts and no hidden AI bill. For the Blueprint and Build Lab you connect <strong>your own</strong> API key from <strong>any</strong> provider (OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, OpenRouter and many more, or your own server). It is stored only in your browser.</p>
            <Link to="/docs#doc-ai" className="btn sm">How keys work</Link>
          </Panel>
          <Panel title="Honest by design" mod="LIMITS">
            <p style={{ marginTop: 0 }}>Every result says how complete it is and what it could not see. ReverseIt reads but never runs the target, and writes <em>original</em> clones, not copies. Use it responsibly.</p>
            <Link to="/docs" className="btn sm ghost">Read the limits</Link>
          </Panel>
        </div>
        <div className="center" style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: '1.6rem' }}>Ready when you are</h2>
          <Link to={appPath('/')} className="btn primary lg"><Icon name="bolt" size={18} /> Enter the Dashboard</Link>
        </div>
      </div>
    </PublicLayout>
  );
}
