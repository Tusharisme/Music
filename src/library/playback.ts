import type { TrackRecord } from '../types';
import type { DemoRenderRequest, DemoRenderResponse } from './demo/demo.worker';
import { floatToInt16 } from '../audio/dsp/pcm';
import { blobsDb, pcmCache } from './db';
import { decodeForPlayback } from './decode';
import { WorkerPool } from './pool';

export interface PlaybackPcm {
  L: Int16Array;
  R: Int16Array;
  sampleRate: number;
  duration: number;
}

const demoPool = new WorkerPool<DemoRenderRequest, DemoRenderResponse>(
  () => new Worker(new URL('./demo/demo.worker.ts', import.meta.url), { type: 'module' }),
  2,
);

const inflight = new Map<string, Promise<PlaybackPcm>>();

async function renderDemo(recipeId: string, sampleRate: number): Promise<PlaybackPcm> {
  const key = `${recipeId}@${sampleRate}`;
  const cached = await pcmCache.get(key).catch(() => undefined);
  if (cached) return { L: cached.L, R: cached.R, sampleRate: cached.sampleRate, duration: cached.duration };
  const res = await demoPool.run({ id: key, recipeId, sampleRate });
  if (!res.ok) throw new Error(res.error);
  const pcm = { L: res.L, R: res.R, sampleRate: res.sampleRate, duration: res.duration };
  void pcmCache.put(key, pcm).catch(() => {});
  return pcm;
}

/**
 * Fetch or synthesise a track's audio at the engine's sample rate, as 16-bit PCM.
 * Every caller gets its own copy, because the caller transfers it to the audio thread.
 */
export function loadPlaybackPcm(track: TrackRecord, ctx: BaseAudioContext): Promise<PlaybackPcm> {
  const key = `${track.id}@${ctx.sampleRate}`;
  const copy = (p: PlaybackPcm): PlaybackPcm => ({ ...p, L: p.L.slice(), R: p.R.slice() });
  const existing = inflight.get(key);
  if (existing) return existing.then(copy);
  const p = (async () => {
    if (track.source.kind === 'demo') return renderDemo(track.source.recipeId, ctx.sampleRate);
    const blob = await blobsDb.get(track.source.blobKey);
    if (!blob) throw new Error('Audio file missing from the library');
    const buf = await decodeForPlayback(blob, ctx);
    const L = floatToInt16(buf.getChannelData(0));
    const R = buf.numberOfChannels > 1 ? floatToInt16(buf.getChannelData(1)) : L.slice();
    return { L, R, sampleRate: buf.sampleRate, duration: buf.duration };
  })();
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key)).catch(() => {});
  return p.then(copy);
}

/** Warm the demo render cache in the background (e.g. for the AI's next pick). */
export function prefetchDemo(track: TrackRecord, sampleRate: number): void {
  if (track.source.kind !== 'demo') return;
  const key = `${track.id}@${sampleRate}`;
  if (inflight.has(key)) return;
  const p = renderDemo(track.source.recipeId, sampleRate);
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key)).catch(() => {});
}
