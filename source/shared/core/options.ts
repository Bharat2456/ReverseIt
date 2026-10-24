import type { AnalyzeOptions, ResolvedOptions } from './types';

export const DEFAULT_MAX_STRINGS = 400;
export const DEFAULT_MAX_ROWS = 200;
export const DEFAULT_MAX_RECOVERED_BYTES = 24 * 1024 * 1024;

export function resolveOptions(o?: AnalyzeOptions): ResolvedOptions {
  return {
    onProgress: o?.onProgress ?? (() => {}),
    signal: o?.signal,
    maxStrings: o?.maxStrings ?? DEFAULT_MAX_STRINGS,
    maxRows: o?.maxRows ?? DEFAULT_MAX_ROWS,
    maxRecoveredBytes: o?.maxRecoveredBytes ?? DEFAULT_MAX_RECOVERED_BYTES,
  };
}

export class AbortedError extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AbortedError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

/** Yield to the event loop so a browser UI stays responsive during long scans. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
