import '../shared/ui/theme.css';
import { mount } from '../shared/ui/mount';
import { browserSaveFile, type Platform } from '../shared/ui/lib/platform';
import { apiAnalyzeSite, apiChat } from '../shared/ui/lib/aiClient';

const platform: Platform = {
  version: 'v3',
  edition: 'Web platform',
  routerMode: 'history',
  hasLanding: true,
  appBase: '/app',
  canFetchSites: true,
  aiMode: 'providers',
  aiNote: 'Uses your own API key.',
  async chat(messages, opts, provider) {
    if (!provider) throw new Error('Connect an AI key first (AI Connect page).');
    return apiChat(provider, messages, opts);
  },
  analyzeSite: apiAnalyzeSite,
  saveFile: browserSaveFile,
  asset: (n) => '/assets/' + n,
};
mount(platform, document.getElementById('root')!);
