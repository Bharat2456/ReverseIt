import type { AnalysisResult } from '../../core/types';
import type { ChatMessage, ProviderConfig } from '../../ai/types';

export type Version = 'v1' | 'v2' | 'v3';

export interface ChatOptions {
  onText: (t: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface EngineInfo {
  installed: boolean;
  built: boolean;
  version: string | null;
  nodeOk: boolean;
  nodeVersion: string;
  hint: string;
}

export interface Platform {
  version: Version;
  /** Marketing name shown in the UI footer. */
  edition: string;
  routerMode: 'hash' | 'history' | 'memory';
  /** Public landing website + public docs/builder pages (V3 only). */
  hasLanding: boolean;
  /** Where the dashboard lives: '' (root) or '/app'. */
  appBase: string;
  /** Can the platform fetch a live website for the user? */
  canFetchSites: boolean;
  /** 'sample' = built-in model, no key. 'providers' = user connects their own API key. */
  aiMode: 'sample' | 'providers';
  /** Short explanation shown near AI features. */
  aiNote: string;
  /** Stream a chat reply with the active AI. Throws Error(message) on failure. */
  chat(messages: ChatMessage[], opts: ChatOptions, provider?: ProviderConfig): Promise<string>;
  analyzeSite?(url: string, onProgress: (p: { phase: string; pct: number; message?: string }) => void, signal?: AbortSignal): Promise<AnalysisResult>;
  /** Hand a file to the user. */
  saveFile(name: string, data: Uint8Array | string, mime?: string): Promise<void>;
  /** Localhost edition only: the bundled REA engine. */
  engine?: {
    status(): Promise<EngineInfo>;
    run(file: File, deep: boolean, onProgress: (p: { phase: string; pct: number; message?: string }) => void, signal?: AbortSignal): Promise<import('../../core/types').Evidence[]>;
  };
  /** URL for a bundled asset (portrait, screenshots…). */
  asset(name: string): string;
}

let current: Platform | null = null;
export function setPlatform(p: Platform) {
  current = p;
}
export function platform(): Platform {
  if (!current) throw new Error('Platform not initialised');
  return current;
}

/** Standard browser download used by V2 and V3. */
export async function browserSaveFile(name: string, data: Uint8Array | string, mime = 'application/octet-stream') {
  const blob = new Blob([data as any], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
