import type { SpectralResult } from './spectral';

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  /** A BPM from file tags: skip the global search and only refine around it. */
  hint?: number;
}

export interface TempoEstimate {
  bpm: number;
  confidence: number;
}

function onsetEnvelope(sp: SpectralResult): Float32Array {
  const n = sp.onset.length;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = sp.onset[i] + 1.5 * sp.onsetLow[i];
  // Remove the local mean (≈1 s) and keep positive deviations – emphasises onsets.
  const w = Math.max(3, Math.round(sp.fps * 0.5));
  const out = new Float32Array(n);
  let acc = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    acc += raw[i];
    pre[i + 1] = acc;
  }
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(n, i + w + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    const v = raw[i] - mean;
    out[i] = v > 0 ? v : 0;
    sq += out[i] * out[i];
  }
  const std = Math.sqrt(sq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

/**
 * Fold the hi-hat band at a (slow) beat period and compare the energy on the
 * 16th-note positions (¼, ¾ of the beat) with the off-beat 8th (½). The strongest
 * position itself is skipped – it is usually the snare/clap, not the hats.
 * Drum & bass at 174 read as 87 has hats on every 16th (ratio ≈ 1); hip-hop at 87
 * has them on the 8ths with at most quiet 16ths (ratio well below 1).
 */
function sixteenthRatio(env: Float32Array, fps: number, bpm: number): number {
  const B = 64;
  const P = (60 * fps) / bpm;
  const h = new Float64Array(B);
  let total = 0;
  for (let t = 0; t < env.length; t++) {
    const ph = t / P;
    h[Math.floor((ph - Math.floor(ph)) * B) % B] += env[t];
    total += env[t];
  }
  if (total <= 0) return 0;
  const around = (c: number) => {
    let v = 0;
    for (let d = -2; d <= 2; d++) v = Math.max(v, h[(((c + d) % B) + B) % B]);
    return v;
  };
  let p = 0;
  for (let i = 1; i < B; i++) if (h[i] > h[p]) p = i;
  const offbeat = around(p + B / 2);
  const sixteenths = around(p + B / 4) + around(p + (3 * B) / 4);
  return sixteenths / Math.max(1e-9, 2 * offbeat);
}

function interp(arr: Float64Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= arr.length) return 0;
  const t = x - i;
  return arr[i] * (1 - t) + arr[i + 1] * t;
}

/** Concentration of onset energy when folded at the beat period (higher = steadier tempo fit). */
function foldScore(env: Float32Array, fps: number, bpm: number, bins = 48): number {
  const P = (60 * fps) / bpm;
  const h = new Float64Array(bins);
  for (let t = 0; t < env.length; t++) {
    const v = env[t];
    if (v === 0) continue;
    const ph = t / P;
    h[Math.floor((ph - Math.floor(ph)) * bins) % bins] += v;
  }
  let s = 0;
  for (let b = 0; b < bins; b++) {
    const sm = (h[(b + bins - 1) % bins] + 2 * h[b] + h[(b + 1) % bins]) / 4;
    s += sm * sm;
  }
  return s;
}

export function estimateTempo(sp: SpectralResult, opts: TempoOptions = {}): TempoEstimate {
  const minBpm = opts.minBpm ?? 70;
  const maxBpm = opts.maxBpm ?? 180;
  const env = onsetEnvelope(sp);
  const fps = sp.fps;
  const T = env.length;
  if (T < fps * 4) return { bpm: 120, confidence: 0 };

  const lagMin = Math.floor((60 * fps) / 300);
  const lagMax = Math.min(T - 1, Math.ceil(((60 * fps) / 30) * 1.05));
  const acf = new Float64Array(lagMax + 2);
  for (let L = lagMin; L <= lagMax; L++) {
    let s = 0;
    for (let t = 0; t + L < T; t++) s += env[t] * env[t + L];
    acf[L] = s / (T - L);
  }

  let best = minBpm;
  let bestScore = -Infinity;
  let sum = 0;
  let count = 0;
  const hint = opts.hint && opts.hint >= 40 && opts.hint <= 250 ? opts.hint : 0;
  const lo = hint ? hint * 0.99 : minBpm;
  const hi = hint ? hint * 1.01 : maxBpm;
  for (let b = lo; b <= hi; b += hint ? 0.05 : 0.25) {
    const lag = (60 * fps) / b;
    const s = interp(acf, lag) + 0.35 * interp(acf, 2 * lag);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(b / 120) / 1.0, 2));
    const score = s * prior;
    sum += score;
    count++;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  const confidence = Math.max(0, Math.min(1, (bestScore / (sum / count) - 1) / 3));

  // Octave check for the ambiguous slow range (e.g. drum & bass read as 87 vs hip-hop at 87):
  // count hi-hat/shaker hits per beat. Busy tops (≥ 3 per slow beat) mean double time.
  if (!hint && best < 100 && best * 2 <= maxBpm && sixteenthRatio(sp.onsetHigh, fps, best) >= 0.6) best *= 2;

  // Fine search with the folding score (sensitive to tiny tempo errors over the whole track).
  let fine = best;
  let fineScore = -Infinity;
  for (let b = best * 0.985; b <= best * 1.015; b += 0.01) {
    const s = foldScore(env, fps, b);
    if (s > fineScore) {
      fineScore = s;
      fine = b;
    }
  }
  let finest = fine;
  for (let b = fine - 0.012; b <= fine + 0.012; b += 0.001) {
    const s = foldScore(env, fps, b, 96);
    if (s > fineScore) {
      fineScore = s;
      finest = b;
    }
  }
  // Produced dance music is almost always on an integer BPM.
  const rounded = Math.round(finest);
  if (
    Math.abs(finest - rounded) < 0.06 &&
    foldScore(env, fps, rounded, 96) >= 0.97 * foldScore(env, fps, finest, 96)
  ) {
    finest = rounded;
  }
  return { bpm: Math.round(finest * 100) / 100, confidence };
}

/** Fold an envelope at a period (in frames) into `bins` phase bins (circularly smoothed). */
function fold(env: ArrayLike<number>, period: number, bins: number): Float64Array {
  const h = new Float64Array(bins);
  for (let t = 0; t < env.length; t++) {
    const v = env[t];
    if (v === 0) continue;
    const ph = t / period;
    h[Math.floor((ph - Math.floor(ph)) * bins) % bins] += v;
  }
  const sm = new Float64Array(bins);
  for (let b = 0; b < bins; b++) sm[b] = h[(b + bins - 1) % bins] + 2 * h[b] + h[(b + 1) % bins];
  return sm;
}

function argmax(a: Float64Array): number {
  let bi = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
  return bi;
}

function mean(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / Math.max(1, a.length);
}

/**
 * Beat phase: the time (s) of a beat in [0, beatSec).
 * 1. Coarse: onsets below ~4 kHz (kicks and snares, not hi-hats) folded at the beat period.
 * 2. Fine: the sharpest broadband energy attack within ±30 ms of the coarse estimate,
 *    which marks the transient itself (pitch-swept kicks peak late in the low band).
 */
export function estimateBeatPhase(x: Float32Array, sr: number, bpm: number, sp: SpectralResult): number {
  const beatSec = 60 / bpm;
  const P = (60 * sp.fps) / bpm;
  const B = 96;
  // Kick band + everything below 4 kHz (kicks, snares, claps), each normalised: the
  // beat is where both agree, which rejects off-beat basslines and hats.
  const low = fold(sp.onsetLow, P, B);
  const mid = fold(sp.onsetMid, P, B);
  const lowMax = Math.max(1e-9, ...low);
  const midMax = Math.max(1e-9, ...mid);
  const comb = new Float64Array(B);
  for (let b = 0; b < B; b++) comb[b] = low[b] / lowMax + mid[b] / midMax;
  const bin = argmax(comb);
  let phase = (bin / B) * beatSec + sp.frameOffset - 1 / sp.fps;

  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];
  const hop = Math.max(1, Math.round(sr / 700));
  const W = Math.max(hop, Math.round(0.004 * sr));
  const nE = Math.floor(x.length / hop);
  const rise = new Float32Array(nE);
  let prev = 0;
  for (let k = 0; k < nE; k++) {
    const end = k * hop;
    const start = Math.max(0, end - W);
    const e = end > start ? Math.sqrt((pre[end] - pre[start]) / (end - start)) : 0;
    const d = e - prev;
    rise[k] = d > 0 ? d : 0;
    prev = e;
  }
  const fineHop = hop / sr;
  const FB = Math.max(64, Math.round(beatSec / fineHop));
  const fh = fold(rise, beatSec / fineHop, FB);
  const centre = Math.round(((((phase / beatSec) % 1) + 1) % 1) * FB);
  const radius = Math.round(0.03 / fineHop);
  let best = -1;
  let bestV = 0;
  for (let d = -radius; d <= radius; d++) {
    const b = (((centre + d) % FB) + FB) % FB;
    if (fh[b] > bestV) {
      bestV = fh[b];
      best = b;
    }
  }
  if (best >= 0 && bestV > mean(fh) * 1.8) phase = (best / FB) * beatSec - fineHop * 1.5;
  return ((phase % beatSec) + beatSec) % beatSec;
}
