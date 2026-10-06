import { RealFFT, hann } from './fft';

export interface SpectralResult {
  /** Frames per second of the envelopes below. */
  fps: number;
  /** Seconds between the start of the signal and frame 0's centre. */
  frameOffset: number;
  /** Full-band SuperFlux onset strength. */
  onset: Float32Array;
  /** Onset strength restricted to the bass/kick region (< ~170 Hz). */
  onsetLow: Float32Array;
  /** Onset strength below ~4 kHz (kicks + snares, ignores hi-hats). */
  onsetMid: Float32Array;
  /** Onset strength above ~4 kHz (hi-hats, shakers, rides). */
  onsetHigh: Float32Array;
  /** Frame RMS. */
  rms: Float32Array;
  centroidMean: number;
  centroidStd: number;
  flatnessMean: number;
  /** Mean MFCC c1..c12 and their std devs. */
  mfccMean: number[];
  mfccStd: number[];
  /** Mean log-energy share of 6 octave-ish bands. */
  bandProfile: number[];
}

function melHz(m: number): number {
  return 700 * (Math.pow(10, m / 2595) - 1);
}
function hzMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}

function makeMelBank(nBins: number, sr: number, nFft: number, nMel: number, fMin: number, fMax: number) {
  const mMin = hzMel(fMin);
  const mMax = hzMel(fMax);
  const pts: number[] = [];
  for (let i = 0; i < nMel + 2; i++) pts.push(melHz(mMin + ((mMax - mMin) * i) / (nMel + 1)));
  const bin = (f: number) => (f * nFft) / sr;
  const filters: { start: number; weights: Float32Array }[] = [];
  for (let m = 0; m < nMel; m++) {
    const l = bin(pts[m]);
    const c = bin(pts[m + 1]);
    const r = bin(pts[m + 2]);
    const start = Math.max(0, Math.floor(l));
    const end = Math.min(nBins - 1, Math.ceil(r));
    const w = new Float32Array(end - start + 1);
    for (let k = start; k <= end; k++) {
      let v = 0;
      if (k >= l && k <= c) v = (k - l) / Math.max(1e-9, c - l);
      else if (k > c && k <= r) v = (r - k) / Math.max(1e-9, r - c);
      w[k - start] = Math.max(0, v);
    }
    filters.push({ start, weights: w });
  }
  return filters;
}

/** One STFT pass over a mono signal producing everything the analyzers need. */
export function spectralAnalysis(x: Float32Array, sr: number): SpectralResult {
  const N = sr > 32000 ? 2048 : 1024;
  const H = N / 4;
  const fft = new RealFFT(N);
  const win = hann(N);
  const nBins = N / 2 + 1;
  const nFrames = Math.max(1, Math.floor((x.length - N) / H) + 1);
  const mag = new Float32Array(nBins);
  let prevLog = new Float32Array(nBins);
  let curLog = new Float32Array(nBins);
  const onset = new Float32Array(nFrames);
  const onsetLow = new Float32Array(nFrames);
  const onsetMid = new Float32Array(nFrames);
  const onsetHigh = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);

  const binHz = sr / N;
  const maxBin = Math.min(nBins - 1, Math.floor(11000 / binHz));
  const lowMaxBin = Math.max(2, Math.floor(170 / binHz));
  const midMaxBin = Math.min(maxBin, Math.floor(4000 / binHz));
  const norm = 4 / N;

  const nMel = 26;
  const mel = makeMelBank(nBins, sr, N, nMel, 30, Math.min(8000, sr / 2 - 100));
  const melE = new Float64Array(nMel);
  const nCep = 13;
  const dct: Float64Array[] = [];
  for (let c = 0; c < nCep; c++) {
    const row = new Float64Array(nMel);
    for (let m = 0; m < nMel; m++) row[m] = Math.cos((Math.PI * c * (m + 0.5)) / nMel);
    dct.push(row);
  }
  const cepSum = new Float64Array(nCep);
  const cepSq = new Float64Array(nCep);
  let cepFrames = 0;

  const bandEdges = [30, 120, 400, 1200, 3000, 6000, 11000];
  const bandSum = new Float64Array(bandEdges.length - 1);
  let centSum = 0;
  let centSq = 0;
  let flatSum = 0;
  let featFrames = 0;

  for (let f = 0; f < nFrames; f++) {
    const off = f * H;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = x[off + i] ?? 0;
      e += v * v;
    }
    rms[f] = Math.sqrt(e / N);

    fft.magnitudes(x, mag, win, off);
    for (let k = 0; k <= maxBin; k++) curLog[k] = Math.log1p(100 * mag[k] * norm);

    if (f > 0) {
      let sf = 0;
      let sfl = 0;
      let sfm = 0;
      for (let k = 1; k <= maxBin; k++) {
        const ref = Math.max(prevLog[k - 1], prevLog[k], prevLog[k + 1] ?? prevLog[k]);
        const d = curLog[k] - ref;
        if (d > 0) {
          sf += d;
          if (k <= lowMaxBin) sfl += d;
          if (k <= midMaxBin) sfm += d;
        }
      }
      onset[f] = sf;
      onsetLow[f] = sfl;
      onsetMid[f] = sfm;
      onsetHigh[f] = sf - sfm;
    }
    const t = prevLog;
    prevLog = curLog;
    curLog = t;

    // Timbre features on every 4th frame (plenty for summary statistics).
    if (f % 4 === 0 && rms[f] > 1e-3) {
      let num = 0;
      let den = 0;
      let logSum = 0;
      let lin = 0;
      for (let k = 1; k <= maxBin; k++) {
        const p = mag[k] * mag[k] + 1e-12;
        num += k * binHz * mag[k];
        den += mag[k];
        logSum += Math.log(p);
        lin += p;
      }
      const centroid = den > 0 ? num / den : 0;
      centSum += centroid;
      centSq += centroid * centroid;
      flatSum += Math.exp(logSum / maxBin) / (lin / maxBin);

      for (let m = 0; m < nMel; m++) {
        const { start, weights } = mel[m];
        let s = 0;
        for (let i = 0; i < weights.length; i++) s += weights[i] * mag[start + i] * mag[start + i];
        melE[m] = Math.log(s * norm * norm + 1e-10);
      }
      for (let c = 1; c < nCep; c++) {
        let s = 0;
        const row = dct[c];
        for (let m = 0; m < nMel; m++) s += row[m] * melE[m];
        cepSum[c] += s;
        cepSq[c] += s * s;
      }
      cepFrames++;

      let tot = 0;
      const be = new Float64Array(bandSum.length);
      for (let b = 0; b < be.length; b++) {
        const k0 = Math.max(1, Math.floor(bandEdges[b] / binHz));
        const k1 = Math.min(maxBin, Math.floor(bandEdges[b + 1] / binHz));
        for (let k = k0; k <= k1; k++) be[b] += mag[k] * mag[k];
        tot += be[b];
      }
      for (let b = 0; b < be.length; b++) bandSum[b] += tot > 0 ? be[b] / tot : 0;
      featFrames++;
    }
  }

  const mfccMean: number[] = [];
  const mfccStd: number[] = [];
  for (let c = 1; c < nCep; c++) {
    const m = cepFrames ? cepSum[c] / cepFrames : 0;
    mfccMean.push(m);
    mfccStd.push(cepFrames ? Math.sqrt(Math.max(0, cepSq[c] / cepFrames - m * m)) : 0);
  }
  const cMean = featFrames ? centSum / featFrames : 0;
  return {
    fps: sr / H,
    frameOffset: N / 2 / sr,
    onset,
    onsetLow,
    onsetMid,
    onsetHigh,
    rms,
    centroidMean: cMean,
    centroidStd: featFrames ? Math.sqrt(Math.max(0, centSq / featFrames - cMean * cMean)) : 0,
    flatnessMean: featFrames ? flatSum / featFrames : 0,
    mfccMean,
    mfccStd,
    bandProfile: Array.from(bandSum, (v) => (featFrames ? v / featFrames : 0)),
  };
}
