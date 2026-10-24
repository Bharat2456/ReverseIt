import { Icon } from '../components/icons';
import { platform } from '../lib/platform';
import { PublicLayout } from './Public';

const LINKS = [
  { icon: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/bharat-wagh-96b3082a8?utm_source=share_via&utm_content=profile&utm_medium=member_android', shown: 'linkedin.com/in/bharat-wagh-96b3082a8' },
  { icon: 'github', label: 'GitHub', url: 'https://github.com/Bharat2456', shown: 'github.com/Bharat2456' },
  { icon: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/doppelganger.bharat?obrf=dXQwZHJnYXZrNjE=', shown: 'instagram.com/doppelganger.bharat' },
  { icon: 'xsocial', label: 'X / Twitter', url: 'https://x.com/BharatWagh1010', shown: 'x.com/BharatWagh1010' },
];

export function BuilderBody() {
  const p = platform();
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(240px,320px) 1fr', gap: 36, alignItems: 'start' }}>
      <div className="center">
        <img className="portrait" src={p.asset('portrait.jpg')} alt="Bharat Wagh" width="280" height="280" />
        <h2 style={{ marginTop: 20, fontSize: '1.5rem', letterSpacing: '.12em' }}>Bharat Wagh</h2>
        <div className="kicker">Builder of ReverseIt · 21</div>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="ptitle"><span>About me</span><span className="mod">BUILDER</span></div>
          <p style={{ fontSize: '1.05rem' }}>I'm a <strong>curious builder</strong>, always open to working on new ideas and innovation.</p>
          <p>I'm currently a <strong>Computer Engineering student at TSSM's Padmabhooshan Vasantdada Patil Institute of Technology, Bavdhan, Pune</strong>. I'm 21 years old and really passionate about tech and how it works — which is exactly why I built ReverseIt.</p>
        </section>
        <section className="panel orange">
          <div className="ptitle"><span>Work with me</span><span className="mod">FREELANCE</span></div>
          <p style={{ fontSize: '1.05rem', marginTop: 0 }}>I also <strong>freelance</strong>: if you or anyone you know needs something built, I'm happy to help. <strong>Just connect with me on LinkedIn.</strong></p>
          <p className="muted">Go check out more of my work on LinkedIn and connect with me.</p>
          <a className="btn primary" href={LINKS[0].url} target="_blank" rel="noopener noreferrer"><Icon name="linkedin" size={16} /> Connect on LinkedIn</a>
        </section>
        <section className="panel">
          <div className="ptitle"><span>Socials</span><span className="mod">FIND ME</span></div>
          <div className="grid g2">
            {LINKS.map((l) => (
              <a key={l.label} className="social" href={l.url} target="_blank" rel="noopener noreferrer"><Icon name={l.icon} size={22} /><span><strong>{l.label}</strong><small>{l.shown}</small></span></a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function BuilderPage({ embedded }: { embedded?: boolean }) {
  if (embedded) return <div><header className="pagehead"><div className="kicker">The maker</div><h1>Builder</h1><div className="why"><b>Why this page</b><span>Who made ReverseIt, how to reach him, and where to find more of his work.</span></div></header><BuilderBody /></div>;
  return <PublicLayout><div className="sect"><div className="kicker">The maker</div><h1>Builder</h1><BuilderBody /></div></PublicLayout>;
}
