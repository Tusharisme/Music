import { describe, expect, it } from 'vitest';
import { analyzeTrack } from './analyze';
import { arrangedTrack } from './testSignals';
import { camelotLabel } from '../music/keys';

const SR = 22050;

describe('analyzeTrack (arranged synthetic track)', () => {
  const bpm = 124;
  const offset = 0.15;
  const bar = (60 / bpm) * 4;
  const x = arrangedTrack(bpm, SR, offset, [
    { bars: 16, kind: 'drums' },
    { bars: 32, kind: 'full' },
    { bars: 8, kind: 'pads' },
    { bars: 16, kind: 'full' },
    { bars: 16, kind: 'drums' },
  ]);
  const { analysis, waveform } = analyzeTrack(x, SR);

  it('finds tempo, downbeat and key', () => {
    expect(analysis.beatgrid.bpm).toBeCloseTo(bpm, 1);
    const err = Math.abs(analysis.beatgrid.firstBeat - offset);
    expect(err).toBeLessThan(0.01);
    expect(camelotLabel(analysis.key)).toBe('8A');
  });

  it('finds DJ mix points and sections', () => {
    const s = analysis.structure;
    expect(Math.abs(s.mixIn - offset)).toBeLessThan(0.05);
    expect(Math.abs(s.introEnd - (offset + 16 * bar))).toBeLessThan(0.1);
    expect(Math.abs(s.mixOut - (offset + 72 * bar))).toBeLessThan(0.1);
    expect(s.sections.some((x) => x.label === 'breakdown')).toBe(true);
    expect(s.mainDrop).not.toBeNull();
    expect(Math.abs((s.mainDrop ?? 0) - (offset + 56 * bar))).toBeLessThan(0.1);
  });

  it('produces waveform data and sane features', () => {
    expect(waveform.peak.length).toBeGreaterThan(150 * 100);
    expect(analysis.energy).toBeGreaterThanOrEqual(1);
    expect(analysis.energy).toBeLessThanOrEqual(10);
    expect(analysis.timbre.length).toBeGreaterThan(20);
    expect(analysis.loudness).toBeLessThan(0);
    expect(analysis.barEnergy.length).toBeGreaterThan(80);
  });
});
