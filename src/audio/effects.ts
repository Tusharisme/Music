/** Beat-synced per-deck FX unit (post-fader, so echo/reverb tails ring out after a fader cut). */

export type FxType = 'echo' | 'reverb' | 'flanger' | 'phaser' | 'crush' | 'gate' | 'wobble';

export const FX_TYPES: { id: FxType; label: string; paramLabel: string }[] = [
  { id: 'echo', label: 'Echo', paramLabel: 'Feedback' },
  { id: 'reverb', label: 'Reverb', paramLabel: 'Size' },
  { id: 'flanger', label: 'Flanger', paramLabel: 'Resonance' },
  { id: 'phaser', label: 'Phaser', paramLabel: 'Depth' },
  { id: 'crush', label: 'Crush', paramLabel: 'Grit' },
  { id: 'gate', label: 'Gate', paramLabel: 'Depth' },
  { id: 'wobble', label: 'Wobble', paramLabel: 'Resonance' },
];

export interface FxSettings {
  type: FxType;
  on: boolean;
  /** Dry/wet 0..1 */
  mix: number;
  /** Effect specific 0..1 */
  param: number;
  /** Beat division for timing based effects. */
  beats: number;
}

export interface BeatTiming {
  /** Seconds per beat at the deck's current tempo (0 when unknown). */
  beatSec: number;
  /** Context time & beat index pair for phase locked effects. */
  refTime: number;
  beat: number;
}

interface FxUnit {
  readonly send: GainNode;
  readonly out: AudioNode;
  /** Additive effects keep the dry signal at full level and ring out when switched off. */
  readonly additive: boolean;
  setParam(v: number): void;
  setTiming(t: BeatTiming, beats: number): void;
}

const TC = 0.02;

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number, seed: number): AudioBuffer {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Darken the tail over time with a one-pole low-pass on the noise.
      const k = 0.65 + 0.3 * t;
      lp = lp * k + rnd() * (1 - k);
      d[i] = lp * 3 * Math.pow(1 - t, decay);
    }
    // A few early reflections.
    for (let r = 0; r < 6; r++) {
      const at = Math.floor((0.007 + r * 0.011 + (c ? 0.003 : 0)) * ctx.sampleRate);
      if (at < len) d[at] += (0.5 - r * 0.06) * (r % 2 ? -1 : 1);
    }
  }
  return buf;
}

function lfo(
  ctx: BaseAudioContext,
  depth: number,
  target: AudioParam,
  type: OscillatorType = 'sine',
): [OscillatorNode, GainNode] {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = 0.5;
  const g = ctx.createGain();
  g.gain.value = depth;
  osc.connect(g).connect(target);
  osc.start();
  return [osc, g];
}

function createUnit(ctx: BaseAudioContext, type: FxType): FxUnit {
  const send = ctx.createGain();
  send.gain.value = 0;
  switch (type) {
    case 'echo': {
      const delay = ctx.createDelay(4);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5500;
      const fb = ctx.createGain();
      fb.gain.value = 0.5;
      const out = ctx.createGain();
      send.connect(delay);
      delay.connect(hp).connect(lp).connect(fb).connect(delay);
      delay.connect(out);
      return {
        send,
        out,
        additive: true,
        setParam: (v) => fb.gain.setTargetAtTime(0.15 + v * 0.75, ctx.currentTime, TC),
        setTiming: (t, beats) => {
          const sec = Math.min(3.9, Math.max(0.02, (t.beatSec || 0.5) * beats));
          delay.delayTime.setTargetAtTime(sec, ctx.currentTime, 0.03);
        },
      };
    }
    case 'reverb': {
      const pre = ctx.createDelay(0.2);
      pre.delayTime.value = 0.015;
      const small = ctx.createConvolver();
      small.buffer = makeImpulse(ctx, 1.4, 2.5, 7);
      const large = ctx.createConvolver();
      large.buffer = makeImpulse(ctx, 3.8, 2.2, 13);
      const gs = ctx.createGain();
      const gl = ctx.createGain();
      const out = ctx.createGain();
      out.gain.value = 0.9;
      send.connect(pre);
      pre.connect(small).connect(gs).connect(out);
      pre.connect(large).connect(gl).connect(out);
      const setParam = (v: number) => {
        gs.gain.setTargetAtTime(Math.cos((v * Math.PI) / 2), ctx.currentTime, TC);
        gl.gain.setTargetAtTime(Math.sin((v * Math.PI) / 2), ctx.currentTime, TC);
      };
      setParam(0.5);
      return { send, out, additive: true, setParam, setTiming: () => {} };
    }
    case 'flanger': {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.004;
      const fb = ctx.createGain();
      fb.gain.value = 0.5;
      const out = ctx.createGain();
      send.connect(delay).connect(out);
      delay.connect(fb).connect(delay);
      const [osc] = lfo(ctx, 0.003, delay.delayTime);
      return {
        send,
        out,
        additive: false,
        setParam: (v) => fb.gain.setTargetAtTime(0.2 + v * 0.7, ctx.currentTime, TC),
        setTiming: (t, beats) => {
          const period = Math.max(0.25, (t.beatSec || 0.5) * beats * 4);
          osc.frequency.setTargetAtTime(1 / period, ctx.currentTime, TC);
        },
      };
    }
    case 'phaser': {
      const stages: BiquadFilterNode[] = [];
      for (let i = 0; i < 6; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 500 + i * 180;
        ap.Q.value = 0.6;
        stages.push(ap);
      }
      const out = ctx.createGain();
      const fb = ctx.createGain();
      fb.gain.value = 0.45;
      send.connect(stages[0]);
      for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
      stages[stages.length - 1].connect(out);
      stages[stages.length - 1].connect(fb).connect(stages[0]);
      const osc = ctx.createOscillator();
      osc.frequency.value = 0.3;
      const depth = ctx.createGain();
      depth.gain.value = 1800;
      osc.connect(depth);
      for (const s of stages) depth.connect(s.detune);
      osc.start();
      return {
        send,
        out,
        additive: false,
        setParam: (v) => depth.gain.setTargetAtTime(600 + v * 2400, ctx.currentTime, TC),
        setTiming: (t, beats) => {
          const period = Math.max(0.25, (t.beatSec || 0.5) * beats * 4);
          osc.frequency.setTargetAtTime(1 / period, ctx.currentTime, TC);
        },
      };
    }
    case 'crush': {
      const node = new AudioWorkletNode(ctx, 'bitcrusher', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const bits = node.parameters.get('bits')!;
      const ds = node.parameters.get('downsample')!;
      const out = ctx.createGain();
      send.connect(node).connect(out);
      return {
        send,
        out,
        additive: false,
        setParam: (v) => {
          bits.setValueAtTime(12 - v * 9, ctx.currentTime);
          ds.setValueAtTime(1 + Math.round(v * v * 24), ctx.currentTime);
        },
        setTiming: () => {},
      };
    }
    case 'gate': {
      const node = new AudioWorkletNode(ctx, 'beat-gate', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const out = ctx.createGain();
      send.connect(node).connect(out);
      return {
        send,
        out,
        additive: false,
        setParam: (v) => node.port.postMessage({ depth: 0.4 + v * 0.6 }),
        setTiming: (t, beats) =>
          node.port.postMessage({
            refTime: t.refTime,
            beat: t.beat,
            bps: t.beatSec > 0 ? 1 / t.beatSec : 0,
            division: Math.max(1 / 16, beats / 4),
          }),
      };
    }
    case 'wobble': {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 6;
      const out = ctx.createGain();
      out.gain.value = 1.2;
      send.connect(filter).connect(out);
      const [osc] = lfo(ctx, 2600, filter.detune, 'triangle');
      return {
        send,
        out,
        additive: false,
        setParam: (v) => filter.Q.setTargetAtTime(2 + v * 14, ctx.currentTime, TC),
        setTiming: (t, beats) => {
          const period = Math.max(0.05, (t.beatSec || 0.5) * beats);
          osc.frequency.setTargetAtTime(1 / period, ctx.currentTime, TC);
        },
      };
    }
  }
}

export class DeckFx {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly units = new Map<FxType, { unit: FxUnit; wet: GainNode }>();
  private readonly ctx: BaseAudioContext;
  private settings: FxSettings = { type: 'echo', on: false, mix: 0.5, param: 0.5, beats: 0.5 };
  private timing: BeatTiming = { beatSec: 0.5, refTime: 0, beat: 0 };

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
  }

  private slot(type: FxType): { unit: FxUnit; wet: GainNode } {
    let s = this.units.get(type);
    if (!s) {
      const unit = createUnit(this.ctx, type);
      this.input.connect(unit.send);
      const wet = this.ctx.createGain();
      wet.gain.value = 0;
      unit.out.connect(wet).connect(this.output);
      s = { unit, wet };
      this.units.set(type, s);
    }
    return s;
  }

  /** Apply settings now, or at a future context time (for scheduled transitions). */
  apply(next: FxSettings, when?: number): void {
    const t = Math.max(this.ctx.currentTime, when ?? 0);
    const prev = this.settings;
    this.settings = { ...next };

    // Turn off the previous unit if we switched type (insert FX cut immediately, tails ring out).
    if (prev.type !== next.type) {
      const old = this.units.get(prev.type);
      if (old) {
        old.unit.send.gain.setTargetAtTime(0, t, 0.01);
        if (!old.unit.additive) old.wet.gain.setTargetAtTime(0, t, 0.01);
      }
    }

    if (!next.on && !this.units.has(next.type)) {
      this.dry.gain.setTargetAtTime(1, t, 0.01);
      return;
    }
    const { unit: u, wet } = this.slot(next.type);
    u.setParam(next.param);
    u.setTiming(this.timing, next.beats);
    if (u.additive) {
      this.dry.gain.setTargetAtTime(1, t, 0.01);
      u.send.gain.setTargetAtTime(next.on ? 1 : 0, t, 0.01);
      // Keep the wet level when switching off so the tail decays naturally ("trails").
      wet.gain.setTargetAtTime(next.mix * 1.1, t, 0.02);
    } else {
      u.send.gain.setTargetAtTime(next.on ? 1 : 0, t, 0.01);
      wet.gain.setTargetAtTime(next.on ? next.mix : 0, t, 0.01);
      this.dry.gain.setTargetAtTime(next.on ? 1 - next.mix : 1, t, 0.01);
    }
  }

  /** Pre-program the wet level of the current effect: [contextTime, mix] points. */
  scheduleMix(points: [number, number][]): void {
    const slot = this.units.get(this.settings.type);
    if (!slot) return;
    const now = this.ctx.currentTime;
    const g = slot.wet.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    for (const [t, v] of points)
      if (t >= now) g.linearRampToValueAtTime(v * (slot.unit.additive ? 1.1 : 1), t);
  }

  setTiming(timing: BeatTiming): void {
    this.timing = timing;
    this.units.get(this.settings.type)?.unit.setTiming(timing, this.settings.beats);
  }
}
