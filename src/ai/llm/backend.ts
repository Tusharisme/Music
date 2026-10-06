import type { z } from 'zod';
import { providerInfo, type ProviderId } from './providers';

/** A request for a JSON answer matching `schema`. */
export interface JsonTask {
  /** Schema name for providers that take one (letters, digits and underscores). */
  name: string;
  schema: z.ZodType;
  system: string;
  library: string;
  prompt: string;
  /** Plain-language JSON shape, for models that can't take a schema. */
  shape: string;
  signal?: AbortSignal;
}

export interface ChatTask {
  system: string;
  library: string;
  /** Situation-specific instructions after the (cacheable) library. */
  tail: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

/** One language-model service, as the copilot needs it. */
export interface Backend {
  readonly label: string;
  /** Most library tracks worth sending in one request. */
  readonly maxTracks: number;
  /** Parsed JSON (validated and normalised by the caller). */
  json(task: JsonTask): Promise<unknown>;
  /** Streams text through `onText` and resolves with the whole answer. */
  chat(task: ChatTask, onText: (delta: string) => void, signal?: AbortSignal): Promise<string>;
}

export interface BackendConfig {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Claude only. */
  effort?: 'low' | 'medium' | 'high';
  /** Replacement fetch (tests). */
  fetch?: typeof fetch;
}

export async function createBackend(cfg: BackendConfig): Promise<Backend> {
  if (providerInfo(cfg.provider).kind === 'anthropic') {
    const { anthropicBackend } = await import('./anthropic');
    return anthropicBackend(cfg);
  }
  const { openAiBackend } = await import('./openai');
  return openAiBackend(cfg);
}

/** Models available to this key (also proves the key and address work). */
export async function listModels(cfg: BackendConfig): Promise<string[]> {
  if (providerInfo(cfg.provider).kind === 'anthropic') {
    const { listClaudeModels } = await import('./anthropic');
    return listClaudeModels(cfg);
  }
  const { listOpenAiModels } = await import('./openai');
  return listOpenAiModels(cfg);
}
