/** Knob/fader → gain mappings shared by the mixer and the UI readouts. */

export type CrossfaderCurve = 'smooth' | 'dipped' | 'sharp';

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g <= 0 ? -Infinity : 20 * Math.log10(g));

/** EQ knob 0..1 (0.5 = flat). Left half: full kill → 0 dB, right half: 0 → +6 dB. */
export function eqKnobToGain(v: number): number {
  if (v <= 0.02) return 0;
  if (v <= 0.5) return Math.pow(v / 0.5, 2.2);
  return dbToGain(((v - 0.5) / 0.5) * 6);
}

/** Trim knob 0..1 (0.5 = 0 dB) → dB in [-12, +12]. */
export const trimKnobToDb = (v: number): number => (v - 0.5) * 24;

/** Channel fader 0..1 → gain (audio taper). */
export const faderToGain = (v: number): number => v * v;

/** Crossfader position x (0 = full A, 1 = full B) → [gainA, gainB]. */
export function crossfaderGains(x: number, curve: CrossfaderCurve): [number, number] {
  const c = Math.max(0, Math.min(1, x));
  switch (curve) {
    case 'dipped':
      return [1 - c, c];
    case 'sharp': {
      const edge = 0.04;
      const a = c >= 1 - edge ? (1 - c) / edge : 1;
      const b = c <= edge ? c / edge : 1;
      return [a, b];
    }
    case 'smooth':
    default:
      return [Math.cos((c * Math.PI) / 2), Math.sin((c * Math.PI) / 2)];
  }
}

export interface FilterSetting {
  lpHz: number;
  hpHz: number;
}

/** Filter knob -1..1: left = low-pass sweep, right = high-pass sweep, centre = off. */
export function filterKnob(v: number): FilterSetting {
  if (Math.abs(v) < 0.02) return { lpHz: 22000, hpHz: 10 };
  if (v < 0) return { lpHz: 20000 * Math.pow(2, v * 8), hpHz: 10 };
  return { lpHz: 22000, hpHz: 15 * Math.pow(2, v * 9.4) };
}
