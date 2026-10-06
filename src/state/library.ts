import { create } from 'zustand';
import type { TrackRecord, WaveformData } from '../types';
import { tracksDb, waveformDb, artworkDb } from '../library/db';
import { importFiles, type ImportProgress } from '../library/importer';
import { analysisQueue, needsAnalysis } from '../library/analysisQueue';
import { demoTrackRecords } from '../library/demoLibrary';

interface LibraryState {
  tracks: Record<string, TrackRecord>;
  ready: boolean;
  pending: string[];
  active: string[];
  errors: Record<string, string>;
  importing: ImportProgress | null;
  /** Bumped whenever a waveform becomes available (for components to re-read the cache). */
  waveformVersion: number;
  init: () => Promise<void>;
  addFiles: (files: File[]) => Promise<number>;
  addDemos: () => Promise<void>;
  update: (id: string, patch: Partial<TrackRecord>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reanalyze: (id: string) => void;
  markPlayed: (id: string) => void;
}

// ---------------------------------------------------------------- waveform cache

const waveforms = new Map<string, WaveformData>();
const waveformLoads = new Map<string, Promise<WaveformData | undefined>>();

export function getWaveform(id: string): WaveformData | undefined {
  return waveforms.get(id);
}

export function loadWaveform(id: string): Promise<WaveformData | undefined> {
  const w = waveforms.get(id);
  if (w) return Promise.resolve(w);
  let p = waveformLoads.get(id);
  if (!p) {
    p = waveformDb.get(id).then((v) => {
      if (v) {
        waveforms.set(id, v);
        useLibrary.setState((s) => ({ waveformVersion: s.waveformVersion + 1 }));
      }
      waveformLoads.delete(id);
      return v;
    });
    waveformLoads.set(id, p);
  }
  return p;
}

// ---------------------------------------------------------------- artwork cache

const artUrls = new Map<string, string>();
export async function artworkUrl(t: TrackRecord): Promise<string | null> {
  if (!t.artworkKey) return null;
  const hit = artUrls.get(t.artworkKey);
  if (hit) return hit;
  const blob = await artworkDb.get(t.artworkKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  artUrls.set(t.artworkKey, url);
  return url;
}

export const useLibrary = create<LibraryState>()((set, get) => {
  analysisQueue.on({
    state: (pending, active) => set({ pending, active }),
    done: ({ id, analysis, waveform }) => {
      waveforms.set(id, waveform);
      const t = get().tracks[id];
      if (!t) return;
      const next: TrackRecord = {
        ...t,
        analysis,
        duration: analysis.duration || t.duration,
        analysisError: undefined,
      };
      set((s) => ({ tracks: { ...s.tracks, [id]: next }, waveformVersion: s.waveformVersion + 1 }));
      void tracksDb.put(next);
    },
    failed: (id, error) => {
      set((s) => ({ errors: { ...s.errors, [id]: error } }));
      const t = get().tracks[id];
      if (t) void tracksDb.put({ ...t, analysisError: error });
    },
  });

  return {
    tracks: {},
    ready: false,
    pending: [],
    active: [],
    errors: {},
    importing: null,
    waveformVersion: 0,

    init: async () => {
      let all = await tracksDb.all().catch((): TrackRecord[] => []);
      if (!all.length) {
        // First run: seed the built-in demo crate.
        all = demoTrackRecords();
        await Promise.all(all.map((t) => tracksDb.put(t).catch(() => {})));
      }
      const tracks: Record<string, TrackRecord> = {};
      for (const t of all) tracks[t.id] = t;
      set({ tracks, ready: true });
      analysisQueue.enqueue(all.filter(needsAnalysis).sort((a, b) => a.addedAt - b.addedAt));
    },

    addFiles: async (files) => {
      set({ importing: { done: 0, total: files.length } });
      try {
        const recs = await importFiles(files, (p) => set({ importing: p }));
        set((s) => {
          const tracks = { ...s.tracks };
          for (const r of recs) tracks[r.id] = r;
          return { tracks };
        });
        analysisQueue.enqueue(recs);
        return recs.length;
      } finally {
        set({ importing: null });
      }
    },

    addDemos: async () => {
      const existing = get().tracks;
      const fresh = demoTrackRecords().filter((t) => !existing[t.id]);
      await Promise.all(fresh.map((t) => tracksDb.put(t)));
      set((s) => {
        const tracks = { ...s.tracks };
        for (const t of fresh) tracks[t.id] = t;
        return { tracks };
      });
      analysisQueue.enqueue(fresh);
    },

    update: async (id, patch) => {
      const t = get().tracks[id];
      if (!t) return;
      const next = { ...t, ...patch };
      set((s) => ({ tracks: { ...s.tracks, [id]: next } }));
      await tracksDb.put(next);
    },

    remove: async (id) => {
      const t = get().tracks[id];
      if (!t) return;
      set((s) => {
        const tracks = { ...s.tracks };
        delete tracks[id];
        return { tracks };
      });
      waveforms.delete(id);
      await tracksDb.remove(t);
    },

    reanalyze: (id) => {
      const t = get().tracks[id];
      if (!t) return;
      set((s) => {
        const errors = { ...s.errors };
        delete errors[id];
        return { errors };
      });
      analysisQueue.enqueue([{ ...t, analysis: undefined }], true);
    },

    markPlayed: (id) => {
      const t = get().tracks[id];
      if (!t) return;
      void get().update(id, { playCount: (t.playCount ?? 0) + 1, lastPlayedAt: Date.now() });
    },
  };
});
