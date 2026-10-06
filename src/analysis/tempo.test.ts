import { describe, expect, it } from 'vitest';
import { spectralAnalysis } from './spectral';
import { estimateBeatPhase, estimateTempo } from './tempo';
import { synthTrack } from './testSignals';

const SR = 22050;

describe('tempo estimation', () => {
  it.each([
    [120, 0.0, 'house'],
    [124, 0.21, 'house'],
    [128, 0.37, 'house'],
    [137.5, 0.05, 'house'],
    [174, 0.11, 'house'],
    [90, 0.4, 'hiphop'],
    [174, 0.08, 'dnb'],
    [86, 0.3, 'hiphop'],
  ] as const)('detects %f BPM (offset %f s, %s groove)', (bpm, offset, groove) => {
    const x = synthTrack({ bpm, seconds: 60, sr: SR, offset, groove });
    const sp = spectralAnalysis(x, SR);
    const est = estimateTempo(sp);
    expect(Math.abs(est.bpm - bpm)).toBeLessThan(0.05);
    const phase = estimateBeatPhase(x, SR, est.bpm, sp);
    const beat = 60 / bpm;
    let err = Math.abs(phase - (offset % beat));
    err = Math.min(err, beat - err);
    expect(err).toBeLessThan(0.008);
  });
});
