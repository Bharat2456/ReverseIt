import { Link } from '../lib/router';
import { appPath } from '../lib/paths';
import { platform } from '../lib/platform';
import { KNOWN_PROVIDERS } from '../../ai/providers';
import { PublicLayout } from './Public';

const TOC: [string, string][] = [['what', 'What ReverseIt is'], ['start', 'Quick start'], ['inputs', 'What you can analyse'], ['results', 'Reading the results'], ['ai', 'AI and your API key'], ['lab', 'Blueprint & Build Lab'], ['privacy', 'Privacy & security'], ['limits', 'Honest limits'], ['run', 'Running & deploying'], ['legal', 'Responsible use'], ['faq', 'FAQ'], ['credits', 'Credits & licence']];

export function DocsBody() {
  const p = platform();
  const needsKey = p.aiMode === 'providers';
  const base = (r: string) => (p.hasLanding ? appPath(r) : appPath(r));
  const cloud = KNOWN_PROVIDERS.filter((k) => !k.local && !k.id.startsWith('custom'));
  return (
    <div className="docs">
      <nav aria-label="Documentation sections">{TOC.map(([id, t]) => <a key={id} href={'#doc-' + id} onClick={(e: any) => { e.preventDefault(); document.getElementById('doc-' + id)?.scrollIntoView({ behavior: 'smooth' }); }}>{t}</a>)}</nav>
      <div>
        <section id="doc-what"><h2>What ReverseIt is</h2>
          <p>ReverseIt helps you <strong>understand how an app, website or program is built</strong>, then rebuild your own original version. You do not need to be technical: you point it at something, it reads everything it legally can, draws a map of how the parts connect, and an AI model turns that evidence into a plain-language Blueprint and a runnable clone starter.</p>
          <p>{p.version === 'v3' ? '' : <>It is built on the open-source <strong>REA</strong> reverse-engineering evidence model (MIT). </>}Every result is <em>evidence</em>: what was seen, how complete the check was, and — just as important — what could <em>not</em> be seen.</p>
        </section>
        <section id="doc-start"><h2>Quick start</h2>
          <ol>
            {needsKey && <li><strong>Connect an AI key</strong> on the <Link to={base('/connect')}>AI Connect</Link> page. Analysis works without one, but the Blueprint and Build Lab need it.</li>}
            <li>Open <Link to={base('/new')}>New investigation</Link>, choose a {p.canFetchSites ? 'website, ' : ''}file, pasted code or a network capture.</li>
            <li>Tick the permission box and press <strong>Start investigation</strong>. Small targets finish in seconds.</li>
            <li>Read the <strong>Overview</strong>, explore the <strong>Architecture</strong> map, then generate the <strong>Blueprint</strong> or open the <strong>Build Lab</strong>.</li>
            <li>Download the zip. It is your own, original starting project.</li>
          </ol>
          <p>No target at hand? Press <strong>Try the demo</strong> on the command centre to see a finished investigation.</p>
        </section>
        <section id="doc-inputs"><h2>What you can analyse</h2>
          <div className="tablewrap"><table><thead><tr><th>Source</th><th>What ReverseIt reads</th></tr></thead><tbody>
            {p.canFetchSites && <tr><td>Website</td><td>HTML, scripts, styles, headers, source maps, manifest, robots/sitemap → technologies, API endpoints, routes, design tokens, third parties, security headers</td></tr>}
            <tr><td>Windows .exe/.dll (PE)</td><td>Layout, imports, exports, signing, resources, strings, .NET names</td></tr>
            <tr><td>Linux (ELF), macOS (Mach-O)</td><td>Segments, libraries, symbols, signing/encryption flags, strings</td></tr>
            <tr><td>Android .apk, Java .jar, .zip</td><td>Manifest, permissions, components, classes, domains, bundled scripts</td></tr>
            <tr><td>Electron .asar</td><td>Package facts, main/preload/renderer code, IPC channels, security settings</td></tr>
            <tr><td>WebAssembly, .NET, SQLite</td><td>Imports/exports, type names and strings, database schema (never the rows)</td></tr>
            <tr><td>JS / HTML / CSS / JSON / source maps</td><td>Endpoints, routes, libraries, design tokens, original source files</td></tr>
            <tr><td>HAR network capture</td><td>Every API call, hosts, data shapes, credentials seen (values are never stored)</td></tr>
          </tbody></table></div>
        </section>
        <section id="doc-results"><h2>Reading the results</h2>
          <ul>
            <li><strong>Overview</strong> — coverage gauge, findings, technologies and what is still unknown.</li>
            <li><strong>Architecture</strong> — a map of the parts and what they connect to. Click a box to highlight its links.</li>
            <li><strong>Evidence</strong> — the detailed records. Each states its coverage and its limitations.</li>
            <li><strong>Files</strong> — files recovered from archives and source maps. Download them all as a zip.</li>
            <li><strong>Blueprint</strong> and <strong>Build Lab</strong> — AI-written output grounded in the evidence.</li>
            <li><strong>Export</strong> — JSON, report, recovered files, or a ready prompt for any AI.</li>
          </ul>
          <p><strong>Coverage</strong> is an honest score of how completely the checks could read the target. “Partial” is normal and not an error.</p>
        </section>
        <section id="doc-ai"><h2>AI and your API key</h2>
          {needsKey ? <div className="notice">An AI API key is <strong>required</strong> for the Blueprint and Build Lab. Everything else works without one. ReverseIt does not provide AI itself, so you bring your own key and pay your provider directly (many have free tiers).</div> : <div className="notice info">This edition uses the built-in AI of the chat it runs in, so no key is needed. The self-hosted editions (localhost and the deployable site) need your own API key.</div>}
          <h3>Any provider works</h3>
          <p>Paste a key and press <strong>Detect &amp; verify</strong>. ReverseIt recognises key formats, checks the matching provider by listing its models, and lets you pick one. If your provider is unknown or self-hosted, choose “not on the list”, enter its base URL and the format it speaks (OpenAI-style, Anthropic-style or Gemini-style).</p>
          <div>{cloud.map((k) => <span className="tag" key={k.id}>{k.label}</span>)}{p.version !== 'v3' && <span className="tag orange">Ollama / LM Studio (localhost edition)</span>}</div>
          <h3>Where to get a key</h3>
          <ul>{cloud.slice(0, 8).map((k) => <li key={k.id}>{k.label}: <a href={k.consoleUrl} target="_blank" rel="noopener noreferrer">{k.consoleUrl.replace(/^https?:\/\//, '')}</a></li>)}</ul>
          <h3>How your key is handled</h3>
          <p>It is stored only in your browser. It travels with each AI request to ReverseIt's server, which forwards it to the provider and forgets it: no database, no logging. {p.version === 'v3' ? 'For maximum control, host your own copy.' : 'For maximum control run the localhost edition on your own machine.'} Never share a key you cannot revoke, and set a spending limit with your provider.</p>
          {p.version === 'v3' ? <p>Models running on your own computer (Ollama, LM Studio) cannot be reached from a website, so use a hosted provider here.</p> : <p>Local models (Ollama, LM Studio) only work in the localhost edition, because a website on the internet cannot reach a program on your computer.</p>}
        </section>
        <section id="doc-lab"><h2>Blueprint &amp; Build Lab</h2>
          <ul>
            <li><strong>Blueprint</strong> — a plain-language report: what it is, how it is built, flows, data, risks, unknowns and a rebuild plan.</li>
            <li><strong>Product spec</strong> — features, flows and screens as a requirements document.</li>
            <li><strong>Clone starter</strong> — an <em>original</em> runnable project that reproduces look and behaviour. Choose a stack or leave it open.</li>
            <li><strong>API &amp; mock server</strong> — OpenAPI file, mock server and typed client for the endpoints observed.</li>
            <li><strong>Design system</strong> — tokens, CSS variables and a component sheet.</li>
          </ul>
          <p>The AI is told to describe behaviour and write original code, to mark guesses, and never to reproduce proprietary source, assets or branding. You stay responsible for what you build and for any licences that apply.</p>
        </section>
        <section id="doc-privacy"><h2>Privacy &amp; security</h2>
          <ul>
            <li>Files you upload are analysed <strong>in your browser</strong> and are not sent to ReverseIt's server. Only the short findings summary goes to your AI provider when you generate AI output.</li>
            <li>Investigations are saved only in your browser (IndexedDB). Delete them any time from the library.</li>
            <li>Secrets found inside a target are shown masked (first four characters). Network-capture credentials are never stored.</li>
            <li>Text inside a target is treated as untrusted data and is never run or obeyed.</li>
            {p.canFetchSites && <li>Website reading is done by the server with protections against reaching private networks, size and time limits.</li>}
          </ul>
        </section>
        <section id="doc-limits"><h2>Honest limits</h2>
          <ul>
            <li>ReverseIt reads and measures; it does <strong>not run</strong> the target. Anything built at run time is invisible.</li>
            <li>It cannot see server code, databases or anything behind a login on a website.</li>
            <li>Native programs get a structural read (layout, imports, strings). <strong>Decompiling</strong> to readable source needs a professional engine (Ghidra, IDA, Hopper, JADX). {p.version === 'v3' ? 'Run those tools on your own computer alongside ReverseIt for that depth.' : p.version === 'v2' ? 'The localhost edition can use REA with those engines if you install them.' : 'The localhost edition can use REA with those engines if you install them on your own computer.'}</li>
            <li>Minified or obfuscated code limits what can be named. Source maps, when published, restore a lot.</li>
            <li>Very large files are limited by your browser's memory.</li>
            <li>AI output may be wrong. Check it against the evidence.</li>
            <li>A clone reproduces observable behaviour and design, not the hidden internals or data of the original.</li>
          </ul>
        </section>
        <section id="doc-run"><h2>Running &amp; deploying</h2>
          {p.version === 'v3' ? (
            <>
              <p>To host your own copy of ReverseIt:</p>
              <ol><li>Fork or download the repository from GitHub.</li><li>On <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer">vercel.com/new</a> import the repository. No build settings or environment variables are needed.</li><li>Press Deploy. There is no login and no database.</li></ol>
              <p>The server functions (<code>/api/ai/*</code>, <code>/api/site/analyze</code>) are stateless proxies. Visitors bring their own API key.</p>
            </>
          ) : p.version === 'v2' ? (
            <>
              <p>The localhost edition runs entirely on your computer: Node.js 22+ is all you need. Unzip, run <code>node server.mjs</code> (or the start script) and open <code>http://localhost:4173</code>. Local AI like Ollama and LM Studio work here. Optional: install REA in <code>engine/</code> to enable deep native analysis.</p>
            </>
          ) : (
            <p>This hosted edition lives in the chat. For your own copy, use the localhost edition (zip) or deploy the web edition from GitHub to Vercel.</p>
          )}
        </section>
        <section id="doc-legal"><h2>Responsible use</h2>
          <p>Use ReverseIt to learn, to audit software you own, for interoperability and security research you are authorised to do, and to build original products. Do <strong>not</strong> use it to bypass licensing or copy protection, to cheat in games, to access systems without permission, or to copy someone's protected code, text, images or brand. Respect each site's terms and local law. ReverseIt gives no legal advice.</p>
        </section>
        <section id="doc-faq"><h2>FAQ</h2>
          <h3>Do I need technical knowledge?</h3><p>No. Every page explains why it exists, and results are written in plain language.</p>
          <h3>Is it really free?</h3><p>ReverseIt is open source and has no accounts. You only pay your AI provider for the tokens you use.</p>
          <h3>Can it clone any app exactly?</h3><p>No tool can. It reconstructs what is observable and gives you a strong, original starting point with the gaps listed.</p>
          <h3>Why can't it read my site?</h3><p>Some sites block automated visitors or need JavaScript to show content. Try saving the page or exporting a HAR capture and uploading that.</p>
        </section>
        <section id="doc-credits"><h2>Credits &amp; licence</h2>
          <p>ReverseIt is open source under the MIT licence.{p.version === 'v3' ? '' : ' It is built on the REA project by morluto (MIT, © 2026) and keeps its licence notices.'} Made by <Link to={p.hasLanding ? '/builder' : appPath('/docs')}>Bharat Wagh</Link>.</p>
        </section>
      </div>
    </div>
  );
}

export function DocsPage({ embedded }: { embedded?: boolean }) {
  if (embedded) {
    return <div><header className="pagehead"><div className="kicker">Reference</div><h1>Documentation</h1><div className="why"><b>Why this page</b><span>Everything you need to know to use ReverseIt, including why an AI API key is needed and how it is handled.</span></div></header><DocsBody /></div>;
  }
  return <PublicLayout><div className="sect"><div className="kicker">Reference</div><h1>Documentation</h1><DocsBody /></div></PublicLayout>;
}
