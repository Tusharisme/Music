import { hermite, type PcmSource } from './pcm';

/**
 * WSOLA time-stretcher ("key lock" / master tempo).
 *
 * The output is assembled from ~70 ms segments of the source played at natural
 * speed. Each new segment is taken from the position the deck's musical clock
 * says we should be at, refined by a ±15 ms waveform-similarity search so it
 * splices onto the previous segment without phasing, then cross-faded over 10 ms.
 * Segments go into a small FIFO which is read back through a cubic resampler,
 * which is how key shift (pitch ≠ 1) is implemented: stretch by tempo/pitch, then
 * resample by pitch.
 *
 * At tempo 1 / pitch 1 the search lands on the natural continuation and the
 * crossfade blends identical signals, so the output is bit-for-bit the source.
 */
export class Stretcher {
  readonly S: number; // segment (sequence) length
  readonly O: number; // overlap length
  readonly W: number; // search radius

  private readonly midL: Float32Array;
  private readonly midR: Float32Array;
  private readonly midM: Float32Array;
  private midEnergy = 0;
  private readonly segL: Float32Array;
  private readonly segR: Float32Array;
  private readonly scr: Float32Array;
  private readonly pe: Float64Array;
  private readonly fade: Float32Array;

  private readonly cap: number;
  private readonly fifoL: Float32Array;
  private readonly fifoR: Float32Array;
  private fifoEnd = 0;
  private rp = 0;
  private needsInit = true;

  constructor(sampleRate: number) {
    this.S = Math.round(0.07 * sampleRate);
    this.O = Math.round(0.01 * sampleRate);
    this.W = Math.round(0.015 * sampleRate);
    this.midL = new Float32Array(this.O);
    this.midR = new Float32Array(this.O);
    this.midM = new Float32Array(this.O);
    this.segL = new Float32Array(this.S);
    this.segR = new Float32Array(this.S);
    this.scr = new Float32Array(2 * this.W + this.O);
    this.pe = new Float64Array(2 * this.W + this.O + 1);
    this.fade = new Float32Array(this.O);
    for (let i = 0; i < this.O; i++) this.fade[i] = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / this.O);
    this.cap = 4 * this.S + 16;
    this.fifoL = new Float32Array(this.cap);
    this.fifoR = new Float32Array(this.cap);
  }

  /** Forget all state; the next frame starts exactly at the clock position. */
  reset(): void {
    this.needsInit = true;
    this.fifoEnd = 0;
    this.rp = 0;
  }

  /** Number of stretched samples buffered ahead of the read head. */
  get buffered(): number {
    return Math.max(0, this.fifoEnd - this.rp);
  }

  /**
   * Produce one stereo frame into out[0], out[1].
   * @param clockPos deck musical position (source samples)
   * @param tempo source samples per output frame (> 0)
   * @param pitch pitch ratio (1 = original pitch)
   */
  next(src: PcmSource, clockPos: number, tempo: number, pitch: number, out: Float32Array): void {
    while (Math.floor(this.rp) + 3 >= this.fifoEnd) {
      const lead = (tempo * Math.max(0, this.fifoEnd - this.rp)) / pitch;
      if (this.needsInit) {
        this.appendSegment(src, clockPos + lead, true);
        this.needsInit = false;
      } else {
        // Centre the segment on the clock so the average timing error is zero.
        const centre = ((this.S - this.O) * (tempo / pitch - 1)) / 2;
        this.appendSegment(src, clockPos + lead + centre, false);
      }
    }

    const rp = this.rp;
    const i = Math.floor(rp);
    const t = rp - i;
    if (t === 0) {
      out[0] = this.fifoL[i];
      out[1] = this.fifoR[i];
    } else {
      const im1 = i > 0 ? i - 1 : 0;
      out[0] = hermite(this.fifoL[im1], this.fifoL[i], this.fifoL[i + 1], this.fifoL[i + 2], t);
      out[1] = hermite(this.fifoR[im1], this.fifoR[i], this.fifoR[i + 1], this.fifoR[i + 2], t);
    }
    this.rp = rp + pitch;
  }

  private compact(): void {
    const keepFrom = Math.max(0, Math.floor(this.rp) - 1);
    if (keepFrom === 0) return;
    this.fifoL.copyWithin(0, keepFrom, this.fifoEnd);
    this.fifoR.copyWithin(0, keepFrom, this.fifoEnd);
    this.fifoEnd -= keepFrom;
    this.rp -= keepFrom;
  }

  private appendSegment(src: PcmSource, nominal: number, first: boolean): void {
    const { S, O } = this;
    const P = Math.round(nominal);
    const start = first ? P : P + this.seek(src, P);

    for (let i = 0; i < S; i++) {
      this.segL[i] = src.at(src.L, start + i);
      this.segR[i] = src.at(src.R, start + i);
    }
    if (first) {
      this.midL.set(this.segL.subarray(0, O));
      this.midR.set(this.segR.subarray(0, O));
    }
    for (let i = 0; i < O; i++) {
      const w = this.fade[i];
      this.segL[i] = this.midL[i] * (1 - w) + this.segL[i] * w;
      this.segR[i] = this.midR[i] * (1 - w) + this.segR[i] * w;
    }

    const n = S - O;
    if (this.fifoEnd + n > this.cap) this.compact();
    this.fifoL.set(this.segL.subarray(0, n), this.fifoEnd);
    this.fifoR.set(this.segR.subarray(0, n), this.fifoEnd);
    this.fifoEnd += n;

    // The untouched tail becomes the reference for the next splice.
    this.midL.set(this.segL.subarray(n, S));
    this.midR.set(this.segR.subarray(n, S));
    let e = 0;
    for (let i = 0; i < O; i++) {
      const m = (this.midL[i] + this.midR[i]) * 0.5;
      this.midM[i] = m;
      if ((i & 1) === 0) e += m * m;
    }
    this.midEnergy = e;
  }

  /** Find the offset in [-W, W] whose source best continues the previous segment. */
  private seek(src: PcmSource, P: number): number {
    const { W, O } = this;
    if (this.midEnergy < 1e-10) return 0;
    const n = 2 * W + O;
    const base = P - W;
    const scr = this.scr;
    const pe = this.pe;
    pe[0] = 0;
    for (let j = 0; j < n; j++) {
      const m = (src.at(src.L, base + j) + src.at(src.R, base + j)) * 0.5;
      scr[j] = m;
      pe[j + 1] = pe[j] + m * m;
    }

    const score = (j: number): number => {
      let c = 0;
      const mid = this.midM;
      for (let i = 0; i < O; i += 2) c += mid[i] * scr[j + i];
      const e = (pe[j + O] - pe[j]) * 0.5;
      const d = (j - W) / W;
      return c / Math.sqrt(e * this.midEnergy + 1e-12) - 0.02 * d * d;
    };

    let bestJ = W;
    let best = -Infinity;
    for (let j = 0; j <= 2 * W; j += 4) {
      const s = score(j);
      if (s > best) {
        best = s;
        bestJ = j;
      }
    }
    const lo = Math.max(0, bestJ - 3);
    const hi = Math.min(2 * W, bestJ + 3);
    for (let j = lo; j <= hi; j++) {
      const s = score(j);
      if (s > best) {
        best = s;
        bestJ = j;
      }
    }
    return bestJ - W;
  }
}
