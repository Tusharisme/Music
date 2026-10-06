import { create } from 'zustand';

export interface HistoryEntry {
  trackId: string;
  title: string;
  artist: string;
  deck: number;
  /** ms timestamp when the track became audible as master */
  at: number;
  /** Seconds since the start of the session/recording */
  setTime: number;
  transition?: string;
}

interface HistoryState {
  entries: HistoryEntry[];
  sessionStart: number;
  add: (e: Omit<HistoryEntry, 'at' | 'setTime'>) => void;
  clear: () => void;
}

export const useHistory = create<HistoryState>()((set, get) => ({
  entries: [],
  sessionStart: Date.now(),
  add: (e) => {
    const last = get().entries[get().entries.length - 1];
    if (last && last.trackId === e.trackId) return;
    const at = Date.now();
    set({ entries: [...get().entries, { ...e, at, setTime: (at - get().sessionStart) / 1000 }] });
  },
  clear: () => set({ entries: [], sessionStart: Date.now() }),
}));

export function tracklistText(entries: HistoryEntry[]): string {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
  };
  return entries
    .map(
      (e, i) =>
        `${String(i + 1).padStart(2, '0')}. [${fmt(e.setTime)}] ${e.artist} – ${e.title}${e.transition ? `  (${e.transition})` : ''}`,
    )
    .join('\n');
}
