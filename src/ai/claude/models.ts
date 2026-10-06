/** Claude models offered in Settings and what each one accepts. */
export interface ModelInfo {
  id: string;
  label: string;
  /** Accepts output_config.effort. */
  effort: boolean;
  /** Accepts the server-side refusal fallbacks parameter. */
  fallbacks: boolean;
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 – best', effort: true, fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 – faster', effort: true, fallbacks: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 – fastest', effort: false, fallbacks: false },
];

export const DEFAULT_MODEL_ID = 'claude-opus-5-5';

export function modelInfo(id: string | undefined): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
