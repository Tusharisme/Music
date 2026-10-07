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

/** What the crossfader does besides changing the volume (a combo move from one control). */
export type CrossfaderMode = 'off' | 'bass' | 'filter';

/** How far the crossfader has moved away from a deck: 0 on its side or centred, 1 at the far end. */
function awayFrom(deck: number, x: number): number {
  return Math.max(0, Math.min(1, deck === 0 ? (x - 0.5) * 2 : (0.5 - x) * 2));
}

/**
 * The low-EQ and filter knob values a channel actually gets from its knobs plus the crossfader.
 * Bass swap: each deck loses its bass over the first fifth of the travel past the middle, so the
 * basses trade places as you slide through the centre. Filter: the deck that's leaving is
 * high-passed away (a low-pass the DJ set on purpose is left alone).
 */
export function smartChannel(
  mode: CrossfaderMode,
  x: number,
  deck: number,
  eqLow: number,
  filter: number,
): { eqLow: number; filter: number } {
  const away = awayFrom(deck, x);
  if (mode === 'bass') return { eqLow: eqLow * (1 - Math.min(1, away / 0.2)), filter };
  if (mode === 'filter' && filter > -0.02)
    return { eqLow, filter: Math.max(filter, 0.85 * Math.pow(away, 0.8)) };
  return { eqLow, filter };
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
