import type { MusicalKey } from '../types';
import { camelot, camelotLabel, transposeKey } from '../music/keys';

export type HarmonicKind =
  'perfect' | 'adjacent' | 'relative' | 'diagonal' | 'boost' | 'semitone' | 'mood' | 'clash';

export interface HarmonicMatch {
  score: number;
  kind: HarmonicKind;
  label: string;
}

const signedStep = (from: number, to: number): number => {
  const d = (((to - from) % 12) + 12) % 12;
  return d > 6 ? d - 12 : d;
};

/**
 * Harmonic compatibility of mixing from one key into another, following the
 * Camelot-wheel rules DJs use (same key, ±1, relative major/minor, diagonal,
 * energy boosts) – scored 0..1.
 */
export function harmonicCompat(from: MusicalKey, to: MusicalKey): HarmonicMatch {
  const a = camelot(from);
  const b = camelot(to);
  const dd = signedStep(a.num, b.num);
  const A = camelotLabel(from);
  const B = camelotLabel(to);
  if (a.letter === b.letter) {
    if (dd === 0) return { score: 1, kind: 'perfect', label: `Same key ${A}` };
    if (dd === 1) return { score: 0.92, kind: 'adjacent', label: `${A} → ${B} lifts the energy` };
    if (dd === -1) return { score: 0.9, kind: 'adjacent', label: `${A} → ${B} smooth step down` };
    if (dd === 2) return { score: 0.62, kind: 'boost', label: `${A} → ${B} energy boost (+2)` };
    if (dd === -2) return { score: 0.55, kind: 'boost', label: `${A} → ${B} (−2)` };
    if (dd === -5) return { score: 0.55, kind: 'semitone', label: `${A} → ${B} semitone lift` };
    if (dd === 5) return { score: 0.42, kind: 'semitone', label: `${A} → ${B} semitone drop` };
    if (Math.abs(dd) === 3) return { score: 0.35, kind: 'mood', label: `${A} → ${B} mood shift` };
    return { score: 0.15, kind: 'clash', label: `${A} → ${B} key clash` };
  }
  if (dd === 0)
    return {
      score: 0.86,
      kind: 'relative',
      label: `${A} → ${B} relative ${b.letter === 'B' ? 'major' : 'minor'}`,
    };
  // Diagonal: minor → major one step clockwise, or major → minor one step anti-clockwise.
  if ((a.letter === 'A' && dd === 1) || (a.letter === 'B' && dd === -1)) {
    return { score: 0.7, kind: 'diagonal', label: `${A} → ${B} diagonal move` };
  }
  if ((a.letter === 'A' && dd === -1) || (a.letter === 'B' && dd === 1)) {
    return { score: 0.5, kind: 'diagonal', label: `${A} → ${B} diagonal (wide)` };
  }
  if ((a.letter === 'A' && dd === 3) || (a.letter === 'B' && dd === -3)) {
    return {
      score: 0.42,
      kind: 'mood',
      label: `${A} → ${B} parallel ${b.letter === 'B' ? 'major' : 'minor'}`,
    };
  }
  return { score: 0.15, kind: 'clash', label: `${A} → ${B} key clash` };
}

/** Key a deck is actually sounding in, given tempo/key-lock/key-shift state. */
export function effectiveKey(key: MusicalKey, rate: number, keyLock: boolean, keyShift: number): MusicalKey {
  const semis = keyLock ? keyShift : 12 * Math.log2(Math.max(0.25, rate));
  return transposeKey(key, Math.round(semis));
}

export interface ShiftedMatch extends HarmonicMatch {
  /** Semitones to shift the incoming track (with key lock) for this match. */
  shift: number;
}

/** Best match allowing a small key shift of the incoming track (penalised per semitone). */
export function bestKeyShift(from: MusicalKey, to: MusicalKey, maxShift = 2): ShiftedMatch {
  let best: ShiftedMatch = { ...harmonicCompat(from, to), shift: 0 };
  for (let s = -maxShift; s <= maxShift; s++) {
    if (s === 0) continue;
    const m = harmonicCompat(from, transposeKey(to, s));
    const score = m.score * (1 - 0.07 * Math.abs(s));
    if (score > best.score + 0.05) best = { ...m, score, shift: s };
  }
  return best;
}
