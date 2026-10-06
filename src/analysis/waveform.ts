import type { WaveformData } from '../types';

export const WAVEFORM_PPS = 150;

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(type: 'lowpass' | 'highpass', freq: number, sr: number, q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    if (type === 'lowpass') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = (1 - cos) / 2 / a0;
    } else {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = (1 + cos) / 2 / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * Three-band waveform at 150 points/second: peak amplitude plus low (<250 Hz),
 * mid and high (>2.5 kHz) RMS, each quantised to 0..255.
 */
export function computeWaveform(x: Float32Array, sr: number): WaveformData {
  const hop = sr / WAVEFORM_PPS;
  const n = Math.max(1, Math.ceil(x.length / hop));
  const peak = new Float32Array(n);
  const low = new Float32Array(n);
  const mid = new Float32Array(n);
  const high = new Float32Array(n);
  const lp1 = new Biquad('lowpass', 250, sr);
  const lp2 = new Biquad('lowpass', 250, sr);
  const hp1 = new Biquad('highpass', 2500, sr);
  const hp2 = new Biquad('highpass', 2500, sr);

  let idx = 0;
  let next = hop;
  let pk = 0;
  let sl = 0;
  let sm = 0;
  let sh = 0;
  let cnt = 0;
  const flush = () => {
    if (idx >= n) return;
    peak[idx] = pk;
    low[idx] = Math.sqrt(sl / Math.max(1, cnt));
    mid[idx] = Math.sqrt(sm / Math.max(1, cnt));
    high[idx] = Math.sqrt(sh / Math.max(1, cnt));
    idx++;
    pk = sl = sm = sh = 0;
    cnt = 0;
  };
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const l = lp2.step(lp1.step(v));
    const h = hp2.step(hp1.step(v));
    const m = v - l - h;
    const a = v < 0 ? -v : v;
    if (a > pk) pk = a;
    sl += l * l;
    sm += m * m;
    sh += h * h;
    cnt++;
    if (i + 1 >= next) {
      flush();
      next += hop;
    }
  }
  if (cnt) flush();

  const q = (arr: Float32Array, scale: number, gamma: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      out[i] = Math.min(255, Math.round(255 * Math.pow(Math.min(1, arr[i] * scale), gamma)));
    return out;
  };
  const maxOf = (arr: Float32Array) => {
    // 99.9th percentile style max that ignores single-sample spikes.
    const sorted = Float32Array.from(arr).sort();
    return sorted[Math.floor(sorted.length * 0.999)] || 1e-9;
  };
  const pMax = maxOf(peak);
  const bandMax = Math.max(maxOf(low), maxOf(mid), maxOf(high) * 1.6);
  return {
    pointsPerSecond: WAVEFORM_PPS,
    peak: q(peak, 1 / pMax, 0.85),
    low: q(low, 1 / bandMax, 0.7),
    mid: q(mid, 1 / bandMax, 0.7),
    high: q(high, 1.6 / bandMax, 0.7),
  };
}
