/** 8-pad one-shot sampler with synthesised DJ FX sounds (air horn, siren, risers…). */

export interface PadInfo {
  id: string;
  label: string;
  color: string;
}

export const DEFAULT_PADS: PadInfo[] = [
  { id: 'horn', label: 'Air Horn', color: '#f97316' },
  { id: 'siren', label: 'Siren', color: '#ef4444' },
  { id: 'laser', label: 'Laser', color: '#22d3ee' },
  { id: 'riser', label: 'Riser', color: '#a78bfa' },
  { id: 'boom', label: 'Boom', color: '#f43f5e' },
  { id: 'crash', label: 'Crash', color: '#facc15' },
  { id: 'scratch', label: 'Scratch', color: '#34d399' },
  { id: 'rewind', label: 'Rewind', color: '#60a5fa' },
];

type Builder = (ctx: OfflineAudioContext) => void;

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

const builders: Record<string, { seconds: number; build: Builder }> = {
  horn: {
    seconds: 1.6,
    build: (ctx) => {
      const out = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.7;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 3);
      shaper.curve = curve;
      out.connect(shaper).connect(bp).connect(ctx.destination);
      const env = out.gain;
      env.value = 0;
      const blasts: [number, number][] = [
        [0, 0.13],
        [0.18, 0.13],
        [0.36, 0.13],
        [0.54, 0.95],
      ];
      for (const [t, len] of blasts) {
        env.setValueAtTime(0, t);
        env.linearRampToValueAtTime(0.28, t + 0.012);
        env.setValueAtTime(0.28, t + len - 0.03);
        env.linearRampToValueAtTime(0, t + len);
      }
      for (const f of [415, 466, 554, 622]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, 0);
        o.frequency.setValueAtTime(f, 1.25);
        o.frequency.linearRampToValueAtTime(f * 0.94, 1.5);
        o.connect(out);
        o.start(0);
      }
    },
  },
  siren: {
    seconds: 2.4,
    build: (ctx) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2.2;
      const depth = ctx.createGain();
      depth.gain.value = 450;
      o.frequency.value = 950;
      lfo.connect(depth).connect(o.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.18, 0.05);
      g.gain.setValueAtTime(0.18, 2.1);
      g.gain.linearRampToValueAtTime(0, 2.4);
      o.connect(lp).connect(g).connect(ctx.destination);
      o.start(0);
      lfo.start(0);
    },
  },
  laser: {
    seconds: 0.9,
    build: (ctx) => {
      for (let k = 0; k < 3; k++) {
        const t = k * 0.24;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(2600, t);
        o.frequency.exponentialRampToValueAtTime(140, t + 0.22);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 12;
        f.frequency.setValueAtTime(5000, t);
        f.frequency.exponentialRampToValueAtTime(300, t + 0.22);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.23);
        o.connect(f).connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.24);
      }
    },
  },
  riser: {
    seconds: 4.2,
    build: (ctx) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 4.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(300, 0);
      bp.frequency.exponentialRampToValueAtTime(9000, 4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.7, 3.95);
      g.gain.linearRampToValueAtTime(0, 4.1);
      src.connect(bp).connect(g).connect(ctx.destination);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, 0);
      o.frequency.exponentialRampToValueAtTime(880, 4);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, 0);
      og.gain.exponentialRampToValueAtTime(0.08, 3.95);
      og.gain.linearRampToValueAtTime(0, 4.1);
      o.connect(og).connect(ctx.destination);
      src.start(0);
      o.start(0);
    },
  },
  boom: {
    seconds: 2.2,
    build: (ctx) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(95, 0);
      o.frequency.exponentialRampToValueAtTime(28, 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.95, 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, 2.1);
      const sh = ctx.createWaveShaper();
      const c = new Float32Array(512);
      for (let i = 0; i < c.length; i++) c[i] = Math.tanh(((i / 511) * 2 - 1) * 2.2);
      sh.curve = c;
      o.connect(sh).connect(g).connect(ctx.destination);
      o.start(0);
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 0.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5, 0);
      ng.gain.exponentialRampToValueAtTime(0.0001, 0.45);
      n.connect(lp).connect(ng).connect(ctx.destination);
      n.start(0);
    },
  },
  crash: {
    seconds: 3,
    build: (ctx) => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 3);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.6, 0);
      g.gain.exponentialRampToValueAtTime(0.0001, 2.9);
      n.connect(hp).connect(g).connect(ctx.destination);
      n.start(0);
      for (const f of [3150, 4720, 6311, 7940]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.025, 0);
        og.gain.exponentialRampToValueAtTime(0.0001, 1.6);
        o.connect(og).connect(hp);
        o.start(0);
      }
    },
  },
  scratch: {
    seconds: 1.1,
    build: (ctx) => {
      // Formant "ahh" through a pitch pattern that mimics a baby scratch back and forth.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const pts = [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84];
      o.frequency.setValueAtTime(60, 0);
      pts.forEach((t, i) => {
        o.frequency.linearRampToValueAtTime(i % 2 ? 90 : 420, t + 0.06);
        o.frequency.linearRampToValueAtTime(60, t + 0.12);
      });
      const g = ctx.createGain();
      g.gain.value = 0;
      pts.forEach((t) => {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.4, t + 0.02);
        g.gain.linearRampToValueAtTime(0, t + 0.11);
      });
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 800;
      f1.Q.value = 4;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 1200;
      f2.Q.value = 5;
      const sum = ctx.createGain();
      sum.gain.value = 2.2;
      o.connect(g);
      g.connect(f1).connect(sum);
      g.connect(f2).connect(sum);
      sum.connect(ctx.destination);
      o.start(0);
    },
  },
  rewind: {
    seconds: 1.6,
    build: (ctx) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(140, 0);
      o.frequency.exponentialRampToValueAtTime(1400, 0.9);
      o.frequency.exponentialRampToValueAtTime(60, 1.5);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(9, 0);
      lfo.frequency.linearRampToValueAtTime(28, 1.4);
      const lg = ctx.createGain();
      lg.gain.value = 0.18;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2, 0);
      lfo.connect(lg).connect(g.gain);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;
      const end = ctx.createGain();
      end.gain.setValueAtTime(1, 1.3);
      end.gain.linearRampToValueAtTime(0, 1.55);
      o.connect(lp).connect(g).connect(end).connect(ctx.destination);
      o.start(0);
      lfo.start(0);
    },
  },
};

export async function renderPadSample(id: string, sampleRate: number): Promise<AudioBuffer | null> {
  const def = builders[id];
  if (!def) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(def.seconds * sampleRate), sampleRate);
  def.build(ctx);
  return ctx.startRendering();
}

export class Sampler {
  readonly output: GainNode;
  private readonly ctx: AudioContext;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly playing = new Map<number, AudioBufferSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
  }

  async loadDefaults(): Promise<void> {
    await Promise.all(
      DEFAULT_PADS.map(async (p, i) => {
        const buf = await renderPadSample(p.id, this.ctx.sampleRate);
        if (buf) this.buffers.set(i, buf);
      }),
    );
  }

  setBuffer(pad: number, buf: AudioBuffer): void {
    this.buffers.set(pad, buf);
  }

  setVolume(v: number): void {
    this.output.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.02);
  }

  trigger(pad: number, when?: number): void {
    const buf = this.buffers.get(pad);
    if (!buf) return;
    if (when === undefined) this.stop(pad);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.output);
    src.onended = () => {
      if (this.playing.get(pad) === src) this.playing.delete(pad);
    };
    src.start(when ?? 0);
    this.playing.set(pad, src);
  }

  stop(pad: number): void {
    const prev = this.playing.get(pad);
    if (prev) {
      try {
        prev.stop();
      } catch {
        /* already stopped */
      }
      this.playing.delete(pad);
    }
  }

  isPlaying(pad: number): boolean {
    return this.playing.has(pad);
  }
}
