import {
  applyGainCurve,
  master,
  mixInto,
  mulberry32,
  pingPong,
  place,
  reverb,
  sidechainCurve,
  stereo,
  sweepFilter,
  type Stereo,
} from './synth';
import * as I from './instruments';
import { CHORD_INTERVALS, type ChordType, type DemoRecipe, type StyleId } from './recipes';

type Section = 'intro' | 'build' | 'main' | 'breakdown' | 'drop' | 'outro';

interface Flags {
  kick: boolean;
  clap: boolean;
  snare: boolean;
  hat: boolean;
  openHat: boolean;
  perc: boolean;
  shaker: boolean;
  ride: boolean;
  bass: boolean;
  chords: boolean;
  pad: boolean;
  lead: boolean;
}

type BassStep = [step: number, len: number, octave: number, vel: number];
type PartName = 'bass' | 'chords' | 'supersaw' | 'pad' | 'lead';

interface StyleDef {
  arrangement: [Section, number][];
  swing: number;
  kick: Partial<I.KickOpts>;
  pat: {
    kick: string;
    clap?: string;
    snare?: string;
    hat: string;
    openHat?: string;
    perc?: string;
    shaker?: string;
    ride?: string;
  };
  bass: BassStep[];
  bassPatch: I.BassPatch;
  chordMode: 'ep' | 'pad' | 'stab' | 'strings';
  chordRhythm: [number, number][];
  chordCenter: number;
  dropSupersaw?: boolean;
  leadMode: 'arp' | 'hook' | 'none';
  lead: I.PluckPatch;
  leadOctave: number;
  delayBeats: number;
  reverb: { size: number; damp: number; wet: number };
  sidechain: number;
  crackle?: number;
  flags: (s: Section, bar: number, bars: number) => Flags;
}

const NONE: Flags = {
  kick: false,
  clap: false,
  snare: false,
  hat: false,
  openHat: false,
  perc: false,
  shaker: false,
  ride: false,
  bass: false,
  chords: false,
  pad: false,
  lead: false,
};

function houseFlags(s: Section, b: number, n: number): Flags {
  const late = b >= n / 2;
  switch (s) {
    case 'intro':
      return { ...NONE, kick: true, hat: true, perc: b >= 8, shaker: b >= 12 };
    case 'build':
      return {
        ...NONE,
        kick: true,
        clap: true,
        hat: true,
        openHat: true,
        perc: true,
        shaker: true,
        bass: true,
      };
    case 'main':
      return {
        ...NONE,
        kick: true,
        clap: true,
        hat: true,
        openHat: true,
        perc: true,
        shaker: true,
        bass: true,
        chords: true,
        lead: late,
      };
    case 'breakdown':
      return { ...NONE, chords: true, pad: true, lead: b >= 2, shaker: b >= n - 4 };
    case 'drop':
      return {
        ...NONE,
        kick: true,
        clap: true,
        hat: true,
        openHat: true,
        perc: true,
        shaker: true,
        ride: true,
        bass: true,
        chords: true,
        lead: true,
      };
    case 'outro':
      return { ...NONE, kick: true, clap: !late, hat: true, perc: true, shaker: true };
  }
}

function dnbFlags(s: Section, b: number, n: number): Flags {
  switch (s) {
    case 'intro':
      return { ...NONE, hat: true, ride: b >= 8, pad: true, kick: b >= 8, snare: b >= 8 };
    case 'breakdown':
      return { ...NONE, pad: true, chords: true, lead: true, hat: b >= n - 4 };
    case 'outro':
      return { ...NONE, kick: true, snare: true, hat: true, ride: b < n / 2, shaker: true, bass: b < n / 2 };
    default:
      return {
        ...NONE,
        kick: true,
        snare: true,
        hat: true,
        ride: true,
        shaker: true,
        perc: s === 'drop',
        bass: true,
        chords: true,
        lead: s === 'drop' || b >= n / 2,
      };
  }
}

function hiphopFlags(s: Section, b: number, n: number): Flags {
  switch (s) {
    case 'intro':
      return { ...NONE, chords: true, hat: b >= n / 2 };
    case 'outro':
      return { ...NONE, kick: true, snare: true, hat: true, chords: true, bass: b < n / 2 };
    case 'drop':
      return {
        ...NONE,
        kick: true,
        snare: true,
        hat: true,
        openHat: true,
        perc: true,
        bass: true,
        chords: true,
        lead: true,
      };
    default:
      return { ...NONE, kick: true, snare: true, hat: true, bass: true, chords: true };
  }
}

const HOUSE_ARR: [Section, number][] = [
  ['intro', 16],
  ['build', 8],
  ['main', 24],
  ['breakdown', 8],
  ['drop', 24],
  ['outro', 16],
];

const softPluck: I.PluckPatch = {
  cutoff: 500,
  envAmt: 3200,
  decay: 0.22,
  filterDecay: 0.09,
  wave: 'saw',
  detuneCents: 9,
  gain: 0.16,
};

const STYLES: Record<StyleId, StyleDef> = {
  deephouse: {
    arrangement: HOUSE_ARR,
    swing: 0.1,
    kick: { f0: 150, f1: 46, decay: 0.32, drive: 1.5, click: 0.25 },
    pat: {
      kick: 'X---X---X---X---',
      clap: '----x-------x---',
      hat: '..x...x...x...x.',
      openHat: '--o---o---o---o-',
      perc: '---.--o----.-o--',
      shaker: 'o.x.o.x.o.x.o.x.',
      ride: '--x---x---x---x-',
    },
    bass: [
      [2, 2, 0, 1],
      [6, 2, 0, 0.85],
      [10, 2, 0, 1],
      [13, 1, 0, 0.6],
      [14, 2, 0, 0.9],
    ],
    bassPatch: {
      wave: 'saw',
      cutoff: 220,
      envAmt: 500,
      filterDecay: 0.08,
      ampDecay: 0.5,
      res: 1.1,
      sub: 0.7,
      drive: 1.6,
      release: 0.05,
    },
    chordMode: 'ep',
    chordRhythm: [
      [0, 5],
      [7, 3],
      [10, 5],
    ],
    chordCenter: 64,
    leadMode: 'hook',
    lead: { ...softPluck, cutoff: 700, decay: 0.3 },
    leadOctave: 72,
    delayBeats: 0.75,
    reverb: { size: 0.75, damp: 0.4, wet: 0.35 },
    sidechain: 0.45,
    flags: houseFlags,
  },
  techhouse: {
    arrangement: HOUSE_ARR,
    swing: 0.06,
    kick: { f0: 170, f1: 48, decay: 0.28, drive: 2.2, click: 0.4 },
    pat: {
      kick: 'X---X---X---X---',
      clap: '----X-------X---',
      hat: 'xox.xox.xox.xox.',
      openHat: '--x---x---x---x-',
      perc: 'o--o--o---o--o.-',
      shaker: '.x.x.x.x.x.x.x.x',
      ride: '--o---o---o---o-',
    },
    bass: [
      [1, 1, 0, 0.7],
      [2, 1, 0, 1],
      [3, 1, 1, 0.6],
      [5, 1, 0, 0.7],
      [6, 1, 0, 1],
      [9, 1, 0, 0.7],
      [10, 1, 0, 1],
      [11, 1, 1, 0.6],
      [13, 1, 0, 0.7],
      [14, 1, 0, 1],
    ],
    bassPatch: {
      wave: 'square',
      cutoff: 180,
      envAmt: 900,
      filterDecay: 0.05,
      ampDecay: 0.14,
      res: 1.6,
      sub: 0.6,
      drive: 2,
      release: 0.03,
    },
    chordMode: 'stab',
    chordRhythm: [
      [3, 1],
      [11, 1],
    ],
    chordCenter: 62,
    leadMode: 'hook',
    lead: {
      cutoff: 900,
      envAmt: 2400,
      decay: 0.12,
      filterDecay: 0.05,
      wave: 'square',
      detuneCents: 7,
      gain: 0.12,
    },
    leadOctave: 74,
    delayBeats: 0.5,
    reverb: { size: 0.6, damp: 0.5, wet: 0.25 },
    sidechain: 0.4,
    flags: houseFlags,
  },
  techno: {
    arrangement: HOUSE_ARR,
    swing: 0,
    kick: { f0: 180, f1: 44, decay: 0.36, drive: 2.6, click: 0.5, length: 0.5 },
    pat: {
      kick: 'X---X---X---X---',
      clap: '----o-------o---',
      hat: 'x.x.x.x.x.x.x.x.',
      openHat: '--x---x---x---x-',
      perc: '-.-o-.---.-o-.--',
      shaker: '',
      ride: '--x---x---x---x-',
    },
    bass: [
      [2, 1, 0, 1],
      [3, 1, 0, 0.55],
      [6, 1, 0, 1],
      [7, 1, 0, 0.55],
      [10, 1, 0, 1],
      [11, 1, 0, 0.55],
      [14, 1, 0, 1],
      [15, 1, 0, 0.55],
    ],
    bassPatch: {
      wave: 'saw',
      cutoff: 140,
      envAmt: 420,
      filterDecay: 0.06,
      ampDecay: 0.16,
      res: 1.3,
      sub: 0.8,
      drive: 2.4,
      release: 0.03,
    },
    chordMode: 'pad',
    chordRhythm: [],
    chordCenter: 58,
    leadMode: 'arp',
    lead: {
      cutoff: 300,
      envAmt: 2600,
      decay: 0.11,
      filterDecay: 0.04,
      wave: 'saw',
      detuneCents: 12,
      gain: 0.13,
    },
    leadOctave: 60,
    delayBeats: 0.75,
    reverb: { size: 0.9, damp: 0.5, wet: 0.35 },
    sidechain: 0.5,
    flags: (s, b, n) => {
      const f = houseFlags(s, b, n);
      return { ...f, chords: s === 'breakdown' || s === 'drop', ride: f.ride || s === 'main', shaker: false };
    },
  },
  nudisco: {
    arrangement: HOUSE_ARR,
    swing: 0.05,
    kick: { f0: 140, f1: 52, decay: 0.24, drive: 1.4, click: 0.3 },
    pat: {
      kick: 'X---X---X---X---',
      clap: '----X-------X---',
      hat: 'x.x.x.x.x.x.x.x.',
      openHat: '--X---X---X---X-',
      perc: 'o-.-o-.-o-.-o-.-',
      shaker: '.xxx.xxx.xxx.xxx',
      ride: '',
    },
    bass: [
      [0, 1, 0, 1],
      [2, 1, 1, 0.85],
      [4, 1, 0, 1],
      [6, 1, 1, 0.85],
      [8, 1, 0, 1],
      [10, 1, 1, 0.85],
      [12, 1, 0, 1],
      [14, 1, 1, 0.85],
    ],
    bassPatch: {
      wave: 'saw',
      cutoff: 380,
      envAmt: 1400,
      filterDecay: 0.07,
      ampDecay: 0.18,
      res: 1.2,
      sub: 0.5,
      drive: 1.5,
      release: 0.04,
    },
    chordMode: 'strings',
    chordRhythm: [
      [2, 2],
      [6, 2],
      [10, 2],
      [14, 2],
    ],
    chordCenter: 66,
    leadMode: 'hook',
    lead: {
      cutoff: 1500,
      envAmt: 3000,
      decay: 0.25,
      filterDecay: 0.08,
      wave: 'square',
      detuneCents: 5,
      gain: 0.12,
    },
    leadOctave: 76,
    delayBeats: 0.75,
    reverb: { size: 0.7, damp: 0.35, wet: 0.3 },
    sidechain: 0.3,
    flags: houseFlags,
  },
  progressive: {
    arrangement: [
      ['intro', 16],
      ['build', 8],
      ['main', 24],
      ['breakdown', 16],
      ['drop', 16],
      ['outro', 16],
    ],
    swing: 0,
    kick: { f0: 165, f1: 46, decay: 0.3, drive: 2, click: 0.35 },
    pat: {
      kick: 'X---X---X---X---',
      clap: '----X-------X---',
      hat: '..x...x...x...x.',
      openHat: '--x---x---x---x-',
      perc: '.x.x.x.x.x.x.x.x',
      shaker: '',
      ride: 'x.x.x.x.x.x.x.x.',
    },
    bass: [
      [0, 2, 0, 0.8],
      [2, 2, 0, 1],
      [4, 2, 0, 0.8],
      [6, 2, 0, 1],
      [8, 2, 0, 0.8],
      [10, 2, 0, 1],
      [12, 2, 0, 0.8],
      [14, 2, 0, 1],
    ],
    bassPatch: {
      wave: 'saw',
      cutoff: 260,
      envAmt: 700,
      filterDecay: 0.06,
      ampDecay: 0.2,
      res: 1,
      sub: 0.6,
      drive: 1.6,
      release: 0.04,
    },
    chordMode: 'pad',
    chordRhythm: [],
    chordCenter: 62,
    dropSupersaw: true,
    leadMode: 'arp',
    lead: softPluck,
    leadOctave: 64,
    delayBeats: 0.75,
    reverb: { size: 0.85, damp: 0.3, wet: 0.4 },
    sidechain: 0.6,
    flags: houseFlags,
  },
  dnb: {
    arrangement: [
      ['intro', 16],
      ['main', 32],
      ['breakdown', 8],
      ['drop', 24],
      ['outro', 16],
    ],
    swing: 0,
    kick: { f0: 160, f1: 52, decay: 0.2, drive: 2, click: 0.45, length: 0.32 },
    pat: {
      kick: 'X---------X-----',
      snare: '----X-------X---',
      hat: 'x.x.x.x.x.x.x.x.',
      openHat: '',
      perc: '-------o-----o--',
      shaker: '.o.o.o.o.o.o.o.o',
      ride: '--x---x---x---x-',
    },
    bass: [
      [0, 6, 0, 1],
      [7, 3, 0, 0.8],
      [10, 6, 0, 1],
    ],
    bassPatch: {
      wave: 'reese',
      cutoff: 420,
      envAmt: 300,
      filterDecay: 0.3,
      ampDecay: 0,
      res: 0.9,
      sub: 0.8,
      drive: 1.8,
      release: 0.06,
    },
    chordMode: 'ep',
    chordRhythm: [
      [0, 10],
      [10, 6],
    ],
    chordCenter: 64,
    leadMode: 'hook',
    lead: {
      cutoff: 1800,
      envAmt: 2000,
      decay: 0.35,
      filterDecay: 0.12,
      wave: 'square',
      detuneCents: 4,
      gain: 0.11,
    },
    leadOctave: 76,
    delayBeats: 0.75,
    reverb: { size: 0.85, damp: 0.3, wet: 0.4 },
    sidechain: 0.25,
    flags: dnbFlags,
  },
  hiphop: {
    arrangement: [
      ['intro', 4],
      ['main', 16],
      ['drop', 8],
      ['main', 16],
      ['drop', 8],
      ['outro', 8],
    ],
    swing: 0.17,
    kick: { f0: 120, f1: 50, decay: 0.3, drive: 1.6, click: 0.2 },
    pat: {
      kick: 'X------x--X-----',
      snare: '----X-------X---',
      hat: 'x.x.x.x.x.x.x.x.',
      openHat: '--------------o-',
      perc: '---------.----.-',
      shaker: '',
      ride: '',
    },
    bass: [
      [0, 6, 0, 1],
      [7, 2, 0, 0.8],
      [10, 5, 0, 0.95],
    ],
    bassPatch: {
      wave: 'sine',
      cutoff: 400,
      envAmt: 0,
      filterDecay: 0.1,
      ampDecay: 0.7,
      res: 0.7,
      sub: 0,
      drive: 1.4,
      release: 0.08,
      glide: 1.25,
    },
    chordMode: 'ep',
    chordRhythm: [
      [0, 7],
      [7, 3],
      [10, 6],
    ],
    chordCenter: 62,
    leadMode: 'hook',
    lead: {
      cutoff: 2000,
      envAmt: 1000,
      decay: 0.5,
      filterDecay: 0.2,
      wave: 'square',
      detuneCents: 3,
      gain: 0.08,
    },
    leadOctave: 77,
    delayBeats: 1.5,
    reverb: { size: 0.6, damp: 0.6, wet: 0.3 },
    sidechain: 0.15,
    crackle: 0.05,
    flags: hiphopFlags,
  },
  melodic: {
    arrangement: HOUSE_ARR,
    swing: 0,
    kick: { f0: 160, f1: 45, decay: 0.33, drive: 1.9, click: 0.3 },
    pat: {
      kick: 'X---X---X---X---',
      clap: '----o-------o---',
      hat: '..x...x...x...x.',
      openHat: '--o---o---o---o-',
      perc: '.-.-.-.-.-.-.-.-',
      shaker: '.x.x.x.x.x.x.x.x',
      ride: '',
    },
    bass: [
      [0, 3, 0, 1],
      [3, 3, 0, 0.75],
      [6, 2, 0, 0.9],
      [8, 3, 0, 1],
      [11, 3, 0, 0.75],
      [14, 2, 0, 0.9],
    ],
    bassPatch: {
      wave: 'saw',
      cutoff: 200,
      envAmt: 600,
      filterDecay: 0.1,
      ampDecay: 0.3,
      res: 1.2,
      sub: 0.7,
      drive: 1.7,
      release: 0.05,
    },
    chordMode: 'pad',
    chordRhythm: [],
    chordCenter: 63,
    leadMode: 'arp',
    lead: { ...softPluck, cutoff: 600, decay: 0.18 },
    leadOctave: 64,
    delayBeats: 0.75,
    reverb: { size: 0.9, damp: 0.3, wet: 0.45 },
    sidechain: 0.5,
    flags: houseFlags,
  },
};

const VEL: Record<string, number> = { X: 1, x: 0.8, o: 0.55, '.': 0.3 };

function hit(pattern: string | undefined, bar: number, step: number): number {
  if (!pattern) return 0;
  const ch = pattern[(bar * 16 + step) % pattern.length];
  return VEL[ch] ?? 0;
}

function voice(tonic: number, root: number, type: ChordType, center: number): number[] {
  const base = 48 + tonic + root;
  const notes = CHORD_INTERVALS[type].map((i) => {
    let n = base + i;
    while (n < center - 7) n += 12;
    while (n > center + 6) n -= 12;
    return n;
  });
  return [...new Set(notes)].sort((a, b) => a - b);
}

function bassMidi(tonic: number, root: number): number {
  let base = 24 + tonic;
  if (base < 28) base += 12;
  let n = base + (root % 12);
  if (n > base + 7) n -= 12;
  return n;
}

export interface RenderedDemo {
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  duration: number;
  /** Grid anchor: the first downbeat (seconds). */
  firstBeat: number;
}

/** Render a demo track deterministically at any sample rate. */
export function renderDemo(recipe: DemoRecipe, sr: number): RenderedDemo {
  const style = STYLES[recipe.style];
  const rnd = mulberry32(recipe.seed);
  const tonic = recipe.key.tonic;
  const beat = 60 / recipe.bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const totalBars = style.arrangement.reduce((a, [, n]) => a + n, 0);
  const tail = 2.5;
  const len = Math.ceil((totalBars * bar + tail) * sr);

  const drums = stereo(len);
  const bass = stereo(len);
  const music = stereo(len);
  const fx = stereo(len);
  const send = stereo(len);
  const delaySend = stereo(len);

  // One-shots.
  const kickS = I.kick(sr, style.kick);
  const clapS = I.clap(sr, rnd);
  const snareS = I.snare(
    sr,
    rnd,
    recipe.style === 'dnb'
      ? { tone: 210, decay: 0.15, bright: 2200 }
      : recipe.style === 'hiphop'
        ? { tone: 175, decay: 0.1, bright: 900, dark: 5200 }
        : {},
  );
  const hatS = I.hat(sr, rnd, 0.04);
  const ohatS = I.hat(sr, rnd, 0.16);
  const rideS = I.ride(sr, rnd);
  const shakerS = I.shaker(sr, rnd);
  const congaHi = I.conga(sr, 380);
  const congaLo = I.conga(sr, 260);
  const rimS = I.rim(sr, rnd);
  const crashS = I.crash(sr, rnd);
  const impactS = I.impact(sr);

  const kicks: number[] = [];
  const chords = recipe.progression.map(([root, type]) => ({
    notes: voice(tonic, root, type, style.chordCenter),
    bass: bassMidi(tonic, root),
  }));

  // Melodic hook: 2 bars on the pentatonic scale, seeded.
  const scale = recipe.key.mode === 'minor' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const hookSteps = [
    [0, 3, 6, 10, 14, 19, 22, 26],
    [0, 2, 6, 8, 12, 16, 20, 24, 27],
    [2, 6, 10, 13, 16, 22, 26, 30],
  ][Math.floor(rnd() * 3)];
  let deg = 2;
  const hook = hookSteps.map((s, i) => {
    deg = Math.max(0, Math.min(scale.length * 2 - 1, deg + Math.round((rnd() - 0.45) * 3)));
    const n = style.leadOctave + tonic + scale[deg % scale.length] + 12 * Math.floor(deg / scale.length) - 12;
    const next = hookSteps[i + 1] ?? 32;
    return { step: s, len: Math.min(4, next - s), midi: n, vel: 0.7 + rnd() * 0.3 };
  });
  const arpShape = [
    [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3],
    [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 2, 4, 3, 5],
  ][Math.floor(rnd() * 2)];

  // ---- Tonal parts are rendered once per chord-cycle position and reused (loop cache).
  const barLen = Math.round(bar * sr);
  const renderPartBar = (name: PartName, dst: Stereo, t0: number, k: number) => {
    const ch = chords[k % chords.length];
    const barStart = t0;
    switch (name) {
      case 'bass':
        for (const [s, l, oct, vel] of style.bass) {
          const t = barStart + s * step + (s % 2 === 1 ? style.swing * step : 0);
          I.bassNote(dst, t * sr, l * step * 0.92, ch.bass + 12 * oct, vel, sr, style.bassPatch);
        }
        break;
      case 'chords': {
        const notes = ch.notes;
        switch (style.chordMode) {
          case 'ep':
            for (const [s, l] of style.chordRhythm) {
              notes.forEach((n, j) => {
                const t = barStart + s * step + j * 0.004;
                I.epNote(
                  dst,
                  t * sr,
                  l * step,
                  n,
                  0.75,
                  sr,
                  (j / Math.max(1, notes.length - 1) - 0.5) * 0.6,
                  0.2,
                );
              });
            }
            break;
          case 'stab':
            for (const [s] of style.chordRhythm)
              I.stab(dst, (barStart + s * step) * sr, notes, 0.9, sr, 0.16, 2000, 0.2);
            break;
          case 'strings':
            I.padChord(
              dst,
              barStart * sr,
              bar,
              notes.map((n) => n + 12),
              sr,
              { attack: 0.25, release: 0.4, cutoff: 3200, detuneCents: 10, voices: 2, gain: 0.16 },
            );
            for (const [s, l] of style.chordRhythm) {
              notes.forEach((n, j) =>
                I.epNote(dst, (barStart + s * step + j * 0.003) * sr, l * step, n, 0.6, sr, 0.2, 0.12),
              );
            }
            break;
          case 'pad':
            I.padChord(dst, barStart * sr, bar * 0.98, notes, sr, {
              attack: 0.08,
              release: 0.3,
              cutoff: 1800,
              detuneCents: 12,
              voices: 3,
              gain: 0.14,
            });
            break;
        }
        break;
      }
      case 'supersaw':
        I.padChord(
          dst,
          barStart * sr,
          bar * 0.95,
          ch.notes.map((n) => n + 12),
          sr,
          { attack: 0.01, release: 0.25, cutoff: 5200, detuneCents: 22, voices: 5, gain: 0.16 },
        );
        break;
      case 'pad':
        I.padChord(dst, barStart * sr, bar, ch.notes, sr, {
          attack: 0.6,
          release: 1.2,
          cutoff: 1400,
          detuneCents: 14,
          voices: 3,
          gain: 0.18,
        });
        break;
      case 'lead':
        if (style.leadMode === 'arp') {
          const pool = [...ch.notes, ...ch.notes.map((n) => n + 12)].map(
            (n) => n + (style.leadOctave - style.chordCenter),
          );
          for (let s = 0; s < 16; s++) {
            const n = pool[arpShape[s] % pool.length];
            const vel = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.75 : 0.55;
            I.pluckNote(
              dst,
              (barStart + s * step) * sr,
              step * 0.9,
              n,
              vel,
              sr,
              style.lead,
              s % 2 ? 0.25 : -0.25,
            );
          }
        } else if (style.leadMode === 'hook') {
          const half = k % 2;
          for (const h of hook) {
            if (Math.floor(h.step / 16) !== half) continue;
            I.pluckNote(
              dst,
              (barStart + (h.step % 16) * step) * sr,
              h.len * step,
              h.midi,
              h.vel,
              sr,
              style.lead,
              0.1,
            );
          }
        }
        break;
    }
  };

  const makePart = (
    name: PartName,
    out: { bus: Stereo; gain: number }[],
    active: (f: Flags, s: Section) => boolean,
  ) => {
    let steady: Stereo | null = null;
    const single = new Map<number, Stereo>();
    const on = new Uint8Array(totalBars);
    const getSteady = () => {
      if (!steady) {
        const tmp = stereo(barLen * 9);
        for (let b = 0; b < 8; b++) renderPartBar(name, tmp, b * bar, b % 4);
        steady = { L: tmp.L.slice(barLen * 4, barLen * 8), R: tmp.R.slice(barLen * 4, barLen * 8) };
      }
      return steady;
    };
    const getSingle = (k: number) => {
      let b = single.get(k);
      if (!b) {
        b = stereo(barLen * 3);
        renderPartBar(name, b, 0, k);
        single.set(k, b);
      }
      return b;
    };
    const copy = (src: Stereo, from: number, n: number, at: number) => {
      for (const o of out) {
        const end = Math.min(n, len - at);
        for (let i = 0; i < end; i++) {
          o.bus.L[at + i] += src.L[from + i] * o.gain;
          o.bus.R[at + i] += src.R[from + i] * o.gain;
        }
      }
    };
    return {
      active,
      mark: (b: number, isOn: boolean) => {
        on[b] = isOn ? 1 : 0;
      },
      flush: () => {
        for (let b = 0; b < totalBars; b++) {
          const at = Math.round(b * bar * sr);
          const k = b % 4;
          if (on[b]) {
            if (b > 0 && on[b - 1]) copy(getSteady(), k * barLen, barLen, at);
            else copy(getSingle(k), 0, barLen, at);
            if (b + 1 >= totalBars || !on[b + 1])
              copy(getSingle(k), barLen, barLen * 2, Math.round((b + 1) * bar * sr));
          }
        }
      },
    };
  };

  const parts = [
    makePart('bass', [{ bus: bass, gain: 1 }], (f) => f.bass),
    makePart(
      'chords',
      [
        { bus: music, gain: 1 },
        { bus: send, gain: style.chordMode === 'stab' ? 0.6 : 0.35 },
      ],
      (f, s) => f.chords && !(style.chordMode === 'pad' && s === 'breakdown' && f.pad),
    ),
    makePart(
      'supersaw',
      [
        { bus: music, gain: 1 },
        { bus: send, gain: 0.3 },
      ],
      (f, s) => !!style.dropSupersaw && f.chords && s === 'drop',
    ),
    makePart(
      'pad',
      [
        { bus: music, gain: 1 },
        { bus: send, gain: 0.65 },
      ],
      (f) => f.pad,
    ),
    makePart(
      'lead',
      [
        { bus: music, gain: 1 },
        { bus: delaySend, gain: 0.8 },
        { bus: send, gain: 0.2 },
      ],
      (f) => f.lead && style.leadMode !== 'none',
    ),
  ];

  const sweeps: [number, number][] = [];
  let barIdx = 0;
  for (let si = 0; si < style.arrangement.length; si++) {
    const [section, nBars] = style.arrangement[si];
    const secStart = barIdx * bar;
    const prev = si > 0 ? style.arrangement[si - 1][0] : null;

    // Section accents.
    if (
      section === 'drop' ||
      (section === 'main' && prev !== null && prev !== 'build') ||
      section === 'build'
    ) {
      place(fx, crashS, secStart * sr, 0.32, 0.1);
    }
    if (section === 'drop' && prev === 'breakdown') place(fx, impactS, secStart * sr, 0.5);
    if (section === 'breakdown') {
      const rBars = Math.min(4, nBars);
      const r = I.riser(sr, rnd, rBars * bar);
      mixInto(fx, r, 1, Math.round((secStart + (nBars - rBars) * bar) * sr));
    }

    for (let b = 0; b < nBars; b++, barIdx++) {
      const f = style.flags(section, b, nBars);
      const barStart = barIdx * bar;

      for (let s = 0; s < 16; s++) {
        const swing = s % 2 === 1 ? style.swing * step : 0;
        const t = barStart + s * step + swing;
        const human = () => (rnd() - 0.5) * 0.004;
        const at = (x: number) => Math.max(0, (t + x) * sr);
        let v: number;
        if (f.kick && (v = hit(style.pat.kick, barIdx, s))) {
          place(drums, kickS, at(0), 0.95 * v);
          kicks.push(at(0));
        }
        if (f.clap && (v = hit(style.pat.clap, barIdx, s))) {
          place(drums, clapS, at(0.003), 0.42 * v, 0);
          place(send, clapS, at(0.003), 0.18 * v);
        }
        if (f.snare && (v = hit(style.pat.snare, barIdx, s))) place(drums, snareS, at(0), 0.5 * v);
        if (f.hat && (v = hit(style.pat.hat, barIdx, s)))
          place(drums, hatS, at(human()), 0.2 * v * (0.85 + rnd() * 0.3), s % 4 === 2 ? 0.25 : -0.15);
        if (f.openHat && (v = hit(style.pat.openHat, barIdx, s)))
          place(drums, ohatS, at(human()), 0.2 * v, -0.2);
        if (f.ride && (v = hit(style.pat.ride, barIdx, s))) place(drums, rideS, at(human()), 0.12 * v, 0.3);
        if (f.shaker && (v = hit(style.pat.shaker, barIdx, s)))
          place(drums, shakerS, at(human()), 0.13 * v, 0.35);
        if (f.perc && (v = hit(style.pat.perc, barIdx, s))) {
          const which = (barIdx + s) % 3;
          const smp = which === 0 ? congaHi : which === 1 ? congaLo : rimS;
          place(drums, smp, at(human()), 0.22 * v, which === 0 ? 0.45 : which === 1 ? -0.4 : 0.15);
        }
      }

      // Snare roll at the end of breakdowns.
      if (section === 'breakdown' && b >= nBars - 2) {
        const div = b === nBars - 1 ? 8 : 4;
        for (let k = 0; k < 4 * div; k++) {
          const frac = (b - (nBars - 2) + k / (4 * div)) / 2;
          place(drums, snareS, (barStart + (k * beat) / div) * sr, 0.12 + 0.3 * frac);
        }
      }

      for (const part of parts) part.mark(barIdx, part.active(f, section));
    }

    // Breakdown: open the filter on the music bus across the section (applied after the parts are placed).
    if (section === 'breakdown')
      sweeps.push([Math.round(secStart * sr), Math.round((secStart + nBars * bar) * sr)]);
  }

  // Breakdown filter sweeps were applied to `music` before the tonal parts landed;
  // place the parts first, then sweep. (Handled below.)
  for (const p of parts) p.flush();
  for (const [a, e] of sweeps) sweepFilter(music, a, e, sr, (p) => 700 * Math.pow(18000 / 700, p * p), 0.9);

  // Effects & mixdown.
  pingPong(delaySend, music, sr, beat * style.delayBeats, 0.45, 0.35);
  reverb(send, music, sr, style.reverb);
  if (style.sidechain > 0) {
    const curve = sidechainCurve(len, kicks, sr, style.sidechain, beat * 0.32);
    applyGainCurve(music, curve);
    const bassCurve = sidechainCurve(len, kicks, sr, Math.min(0.9, style.sidechain * 1.3), beat * 0.25);
    applyGainCurve(bass, bassCurve);
  }
  if (style.crackle) I.crackle(fx, sr, rnd, style.crackle);

  // Mix down into the drum bus in place (saves two full-length allocations).
  const out: Stereo = drums;
  for (let i = 0; i < len; i++) {
    out.L[i] += bass.L[i] * 0.9 + music.L[i] + fx.L[i] * 0.8;
    out.R[i] += bass.R[i] * 0.9 + music.R[i] + fx.R[i] * 0.8;
  }
  master(out, 1.3, 0.93);

  return { L: out.L, R: out.R, sampleRate: sr, duration: len / sr, firstBeat: 0 };
}
