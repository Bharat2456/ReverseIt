import type { AnalysisPart, ByteCtx, Evidence } from './types';
import { makeEvidence } from './evidence';
import { finding, text } from './sections';

/** Run an analyzer body; if it throws, return a partial evidence record instead of failing the whole analysis. */
export async function safeAnalyze(
  operation: string,
  title: string,
  ctx: ByteCtx,
  body: () => Promise<AnalysisPart>,
): Promise<AnalysisPart> {
  try {
    return await body();
  } catch (e: any) {
    if (e?.name === 'AbortedError') throw e;
    const msg = String(e?.message ?? e);
    const ev: Evidence = makeEvidence({
      operation,
      title,
      target: ctx.target,
      summary: `ReverseIt could only partly read this file (${msg}).`,
      normalized_result: { error: msg },
      sections: [text('Parse problem', `The parser stopped early: ${msg}`)],
      findings: [finding('File is malformed, truncated or uses an unsupported variant', 'notice', msg)],
      coverage: { status: 'partial', notes: [msg] },
      limitations: ['Parsing stopped early. Everything listed elsewhere for this file is incomplete.'],
    });
    return { evidence: [ev] };
  }
}

export function hexs(n: number | bigint): string {
  return '0x' + n.toString(16);
}

export function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function topN(m: Map<string, number>, n: number): { label: string; value: number }[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

/** Coarse capability categories inferred from imported function names. */
const CAPS: [string, RegExp][] = [
  ['Network access', /^(socket|connect|bind|listen|accept|send|recv|sendto|recvfrom|getaddrinfo|gethostbyname|curl_|WSA|InternetOpen|InternetConnect|HttpSendRequest|WinHttp|URLDownload|nw_connection|CFSocket|NSURLSession)/i],
  ['Cryptography', /^(EVP_|SSL_|TLS_|RSA_|AES_|SHA\d*_|MD5|CryptAcquire|CryptEncrypt|CryptDecrypt|BCrypt|CCCrypt|SecKey|gcry_|mbedtls_|wolfSSL)/i],
  ['Starts other programs', /^(execve|execv|execvp|execl|execlp|system|popen|fork|vfork|posix_spawn|CreateProcess|ShellExecute|WinExec|NSTask)/i],
  ['Loads code at runtime', /^(dlopen|dlsym|LoadLibrary|GetProcAddress|LdrLoadDll|NSAddImage)/i],
  ['Memory permissions', /^(mprotect|VirtualAlloc|VirtualProtect|mmap|NtProtectVirtualMemory|WriteProcessMemory|ReadProcessMemory|CreateRemoteThread)/i],
  ['Debugger checks', /^(ptrace|IsDebuggerPresent|CheckRemoteDebuggerPresent|NtQueryInformationProcess|OutputDebugString|sysctl)$/i],
  ['File system', /^(open|openat|fopen|read|write|unlink|rename|mkdir|rmdir|opendir|stat|CreateFile|DeleteFile|FindFirstFile|MoveFile|NSFileManager)/i],
  ['Registry / settings', /^(Reg(Open|Create|Set|Query|Delete)|NSUserDefaults|CFPreferences)/i],
  ['Windows & UI', /^(CreateWindow|GetMessage|DispatchMessage|MessageBox|gtk_|Qt|NSWindow|NSApplication|SDL_|glfw)/i],
  ['Hooks & input', /^(SetWindowsHookEx|GetAsyncKeyState|GetKeyState|keybd_event|SendInput|CGEventTap|XGrabKey)/i],
  ['Threads & sync', /^(pthread_|CreateThread|WaitForSingleObject|dispatch_)/i],
];

export function classifyApi(name: string): string | undefined {
  const n = name.replace(/^_+/, '');
  for (const [cat, re] of CAPS) if (re.test(n)) return cat;
  return undefined;
}

export function capabilitySummary(names: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const n of names) {
    const c = classifyApi(n);
    if (c) {
      const arr = m.get(c) ?? [];
      if (arr.length < 12) arr.push(n);
      m.set(c, arr);
    }
  }
  return m;
}

/** Stable id of the root graph node for a target. All analyzers attach their nodes to it. */
export function rootId(ctx: { target: { name: string } }): string {
  return `target:${ctx.target.name}`;
}

/** Strip control chars and cap length of text that came from the target before it goes into evidence. */
export function clean(s: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export function isoTime(secs: number): string | null {
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const d = new Date(secs * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
