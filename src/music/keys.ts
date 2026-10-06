import type { MusicalKey } from '../types';

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Spelling commonly used by DJ software (mixes sharps and flats like Mixed In Key). */
const DJ_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export type KeyNotation = 'camelot' | 'musical' | 'openkey';

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Camelot wheel number (1..12) and letter (A = minor, B = major). */
export function camelot(k: MusicalKey): { num: number; letter: 'A' | 'B' } {
  const majorTonic = k.mode === 'major' ? k.tonic : mod(k.tonic + 3, 12);
  const num = mod(mod(majorTonic * 7, 12) + 7, 12) + 1;
  return { num, letter: k.mode === 'major' ? 'B' : 'A' };
}

export function camelotLabel(k: MusicalKey): string {
  const c = camelot(k);
  return `${c.num}${c.letter}`;
}

export function fromCamelot(num: number, letter: 'A' | 'B'): MusicalKey {
  // Inverse of camelot(): majorTonic * 7 ≡ num - 8 (mod 12); 7 is its own inverse mod 12.
  const majorTonic = mod((num - 8) * 7, 12);
  return letter === 'B'
    ? { tonic: majorTonic, mode: 'major' }
    : { tonic: mod(majorTonic - 3, 12), mode: 'minor' };
}

export function musicalLabel(k: MusicalKey): string {
  return `${DJ_NAMES[k.tonic]}${k.mode === 'minor' ? 'm' : ''}`;
}

export function longLabel(k: MusicalKey): string {
  return `${DJ_NAMES[k.tonic]} ${k.mode}`;
}

export function openKeyLabel(k: MusicalKey): string {
  const n = mod(camelot(k).num - 8, 12) + 1;
  return `${n}${k.mode === 'major' ? 'd' : 'm'}`;
}

export function keyLabel(k: MusicalKey, notation: KeyNotation): string {
  switch (notation) {
    case 'musical':
      return musicalLabel(k);
    case 'openkey':
      return openKeyLabel(k);
    default:
      return camelotLabel(k);
  }
}

export function transposeKey(k: MusicalKey, semis: number): MusicalKey {
  return { tonic: mod(k.tonic + Math.round(semis), 12), mode: k.mode };
}

export function keysEqual(a: MusicalKey, b: MusicalKey): boolean {
  return a.tonic === b.tonic && a.mode === b.mode;
}

/** Hue (degrees) for a key – neighbours on the Camelot wheel get neighbouring colours. */
export function keyHue(k: MusicalKey): number {
  return mod((camelot(k).num - 1) * 30 + 200, 360);
}

const NOTE_RE = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(.*)$/;

/** Parse key strings found in tags: "8A", "11b", "Am", "A minor", "F#m", "Gbmaj", "1m", "6d". */
export function parseKey(raw: string | undefined | null): MusicalKey | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const cam = /^(1[0-2]|[1-9])\s*([ABab])$/.exec(s);
  if (cam) return fromCamelot(Number(cam[1]), cam[2].toUpperCase() as 'A' | 'B');

  const open = /^(1[0-2]|[1-9])\s*([dmDM])$/.exec(s);
  if (open) {
    const camNum = mod(Number(open[1]) + 6, 12) + 1;
    return fromCamelot(camNum, open[2].toLowerCase() === 'd' ? 'B' : 'A');
  }

  const m = NOTE_RE.exec(s);
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let tonic = base[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') tonic += 1;
  if (m[2] === 'b' || m[2] === '♭') tonic -= 1;
  const rest = m[3].trim().toLowerCase();
  let mode: 'major' | 'minor' = 'major';
  if (rest === 'm' || rest.startsWith('min') || rest === '-' || rest === 'mi') mode = 'minor';
  else if (rest === '' || rest.startsWith('maj') || rest === 'M') mode = 'major';
  else if (/^m\b/.test(rest)) mode = 'minor';
  return { tonic: mod(tonic, 12), mode };
}
