import { PcmSource } from './pcm';
import { Stretcher } from './stretcher';

/** Declick fade length (frames) for start/stop. */
const FADE_FRAMES = 64;
/** Crossfade length (frames) for jumps (hot cues, beat jumps, sync corrections). */
const XFADE_FRAMES = 256;

/**
 * One DJ deck's playback voice. Pure TypeScript (no Web Audio globals) so it can
 * run inside the AudioWorklet and be unit tested in Node.
 *
 * Positions are in source samples (float). Rates are playback-speed ratios
 * (1 = normal speed, negative = backwards).
 */
export class DeckVoice {
  readonly sr: number;
  src: PcmSource | null = null;
  srcRate: number;
  /** Source samples advanced per output frame at rate 1. */
  srScale = 1;
  length = 0;

  pos = 0;
  prevPos = 0;
  playing = false;
  /** Tempo ratio set by the pitch fader / sync. */
  tempo = 1;
  /** Temporary pitch bend (jog / nudge buttons). */
  bend = 0;
  private bendAge = 0;
  /** Phase-lock correction written by the sync engine. */
  syncAdj = 0;
  keyLock = false;
  keyShift = 0;
  pitchRatio = 1;
  /** Current smoothed rate. */
  rate = 0;

  scratching = false;
  private scratchTarget = 0;
  private scratchVel = 0;
  private scratchAge = 0;
  private wasPlayingBeforeScratch = false;

  /** 0 = none, 1 = brake (vinyl stop), 2 = spinback. */
  brakeMode: 0 | 1 | 2 = 0;
  private brakeRate = 0;
  private brakeStep = 0;
  reverse = false;

  slip = false;
  slipActive = false;
  slipPos = 0;

  gain = 0;
  private xfLeft = 0;
  private xfPos = 0;
  private xfRate = 0;
  private xfFromStretch = false;

  bpm = 0;
  /** Grid anchor in seconds. */
  firstBeat = 0;

  armed = false;
  armTrigger = -1;
  armPos = 0;

  private readonly stretcher: Stretcher;
  private inStretch = false;
  private readonly tmp = new Float32Array(2);
  private readonly aTempo: number;
  private readonly aScratch: number;

  /** Set when playback ran off the end of the track (consumed by the engine). */
  endedFlag = false;

  l = 0;
  r = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.srcRate = sampleRate;
    this.stretcher = new Stretcher(sampleRate);
    this.aTempo = 1 - Math.exp(-1 / (0.02 * sampleRate));
    this.aScratch = 1 - Math.exp(-1 / (0.0025 * sampleRate));
  }

  // ---------------------------------------------------------------- loading

  load(L: Int16Array, R: Int16Array, srcRate: number): void {
    this.src = new PcmSource(L, R);
    this.srcRate = srcRate;
    this.srScale = srcRate / this.sr;
    this.length = this.src.length;
    this.pos = 0;
    this.prevPos = 0;
    this.playing = false;
    this.scratching = false;
    this.brakeMode = 0;
    this.reverse = false;
    this.slipActive = false;
    this.gain = 0;
    this.rate = 0;
    this.xfLeft = 0;
    this.armed = false;
    this.inStretch = false;
    this.stretcher.reset();
  }

  unload(): void {
    this.src = null;
    this.length = 0;
    this.playing = false;
    this.gain = 0;
    this.armed = false;
  }

  setGrid(bpm: number, firstBeatSec: number): void {
    this.bpm = bpm > 0 ? bpm : 0;
    this.firstBeat = firstBeatSec;
  }

  // ------------------------------------------------------------- beat math

  /** Beat length in source samples (0 when there's no grid). */
  beatLen(): number {
    return this.bpm > 0 ? (60 / this.bpm) * this.srcRate : 0;
  }

  /** Continuous beat index at a source position (beat 0 = grid anchor, a downbeat). */
  beatAt(pos: number = this.pos): number {
    const bl = this.beatLen();
    return bl > 0 ? (pos - this.firstBeat * this.srcRate) / bl : 0;
  }

  /** Source position of a (fractional) beat index. */
  posOfBeat(beat: number): number {
    return this.firstBeat * this.srcRate + beat * this.beatLen();
  }

  /** Snap a position to the grid at the given beat resolution (1 = beats, 0.25 = 1/4 beats). */
  quantize(pos: number, resolution = 1, mode: 'round' | 'floor' = 'round'): number {
    if (this.bpm <= 0) return pos;
    const b = this.beatAt(pos) / resolution;
    const q = mode === 'floor' ? Math.floor(b + 1e-6) : Math.round(b);
    return this.posOfBeat(q * resolution);
  }

  // -------------------------------------------------------------- transport

  play(): void {
    if (!this.src) return;
    if (this.pos >= this.length - 1) return;
    this.playing = true;
    this.armed = false;
    this.brakeMode = 0;
    if (!this.scratching) this.rate = this.targetRate();
  }

  pause(): void {
    this.playing = false;
    this.armed = false;
    this.brakeMode = 0;
    if (this.slipActive) this.endSlip(false);
  }

  /** Start a vinyl-style stop over `seconds`. */
  brake(seconds: number): void {
    if (!this.playing) return;
    this.brakeMode = 1;
    this.brakeRate = this.rate || this.tempo;
    this.brakeStep = this.brakeRate / Math.max(1, seconds * this.sr);
  }

  /** Quick backwards spin that winds down to a stop. */
  spinback(seconds: number): void {
    if (!this.playing && this.gain === 0) return;
    this.brakeMode = 2;
    this.brakeRate = -3 * Math.max(0.5, this.tempo);
    this.brakeStep = -this.brakeRate / Math.max(1, seconds * this.sr);
  }

  setTempo(t: number): void {
    this.tempo = Math.max(0.05, Math.min(4, t));
    this.rampLeft = 0;
  }

  private rampLeft = 0;
  private rampStep = 0;

  /** Glide the tempo to `to` over `seconds` (used by tempo-ramp transitions). */
  rampTempo(to: number, seconds: number): void {
    const frames = Math.max(1, Math.round(seconds * this.sr));
    this.rampStep = (to - this.tempo) / frames;
    this.rampLeft = frames;
  }

  setKeyShift(semis: number): void {
    this.keyShift = semis;
    this.pitchRatio = Math.pow(2, semis / 12);
  }

  setBend(b: number): void {
    this.bend = Math.max(-0.9, Math.min(0.9, b));
    this.bendAge = 0;
  }

  /** Move the play head. With `smooth`, audible playback crossfades (declick). */
  jump(target: number, smooth = true): void {
    if (!this.src) return;
    const t = Math.max(0, Math.min(this.length - 1, target));
    if (smooth && this.gain > 0) {
      this.xfLeft = XFADE_FRAMES;
      this.xfPos = this.pos;
      this.xfRate = this.rate * this.srScale;
      this.xfFromStretch = false;
    }
    this.pos = t;
    this.prevPos = t;
    if (this.inStretch) this.stretcher.reset();
  }

  setLoop(start: number, end: number): void {
    if (!this.src) return;
    this.src.setLoop(start, end);
    if (this.src.loopOn && this.pos >= this.src.loopEnd) {
      // Loop set behind the play head ("reloop"): jump back into it, keeping phase.
      const len = this.src.loopLen;
      this.jump(this.src.loopStart + ((this.pos - this.src.loopStart) % len));
    }
  }

  clearLoop(): void {
    this.src?.clearLoop();
  }

  get loopOn(): boolean {
    return this.src?.loopOn ?? false;
  }

  // ------------------------------------------------------------------ slip

  beginSlip(): void {
    if (this.slipActive) return;
    this.slipActive = true;
    this.slipPos = this.pos;
  }

  /** End a slip action; optionally jump to where playback would have been. */
  endSlip(jumpBack = true): void {
    if (!this.slipActive) return;
    this.slipActive = false;
    if (jumpBack) this.jump(this.slipPos);
  }

  // --------------------------------------------------------------- scratch

  scratchStart(): void {
    if (!this.src) return;
    this.wasPlayingBeforeScratch = this.playing;
    this.scratching = true;
    this.scratchTarget = this.pos;
    this.scratchVel = 0;
    this.scratchAge = 0;
    this.brakeMode = 0;
    if (this.slip) this.beginSlip();
  }

  /** @param targetSec where the platter says the needle is; @param vel platter speed (rate units) */
  scratchMove(targetSec: number, vel: number): void {
    if (!this.scratching) return;
    this.scratchTarget = targetSec * this.srcRate;
    this.scratchVel = vel;
    this.scratchAge = 0;
  }

  scratchEnd(): void {
    if (!this.scratching) return;
    this.scratching = false;
    this.playing = this.wasPlayingBeforeScratch;
    if (this.slipActive) this.endSlip(true);
  }

  // -------------------------------------------------------------- render

  private targetRate(): number {
    if (this.reverse) return -this.tempo;
    return this.tempo + this.bend + this.syncAdj;
  }

  /** Render one stereo frame into this.l / this.r and advance. */
  renderFrame(): void {
    this.l = 0;
    this.r = 0;
    if (this.rampLeft > 0) {
      this.tempo += this.rampStep;
      this.rampLeft--;
    }
    const src = this.src;
    if (!src) return;

    const moving = this.playing || this.scratching || this.brakeMode !== 0;
    if (!moving && this.gain <= 0) {
      this.rate = 0;
      return;
    }

    // --- rate
    if (this.bend !== 0 && ++this.bendAge > this.sr * 0.25) this.bend = 0; // safety release
    if (this.scratching) {
      if (++this.scratchAge > this.sr * 0.06) this.scratchVel = 0;
      this.scratchTarget += this.scratchVel * this.srScale;
      const err = (this.scratchTarget - this.pos) / this.srScale;
      let want = this.scratchVel + err / (0.02 * this.sr);
      if (want > 10) want = 10;
      else if (want < -10) want = -10;
      this.rate += (want - this.rate) * this.aScratch;
    } else if (this.brakeMode !== 0) {
      this.brakeRate -= this.brakeStep;
      const done = this.brakeMode === 1 ? this.brakeRate <= 0 : this.brakeRate >= 0;
      if (done) {
        this.brakeMode = 0;
        this.playing = false;
        this.brakeRate = 0;
      }
      this.rate = this.brakeRate;
    } else if (this.playing) {
      const target = this.targetRate();
      const d = target - this.rate;
      this.rate = Math.abs(d) < 1e-6 ? target : this.rate + d * this.aTempo;
    }

    // --- gain (declick)
    const gTarget = this.playing || this.scratching || this.brakeMode !== 0 ? 1 : 0;
    if (this.gain < gTarget) this.gain = Math.min(1, this.gain + 1 / FADE_FRAMES);
    else if (this.gain > gTarget) this.gain = Math.max(0, this.gain - 1 / FADE_FRAMES);

    // --- mode
    const wantStretch =
      this.keyLock && !this.scratching && this.brakeMode === 0 && !this.reverse && this.rate > 0.05;
    if (wantStretch && !this.inStretch) {
      this.stretcher.reset();
      this.inStretch = true;
    } else if (!wantStretch && this.inStretch) {
      this.inStretch = false;
      this.xfLeft = XFADE_FRAMES;
      this.xfFromStretch = true;
      this.xfPos = this.pos;
      this.xfRate = this.rate * this.srScale;
    }

    const adv = this.rate * this.srScale;
    let l: number;
    let r: number;
    if (this.inStretch) {
      this.stretcher.next(src, this.pos, adv, this.pitchRatio * this.srScale, this.tmp);
      l = this.tmp[0];
      r = this.tmp[1];
    } else {
      l = src.interp(src.L, this.pos);
      r = src.interp(src.R, this.pos);
    }

    if (this.xfLeft > 0) {
      const w = this.xfLeft / XFADE_FRAMES;
      let ol: number;
      let or: number;
      if (this.xfFromStretch) {
        this.stretcher.next(
          src,
          this.xfPos,
          Math.max(0.05, this.xfRate),
          this.pitchRatio * this.srScale,
          this.tmp,
        );
        ol = this.tmp[0];
        or = this.tmp[1];
      } else {
        ol = src.interp(src.L, this.xfPos);
        or = src.interp(src.R, this.xfPos);
      }
      this.xfPos += this.xfRate;
      l = l * (1 - w) + ol * w;
      r = r * (1 - w) + or * w;
      this.xfLeft--;
    }

    const g = this.gain;
    this.l = l * g;
    this.r = r * g;

    // --- advance (also while fading out after a stop, so the fade isn't a held sample)
    this.prevPos = this.pos;
    let p = this.pos + adv;
    if (src.loopOn) {
      if (adv > 0 && p >= src.loopEnd && this.prevPos < src.loopEnd) {
        p = src.loopStart + ((p - src.loopStart) % src.loopLen);
      } else if (adv < 0 && p < src.loopStart && this.prevPos >= src.loopStart) {
        p += src.loopLen;
      }
    }
    if (p >= this.length - 1) {
      p = this.length - 1;
      if (this.playing && !this.scratching) {
        this.playing = false;
        this.endedFlag = true;
      }
    } else if (p < 0) {
      p = 0;
    }
    this.pos = p;
    if (this.slipActive && (this.playing || this.wasPlayingBeforeScratch)) {
      this.slipPos = Math.min(this.length - 1, this.slipPos + this.tempo * this.srScale);
    }
  }

  /** Called by the engine when an armed start fires. */
  fireArmed(): void {
    this.armed = false;
    this.play();
  }
}
