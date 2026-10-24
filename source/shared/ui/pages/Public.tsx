import { Logo } from '../components/Logo';
import { Link, useRoute } from '../lib/router';
import { appPath } from '../lib/paths';

export function PublicLayout({ children }: { children?: any }) {
  const route = useRoute();
  const L = (to: string, t: string) => <Link to={to} className={'lnk' + (route === to ? ' on' : '')}>{t}</Link>;
  return (
    <div className="pub">
      <header className="pubnav">
        <Link to="/" className="brand" aria-label="ReverseIt home"><Logo size={38} /><span>Reverse<b>It</b></span></Link>
        <nav aria-label="Site">
          <a className="lnk" href="/#features">Features</a>
          <a className="lnk" href="/#showcase">Showcase</a>
          {L('/docs', 'Docs')}
          {L('/builder', 'Builder')}
          <Link to={appPath('/')} className="btn primary sm">Dashboard</Link>
        </nav>
      </header>
      {children}
      <footer className="footer">
        <span><Logo size={26} withText /></span>
        <span>Open source · MIT · no accounts, bring your own AI key</span>
        <span><Link to="/docs">Docs</Link> · <Link to="/builder">Builder</Link></span>
      </footer>
    </div>
  );
}
