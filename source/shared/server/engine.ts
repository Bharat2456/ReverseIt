/**
 * Optional bridge from the localhost edition (V2) to REA (morluto/rea, MIT), which ships unmodified under engine/rea/.
 * REA is run as a separate process (`node engine/rea/scripts/rea.mjs <command> <path> --json`), never imported.
 * Everything REA prints is treated as untrusted data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Evidence, Section } from '../core/types';
import { makeEvidence } from '../core/evidence';
import { sniffFormat } from '../core/sniff';
import { sha256Hex } from '../core/hash';
import { HttpError, sendJson, startStream, writeLine } from './http';

const MAX_UPLOAD = 1024 * 1024 * 1024;
const MAX_STDOUT = 48 * 1024 * 1024;
const CMD_TIMEOUT_MS = 10 * 60 * 1000;

export interface EngineStatus {
  installed: boolean;
  built: boolean;
  version: string | null;
  nodeVersion: string;
  nodeOk: boolean;
  dir: string;
  hint: string;
}

function nodeOk(): boolean {
  const [maj, min] = process.versions.node.split('.').map(Number);
  return (maj === 22 && min >= 19) || (maj === 24 && min >= 11) || maj >= 26;
}

export function engineStatus(engineDir: string): EngineStatus {
  const pkg = path.join(engineDir, 'package.json');
  const installed = fs.existsSync(pkg);
  let version: string | null = null;
  try { version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? null; } catch { /* ignore */ }
  const built = fs.existsSync(path.join(engineDir, 'dist', 'cli-runtime', 'cli.js'));
  const ok = nodeOk();
  let hint = 'Ready.';
  if (!installed) hint = 'The REA source folder is missing from engine/rea.';
  else if (!ok) hint = `REA needs Node.js 22.19+ (or 24.11+). You have ${process.versions.node}.`;
  else if (!built) hint = 'Run the setup script once (setup-engine.sh or setup-engine.bat). It installs and builds REA and needs internet access.';
  return { installed, built, version, nodeVersion: process.versions.node, nodeOk: ok, dir: engineDir, hint };
}

/** Which REA commands are safe and useful for a file, chosen from its magic bytes / name. */
export function planCommands(name: string, head: Uint8Array, deep: boolean): string[] {
  const fmt = sniffFormat(name, head).format;
  const lower = name.toLowerCase();
  const cmds: string[] = [];
  if (fmt === 'sqlite') cmds.push('inspect-sqlite-database');
  else if (fmt === 'asar') cmds.push('analyze-javascript-application');
  else if (fmt === 'pe') cmds.push('inspect-managed-artifact', 'inspect-go-binary', 'inspect-rust-binary');
  else if (fmt === 'elf' || fmt === 'macho') cmds.push('inspect-go-binary', 'inspect-rust-binary');
  else if (lower.endsWith('.pck')) cmds.push('inspect-artifact');
  else if (lower.endsWith('global-metadata.dat')) cmds.push('inspect-il2cpp-metadata');
  if (deep && ['pe', 'elf', 'macho'].includes(fmt)) cmds.push('analyze');
  return cmds;
}

function runRea(engineDir: string, args: string[], signal: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(engineDir, 'scripts', 'rea.mjs'), ...args], { cwd: engineDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '', stderr = '', truncated = false, timedOut = false;
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* ignore */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, CMD_TIMEOUT_MS);
    signal.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (c: Buffer) => { if (stdout.length < MAX_STDOUT) stdout += c.toString('utf8'); else if (!truncated) { truncated = true; kill(); } });
    child.stderr.on('data', (c: Buffer) => { if (stderr.length < 32768) stderr += c.toString('utf8'); });
    child.on('error', (e) => { stderr += String(e.message); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, truncated, timedOut }); });
  });
}

function scalarRows(o: Record<string, unknown>): { k: string; v: string | number | boolean | null }[] {
  return Object.entries(o).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 40).map(([k, v]) => ({ k, v: typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : (v as any) }));
}

export function reaOutputToEvidence(cmd: string, version: string | null, target: Evidence['target'], r: { code: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }): Evidence {
  let parsed: any;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
  const notes: string[] = [];
  if (r.truncated) notes.push('REA printed more than the 48 MB ReverseIt keeps, so the output was cut.');
  if (r.timedOut) notes.push('REA did not finish within 10 minutes and was stopped.');
  if (r.code !== 0 && !r.truncated) notes.push(`REA exited with code ${r.code}.`);
  const sections: Section[] = [];
  const ok = parsed !== undefined && r.code === 0;
  let summary = ok ? `REA ${cmd} finished.` : `REA ${cmd} did not produce a complete result.`;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rows = scalarRows(parsed);
    if (rows.length) sections.push({ kind: 'kv', title: 'REA result (top-level values)', rows });
    const counts = Object.entries(parsed).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length] as (string | number)[]);
    if (counts.length) sections.push({ kind: 'table', title: 'Lists in the result', columns: ['Field', 'Items'], rows: counts.slice(0, 60) });
    if (typeof parsed.summary === 'string') summary = `REA ${cmd}: ${parsed.summary.slice(0, 240)}`;
  }
  const pretty = parsed !== undefined ? JSON.stringify(parsed, null, 2) : r.stdout;
  sections.push({ kind: 'text', title: 'Raw REA output (first 30,000 characters)', text: pretty.slice(0, 30000), mono: true });
  if (r.stderr.trim()) sections.push({ kind: 'text', title: 'REA messages', text: r.stderr.trim().slice(0, 4000), mono: true });
  const reaLimits = parsed && Array.isArray(parsed.limitations) ? parsed.limitations.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
  const small = pretty.length <= 120000;
  return makeEvidence({
    operation: `rea:${cmd}`,
    title: `REA engine · ${cmd}`,
    target,
    summary,
    normalized_result: { command: cmd, exit_code: r.code, output_json: small && parsed !== undefined ? parsed : undefined, output_chars: pretty.length, output_keys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 60) : undefined },
    sections,
    findings: [],
    coverage: { status: ok && !r.truncated ? 'partial' : 'unknown', notes },
    limitations: [...reaLimits, ...notes, 'Produced by the REA engine and shown as received: ReverseIt has not independently verified it.'],
    analyzer: `rea-engine@${version ?? 'unknown'}`,
    provenance: 'rea-engine',
  });
}

export function makeEngineRoutes(engineDir: string) {
  return async (req: IncomingMessage, res: ServerResponse, p: string): Promise<boolean> => {
    if (p === '/api/engine/status' && req.method === 'GET') { sendJson(res, 200, engineStatus(engineDir)); return true; }
    if (p !== '/api/engine/run') return false;
    if (req.method !== 'POST') throw new HttpError(405, { code: 'bad_request', message: 'Use POST.' });
    const st = engineStatus(engineDir);
    if (!st.installed || !st.built || !st.nodeOk) throw new HttpError(409, { code: 'unsupported', message: st.hint });
    const u = new URL(req.url ?? '', 'http://x');
    const name = path.basename(u.searchParams.get('name') ?? 'target.bin').replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'target.bin';
    const deep = u.searchParams.get('deep') === '1';
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD) throw new HttpError(413, { code: 'bad_request', message: 'File is larger than the 1 GB engine limit.' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverseit-'));
    const file = path.join(dir, name);
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    try {
      let n = 0;
      const out = fs.createWriteStream(file);
      await new Promise<void>((resolve, reject) => {
        req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_UPLOAD) { req.destroy(); reject(new Error('too large')); } });
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        req.pipe(out);
      });
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(Math.min(n, 65536));
      fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      const cmds = planCommands(name, new Uint8Array(head), deep);
      startStream(res, 'ndjson');
      if (!cmds.length) { writeLine(res, { type: 'result', evidence: [] , note: 'No REA command applies to this kind of file.' }); res.end(); return true; }
      const hashHead = n <= 256 * 1024 * 1024 ? await sha256Hex(new Uint8Array(fs.readFileSync(file))) : undefined;
      const target = { name, kind: 'file' as const, size: n, ...(hashHead ? { sha256: hashHead } : {}), format: sniffFormat(name, new Uint8Array(head)).format };
      const evidence: Evidence[] = [];
      for (let i = 0; i < cmds.length; i++) {
        writeLine(res, { type: 'progress', phase: 'engine', pct: Math.round((i / cmds.length) * 100), message: `REA ${cmds[i]}` });
        const r = await runRea(engineDir, [cmds[i], file, '--json'], ac.signal);
        evidence.push(reaOutputToEvidence(cmds[i], st.version, target, r));
        if (ac.signal.aborted) break;
      }
      writeLine(res, { type: 'result', evidence });
      res.end();
    } catch (e: any) {
      if (!res.headersSent) throw new HttpError(500, { code: 'internal', message: 'The engine upload failed: ' + String(e?.message ?? e).slice(0, 160) });
      writeLine(res, { type: 'error', error: { code: 'internal', message: String(e?.message ?? e).slice(0, 200) } });
      res.end();
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return true;
  };
}
