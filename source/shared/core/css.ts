import type { AnalysisPart, Finding, TextCtx } from './types';
import { makeEvidence } from './evidence';
import { bars, kv, list, table, tags, fmtBytes } from './sections';
import { truncate } from './webutil';

export interface DesignTokens {
  colors: { value: string; count: number }[];
  variables: { name: string; value: string }[];
  fonts: { family: string; count: number }[];
  fontSizes: { value: string; count: number }[];
  spacing: { value: string; count: number }[];
  radii: { value: string; count: number }[];
  shadows: string[];
  breakpoints: string[];
  keyframes: string[];
  fontFaces: { family: string; src: string }[];
  zIndexMax: number;
  usesGrid: boolean;
  usesFlex: boolean;
  utilityDensity: number;
  bytes: number;
}

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + toHex2(f(0) * 255) + toHex2(f(8) * 255) + toHex2(f(4) * 255);
}

export function normalizeColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return '#' + [...h].map((c) => c + c).join('').slice(0, 6);
    if (h.length === 6) return '#' + h;
    if (h.length === 8) return h.endsWith('ff') ? '#' + h.slice(0, 6) : '#' + h;
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const base = '#' + toHex2(+m[1]) + toHex2(+m[2]) + toHex2(+m[3]);
    const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    return a >= 0.999 ? base : base + toHex2(a * 255);
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s);
  if (m) return hslToHex(+m[1], +m[2], +m[3]);
  return null;
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function top(m: Map<string, number>, n: number, key: string) {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, count]) => ({ [key]: v, count })) as any[];
}

export function extractDesignTokens(cssIn: string): DesignTokens {
  const css = cssIn.length > 12_000_000 ? cssIn.slice(0, 12_000_000) : cssIn;
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const colors = new Map<string, number>();
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(noComments)) && guard++ < 200000) {
    const c = normalizeColor(m[0]);
    if (c) bump(colors, c);
  }
  const vars: { name: string; value: string }[] = [];
  const vre = /(--[\w-]+)\s*:\s*([^;}{]{1,160})/g;
  const seenVars = new Set<string>();
  while ((m = vre.exec(noComments)) && vars.length < 200) {
    if (seenVars.has(m[1])) continue;
    seenVars.add(m[1]);
    vars.push({ name: m[1], value: m[2].trim() });
  }
  const fonts = new Map<string, number>();
  const fre = /font-family\s*:\s*([^;}{]{1,200})/gi;
  while ((m = fre.exec(noComments))) {
    const first = m[1].split(',')[0].replace(/["'!important]/g, '').trim();
    if (first && !first.startsWith('var(') && !/^(inherit|initial|unset)$/i.test(first)) bump(fonts, first);
  }
  const sizes = new Map<string, number>();
  const sre = /font-size\s*:\s*([\d.]+(?:px|rem|em|%))/gi;
  while ((m = sre.exec(noComments))) bump(sizes, m[1].toLowerCase());
  const spacing = new Map<string, number>();
  const pre = /(?:margin|padding|gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;}{]{1,60})/gi;
  while ((m = pre.exec(noComments))) for (const v of m[1].match(/-?[\d.]+(?:px|rem|em)/g) ?? []) bump(spacing, v);
  const radii = new Map<string, number>();
  const rre = /border-radius\s*:\s*([^;}{]{1,40})/gi;
  while ((m = rre.exec(noComments))) bump(radii, m[1].trim().toLowerCase());
  const shadows = new Set<string>();
  const shre = /box-shadow\s*:\s*([^;}{]{3,200})/gi;
  while ((m = shre.exec(noComments)) && shadows.size < 12) shadows.add(m[1].trim());
  const bps = new Set<string>();
  const bre = /@media[^{]*?\(\s*(?:min|max)-width\s*:\s*([\d.]+(?:px|em|rem))/gi;
  while ((m = bre.exec(noComments))) bps.add(m[1]);
  const kf = new Set<string>();
  const kre = /@keyframes\s+([\w-]+)/g;
  while ((m = kre.exec(noComments))) kf.add(m[1]);
  const ff: { family: string; src: string }[] = [];
  const ffre = /@font-face\s*\{([^}]*)\}/g;
  while ((m = ffre.exec(noComments)) && ff.length < 30) {
    const fam = /font-family\s*:\s*([^;]+)/.exec(m[1])?.[1]?.replace(/["']/g, '').trim() ?? '?';
    const src = /url\(\s*["']?([^"')]+)/.exec(m[1])?.[1] ?? '';
    ff.push({ family: fam, src: truncate(src, 120) });
  }
  let z = 0;
  const zre = /z-index\s*:\s*(-?\d+)/g;
  while ((m = zre.exec(noComments))) z = Math.max(z, parseInt(m[1], 10));
  const classRules = (noComments.match(/\.[\w\\:\/\[\]-]+\s*\{/g) ?? []).length;
  const utility = (noComments.match(/\.(?:[a-z]+:)?\\?(?:[mp][trblxy]?-\d|text-(?:xs|sm|lg|xl)|bg-|flex|grid|w-\d|h-\d|gap-)/g) ?? []).length;
  return {
    colors: top(colors, 24, 'value'),
    variables: vars,
    fonts: top(fonts, 12, 'family'),
    fontSizes: top(sizes, 12, 'value'),
    spacing: top(spacing, 12, 'value'),
    radii: top(radii, 8, 'value'),
    shadows: [...shadows],
    breakpoints: [...bps].sort((a, b) => parseFloat(a) - parseFloat(b)),
    keyframes: [...kf].slice(0, 40),
    fontFaces: ff,
    zIndexMax: z,
    usesGrid: /display\s*:\s*(?:inline-)?grid/.test(noComments),
    usesFlex: /display\s*:\s*(?:inline-)?flex/.test(noComments),
    utilityDensity: classRules ? Math.round((utility / classRules) * 100) / 100 : 0,
    bytes: cssIn.length,
  };
}

/** Rough role guess: the most common very light and very dark colours are background/text; the most saturated frequent colour is the accent. */
export function paletteRoles(colors: { value: string; count: number }[]): { background?: string; text?: string; accent?: string } {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const sat = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const six = colors.filter((c) => c.value.length === 7);
  const light = six.find((c) => lum(c.value) > 0.85);
  const dark = six.find((c) => lum(c.value) < 0.2);
  const accent = six.find((c) => sat(c.value) > 0.45 && lum(c.value) > 0.15 && lum(c.value) < 0.85);
  return { background: light?.value ?? dark?.value, text: dark?.value ?? light?.value, accent: accent?.value };
}

export function tokensToSections(t: DesignTokens, rowMax = 200) {
  const roles = paletteRoles(t.colors);
  return [
    kv('Look & feel at a glance', { 'Likely background': roles.background ?? null, 'Likely text colour': roles.text ?? null, 'Likely accent colour': roles.accent ?? null, 'Largest layer (z-index)': t.zIndexMax || null, 'Uses flexbox': t.usesFlex, 'Uses CSS grid': t.usesGrid, 'Utility-class style (Tailwind-like)': t.utilityDensity > 0.35 ? 'likely' : 'unlikely' }),
    { kind: 'tags' as const, title: 'Colour palette (most used first)', tags: t.colors.map((c) => ({ label: `${c.value} ×${c.count}`, tone: 'cyan' as const })) },
    table('Fonts', ['Family', 'Uses'], t.fonts.map((f) => [f.family, f.count]), rowMax),
    table('Font sizes', ['Size', 'Uses'], t.fontSizes.map((f) => [f.value, f.count]), rowMax),
    table('Spacing values', ['Value', 'Uses'], t.spacing.map((f) => [f.value, f.count]), rowMax),
    table('Corner radii', ['Value', 'Uses'], t.radii.map((f) => [f.value, f.count]), rowMax),
    list('Shadows', t.shadows),
    list('Responsive breakpoints', t.breakpoints),
    list('Animations', t.keyframes),
    table('Custom fonts', ['Family', 'File'], t.fontFaces.map((f) => [f.family, f.src]), rowMax),
    table('CSS variables (design tokens)', ['Name', 'Value'], t.variables.map((v) => [v.name, truncate(v.value, 80)]), rowMax),
  ];
}

export async function analyzeCss(ctx: TextCtx): Promise<AnalysisPart> {
  const t = extractDesignTokens(ctx.text);
  const findings: Finding[] = [];
  const roles = paletteRoles(t.colors);
  return {
    evidence: [
      makeEvidence({
        operation: 'analyze_css',
        title: `Styles: ${ctx.path ?? ctx.name}`,
        target: ctx.target,
        summary: `Stylesheet (${fmtBytes(t.bytes)}) using ${t.colors.length} distinct colours and ${t.fonts.length} font famil${t.fonts.length === 1 ? 'y' : 'ies'}${roles.accent ? `; accent colour looks like ${roles.accent}` : ''}.`,
        normalized_result: { tokens: t as unknown as Record<string, unknown>, roles },
        sections: tokensToSections(t, ctx.opts.maxRows),
        findings,
        coverage: { status: 'partial', notes: ['Colours inside images, SVG or computed at run time are not included.'] },
        limitations: ['Counts reflect how often a value appears in the stylesheet, not how much of the screen it covers.'],
      }),
    ],
  };
}
