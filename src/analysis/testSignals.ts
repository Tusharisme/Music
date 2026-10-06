/** Synthetic music-like signals with known tempo/key for analyzer tests. */

export interface SynthOptions {
  bpm: number;
  seconds: number;
  sr: number;
  /** Time of the first kick (a downbeat). */
  offset?: number;
  /** Key tonic pitch class and mode for the bass/chords. */
  tonic?: number;
  minor?: boolean;
  hats?: boolean;
  chords?: boolean;
  kicks?: boolean;
  /** Drum pattern: four-on-the-floor house, boom-bap hip-hop, or 2-step drum & bass. */
  groove?: 'house' | 'hiphop' | 'dnb';
  seed?: number;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function synthTrack(o: SynthOptions): Float32Array {
  const { bpm, seconds, sr } = o;
  const offset = o.offset ?? 0;
  const out = new Float32Array(Math.round(seconds * sr));
  const beat = 60 / bpm;
  let seed = o.seed ?? 1;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };

  const groove = o.groove ?? 'house';
  const kickSteps = groove === 'hiphop' ? [0, 7, 10] : groove === 'dnb' ? [0, 10] : [0, 4, 8, 12];
  const kickTimes: number[] = [];
  for (let barT = offset; barT < seconds; barT += beat * 4) {
    for (const s of kickSteps) kickTimes.push(barT + (s * beat) / 4);
  }
  // Snare on 2 and 4 for the broken grooves.
  if (groove !== 'house') {
    for (let t = offset + beat; t < seconds; t += beat * 2) {
      const s0 = Math.round(t * sr);
      const len = Math.round(0.2 * sr);
      for (let i = 0; i < len && s0 + i < out.length; i++) {
        const tt = i / sr;
        out[s0 + i] +=
          (0.35 * Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt / 0.05) +
            0.3 * rnd() * Math.exp(-tt / 0.12)) *
          Math.min(1, i / 20);
      }
    }
  }
  for (const t of kickTimes) {
    if (o.kicks === false || t >= seconds) continue;
    const s0 = Math.round(t * sr);
    const len = Math.round(0.35 * sr);
    let ph = 0;
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const tt = i / sr;
      const f = 50 + 110 * Math.exp(-tt / 0.03);
      ph += (2 * Math.PI * f) / sr;
      out[s0 + i] += 0.7 * Math.sin(ph) * Math.exp(-tt / 0.18);
    }
  }
  // Off-beat hats: noise through a 2nd-order high-pass at ~7 kHz, like a real hi-hat.
  if (o.hats !== false) {
    const w0 = (2 * Math.PI * Math.min(7000, sr * 0.4)) / sr;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    const b0 = (1 + cos) / 2 / a0;
    const b1 = -(1 + cos) / a0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    // House: off-beat hats. Hip-hop: 8ths. Drum & bass: 16ths.
    const hatStart = (o.groove ?? 'house') === 'house' ? beat / 2 : 0;
    const hatStep = o.groove === 'dnb' ? beat / 4 : o.groove === 'hiphop' ? beat / 2 : beat;
    for (let t = offset + hatStart; t < seconds; t += hatStep) {
      const s0 = Math.round(t * sr);
      const len = Math.round(0.05 * sr);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len && s0 + i < out.length; i++) {
        const x = rnd() * 2;
        const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[s0 + i] += 0.3 * y * Math.exp(-i / sr / 0.015);
      }
    }
  }
  // Chord progression (i–VI–VII–i in minor / I–V–vi–IV in major), one chord per bar.
  if (o.chords !== false) {
    const tonic = o.tonic ?? 9;
    const minor = o.minor ?? true;
    const prog = minor
      ? [
          [0, 3, 7],
          [8, 12, 15],
          [10, 14, 17],
          [0, 3, 7],
        ]
      : [
          [0, 4, 7],
          [7, 11, 14],
          [9, 12, 16],
          [5, 9, 12],
        ];
    const bar = beat * 4;
    let k = 0;
    for (let t = offset; t < seconds; t += bar, k++) {
      const chord = prog[k % prog.length];
      const s0 = Math.round(t * sr);
      const len = Math.round(bar * sr);
      for (const iv of chord) {
        const f = midiHz(48 + tonic + iv + 12);
        for (let i = 0; i < len && s0 + i < out.length; i++) {
          const env = Math.min(1, i / (0.02 * sr)) * Math.min(1, (len - i) / (0.02 * sr));
          out[s0 + i] +=
            0.06 * env * (Math.sin((2 * Math.PI * f * i) / sr) + 0.3 * Math.sin((4 * Math.PI * f * i) / sr));
        }
      }
      // Bass: chord root on off-beats (house) or on the beat (broken grooves).
      const root = midiHz(36 + tonic + chord[0]);
      const bassOff = (o.groove ?? 'house') === 'house' ? beat / 2 : 0;
      for (let b = 0; b < 4; b++) {
        const bs = Math.round((t + b * beat + bassOff) * sr);
        const bl = Math.round(beat * 0.45 * sr);
        for (let i = 0; i < bl && bs + i < out.length; i++) {
          out[bs + i] +=
            0.25 *
            Math.min(1, i / (0.006 * sr)) *
            Math.sin((2 * Math.PI * root * i) / sr) *
            Math.exp(-i / sr / 0.15);
        }
      }
    }
  }
  return out;
}

/** Splice bar ranges from variants into a DJ-style arrangement. */
export function arrangedTrack(
  bpm: number,
  sr: number,
  offset: number,
  plan: { bars: number; kind: 'drums' | 'full' | 'pads' }[],
  tonic = 9,
  minor = true,
): Float32Array {
  const bar = (60 / bpm) * 4;
  const totalBars = plan.reduce((a, p) => a + p.bars, 0);
  const seconds = offset + totalBars * bar + 1;
  const variants = {
    drums: synthTrack({ bpm, seconds, sr, offset, chords: false, tonic, minor }),
    full: synthTrack({ bpm, seconds, sr, offset, tonic, minor }),
    pads: synthTrack({ bpm, seconds, sr, offset, kicks: false, hats: false, tonic, minor }),
  };
  const out = new Float32Array(Math.round(seconds * sr));
  let b = 0;
  for (const p of plan) {
    const a = Math.round((offset + b * bar) * sr);
    const e = Math.round((offset + (b + p.bars) * bar) * sr);
    out.set(variants[p.kind].subarray(a, e), a);
    b += p.bars;
  }
  return out;
}
