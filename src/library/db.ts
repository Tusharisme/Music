import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TrackRecord, WaveformData } from '../types';

export interface CachedPcm {
  sampleRate: number;
  L: Int16Array;
  R: Int16Array;
  duration: number;
  usedAt: number;
}

interface MixMindDB extends DBSchema {
  tracks: { key: string; value: TrackRecord };
  waveforms: { key: string; value: WaveformData };
  blobs: { key: string; value: Blob };
  artwork: { key: string; value: Blob };
  pcm: { key: string; value: CachedPcm };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<MixMindDB>> | null = null;

export function db(): Promise<IDBPDatabase<MixMindDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MixMindDB>('mixmind', 1, {
      upgrade(d) {
        d.createObjectStore('tracks', { keyPath: 'id' });
        d.createObjectStore('waveforms');
        d.createObjectStore('blobs');
        d.createObjectStore('artwork');
        d.createObjectStore('pcm');
        d.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export const tracksDb = {
  async all(): Promise<TrackRecord[]> {
    return (await db()).getAll('tracks');
  },
  async put(t: TrackRecord): Promise<void> {
    await (await db()).put('tracks', t);
  },
  async get(id: string): Promise<TrackRecord | undefined> {
    return (await db()).get('tracks', id);
  },
  async remove(t: TrackRecord): Promise<void> {
    const d = await db();
    const tx = d.transaction(['tracks', 'waveforms', 'blobs', 'artwork'], 'readwrite');
    await tx.objectStore('tracks').delete(t.id);
    await tx.objectStore('waveforms').delete(t.id);
    if (t.source.kind === 'file') await tx.objectStore('blobs').delete(t.source.blobKey);
    if (t.artworkKey) await tx.objectStore('artwork').delete(t.artworkKey);
    await tx.done;
  },
};

export const blobsDb = {
  async put(key: string, blob: Blob): Promise<void> {
    await (await db()).put('blobs', blob, key);
  },
  async get(key: string): Promise<Blob | undefined> {
    return (await db()).get('blobs', key);
  },
};

export const artworkDb = {
  async put(key: string, blob: Blob): Promise<void> {
    await (await db()).put('artwork', blob, key);
  },
  async get(key: string): Promise<Blob | undefined> {
    return (await db()).get('artwork', key);
  },
};

export const waveformDb = {
  async put(id: string, w: WaveformData): Promise<void> {
    await (await db()).put('waveforms', w, id);
  },
  async get(id: string): Promise<WaveformData | undefined> {
    return (await db()).get('waveforms', id);
  },
};

/** Rendered demo-track PCM cache (keeps the most recently used few). */
export const pcmCache = {
  max: 4,
  async get(key: string): Promise<CachedPcm | undefined> {
    const d = await db();
    const v = await d.get('pcm', key);
    if (v) void d.put('pcm', { ...v, usedAt: Date.now() }, key);
    return v;
  },
  async put(key: string, v: Omit<CachedPcm, 'usedAt'>): Promise<void> {
    const d = await db();
    await d.put('pcm', { ...v, usedAt: Date.now() }, key);
    const keys = await d.getAllKeys('pcm');
    if (keys.length > this.max) {
      const entries = await Promise.all(
        keys.map(async (k) => ({ k, at: (await d.get('pcm', k))?.usedAt ?? 0 })),
      );
      entries.sort((a, b) => a.at - b.at);
      for (const e of entries.slice(0, entries.length - this.max)) await d.delete('pcm', e.k);
    }
  },
};

export const kvDb = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await (await db()).get('kv', key)) as T | undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    await (await db()).put('kv', value, key);
  },
};
