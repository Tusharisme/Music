import { create } from 'zustand';
import type { Suggestion } from '../ai/recommender';
import type { TransitionPlan } from '../ai/transitions';

export type MixPhase = 'idle' | 'preparing' | 'armed' | 'running';

export interface MixStatus {
  phase: MixPhase;
  plan: TransitionPlan | null;
  outDeck: number;
  inDeck: number;
  trackId: string | null;
  /** Context time of the switch point (beat 0). */
  t0: number;
  /** -1..1 progress: negative while waiting for the switch, 0..1 during the transition. */
  progress: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Structured picks attached to an assistant turn. */
  picks?: ClaudePicks;
  error?: boolean;
}

export interface ClaudePick {
  trackId: string;
  why: string;
  technique?: string;
  tip?: string;
}

export interface ClaudeDiscovery {
  title: string;
  artist: string;
  why: string;
  bpm?: number | null;
  key?: string | null;
  mixTip?: string;
}

export interface ClaudePicks {
  headline: string;
  picks: ClaudePick[];
  discover: ClaudeDiscovery[];
}

export interface SetPlanItem {
  trackId: string;
  note: string;
  technique?: string;
}

export interface SetPlan {
  title: string;
  arc: string;
  items: SetPlanItem[];
}

export interface ClaudeStatus {
  state: 'checking' | 'ready' | 'unavailable';
  via: 'server' | 'byok' | null;
  model?: string;
  reason?: string;
}

interface AIState {
  suggestions: Suggestion[];
  refDeck: number | null;
  mix: MixStatus;
  autoDj: boolean;
  queue: string[];
  claude: ClaudeStatus;
  chat: ChatMessage[];
  chatBusy: boolean;
  picksBusy: boolean;
  setPlan: SetPlan | null;
  setPlanBusy: boolean;
  patch: (p: Partial<Omit<AIState, 'patch'>>) => void;
  setMix: (p: Partial<MixStatus>) => void;
}

export const idleMix = (): MixStatus => ({
  phase: 'idle',
  plan: null,
  outDeck: 0,
  inDeck: 1,
  trackId: null,
  t0: 0,
  progress: 0,
});

export const useAI = create<AIState>()((set, get) => ({
  suggestions: [],
  refDeck: null,
  mix: idleMix(),
  autoDj: false,
  queue: [],
  claude: { state: 'checking', via: null },
  chat: [],
  chatBusy: false,
  picksBusy: false,
  setPlan: null,
  setPlanBusy: false,
  patch: (p) => set(p),
  setMix: (p) => set({ mix: { ...get().mix, ...p } }),
}));
