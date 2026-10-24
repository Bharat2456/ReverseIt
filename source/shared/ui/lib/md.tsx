import { Fragment } from 'react';

function inline(s: string, key: string): any[] {
  const out: any[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={key + i}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key + i}>{t.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={key + i}>{t.slice(1, -1)}</em>);
    else out.push(<a key={key + i} href={m[5]} target="_blank" rel="noopener noreferrer">{t.slice(1, t.indexOf(']'))}</a>);
    last = m.index + t.length;
    i++;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Small, safe Markdown renderer (no HTML injection: everything becomes React text nodes). */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: any[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+.-]*)/.exec(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + fence[1] + '\\s*$').test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const L = Math.min(h[1].length, 3);
      const Tag: any = 'h' + L;
      blocks.push(<Tag key={k++}>{inline(h[2], 'h' + k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push(<hr key={k++} />); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={k++}>{inline(buf.join(' '), 'q' + k)}</blockquote>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div className="tablewrap" key={k++}><table><thead><tr>{head.map((c, j) => <th key={j}>{c}</th>)}</tr></thead><tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, b) => <td key={b}>{inline(c, `t${a}${b}`)}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m2 = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m2) items.push(m2[3]);
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim();
        else break;
        i++;
      }
      const L: any = ordered ? 'ol' : 'ul';
      blocks.push(<L key={k++}>{items.map((t, j) => <li key={j}>{inline(t, `l${k}${j}`)}</li>)}</L>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*(`{3,}|~{3,})|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) buf.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(buf.join(' '), 'p' + k)}</p>);
  }
  return <div className={'md' + (streaming ? ' stream-cursor' : '')}>{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
