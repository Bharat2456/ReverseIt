import { RouterProvider, useRoute } from '../lib/router';
import { platform } from '../lib/platform';
import { inApp } from '../lib/paths';
import { ToastProvider } from '../components/ui';
import { AppShell } from './Shell';
import { Landing } from './Landing';
import { DocsPage } from './Docs';
import { BuilderPage } from './Builder';

function Routes() {
  const route = useRoute();
  const p = platform();
  if (p.hasLanding && !inApp(route)) {
    if (route === '/docs') return <DocsPage />;
    if (route === '/builder') return <BuilderPage />;
    return <Landing />;
  }
  return <AppShell />;
}

export function App() {
  return <ToastProvider><RouterProvider><Routes /></RouterProvider></ToastProvider>;
}
