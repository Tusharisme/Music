import {
  crossfaderGains,
  dbToGain,
  eqKnobToGain,
  faderToGain,
  filterKnob,
  trimKnobToDb,
  type CrossfaderCurve,
} from './curves';

const SMOOTH = 0.012;

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Butterworth Q expressed in dB, as the Web Audio low/high-pass filters expect. */
const BUTTERWORTH_DB = -3.0103;

function setParam(ctx: BaseAudioContext, p: AudioParam, v: number, tc = SMOOTH): void {
  p.setTargetAtTime(v, ctx.currentTime, tc);
}

export type EqBand = 'low' | 'mid' | 'high';
export type StripParam = 'fader' | 'eqLow' | 'eqMid' | 'eqHigh' | 'filter';

/** Freeze an AudioParam at its current value (cancelAndHold where supported). */
function holdParam(p: AudioParam, t: number): void {
  const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (anyP.cancelAndHoldAtTime) anyP.cancelAndHoldAtTime(t);
  else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

/** Schedule a sequence of [time, value] points as linear ramps. */
export function scheduleRamps(p: AudioParam, points: [number, number][], now: number): void {
  holdParam(p, now);
  let first = true;
  for (const [t, v] of points) {
    if (t < now) continue;
    if (first) {
      p.linearRampToValueAtTime(v, Math.max(now + 0.005, t));
      first = false;
    } else p.linearRampToValueAtTime(v, t);
  }
}

/**
 * One mixer channel:
 * input → trim → 3-band isolator (LR4 crossovers, full kill) → DJ filter →
 * channel fader → crossfader gain → output (to the deck FX + master bus).
 * A pre-fader tap feeds the headphone cue bus and the channel meter.
 */
export class ChannelStrip {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly preFader: GainNode;
  readonly cueSend: GainNode;
  readonly meter: AnalyserNode;

  private readonly trim: GainNode;
  private readonly bandGain: Record<EqBand, GainNode>;
  private readonly filterHP: BiquadFilterNode;
  private readonly filterLP: BiquadFilterNode;
  private readonly fader: GainNode;
  private readonly xfade: GainNode;
  private trimDb = 0;
  private autoGainDb = 0;
  private readonly ctx: BaseAudioContext;
  private filterQdb = 4;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.trim = ctx.createGain();
    this.input.connect(this.trim);

    // --- isolator: low = LP250² → AP2500 ; mid = HP250² → LP2500² ; high = HP250² → HP2500²
    const lp1 = biquad(ctx, 'lowpass', 250, BUTTERWORTH_DB);
    const lp2 = biquad(ctx, 'lowpass', 250, BUTTERWORTH_DB);
    const ap = biquad(ctx, 'allpass', 2500, Math.SQRT1_2);
    const hp1 = biquad(ctx, 'highpass', 250, BUTTERWORTH_DB);
    const hp2 = biquad(ctx, 'highpass', 250, BUTTERWORTH_DB);
    const mlp1 = biquad(ctx, 'lowpass', 2500, BUTTERWORTH_DB);
    const mlp2 = biquad(ctx, 'lowpass', 2500, BUTTERWORTH_DB);
    const hhp1 = biquad(ctx, 'highpass', 2500, BUTTERWORTH_DB);
    const hhp2 = biquad(ctx, 'highpass', 2500, BUTTERWORTH_DB);
    this.bandGain = { low: ctx.createGain(), mid: ctx.createGain(), high: ctx.createGain() };
    const eqSum = ctx.createGain();

    this.trim.connect(lp1).connect(lp2).connect(ap).connect(this.bandGain.low).connect(eqSum);
    this.trim.connect(hp1).connect(hp2);
    hp2.connect(mlp1).connect(mlp2).connect(this.bandGain.mid).connect(eqSum);
    hp2.connect(hhp1).connect(hhp2).connect(this.bandGain.high).connect(eqSum);

    // --- DJ filter (one knob: LP to the left, HP to the right)
    this.filterHP = biquad(ctx, 'highpass', 10, this.filterQdb);
    this.filterLP = biquad(ctx, 'lowpass', 22000, this.filterQdb);
    eqSum.connect(this.filterHP).connect(this.filterLP);

    this.preFader = ctx.createGain();
    this.filterLP.connect(this.preFader);

    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.preFader.connect(this.meter);

    this.cueSend = ctx.createGain();
    this.cueSend.gain.value = 0;
    this.preFader.connect(this.cueSend);

    this.fader = ctx.createGain();
    this.xfade = ctx.createGain();
    this.output = ctx.createGain();
    this.preFader.connect(this.fader).connect(this.xfade).connect(this.output);
  }

  setTrim(knob: number): void {
    this.trimDb = trimKnobToDb(knob);
    setParam(this.ctx, this.trim.gain, dbToGain(this.trimDb + this.autoGainDb));
  }

  /** Per-track loudness compensation (auto gain) in dB. */
  setAutoGain(db: number): void {
    this.autoGainDb = db;
    setParam(this.ctx, this.trim.gain, dbToGain(this.trimDb + this.autoGainDb), 0.05);
  }

  setEq(band: EqBand, knob: number): void {
    setParam(this.ctx, this.bandGain[band].gain, eqKnobToGain(knob));
  }

  setFilter(knob: number): void {
    const { lpHz, hpHz } = filterKnob(knob);
    setParam(this.ctx, this.filterLP.frequency, lpHz, 0.02);
    setParam(this.ctx, this.filterHP.frequency, hpHz, 0.02);
  }

  setFilterResonance(qDb: number): void {
    this.filterQdb = qDb;
    setParam(this.ctx, this.filterLP.Q, qDb);
    setParam(this.ctx, this.filterHP.Q, qDb);
  }

  setFader(v: number): void {
    setParam(this.ctx, this.fader.gain, faderToGain(v));
  }

  setCrossfaderGain(g: number): void {
    setParam(this.ctx, this.xfade.gain, g, 0.006);
  }

  setCue(on: boolean): void {
    setParam(this.ctx, this.cueSend.gain, on ? 1 : 0);
  }

  /** Pre-program a knob/fader on the audio clock: points are [contextTime, knobValue]. */
  schedule(param: StripParam, points: [number, number][]): void {
    const now = this.ctx.currentTime;
    switch (param) {
      case 'fader':
        scheduleRamps(
          this.fader.gain,
          points.map(([t, v]) => [t, faderToGain(v)]),
          now,
        );
        break;
      case 'eqLow':
      case 'eqMid':
      case 'eqHigh': {
        const band: EqBand = param === 'eqLow' ? 'low' : param === 'eqMid' ? 'mid' : 'high';
        scheduleRamps(
          this.bandGain[band].gain,
          points.map(([t, v]) => [t, eqKnobToGain(v)]),
          now,
        );
        break;
      }
      case 'filter':
        scheduleRamps(
          this.filterLP.frequency,
          points.map(([t, v]) => [t, filterKnob(v).lpHz]),
          now,
        );
        scheduleRamps(
          this.filterHP.frequency,
          points.map(([t, v]) => [t, filterKnob(v).hpHz]),
          now,
        );
        break;
    }
  }

  /** Stop any scheduled automation on a parameter (it holds its current value). */
  cancelSchedule(param: StripParam): void {
    const now = this.ctx.currentTime;
    switch (param) {
      case 'fader':
        holdParam(this.fader.gain, now);
        break;
      case 'eqLow':
        holdParam(this.bandGain.low.gain, now);
        break;
      case 'eqMid':
        holdParam(this.bandGain.mid.gain, now);
        break;
      case 'eqHigh':
        holdParam(this.bandGain.high.gain, now);
        break;
      case 'filter':
        holdParam(this.filterLP.frequency, now);
        holdParam(this.filterHP.frequency, now);
        break;
    }
  }
}

/**
 * Master section: sum → master volume → limiter → output.
 * In "split cue" mode the master goes (mono) to the left ear and the cue bus to the right,
 * so a single pair of headphones can be used for pre-listening.
 */
export class MasterSection {
  readonly bus: GainNode;
  readonly cueBus: GainNode;
  readonly output: GainNode;
  readonly meterL: AnalyserNode;
  readonly meterR: AnalyserNode;
  /** Post-limiter tap for the recorder. */
  readonly recordTap: GainNode;

  private readonly volume: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly stereoOut: GainNode;
  private readonly splitOut: ChannelMergerNode;
  private readonly cueLevel: GainNode;
  private readonly splitMasterMono: GainNode;
  private readonly splitCueMono: GainNode;
  private readonly ctx: BaseAudioContext;
  private splitCue = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.volume = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.bus.connect(this.volume).connect(this.limiter);

    this.recordTap = ctx.createGain();
    this.limiter.connect(this.recordTap);

    const splitter = ctx.createChannelSplitter(2);
    this.meterL = ctx.createAnalyser();
    this.meterR = ctx.createAnalyser();
    this.meterL.fftSize = 1024;
    this.meterR.fftSize = 1024;
    this.limiter.connect(splitter);
    splitter.connect(this.meterL, 0);
    splitter.connect(this.meterR, 1);

    this.output = ctx.createGain();

    // Normal stereo path.
    this.stereoOut = ctx.createGain();
    this.limiter.connect(this.stereoOut).connect(this.output);

    // Split-cue path (disabled by default).
    this.cueBus = ctx.createGain();
    this.cueLevel = ctx.createGain();
    this.cueBus.connect(this.cueLevel);
    this.splitMasterMono = ctx.createGain();
    this.splitMasterMono.channelCount = 1;
    this.splitMasterMono.channelCountMode = 'explicit';
    this.splitMasterMono.channelInterpretation = 'speakers';
    this.splitCueMono = ctx.createGain();
    this.splitCueMono.channelCount = 1;
    this.splitCueMono.channelCountMode = 'explicit';
    this.splitCueMono.channelInterpretation = 'speakers';
    this.splitOut = ctx.createChannelMerger(2);
    this.limiter.connect(this.splitMasterMono).connect(this.splitOut, 0, 0);
    this.cueLevel.connect(this.splitCueMono).connect(this.splitOut, 0, 1);
    this.splitMasterMono.gain.value = 0;
    this.splitCueMono.gain.value = 0;
    this.splitOut.connect(this.output);
  }

  setVolume(v: number): void {
    setParam(this.ctx, this.volume.gain, faderToGain(v) * 1.25);
  }

  setLimiter(on: boolean): void {
    const t = this.ctx.currentTime;
    this.limiter.threshold.setValueAtTime(on ? -1 : 0, t);
    this.limiter.ratio.setValueAtTime(on ? 20 : 1, t);
  }

  setCueLevel(v: number): void {
    setParam(this.ctx, this.cueLevel.gain, faderToGain(v));
  }

  setSplitCue(on: boolean): void {
    this.splitCue = on;
    setParam(this.ctx, this.stereoOut.gain, on ? 0 : 1, 0.01);
    setParam(this.ctx, this.splitMasterMono.gain, on ? 1 : 0, 0.01);
    setParam(this.ctx, this.splitCueMono.gain, on ? 1 : 0, 0.01);
  }

  get isSplitCue(): boolean {
    return this.splitCue;
  }
}

export function applyCrossfader(strips: ChannelStrip[], x: number, curve: CrossfaderCurve): void {
  const [a, b] = crossfaderGains(x, curve);
  strips[0]?.setCrossfaderGain(a);
  strips[1]?.setCrossfaderGain(b);
}
