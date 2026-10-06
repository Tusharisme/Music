/**
 * PCM storage for a deck. Audio is kept as 16-bit integers (half the memory of
 * Float32 – important on phones) and read through a loop-aware accessor so every
 * consumer (direct playback, time-stretcher, slip/roll) sees seamless loops.
 */

export const INT16_SCALE = 1 / 32768;

/** Convert float samples (-1..1) to Int16 with clipping. */
export function floatToInt16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    out[i] = s >= 1 ? 32767 : s <= -1 ? -32768 : Math.round(s * 32767);
  }
  return out;
}

export class PcmSource {
  readonly L: Int16Array;
  readonly R: Int16Array;
  readonly length: number;

  loopOn = false;
  loopStart = 0;
  loopEnd = 0;
  loopLen = 0;
  /** Length of the crossfade applied just before the loop end (in samples). */
  private xf = 0;

  constructor(L: Int16Array, R: Int16Array) {
    this.L = L;
    this.R = R;
    this.length = Math.min(L.length, R.length);
  }

  setLoop(start: number, end: number): void {
    const s = Math.max(0, Math.floor(start));
    const e = Math.min(this.length, Math.floor(end));
    this.loopStart = s;
    this.loopEnd = e;
    this.loopLen = e - s;
    this.loopOn = this.loopLen > 64;
    // Crossfade the loop tail into the audio that precedes the loop start, so a
    // contiguous read across loopEnd → loopStart is continuous.
    this.xf = Math.max(0, Math.min(256, Math.floor(this.loopLen / 4), s));
  }

  clearLoop(): void {
    this.loopOn = false;
  }

  private raw(ch: Int16Array, i: number): number {
    return i >= 0 && i < this.length ? ch[i] * INT16_SCALE : 0;
  }

  /** Loop-aware read of an integer sample index. */
  at(ch: Int16Array, i: number): number {
    if (this.loopOn && i >= this.loopEnd - this.xf) {
      if (i >= this.loopEnd) i = this.loopStart + ((i - this.loopStart) % this.loopLen);
      if (this.xf > 0 && i >= this.loopEnd - this.xf) {
        const w = (i - (this.loopEnd - this.xf) + 0.5) / this.xf;
        return this.raw(ch, i) * (1 - w) + this.raw(ch, i - this.loopLen) * w;
      }
    }
    return this.raw(ch, i);
  }

  /** 4-point cubic Hermite interpolation at a fractional position. */
  interp(ch: Int16Array, pos: number): number {
    const i = Math.floor(pos);
    const t = pos - i;
    const xm1 = this.at(ch, i - 1);
    const x0 = this.at(ch, i);
    const x1 = this.at(ch, i + 1);
    const x2 = this.at(ch, i + 2);
    return hermite(xm1, x0, x1, x2, t);
  }
}

/** 4-point, 3rd-order Hermite (x-form) interpolation. */
export function hermite(xm1: number, x0: number, x1: number, x2: number, t: number): number {
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const bNeg = w + a;
  return ((a * t - bNeg) * t + c) * t + x0;
}
