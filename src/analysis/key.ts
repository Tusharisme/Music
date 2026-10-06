import { RealFFT, hann } from './fft';
import type { MusicalKey } from '../types';

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyResult {
  key: MusicalKey;
  confidence: number;
  chroma: number[];
}

function pearson(a: number[], b: number[], rot: number): number {
  const n = 12;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[(i + rot) % n] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db + 1e-12);
}

function normalize(v: number[]): number[] {
  const s = v.reduce((p, c) => p + c, 0);
  return s > 0 ? v.map((x) => x / s) : v.slice();
}

/**
 * Key detection: spectral peaks (50 Hz – 2 kHz) are mapped to pitch classes after a
 * global tuning estimate, with the bass register weighted separately (EDM basslines
 * usually spell the root). The chroma is matched against 24 rotated key profiles.
 */
/**
 * Bass pitch-class energy at the start of each 4-bar phrase. Progressions in dance
 * music start on the tonic chord, so this separates relative major/minor pairs
 * (e.g. Am vs C) that share the same notes.
 */
function phraseStartBass(x: Float32Array, sr: number, bpm: number, firstBeat: number): number[] {
  const out = new Array(12).fill(0);
  let N = 4096;
  while (sr / N > 3 && N < 32768) N *= 2;
  const fft = new RealFFT(N);
  const win = hann(N);
  const mag = new Float64Array(N / 2 + 1);
  const binHz = sr / N;
  const phrase = (60 / bpm) * 16;
  for (let t = Math.max(0, firstBeat); t * sr + N < x.length; t += phrase) {
    fft.magnitudes(x, mag, win, Math.round(t * sr));
    for (let k = Math.max(1, Math.floor(38 / binHz)); k <= Math.ceil(200 / binHz); k++) {
      if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
      const midi = 69 + 12 * Math.log2((k * binHz) / 440);
      const r = Math.round(midi);
      out[((r % 12) + 12) % 12] += mag[k] * Math.cos(Math.PI * (midi - r)) ** 2;
    }
  }
  return out;
}

export function detectKey(x: Float32Array, sr: number, grid?: { bpm: number; firstBeat: number }): KeyResult {
  let N = 8192;
  while (sr / N > 3 && N < 32768) N *= 2;
  const hop = N / 2;
  const fft = new RealFFT(N);
  const win = hann(N);
  const nBins = N / 2 + 1;
  const mag = new Float64Array(nBins);
  const binHz = sr / N;
  const kMin = Math.max(2, Math.floor(50 / binHz));
  const kMax = Math.min(nBins - 2, Math.ceil(2000 / binHz));

  const midis: number[] = [];
  const weights: number[] = [];
  const nFrames = Math.max(0, Math.floor((x.length - N) / hop) + 1);

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    fft.magnitudes(x, mag, win, off);
    let frameMax = 0;
    for (let k = kMin; k <= kMax; k++) if (mag[k] > frameMax) frameMax = mag[k];
    if (frameMax < 1e-4) continue;
    const thr = frameMax * 0.05;
    for (let k = kMin; k <= kMax; k++) {
      const m = mag[k];
      if (m < thr || m <= mag[k - 1] || m < mag[k + 1]) continue;
      // Parabolic interpolation on log magnitude for the true peak frequency.
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(m + 1e-12);
      const c = Math.log(mag[k + 1] + 1e-12);
      const denom = a - 2 * b + c;
      const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const freq = (k + Math.max(-0.5, Math.min(0.5, delta))) * binHz;
      midis.push(69 + 12 * Math.log2(freq / 440));
      weights.push(m / frameMax);
    }
  }

  // Global tuning: circular mean of the deviation from equal temperament.
  let cs = 0;
  let sn = 0;
  for (let i = 0; i < midis.length; i++) {
    const d = midis[i] - Math.round(midis[i]);
    cs += weights[i] * Math.cos(2 * Math.PI * d);
    sn += weights[i] * Math.sin(2 * Math.PI * d);
  }
  const tuning = Math.atan2(sn, cs) / (2 * Math.PI);

  const treble = new Array(12).fill(0);
  const bass = new Array(12).fill(0);
  for (let i = 0; i < midis.length; i++) {
    const m = midis[i] - tuning;
    const r = Math.round(m);
    const d = m - r;
    const w = Math.cos(Math.PI * d) ** 2 * weights[i];
    const pc = ((r % 12) + 12) % 12;
    if (m < 55)
      bass[pc] += w; // below ~G3
    else treble[pc] += w;
  }
  const tN = normalize(treble);
  const bN = normalize(bass);
  const chroma = tN.map((v, i) => v + 0.6 * bN[i]);

  let bestScore = -Infinity;
  let second = -Infinity;
  let best: MusicalKey = { tonic: 0, mode: 'major' };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const s = pearson(chroma, mode === 'major' ? MAJOR : MINOR, tonic);
      if (s > bestScore) {
        second = bestScore;
        bestScore = s;
        best = { tonic, mode };
      } else if (s > second) {
        second = s;
      }
    }
  }
  // Relative major/minor disambiguation from the bass at phrase starts.
  if (grid && grid.bpm > 0) {
    const rel: MusicalKey =
      best.mode === 'minor'
        ? { tonic: (best.tonic + 3) % 12, mode: 'major' }
        : { tonic: (best.tonic + 9) % 12, mode: 'minor' };
    const relScore = pearson(chroma, rel.mode === 'major' ? MAJOR : MINOR, rel.tonic);
    if (bestScore - relScore < 0.15) {
      const bass = phraseStartBass(x, sr, grid.bpm, grid.firstBeat);
      if (bass[rel.tonic] > bass[best.tonic] * 1.3) {
        second = bestScore;
        bestScore = relScore;
        best = rel;
      }
    }
  }
  const confidence = Math.max(0, Math.min(1, (bestScore - second) * 4 + Math.max(0, bestScore) * 0.5));
  return { key: best, confidence, chroma };
}
