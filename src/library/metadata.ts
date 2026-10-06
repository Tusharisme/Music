export interface ParsedMeta {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  bpm?: number;
  key?: string;
  duration?: number;
  picture?: Blob;
}

const AUDIO_EXT = /\.(mp3|wav|wave|flac|ogg|oga|opus|m4a|mp4|aac|aif|aiff|webm|caf)$/i;

export function isAudioFile(f: File): boolean {
  return f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);
}

/** "01 - Artist - Title (Extended Mix).mp3" → { artist, title } */
export function parseFileName(name: string): { artist?: string; title: string } {
  let base = name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/_/g, ' ')
    .trim();
  base = base.replace(/^\d{1,3}[\s.\-_]+/, '');
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { title: base };
}

/** Read tags (title, artist, BPM, key, artwork…) with music-metadata, loaded on demand. */
export async function readMetadata(file: Blob): Promise<ParsedMeta> {
  try {
    const mm = await import('music-metadata');
    const meta = await mm.parseBlob(file, { duration: false, skipCovers: false });
    const c = meta.common;
    const pic = mm.selectCover(c.picture);
    return {
      title: c.title || undefined,
      artist: c.artist || c.albumartist || undefined,
      album: c.album || undefined,
      genre: c.genre?.[0] || undefined,
      year: c.year || undefined,
      bpm: c.bpm && c.bpm > 40 && c.bpm < 250 ? c.bpm : undefined,
      key: c.key || undefined,
      duration: meta.format.duration,
      picture: pic ? new Blob([pic.data as Uint8Array<ArrayBuffer>], { type: pic.format }) : undefined,
    };
  } catch {
    return {};
  }
}
