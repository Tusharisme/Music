import type { TrackRecord } from '../types';
import { artworkDb, blobsDb, tracksDb } from './db';
import { isAudioFile, parseFileName, readMetadata } from './metadata';

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface ImportProgress {
  done: number;
  total: number;
  current?: string;
}

/** Store audio files in IndexedDB with their tags; returns the new library records. */
export async function importFiles(
  files: File[],
  onProgress?: (p: ImportProgress) => void,
): Promise<TrackRecord[]> {
  const audio = files.filter(isAudioFile);
  const out: TrackRecord[] = [];
  for (let i = 0; i < audio.length; i++) {
    const f = audio[i];
    onProgress?.({ done: i, total: audio.length, current: f.name });
    const id = uid();
    const meta = await readMetadata(f);
    const fromName = parseFileName(f.name);
    const blobKey = `audio-${id}`;
    await blobsDb.put(blobKey, f);
    let artworkKey: string | undefined;
    if (meta.picture) {
      artworkKey = `art-${id}`;
      await artworkDb.put(artworkKey, meta.picture);
    }
    const rec: TrackRecord = {
      id,
      title: meta.title ?? fromName.title,
      artist: meta.artist ?? fromName.artist ?? 'Unknown artist',
      album: meta.album,
      genre: meta.genre,
      year: meta.year,
      tagBpm: meta.bpm,
      tagKey: meta.key,
      duration: meta.duration ?? 0,
      source: { kind: 'file', blobKey, mime: f.type || 'audio/*', fileName: f.name },
      artworkKey,
      addedAt: Date.now() + i,
      playCount: 0,
    };
    await tracksDb.put(rec);
    out.push(rec);
  }
  onProgress?.({ done: audio.length, total: audio.length });
  return out;
}
