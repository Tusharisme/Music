/** Integrated loudness (ITU-R BS.1770 / EBU R128 style, gated) of a mono signal. */

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function kWeighting(sr: number): [Biquad, Biquad] {
  // Stage 1: high shelf (head acoustics).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: RLB high-pass.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * @param channels number of channels the mono signal was downmixed from
 *   (a (L+R)/2 downmix of correlated stereo is ~3 dB quieter than the stereo sum).
 */
export function integratedLoudness(x: Float32Array, sr: number, channels = 2): number {
  const [s1, s2] = kWeighting(sr);
  const y = filter(filter(x, s1), s2);
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const zs: number[] = [];
  const pre = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) pre[i + 1] = pre[i] + y[i] * y[i];
  for (let s = 0; s + block <= y.length; s += hop) zs.push((pre[s + block] - pre[s]) / block);
  if (!zs.length) return -70;
  const stereoGain = channels >= 2 ? 2 : 1;
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z * stereoGain + 1e-12);
  const abs = zs.filter((z) => lufs(z) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = lufs(meanAbs) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  const mean = gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length);
  return lufs(mean);
}
