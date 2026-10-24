import type { AnalysisResult } from '../../core/types';

export interface Investigation {
  id: string;
  createdAt: number;
  title: string;
  kind: 'website' | 'file' | 'paste' | 'demo';
  result: AnalysisResult;
  blueprint?: string;
  notes?: string;
  buildLab?: Record<string, { text: string; at: number }>;
  demo?: boolean;
}

const DB = 'reverseit';
const STORE = 'investigations';
let mem = new Map<string, Investigation>();
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
const wrap = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function listInvestigations(): Promise<Investigation[]> {
  const db = await open();
  let rows: Investigation[] = [];
  if (db) { try { rows = await wrap(db.transaction(STORE).objectStore(STORE).getAll()); } catch { rows = []; } }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [k, v] of mem) if (!byId.has(k)) byId.set(k, v);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}
export async function getInvestigation(id: string): Promise<Investigation | undefined> {
  const db = await open();
  if (db) { try { const r = await wrap(db.transaction(STORE).objectStore(STORE).get(id)); if (r) return r as Investigation; } catch { /* fall through */ } }
  return mem.get(id);
}
export async function saveInvestigation(inv: Investigation): Promise<void> {
  mem.set(inv.id, inv);
  const db = await open();
  if (!db) return;
  try { await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).put(inv)); } catch { /* kept in memory */ }
}
export async function deleteInvestigation(id: string): Promise<void> {
  mem.delete(id);
  const db = await open();
  if (!db) return;
  try { await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)); } catch { /* ignore */ }
}
export async function clearInvestigations(): Promise<void> {
  mem = new Map();
  const db = await open();
  if (!db) return;
  try { await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).clear()); } catch { /* ignore */ }
}
