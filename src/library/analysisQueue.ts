import type { TrackAnalysis, TrackRecord, WaveformData } from '../types';
import type { AnalyzeRequest, AnalyzeResponse } from '../analysis/analysis.worker';
import type { AnalyzeOptions } from '../analysis/analyze';
import { ANALYSIS_VERSION } from '../analysis/analyze';
import { parseKey } from '../music/keys';
import { blobsDb, waveformDb } from './db';
import { decodeForAnalysis } from './decode';
import { WorkerPool, hardwareThreads } from './pool';

export interface AnalysisDone {
  id: string;
  analysis: TrackAnalysis;
  waveform: WaveformData;
}

type Listener = {
  done?: (r: AnalysisDone) => void;
  failed?: (id: string, error: string) => void;
  state?: (pending: string[], active: string[]) => void;
};

const pool = new WorkerPool<AnalyzeRequest, AnalyzeResponse>(
  () => new Worker(new URL('../analysis/analysis.worker.ts', import.meta.url), { type: 'module' }),
  Math.min(3, Math.max(1, hardwareThreads() - 1)),
);

export const needsAnalysis = (t: TrackRecord): boolean =>
  !t.analysis || t.analysis.version !== ANALYSIS_VERSION;

class AnalysisQueue {
  private queue: TrackRecord[] = [];
  private active = new Set<string>();
  private listeners = new Set<Listener>();
  private concurrency = Math.min(3, Math.max(1, hardwareThreads() - 1));
  options: Pick<AnalyzeOptions, 'minBpm' | 'maxBpm'> & { trustTags?: boolean } = {
    minBpm: 70,
    maxBpm: 180,
    trustTags: true,
  };

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emitState(): void {
    const pending = this.queue.map((t) => t.id);
    const active = [...this.active];
    for (const l of this.listeners) l.state?.(pending, active);
  }

  enqueue(tracks: TrackRecord[], front = false): void {
    for (const t of tracks) {
      if (this.active.has(t.id) || this.queue.some((q) => q.id === t.id)) continue;
      if (front) this.queue.unshift(t);
      else this.queue.push(t);
    }
    this.emitState();
    this.pump();
  }

  /** Move a track to the front (e.g. it was just loaded onto a deck). */
  prioritize(id: string): void {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i > 0) {
      const [t] = this.queue.splice(i, 1);
      this.queue.unshift(t);
      this.emitState();
    }
  }

  isBusy(id: string): boolean {
    return this.active.has(id) || this.queue.some((t) => t.id === id);
  }

  private pump(): void {
    while (this.active.size < this.concurrency && this.queue.length) {
      const t = this.queue.shift()!;
      this.active.add(t.id);
      this.emitState();
      void this.run(t).finally(() => {
        this.active.delete(t.id);
        this.emitState();
        this.pump();
      });
    }
  }

  private async run(t: TrackRecord): Promise<void> {
    try {
      const opts: AnalyzeOptions = { minBpm: this.options.minBpm, maxBpm: this.options.maxBpm };
      if (this.options.trustTags) {
        if (t.tagBpm) opts.hintBpm = t.tagBpm;
        const k = parseKey(t.tagKey);
        if (k) opts.hintKey = k;
      }
      let res: AnalyzeResponse;
      if (t.source.kind === 'demo') {
        res = await pool.run({ id: t.id, kind: 'demo', recipeId: t.source.recipeId, options: opts });
      } else {
        const blob = await blobsDb.get(t.source.blobKey);
        if (!blob) throw new Error('Audio file missing from the library');
        const { channels, sampleRate } = await decodeForAnalysis(blob);
        const copies = channels.map((c) => c.slice());
        res = await pool.run(
          { id: t.id, kind: 'pcm', channels: copies, sampleRate, options: opts },
          copies.map((c) => c.buffer),
        );
      }
      if (!res.ok) throw new Error(res.error);
      const { analysis, waveform } = res.result;
      await waveformDb.put(t.id, waveform);
      for (const l of this.listeners) l.done?.({ id: t.id, analysis, waveform });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      for (const l of this.listeners) l.failed?.(t.id, msg);
    }
  }
}

export const analysisQueue = new AnalysisQueue();
