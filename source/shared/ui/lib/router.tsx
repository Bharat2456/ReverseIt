import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { platform } from './platform';

let memPath = '/';
function currentPath(): string {
  const p = platform();
  if (p.routerMode === 'memory') return memPath;
  if (p.routerMode === 'hash') return (location.hash.replace(/^#/, '') || '/').split('?')[0] || '/';
  return location.pathname.replace(/\/+$/, '') || '/';
}

const Ctx = createContext('/');

export function RouterProvider({ children }: { children?: any }) {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => { setPath(currentPath()); window.scrollTo(0, 0); };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, []);
  return <Ctx.Provider value={path}>{children}</Ctx.Provider>;
}

export const useRoute = () => useContext(Ctx);

export function href(to: string): string {
  return platform().routerMode === 'hash' ? '#' + to : to;
}

export function navigate(to: string) {
  const p = platform();
  if (p.routerMode === 'memory') { memPath = to.split('#')[0].split('?')[0] || '/'; window.dispatchEvent(new Event('hashchange')); return; }
  if (p.routerMode === 'hash') { if (location.hash === '#' + to) window.dispatchEvent(new Event('hashchange')); else location.hash = to; }
  else { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }
}

export function Link({ to, children, className, onClick, ...rest }: any) {
  const h = href(to);
  return (
    <a
      href={h}
      className={className}
      {...rest}
      onClick={(e: any) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (platform().routerMode !== 'hash') { e.preventDefault(); navigate(to); }
      }}
    >
      {children}
    </a>
  );
}

export function useRouteParams(pattern: string): Record<string, string> | null {
  const path = useRoute();
  const pp = pattern.split('/').filter(Boolean);
  const parts = path.split('/').filter(Boolean);
  if (parts.length < pp.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) out[pp[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (pp[i] !== parts[i]) return null;
  }
  return out;
}
