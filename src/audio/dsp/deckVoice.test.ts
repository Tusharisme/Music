import { describe, expect, it } from 'vitest';
import { DeckVoice } from './deckVoice';
import { floatToInt16 } from './pcm';

const SR = 48000;

function sine(freq: number, seconds: number, sr = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

function loadVoice(sig: Float32Array): DeckVoice {
  const v = new DeckVoice(SR);
  const pcm = floatToInt16(sig);
  v.load(pcm, pcm.slice(), SR);
  return v;
}

function render(v: DeckVoice, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    v.renderFrame();
    out[i] = v.l;
  }
  return out;
}

/** Estimate the dominant frequency by counting rising zero crossings. */
function zeroCrossFreq(x: Float32Array, sr = SR): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      crossings++;
      if (first < 0) first = i;
      last = i;
    }
  }
  return ((crossings - 1) * sr) / (last - first);
}

describe('DeckVoice', () => {
  it('plays back at normal speed and advances the position', () => {
    const v = loadVoice(sine(440, 2));
    v.play();
    render(v, SR / 2);
    expect(v.pos).toBeCloseTo(SR / 2, 0);
  });

  it('changes pitch with tempo when key lock is off', () => {
    const v = loadVoice(sine(440, 3));
    v.setTempo(1.1);
    v.play();
    const out = render(v, SR);
    expect(zeroCrossFreq(out.subarray(4800))).toBeCloseTo(484, -1);
    expect(v.pos).toBeCloseTo(SR * 1.1, -2);
  });

  it('keeps pitch with key lock while running faster', () => {
    const v = loadVoice(sine(440, 4));
    v.keyLock = true;
    v.setTempo(1.1);
    v.play();
    const out = render(v, SR * 2);
    const f = zeroCrossFreq(out.subarray(9600));
    expect(Math.abs(f - 440)).toBeLessThan(4);
    // The musical clock still runs at 1.1x.
    expect(v.pos).toBeCloseTo(SR * 2 * 1.1, -2);
  });

  it('shifts the key by semitones under key lock', () => {
    const v = loadVoice(sine(440, 4));
    v.keyLock = true;
    v.setKeyShift(2);
    v.play();
    const out = render(v, SR * 2);
    const f = zeroCrossFreq(out.subarray(9600));
    const expected = 440 * Math.pow(2, 2 / 12);
    expect(Math.abs(f - expected)).toBeLessThan(6);
    expect(v.pos).toBeCloseTo(SR * 2, -2);
  });

  it('is transparent with key lock at tempo 1', () => {
    const sig = sine(330, 2);
    const v = loadVoice(sig);
    v.keyLock = true;
    v.play();
    const out = render(v, SR);
    // Skip the declick fade-in, then compare against the (int16-quantised) source.
    let maxErr = 0;
    for (let i = 200; i < out.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - sig[i]));
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('loops seamlessly between loop points', () => {
    const v = loadVoice(sine(200, 4));
    v.setGrid(120, 0); // beat = 0.5 s
    v.play();
    v.setLoop(v.posOfBeat(1), v.posOfBeat(2));
    const out = render(v, SR * 3);
    expect(v.loopOn).toBe(true);
    expect(v.pos).toBeGreaterThanOrEqual(v.posOfBeat(1));
    expect(v.pos).toBeLessThan(v.posOfBeat(2));
    // No large discontinuities (sine 200 Hz max slope per sample ≈ 0.013).
    let maxStep = 0;
    for (let i = 200; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    expect(maxStep).toBeLessThan(0.05);
  });

  it('quantizes positions to the beat grid', () => {
    const v = loadVoice(sine(100, 4));
    v.setGrid(120, 0.1);
    const beat = v.beatLen();
    expect(beat).toBeCloseTo(SR * 0.5);
    const q = v.quantize(0.1 * SR + beat * 2.4);
    expect(q).toBeCloseTo(0.1 * SR + beat * 2);
  });

  it('scratches backwards following the platter target', () => {
    const v = loadVoice(sine(200, 4));
    v.jump(SR * 2, false);
    v.scratchStart();
    // Drag the record back by 0.25 s over 0.25 s (rate -1).
    for (let k = 0; k < 25; k++) {
      v.scratchMove(2 - (k + 1) * 0.01, -1);
      render(v, 480);
    }
    v.scratchEnd();
    expect(v.pos / SR).toBeGreaterThan(1.7);
    expect(v.pos / SR).toBeLessThan(1.8);
  });

  it('flags the end of the track', () => {
    const v = loadVoice(sine(200, 0.5));
    v.play();
    render(v, SR);
    expect(v.endedFlag).toBe(true);
    expect(v.playing).toBe(false);
  });
});
