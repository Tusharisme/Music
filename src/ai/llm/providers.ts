/** The language-model services the AI DJ copilot can use. Free options first. */

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'ollama' | 'anthropic' | 'custom';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Short name for status chips. */
  short: string;
  /** Wire protocol: OpenAI-style chat completions, or Anthropic's Messages API. */
  kind: 'openai' | 'anthropic';
  /** What you get for free, or null for paid-only services. */
  free: string | null;
  baseUrl: string;
  defaultModel: string;
  /** Models to offer before a live list has been loaded. */
  models: string[];
  needsKey: boolean;
  keyUrl?: string;
  keyHint?: string;
  /** Most library tracks to send (context window and free-tier token limits). */
  maxTracks: number;
  /** Output token budget per answer. */
  maxTokens: number;
  /** Ask reasoning models to think briefly (`reasoning_effort: "low"`) for quick answers. */
  lowReasoning: boolean;
  /** Setup steps shown next to the key field. */
  steps: string[];
  note?: string;
}

/** Claude models offered in Settings and what each one accepts. */
export interface ClaudeModel {
  id: string;
  label: string;
  /** Accepts output_config.effort. */
  effort: boolean;
  /** Accepts the server-side refusal fallbacks parameter. */
  fallbacks: boolean;
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 – best', effort: true, fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 – faster', effort: true, fallbacks: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 – fastest', effort: false, fallbacks: false },
];

export function claudeModel(id: string | undefined): ClaudeModel {
  return CLAUDE_MODELS.find((m) => m.id === id) ?? CLAUDE_MODELS[0];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    short: 'Gemini',
    kind: 'openai',
    free: 'Free tier on all Flash models – no credit card',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-flash-latest',
    models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    maxTracks: 400,
    maxTokens: 8192,
    lowReasoning: true,
    steps: ['Sign in to Google AI Studio with any Google account.', 'Click “Create API key” and copy it.'],
    note: 'On the free tier Google may use requests to improve its products. MixMind only sends track details, never audio.',
  },
  {
    id: 'groq',
    label: 'Groq',
    short: 'Groq',
    kind: 'openai',
    free: 'Free tier – very fast, about 1,000 requests a day',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    // The free tier allows ~8K tokens a minute, so prompts stay small.
    maxTracks: 60,
    maxTokens: 2000,
    lowReasoning: true,
    steps: [
      'Create a free GroqCloud account (no card needed).',
      'Open “API Keys”, create a key and copy it.',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    short: 'OpenRouter',
    kind: 'openai',
    free: 'Free models – 50 requests a day',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    models: ['openrouter/free'],
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    maxTracks: 200,
    maxTokens: 4096,
    lowReasoning: false,
    steps: [
      'Create a free OpenRouter account.',
      'Create a key under “Keys”. “openrouter/free” picks a free model for you.',
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (on your computer)',
    short: 'Ollama',
    kind: 'openai',
    free: 'Free and private – runs on your own computer, no key',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'qwen3', 'gemma3', 'gpt-oss:20b'],
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
    maxTracks: 60,
    maxTokens: 2048,
    lowReasoning: false,
    steps: ['Install Ollama on your computer.', 'Run “ollama pull llama3.2” (or any model you like).'],
    note: 'Using MixMind from a website rather than localhost? Start Ollama with OLLAMA_ORIGINS=* so the browser may connect.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    short: 'Claude',
    kind: 'anthropic',
    free: null,
    baseUrl: '',
    defaultModel: CLAUDE_MODELS[0].id,
    models: CLAUDE_MODELS.map((m) => m.id),
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    maxTracks: 400,
    maxTokens: 16000,
    lowReasoning: false,
    steps: ['Create a key in the Anthropic Console (paid API).'],
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    short: 'AI',
    kind: 'openai',
    free: null,
    baseUrl: '',
    defaultModel: '',
    models: [],
    needsKey: false,
    maxTracks: 150,
    maxTokens: 4096,
    lowReasoning: false,
    steps: ['Enter the service’s base URL (ending in /v1), a model name and, if it needs one, a key.'],
    note: 'Works with anything that speaks the OpenAI chat-completions API: LM Studio, Mistral, Cerebras, vLLM…',
  },
];

export const DEFAULT_PROVIDER: ProviderId = 'gemini';

export function isProviderId(v: unknown): v is ProviderId {
  return PROVIDERS.some((p) => p.id === v);
}

export function providerInfo(id: string | undefined): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
