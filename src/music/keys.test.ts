import { describe, expect, it } from 'vitest';
import { camelotLabel, fromCamelot, musicalLabel, openKeyLabel, parseKey, transposeKey } from './keys';

describe('keys', () => {
  it('maps keys to the Camelot wheel', () => {
    expect(camelotLabel({ tonic: 0, mode: 'major' })).toBe('8B'); // C
    expect(camelotLabel({ tonic: 9, mode: 'minor' })).toBe('8A'); // Am
    expect(camelotLabel({ tonic: 7, mode: 'major' })).toBe('9B'); // G
    expect(camelotLabel({ tonic: 4, mode: 'minor' })).toBe('9A'); // Em
    expect(camelotLabel({ tonic: 11, mode: 'major' })).toBe('1B'); // B
    expect(camelotLabel({ tonic: 8, mode: 'minor' })).toBe('1A'); // G#m
    expect(camelotLabel({ tonic: 5, mode: 'minor' })).toBe('4A'); // Fm
    expect(camelotLabel({ tonic: 1, mode: 'minor' })).toBe('12A'); // C#m
  });

  it('round-trips every Camelot code', () => {
    for (let n = 1; n <= 12; n++) {
      for (const l of ['A', 'B'] as const) expect(camelotLabel(fromCamelot(n, l))).toBe(`${n}${l}`);
    }
  });

  it('formats Open Key and musical names', () => {
    expect(openKeyLabel({ tonic: 0, mode: 'major' })).toBe('1d');
    expect(openKeyLabel({ tonic: 9, mode: 'minor' })).toBe('1m');
    expect(musicalLabel({ tonic: 10, mode: 'minor' })).toBe('Bbm');
  });

  it('parses tag formats', () => {
    expect(parseKey('8A')).toEqual({ tonic: 9, mode: 'minor' });
    expect(parseKey('11b')).toEqual({ tonic: 9, mode: 'major' });
    expect(parseKey('F#m')).toEqual({ tonic: 6, mode: 'minor' });
    expect(parseKey('Gb minor')).toEqual({ tonic: 6, mode: 'minor' });
    expect(parseKey('Eb')).toEqual({ tonic: 3, mode: 'major' });
    expect(parseKey('1m')).toEqual({ tonic: 9, mode: 'minor' });
    expect(parseKey('6d')).toEqual({ tonic: 11, mode: 'major' });
    expect(parseKey('')).toBeNull();
    expect(parseKey('xyz')).toBeNull();
  });

  it('transposes', () => {
    expect(transposeKey({ tonic: 11, mode: 'minor' }, 2)).toEqual({ tonic: 1, mode: 'minor' });
  });
});
