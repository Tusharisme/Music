import { SVF, TAU, fastSin, midiToHz, polyBlep, softClip, type Stereo } from './synth';

// ---------------------------------------------------------------- drums (mono one-shots)

export interface KickOpts {
  f0: number;
  f1: number;
  pitchDecay: number;
  decay: number;
  click: number;
  drive: number;
  length: number;
}

export function kick(sr: number, o: Partial<KickOpts> = {}): Float32Array {
  const f0 = o.f0 ?? 165;
  const f1 = o.f1 ?? 47;
  const pd = o.pitchDecay ?? 0.032;
  const ad = o.decay ?? 0.3;
  const drive = o.drive ?? 1.8;
  const click = o.click ?? 0.35;
  const len = Math.round((o.length ?? 0.45) * sr);
  const out = new Float32Array(len);
  let ph = 0;
  const norm = Math.tanh(drive);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / pd);
    ph += f / sr;
    const env = Math.exp(-t / ad) * Math.min(1, t / 0.0012) * Math.min(1, (len - i) / (0.02 * sr));
    out[i] = Math.tanh(Math.sin(TAU * ph) * env * drive) / norm;
    if (click > 0 && t < 0.006) out[i] += click * Math.sin(TAU * 3200 * t) * Math.exp(-t / 0.0015);
  }
  return out;
}

export function clap(sr: number, rnd: () => number, decay = 0.16, tone = 1250): Float32Array {
  const len = Math.round((decay * 4 + 0.05) * sr);
  const out = new Float32Array(len);
  const bp = new SVF();
  bp.set(tone, 1.3, sr);
  const hp = new SVF();
  hp.set(600, 0.7, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let env = 0;
    for (const s of [0, 0.0105, 0.021]) if (t >= s) env = Math.max(env, Math.exp(-(t - s) / 0.0055));
    if (t >= 0.021) env = Math.max(env, 0.7 * Math.exp(-(t - 0.021) / decay));
    bp.run((rnd() * 2 - 1) * env);
    hp.run(bp.bp);
    out[i] = hp.hp * 2.4;
  }
  return out;
}

export function snare(
  sr: number,
  rnd: () => number,
  o: { tone?: number; decay?: number; bright?: number; dark?: number } = {},
): Float32Array {
  const tone = o.tone ?? 185;
  const decay = o.decay ?? 0.17;
  const len = Math.round(decay * 4 * sr);
  const out = new Float32Array(len);
  const hp = new SVF();
  hp.set(o.bright ?? 1600, 0.7, sr);
  const lp = new SVF();
  lp.set(Math.min(sr * 0.45, o.dark ?? 20000), 0.7, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = tone * (1 + 0.6 * Math.exp(-t / 0.01));
    ph += f / sr;
    const body = Math.sin(TAU * ph) * Math.exp(-t / 0.06) * 0.7;
    hp.run(rnd() * 2 - 1);
    lp.run(hp.hp);
    const noise = lp.lp * Math.exp(-t / decay) * 0.8;
    out[i] = (body + noise) * Math.min(1, t / 0.0008);
  }
  return out;
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

export function hat(sr: number, rnd: () => number, decay = 0.045, brightness = 1): Float32Array {
  const len = Math.round(Math.max(0.03, decay * 5) * sr);
  const out = new Float32Array(len);
  const bp = new SVF();
  bp.set(Math.min(sr * 0.42, 9500 * brightness), 1.2, sr);
  const hp = new SVF();
  hp.set(Math.min(sr * 0.4, 6500 * brightness), 0.7, sr);
  const phs = new Float64Array(HAT_FREQS.length);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let m = 0;
    for (let k = 0; k < HAT_FREQS.length; k++) {
      phs[k] += (HAT_FREQS[k] * 1.9) / sr;
      m += phs[k] % 1 < 0.5 ? 1 : -1;
    }
    const x = (m / 6) * 0.6 + (rnd() * 2 - 1) * 0.6;
    bp.run(x);
    hp.run(bp.bp);
    out[i] = hp.hp * Math.exp(-t / decay) * 1.6;
  }
  return out;
}

export function ride(sr: number, rnd: () => number): Float32Array {
  const len = Math.round(1.2 * sr);
  const out = new Float32Array(len);
  const hp = new SVF();
  hp.set(Math.min(sr * 0.4, 5000), 0.8, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let m = 0;
    for (let k = 0; k < HAT_FREQS.length; k++) m += Math.sin(TAU * HAT_FREQS[k] * 3.1 * t + k);
    const bell = Math.sin(TAU * 2400 * t) * Math.exp(-t / 0.18) * 0.3;
    hp.run((m / 6) * 0.4 + (rnd() * 2 - 1) * 0.3 + bell);
    out[i] = hp.hp * Math.exp(-t / 0.35) * 0.9;
  }
  return out;
}

export function shaker(sr: number, rnd: () => number): Float32Array {
  const len = Math.round(0.09 * sr);
  const out = new Float32Array(len);
  const bp = new SVF();
  bp.set(Math.min(sr * 0.42, 6800), 1.6, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.025);
    bp.run((rnd() * 2 - 1) * env);
    out[i] = bp.bp * 1.8;
  }
  return out;
}

export function conga(sr: number, freq: number): Float32Array {
  const len = Math.round(0.3 * sr);
  const out = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = freq * (1 + 0.35 * Math.exp(-t / 0.012));
    ph += f / sr;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.09) * Math.min(1, t / 0.0006);
  }
  return out;
}

export function rim(sr: number, rnd: () => number): Float32Array {
  const len = Math.round(0.06 * sr);
  const out = new Float32Array(len);
  const bp = new SVF();
  bp.set(1900, 2.2, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    bp.run((rnd() * 2 - 1) * Math.exp(-t / 0.006));
    out[i] = (bp.bp * 1.5 + Math.sin(TAU * 820 * t) * Math.exp(-t / 0.012)) * 0.8;
  }
  return out;
}

export function crash(sr: number, rnd: () => number): Float32Array {
  const len = Math.round(2.4 * sr);
  const out = new Float32Array(len);
  const hp = new SVF();
  hp.set(Math.min(sr * 0.4, 3800), 0.7, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let m = 0;
    for (let k = 0; k < HAT_FREQS.length; k++) m += Math.sin(TAU * HAT_FREQS[k] * 4.3 * t * (1 + k * 0.013));
    hp.run((rnd() * 2 - 1) * 0.7 + (m / 6) * 0.3);
    out[i] = hp.hp * Math.exp(-t / 0.6) * Math.min(1, t / 0.002);
  }
  return out;
}

/** Noise riser (stereo) of the given length. */
export function riser(sr: number, rnd: () => number, seconds: number): Stereo {
  const len = Math.round(seconds * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const fl = new SVF();
  const fr = new SVF();
  for (let i = 0; i < len; i++) {
    const p = i / len;
    if (i % 32 === 0) {
      const c = 300 * Math.pow(Math.min(sr * 0.4, 9000) / 300, p);
      fl.set(c, 2.2, sr);
      fr.set(c * 1.04, 2.2, sr);
    }
    const g = Math.pow(p, 2.2) * 0.55;
    fl.run(rnd() * 2 - 1);
    fr.run(rnd() * 2 - 1);
    L[i] = fl.bp * g;
    R[i] = fr.bp * g;
  }
  return { L, R };
}

/** Sub "impact" for drops. */
export function impact(sr: number): Float32Array {
  const len = Math.round(1.4 * sr);
  const out = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (35 + 50 * Math.exp(-t / 0.15)) / sr;
    out[i] = Math.tanh(Math.sin(TAU * ph) * 1.6) * Math.exp(-t / 0.45) * Math.min(1, t / 0.003);
  }
  return out;
}

// ---------------------------------------------------------------- tonal voices (render into stereo buses)

export interface BassPatch {
  wave: 'saw' | 'square' | 'sine' | 'reese';
  cutoff: number;
  envAmt: number;
  filterDecay: number;
  ampDecay: number;
  res: number;
  sub: number;
  drive: number;
  release: number;
  glide?: number;
}

export function bassNote(
  dst: Stereo,
  start: number,
  dur: number,
  midi: number,
  vel: number,
  sr: number,
  p: BassPatch,
): void {
  const f = midiToHz(midi);
  const s0 = Math.round(start);
  const len = Math.min(dst.L.length - s0, Math.round((dur + p.release) * sr));
  const svf = new SVF();
  let ph = 0;
  let ph2 = 0.37;
  const drv = softClip(p.drive);
  const ampK = p.ampDecay > 0 ? Math.exp(-1 / (p.ampDecay * sr)) : 1;
  const relK = Math.exp(-1 / (Math.max(1e-3, p.release * 0.35) * sr));
  const glideK = Math.exp(-1 / (0.06 * sr));
  const attack = 0.003 * sr;
  const durS = dur * sr;
  let env = 1;
  let rel = 1;
  let glide = p.glide ? p.glide - 1 : 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let amp = env * (i < attack ? i / attack : 1);
    env *= ampK;
    if (i > durS) {
      amp *= rel;
      rel *= relK;
    }
    const fi = glide ? f * (1 + glide) : f;
    glide *= glideK;
    const dt = fi / sr;
    ph += dt;
    if (ph >= 1) ph -= 1;
    let osc: number;
    switch (p.wave) {
      case 'saw':
        osc = 2 * ph - 1 - polyBlep(ph, dt);
        break;
      case 'square':
        osc = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.5) % 1, dt);
        break;
      case 'reese': {
        const dt2 = dt * 1.009;
        ph2 += dt2;
        if (ph2 >= 1) ph2 -= 1;
        osc = 0.55 * (2 * ph - 1 - polyBlep(ph, dt)) + 0.55 * (2 * ph2 - 1 - polyBlep(ph2, dt2));
        break;
      }
      default:
        osc = fastSin(ph);
    }
    if (i % 16 === 0) svf.set(p.cutoff + p.envAmt * Math.exp(-t / p.filterDecay), p.res, sr);
    svf.run(osc);
    const v = (softClip((svf.lp + p.sub * fastSin(ph)) * p.drive) / drv) * amp * vel;
    dst.L[s0 + i] += v;
    dst.R[s0 + i] += v;
  }
}

export interface PadPatch {
  attack: number;
  release: number;
  cutoff: number;
  detuneCents: number;
  voices: number;
  gain: number;
}

/** Detuned-saw pad chord with stereo spread. */
export function padChord(
  dst: Stereo,
  start: number,
  dur: number,
  midis: number[],
  sr: number,
  p: PadPatch,
): void {
  const s0 = Math.round(start);
  const len = Math.min(dst.L.length - s0, Math.round((dur + p.release) * sr));
  const oscs: { dt: number; ph: number; pan: number }[] = [];
  midis.forEach((m, n) => {
    for (let v = 0; v < p.voices; v++) {
      const spread = p.voices > 1 ? v / (p.voices - 1) - 0.5 : 0;
      const cents = spread * 2 * p.detuneCents;
      oscs.push({
        dt: (midiToHz(m) * Math.pow(2, cents / 1200)) / sr,
        ph: ((n * 7 + v * 3) % 10) / 10,
        pan: spread * 1.6,
      });
    }
  });
  const fl = new SVF();
  const fr = new SVF();
  fl.set(p.cutoff, 0.8, sr);
  fr.set(p.cutoff, 0.8, sr);
  const g = p.gain / Math.sqrt(oscs.length);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let env = Math.min(1, t / p.attack);
    if (t > dur) env *= Math.exp(-(t - dur) / Math.max(0.01, p.release * 0.35));
    let l = 0;
    let r = 0;
    for (let k = 0; k < oscs.length; k++) {
      const o = oscs[k];
      o.ph += o.dt;
      if (o.ph >= 1) o.ph -= 1;
      const s = 2 * o.ph - 1 - polyBlep(o.ph, o.dt);
      l += s * (1 - o.pan) * 0.5;
      r += s * (1 + o.pan) * 0.5;
    }
    fl.run(l);
    fr.run(r);
    dst.L[s0 + i] += fl.lp * env * g;
    dst.R[s0 + i] += fr.lp * env * g;
  }
}

/** FM electric piano note (Rhodes-ish). Recursive envelopes + table sines for speed. */
export function epNote(
  dst: Stereo,
  start: number,
  dur: number,
  midi: number,
  vel: number,
  sr: number,
  pan = 0,
  gain = 0.3,
): void {
  const f = midiToHz(midi);
  const s0 = Math.round(start);
  const len = Math.min(dst.L.length - s0, Math.round((dur + 0.6) * sr));
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const dP = f / sr;
  const dT = (f * 14) / sr;
  const dTrem = 4.2 / sr;
  const idxDecay = Math.exp(-1 / (0.3 * sr));
  const tineDecay = Math.exp(-1 / (0.018 * sr));
  const ampDecay = Math.exp(-1 / (1.6 * sr));
  const relDecay = Math.exp(-1 / (0.09 * sr));
  const attack = 0.002 * sr;
  const durS = dur * sr;
  const inv2pi = 1 / TAU;
  let pc = 0;
  let pt = 0;
  let trem = 0;
  let idx = 1.6 * vel;
  let tine = 0.5;
  let amp = 1;
  let rel = 1;
  for (let i = 0; i < len; i++) {
    pc += dP;
    pt += dT;
    trem += dTrem;
    const mod = (idx + 0.25) * fastSin(pc) + fastSin(pt) * tine;
    idx *= idxDecay;
    tine *= tineDecay;
    let a = amp * (1 + 0.06 * fastSin(trem));
    amp *= ampDecay;
    if (i < attack) a *= i / attack;
    if (i > durS) {
      a *= rel;
      rel *= relDecay;
      if (rel < 1e-4) break;
    }
    const v = fastSin(pc + mod * inv2pi) * a * vel;
    dst.L[s0 + i] += v * gl;
    dst.R[s0 + i] += v * gr;
  }
}

export interface PluckPatch {
  cutoff: number;
  envAmt: number;
  decay: number;
  filterDecay: number;
  wave: 'saw' | 'square';
  detuneCents: number;
  gain: number;
}

export function pluckNote(
  dst: Stereo,
  start: number,
  dur: number,
  midi: number,
  vel: number,
  sr: number,
  p: PluckPatch,
  pan = 0,
): void {
  const f = midiToHz(midi);
  const s0 = Math.round(start);
  const len = Math.min(dst.L.length - s0, Math.round((Math.min(dur, p.decay * 4) + 0.08) * sr));
  const dt1 = f / sr;
  const dt2 = (f * Math.pow(2, p.detuneCents / 1200)) / sr;
  let p1 = 0;
  let p2 = 0.5;
  const svf = new SVF();
  const gl = p.gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const gr = p.gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const envK = Math.exp(-1 / (p.decay * sr));
  const relK = Math.exp(-1 / (0.03 * sr));
  const attack = 0.0015 * sr;
  const durS = dur * sr;
  let env = 1;
  let rel = 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    p1 += dt1;
    if (p1 >= 1) p1 -= 1;
    p2 += dt2;
    if (p2 >= 1) p2 -= 1;
    let o: number;
    if (p.wave === 'saw') o = 2 * p1 - 1 - polyBlep(p1, dt1) + 0.6 * (2 * p2 - 1 - polyBlep(p2, dt2));
    else
      o = (p1 < 0.5 ? 1 : -1) + polyBlep(p1, dt1) - polyBlep((p1 + 0.5) % 1, dt1) + 0.5 * (p2 < 0.5 ? 1 : -1);
    if (i % 16 === 0) svf.set(p.cutoff + p.envAmt * vel * Math.exp(-t / p.filterDecay), 1.1, sr);
    svf.run(o);
    let amp = (i < attack ? i / attack : 1) * env;
    env *= envK;
    if (i > durS) {
      amp *= rel;
      rel *= relK;
    }
    const s = svf.lp * amp * vel;
    dst.L[s0 + i] += s * gl;
    dst.R[s0 + i] += s * gr;
  }
}

/** Short chord stab (deep house organ / techno chord). */
export function stab(
  dst: Stereo,
  start: number,
  midis: number[],
  vel: number,
  sr: number,
  decay = 0.2,
  cutoff = 1800,
  gain = 0.22,
): void {
  const s0 = Math.round(start);
  const len = Math.min(dst.L.length - s0, Math.round(decay * 5 * sr));
  const svf = new SVF();
  const phs = midis.map(() => 0);
  const dts = midis.map((m) => midiToHz(m) / sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let o = 0;
    for (let k = 0; k < phs.length; k++) {
      phs[k] += dts[k];
      if (phs[k] >= 1) phs[k] -= 1;
      o += (phs[k] < 0.5 ? 1 : -1) * 0.5 + (2 * phs[k] - 1) * 0.5;
    }
    if (i % 16 === 0) svf.set(cutoff * (0.4 + 1.6 * Math.exp(-t / 0.06)), 1.4, sr);
    svf.run(o / midis.length);
    const s = svf.lp * Math.exp(-t / decay) * Math.min(1, t / 0.002) * vel * gain;
    dst.L[s0 + i] += s;
    dst.R[s0 + i] += s;
  }
}

/** Vinyl crackle + hiss (lo-fi flavour). */
export function crackle(dst: Stereo, sr: number, rnd: () => number, level: number): void {
  let lp = 0;
  for (let i = 0; i < dst.L.length; i++) {
    lp = lp * 0.97 + (rnd() * 2 - 1) * 0.03;
    let v = lp * 0.25 * level;
    if (rnd() < 6 / sr) v += (rnd() * 2 - 1) * level * 1.5;
    dst.L[i] += v;
    dst.R[i] += v;
  }
}
