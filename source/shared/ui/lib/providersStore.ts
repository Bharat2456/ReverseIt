import type { ProviderConfig } from '../../ai/types';

const KEY = 'reverseit.providers.v1';
const ACTIVE = 'reverseit.activeProvider.v1';
let memory: { list: ProviderConfig[]; active: string | null } = { list: [], active: null };
const listeners = new Set<() => void>();

function load() {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    memory = { list: Array.isArray(l) ? l : [], active: localStorage.getItem(ACTIVE) };
  } catch { /* storage blocked: keep in-memory */ }
}
load();
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory.list));
    if (memory.active) localStorage.setItem(ACTIVE, memory.active); else localStorage.removeItem(ACTIVE);
  } catch { /* ignore */ }
  listeners.forEach((f) => f());
}
export const subscribeProviders = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const listProviders = () => memory.list;
export const getActiveProvider = (): ProviderConfig | undefined => memory.list.find((p) => p.id === memory.active) ?? memory.list[0];
export function saveProvider(p: ProviderConfig, makeActive = true) {
  memory.list = [...memory.list.filter((x) => x.id !== p.id), p];
  if (makeActive || !memory.active) memory.active = p.id;
  persist();
}
export function removeProvider(id: string) {
  memory.list = memory.list.filter((p) => p.id !== id);
  if (memory.active === id) memory.active = memory.list[0]?.id ?? null;
  persist();
}
export function setActiveProvider(id: string) { memory.active = id; persist(); }
export function clearAllProviders() { memory = { list: [], active: null }; persist(); }
