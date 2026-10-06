import type { DeckTick } from './protocol';

interface Snapshot extends DeckTick {
  time: number;
}

/**
 * Smoothly extrapolated deck positions for the UI (waveforms, jog wheels, clocks).
 * Positions are corrected for output latency so visuals line up with what you hear.
 */
export class Transport {
  private ctx: AudioContext | null = null;
  private readonly snaps: (Snapshot | null)[] = [null, null];
  private readonly durations: number[] = [0, 0];

  attach(ctx: AudioContext): void {
    this.ctx = ctx;
  }

  update(time: number, decks: DeckTick[]): void {
    decks.forEach((d, i) => {
      this.snaps[i] = { ...d, time };
    });
  }

  setDuration(deck: number, seconds: number): void {
    this.durations[deck] = seconds;
  }

  reset(deck: number, pos = 0): void {
    const s = this.snaps[deck];
    this.snaps[deck] = {
      pos,
      tempo: s?.tempo ?? 1,
      rate: 0,
      playing: false,
      loopOn: false,
      loopStart: 0,
      loopEnd: 0,
      slipActive: false,
      slipPos: 0,
      armed: false,
      scratching: false,
      time: s?.time ?? 0,
    };
  }

  /** Context time of the sample currently reaching the speakers. */
  audibleTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  snapshot(deck: number): Snapshot | null {
    return this.snaps[deck];
  }

  /** Track position (seconds) of what's audible right now on `deck`. */
  position(deck: number): number {
    const s = this.snaps[deck];
    if (!s) return 0;
    if (s.rate === 0) return s.pos;
    let p = s.pos + s.rate * (this.audibleTime() - s.time);
    if (s.loopOn && s.loopEnd > s.loopStart && s.rate > 0 && p >= s.loopEnd) {
      p = s.loopStart + ((p - s.loopStart) % (s.loopEnd - s.loopStart));
    }
    const dur = this.durations[deck];
    if (dur > 0) p = Math.min(dur, p);
    return Math.max(0, p);
  }

  rate(deck: number): number {
    return this.snaps[deck]?.rate ?? 0;
  }
}
