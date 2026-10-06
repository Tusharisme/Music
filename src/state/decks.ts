import { create } from 'zustand';
import type { HotCue } from '../types';
import type { FxSettings } from '../audio/effects';
import type { SyncMode } from '../audio/protocol';

export type PadMode = 'hotcue' | 'loop' | 'roll' | 'jump' | 'sampler';

export interface DeckState {
  trackId: string | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  duration: number;
  bpm: number;
  firstBeat: number;
  cue: number;
  tempo: number;
  tempoRange: number;
  keyLock: boolean;
  keyShift: number;
  sync: SyncMode;
  slip: boolean;
  quantize: boolean;
  vinyl: boolean;
  reverse: boolean;
  loop: { on: boolean; start: number; end: number };
  autoLoopBeats: number;
  jumpBeats: number;
  padMode: PadMode;
  hotCues: (HotCue | null)[];
  fx: FxSettings;
  armed: boolean;
}

export const HOT_CUE_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];

export const freshDeck = (): DeckState => ({
  trackId: null,
  loading: false,
  error: null,
  playing: false,
  duration: 0,
  bpm: 0,
  firstBeat: 0,
  cue: 0,
  tempo: 1,
  tempoRange: 8,
  keyLock: true,
  keyShift: 0,
  sync: 'off',
  slip: false,
  quantize: true,
  vinyl: true,
  reverse: false,
  loop: { on: false, start: 0, end: 0 },
  autoLoopBeats: 4,
  jumpBeats: 4,
  padMode: 'hotcue',
  hotCues: new Array(8).fill(null),
  fx: { type: 'echo', on: false, mix: 0.5, param: 0.5, beats: 0.75 },
  armed: false,
});

interface DecksState {
  decks: [DeckState, DeckState];
  master: 0 | 1;
  setDeck: (deck: number, patch: Partial<DeckState>) => void;
  setMaster: (deck: 0 | 1) => void;
}

export const useDecks = create<DecksState>()((set, get) => ({
  decks: [freshDeck(), freshDeck()],
  master: 0,
  setDeck: (deck, patch) => {
    const decks = [...get().decks] as DecksState['decks'];
    decks[deck] = { ...decks[deck], ...patch };
    set({ decks });
  },
  setMaster: (master) => set({ master }),
}));

export const deckState = (deck: number): DeckState => useDecks.getState().decks[deck];
