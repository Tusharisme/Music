import type { MusicalKey } from '../../types';

export type ChordType = 'maj' | 'm' | 'maj7' | 'm7' | '7' | 'm9' | 'sus4' | 'add9';
export type StyleId =
  'deephouse' | 'techhouse' | 'techno' | 'nudisco' | 'progressive' | 'dnb' | 'hiphop' | 'melodic';

export interface DemoRecipe {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  key: MusicalKey;
  seed: number;
  style: StyleId;
  /** One chord per bar, repeating: [root (semitones above the tonic), chord type]. */
  progression: [number, ChordType][];
  /** Accent colour for artwork. */
  color: string;
  /** Curated energy level (1–10), like a Mixed In Key tag. */
  energy: number;
}

export const DEMO_ARTIST = 'MixMind Studio';

/**
 * The built-in crate. Keys and tempos are chosen so the AI has interesting
 * relationships to find: perfect key matches, ±1 Camelot moves, relative
 * major/minor swaps, tempo jumps and a half-time pair.
 */
export const DEMO_RECIPES: DemoRecipe[] = [
  {
    id: 'demo-midnight-drive',
    title: 'Midnight Drive',
    artist: DEMO_ARTIST,
    genre: 'Deep House',
    bpm: 122,
    key: { tonic: 9, mode: 'minor' },
    seed: 1101,
    style: 'deephouse',
    progression: [
      [0, 'm9'],
      [8, 'maj7'],
      [5, 'm9'],
      [7, 'm7'],
    ],
    color: '#38bdf8',
    energy: 5,
  },
  {
    id: 'demo-neon-pulse',
    title: 'Neon Pulse',
    artist: DEMO_ARTIST,
    genre: 'Tech House',
    bpm: 125,
    key: { tonic: 4, mode: 'minor' },
    seed: 2202,
    style: 'techhouse',
    progression: [
      [0, 'm7'],
      [0, 'm7'],
      [8, 'maj7'],
      [10, 'maj'],
    ],
    color: '#f472b6',
    energy: 7,
  },
  {
    id: 'demo-warehouse-ritual',
    title: 'Warehouse Ritual',
    artist: DEMO_ARTIST,
    genre: 'Techno',
    bpm: 130,
    key: { tonic: 5, mode: 'minor' },
    seed: 3303,
    style: 'techno',
    progression: [
      [0, 'm'],
      [0, 'm'],
      [8, 'maj'],
      [10, 'maj'],
    ],
    color: '#a3a3a3',
    energy: 8,
  },
  {
    id: 'demo-golden-hour',
    title: 'Golden Hour',
    artist: DEMO_ARTIST,
    genre: 'Nu-Disco',
    bpm: 118,
    key: { tonic: 0, mode: 'major' },
    seed: 4404,
    style: 'nudisco',
    progression: [
      [0, 'maj7'],
      [9, 'm7'],
      [2, 'm7'],
      [7, '7'],
    ],
    color: '#fbbf24',
    energy: 6,
  },
  {
    id: 'demo-skyline',
    title: 'Skyline',
    artist: DEMO_ARTIST,
    genre: 'Progressive House',
    bpm: 128,
    key: { tonic: 2, mode: 'minor' },
    seed: 5505,
    style: 'progressive',
    progression: [
      [0, 'm'],
      [8, 'maj'],
      [3, 'maj'],
      [10, 'maj'],
    ],
    color: '#818cf8',
    energy: 7,
  },
  {
    id: 'demo-liquid-motion',
    title: 'Liquid Motion',
    artist: DEMO_ARTIST,
    genre: 'Drum & Bass',
    bpm: 174,
    key: { tonic: 7, mode: 'minor' },
    seed: 6606,
    style: 'dnb',
    progression: [
      [0, 'm9'],
      [8, 'maj7'],
      [5, 'm9'],
      [7, 'm7'],
    ],
    color: '#2dd4bf',
    energy: 8,
  },
  {
    id: 'demo-late-night-tapes',
    title: 'Late Night Tapes',
    artist: DEMO_ARTIST,
    genre: 'Lo-fi Hip-Hop',
    bpm: 87,
    key: { tonic: 10, mode: 'minor' },
    seed: 7707,
    style: 'hiphop',
    progression: [
      [0, 'm9'],
      [8, 'maj7'],
      [5, 'm9'],
      [7, '7'],
    ],
    color: '#fb923c',
    energy: 3,
  },
  {
    id: 'demo-afterglow',
    title: 'Afterglow',
    artist: DEMO_ARTIST,
    genre: 'Melodic House',
    bpm: 124,
    key: { tonic: 9, mode: 'minor' },
    seed: 8808,
    style: 'melodic',
    progression: [
      [0, 'm'],
      [3, 'maj'],
      [10, 'maj'],
      [8, 'maj'],
    ],
    color: '#c084fc',
    energy: 6,
  },
];

export const CHORD_INTERVALS: Record<ChordType, number[]> = {
  maj: [0, 4, 7],
  m: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  m9: [0, 3, 7, 10, 14],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};
