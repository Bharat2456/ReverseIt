/**
 * Technology fingerprints: "what is this site / bundle built with?"
 * Cheap string/regex checks only. Literal strings are preferred over regexes
 * because String.includes is far faster than a regex over multi-megabyte bundles.
 */

export interface TechInput {
  urls?: string[];
  headers?: Record<string, string>;
  html?: string;
  scripts?: string[];
  cookies?: string[];
}

export interface TechHit {
  name: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}

type Conf = 'high' | 'medium' | 'low';
/** u = URL, h = response header line (lowercase "name: value"), m = HTML markup, j = JavaScript, c = cookie name (lowercase) */
type Where = 'u' | 'h' | 'm' | 'j' | 'c';
type Test = [Where, string | RegExp, Conf?];
interface Rule {
  name: string;
  cat: string;
  tests: Test[];
}

const R = (name: string, cat: string, ...tests: Test[]): Rule => ({ name, cat, tests });

const RULES: Rule[] = [
  // ---- frontend frameworks ----
  R('React', 'Framework', ['j', 'Symbol.for("react.element")', 'high'], ['j', 'react.transitional.element', 'high'], ['j', '__reactFiber$', 'high'], ['j', '__reactProps$', 'high'], ['j', '_reactRootContainer', 'high'], ['j', 'react-dom.production', 'high'], ['m', 'data-reactroot', 'high'], ['j', '__REACT_DEVTOOLS_GLOBAL_HOOK__', 'medium']),
  R('Next.js', 'Framework', ['m', '__NEXT_DATA__', 'high'], ['u', '/_next/static/', 'high'], ['h', 'x-powered-by: next.js', 'high'], ['j', '__next_f', 'medium'], ['j', 'next/dist/', 'medium']),
  R('Remix', 'Framework', ['m', '__remixContext', 'high'], ['j', '__remixContext', 'high']),
  R('Vue', 'Framework', ['j', '__vue_app__', 'high'], ['j', '__VUE_DEVTOOLS_GLOBAL_HOOK__', 'high'], ['j', '__VUE__', 'medium'], ['m', /data-v-[0-9a-f]{6,8}/, 'high'], ['j', 'vue.runtime', 'medium']),
  R('Nuxt', 'Framework', ['m', '__NUXT__', 'high'], ['u', '/_nuxt/', 'high'], ['j', '__NUXT__', 'high']),
  R('Angular', 'Framework', ['m', 'ng-version=', 'high'], ['j', 'ɵɵdefineComponent', 'high'], ['j', '@angular/core', 'high'], ['m', 'ng-app', 'medium']),
  R('Svelte', 'Framework', ['m', /class="svelte-[a-z0-9]+/, 'high'], ['j', 'SvelteComponent', 'high'], ['j', 'svelte/internal', 'high']),
  R('SvelteKit', 'Framework', ['m', '__sveltekit', 'high'], ['u', '/_app/immutable/', 'high']),
  R('Solid', 'Framework', ['j', '_$delegateEvents', 'high'], ['j', 'solid-js', 'high']),
  R('Astro', 'Framework', ['m', 'astro-island', 'high'], ['m', 'data-astro-cid', 'high'], ['u', '/_astro/', 'high']),
  R('Gatsby', 'Framework', ['m', '___gatsby', 'high'], ['j', 'gatsby-', 'low']),
  R('Ember', 'Framework', ['j', 'Ember.', 'medium'], ['m', 'ember-application', 'high'], ['j', 'ember-cli', 'medium']),
  R('Preact', 'Framework', ['j', '__PREACT_DEVTOOLS__', 'high'], ['j', 'preact', 'low']),
  R('Qwik', 'Framework', ['m', 'q:container', 'high']),
  R('htmx', 'Framework', ['m', /\bhx-(?:get|post|swap|trigger|target)=/, 'high'], ['u', 'htmx', 'medium']),
  R('Alpine.js', 'Framework', ['m', /\sx-data=/, 'high'], ['j', 'Alpine.start', 'high']),
  R('jQuery', 'Library', ['j', 'jQuery.fn.jquery', 'high'], ['u', 'jquery', 'medium'], ['j', 'jquery.fn', 'medium']),
  R('Backbone.js', 'Library', ['j', 'Backbone.', 'medium']),
  R('Redux', 'State', ['j', '__REDUX_DEVTOOLS_EXTENSION__', 'high'], ['j', 'redux-toolkit', 'medium']),
  R('MobX', 'State', ['j', 'mobx', 'low'], ['j', '$mobx', 'high']),
  // ---- bundlers / build ----
  R('webpack', 'Bundler', ['j', '__webpack_require__', 'high'], ['j', 'webpackChunk', 'high'], ['j', 'webpackJsonp', 'high']),
  R('Vite', 'Bundler', ['j', '__vite__', 'high'], ['j', 'import.meta.env', 'medium'], ['j', '__vitePreload', 'high'], ['u', /\/assets\/[\w-]+-[A-Za-z0-9_-]{8}\.js/, 'medium']),
  R('Parcel', 'Bundler', ['j', 'parcelRequire', 'high']),
  R('Turbopack', 'Bundler', ['j', 'TURBOPACK', 'high'], ['j', '[turbopack]', 'high']),
  R('Rspack', 'Bundler', ['j', 'rspack', 'medium']),
  R('esbuild', 'Bundler', ['j', '__commonJS', 'low'], ['j', '__toESM', 'low']),
  R('Browserify', 'Bundler', ['j', 'browserify', 'low']),
  // ---- UI kits ----
  R('Tailwind CSS', 'UI kit', ['j', 'tailwindcss', 'high'], ['m', /\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|blue|green|indigo|violet|emerald|sky)-\d{2,3}\b/, 'medium'], ['m', /\bgrid-cols-\d+\b/, 'low']),
  R('Bootstrap', 'UI kit', ['u', 'bootstrap', 'high'], ['m', /\bbtn btn-(?:primary|secondary|outline|success|danger)/, 'medium'], ['j', 'bootstrap.Modal', 'high']),
  R('Material UI', 'UI kit', ['m', 'MuiButton-root', 'high'], ['m', /\bMui[A-Z][A-Za-z]+-root\b/, 'high'], ['j', '@mui/', 'high']),
  R('Chakra UI', 'UI kit', ['m', 'chakra-', 'medium'], ['j', '@chakra-ui', 'high']),
  R('Ant Design', 'UI kit', ['m', 'ant-btn', 'high'], ['j', 'antd', 'medium']),
  R('Radix UI', 'UI kit', ['m', 'data-radix-', 'high'], ['j', '@radix-ui', 'high']),
  R('shadcn/ui', 'UI kit', ['j', 'shadcn', 'medium'], ['m', 'data-slot=', 'low']),
  R('Bulma', 'UI kit', ['u', 'bulma', 'high']),
  R('Font Awesome', 'UI kit', ['u', 'fontawesome', 'high'], ['m', /class="fa[srb]? fa-/, 'high']),
  // ---- hosting / backend / CMS ----
  R('Vercel', 'Hosting', ['h', 'server: vercel', 'high'], ['h', 'x-vercel-id', 'high']),
  R('Netlify', 'Hosting', ['h', 'server: netlify', 'high'], ['h', 'x-nf-request-id', 'high']),
  R('Cloudflare', 'CDN', ['h', 'cf-ray', 'high'], ['h', 'server: cloudflare', 'high']),
  R('Amazon CloudFront', 'CDN', ['h', 'x-amz-cf-id', 'high'], ['h', 'cloudfront', 'medium']),
  R('Amazon S3', 'Hosting', ['h', 'server: amazons3', 'high'], ['u', '.s3.amazonaws.com', 'medium']),
  R('Fastly', 'CDN', ['h', 'x-served-by: cache-', 'medium'], ['h', 'fastly', 'medium']),
  R('GitHub Pages', 'Hosting', ['h', 'server: github.com', 'high'], ['u', '.github.io', 'medium']),
  R('Firebase', 'Backend', ['u', 'firebaseapp.com', 'high'], ['u', 'firebaseio.com', 'high'], ['u', 'firebasestorage', 'high'], ['j', 'firebase', 'low']),
  R('Supabase', 'Backend', ['u', 'supabase.co', 'high'], ['j', 'supabase', 'low']),
  R('Heroku', 'Hosting', ['h', 'via: 1.1 vegur', 'high'], ['u', 'herokuapp.com', 'high']),
  R('Express', 'Backend', ['h', 'x-powered-by: express', 'high']),
  R('PHP', 'Backend', ['h', 'x-powered-by: php', 'high'], ['c', 'phpsessid', 'high']),
  R('ASP.NET', 'Backend', ['h', 'x-powered-by: asp.net', 'high'], ['h', 'x-aspnet-version', 'high'], ['c', 'asp.net_sessionid', 'high']),
  R('Ruby on Rails', 'Backend', ['m', 'csrf-param', 'medium'], ['h', 'x-runtime', 'low'], ['m', 'authenticity_token', 'medium']),
  R('Laravel', 'Backend', ['c', 'laravel_session', 'high'], ['c', 'xsrf-token', 'low']),
  R('Django', 'Backend', ['c', 'csrftoken', 'medium'], ['m', 'csrfmiddlewaretoken', 'high']),
  R('WordPress', 'CMS', ['m', 'wp-content', 'high'], ['m', 'wp-includes', 'high'], ['u', '/wp-content/', 'high'], ['h', 'wp-json', 'high']),
  R('Drupal', 'CMS', ['m', 'Drupal.settings', 'high'], ['h', 'x-generator: drupal', 'high'], ['m', 'sites/default/files', 'medium']),
  R('Shopify', 'CMS', ['u', 'cdn.shopify.com', 'high'], ['m', 'Shopify.theme', 'high'], ['h', 'x-shopid', 'high']),
  R('Wix', 'CMS', ['u', 'static.parastorage.com', 'high'], ['m', 'wix.com', 'medium']),
  R('Squarespace', 'CMS', ['m', 'squarespace', 'medium'], ['u', 'squarespace', 'medium']),
  R('Webflow', 'CMS', ['m', 'data-wf-page', 'high'], ['m', 'webflow.com', 'medium']),
  R('nginx', 'Server', ['h', 'server: nginx', 'high']),
  R('Apache', 'Server', ['h', 'server: apache', 'high']),
  R('Microsoft IIS', 'Server', ['h', 'server: microsoft-iis', 'high']),
  // ---- data layer / realtime ----
  R('GraphQL', 'Data', ['u', '/graphql', 'high'], ['j', '__typename', 'medium'], ['j', 'graphql', 'low']),
  R('Apollo Client', 'Data', ['j', 'ApolloClient', 'high'], ['m', '__APOLLO_STATE__', 'high'], ['j', '__APOLLO_CLIENT__', 'high']),
  R('Relay', 'Data', ['j', 'relay-runtime', 'high']),
  R('tRPC', 'Data', ['j', '@trpc', 'high'], ['u', '/api/trpc', 'high']),
  R('TanStack Query', 'Data', ['j', '@tanstack/react-query', 'high'], ['j', 'react-query', 'medium']),
  R('Socket.IO', 'Realtime', ['u', '/socket.io/', 'high'], ['j', 'socket.io', 'medium']),
  R('Pusher', 'Realtime', ['u', 'js.pusher.com', 'high'], ['j', 'pusher-js', 'high']),
  R('Ably', 'Realtime', ['u', 'ably.io', 'high'], ['j', 'ably', 'low']),
  // ---- auth / payments ----
  R('Auth0', 'Auth', ['u', 'auth0.com', 'high'], ['j', 'auth0', 'low']),
  R('Clerk', 'Auth', ['j', '__clerk', 'high'], ['u', 'clerk.accounts', 'high']),
  R('Firebase Auth', 'Auth', ['j', 'identitytoolkit', 'high']),
  R('NextAuth', 'Auth', ['c', 'next-auth.session-token', 'high'], ['u', '/api/auth/session', 'high']),
  R('Stripe', 'Payments', ['u', 'js.stripe.com', 'high'], ['j', 'Stripe(', 'low'], ['j', 'api.stripe.com', 'high']),
  R('PayPal', 'Payments', ['u', 'paypal.com/sdk', 'high'], ['u', 'paypalobjects.com', 'medium']),
  R('Razorpay', 'Payments', ['u', 'checkout.razorpay.com', 'high'], ['j', 'Razorpay', 'medium']),
  // ---- analytics / monitoring ----
  R('Google Analytics', 'Analytics', ['u', 'google-analytics.com', 'high'], ['u', 'googletagmanager.com/gtag', 'high'], ['j', 'gtag(', 'medium']),
  R('Google Tag Manager', 'Analytics', ['u', 'googletagmanager.com/gtm.js', 'high'], ['m', /GTM-[A-Z0-9]{5,8}/, 'high']),
  R('Segment', 'Analytics', ['u', 'cdn.segment.com', 'high'], ['j', 'analytics.identify', 'medium']),
  R('Mixpanel', 'Analytics', ['j', 'mixpanel', 'medium'], ['u', 'mixpanel', 'high']),
  R('Amplitude', 'Analytics', ['j', 'amplitude', 'low'], ['u', 'amplitude.com', 'high']),
  R('PostHog', 'Analytics', ['j', 'posthog', 'medium'], ['u', 'posthog.com', 'high']),
  R('Hotjar', 'Analytics', ['u', 'static.hotjar.com', 'high'], ['j', 'hotjar', 'medium']),
  R('Microsoft Clarity', 'Analytics', ['u', 'clarity.ms', 'high']),
  R('Plausible', 'Analytics', ['u', 'plausible.io', 'high']),
  R('Facebook Pixel', 'Analytics', ['j', 'fbq(', 'high'], ['u', 'connect.facebook.net', 'high']),
  R('Sentry', 'Monitoring', ['j', 'Sentry.init', 'high'], ['j', '@sentry/', 'high'], ['u', 'sentry.io', 'high']),
  R('Datadog', 'Monitoring', ['j', 'DD_RUM', 'high'], ['u', 'datadoghq', 'high']),
  R('LogRocket', 'Monitoring', ['j', 'LogRocket', 'high'], ['u', 'logrocket', 'high']),
  // ---- maps / media / graphics ----
  R('Mapbox', 'Maps', ['j', 'mapboxgl', 'high'], ['u', 'api.mapbox.com', 'high']),
  R('Google Maps', 'Maps', ['u', 'maps.googleapis.com', 'high'], ['j', 'google.maps.', 'high']),
  R('Leaflet', 'Maps', ['j', 'leaflet', 'low'], ['m', 'leaflet-container', 'high']),
  R('Three.js', 'Graphics', ['j', 'WebGLRenderer', 'medium'], ['j', 'THREE.', 'medium'], ['j', 'three.module', 'high']),
  R('D3', 'Graphics', ['j', 'd3-selection', 'high'], ['j', 'd3.select', 'high']),
  R('Chart.js', 'Graphics', ['j', 'Chart.js', 'high'], ['u', 'chart.js', 'high']),
  R('Lottie', 'Graphics', ['j', 'bodymovin', 'high'], ['u', 'lottie', 'medium']),
  R('GSAP', 'Graphics', ['j', 'GreenSock', 'high'], ['u', 'gsap', 'medium']),
  R('Framer Motion', 'Graphics', ['j', 'framer-motion', 'high']),
  R('Video.js', 'Media', ['j', 'videojs', 'high']),
  R('PixiJS', 'Graphics', ['j', 'PIXI.', 'medium']),
  // ---- AI SDKs / APIs ----
  R('OpenAI API', 'AI', ['j', 'api.openai.com', 'high'], ['u', 'api.openai.com', 'high']),
  R('Anthropic API', 'AI', ['j', 'api.anthropic.com', 'high'], ['j', 'anthropic-version', 'high']),
  R('Google Gemini API', 'AI', ['j', 'generativelanguage.googleapis.com', 'high']),
  R('Vercel AI SDK', 'AI', ['j', '@ai-sdk/', 'high']),
  R('LangChain', 'AI', ['j', 'langchain', 'medium']),
  // ---- desktop / mobile shells ----
  R('Electron', 'Desktop shell', ['j', 'require("electron")', 'high'], ['j', "require('electron')", 'high'], ['j', 'ipcRenderer', 'high'], ['j', 'ipcMain', 'high'], ['j', 'contextBridge', 'high'], ['h', 'electron/', 'medium']),
  R('Tauri', 'Desktop shell', ['j', '__TAURI__', 'high'], ['j', '@tauri-apps', 'high'], ['j', 'tauri://', 'high']),
  R('Capacitor', 'Mobile shell', ['j', 'Capacitor.', 'medium'], ['j', '@capacitor/', 'high'], ['j', 'capacitor://', 'high']),
  R('Cordova', 'Mobile shell', ['j', 'cordova.exec', 'high'], ['u', 'cordova.js', 'high'], ['j', 'deviceready', 'medium']),
  R('React Native', 'Mobile shell', ['j', 'AppRegistry.registerComponent', 'high'], ['u', 'index.android.bundle', 'high'], ['j', 'react-native', 'medium']),
  R('Ionic', 'Mobile shell', ['m', '<ion-', 'high'], ['j', '@ionic/', 'high']),
  R('Flutter (web)', 'Mobile shell', ['u', 'flutter.js', 'high'], ['u', 'flutter_service_worker', 'high'], ['j', 'canvaskit', 'medium']),
  R('Expo', 'Mobile shell', ['j', 'expo-', 'low'], ['j', 'ExpoModulesCore', 'high']),
  R('Blazor', 'Framework', ['u', '_framework/blazor', 'high']),
  R('Unity WebGL', 'Game engine', ['j', 'createUnityInstance', 'high'], ['j', 'UnityLoader', 'high']),
  R('Emscripten (WebAssembly)', 'Toolchain', ['j', 'Emscripten', 'high'], ['j', 'emscripten_', 'medium']),
  R('wasm-bindgen (Rust)', 'Toolchain', ['j', 'wasm_bindgen', 'high'], ['j', '__wbindgen', 'high']),
  R('Service worker / PWA', 'Platform', ['j', 'serviceWorker.register', 'high'], ['m', 'rel="manifest"', 'medium'], ['j', 'workbox', 'medium']),
];

const CONF_RANK: Record<Conf, number> = { high: 3, medium: 2, low: 1 };
const MAX_SCRIPT = 3 * 1024 * 1024;
const MAX_TOTAL_JS = 12 * 1024 * 1024;

function snippet(s: string, idx: number, len: number): string {
  const from = Math.max(0, idx - 8);
  return s.slice(from, Math.min(s.length, idx + len + 24)).replace(/\s+/g, ' ').trim().slice(0, 70);
}

export function detectTech(input: TechInput): TechHit[] {
  const urlText = (input.urls ?? []).join('\n').toLowerCase();
  const hdrText = Object.entries(input.headers ?? {})
    .map(([k, v]) => `${k.toLowerCase()}: ${String(v).toLowerCase()}`)
    .join('\n');
  const cookieText = (input.cookies ?? []).join('\n').toLowerCase();
  const html = (input.html ?? '').slice(0, 4 * 1024 * 1024);
  let total = 0;
  const js: string[] = [];
  for (const s of input.scripts ?? []) {
    if (total >= MAX_TOTAL_JS) break;
    const part = s.length > MAX_SCRIPT ? s.slice(0, MAX_SCRIPT) : s;
    js.push(part);
    total += part.length;
  }
  const hay: Record<Where, string[]> = { u: [urlText], h: [hdrText], m: [html], j: js, c: [cookieText] };

  const hits: TechHit[] = [];
  for (const rule of RULES) {
    let best: TechHit | null = null;
    for (const [where, pat, conf = 'medium'] of rule.tests) {
      if (best && CONF_RANK[best.confidence] >= CONF_RANK[conf]) continue;
      for (const h of hay[where]) {
        if (!h) continue;
        let idx = -1;
        let len = 0;
        if (typeof pat === 'string') {
          const needle = where === 'm' || where === 'j' ? pat : pat.toLowerCase();
          idx = h.indexOf(needle);
          len = needle.length;
        } else {
          pat.lastIndex = 0;
          const m = pat.exec(h);
          if (m) {
            idx = m.index;
            len = m[0].length;
          }
        }
        if (idx >= 0) {
          const label = where === 'u' ? 'URL' : where === 'h' ? 'response header' : where === 'm' ? 'HTML' : where === 'c' ? 'cookie' : 'JavaScript';
          best = { name: rule.name, category: rule.cat, confidence: conf, evidence: `${label}: ${snippet(h, idx, len)}` };
          break;
        }
      }
    }
    if (best) hits.push(best);
  }
  // Server/CDN hints that are weaker than a framework should sort after frameworks of the same confidence.
  return hits.sort((a, b) => CONF_RANK[b.confidence] - CONF_RANK[a.confidence] || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export const TECH_RULE_COUNT = RULES.length;
