import { createZip } from '../../core/zip';
import { analyzeBytes } from '../../core/analyze';
import { newId, type Investigation } from './db';

const PKG = `{"name":"nimbus-notes","version":"2.4.1","main":"main.js","description":"Sample note-taking desktop app (demo data)","dependencies":{"electron":"^30.0.0","react":"^18.2.0","axios":"^1.6.0","better-sqlite3":"^9.4.0"}}`;
const MAIN = `const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const { autoUpdater } = require('electron-updater');
let win;
function create() {
  win = new BrowserWindow({ width: 1100, height: 760, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile('index.html');
}
const db = new Database(path.join(app.getPath('userData'), 'notes.db'));
ipcMain.handle('notes:list', () => db.prepare('SELECT * FROM notes ORDER BY updated DESC').all());
ipcMain.handle('notes:save', (e, note) => db.prepare('INSERT OR REPLACE INTO notes VALUES (?,?,?,?)').run(note.id, note.title, note.body, Date.now()));
ipcMain.on('open-link', (e, url) => shell.openExternal(url));
app.whenReady().then(() => { create(); autoUpdater.checkForUpdatesAndNotify(); });
`;
const PRELOAD = `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notesApi', {
  list: () => ipcRenderer.invoke('notes:list'),
  save: (n) => ipcRenderer.invoke('notes:save', n),
  open: (u) => ipcRenderer.send('open-link', u),
});`;
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Nimbus Notes</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>`;
const CSS = `:root{--bg:#0f1420;--accent:#7c5cff;--text:#e8ecf4;--radius:12px}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}
.sidebar{width:260px;background:#151c2c;padding:16px}.card{background:#1a2338;border-radius:var(--radius);padding:16px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.btn{background:var(--accent);color:#fff;border-radius:8px;padding:8px 14px}@media (max-width:720px){.sidebar{display:none}}`;
const APP = `import React from 'react';
const API = 'https://api.nimbus-notes.example/v1';
async function sync(token) {
  const r = await fetch(API + '/notes/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  return r.json();
}
export function App() {
  const [notes, setNotes] = React.useState([]);
  React.useEffect(() => { window.notesApi.list().then(setNotes); }, []);
  return <div className="sidebar">{notes.map((n) => <div key={n.id}>{n.title}</div>)}</div>;
}
localStorage.setItem('nimbus.theme', 'dark');
fetch('https://analytics.example-metrics.com/collect', { method: 'POST' });`;

const BLUEPRINT = `# What this is
**Nimbus Notes** is a desktop note-taking app (demo data). It runs as an Electron program: a small web page shown inside its own window, with a local database for storing notes on your computer.

## How it is built
- **Shell:** Electron 30 — the "main" process (\`main.js\`) owns the window and the database; the page (\`index.html\` + \`app.js\`) is the screen you see.
- **Screens:** written with React.
- **Storage:** a local SQLite file called \`notes.db\` (via better-sqlite3) in the user's app-data folder.
- **Bridge:** the page cannot touch the database directly. A small preload script exposes three safe calls (\`list\`, \`save\`, \`open\`) which the main process answers.

## What it does
1. The window opens and the page asks the main process for the list of notes (\`notes:list\`).
2. Saving a note sends it through \`notes:save\`, which writes a row with the current time.
3. Clicking a link asks the main process to open it in the real browser (\`open-link\`).
4. The app checks for updates on start-up and can sync notes to a cloud service at \`api.nimbus-notes.example/v1\` using a bearer token.

## Data and contracts
| Channel / endpoint | Direction | Purpose |
|---|---|---|
| \`notes:list\` | page → main | return all notes, newest first |
| \`notes:save\` | page → main | insert or replace one note |
| \`open-link\` | page → main | open a link externally |
| \`POST /v1/notes/sync\` | app → cloud | sync notes (needs a token) |

## Look and feel
Dark navy background (#0f1420), violet accent (#7c5cff), rounded 12px cards with soft shadows, Inter font, sidebar hidden below 720px.

## Risks and surprises
- Good: window isolation and sandbox are ON, Node access in the page is OFF.
- **Notice:** every start-up the app sends a request to an analytics host (\`analytics.example-metrics.com\`). Worth knowing for privacy.
- The bearer token for sync is stored in the page; make sure it is kept out of logs.

## What we could not see
Server behaviour behind \`/notes/sync\`, the real database columns beyond what the SQL hints, and anything that happens only after sign-in.

## How to rebuild it
1. Create an Electron app with one window and a preload bridge exposing \`list/save/open\`.
2. Add a SQLite table \`notes(id, title, body, updated)\`.
3. Build the sidebar list and editor in React using the colours above.
4. Add an optional sync module behind a setting, off by default.
`;

export async function makeDemoInvestigation(): Promise<Investigation> {
  const files = [
    { path: 'package.json', data: PKG }, { path: 'main.js', data: MAIN }, { path: 'preload.js', data: PRELOAD },
    { path: 'index.html', data: HTML }, { path: 'styles.css', data: CSS }, { path: 'app.js', data: APP },
  ];
  const bytes = await createZip(files);
  const result = await analyzeBytes({ name: 'nimbus-notes-demo.zip', bytes });
  return { id: newId(), createdAt: Date.now(), title: 'Nimbus Notes (demo)', kind: 'demo', demo: true, result, blueprint: BLUEPRINT };
}
