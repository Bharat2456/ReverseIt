/**
 * JavaScript / bundle analyzer. Static, regex-driven, single linear passes.
 * Never executes target code. Safe on minified bundles up to ~25 MB.
 */
import type { AnalysisPart, Evidence, Finding, Graph, GraphNode, Section, TextCtx, Tone } from './types';
import { makeEvidence } from './evidence';
import { bars, finding, fmtBytes, kv, list, table, tags } from './sections';
import { throwIfAborted, yieldToUi } from './options';
import { scanSecrets } from './secrets';
import { detectTech, type TechHit } from './techfp';
import { hostCategory, templateToPath, truncate, uniqueLimited } from './webutil';

export interface Endpoint {
  url: string;
  method: string;
  via: string;
  guess?: boolean;
}

export interface IpcFacts {
  main_handles: string[];
  main_listens: string[];
  renderer_invokes: string[];
  renderer_sends: string[];
  renderer_listens: string[];
  main_sends: string[];
  exposed_bridge: string[];
}

export interface WebPrefs {
  nodeIntegration?: boolean | string;
  contextIsolation?: boolean | string;
  sandbox?: boolean | string;
  webSecurity?: boolean | string;
  enableRemoteModule?: boolean | string;
  nodeIntegrationInWorker?: boolean | string;
  allowRunningInsecureContent?: boolean | string;
  preload?: string;
}

export interface JsFacts {
  bytes: number;
  lines: number;
  minified: boolean;
  moduleSystems: string[];
  imports: string[];
  nodeBuiltins: string[];
  libraries: { name: string; version?: string; source: string }[];
  endpoints: Endpoint[];
  websockets: string[];
  eventSources: string[];
  graphql: string[];
  persistedQueries: number;
  routes: string[];
  envVars: string[];
  configGlobals: string[];
  ipc: IpcFacts;
  webPreferences: WebPrefs[];
  electron: { browserWindows: number; openExternal: number; loadedUrls: string[]; autoUpdater: boolean; customProtocols: string[] };
  storageKeys: { kind: string; key: string }[];
  cookieWrites: number;
  postMessage: { sends: number; listeners: number; uncheckedListeners: number };
  serviceWorker: string[];
  featureFlags: string[];
  sourceMapUrls: string[];
  sinks: Record<string, number>;
  hosts: { host: string; count: number; category?: string }[];
  secrets: { kind: string; preview: string; severity: 'risk' | 'notice'; note?: string }[];
  counts: { functions: number; arrows: number; classes: number };
  tech: TechHit[];
}

const CAP = 300;
const LIT = /(?:'([^'\\\n]{1,300})'|"([^"\\\n]{1,300})"|`([^`\\]{1,300})`)/.source;

function litOf(m: RegExpExecArray, g: number): string {
  const raw = m[g] ?? m[g + 1] ?? m[g + 2] ?? '';
  const isTpl = m[g + 2] !== undefined;
  return isTpl ? templateToPath(raw) : raw;
}

function scan(re: RegExp, text: string, fn: (m: RegExpExecArray) => void | false, cap = 8000): void {
  re.lastIndex = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) re.lastIndex++;
    if (fn(m) === false) break;
    if (++n >= cap) break;
  }
}

function countOcc(text: string, needle: string, boundary = false, cap = 200000): number {
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    if (boundary) {
      const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
      const isId = (prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122) || prev === 95 || prev === 36 || prev === 46;
      if (isId) {
        i += needle.length;
        continue;
      }
    }
    n++;
    i += needle.length;
    if (n >= cap) break;
  }
  return n;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pkgRoot(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || /^[a-z]+:\/\//i.test(spec) || /\s/.test(spec)) return null;
  const parts = spec.replace(/^node:/, 'node:').split('/');
  if (spec.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'tls', 'dns', 'stream', 'zlib', 'util', 'events', 'url', 'querystring', 'buffer', 'assert', 'cluster', 'readline', 'worker_threads', 'vm', 'electron', 'process', 'module', 'v8', 'perf_hooks', 'timers', 'string_decoder', 'dgram', 'tty', 'fs/promises']);

/** Top-level keys of an object literal starting at `start` (the `{`). Bounded, string-aware. */
export function objectKeys(text: string, start: number, maxScan = 6000): string[] {
  const keys: string[] = [];
  const end = Math.min(text.length, start + maxScan);
  let depth = 0;
  let expectKey = false;
  let i = start;
  while (i < end) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < end && text[j] !== q) {
        if (text[j] === '\\') j++;
        j++;
      }
      if (depth === 1 && expectKey && q !== '`') {
        const lit = text.slice(i + 1, j);
        let k = j + 1;
        while (k < end && /\s/.test(text[k])) k++;
        if (text[k] === ':' || text[k] === '(') keys.push(lit);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (depth === 1 && c === '{') expectKey = true;
      i++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth <= 0) break;
      i++;
      continue;
    }
    if (depth === 1) {
      if (c === ',') {
        expectKey = true;
        i++;
        continue;
      }
      if (expectKey && /[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < end && /[\w$]/.test(text[j])) j++;
        let ident = text.slice(i, j);
        let k = j;
        while (k < end && /\s/.test(text[k])) k++;
        if ((ident === 'async' || ident === 'get' || ident === 'set') && /[A-Za-z_$]/.test(text[k] ?? '')) {
          let m = k;
          while (m < end && /[\w$]/.test(text[m])) m++;
          ident = text.slice(k, m);
          k = m;
          while (k < end && /\s/.test(text[k])) k++;
        }
        if (text[k] === ':' || text[k] === '(' || text[k] === ',' || text[k] === '}') keys.push(ident);
        expectKey = false;
        i = j;
        continue;
      }
    }
    i++;
  }
  return keys;
}

function parseBool(v: string): boolean | string {
  const s = v.trim();
  if (s === '!0' || s === 'true') return true;
  if (s === '!1' || s === 'false') return false;
  return truncate(s, 80);
}

const URLISH_CALL = /^(?:\/|https?:|wss?:|\$\{|\{)/;

async function maybeYield(len: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (len > 1_500_000) await yieldToUi();
}

export async function extractJsFacts(text: string, name = '', signal?: AbortSignal): Promise<JsFacts> {
  const bytes = text.length;
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
  const minified = bytes > 2000 && (lines <= 3 || bytes / lines > 400);

  // ---- module systems -------------------------------------------------------
  const moduleSystems: string[] = [];
  const hasIt = (s: string) => text.includes(s);
  if (hasIt('export default ') || hasIt('export{') || hasIt('export {') || hasIt('import.meta') || /(?:^|[;\n}])\s*import\s*(?:[\w$*{]|["'])/.test(text.slice(0, 2_000_000))) moduleSystems.push('ES modules');
  if (hasIt('require(') || hasIt('module.exports') || hasIt('exports.')) moduleSystems.push('CommonJS');
  if ((hasIt('typeof define') && hasIt('define.amd')) || (hasIt('typeof exports') && hasIt('typeof module'))) moduleSystems.push('UMD');
  if (hasIt('__webpack_require__') || hasIt('webpackChunk') || hasIt('webpackJsonp')) moduleSystems.push('webpack bundle');
  if (hasIt('__vite') || hasIt('import.meta.env')) moduleSystems.push('Vite bundle');
  if (hasIt('parcelRequire')) moduleSystems.push('Parcel bundle');
  if (hasIt('__commonJS') || hasIt('__esm(')) moduleSystems.push('esbuild bundle');
  if (hasIt('System.register')) moduleSystems.push('SystemJS');
  await maybeYield(bytes, signal);

  // ---- imports / libraries --------------------------------------------------
  const importSet = new Set<string>();
  const builtinSet = new Set<string>();
  const addSpec = (spec: string) => {
    const bare = spec.replace(/^node:/, '');
    if (NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split('/')[0])) {
      builtinSet.add(bare);
      return;
    }
    const root = pkgRoot(spec);
    if (root && importSet.size < 600) importSet.add(root);
  };
  if (hasIt('import')) scan(new RegExp(String.raw`\bimport\s+(?:[\w$*{},\s]{1,200}\s+from\s+)?(?:'([^'\n]{1,120})'|"([^"\n]{1,120})")`, 'g'), text, (m) => addSpec(m[1] ?? m[2]), 4000);
  if (hasIt('require(')) scan(/\brequire\(\s*(?:'([^'\n]{1,120})'|"([^"\n]{1,120})")\s*\)/g, text, (m) => addSpec(m[1] ?? m[2]), 6000);
  if (hasIt('import(')) scan(/\bimport\(\s*(?:'([^'\n]{1,120})'|"([^"\n]{1,120})")\s*\)/g, text, (m) => addSpec(m[1] ?? m[2]), 2000);

  const libraries: JsFacts['libraries'] = [];
  const libSeen = new Set<string>();
  const addLib = (n: string, v: string | undefined, source: string) => {
    const k = n.toLowerCase();
    if (libSeen.has(k) || libraries.length >= CAP) return;
    libSeen.add(k);
    libraries.push({ name: n, ...(v ? { version: v } : {}), source });
  };
  if (hasIt('/*')) {
    scan(/\/\*[!*]?\s*(?:@license\s+)?(?:\*\s*)?([A-Za-z][\w.@/-]{1,50})\s+(?:v|version\s+)?(\d+\.\d+\.\d+)/g, text, (m) => {
      const n = m[1];
      if (/^(copyright|license|version|released|updated|build|generated|author)$/i.test(n)) return;
      addLib(n, m[2], 'banner comment');
    }, 3000);
  }
  if (hasIt('node_modules/')) {
    scan(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//g, text, (m) => addLib(m[1], undefined, 'bundled path'), 6000);
  }
  await maybeYield(bytes, signal);

  // ---- HTTP surface ---------------------------------------------------------
  const endpoints: Endpoint[] = [];
  const epSeen = new Set<string>();
  const addEp = (url: string, method: string, via: string, guess?: boolean) => {
    const u = url.trim();
    if (!u || u.length > 300 || endpoints.length >= 1500) return;
    const k = `${method} ${u}`;
    if (epSeen.has(k)) return;
    epSeen.add(k);
    endpoints.push({ url: u, method, via, ...(guess ? { guess } : {}) });
  };
  const routes: string[] = [];
  const routeSeen = new Set<string>();
  const addRoute = (r: string) => {
    if (routeSeen.has(r) || routes.length >= 1000) return;
    routeSeen.add(r);
    routes.push(r);
  };

  if (hasIt('fetch(')) {
    scan(new RegExp(String.raw`\bfetch\(\s*` + LIT, 'g'), text, (m) => {
      const url = litOf(m, 1);
      const win = text.slice(m.index, m.index + 320);
      const mm = /method\s*:\s*["'`]([A-Za-z]{3,7})["'`]/.exec(win);
      if (mm) addEp(url, mm[1].toUpperCase(), 'fetch');
      else if (/\bbody\s*:/.test(win)) addEp(url, 'POST', 'fetch', true);
      else addEp(url, 'GET', 'fetch');
    });
    scan(new RegExp(String.raw`\bfetch\(\s*([A-Za-z_$][\w$.]{0,40})\s*\+\s*(?:'([^'\\\n]{1,200})'|"([^"\\\n]{1,200})")`, 'g'), text, (m) => {
      addEp(`{${m[1].split('.').pop()}}${m[2] ?? m[3]}`, /\bbody\s*:/.test(text.slice(m.index, m.index + 320)) ? 'POST' : 'GET', 'fetch');
    });
  }
  const clientRe = new RegExp(String.raw`\b([A-Za-z_$][\w$]{0,30})\.(get|post|put|patch|delete|head|options|request)\(\s*` + LIT, 'g');
  if (hasIt('.get(') || hasIt('.post(') || hasIt('.put(') || hasIt('.patch(') || hasIt('.delete(')) {
    scan(clientRe, text, (m) => {
      const recv = m[1];
      const verb = m[2].toUpperCase();
      const lit = litOf(m, 3);
      if (!URLISH_CALL.test(lit)) return;
      if (/^(app|router|server|route|routes|r|api_router|apiRouter|fastify|koa)$/.test(recv)) {
        if (lit.startsWith('/')) addRoute(`${verb} ${lit}`);
        return;
      }
      addEp(lit, verb === 'REQUEST' ? 'GET' : verb, recv === 'axios' ? 'axios' : `${recv}.${m[2]}`);
    }, 12000);
  }
  if (hasIt('.open(')) {
    scan(new RegExp(String.raw`\.open\(\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*,\s*` + LIT, 'gi'), text, (m) => addEp(litOf(m, 2), m[1].toUpperCase(), 'XMLHttpRequest'));
  }
  if (hasIt('$.ajax') || hasIt('$.get') || hasIt('$.post') || hasIt('$.getJSON') || hasIt('jQuery.ajax')) {
    scan(new RegExp(String.raw`\$\.(get|post|getJSON)\(\s*` + LIT, 'g'), text, (m) => addEp(litOf(m, 2), m[1] === 'post' ? 'POST' : 'GET', 'jQuery'));
    scan(new RegExp(String.raw`\$\.ajax\(\s*\{[^}]{0,300}?\burl\s*:\s*` + LIT, 'g'), text, (m) => {
      const mt = /\b(?:type|method)\s*:\s*["'](\w+)["']/i.exec(m[0]);
      addEp(litOf(m, 1), (mt?.[1] ?? 'GET').toUpperCase(), 'jQuery');
    });
  }
  const websockets: string[] = [];
  const eventSources: string[] = [];
  if (hasIt('WebSocket(')) scan(new RegExp(String.raw`new\s+WebSocket\(\s*` + LIT, 'g'), text, (m) => void websockets.push(litOf(m, 1)), 400);
  if (hasIt('EventSource(')) scan(new RegExp(String.raw`new\s+EventSource\(\s*` + LIT, 'g'), text, (m) => void eventSources.push(litOf(m, 1)), 400);
  // Literal API-looking paths found anywhere (lower confidence than real calls)
  scan(/['"`](\/(?:api|v\d{1,2}|graphql|rest|auth|oauth2?|rpc|trpc|ajax|services|gateway)(?:\/[\w\-./:{}$%@]{0,150})?)['"`]/g, text, (m) => {
    const u = m[1];
    if (![...epSeen].some((k) => k.endsWith(' ' + u))) addEp(u, '?', 'literal');
  }, 4000);

  // absolute URLs → hosts
  const hostCounts = new Map<string, number>();
  scan(/\bhttps?:\/\/([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5})(?::\d{2,5})?(\/[^\s'"`<>\\)]{0,140})?/g, text, (m) => {
    const host = m[1].toLowerCase();
    if (/^(www\.w3\.org|schemas?\.|purl\.org|example\.(com|org)|json-schema\.org|xmlns\.|ns\.adobe\.com|www\.example)/.test(host)) return;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    const path = m[2] ?? '';
    if (/^\/(?:api|v\d{1,2}|graphql|rest|rpc|trpc)\b/.test(path) || /^api[.-]/.test(host)) addEp(`https://${host}${path}`.replace(/[.,;]+$/, ''), '?', 'url literal');
  }, 12000);
  await maybeYield(bytes, signal);

  // ---- GraphQL --------------------------------------------------------------
  const graphql = new Set<string>();
  let persistedQueries = 0;
  if (hasIt('graphql') || hasIt('gql') || hasIt('__typename') || hasIt('operationName')) {
    scan(/\b(query|mutation|subscription)\s+([A-Za-z_]\w{2,60})\s*(?:\([^)]{0,200}\))?\s*\{/g, text, (m) => void (graphql.size < 400 && graphql.add(`${m[1]} ${m[2]}`)), 3000);
    scan(/operationName["']?\s*:\s*["']([A-Za-z_]\w{1,60})["']/g, text, (m) => void (graphql.size < 400 && graphql.add(`operation ${m[1]}`)), 2000);
    scan(/["']?sha256Hash["']?\s*:\s*["'][0-9a-f]{64}["']/g, text, () => void persistedQueries++, 5000);
  }

  // ---- Routes ---------------------------------------------------------------
  if (hasIt('path')) {
    scan(/\bpath\s*[:=]\s*\{?\s*["'](\/[A-Za-z0-9_\-/:*.?[\]]{0,100}|\*)["']/g, text, (m) => void addRoute(`PAGE ${m[1]}`), 3000);
  }
  if (hasIt('.get(') || hasIt('.post(') || hasIt('.use(') || hasIt('.all(')) {
    scan(new RegExp(String.raw`\b(?:app|router|server|route|routes|fastify)\.(get|post|put|patch|delete|all|use)\(\s*["'](\/[^"'\n]{0,120})["']`, 'g'), text, (m) => void addRoute(`${m[1].toUpperCase()} ${m[2]}`), 3000);
  }

  // ---- Env / config ---------------------------------------------------------
  const envVars = new Set<string>();
  const configGlobals = new Set<string>();
  if (hasIt('process.env')) {
    scan(/process\.env\.([A-Za-z_]\w{1,60})/g, text, (m) => void (envVars.size < CAP && envVars.add(m[1])), 6000);
    scan(/process\.env\[\s*["']([A-Za-z_]\w{1,60})["']\s*\]/g, text, (m) => void (envVars.size < CAP && envVars.add(m[1])), 3000);
  }
  if (hasIt('import.meta.env')) scan(/import\.meta\.env\.([A-Za-z_]\w{1,60})/g, text, (m) => void (envVars.size < CAP && envVars.add(m[1])), 3000);
  if (hasIt('Deno.env')) scan(/Deno\.env\.get\(\s*["']([A-Za-z_]\w{1,60})["']/g, text, (m) => void envVars.add(m[1]), 500);
  if (hasIt('window.')) {
    scan(/window\.(__[A-Za-z_]{2,40}__|ENV|APP_CONFIG|CONFIG|appConfig|dataLayer|__INITIAL_STATE__)\b/g, text, (m) => void (configGlobals.size < 60 && configGlobals.add('window.' + m[1])), 800);
  }
  await maybeYield(bytes, signal);

  // ---- Electron / IPC -------------------------------------------------------
  const ipc: IpcFacts = { main_handles: [], main_listens: [], renderer_invokes: [], renderer_sends: [], renderer_listens: [], main_sends: [], exposed_bridge: [] };
  const ipcSets: Record<keyof IpcFacts, Set<string>> = {
    main_handles: new Set(), main_listens: new Set(), renderer_invokes: new Set(), renderer_sends: new Set(), renderer_listens: new Set(), main_sends: new Set(), exposed_bridge: new Set(),
  };
  const webPreferences: WebPrefs[] = [];
  const electron = { browserWindows: 0, openExternal: 0, loadedUrls: [] as string[], autoUpdater: false, customProtocols: [] as string[] };
  if (hasIt('ipcMain') || hasIt('ipcRenderer') || hasIt('exposeInMainWorld') || hasIt('webContents') || hasIt('BrowserWindow')) {
    const mainNames = new Set(['ipcMain']);
    const rendNames = new Set(['ipcRenderer']);
    scan(/\bipcMain\s*:\s*([A-Za-z_$][\w$]*)/g, text, (m) => void mainNames.add(m[1]), 20);
    scan(/\bipcRenderer\s*:\s*([A-Za-z_$][\w$]*)/g, text, (m) => void rendNames.add(m[1]), 20);
    scan(/([A-Za-z_$][\w$]*)\s*=\s*[\w$.()"']{1,60}?\.ipcMain\b/g, text, (m) => void mainNames.add(m[1]), 20);
    scan(/([A-Za-z_$][\w$]*)\s*=\s*[\w$.()"']{1,60}?\.ipcRenderer\b/g, text, (m) => void rendNames.add(m[1]), 20);
    const alt = (s: Set<string>) => [...s].map(escapeRe).join('|');
    const put = (k: keyof IpcFacts, v: string) => {
      if (ipcSets[k].size < CAP) ipcSets[k].add(v);
    };
    if (hasIt('ipcMain') || mainNames.size > 1) {
      scan(new RegExp(String.raw`(?<![\w$])(?:${alt(mainNames)})\.(handle|handleOnce|on|once|addListener)\(\s*` + LIT, 'g'), text, (m) => {
        put(m[1].startsWith('handle') ? 'main_handles' : 'main_listens', litOf(m, 2));
      }, 3000);
    }
    if (hasIt('ipcRenderer') || rendNames.size > 1) {
      scan(new RegExp(String.raw`(?<![\w$])(?:${alt(rendNames)})\.(invoke|send|sendSync|sendTo|postMessage|on|once|addListener)\(\s*` + LIT, 'g'), text, (m) => {
        const v = m[1];
        put(v === 'invoke' ? 'renderer_invokes' : v === 'on' || v === 'once' || v === 'addListener' ? 'renderer_listens' : 'renderer_sends', litOf(m, 2));
      }, 3000);
    }
    if (hasIt('webContents') || hasIt('.sender.send')) {
      scan(new RegExp(String.raw`(?:\.webContents|\.sender)\.send\(\s*` + LIT, 'g'), text, (m) => void put('main_sends', litOf(m, 1)), 2000);
    }
    if (hasIt('exposeInMainWorld')) {
      scan(/exposeInMainWorld\(\s*(?:'([^'\\\n]{1,80})'|"([^"\\\n]{1,80})")\s*,\s*/g, text, (m) => {
        const apiName = m[1] ?? m[2];
        put('exposed_bridge', apiName);
        const after = m.index + m[0].length;
        if (text[after] === '{') for (const k of objectKeys(text, after)) put('exposed_bridge', `${apiName}.${k}`);
      }, 200);
    }
    if (hasIt('webPreferences')) {
      scan(/webPreferences\s*:\s*\{/g, text, (m) => {
        const body = text.slice(m.index + m[0].length - 1, m.index + m[0].length + 900);
        const end = body.indexOf('}');
        const seg = end >= 0 ? body.slice(0, end) : body;
        const wp: WebPrefs = {};
        scan(/\b(nodeIntegration|contextIsolation|sandbox|webSecurity|enableRemoteModule|nodeIntegrationInWorker|allowRunningInsecureContent|preload)\s*:\s*([^,}]{1,120})/g, seg, (mm) => {
          (wp as any)[mm[1]] = mm[1] === 'preload' ? truncate(mm[2].trim(), 80) : parseBool(mm[2]);
        }, 20);
        if (Object.keys(wp).length && webPreferences.length < 20) webPreferences.push(wp);
      }, 40);
    }
    electron.browserWindows = countOcc(text, 'new BrowserWindow(') + countOcc(text, 'BrowserWindow({');
    electron.openExternal = countOcc(text, 'shell.openExternal(');
    electron.autoUpdater = hasIt('autoUpdater') || hasIt('electron-updater');
    if (hasIt('.loadURL(')) scan(new RegExp(String.raw`\.loadURL\(\s*` + LIT, 'g'), text, (m) => void (electron.loadedUrls.length < 20 && electron.loadedUrls.push(litOf(m, 1))), 100);
    if (hasIt('registerSchemesAsPrivileged') || hasIt('registerFileProtocol') || hasIt('protocol.handle(') || hasIt('setAsDefaultProtocolClient')) {
      scan(new RegExp(String.raw`(?:registerFileProtocol|protocol\.handle|setAsDefaultProtocolClient|registerStringProtocol)\(\s*` + LIT, 'g'), text, (m) => void electron.customProtocols.push(litOf(m, 1)), 40);
    }
    for (const k of Object.keys(ipcSets) as (keyof IpcFacts)[]) ipc[k] = [...ipcSets[k]];
  }
  await maybeYield(bytes, signal);

  // ---- storage / messaging / worker / flags ---------------------------------
  const storageKeys: { kind: string; key: string }[] = [];
  const storSeen = new Set<string>();
  const addStore = (kind: string, key: string) => {
    const k = kind + ':' + key;
    if (storSeen.has(k) || storageKeys.length >= CAP) return;
    storSeen.add(k);
    storageKeys.push({ kind, key });
  };
  if (hasIt('localStorage') || hasIt('sessionStorage')) {
    scan(new RegExp(String.raw`\b(localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*` + LIT, 'g'), text, (m) => addStore(m[1], litOf(m, 2)), 4000);
    scan(new RegExp(String.raw`\b(localStorage|sessionStorage)\[\s*` + LIT + String.raw`\s*\]`, 'g'), text, (m) => addStore(m[1], litOf(m, 2)), 2000);
  }
  if (hasIt('indexedDB')) scan(new RegExp(String.raw`indexedDB\.open\(\s*` + LIT, 'g'), text, (m) => addStore('indexedDB', litOf(m, 1)), 200);
  let cookieWrites = 0;
  if (hasIt('document.cookie')) {
    scan(/document\.cookie\s*=\s*(?:'([A-Za-z0-9_\-.]{1,60})=|"([A-Za-z0-9_\-.]{1,60})=|`([A-Za-z0-9_\-.]{1,60})=)/g, text, (m) => {
      cookieWrites++;
      addStore('cookie', m[1] ?? m[2] ?? m[3]);
    }, 400);
  }
  if (hasIt('Cookies.')) scan(new RegExp(String.raw`\bCookies\.(?:get|set|remove)\(\s*` + LIT, 'g'), text, (m) => addStore('cookie', litOf(m, 1)), 200);

  const pm = { sends: countOcc(text, '.postMessage('), listeners: 0, uncheckedListeners: 0 };
  if (hasIt('"message"') || hasIt("'message'")) {
    scan(/addEventListener\(\s*["']message["']/g, text, (m) => {
      pm.listeners++;
      if (!/\.origin\b/.test(text.slice(m.index, m.index + 500))) pm.uncheckedListeners++;
    }, 400);
  }
  const serviceWorker: string[] = [];
  if (hasIt('serviceWorker')) scan(new RegExp(String.raw`serviceWorker\.register\(\s*` + LIT, 'g'), text, (m) => void serviceWorker.push(litOf(m, 1)), 20);
  const featureFlags = new Set<string>();
  scan(new RegExp(String.raw`\b(?:isFeatureEnabled|featureEnabled|useFeatureFlag|useFlag|getFeatureFlag|boolVariation|isFeatureOn|hasFeature|checkGate|getBooleanValue)\(\s*` + LIT, 'g'), text, (m) => void (featureFlags.size < 200 && featureFlags.add(litOf(m, 1))), 800);
  const sourceMapUrls: string[] = [];
  if (hasIt('sourceMappingURL')) scan(/\/[/*][#@]\s*sourceMappingURL=([^\s'"*]+)/g, text, (m) => void (sourceMapUrls.length < 10 && sourceMapUrls.push(m[1])), 20);
  await maybeYield(bytes, signal);

  // ---- risky sinks ----------------------------------------------------------
  const sinks: Record<string, number> = {};
  const sinkDefs: [string, string, boolean][] = [
    ['eval()', 'eval(', true],
    ['new Function()', 'new Function(', false],
    ['innerHTML assignment', '.innerHTML=', false],
    ['innerHTML assignment ', '.innerHTML =', false],
    ['outerHTML assignment', '.outerHTML=', false],
    ['document.write()', 'document.write(', false],
    ['insertAdjacentHTML()', 'insertAdjacentHTML(', false],
    ['dangerouslySetInnerHTML', 'dangerouslySetInnerHTML', false],
    ['child_process', 'child_process', false],
    ['shell.openExternal()', 'shell.openExternal(', false],
  ];
  for (const [label, needle, boundary] of sinkDefs) {
    const n = countOcc(text, needle, boundary);
    if (n > 0) sinks[label.trim()] = (sinks[label.trim()] ?? 0) + n;
  }

  // ---- counts / hosts / secrets / tech --------------------------------------
  let functions = 0;
  for (let i = text.indexOf('function'); i !== -1 && functions < 5_000_000; i = text.indexOf('function', i + 8)) {
    const nx = text.charCodeAt(i + 8);
    const isId = (nx >= 48 && nx <= 57) || (nx >= 65 && nx <= 90) || (nx >= 97 && nx <= 122) || nx === 95 || nx === 36;
    if (!isId) functions++;
  }
  let classes = 0;
  if (hasIt('class ')) scan(/\bclass\s+[A-Za-z_$]/g, text, () => void classes++, 200000);
  const counts = { functions, arrows: countOcc(text, '=>'), classes };

  const hosts = [...hostCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([host, count]) => ({ host, count, ...(hostCategory(host) ? { category: hostCategory(host) } : {}) }));

  await maybeYield(bytes, signal);
  const secrets = scanSecrets(text, 40).map((s) => ({ kind: s.kind, preview: s.preview, severity: s.severity, ...(s.note ? { note: s.note } : {}) }));
  const tech = detectTech({ urls: name ? [name] : [], scripts: [text] });
  for (const t of tech) if (t.confidence !== 'low') addLib(t.name, undefined, 'fingerprint');

  return {
    bytes,
    lines,
    minified,
    moduleSystems,
    imports: [...importSet].sort(),
    nodeBuiltins: [...builtinSet].sort(),
    libraries,
    endpoints,
    websockets: uniqueLimited(websockets, 100),
    eventSources: uniqueLimited(eventSources, 100),
    graphql: [...graphql],
    persistedQueries,
    routes,
    envVars: [...envVars].sort(),
    configGlobals: [...configGlobals],
    ipc,
    webPreferences,
    electron,
    storageKeys,
    cookieWrites,
    postMessage: pm,
    serviceWorker,
    featureFlags: [...featureFlags],
    sourceMapUrls,
    sinks,
    hosts,
    secrets,
    counts,
    tech,
  };
}

/** Merge facts from several scripts (used by website analysis). */
export function mergeJsFacts(all: JsFacts[]): JsFacts {
  const uni = <T>(sel: (f: JsFacts) => T[], key: (t: T) => string, cap = 1500): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const f of all) for (const t of sel(f)) {
      const k = key(t);
      if (seen.has(k) || out.length >= cap) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };
  const ipc: IpcFacts = {
    main_handles: uni((f) => f.ipc.main_handles, (s) => s),
    main_listens: uni((f) => f.ipc.main_listens, (s) => s),
    renderer_invokes: uni((f) => f.ipc.renderer_invokes, (s) => s),
    renderer_sends: uni((f) => f.ipc.renderer_sends, (s) => s),
    renderer_listens: uni((f) => f.ipc.renderer_listens, (s) => s),
    main_sends: uni((f) => f.ipc.main_sends, (s) => s),
    exposed_bridge: uni((f) => f.ipc.exposed_bridge, (s) => s),
  };
  const hostMap = new Map<string, { host: string; count: number; category?: string }>();
  for (const f of all) for (const h of f.hosts) {
    const cur = hostMap.get(h.host);
    if (cur) cur.count += h.count;
    else hostMap.set(h.host, { ...h });
  }
  const sinks: Record<string, number> = {};
  for (const f of all) for (const [k, v] of Object.entries(f.sinks)) sinks[k] = (sinks[k] ?? 0) + v;
  const techMap = new Map<string, TechHit>();
  for (const f of all) for (const t of f.tech) if (!techMap.has(t.name)) techMap.set(t.name, t);
  return {
    bytes: all.reduce((a, f) => a + f.bytes, 0),
    lines: all.reduce((a, f) => a + f.lines, 0),
    minified: all.some((f) => f.minified),
    moduleSystems: uni((f) => f.moduleSystems, (s) => s, 20),
    imports: uni((f) => f.imports, (s) => s, 600),
    nodeBuiltins: uni((f) => f.nodeBuiltins, (s) => s, 100),
    libraries: uni((f) => f.libraries, (l) => l.name.toLowerCase(), CAP),
    endpoints: uni((f) => f.endpoints, (e) => `${e.method} ${e.url}`, 1500),
    websockets: uni((f) => f.websockets, (s) => s, 100),
    eventSources: uni((f) => f.eventSources, (s) => s, 100),
    graphql: uni((f) => f.graphql, (s) => s, 400),
    persistedQueries: all.reduce((a, f) => a + f.persistedQueries, 0),
    routes: uni((f) => f.routes, (s) => s, 1000),
    envVars: uni((f) => f.envVars, (s) => s, CAP).sort(),
    configGlobals: uni((f) => f.configGlobals, (s) => s, 60),
    ipc,
    webPreferences: all.flatMap((f) => f.webPreferences).slice(0, 20),
    electron: {
      browserWindows: all.reduce((a, f) => a + f.electron.browserWindows, 0),
      openExternal: all.reduce((a, f) => a + f.electron.openExternal, 0),
      loadedUrls: uni((f) => f.electron.loadedUrls, (s) => s, 20),
      autoUpdater: all.some((f) => f.electron.autoUpdater),
      customProtocols: uni((f) => f.electron.customProtocols, (s) => s, 40),
    },
    storageKeys: uni((f) => f.storageKeys, (s) => `${s.kind}:${s.key}`, CAP),
    cookieWrites: all.reduce((a, f) => a + f.cookieWrites, 0),
    postMessage: {
      sends: all.reduce((a, f) => a + f.postMessage.sends, 0),
      listeners: all.reduce((a, f) => a + f.postMessage.listeners, 0),
      uncheckedListeners: all.reduce((a, f) => a + f.postMessage.uncheckedListeners, 0),
    },
    serviceWorker: uni((f) => f.serviceWorker, (s) => s, 20),
    featureFlags: uni((f) => f.featureFlags, (s) => s, 200),
    sourceMapUrls: uni((f) => f.sourceMapUrls, (s) => s, 40),
    sinks,
    hosts: [...hostMap.values()].sort((a, b) => b.count - a.count).slice(0, 80),
    secrets: uni((f) => f.secrets, (s) => s.kind + s.preview, 60),
    counts: {
      functions: all.reduce((a, f) => a + f.counts.functions, 0),
      arrows: all.reduce((a, f) => a + f.counts.arrows, 0),
      classes: all.reduce((a, f) => a + f.counts.classes, 0),
    },
    tech: [...techMap.values()],
  };
}

const TECH_TONE: Record<string, Tone> = { Framework: 'cyan', Bundler: 'dim', 'UI kit': 'cyan', Hosting: 'orange', CDN: 'orange', Backend: 'orange', CMS: 'orange', Analytics: 'dim', Monitoring: 'dim', Payments: 'green', Auth: 'green', AI: 'orange', 'Desktop shell': 'orange', 'Mobile shell': 'orange' };

export function techTags(tech: TechHit[], title = 'Detected technologies', max = 40): Section {
  return tags(title, tech.slice(0, max).map((t) => ({ label: `${t.name}${t.confidence === 'low' ? ' (maybe)' : ''}`, tone: TECH_TONE[t.category] ?? 'dim' })));
}

/** Presentation sections for a JsFacts block (shared by file and website analysis). */
export function factsToSections(f: JsFacts, rowMax = 200): Section[] {
  const s: Section[] = [];
  s.push(
    kv('Overview', {
      Size: fmtBytes(f.bytes),
      Lines: f.lines,
      'Minified (names shortened)': f.minified,
      'Module system': f.moduleSystems.join(', ') || 'plain script',
      'Functions (approx.)': f.counts.functions,
      'Arrow functions': f.counts.arrows,
      Classes: f.counts.classes,
    }),
  );
  if (f.tech.length) s.push(techTags(f.tech));
  if (f.endpoints.length) {
    s.push(table('Network calls found in the code', ['Method', 'URL or path', 'Found via'], f.endpoints.map((e) => [e.guess ? e.method + '?' : e.method, e.url, e.via]), rowMax));
  }
  if (f.routes.length) s.push(list('Screens and server routes', f.routes));
  const ipcRows: (string | number | null)[][] = [];
  const dir: [keyof IpcFacts, string][] = [
    ['renderer_invokes', 'window → main (invoke, expects reply)'],
    ['renderer_sends', 'window → main (send)'],
    ['main_handles', 'main handles (replies to invoke)'],
    ['main_listens', 'main listens'],
    ['main_sends', 'main → window (push)'],
    ['renderer_listens', 'window listens'],
  ];
  for (const [k, label] of dir) for (const ch of f.ipc[k]) ipcRows.push([label, ch]);
  if (ipcRows.length) s.push(table('Electron messages between app parts (IPC)', ['Direction', 'Channel'], ipcRows, rowMax));
  if (f.ipc.exposed_bridge.length) s.push(list('Functions the app exposes to its web pages (preload bridge)', f.ipc.exposed_bridge));
  if (f.webPreferences.length) {
    const wp = f.webPreferences[0];
    s.push(kv('Electron window security settings', { nodeIntegration: String(wp.nodeIntegration ?? 'default (off)'), contextIsolation: String(wp.contextIsolation ?? 'default (on)'), sandbox: String(wp.sandbox ?? 'default'), webSecurity: String(wp.webSecurity ?? 'default (on)'), preload: wp.preload ?? null }));
  }
  if (f.envVars.length) s.push(list('Environment variables the code reads', f.envVars));
  if (f.configGlobals.length) s.push(list('Global configuration objects', f.configGlobals));
  if (f.storageKeys.length) s.push(table('What it stores in the browser', ['Where', 'Key'], f.storageKeys.map((k) => [k.kind, k.key]), rowMax));
  if (f.graphql.length) s.push(list('GraphQL operations', f.graphql));
  if (f.websockets.length || f.eventSources.length) s.push(list('Live connections (WebSocket / event stream)', [...f.websockets.map((w) => `ws  ${w}`), ...f.eventSources.map((w) => `sse ${w}`)]));
  if (f.hosts.length) s.push(table('Outside services mentioned', ['Host', 'Mentions', 'Kind'], f.hosts.map((h) => [h.host, h.count, h.category ?? null]), rowMax));
  if (f.imports.length) s.push(list('Packages imported', f.imports));
  if (f.libraries.length) s.push(list('Libraries identified inside the bundle', f.libraries.map((l) => (l.version ? `${l.name} ${l.version}` : l.name))));
  if (f.featureFlags.length) s.push(list('Feature flags', f.featureFlags));
  if (Object.keys(f.sinks).length) s.push(bars('Risky code patterns (count)', Object.entries(f.sinks).map(([label, value]) => ({ label, value }))));
  if (f.secrets.length) s.push(table('Possible secrets (masked)', ['Kind', 'Preview', 'Severity'], f.secrets.map((x) => [x.kind, x.preview, x.severity]), rowMax));
  if (f.sourceMapUrls.length) s.push(list('Source map references', f.sourceMapUrls));
  return s;
}

export function factsToFindings(f: JsFacts, label = 'This code'): Finding[] {
  const out: Finding[] = [];
  const risk = f.secrets.filter((x) => x.severity === 'risk');
  const notice = f.secrets.filter((x) => x.severity === 'notice');
  if (risk.length) out.push(finding(`${risk.length} possible secret${risk.length > 1 ? 's' : ''} embedded in the code`, 'risk', `Kinds: ${[...new Set(risk.map((x) => x.kind))].join(', ')}. Values are masked here. Anything shipped to users can be read by users.`, ['secrets']));
  if (notice.length) out.push(finding(`${notice.length} key${notice.length > 1 ? 's' : ''} that are often public by design`, 'notice', [...new Set(notice.map((x) => x.kind))].join(', '), ['secrets']));
  for (const wp of f.webPreferences) {
    if (wp.nodeIntegration === true) out.push(finding('Electron window runs web content with full system access (nodeIntegration on)', 'risk', 'If the window ever shows untrusted content, that content can run programs on the computer.', ['electron']));
    if (wp.contextIsolation === false) out.push(finding('Electron context isolation is switched off', 'risk', 'Web pages can reach the preload scripts’ internals.', ['electron']));
    if (wp.webSecurity === false) out.push(finding('Electron web security is switched off', 'risk', 'The same-origin protection is disabled for that window.', ['electron']));
    if (wp.sandbox === false) out.push(finding('Electron sandbox is switched off for a window', 'warning', undefined, ['electron']));
  }
  if (f.ipc.exposed_bridge.length) out.push(finding(`The app exposes ${f.ipc.exposed_bridge.length} bridge item${f.ipc.exposed_bridge.length > 1 ? 's' : ''} to its web pages`, 'info', f.ipc.exposed_bridge.slice(0, 8).join(', '), ['electron']));
  const ipcCount = Object.values(f.ipc).reduce((a, v) => a + v.length, 0) - f.ipc.exposed_bridge.length;
  if (ipcCount > 0) out.push(finding(`${ipcCount} internal message channel${ipcCount > 1 ? 's' : ''} (Electron IPC) found`, 'info', undefined, ['electron']));
  if (f.endpoints.length) out.push(finding(`${f.endpoints.length} network endpoint${f.endpoints.length > 1 ? 's' : ''} referenced in the code`, 'info', f.endpoints.slice(0, 5).map((e) => `${e.method} ${e.url}`).join('\n'), ['api']));
  const plain = f.endpoints.filter((e) => /^http:\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(e.url));
  if (plain.length) out.push(finding(`${plain.length} endpoint${plain.length > 1 ? 's' : ''} use unencrypted http://`, 'warning', plain.slice(0, 4).map((e) => e.url).join('\n'), ['transport']));
  if (f.sinks['eval()'] || f.sinks['new Function()']) out.push(finding(`${label} builds code from text at run time (eval / new Function)`, 'warning', `eval: ${f.sinks['eval()'] ?? 0}, new Function: ${f.sinks['new Function()'] ?? 0}`, ['injection']));
  const htmlSinks = (f.sinks['innerHTML assignment'] ?? 0) + (f.sinks['dangerouslySetInnerHTML'] ?? 0) + (f.sinks['document.write()'] ?? 0) + (f.sinks['insertAdjacentHTML()'] ?? 0);
  if (htmlSinks) out.push(finding(`${htmlSinks} place${htmlSinks > 1 ? 's' : ''} insert raw HTML into the page`, 'notice', 'Safe only when the inserted text is trusted or sanitised.', ['xss']));
  if (f.postMessage.uncheckedListeners > 0) out.push(finding(`${f.postMessage.uncheckedListeners} message listener${f.postMessage.uncheckedListeners > 1 ? 's' : ''} without an obvious origin check`, 'warning', 'Cross-window messages should confirm who sent them.', ['postmessage']));
  if (f.minified) out.push(finding('Code is minified', 'notice', 'Variable and function names are shortened, so the logic is harder to read, but strings, URLs and structure remain visible.'));
  if (f.sourceMapUrls.length) out.push(finding('A source map is referenced', 'notice', 'If the map file is published, the original source code can usually be recovered from it.', ['sourcemap']));
  return out;
}

const SHORT = (s: string, n = 48) => truncate(s, n);

export function factsToGraph(f: JsFacts, rootId: string, rootLabel: string, rootGroup: GraphNode['group'] = 'module'): Graph {
  const nodes: GraphNode[] = [{ id: rootId, label: SHORT(rootLabel, 36), group: rootGroup, weight: 8 }];
  const edges: Graph['edges'] = [];
  const add = (n: GraphNode, from: string, to: string, label?: string) => {
    if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
    edges.push({ from, to, ...(label ? { label } : {}) });
  };
  const eps = [...f.endpoints].sort((a, b) => (a.via === 'literal' ? 1 : 0) - (b.via === 'literal' ? 1 : 0)).slice(0, 20);
  for (const e of eps) add({ id: `api:${e.method} ${e.url}`, label: SHORT(`${e.method} ${e.url}`, 44), group: 'api', weight: 4 }, rootId, `api:${e.method} ${e.url}`, e.via);
  for (const h of f.hosts.filter((x) => x.category !== 'cdn' && x.category !== 'fonts').slice(0, 10)) add({ id: `svc:${h.host}`, label: h.host, group: 'service', weight: Math.min(7, 2 + Math.round(Math.log2(h.count + 1))) }, rootId, `svc:${h.host}`, h.category ?? 'calls');
  const chan = (arr: string[], dir: 'out' | 'in', label: string) => {
    for (const ch of arr.slice(0, 10)) {
      const id = `ipc:${ch}`;
      if (!nodes.some((x) => x.id === id)) nodes.push({ id, label: SHORT(ch, 36), group: 'native', weight: 3 });
      edges.push(dir === 'out' ? { from: rootId, to: id, label } : { from: id, to: rootId, label });
    }
  };
  chan(f.ipc.renderer_invokes, 'out', 'invoke');
  chan(f.ipc.renderer_sends, 'out', 'send');
  chan(f.ipc.main_handles, 'in', 'handled here');
  chan(f.ipc.main_listens, 'in', 'listens');
  chan(f.ipc.main_sends, 'out', 'pushes');
  for (const b of f.ipc.exposed_bridge.filter((x) => !x.includes('.')).slice(0, 4)) add({ id: `bridge:${b}`, label: `window.${b}`, group: 'native', weight: 5 }, rootId, `bridge:${b}`, 'exposes');
  for (const k of f.storageKeys.slice(0, 8)) add({ id: `data:${k.kind}:${k.key}`, label: SHORT(`${k.kind}: ${k.key}`, 36), group: 'data', weight: 2 }, rootId, `data:${k.kind}:${k.key}`, 'stores');
  for (const t of f.tech.filter((x) => x.confidence !== 'low' && !['Server', 'Platform'].includes(x.category)).slice(0, 10)) add({ id: `lib:${t.name}`, label: t.name, group: 'lib', weight: 3 }, rootId, `lib:${t.name}`, 'built with');
  return { nodes, edges };
}

export async function analyzeJavaScript(ctx: TextCtx): Promise<AnalysisPart> {
  const { text, name, target, opts } = ctx;
  let facts: JsFacts;
  try {
    facts = await extractJsFacts(text, ctx.path ?? name, opts.signal);
  } catch (e: any) {
    if (e?.name === 'AbortedError') throw e;
    const ev = makeEvidence({
      operation: 'analyze_javascript',
      title: 'JavaScript code',
      target,
      summary: 'ReverseIt could not fully read this JavaScript file.',
      normalized_result: { error: String(e?.message ?? e) },
      sections: [],
      coverage: { status: 'partial', notes: [String(e?.message ?? e)] },
      limitations: ['Static scan failed part-way; nothing here should be treated as complete.'],
    });
    return { evidence: [ev] };
  }
  const f = facts;
  const ipcTotal = Object.entries(f.ipc).filter(([k]) => k !== 'exposed_bridge').reduce((a, [, v]) => a + v.length, 0);
  const bits: string[] = [];
  if (f.tech.length) bits.push(`built with ${f.tech.filter((t) => t.confidence !== 'low').slice(0, 3).map((t) => t.name).join(', ') || 'unidentified tooling'}`);
  if (f.endpoints.length) bits.push(`${f.endpoints.length} network endpoint${f.endpoints.length > 1 ? 's' : ''}`);
  if (ipcTotal) bits.push(`${ipcTotal} Electron message channel${ipcTotal > 1 ? 's' : ''}`);
  if (f.routes.length) bits.push(`${f.routes.length} route${f.routes.length > 1 ? 's' : ''}`);
  if (f.secrets.length) bits.push(`${f.secrets.length} possible secret${f.secrets.length > 1 ? 's' : ''}`);
  const summary = `${f.minified ? 'Minified' : 'Readable'} JavaScript (${fmtBytes(f.bytes)})${bits.length ? ': ' + bits.join('; ') : ''}.`;
  const slim = (a: string[], n = CAP) => a.slice(0, n);
  const evidence: Evidence = makeEvidence({
    operation: 'analyze_javascript',
    title: `JavaScript: ${name || 'script'}`,
    target,
    summary,
    normalized_result: {
      stats: { bytes: f.bytes, lines: f.lines, minified: f.minified, counts: f.counts },
      module_systems: f.moduleSystems,
      imports: slim(f.imports),
      node_builtins: f.nodeBuiltins,
      libraries: f.libraries.slice(0, CAP).map((l) => (l.version ? `${l.name}@${l.version}` : l.name)),
      endpoints: f.endpoints.slice(0, CAP).map((e) => ({ url: e.url, method: e.method, via: e.via })),
      ipc: {
        main_handles: slim(f.ipc.main_handles),
        main_listens: slim(f.ipc.main_listens),
        renderer_invokes: slim(f.ipc.renderer_invokes),
        renderer_sends: slim(f.ipc.renderer_sends),
        renderer_listens: slim(f.ipc.renderer_listens),
        main_sends: slim(f.ipc.main_sends),
        exposed_bridge: slim(f.ipc.exposed_bridge),
      },
      electron: { window_preferences: f.webPreferences, ...f.electron },
      routes: slim(f.routes),
      env_vars: slim(f.envVars),
      config_globals: f.configGlobals,
      storage_keys: f.storageKeys.slice(0, CAP).map((k) => `${k.kind}:${k.key}`),
      graphql_operations: slim(f.graphql),
      websockets: slim(f.websockets),
      event_sources: slim(f.eventSources),
      source_map_urls: f.sourceMapUrls,
      feature_flags: slim(f.featureFlags),
      service_worker: f.serviceWorker,
      post_message: f.postMessage,
      sinks: f.sinks,
      hosts: f.hosts.slice(0, 40),
      secrets: f.secrets.map((s) => ({ kind: s.kind, preview: s.preview, severity: s.severity })),
      technologies: f.tech.slice(0, 40).map((t) => ({ name: t.name, category: t.category, confidence: t.confidence })),
    },
    sections: factsToSections(f, opts.maxRows),
    findings: factsToFindings(f),
    graph: factsToGraph(f, `js:${name || 'script'}`, (name || 'script').split('/').pop() || 'script'),
    coverage: { status: 'partial', notes: ['Static pattern scan: addresses and channel names built at run time are not visible.'] },
    limitations: [
      'This is a static text scan; the code was never run, so URLs, channels or keys assembled dynamically will be missed.',
      'Method names marked with "?" are guesses from nearby code.',
      ...(f.minified ? ['The code is minified, so function and variable names are not meaningful.'] : []),
    ],
  });
  return { evidence: [evidence] };
}

export type { JsFacts as JavaScriptFacts };
