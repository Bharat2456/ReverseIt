import { platform } from './platform';
export const appPath = (p = '') => (platform().appBase + (p.startsWith('/') ? p : '/' + p)).replace(/\/+$/, '') || '/';
export const inApp = (route: string) => { const b = platform().appBase; return b ? route === b || route.startsWith(b + '/') : true; };
export function relPath(route: string): string {
  const b = platform().appBase;
  const r = b && route.startsWith(b) ? route.slice(b.length) : route;
  return r || '/';
}
