import type { MusicalKey, TrackAnalysis, TrackRecord } from '../types';
import { camelotLabel, transposeKey } from '../music/keys';
import { bestKeyShift, effectiveKey, harmonicCompat, type ShiftedMatch } from './harmonic';

export type Vibe = 'auto' | 'keep' | 'build' | 'cool' | 'switch';

export const VIBES: { id: Vibe; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Keep the flow, gently building' },
  { id: 'keep', label: 'Keep', hint: 'Hold the current energy' },
  { id: 'build', label: 'Build', hint: 'Lift the energy' },
  { id: 'cool', label: 'Cool down', hint: 'Bring the energy down' },
  { id: 'switch', label: 'Switch it up', hint: 'Change the sound, keep it mixable' },
];

export interface Weights {
  harmonic: number;
  tempo: number;
  energy: number;
  timbre: number;
}

export type MixStyle = 'balanced' | 'harmonic' | 'energy' | 'genre';

export const MIX_STYLES: Record<MixStyle, { label: string; weights: Weights }> = {
  balanced: { label: 'Balanced', weights: { harmonic: 0.32, tempo: 0.3, energy: 0.2, timbre: 0.18 } },
  harmonic: { label: 'Harmonic purist', weights: { harmonic: 0.5, tempo: 0.25, energy: 0.1, timbre: 0.15 } },
  energy: { label: 'Energy flow', weights: { harmonic: 0.2, tempo: 0.25, energy: 0.4, timbre: 0.15 } },
  genre: { label: 'Genre consistent', weights: { harmonic: 0.2, tempo: 0.25, energy: 0.15, timbre: 0.4 } },
};

export interface NowPlaying {
  track: TrackRecord;
  analysis: TrackAnalysis;
  /** Current playback rate of the deck. */
  rate: number;
  keyLock: boolean;
  keyShift: number;
}

export interface RecommendOptions {
  vibe: Vibe;
  weights: Weights;
  /** Track ids already loaded on decks. */
  exclude: Set<string>;
  /** Play history (most recent last). */
  history: string[];
  /** Allow suggesting a key shift to fix a clash. */
  allowKeyShift: boolean;
  /** Whether the incoming deck will run with key lock (otherwise tempo matching transposes it). */
  incomingKeyLock?: boolean;
  limit?: number;
}

export interface TempoFit {
  /** BPM the current deck is playing at. */
  targetBpm: number;
  /** Candidate BPM after half/double-time folding. */
  candidateBpm: number;
  /** Playback rate the candidate needs to match. */
  rate: number;
  /** |rate - 1| */
  stretch: number;
  multiplier: number;
  score: number;
}

export interface Suggestion {
  track: TrackRecord;
  analysis: TrackAnalysis;
  score: number;
  parts: Weights;
  harmonic: ShiftedMatch;
  tempo: TempoFit;
  energyDelta: number;
  similarity: number;
  reasons: string[];
  warnings: string[];
}

export function tempoFit(targetBpm: number, bpm: number): TempoFit {
  let best: TempoFit | null = null;
  for (const m of [1, 2, 0.5]) {
    const cand = bpm * m;
    const rate = targetBpm / cand;
    const stretch = Math.abs(rate - 1) + (m === 1 ? 0 : 0.02);
    if (!best || stretch < best.stretch)
      best = { targetBpm, candidateBpm: cand, rate, stretch, multiplier: m, score: 0 };
  }
  const b = best!;
  const pct = Math.abs(b.rate - 1);
  b.stretch = pct;
  if (pct <= 0.015) b.score = 1;
  else if (pct <= 0.06) b.score = 1 - ((pct - 0.015) / 0.045) * 0.4;
  else b.score = Math.max(0, 0.6 - (pct - 0.06) * 6);
  if (b.multiplier !== 1) b.score *= 0.9;
  return b;
}

export function energyScore(vibe: Vibe, dE: number): number {
  switch (vibe) {
    case 'keep':
      return Math.max(0, 1 - Math.abs(dE) / 3);
    case 'build':
      if (dE >= 1 && dE <= 2) return 1;
      if (dE === 3) return 0.75;
      if (dE === 0) return 0.55;
      if (dE > 3) return 0.4;
      return Math.max(0, 0.3 + dE * 0.1);
    case 'cool':
      if (dE <= -1 && dE >= -2) return 1;
      if (dE === -3) return 0.75;
      if (dE === 0) return 0.55;
      if (dE < -3) return 0.4;
      return Math.max(0, 0.3 - dE * 0.1);
    case 'switch':
      return Math.max(0, 1 - Math.abs(dE) / 4);
    case 'auto':
    default:
      if (dE === 0 || dE === 1) return 1;
      if (dE === 2 || dE === -1) return 0.75;
      return Math.max(0, 0.75 - (Math.abs(dE) - 1.5) * 0.25);
  }
}

/** z-score statistics over the library's timbre vectors. */
export function timbreStats(tracks: TrackAnalysis[]): { mean: number[]; std: number[] } {
  const dims = tracks[0]?.timbre.length ?? 0;
  const mean = new Array(dims).fill(0);
  const std = new Array(dims).fill(0);
  if (!tracks.length) return { mean, std };
  for (const t of tracks) t.timbre.forEach((v, i) => (mean[i] += v / tracks.length));
  for (const t of tracks) t.timbre.forEach((v, i) => (std[i] += (v - mean[i]) ** 2 / tracks.length));
  return { mean, std: std.map((v) => Math.sqrt(v) || 1) };
}

export function timbreSimilarity(a: number[], b: number[], stats: { mean: number[]; std: number[] }): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length, stats.mean.length);
  for (let i = 0; i < n; i++) {
    const x = (a[i] - stats.mean[i]) / stats.std[i];
    const y = (b[i] - stats.mean[i]) / stats.std[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0.5;
  const cos = dot / Math.sqrt(na * nb);
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export function trackKey(t: TrackRecord): MusicalKey | null {
  return t.keyOverride ?? t.analysis?.key ?? null;
}

export function trackBpm(t: TrackRecord): number {
  return t.gridOverride?.bpm ?? t.analysis?.beatgrid.bpm ?? 0;
}

/**
 * Rank the library for "what should I play next?" against the track that is
 * playing now: harmonic compatibility (Camelot), tempo fit (incl. half/double
 * time), energy direction and timbre similarity, with history penalties.
 */
export function recommend(now: NowPlaying, library: TrackRecord[], opts: RecommendOptions): Suggestion[] {
  const curKey = effectiveKey(trackKey(now.track) ?? now.analysis.key, now.rate, now.keyLock, now.keyShift);
  const curBpm = trackBpm(now.track) * now.rate;
  const analyzed = library.filter((t) => t.analysis);
  const stats = timbreStats(analyzed.map((t) => t.analysis!));
  const recent = opts.history.slice(-6);
  const w = opts.weights;
  const wSum = w.harmonic + w.tempo + w.energy + w.timbre || 1;

  const out: Suggestion[] = [];
  for (const t of analyzed) {
    if (t.id === now.track.id || opts.exclude.has(t.id)) continue;
    const a = t.analysis!;
    const key = trackKey(t) ?? a.key;
    const tempo = tempoFit(curBpm, trackBpm(t));
    // With key lock on the incoming deck its key stays put; without, tempo matching transposes it.
    const sounding =
      opts.incomingKeyLock === false ? transposeKey(key, Math.round(12 * Math.log2(tempo.rate))) : key;
    const harmonic: ShiftedMatch = opts.allowKeyShift
      ? bestKeyShift(curKey, sounding)
      : { ...harmonicCompat(curKey, sounding), shift: 0 };
    const dE = a.energy - now.analysis.energy;
    const sim = timbreSimilarity(now.analysis.timbre, a.timbre, stats);
    const parts: Weights = {
      harmonic: harmonic.score,
      tempo: tempo.score,
      energy: energyScore(opts.vibe, dE),
      timbre: opts.vibe === 'switch' ? 1 - sim * 0.8 : sim,
    };
    let score =
      (parts.harmonic * w.harmonic +
        parts.tempo * w.tempo +
        parts.energy * w.energy +
        parts.timbre * w.timbre) /
      wSum;

    const reasons: string[] = [];
    const warnings: string[] = [];
    if (harmonic.shift !== 0)
      reasons.push(
        `Key shift ${harmonic.shift > 0 ? '+' : ''}${harmonic.shift} → ${camelotLabel(transposeKey(key, harmonic.shift))}`,
      );
    if (harmonic.kind === 'clash') warnings.push(`Key clash ${camelotLabel(curKey)} → ${camelotLabel(key)}`);
    else reasons.push(harmonic.label);
    if (tempo.multiplier !== 1)
      reasons.push(
        `${tempo.multiplier === 2 ? 'Double' : 'Half'}-time ${Math.round(trackBpm(t))} ↔ ${Math.round(curBpm)}`,
      );
    else if (tempo.stretch <= 0.015) reasons.push(`Tempo match ${trackBpm(t).toFixed(0)} BPM`);
    else reasons.push(`${trackBpm(t).toFixed(1)} BPM (${pct(tempo.rate - 1)})`);
    if (tempo.stretch > 0.08) warnings.push(`Big tempo jump ${pct(tempo.rate - 1)}`);
    if (dE > 0) reasons.push(`Energy +${dE}`);
    else if (dE < 0) reasons.push(`Energy ${dE}`);
    else reasons.push('Same energy');
    if (sim > 0.72 && opts.vibe !== 'switch') reasons.push('Similar sound');
    if (opts.vibe === 'switch' && sim < 0.45) reasons.push('Fresh sound');

    if (recent.includes(t.id)) {
      score *= 0.15;
      warnings.push('Played recently');
    } else if (opts.history.includes(t.id)) {
      score *= 0.5;
      warnings.push('Already played');
    }
    if (t.artist && t.artist === now.track.artist && t.artist !== 'MixMind Studio') score *= 0.95;

    out.push({
      track: t,
      analysis: a,
      score: Math.round(score * 1000) / 10,
      parts,
      harmonic,
      tempo,
      energyDelta: dE,
      similarity: sim,
      reasons,
      warnings,
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, opts.limit ?? 12);
}
