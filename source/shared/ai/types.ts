/**
 * ReverseIt AI contracts. The provider layer is format-driven, not vendor-driven:
 * anything that speaks one of the supported API formats can be connected, even
 * if ReverseIt has never heard of the vendor.
 */

/** 'openai' = OpenAI-compatible chat completions (the de-facto standard most vendors copy). */
export type ApiFormat = 'openai' | 'anthropic' | 'gemini';

export type AuthStyle = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';

export interface KnownProvider {
  id: string;
  label: string;
  format: ApiFormat;
  baseUrl: string;
  authStyle: AuthStyle;
  /** Regexes matched against the pasted key to guess the vendor. */
  keyPatterns?: RegExp[];
  /** Short hint shown in the UI, e.g. "starts with sk-ant-". */
  keyHint?: string;
  /** Where the user creates a key. */
  consoleUrl: string;
  docsUrl?: string;
  /** Used when the vendor has no list-models endpoint, or listing fails. */
  fallbackModels: string[];
  /** Vendor runs on the user's machine (Ollama, LM Studio…): key optional. */
  local?: boolean;
  /** Extra static headers (e.g. anthropic-version). */
  headers?: Record<string, string>;
  /** Free-form note for the UI. */
  note?: string;
}

/** A configured connection. Stored client-side (V3) or in the local data dir (V2). */
export interface ProviderConfig {
  id: string; // unique per connection, e.g. 'openai-1700000000000'
  providerId: string; // KnownProvider.id or 'custom'
  label: string;
  format: ApiFormat;
  baseUrl: string;
  authStyle: AuthStyle;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
  /** For vendors with no standard auth: key placed in query string `?key=` */
  keyInQuery?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  provider: ProviderConfig;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ModelInfo {
  id: string;
  label?: string;
}

export interface DetectCandidate {
  providerId: string;
  label: string;
  format: ApiFormat;
  baseUrl: string;
  authStyle: AuthStyle;
  /** The key matched this vendor's key pattern. */
  patternMatch: boolean;
  /** A live request with this key succeeded against this vendor. */
  verified: boolean;
  models: ModelInfo[];
  /** Why verification failed, if it did (never contains the key). */
  error?: string;
}

export interface DetectResponse {
  ok: boolean;
  candidates: DetectCandidate[];
  /** Best candidate id, if any was verified. */
  best?: string;
  message?: string;
}

export interface AiError {
  code:
    | 'bad_request'
    | 'unauthorized'
    | 'forbidden'
    | 'rate_limited'
    | 'model_not_found'
    | 'upstream_error'
    | 'network'
    | 'blocked_url'
    | 'timeout'
    | 'unsupported'
    | 'internal';
  message: string;
  status?: number;
}

/** Wire format for POST /api/ai/chat: Server-Sent Events, each `data:` line is one of these. */
export type ChatStreamEvent =
  | { delta: string }
  | { done: true; usage?: { inputTokens?: number; outputTokens?: number } }
  | { error: AiError };
