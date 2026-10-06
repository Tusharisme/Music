import { useEffect, useState } from 'react';
import type { TrackRecord } from '../types';
import { artworkUrl } from '../state/library';
import { demoColor } from '../library/demoLibrary';

function initials(t: TrackRecord): string {
  return t.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Cover art: embedded artwork for files, a generated gradient "label" otherwise. */
export function Artwork({
  track,
  size = 40,
  className = '',
  round = false,
}: {
  track: TrackRecord | undefined;
  size?: number;
  className?: string;
  round?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (track?.artworkKey) void artworkUrl(track).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [track?.artworkKey, track]);

  const style = { width: size, height: size, borderRadius: round ? '50%' : Math.max(4, size * 0.16) };
  if (!track) return <div className={`artwork is-empty ${className}`} style={style} />;
  if (url) return <img className={`artwork ${className}`} src={url} alt="" style={style} draggable={false} />;
  const color =
    track.source.kind === 'demo'
      ? demoColor(track.source.recipeId)
      : `hsl(${hashHue(track.title + track.artist)} 70% 60%)`;
  return (
    <div
      className={`artwork is-gen ${className}`}
      style={{ ...style, ['--art' as string]: color, fontSize: Math.max(9, size * 0.32) }}
      aria-hidden
    >
      <span>{initials(track)}</span>
    </div>
  );
}
