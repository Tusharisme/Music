import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface ChannelState {
  trim: number;
  eqHigh: number;
  eqMid: number;
  eqLow: number;
  filter: number;
  fader: number;
  cue: boolean;
}

export type ChannelKey = keyof Omit<ChannelState, 'cue'>;

export interface MixerState {
  ch: [ChannelState, ChannelState];
  xfader: number;
  master: number;
  cueMix: number;
  sampler: number;
  setChannel: (deck: number, patch: Partial<ChannelState>, source?: 'user' | 'auto') => void;
  setXfader: (x: number, source?: 'user' | 'auto') => void;
  setMaster: (v: number) => void;
  setCueMix: (v: number) => void;
  setSampler: (v: number) => void;
  resetChannel: (deck: number, keepFader?: boolean) => void;
}

const freshChannel = (): ChannelState => ({
  trim: 0.5,
  eqHigh: 0.5,
  eqMid: 0.5,
  eqLow: 0.5,
  filter: 0,
  fader: 0.85,
  cue: false,
});

/** Called whenever the user (not automation) moves a mixer control. */
let userTouch: ((deck: number | 'x', keys: string[]) => void) | null = null;
export function onUserMixerTouch(fn: typeof userTouch): void {
  userTouch = fn;
}

export const useMixer = create<MixerState>()(
  subscribeWithSelector((set, get) => ({
    ch: [freshChannel(), freshChannel()],
    xfader: 0.5,
    master: 0.8,
    cueMix: 0.5,
    sampler: 0.8,
    setChannel: (deck, patch, source = 'user') => {
      const ch = [...get().ch] as MixerState['ch'];
      ch[deck] = { ...ch[deck], ...patch };
      set({ ch });
      if (source === 'user') userTouch?.(deck, Object.keys(patch));
    },
    setXfader: (xfader, source = 'user') => {
      set({ xfader });
      if (source === 'user') userTouch?.('x', ['xfader']);
    },
    setMaster: (master) => set({ master }),
    setCueMix: (cueMix) => set({ cueMix }),
    setSampler: (sampler) => set({ sampler }),
    resetChannel: (deck, keepFader = true) => {
      const ch = [...get().ch] as MixerState['ch'];
      ch[deck] = {
        ...freshChannel(),
        fader: keepFader ? ch[deck].fader : 0.85,
        trim: ch[deck].trim,
        cue: ch[deck].cue,
      };
      set({ ch });
    },
  })),
);
