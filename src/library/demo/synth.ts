/** Small, allocation-light DSP toolkit for rendering the built-in demo tracks. */

export const TAU = Math.PI * 2;

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const SIN_N = 4096;
const SIN_T = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_T[i] = Math.sin((2 * Math.PI * i) / SIN_N);

/** Table sine; `cycles` is the phase in cycles (1 = 2π). */
export function fastSin(cycles: number): number {
  const x = (cycles - Math.floor(cycles)) * SIN_N;
  const i = x | 0;
  return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (x - i);
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Stereo {
  L: Float32Array;
  R: Float32Array;
}

export function stereo(len: number): Stereo {
  return { L: new Float32Array(len), R: new Float32Array(len) };
}

/** PolyBLEP correction for band-limited saw/square oscillators. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Topology-preserving-transform state variable filter (stable under modulation). */
export class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = 1.4;
  lp = 0;
  bp = 0;
  hp = 0;

  set(cutoff: number, q: number, sr: number): void {
    const g = Math.tan((Math.PI * Math.min(Math.max(cutoff, 10), sr * 0.45)) / sr);
    this.k = 1 / Math.max(0.3, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  run(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

/** Add a mono buffer into a stereo buffer at `start` with gain and equal-power pan (-1..1). */
export function place(dst: Stereo, src: Float32Array, start: number, gain: number, pan = 0): void {
  const a = ((pan + 1) * Math.PI) / 4;
  const gl = gain * Math.cos(a) * Math.SQRT2;
  const gr = gain * Math.sin(a) * Math.SQRT2;
  const s0 = Math.round(start);
  const n = Math.min(src.length, dst.L.length - s0);
  for (let i = Math.max(0, -s0); i < n; i++) {
    dst.L[s0 + i] += src[i] * gl;
    dst.R[s0 + i] += src[i] * gr;
  }
}

export function mixInto(dst: Stereo, src: Stereo, gain = 1, offset = 0): void {
  const n = Math.min(src.L.length, dst.L.length - offset);
  for (let i = 0; i < n; i++) {
    dst.L[offset + i] += src.L[i] * gain;
    dst.R[offset + i] += src.R[i] * gain;
  }
}

/** Freeverb-style stereo reverb (processes `src` and adds the wet signal into `dst`). */
export function reverb(
  src: Stereo,
  dst: Stereo,
  sr: number,
  opts: { size?: number; damp?: number; wet?: number } = {},
): void {
  // Above 32 kHz run the tank at half rate – reverb tails are dark anyway and it halves the cost.
  const decim = sr > 32000 ? 2 : 1;
  const rsr = sr / decim;
  const scale = rsr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const spread = 23;
  const room = 0.7 + 0.28 * (opts.size ?? 0.8);
  const damp = (opts.damp ?? 0.3) * 0.4;
  const wet = (opts.wet ?? 0.3) * 0.18;
  const N = src.L.length;
  const n = Math.floor(N / decim);
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let d = 0; d < decim; d++) v += src.L[i * decim + d] + src.R[i * decim + d];
    input[i] = v / (2 * decim);
  }
  const acc = new Float32Array(n);
  for (const side of [0, 1] as const) {
    acc.fill(0);
    for (const t of combT) {
      const buf = new Float32Array(Math.round((t + side * spread) * scale));
      const bl = buf.length;
      let idx = 0;
      let store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = input[i] + store * room;
        if (++idx >= bl) idx = 0;
        acc[i] += y;
      }
    }
    for (const t of apT) {
      const buf = new Float32Array(Math.round((t + side * spread) * scale));
      const bl = buf.length;
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[idx];
        const x = acc[i];
        buf[idx] = x + b * 0.5;
        acc[i] = b - x;
        if (++idx >= bl) idx = 0;
      }
    }
    const out = side === 0 ? dst.L : dst.R;
    if (decim === 1) {
      for (let i = 0; i < n; i++) out[i] += acc[i] * wet;
    } else {
      for (let i = 0; i < n - 1; i++) {
        const a = acc[i] * wet;
        const b = acc[i + 1] * wet;
        out[i * 2] += a;
        out[i * 2 + 1] += (a + b) * 0.5;
      }
    }
  }
}

/** Stereo ping-pong delay added into dst. */
export function pingPong(
  src: Stereo,
  dst: Stereo,
  sr: number,
  delaySec: number,
  feedback: number,
  wet: number,
): void {
  const d = Math.max(1, Math.round(delaySec * sr));
  const bufL = new Float32Array(d);
  const bufR = new Float32Array(d);
  let idx = 0;
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < src.L.length; i++) {
    const yl = bufL[idx];
    const yr = bufR[idx];
    lpL = lpL * 0.6 + yr * 0.4;
    lpR = lpR * 0.6 + yl * 0.4;
    bufL[idx] = (src.L[i] + src.R[i]) * 0.5 + lpL * feedback;
    bufR[idx] = lpR * feedback;
    if (++idx >= d) idx = 0;
    dst.L[i] += yl * wet;
    dst.R[i] += yr * wet;
  }
}

/** Kick-triggered gain envelope for sidechain "pumping". */
export function sidechainCurve(
  len: number,
  kicks: number[],
  sr: number,
  depth: number,
  release = 0.16,
): Float32Array {
  const g = new Float32Array(len).fill(1);
  const rel = release * sr;
  const shapeLen = Math.round(rel * 4);
  const shape = new Float32Array(shapeLen);
  for (let i = 0; i < shapeLen; i++) {
    const t = i / rel;
    shape[i] = 1 - depth * Math.exp(-t * t * 2.2);
  }
  const sorted = [...kicks].sort((a, b) => a - b);
  for (let k = 0; k < sorted.length; k++) {
    const s0 = Math.max(0, Math.round(sorted[k]));
    const next = k + 1 < sorted.length ? Math.round(sorted[k + 1]) : s0 + shapeLen;
    const end = Math.min(len, next, s0 + shapeLen);
    for (let i = s0; i < end; i++) {
      const v = shape[i - s0];
      if (v < g[i]) g[i] = v;
    }
  }
  return g;
}

export function applyGainCurve(buf: Stereo, curve: Float32Array): void {
  const n = Math.min(buf.L.length, curve.length);
  for (let i = 0; i < n; i++) {
    buf.L[i] *= curve[i];
    buf.R[i] *= curve[i];
  }
}

/** Time-varying low-pass (for filter sweeps) applied in place. cutoff(t) gets sample index. */
export function sweepFilter(
  buf: Stereo,
  start: number,
  end: number,
  sr: number,
  cutoffAt: (frac: number) => number,
  q = 0.9,
  mode: 'lp' | 'hp' = 'lp',
): void {
  const fl = new SVF();
  const fr = new SVF();
  const s0 = Math.max(0, start);
  const e0 = Math.min(buf.L.length, end);
  for (let i = s0; i < e0; i++) {
    if ((i - s0) % 32 === 0) {
      const c = cutoffAt((i - s0) / Math.max(1, e0 - s0));
      fl.set(c, q, sr);
      fr.set(c, q, sr);
    }
    fl.run(buf.L[i]);
    fr.run(buf.R[i]);
    buf.L[i] = mode === 'lp' ? fl.lp : fl.hp;
    buf.R[i] = mode === 'lp' ? fr.lp : fr.hp;
  }
}

/** Fast tanh (Padé approximation, exact to ~1e-3 and saturating beyond ±3). */
export function softClip(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** Soft-clip and normalise the master to a target peak. */
export function master(buf: Stereo, drive = 1.4, ceiling = 0.92): void {
  let peak = 0;
  const n = buf.L.length;
  for (let i = 0; i < n; i++) {
    const l = softClip(buf.L[i] * drive);
    const r = softClip(buf.R[i] * drive);
    buf.L[i] = l;
    buf.R[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const g = peak > 0 ? ceiling / peak : 1;
  for (let i = 0; i < n; i++) {
    buf.L[i] *= g;
    buf.R[i] *= g;
  }
}
