import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CrossfaderCurve } from '../audio/curves';
import type { KeyNotation } from '../music/keys';
import type { MixStyle, Vibe } from '../ai/recommender';
import type { SyncMode } from '../audio/protocol';
import { DEFAULT_PROVIDER, isProviderId, type ProviderId } from '../ai/llm/providers';

export type AiMode = 'auto' | 'server' | 'byok' | 'off';
export type Effort = 'low' | 'medium' | 'high';

export interface MidiMapping {
  /** "cc:ch:num" or "note:ch:num" */
  input: string;
  target: string;
}

export interface SettingsState {
  keyNotation: KeyNotation;
  defaultKeyLock: boolean;
  quantize: boolean;
  tempoRange: number;
  defaultSync: SyncMode;
  autoGain: boolean;
  autoGainTarget: number;
  limiter: boolean;
  splitCue: boolean;
  crossfaderCurve: CrossfaderCurve;
  filterResonance: number;
  waveformSeconds: number;
  waveformStyle: 'bands' | 'rgb' | 'mono';
  vinylMode: boolean;
  bpmMin: number;
  bpmMax: number;
  trustTags: boolean;
  aiMode: AiMode;
  /** Which AI service the copilot uses from this browser. */
  aiProvider: ProviderId;
  /** Keys, models and addresses per provider, so switching keeps each one's setup. */
  aiKeys: Partial<Record<ProviderId, string>>;
  aiModels: Partial<Record<ProviderId, string>>;
  aiBaseUrls: Partial<Record<ProviderId, string>>;
  /** Claude only. */
  effort: Effort;
  mixStyle: MixStyle;
  vibe: Vibe;
  allowKeyShift: boolean;
  mixWhen: 'phrase' | 'now';
  midi: MidiMapping[];
  seenWelcome: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

/** Upgrade settings saved by older versions (v1 only knew Claude). */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const s = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 2) {
    // Keep a saved Anthropic key and model under the new per-provider settings.
    const key = typeof s.apiKey === 'string' ? s.apiKey.trim() : '';
    const model = typeof s.model === 'string' ? s.model : '';
    s.aiKeys = key ? { anthropic: key } : {};
    s.aiModels = model ? { anthropic: model } : {};
    s.aiProvider = key ? 'anthropic' : DEFAULT_PROVIDER;
    delete s.apiKey;
    delete s.model;
  }
  if (!isProviderId(s.aiProvider)) s.aiProvider = DEFAULT_PROVIDER;
  return s;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      keyNotation: 'camelot',
      defaultKeyLock: true,
      quantize: true,
      tempoRange: 8,
      defaultSync: 'beat',
      autoGain: true,
      autoGainTarget: -9,
      limiter: true,
      splitCue: false,
      crossfaderCurve: 'smooth',
      filterResonance: 4,
      waveformSeconds: 10,
      waveformStyle: 'bands',
      vinylMode: true,
      bpmMin: 70,
      bpmMax: 180,
      trustTags: true,
      aiMode: 'auto',
      aiProvider: DEFAULT_PROVIDER,
      aiKeys: {},
      aiModels: {},
      aiBaseUrls: {},
      effort: 'low',
      mixStyle: 'balanced',
      vibe: 'auto',
      allowKeyShift: true,
      mixWhen: 'phrase',
      midi: [],
      seenWelcome: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'mixmind-settings',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => migrateSettings(persisted, version) as unknown as SettingsState,
    },
  ),
);
