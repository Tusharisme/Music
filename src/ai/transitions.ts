import type { TrackAnalysis, TrackRecord } from '../types';
import type { FxSettings } from '../audio/effects';
import { effectiveKey } from './harmonic';
import { bestKeyShift, type ShiftedMatch } from './harmonic';
import { tempoFit, trackBpm, trackKey, type TempoFit } from './recommender';

export type TechniqueId =
  | 'bass-swap'
  | 'long-blend'
  | 'filter-fade'
  | 'echo-out'
  | 'loop-roll'
  | 'quick-cut'
  | 'tempo-ramp'
  | 'reverb-wash'
  | 'spinback';

export const TECHNIQUES: Record<TechniqueId, { name: string; blurb: string; bars: number }> = {
  'bass-swap': {
    name: 'Bass-swap blend',
    blurb: 'Bring the new track in with its bass cut, swap the low end on the phrase, fade out.',
    bars: 16,
  },
  'long-blend': {
    name: 'Long harmonic blend',
    blurb: 'Keys match, so both tracks ride together for a long, layered blend.',
    bars: 32,
  },
  'filter-fade': {
    name: 'Filter fade',
    blurb: 'High-pass the outgoing track while the new one opens up from a low-pass.',
    bars: 8,
  },
  'echo-out': {
    name: 'Echo out',
    blurb: 'Throw an echo on the last bar, cut, and drop the new track on the one.',
    bars: 2,
  },
  'loop-roll': {
    name: 'Loop-roll build',
    blurb: 'Roll the outgoing loop shorter and shorter, then slam into the drop.',
    bars: 4,
  },
  'quick-cut': {
    name: 'Quick cut',
    blurb: 'Clean cut on the phrase – ideal for big genre or tempo changes.',
    bars: 1,
  },
  'tempo-ramp': {
    name: 'Tempo-ramp blend',
    blurb: 'Blend while gliding the tempo so the new track lands on its own BPM.',
    bars: 16,
  },
  'reverb-wash': {
    name: 'Reverb wash',
    blurb: 'Wash the outgoing track into reverb and low-pass it away.',
    bars: 8,
  },
  spinback: {
    name: 'Spinback',
    blurb: 'Vinyl spinback on the outgoing track, new track drops instantly.',
    bars: 1,
  },
};

export type LaneParam =
  | 'out.fader'
  | 'in.fader'
  | 'out.eqLow'
  | 'out.eqMid'
  | 'out.eqHigh'
  | 'in.eqLow'
  | 'in.eqMid'
  | 'in.eqHigh'
  | 'out.filter'
  | 'in.filter'
  | 'out.fxMix'
  | 'in.tempo';

export interface Lane {
  param: LaneParam;
  /** [beat, value] points, beats relative to the switch point (in deck start = beat 0). */
  points: [number, number][];
}

export type ActionKind = 'fx' | 'fxOff' | 'loop' | 'loopOff' | 'spinback' | 'brake' | 'stopOut' | 'sample';

export interface PlanAction {
  beat: number;
  kind: ActionKind;
  deck: 'out' | 'in';
  fx?: Partial<FxSettings>;
  beats?: number;
  pad?: number;
}

export interface TransitionPlan {
  technique: TechniqueId;
  name: string;
  bars: number;
  startBeat: number;
  endBeat: number;
  /** Outgoing track position (s) of beat 0 – a downbeat. */
  outSwitch: number;
  /** Incoming track start position (s) – a downbeat. */
  inStart: number;
  /** Incoming deck playback rate for tempo match. */
  inRate: number;
  /** Incoming deck final rate (differs only for tempo ramps). */
  inRateEnd: number;
  keyShift: number;
  lanes: Lane[];
  actions: PlanAction[];
  steps: { beat: number; text: string }[];
  summary: string;
}

export interface PlanInput {
  out: {
    track: TrackRecord;
    analysis: TrackAnalysis;
    rate: number;
    pos: number;
    keyLock: boolean;
    keyShift: number;
  };
  incoming: { track: TrackRecord; analysis: TrackAnalysis };
  technique?: TechniqueId;
  when: 'phrase' | 'now';
  bars?: number;
  allowKeyShift?: boolean;
}

const FLAT = 0.5;

function grid(t: TrackRecord, a: TrackAnalysis) {
  const bpm = trackBpm(t) || a.beatgrid.bpm;
  const firstBeat = t.gridOverride?.firstBeat ?? a.beatgrid.firstBeat;
  return { bpm, beat: 60 / bpm, firstBeat };
}

export function chooseTechnique(
  h: ShiftedMatch,
  tempo: TempoFit,
  dE: number,
  introBars: number,
  outroBars: number,
): TechniqueId {
  if (tempo.stretch > 0.12) return dE >= 2 ? 'spinback' : 'echo-out';
  if (dE >= 3) return 'loop-roll';
  if (h.score < 0.45) return tempo.stretch < 0.06 ? 'filter-fade' : 'echo-out';
  if (dE <= -3) return 'reverb-wash';
  if (tempo.stretch > 0.045) return 'tempo-ramp';
  if (h.score >= 0.85 && introBars >= 16 && outroBars >= 16) return 'long-blend';
  return 'bass-swap';
}

/** Lead time (beats before the switch point) a technique needs. */
function leadBeats(t: TechniqueId): number {
  switch (t) {
    case 'echo-out':
      return 8;
    case 'loop-roll':
      return 16;
    case 'quick-cut':
    case 'spinback':
      return 2;
    default:
      return 0;
  }
}

/**
 * Plan a transition from the playing track into the next one: technique, timing
 * (phrase aligned), tempo/key matching and beat-by-beat automation lanes.
 */
export function planTransition(input: PlanInput): TransitionPlan {
  const { out, incoming } = input;
  const go = grid(out.track, out.analysis);
  const gi = grid(incoming.track, incoming.analysis);
  const outKey = effectiveKey(trackKey(out.track) ?? out.analysis.key, out.rate, out.keyLock, out.keyShift);
  const inKey = trackKey(incoming.track) ?? incoming.analysis.key;
  const h =
    input.allowKeyShift === false ? { ...bestKeyShift(outKey, inKey, 0) } : bestKeyShift(outKey, inKey);
  const tempo = tempoFit(go.bpm * out.rate, gi.bpm);
  const dE = incoming.analysis.energy - out.analysis.energy;
  const sIn = incoming.analysis.structure;
  const sOut = out.analysis.structure;
  const introBars = Math.max(0, (sIn.introEnd - sIn.mixIn) / (gi.beat * 4));
  const outroBars = Math.max(0, (out.analysis.duration - sOut.mixOut) / (go.beat * 4));

  const technique = input.technique ?? chooseTechnique(h, tempo, dE, introBars, outroBars);
  const meta = TECHNIQUES[technique];
  let bars = input.bars ?? meta.bars;

  // ---- Switch point on the outgoing track (a downbeat; phrase aligned when possible).
  const lead = leadBeats(technique) + 2;
  const beatsFromGrid = (t: number) => (t - go.firstBeat) / go.beat;
  const posBeat = beatsFromGrid(out.pos) + lead + 1;
  let switchBeat: number;
  if (input.when === 'now') {
    switchBeat = Math.ceil(posBeat / 4) * 4;
  } else {
    const mixOutBeat = Math.round(beatsFromGrid(sOut.mixOut) / 4) * 4;
    switchBeat = mixOutBeat >= posBeat ? mixOutBeat : Math.ceil(posBeat / 32) * 32;
  }
  // Blends need music left on the outgoing track; shorten them if needed.
  const endBeatOut = beatsFromGrid(out.analysis.duration);
  const roomBars = Math.floor((endBeatOut - switchBeat) / 4) - 1;
  const isBlend = ['bass-swap', 'long-blend', 'filter-fade', 'tempo-ramp', 'reverb-wash'].includes(technique);
  if (isBlend) {
    if (roomBars < bars) bars = Math.max(4, Math.floor(roomBars / 4) * 4);
    if (roomBars < 4) {
      // Not enough room – fall back to the latest phrase-aligned point that fits.
      switchBeat = Math.max(Math.ceil(posBeat / 4) * 4, Math.floor((endBeatOut - bars * 4 - 4) / 4) * 4);
    }
  }
  const outSwitch = go.firstBeat + switchBeat * go.beat;

  // ---- Incoming start point.
  const strongStart = sIn.mainDrop ?? sIn.introEnd;
  let inStart = sIn.mixIn;
  if (technique === 'loop-roll') inStart = strongStart;
  else if (technique === 'quick-cut' || technique === 'spinback')
    inStart = sIn.introEnd > sIn.mixIn ? sIn.introEnd : sIn.mixIn;
  inStart = Math.max(0, inStart);

  const inRate = tempo.rate;
  const L = bars * 4;
  const lanes: Lane[] = [];
  const actions: PlanAction[] = [];
  const steps: { beat: number; text: string }[] = [];
  const lane = (param: LaneParam, points: [number, number][]) => lanes.push({ param, points });
  let startBeat = 0;
  let endBeat = L;
  let inRateEnd = inRate;

  switch (technique) {
    case 'bass-swap':
    case 'tempo-ramp': {
      const mid = Math.round(L / 2 / 4) * 4;
      lane('in.fader', [
        [0, 0],
        [L * 0.25, 1],
      ]);
      lane('in.eqLow', [
        [0, 0],
        [mid - 0.5, 0],
        [mid, FLAT],
      ]);
      lane('in.eqHigh', [
        [0, 0.35],
        [mid, FLAT],
      ]);
      lane('out.eqLow', [
        [mid - 0.5, FLAT],
        [mid, 0],
      ]);
      lane('out.eqHigh', [
        [mid, FLAT],
        [L, 0.3],
      ]);
      lane('out.fader', [
        [L * 0.75, 1],
        [L, 0],
      ]);
      steps.push({ beat: 0, text: 'Start the new track on the downbeat, bass cut, fader rising' });
      steps.push({ beat: mid, text: 'Bass swap: kill the outgoing lows, bring the new bass in' });
      steps.push({ beat: L * 0.75, text: 'Fade the outgoing track out' });
      if (technique === 'tempo-ramp') {
        inRateEnd = 1;
        lane('in.tempo', [
          [0, inRate],
          [L, 1],
        ]);
        steps.push({ beat: 0, text: `Glide the tempo to ${gi.bpm.toFixed(1)} BPM over ${bars} bars` });
      }
      break;
    }
    case 'long-blend': {
      lane('in.fader', [
        [0, 0],
        [L * 0.2, 1],
      ]);
      lane('in.eqLow', [
        [0, 0],
        [L / 2 - 0.5, 0],
        [L / 2, FLAT],
      ]);
      lane('in.eqMid', [
        [0, 0.3],
        [L * 0.4, FLAT],
      ]);
      lane('out.eqLow', [
        [L / 2 - 0.5, FLAT],
        [L / 2, 0],
      ]);
      lane('out.eqMid', [
        [L / 2, FLAT],
        [L * 0.8, 0.25],
      ]);
      lane('out.fader', [
        [L * 0.8, 1],
        [L, 0],
      ]);
      steps.push({ beat: 0, text: 'Layer the new track under the outro (lows and mids tucked away)' });
      steps.push({ beat: L * 0.4, text: 'Open up the new track’s mids' });
      steps.push({ beat: L / 2, text: 'Bass swap on the phrase' });
      steps.push({ beat: L * 0.8, text: 'Fade out the outgoing track' });
      break;
    }
    case 'filter-fade': {
      lane('in.filter', [
        [0, -0.75],
        [L * 0.75, 0],
      ]);
      lane('in.fader', [
        [0, 0],
        [L * 0.25, 1],
      ]);
      lane('out.filter', [
        [0, 0],
        [L, 0.8],
      ]);
      lane('out.fader', [
        [L * 0.5, 1],
        [L, 0],
      ]);
      lane('in.eqLow', [
        [0, 0.15],
        [L / 2 - 0.5, 0.15],
        [L / 2, FLAT],
      ]);
      lane('out.eqLow', [
        [L / 2 - 0.5, FLAT],
        [L / 2, 0.05],
      ]);
      steps.push({ beat: 0, text: 'Bring the new track in behind a closed low-pass filter' });
      steps.push({ beat: 0, text: 'Sweep a high-pass up on the outgoing track' });
      steps.push({ beat: L / 2, text: 'Swap the bass and open the new track fully' });
      break;
    }
    case 'echo-out': {
      startBeat = -8;
      endBeat = 8;
      actions.push({
        beat: -8,
        kind: 'fx',
        deck: 'out',
        fx: { type: 'echo', beats: 0.75, param: 0.62, mix: 0.6, on: true },
      });
      lane('out.filter', [
        [-8, 0],
        [0, 0.45],
      ]);
      lane('out.fader', [
        [-0.5, 1],
        [0, 0],
      ]);
      lane('in.fader', [
        [-0.01, 0],
        [0, 1],
      ]);
      actions.push({ beat: 8, kind: 'fxOff', deck: 'out' });
      steps.push({ beat: -8, text: 'Echo on the outgoing track (¾ beat, long feedback)' });
      steps.push({ beat: 0, text: 'Cut the outgoing track – let the echo trail – drop the new track' });
      break;
    }
    case 'loop-roll': {
      startBeat = -16;
      endBeat = 4;
      const rolls: [number, number][] = [
        [-16, 4],
        [-8, 2],
        [-4, 1],
        [-2, 0.5],
        [-1, 0.25],
      ];
      for (const [b, size] of rolls) actions.push({ beat: b, kind: 'loop', deck: 'out', beats: size });
      lane('out.filter', [
        [-16, 0],
        [0, 0.7],
      ]);
      lane('out.fader', [
        [-0.25, 1],
        [0, 0],
      ]);
      lane('in.fader', [
        [-0.01, 0],
        [0, 1],
      ]);
      actions.push({ beat: 0, kind: 'loopOff', deck: 'out' });
      actions.push({ beat: 0, kind: 'sample', deck: 'in', pad: 4 });
      steps.push({ beat: -16, text: 'Loop the last bar and start halving it: 4 → 2 → 1 → ½ → ¼ beats' });
      steps.push({ beat: -16, text: 'High-pass sweep builds the tension' });
      steps.push({ beat: 0, text: 'Drop the new track straight into its peak' });
      break;
    }
    case 'quick-cut': {
      startBeat = -1;
      endBeat = 1;
      lane('out.fader', [
        [-0.1, 1],
        [0, 0],
      ]);
      lane('in.fader', [
        [-0.01, 0],
        [0, 1],
      ]);
      steps.push({ beat: 0, text: 'Hard cut on the downbeat' });
      break;
    }
    case 'spinback': {
      startBeat = -1;
      endBeat = 2;
      actions.push({ beat: -1, kind: 'spinback', deck: 'out' });
      lane('in.fader', [
        [-0.01, 0],
        [0, 1],
      ]);
      lane('out.fader', [
        [0, 1],
        [1, 0],
      ]);
      steps.push({ beat: -1, text: 'Spin the outgoing record back' });
      steps.push({ beat: 0, text: 'Drop the new track' });
      break;
    }
    case 'reverb-wash': {
      actions.push({
        beat: 0,
        kind: 'fx',
        deck: 'out',
        fx: { type: 'reverb', param: 0.85, mix: 0, on: true },
      });
      lane('out.fxMix', [
        [0, 0],
        [L * 0.6, 0.85],
      ]);
      lane('out.filter', [
        [0, 0],
        [L, -0.6],
      ]);
      lane('out.fader', [
        [L * 0.5, 1],
        [L, 0],
      ]);
      lane('in.fader', [
        [0, 0],
        [L * 0.5, 1],
      ]);
      lane('in.eqLow', [
        [0, 0.1],
        [L / 2 - 0.5, 0.1],
        [L / 2, FLAT],
      ]);
      lane('out.eqLow', [
        [L / 2 - 0.5, FLAT],
        [L / 2, 0],
      ]);
      actions.push({ beat: L + 8, kind: 'fxOff', deck: 'out' });
      endBeat = L + 8;
      steps.push({ beat: 0, text: 'Wash the outgoing track into reverb' });
      steps.push({ beat: 0, text: 'Low-pass the outgoing track while the new one comes in' });
      steps.push({ beat: L / 2, text: 'Swap the bass' });
      break;
    }
  }
  actions.push({ beat: endBeat, kind: 'stopOut', deck: 'out' });
  steps.push({ beat: endBeat, text: 'Stop the outgoing deck – transition complete' });
  steps.sort((a, b) => a.beat - b.beat);

  const mm = Math.floor(outSwitch / 60);
  const ss = Math.floor(outSwitch % 60)
    .toString()
    .padStart(2, '0');
  const lenText =
    technique === 'echo-out' ||
    technique === 'loop-roll' ||
    technique === 'quick-cut' ||
    technique === 'spinback'
      ? ''
      : ` over ${bars} bars`;
  const keyText = h.shift ? `, key shift ${h.shift > 0 ? '+' : ''}${h.shift}` : '';
  const tempoText = Math.abs(inRate - 1) > 0.002 ? `, new track at ${((inRate - 1) * 100).toFixed(1)}%` : '';
  return {
    technique,
    name: meta.name,
    bars,
    startBeat,
    endBeat,
    outSwitch,
    inStart,
    inRate,
    inRateEnd,
    keyShift: h.shift,
    lanes,
    actions,
    steps,
    summary: `${meta.name}${lenText} at ${mm}:${ss}${tempoText}${keyText}.`,
  };
}

/** Value of a lane at a beat (linear between points, held outside). */
export function laneValue(points: [number, number][], beat: number): number {
  if (!points.length) return 0;
  if (beat <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [b1, v1] = points[i];
    if (beat <= b1) {
      const [b0, v0] = points[i - 1];
      const t = b1 === b0 ? 1 : (beat - b0) / (b1 - b0);
      return v0 + (v1 - v0) * t;
    }
  }
  return points[points.length - 1][1];
}
