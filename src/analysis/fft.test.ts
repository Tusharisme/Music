import { describe, expect, it } from 'vitest';
import { RealFFT } from './fft';

function naiveMag(x: Float64Array): Float64Array {
  const N = x.length;
  const out = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      re += x[n] * Math.cos((2 * Math.PI * k * n) / N);
      im -= x[n] * Math.sin((2 * Math.PI * k * n) / N);
    }
    out[k] = Math.hypot(re, im);
  }
  return out;
}

describe('RealFFT', () => {
  it.each([8, 64, 512])('matches a naive DFT (N=%i)', (N) => {
    const x = new Float64Array(N);
    let s = 1;
    for (let i = 0; i < N; i++) {
      s = (s * 16807) % 2147483647;
      x[i] = s / 2147483647 - 0.5;
    }
    const fft = new RealFFT(N);
    const out = new Float64Array(N / 2 + 1);
    fft.magnitudes(x, out);
    const ref = naiveMag(x);
    for (let k = 0; k <= N / 2; k++) expect(out[k]).toBeCloseTo(ref[k], 6);
  });

  it('finds a sine peak in the right bin', () => {
    const N = 1024;
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * 37 * i) / N);
    const out = new Float64Array(N / 2 + 1);
    new RealFFT(N).magnitudes(x, out);
    let best = 0;
    for (let k = 1; k <= N / 2; k++) if (out[k] > out[best]) best = k;
    expect(best).toBe(37);
    expect(out[37]).toBeCloseTo(N / 2, 3);
  });
});
