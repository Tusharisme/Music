import { describe, expect, it } from 'vitest';
import { detectKey } from './key';
import { synthTrack } from './testSignals';
import { camelotLabel } from '../music/keys';

const SR = 22050;

describe('key detection', () => {
  it.each([
    [9, true, '8A'], // A minor
    [5, true, '4A'], // F minor
    [7, true, '6A'], // G minor
    [0, false, '8B'], // C major
    [2, false, '10B'], // D major
    [3, false, '5B'], // Eb major
  ])('detects tonic %i (minor=%s) as %s', (tonic, minor, expected) => {
    const x = synthTrack({ bpm: 124, seconds: 40, sr: SR, tonic, minor });
    const r = detectKey(x, SR);
    expect(camelotLabel(r.key)).toBe(expected);
  });

  it('is robust to detuned recordings (+30 cents)', () => {
    const sr = SR;
    const x = synthTrack({
      bpm: 124,
      seconds: 40,
      sr: Math.round(sr * Math.pow(2, -30 / 1200)),
      tonic: 9,
      minor: true,
    });
    const r = detectKey(x, sr);
    expect(camelotLabel(r.key)).toBe('8A');
  });
});
