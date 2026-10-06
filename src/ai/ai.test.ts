import { describe, expect, it } from 'vitest';
import { harmonicCompat, bestKeyShift, effectiveKey } from './harmonic';
import { recommend, tempoFit, MIX_STYLES, type NowPlaying } from './recommender';
import { planTransition, laneValue, chooseTechnique } from './transitions';
import { fromCamelot, camelotLabel } from '../music/keys';
import type { TrackAnalysis, TrackRecord } from '../types';

const key = (c: string) => fromCamelot(Number(c.slice(0, -1)), c.slice(-1) as 'A' | 'B');

function track(
  id: string,
  bpm: number,
  cam: string,
  energy: number,
  timbre: number[] = [1, 2, 3, 4],
): TrackRecord {
  const beat = 60 / bpm;
  const duration = beat * 4 * 96;
  const analysis: TrackAnalysis = {
    version: 1,
    duration,
    beatgrid: { bpm, firstBeat: 0 },
    bpmConfidence: 1,
    key: key(cam),
    keyConfidence: 1,
    energy,
    loudness: -8,
    barEnergy: [],
    structure: {
      mixIn: 0,
      introEnd: beat * 4 * 16,
      mixOut: beat * 4 * 80,
      mainDrop: beat * 4 * 56,
      sections: [],
    },
    timbre,
    mood: [],
    danceability: 0.8,
  };
  return {
    id,
    title: id,
    artist: 'x',
    duration,
    source: { kind: 'demo', recipeId: id },
    addedAt: 0,
    playCount: 0,
    analysis,
  };
}

describe('harmonic mixing rules', () => {
  it('scores Camelot relationships', () => {
    expect(harmonicCompat(key('8A'), key('8A')).kind).toBe('perfect');
    expect(harmonicCompat(key('8A'), key('9A')).kind).toBe('adjacent');
    expect(harmonicCompat(key('8A'), key('7A')).kind).toBe('adjacent');
    expect(harmonicCompat(key('8A'), key('8B')).kind).toBe('relative');
    expect(harmonicCompat(key('8A'), key('9B')).kind).toBe('diagonal');
    expect(harmonicCompat(key('8A'), key('3A')).kind).toBe('semitone');
    expect(harmonicCompat(key('8A'), key('2A')).kind).toBe('clash');
    expect(harmonicCompat(key('8A'), key('8A')).score).toBeGreaterThan(
      harmonicCompat(key('8A'), key('9A')).score,
    );
  });

  it('suggests a key shift that fixes a clash', () => {
    const m = bestKeyShift(key('8A'), key('3A')); // Am → Bbm: shift down a semitone to land on Am
    expect(m.shift).toBe(-1);
    expect(m.kind).toBe('perfect');
  });

  it('accounts for pitch when key lock is off', () => {
    // +6% without key lock ≈ +1 semitone: Am sounds like Bbm (3A)
    expect(camelotLabel(effectiveKey(key('8A'), 1.06, false, 0))).toBe('3A');
    expect(camelotLabel(effectiveKey(key('8A'), 1.06, true, 0))).toBe('8A');
  });
});

describe('tempo fit', () => {
  it('handles half/double time', () => {
    const f = tempoFit(174, 87);
    expect(f.multiplier).toBe(2);
    expect(f.rate).toBeCloseTo(1);
    expect(tempoFit(124, 126).score).toBeGreaterThan(tempoFit(124, 132).score);
  });
});

describe('recommend', () => {
  const now: NowPlaying = {
    track: track('now', 124, '8A', 6),
    analysis: track('now', 124, '8A', 6).analysis!,
    rate: 1,
    keyLock: true,
    keyShift: 0,
  };
  const lib = [
    track('perfect', 125, '8A', 6),
    track('adjacent', 123, '9A', 7),
    track('clash', 124, '2B', 6),
    track('far', 160, '8A', 6),
    track('energy-drop', 124, '8A', 2),
  ];
  const base = {
    weights: MIX_STYLES.balanced.weights,
    exclude: new Set<string>(),
    history: [],
    allowKeyShift: false,
  };

  it('ranks the harmonic + tempo match first and the clash low', () => {
    const r = recommend(now, lib, { ...base, vibe: 'keep' });
    expect(r[0].track.id).toBe('perfect');
    const order = r.map((s) => s.track.id);
    expect(order.indexOf('clash')).toBeGreaterThan(order.indexOf('adjacent'));
    expect(order.indexOf('far')).toBeGreaterThan(order.indexOf('adjacent'));
  });

  it('follows the vibe', () => {
    const build = recommend(now, lib, { ...base, vibe: 'build' });
    expect(build[0].track.id).toBe('adjacent');
    const cool = recommend(now, lib, { ...base, vibe: 'cool' });
    const ids = cool.map((s) => s.track.id);
    expect(ids.indexOf('energy-drop')).toBeLessThan(ids.indexOf('adjacent'));
  });

  it('penalises recently played tracks', () => {
    const r = recommend(now, lib, { ...base, vibe: 'keep', history: ['perfect'] });
    expect(r[0].track.id).not.toBe('perfect');
  });
});

describe('transition planning', () => {
  const a = track('a', 124, '8A', 6);
  const b = track('b', 125, '8A', 6);
  const out = { track: a, analysis: a.analysis!, rate: 1, pos: 30, keyLock: true, keyShift: 0 };

  it('picks a long blend for a perfect harmonic match with long intros/outros', () => {
    const p = planTransition({ out, incoming: { track: b, analysis: b.analysis! }, when: 'phrase' });
    expect(p.technique).toBe('long-blend');
    // Switch at A's mix-out (bar 80), on a downbeat.
    expect(p.outSwitch).toBeCloseTo(a.analysis!.structure.mixOut, 3);
    expect(p.inRate).toBeCloseTo(124 / 125, 4);
    expect(p.inStart).toBe(0);
    const fader = p.lanes.find((l) => l.param === 'in.fader')!;
    expect(laneValue(fader.points, 0)).toBe(0);
    expect(laneValue(fader.points, p.endBeat)).toBe(1);
  });

  it('uses an echo out for big tempo jumps and a loop roll for big energy jumps', () => {
    const fast = track('fast', 150, '8A', 6);
    expect(
      planTransition({ out, incoming: { track: fast, analysis: fast.analysis! }, when: 'phrase' }).technique,
    ).toBe('echo-out');
    const peak = track('peak', 125, '9A', 9);
    const p = planTransition({ out, incoming: { track: peak, analysis: peak.analysis! }, when: 'phrase' });
    expect(p.technique).toBe('loop-roll');
    expect(p.inStart).toBeCloseTo(peak.analysis!.structure.mainDrop!, 5);
    expect(p.startBeat).toBe(-16);
  });

  it('aligns "mix now" to an upcoming bar line with enough lead time', () => {
    const p = planTransition({
      out,
      incoming: { track: b, analysis: b.analysis! },
      when: 'now',
      technique: 'echo-out',
    });
    const beat = 60 / 124;
    const switchBeat = p.outSwitch / beat;
    expect(Math.abs(switchBeat - Math.round(switchBeat / 4) * 4)).toBeLessThan(1e-6);
    expect(p.outSwitch - 30).toBeGreaterThan(8 * beat);
  });

  it('chooses techniques by rule', () => {
    const h = { score: 0.9, kind: 'adjacent' as const, label: '', shift: 0 };
    expect(chooseTechnique(h, tempoFit(124, 125), 0, 16, 16)).toBe('long-blend');
    expect(chooseTechnique({ ...h, score: 0.2 }, tempoFit(124, 125), 0, 16, 16)).toBe('filter-fade');
    expect(chooseTechnique(h, tempoFit(124, 131), 0, 16, 16)).toBe('tempo-ramp');
    expect(chooseTechnique(h, tempoFit(124, 125), -4, 16, 16)).toBe('reverb-wash');
  });
});
