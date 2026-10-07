import { describe, expect, it } from 'vitest';
import { smartChannel } from './curves';

describe('smart crossfader', () => {
  it('changes nothing when off, or while the crossfader is on a deck’s side or centred', () => {
    expect(smartChannel('off', 1, 0, 0.5, 0)).toEqual({ eqLow: 0.5, filter: 0 });
    for (const mode of ['bass', 'filter'] as const) {
      expect(smartChannel(mode, 0.5, 0, 0.5, 0)).toEqual({ eqLow: 0.5, filter: 0 });
      expect(smartChannel(mode, 0.5, 1, 0.5, 0)).toEqual({ eqLow: 0.5, filter: 0 });
      expect(smartChannel(mode, 0.2, 0, 0.7, 0.1)).toEqual({ eqLow: 0.7, filter: 0.1 });
      expect(smartChannel(mode, 0.8, 1, 0.7, 0.1)).toEqual({ eqLow: 0.7, filter: 0.1 });
    }
  });

  it('bass swap: the basses trade places just past the middle', () => {
    // Sliding from A to B: A keeps its bass to the centre and has lost it by 60 %.
    expect(smartChannel('bass', 0.55, 0, 0.5, 0).eqLow).toBeCloseTo(0.25);
    expect(smartChannel('bass', 0.6, 0, 0.5, 0).eqLow).toBeCloseTo(0, 9);
    expect(smartChannel('bass', 1, 0, 0.5, 0).eqLow).toBe(0);
    // B only gets its bass from 40 % on, mirrored.
    expect(smartChannel('bass', 0.4, 1, 0.5, 0).eqLow).toBeCloseTo(0, 9);
    expect(smartChannel('bass', 0.45, 1, 0.5, 0).eqLow).toBeCloseTo(0.25);
    // The filter is left alone.
    expect(smartChannel('bass', 1, 0, 0.5, -0.4).filter).toBe(-0.4);
  });

  it('filter: the deck being left is high-passed away, a deliberate low-pass is kept', () => {
    const half = smartChannel('filter', 0.75, 0, 0.5, 0).filter;
    const full = smartChannel('filter', 1, 0, 0.5, 0).filter;
    expect(half).toBeGreaterThan(0.3);
    expect(full).toBeCloseTo(0.85);
    expect(full).toBeGreaterThan(half);
    expect(smartChannel('filter', 0, 1, 0.5, 0).filter).toBeCloseTo(0.85);
    // The stronger of knob and crossfader wins; a low-pass set by hand stays.
    expect(smartChannel('filter', 1, 0, 0.5, 0.95).filter).toBe(0.95);
    expect(smartChannel('filter', 1, 0, 0.5, -0.5).filter).toBe(-0.5);
    expect(smartChannel('filter', 1, 0, 0.3, 0).eqLow).toBe(0.3);
  });
});
