/** Shared domain types used across the app (engine, library, AI, UI). */

export type DeckId = 0 | 1;
export const DECKS: readonly DeckId[] = [0, 1] as const;
export const deckLetter = (d: DeckId): 'A' | 'B' => (d === 0 ? 'A' : 'B');
export const otherDeck = (d: DeckId): DeckId => (d === 0 ? 1 : 0);

export type KeyMode = 'major' | 'minor';

/** A musical key. `tonic` is a pitch class: C=0, C#=1 … B=11. */
export interface MusicalKey {
  tonic: number;
  mode: KeyMode;
}

export interface Beatgrid {
  /** Beats per minute of the original recording. */
  bpm: number;
  /** Time (seconds) of a downbeat (beat 1 of a bar) used as the grid anchor. */
  firstBeat: number;
}

/** Song structure hints used by the AI transition planner. Times are in seconds. */
export interface TrackStructure {
  /** Where the track should be mixed in (start of the intro, on a downbeat). */
  mixIn: number;
  /** End of the intro / where the full groove starts. */
  introEnd: number;
  /** Start of the outro – the ideal point to begin mixing out. */
  mixOut: number;
  /** The biggest energy jump (the drop), if any. */
  mainDrop: number | null;
  /** Phrase boundaries (every 8 bars) with notable energy changes. */
  sections: {
    time: number;
    energy: number;
    label: 'intro' | 'build' | 'main' | 'breakdown' | 'drop' | 'outro';
  }[];
}

/** Compact per-track waveform: 150 points per second, 4 channels (peak, low, mid, high) 0..255. */
export interface WaveformData {
  pointsPerSecond: number;
  peak: Uint8Array;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
}

export interface TrackAnalysis {
  version: number;
  duration: number;
  beatgrid: Beatgrid;
  bpmConfidence: number;
  key: MusicalKey;
  keyConfidence: number;
  /** 1..10 – perceived energy, Mixed-In-Key style. */
  energy: number;
  /** Integrated loudness estimate in LUFS (used for auto-gain). */
  loudness: number;
  /** Per-bar energy 0..1 for the energy curve. */
  barEnergy: number[];
  structure: TrackStructure;
  /** Timbre fingerprint (MFCC stats + spectral descriptors) for similarity. */
  timbre: number[];
  /** Short human readable descriptors, e.g. ["dark", "driving"]. */
  mood: string[];
  danceability: number;
}

export interface HotCue {
  time: number;
  color: string;
  label?: string;
}

export type TrackSource =
  { kind: 'file'; blobKey: string; mime: string; fileName: string } | { kind: 'demo'; recipeId: string };

export interface TrackRecord {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  /** Year from tags, if any. */
  year?: number;
  /** BPM / key read from file tags (if present). */
  tagBpm?: number;
  tagKey?: string;
  duration: number;
  source: TrackSource;
  artworkKey?: string;
  addedAt: number;
  playCount: number;
  lastPlayedAt?: number;
  rating?: number;
  analysis?: TrackAnalysis;
  analysisError?: string;
  /** User overrides. */
  cuePoint?: number;
  hotCues?: (HotCue | null)[];
  gridOverride?: Beatgrid;
  keyOverride?: MusicalKey;
}

/** Decoded PCM ready to hand to the deck engine. */
export interface DecodedAudio {
  sampleRate: number;
  channels: Float32Array[];
  duration: number;
}
