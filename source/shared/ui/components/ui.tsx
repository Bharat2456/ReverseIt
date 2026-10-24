import { createContext, useCallback, useContext, useState } from 'react';

export function Panel({ title, mod, tone, children, className = '', style }: { title?: any; mod?: string; tone?: 'orange'; children?: any; className?: string; style?: any }) {
  return (
    <section className={`panel ${tone ?? ''} ${className}`} style={style}>
      {title && <div className="ptitle"><span>{title}</span>{mod && <span className="mod">{mod}</span>}</div>}
      {children}
    </section>
  );
}

export function Tag({ tone, children }: { tone?: string; children?: any }) {
  return <span className={'tag ' + (tone ?? '')}>{children}</span>;
}

/** Circular HUD gauge, ticks + arc + centre value. */
export function Gauge({ value, label, size = 108, tone = 'cyan', suffix = '' }: { value: number; label?: string; size?: number; tone?: 'cyan' | 'orange' | 'green' | 'red'; suffix?: string }) {
  const col = { cyan: '#19e3ff', orange: '#ff8a1f', green: '#3dffa0', red: '#ff4d5e' }[tone];
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const ticks = Array.from({ length: 36 }, (_, i) => i);
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2} ${size / 2})`}>
          <g className="spin" style={{ opacity: 0.5 }}>
            {ticks.map((i) => <line key={i} x1={0} y1={-(r + 6)} x2={0} y2={-(r + (i % 3 === 0 ? 1 : 3))} stroke={col} strokeWidth={1} transform={`rotate(${i * 10})`} />)}
          </g>
          <circle r={r - 6} fill="none" stroke={col} strokeOpacity=".15" strokeWidth="6" />
          <circle r={r - 6} fill="none" stroke={col} strokeWidth="6" strokeDasharray={`${(c - 38) * (v / 100)} ${c}`} strokeLinecap="butt" transform="rotate(-90)" style={{ filter: `drop-shadow(0 0 5px ${col})`, transition: 'stroke-dasharray .8s' }} />
          <circle r={r - 18} fill="none" stroke={col} strokeOpacity=".35" strokeDasharray="2 4" className="spinr" />
        </g>
      </svg>
      <div className="gv" style={{ fontSize: size * 0.2 }}>{Math.round(v)}{suffix || '%'}{label && <small>{label}</small>}</div>
    </div>
  );
}

export function Stat({ num, label, tone }: { num: any; label: string; tone?: 'orange' }) {
  return <div className="stat"><div><div className="num" style={tone === 'orange' ? { color: 'var(--orange2)' } : undefined}>{num}</div><div className="lab">{label}</div></div></div>;
}

export function PageHead({ title, why, kicker, actions }: { title: string; why: string; kicker?: string; actions?: any }) {
  return (
    <header className="pagehead">
      {kicker && <div className="kicker">{kicker}</div>}
      <div className="row spread"><h1 style={{ margin: 0 }}>{title}</h1>{actions && <div className="row">{actions}</div>}</div>
      <div className="why"><b>Why this page</b><span>{why}</span></div>
    </header>
  );
}

type Toast = { id: number; text: string; kind?: string };
const ToastCtx = createContext((_t: string, _kind?: string) => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children?: any }) {
  const [list, setList] = useState([] as Toast[]);
  const push = useCallback((text: string, kind?: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Spinner() { return <span className="loader" aria-label="Loading" />; }
export function Progress({ pct }: { pct: number }) { return <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)}><i style={{ width: Math.max(2, Math.min(100, pct)) + '%' }} /></div>; }
