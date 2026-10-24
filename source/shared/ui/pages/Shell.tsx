import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { Icon } from '../components/icons';
import { Link, useRoute, useRouteParams } from '../lib/router';
import { appPath, relPath } from '../lib/paths';
import { platform } from '../lib/platform';
import { Home } from './Home';
import { NewInvestigation } from './NewInvestigation';
import { Library } from './Library';
import { InvestigationPage } from './Investigation';
import { Connect } from './Connect';
import { DocsPage } from './Docs';
import { BuilderPage } from './Builder';

export function AppShell() {
  const p = platform();
  const route = useRoute();
  const rel = relPath(route);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route]);
  const nav = [
    { to: '/', label: 'Command centre', icon: 'home', match: (r: string) => r === '/' },
    { to: '/new', label: 'New investigation', icon: 'plus', match: (r: string) => r === '/new' },
    { to: '/investigations', label: 'Investigations', icon: 'folder', match: (r: string) => r.startsWith('/investigations') },
    ...(p.aiMode === 'providers' ? [{ to: '/connect', label: 'AI Connect', icon: 'key', match: (r: string) => r === '/connect' }] : []),
    { to: '/docs', label: 'Documentation', icon: 'book', match: (r: string) => r === '/docs' },
    ...(p.hasLanding ? [{ to: '/builder', label: 'Builder', icon: 'user', match: (r: string) => r === '/builder' }] : []),
  ];
  const inv = rel.match(/^\/investigations\/([^/]+)(?:\/([^/]+))?$/);
  let page: any;
  if (rel === '/') page = <Home />;
  else if (rel === '/new') page = <NewInvestigation />;
  else if (rel === '/investigations') page = <Library />;
  else if (inv) page = <InvestigationPage id={decodeURIComponent(inv[1])} tab={inv[2]} />;
  else if (rel === '/connect' && p.aiMode === 'providers') page = <Connect />;
  else if (rel === '/docs') page = <DocsPage embedded />;
  else if (rel === '/builder' && p.hasLanding) page = <BuilderPage embedded />;
  else page = <div className="panel"><h2>Page not found</h2><Link className="btn" to={appPath('/')}>Back to the command centre</Link></div>;
  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={'side' + (open ? ' open' : '')} aria-label="Main navigation">
        <Link to={appPath('/')} className="brand"><Logo size={38} /><span>Reverse<b>It</b></span></Link>
        {nav.map((n) => <Link key={n.to} to={appPath(n.to)} className={'navlink' + (n.match(rel) ? ' on' : '')}><Icon name={n.icon} />{n.label}</Link>)}
        <div className="sp" />
        {p.hasLanding && <Link to="/" className="navlink"><Icon name="globe" />Public site</Link>}
        {p.version !== 'v3' && <div className="sidefoot">{p.edition}<br />Open source · MIT<br />Built on REA (MIT)</div>}
      </aside>
      <div>
        <div className="topbar"><button className="btn sm ghost" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button><Logo size={30} withText /></div>
        <main className="main">{page}</main>
      </div>
    </div>
  );
}
