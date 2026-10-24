import { createRoot } from 'react-dom/client';
import { App } from './pages/App';
import { setPlatform, type Platform } from './lib/platform';

export function mount(p: Platform, el: HTMLElement) {
  setPlatform(p);
  document.title = 'ReverseIt';
  createRoot(el).render(<App />);
}
