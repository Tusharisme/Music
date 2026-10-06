import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CrossfaderCurve } from '../audio/curves';
import type { KeyNotation } from '../music/keys';
import type { MixStyle, Vibe } from '../ai/recommender';
import type { SyncMode } from '../audio/protocol';

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
  apiKey: string;
  model: string;
  effort: Effort;
  mixStyle: MixStyle;
  vibe: Vibe;
  allowKeyShift: boolean;
  mixWhen: 'phrase' | 'now';
  midi: MidiMapping[];
  seenWelcome: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';

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
      apiKey: '',
      model: DEFAULT_MODEL,
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
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
