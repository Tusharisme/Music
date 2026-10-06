/**
 * Real-input FFT (size N, power of two) computed via an N/2 complex FFT.
 * Allocation-free after construction, so it can be reused across thousands of frames.
 */
export class RealFFT {
  readonly size: number;
  private readonly half: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly rev: Uint32Array;
  private readonly cosT: Float64Array;
  private readonly sinT: Float64Array;
  private readonly cosN: Float64Array;
  private readonly sinN: Float64Array;

  constructor(size: number) {
    if (size < 4 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two ≥ 4');
    this.size = size;
    const h = size >> 1;
    this.half = h;
    this.re = new Float64Array(h);
    this.im = new Float64Array(h);
    this.rev = new Uint32Array(h);
    const bits = Math.log2(h);
    for (let i = 0; i < h; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cosT = new Float64Array(h / 2 || 1);
    this.sinT = new Float64Array(h / 2 || 1);
    for (let i = 0; i < h / 2; i++) {
      this.cosT[i] = Math.cos((2 * Math.PI * i) / h);
      this.sinT[i] = -Math.sin((2 * Math.PI * i) / h);
    }
    this.cosN = new Float64Array(h + 1);
    this.sinN = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) {
      this.cosN[k] = Math.cos((2 * Math.PI * k) / size);
      this.sinN[k] = Math.sin((2 * Math.PI * k) / size);
    }
  }

  private complexFFT(): void {
    const { re, im, rev, half } = this;
    for (let i = 0; i < half; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= half; len <<= 1) {
      const hl = len >> 1;
      const step = half / len;
      for (let i = 0; i < half; i += len) {
        for (let k = 0; k < hl; k++) {
          const wr = this.cosT[k * step];
          const wi = this.sinT[k * step];
          const a = i + k;
          const b = a + hl;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /**
   * Magnitude spectrum of `input` (length N) into `out` (length N/2 + 1).
   * `window` (length N) is applied if given.
   */
  magnitudes(
    input: ArrayLike<number>,
    out: Float32Array | Float64Array,
    window?: Float32Array,
    offset = 0,
  ): void {
    const { re, im, half } = this;
    for (let k = 0; k < half; k++) {
      const i0 = offset + 2 * k;
      const a = input[i0] ?? 0;
      const b = input[i0 + 1] ?? 0;
      if (window) {
        re[k] = a * window[2 * k];
        im[k] = b * window[2 * k + 1];
      } else {
        re[k] = a;
        im[k] = b;
      }
    }
    this.complexFFT();
    out[0] = Math.abs(re[0] + im[0]);
    out[half] = Math.abs(re[0] - im[0]);
    for (let k = 1; k < half; k++) {
      const m = half - k;
      const zer = (re[k] + re[m]) * 0.5;
      const zei = (im[k] - im[m]) * 0.5;
      const zor = (im[k] + im[m]) * 0.5;
      const zoi = -(re[k] - re[m]) * 0.5;
      const c = this.cosN[k];
      const s = this.sinN[k];
      const xr = zer + c * zor + s * zoi;
      const xi = zei + c * zoi - s * zor;
      out[k] = Math.sqrt(xr * xr + xi * xi);
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
