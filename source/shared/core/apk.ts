import type { AnalysisPart, ByteCtx, Finding, Graph } from './types';
import { makeEvidence } from './evidence';
import { finding, kv, list, table, tags, fmtBytes } from './sections';
import { Reader, decodeUtf8 } from './bytes';
import { readZip, extractZipEntry } from './zip';
import { classifyStrings } from './strings';
import { safeAnalyze, rootId, clean } from './common';
import { zipTextEntries } from './archive';

// ---------- Android binary XML ----------
interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
}

function readPool(r: Reader, at: number): string[] {
  const count = r.u32(at + 8);
  const flags = r.u32(at + 16);
  const strStart = r.u32(at + 20);
  const utf8 = (flags & 0x100) !== 0;
  const out: string[] = [];
  for (let i = 0; i < Math.min(count, 100000); i++) {
    const off = at + strStart + r.u32(at + 28 + i * 4);
    if (!r.has(off, 2)) {
      out.push('');
      continue;
    }
    if (utf8) {
      let p = off;
      let l = r.u8(p++);
      if (l & 0x80) l = ((l & 0x7f) << 8) | r.u8(p++);
      let bl = r.u8(p++);
      if (bl & 0x80) bl = ((bl & 0x7f) << 8) | r.u8(p++);
      out.push(decodeUtf8(r.slice(p, bl)));
    } else {
      let p = off;
      let l = r.u16(p);
      p += 2;
      if (l & 0x8000) {
        l = ((l & 0x7fff) << 16) | r.u16(p);
        p += 2;
      }
      const b = r.slice(p, l * 2);
      out.push(new TextDecoder('utf-16le').decode(b));
    }
  }
  return out;
}

export function decodeAxml(bytes: Uint8Array): XNode | undefined {
  const r = new Reader(bytes, true);
  if (r.u16(0) !== 0x0003) return undefined;
  let pos = r.u16(2);
  let pool: string[] = [];
  const root: XNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  while (pos + 8 <= bytes.length) {
    const type = r.u16(pos);
    const size = r.u32(pos + 4);
    if (size < 8) break;
    if (type === 0x0001) pool = readPool(r, pos);
    else if (type === 0x0102) {
      const name = pool[r.u32(pos + 20)] ?? '?';
      const attrStart = r.u16(pos + 24);
      const attrSize = r.u16(pos + 26) || 20;
      const count = r.u16(pos + 28);
      const node: XNode = { tag: name, attrs: {}, children: [] };
      for (let i = 0; i < Math.min(count, 200); i++) {
        const a = pos + 16 + attrStart + i * attrSize;
        const an = pool[r.u32(a + 4)] ?? '?';
        const raw = r.u32(a + 8);
        const dt = r.u8(a + 15);
        const data = r.u32(a + 16);
        let v: string;
        if (dt === 0x03) v = pool[raw !== 0xffffffff ? raw : data] ?? '';
        else if (dt === 0x12) v = data !== 0 ? 'true' : 'false';
        else if (dt === 0x10) v = String(data | 0);
        else if (dt === 0x11) v = '0x' + data.toString(16);
        else if (dt === 0x01) v = '@0x' + data.toString(16);
        else v = String(data);
        node.attrs[an] = v;
      }
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (type === 0x0103) {
      if (stack.length > 1) stack.pop();
    }
    pos += size;
  }
  return root.children[0];
}

const DANGEROUS = new Set(['READ_SMS', 'SEND_SMS', 'RECEIVE_SMS', 'READ_CONTACTS', 'WRITE_CONTACTS', 'READ_CALL_LOG', 'RECORD_AUDIO', 'CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_PHONE_STATE', 'CALL_PHONE', 'SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'BIND_ACCESSIBILITY_SERVICE', 'MANAGE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO']);

// ---------- DEX ----------
export interface DexInfo {
  classes: string[];
  stringCount: number;
  methodCount: number;
  fieldCount: number;
  strings: string[];
}

export function parseDex(bytes: Uint8Array, maxStrings = 60000): DexInfo | undefined {
  if (bytes.length < 112 || String.fromCharCode(...bytes.subarray(0, 3)) !== 'dex') return undefined;
  const r = new Reader(bytes, true);
  const sCount = r.u32(56), sOff = r.u32(60), tCount = r.u32(64), tOff = r.u32(68), fCount = r.u32(80), mCount = r.u32(88), cCount = r.u32(96), cOff = r.u32(100);
  const strings: string[] = [];
  const getStr = (i: number): string => {
    if (i >= sCount) return '';
    let p = r.u32(sOff + i * 4);
    // skip ULEB128 length
    while (p < bytes.length && bytes[p] & 0x80) p++;
    p++;
    let e = p;
    while (e < bytes.length && bytes[e] !== 0 && e - p < 2048) e++;
    return decodeUtf8(bytes.subarray(p, e));
  };
  for (let i = 0; i < Math.min(sCount, maxStrings); i++) strings.push(getStr(i));
  const classes: string[] = [];
  for (let i = 0; i < Math.min(cCount, 60000); i++) {
    const typeIdx = r.u32(cOff + i * 32);
    if (typeIdx >= tCount) continue;
    classes.push(getStr(r.u32(tOff + typeIdx * 4)));
  }
  return { classes, stringCount: sCount, methodCount: mCount, fieldCount: fCount, strings };
}

export async function analyzeApk(ctx: ByteCtx): Promise<AnalysisPart> {
  return safeAnalyze('inspect_apk', 'Android app package', ctx, async () => {
    const { bytes } = ctx;
    const z = readZip(bytes);
    const names = z.entries.map((e) => e.name);
    const manifestEntry = z.entries.find((e) => e.name === 'AndroidManifest.xml');
    const notes: string[] = [...z.notes];
    let m: XNode | undefined;
    if (manifestEntry) {
      const b = await extractZipEntry(bytes, manifestEntry, 8 * 1024 * 1024);
      if (b) m = decodeAxml(b);
      if (!m) notes.push('The app manifest is not in the usual binary format and could not be decoded.');
    } else notes.push('No AndroidManifest.xml found.');
    const attrs = m?.attrs ?? {};
    const sdk = m?.children.find((c) => c.tag === 'uses-sdk')?.attrs ?? {};
    const permissions = (m?.children.filter((c) => c.tag === 'uses-permission' || c.tag === 'uses-permission-sdk-23').map((c) => c.attrs.name ?? '') ?? []).filter(Boolean);
    const app = m?.children.find((c) => c.tag === 'application');
    const comps: { type: string; name: string; exported: string; actions: string[] }[] = [];
    for (const c of app?.children ?? []) {
      if (!['activity', 'activity-alias', 'service', 'receiver', 'provider'].includes(c.tag)) continue;
      const actions: string[] = [];
      for (const f of c.children) if (f.tag === 'intent-filter') for (const a of f.children) if (a.tag === 'action' && a.attrs.name) actions.push(a.attrs.name);
      comps.push({ type: c.tag, name: c.attrs.name ?? '?', exported: c.attrs.exported ?? (actions.length ? 'true (implied by intent filter)' : 'false'), actions });
    }
    const dexEntries = z.entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
    const libs = z.entries.filter((e) => /^lib\/[^/]+\/.+\.so$/.test(e.name));
    const abis = [...new Set(libs.map((l) => l.name.split('/')[1]))];
    const frameworks: string[] = [];
    if (libs.some((l) => /libflutter\.so/.test(l.name))) frameworks.push('Flutter');
    if (libs.some((l) => /libreactnativejni|libhermes/.test(l.name)) || names.some((n) => /index\.android\.bundle/.test(n))) frameworks.push('React Native');
    if (libs.some((l) => /libunity\.so|libil2cpp\.so/.test(l.name))) frameworks.push('Unity');
    if (names.some((n) => n.startsWith('assets/www/'))) frameworks.push('Cordova / Ionic (web app inside)');
    if (names.some((n) => /Xamarin|libmonodroid/.test(n)) || libs.some((l) => /libmonodroid/.test(l.name))) frameworks.push('Xamarin / .NET MAUI');
    if (names.some((n) => n.startsWith('kotlin/') || /\.kotlin_module$/.test(n))) frameworks.push('Kotlin');
    if (libs.some((l) => /libgodot/.test(l.name))) frameworks.push('Godot');
    const signed = names.some((n) => /^META-INF\/.+\.(RSA|DSA|EC)$/.test(n));
    // dex
    let classes: string[] = [];
    let dexStrings: string[] = [];
    let methods = 0;
    for (const d of dexEntries.slice(0, 6)) {
      const b = await extractZipEntry(bytes, d, 64 * 1024 * 1024);
      const info = b ? parseDex(b) : undefined;
      if (info) {
        classes = classes.concat(info.classes);
        dexStrings = dexStrings.concat(info.strings);
        methods += info.methodCount;
      }
    }
    const pkgCount = new Map<string, number>();
    for (const c of classes) {
      const p = c.replace(/^L/, '').split('/').slice(0, 3).join('.');
      pkgCount.set(p, (pkgCount.get(p) ?? 0) + 1);
    }
    const topPkgs = [...pkgCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const cs = classifyStrings(dexStrings, 150);
    const findings: Finding[] = [];
    const risky = permissions.map((p) => p.split('.').pop() ?? '').filter((p) => DANGEROUS.has(p));
    if (risky.length) findings.push(finding(`${risky.length} sensitive permissions requested`, 'notice', [...new Set(risky)].join(', ')));
    if (attrs.debuggable === 'true' || app?.attrs.debuggable === 'true') findings.push(finding('App is marked debuggable', 'warning', 'Anyone can attach a debugger. Release builds should not ship like this.'));
    if (app?.attrs.allowBackup === 'true') findings.push(finding('Backups are allowed', 'notice', 'App data can be extracted with adb backup.'));
    if (app?.attrs.usesCleartextTraffic === 'true') findings.push(finding('Plain-HTTP traffic is allowed', 'warning'));
    const exp = comps.filter((c) => c.exported.startsWith('true'));
    if (exp.length) findings.push(finding(`${exp.length} components are reachable by other apps`, 'info', 'Exported activities, services and receivers are entry points other apps can call.'));
    if (!signed) findings.push(finding('No v1 signature files found', 'notice', 'Modern APKs may be signed with v2+ blocks that are not listed here.'));
    const root = rootId(ctx);
    const graph: Graph = { nodes: [{ id: root, label: attrs.package ?? ctx.target.name, group: 'entry', weight: 9 }], edges: [] };
    for (const c of comps.filter((c) => c.type === 'activity').slice(0, 8)) {
      graph.nodes.push({ id: `act:${c.name}`, label: c.name.split('.').pop() ?? c.name, group: 'ui', weight: 4 });
      graph.edges.push({ from: root, to: `act:${c.name}`, label: 'screen' });
    }
    for (const c of comps.filter((c) => c.type !== 'activity').slice(0, 8)) {
      graph.nodes.push({ id: `cmp:${c.name}`, label: c.name.split('.').pop() ?? c.name, group: 'module', weight: 3 });
      graph.edges.push({ from: root, to: `cmp:${c.name}`, label: c.type });
    }
    for (const f of frameworks.slice(0, 4)) {
      graph.nodes.push({ id: `fw:${f}`, label: f, group: 'lib', weight: 4 });
      graph.edges.push({ from: root, to: `fw:${f}`, label: 'built with' });
    }
    for (const d of cs.domains.slice(0, 8)) {
      graph.nodes.push({ id: `svc:${d}`, label: d, group: 'service', weight: 3 });
      graph.edges.push({ from: root, to: `svc:${d}`, label: 'contacts' });
    }
    const textBits = await zipTextEntries(bytes, z.entries.filter((e) => /^assets\/(www|public)\//.test(e.name) || /^assets\/.*\.(js|html|json)$/.test(e.name)), 40, 2 * 1024 * 1024, ctx.opts.maxRecoveredBytes);
    return {
      evidence: [
        makeEvidence({
          operation: 'inspect_apk',
          title: 'Android app package',
          target: ctx.target,
          summary: `Android app ${attrs.package ?? '(unknown id)'}${attrs.versionName ? ` v${attrs.versionName}` : ''}: ${permissions.length} permissions, ${comps.length} components, ${classes.length} classes${frameworks.length ? `, built with ${frameworks.join(' + ')}` : ''}.`,
          normalized_result: { package: attrs.package ?? null, version_name: attrs.versionName ?? null, version_code: attrs.versionCode ?? null, min_sdk: sdk.minSdkVersion ?? null, target_sdk: sdk.targetSdkVersion ?? null, permissions, components: comps.slice(0, 200), debuggable: app?.attrs.debuggable === 'true', allow_backup: app?.attrs.allowBackup ?? null, cleartext_traffic: app?.attrs.usesCleartextTraffic ?? null, network_security_config: app?.attrs.networkSecurityConfig ?? null, frameworks, abis, native_libraries: libs.map((l) => l.name).slice(0, 100), dex_files: dexEntries.map((d) => d.name), class_count: classes.length, method_count: methods, top_packages: topPkgs, signed_v1: signed, domains: cs.domains.slice(0, 60), urls: cs.urls.slice(0, 80) },
          sections: [
            kv('App', { 'App id': attrs.package ?? null, Version: attrs.versionName ?? null, 'Version code': attrs.versionCode ?? null, 'Min Android': sdk.minSdkVersion ?? null, 'Target Android': sdk.targetSdkVersion ?? null, Size: fmtBytes(bytes.length), Classes: classes.length, Methods: methods, 'Signed (v1)': signed ? 'yes' : 'no' }),
            tags('Built with', frameworks.map((f) => ({ label: f, tone: 'cyan' as const }))),
            table('Permissions', ['Permission', 'Sensitive'], permissions.map((p) => [p, DANGEROUS.has(p.split('.').pop() ?? '') ? 'yes' : '']), 120),
            table('Components', ['Type', 'Name', 'Reachable by other apps', 'Actions'], comps.map((c) => [c.type, c.name, c.exported, c.actions.join(', ')]), 120),
            table('Biggest code packages', ['Package', 'Classes'], topPkgs.map(([p, n]) => [p, n])),
            list('Native libraries', libs.map((l) => l.name)),
            list('Web addresses found in code', cs.urls.map((u) => clean(u, 160))),
            list('Services it contacts', cs.domains),
          ],
          findings,
          graph,
          coverage: { status: 'partial', notes },
          limitations: ['App logic is compiled to Dalvik bytecode: class names and strings are listed, but method bodies were not decompiled. Use JADX through the local engine for readable Java.', 'Resources (resources.arsc) were not decoded, so labels shown as @0x… are resource references.'],
        }),
      ],
      recovered: textBits.recovered,
      textEntries: textBits.textEntries,
    };
  });
}
