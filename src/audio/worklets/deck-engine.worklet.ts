/**
 * Deck engine AudioWorklet: renders both decks sample-by-sample so that sync,
 * phase correction and beat-locked starts are sample accurate.
 * Output 0 = deck A (stereo), output 1 = deck B (stereo).
 */
import { DeckVoice } from '../dsp/deckVoice';
import type { DeckTick, EngineCommand, EngineEvent, SyncMode } from '../protocol';

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const DECK_COUNT = 2;
const TICK_EVERY_BLOCKS = 4;

class DeckEngineProcessor extends AudioWorkletProcessor {
  private readonly decks: DeckVoice[] = [];
  private readonly syncModes: SyncMode[] = [];
  private readonly lastJumpCorrection: number[] = [];
  private master = 0;
  private block = 0;
  private pending: { deck: number; pos: number; cmd: EngineCommand; tag?: string }[] = [];

  constructor() {
    super();
    for (let i = 0; i < DECK_COUNT; i++) {
      this.decks.push(new DeckVoice(sampleRate));
      this.syncModes.push('off');
      this.lastJumpCorrection.push(-1);
    }
    this.port.onmessage = (e: MessageEvent<EngineCommand>) => this.handle(e.data);
  }

  private post(ev: EngineEvent): void {
    this.port.postMessage(ev);
  }

  private handle(m: EngineCommand): void {
    const v = this.decks[m.deck];
    if (!v) return;
    switch (m.type) {
      case 'load':
        v.load(m.L, m.R, m.sampleRate);
        v.setGrid(m.bpm, m.firstBeat);
        this.post({ type: 'loaded', deck: m.deck });
        break;
      case 'unload':
        v.unload();
        break;
      case 'play':
        if (this.syncModes[m.deck] === 'beat') this.alignToMaster(m.deck, 4);
        v.play();
        break;
      case 'pause':
        v.pause();
        break;
      case 'seek': {
        let target = m.sec * v.srcRate;
        if (m.keepPhase && v.bpm > 0) {
          const ph = v.beatAt(v.pos) - Math.floor(v.beatAt(v.pos));
          const tb = v.beatAt(target);
          target = v.posOfBeat(Math.floor(tb + 1e-6) + ph);
          if (target < 0) target += v.beatLen();
        }
        v.jump(target, m.smooth !== false);
        break;
      }
      case 'tempo':
        v.setTempo(m.rate);
        break;
      case 'keyLock':
        v.keyLock = m.on;
        break;
      case 'keyShift':
        v.setKeyShift(m.semis);
        break;
      case 'bend':
        v.setBend(m.amount);
        break;
      case 'grid':
        v.setGrid(m.bpm, m.firstBeat);
        break;
      case 'loop':
        v.setLoop(m.startSec * v.srcRate, m.endSec * v.srcRate);
        break;
      case 'loopOff':
        v.clearLoop();
        if (v.slipActive) v.endSlip(true);
        break;
      case 'roll': {
        const bl = v.beatLen();
        if (bl <= 0) break;
        v.beginSlip();
        const start = v.quantize(v.pos, Math.min(1, m.beats), 'floor');
        v.setLoop(start, start + m.beats * bl);
        break;
      }
      case 'rollEnd':
        v.clearLoop();
        v.endSlip(true);
        break;
      case 'beatJump': {
        const bl = v.beatLen();
        if (bl <= 0) break;
        const delta = m.beats * bl;
        if (v.loopOn && v.src) v.src.setLoop(v.src.loopStart + delta, v.src.loopEnd + delta);
        v.jump(v.pos + delta);
        break;
      }
      case 'scratchStart':
        v.scratchStart();
        break;
      case 'scratchMove':
        v.scratchMove(m.sec, m.vel);
        break;
      case 'scratchEnd':
        v.scratchEnd();
        break;
      case 'brake':
        v.brake(m.seconds);
        break;
      case 'spinback':
        v.spinback(m.seconds);
        break;
      case 'reverse':
        if (m.on) {
          if (v.slip) v.beginSlip();
          v.reverse = true;
        } else {
          v.reverse = false;
          if (v.slipActive) v.endSlip(true);
        }
        break;
      case 'slip':
        v.slip = m.on;
        if (!m.on && v.slipActive) v.endSlip(false);
        break;
      case 'master':
        this.master = m.deck;
        break;
      case 'syncMode':
        this.syncModes[m.deck] = m.mode;
        if (m.mode !== 'beat') v.syncAdj = 0;
        break;
      case 'alignPhase':
        this.alignToMaster(m.deck, 4);
        break;
      case 'arm': {
        v.pause();
        v.jump(m.startSec * v.srcRate, false);
        const trig = this.decks[m.trigger];
        if (!trig) break;
        v.armed = true;
        v.armTrigger = m.trigger;
        v.armPos = m.triggerSec * trig.srcRate;
        break;
      }
      case 'disarm':
        v.armed = false;
        break;
      case 'tempoRamp':
        v.rampTempo(m.to, m.seconds);
        break;
      case 'at':
        this.pending.push({ deck: m.deck, pos: m.sec * v.srcRate, cmd: m.cmd, tag: m.tag });
        break;
      case 'cancelAt':
        this.pending = this.pending.filter(
          (p) => p.deck !== m.deck || (m.tag !== undefined && p.tag !== m.tag),
        );
        break;
    }
  }

  /** Fire position-triggered commands whose position this deck just crossed. */
  private firePending(d: number, v: DeckVoice): void {
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (p.deck !== d) continue;
      if (v.rate > 0 && v.prevPos < p.pos && v.pos >= p.pos) {
        this.pending.splice(i, 1);
        i--;
        this.handle(p.cmd);
      }
    }
  }

  /** Synced decks follow the master's tempo (half/double-time aware). */
  private followTempo(): void {
    const m = this.decks[this.master];
    if (!m || m.bpm <= 0) return;
    for (let d = 0; d < this.decks.length; d++) {
      if (d === this.master || this.syncModes[d] === 'off') continue;
      const s = this.decks[d];
      if (s.bpm <= 0 || s.armed) continue;
      const masterBpm = m.bpm * m.tempo;
      let target = masterBpm / s.bpm;
      // Keep the musical relationship nearest to 1 (e.g. 87 ↔ 174 runs half/double time).
      while (target > 1.45) target /= 2;
      while (target < 0.69) target *= 2;
      if (Math.abs(s.tempo - target) > 1e-7) s.tempo = target;
    }
  }

  /**
   * Phase error of `deck` relative to the master, in the deck's beats,
   * wrapped to ±unit/2. Handles half/double-time pairs. Null if not comparable.
   */
  private phaseError(deck: number, unit: number): number | null {
    const s = this.decks[deck];
    const m = this.decks[this.master];
    if (!s || !m || deck === this.master || s.bpm <= 0 || m.bpm <= 0 || !m.src) return null;
    const ratio = (m.bpm * m.tempo) / (s.bpm * s.tempo);
    let mult: number;
    if (Math.abs(ratio - 1) < 0.12) mult = 1;
    else if (Math.abs(ratio - 2) < 0.24) mult = 2;
    else if (Math.abs(ratio - 0.5) < 0.06) mult = 0.5;
    else return null;
    const u = mult === 1 ? unit : 1;
    let err = s.beatAt() - m.beatAt() / mult;
    err -= u * Math.round(err / u);
    return err;
  }

  private alignToMaster(deck: number, unit: number): void {
    const m = this.decks[this.master];
    if (!m || !(m.playing || m.gain > 0)) return;
    const err = this.phaseError(deck, unit);
    if (err === null) return;
    const s = this.decks[deck];
    let target = s.pos - err * s.beatLen();
    if (target < 0) target += unit * s.beatLen();
    s.jump(target, s.gain > 0);
  }

  /** Gentle phase-locked loop for decks in beat-sync mode. */
  private updateSync(): void {
    const m = this.decks[this.master];
    for (let d = 0; d < this.decks.length; d++) {
      const s = this.decks[d];
      if (this.syncModes[d] !== 'beat' || d === this.master) {
        s.syncAdj = 0;
        continue;
      }
      if (!m || !m.playing || !s.playing || s.scratching || m.scratching || s.bend !== 0) {
        s.syncAdj = 0;
        continue;
      }
      const err = this.phaseError(d, 1);
      if (err === null) {
        s.syncAdj = 0;
        continue;
      }
      const abs = Math.abs(err);
      if (abs > 0.06) {
        // Way off (e.g. after a manual seek): jump into phase, at most twice a second.
        if (currentTime - this.lastJumpCorrection[d] > 0.5) {
          this.lastJumpCorrection[d] = currentTime;
          s.jump(s.pos - err * s.beatLen());
        }
        s.syncAdj = 0;
      } else if (abs > 0.002) {
        const beatSec = 60 / s.bpm;
        const adj = (-err * beatSec) / 0.4;
        s.syncAdj = Math.max(-0.004, Math.min(0.004, adj));
      } else {
        s.syncAdj = 0;
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const n = outputs[0]?.[0]?.length ?? 128;
    this.followTempo();
    this.updateSync();

    // Render trigger decks before the decks armed on them (sample-accurate starts).
    const order = this.decks[0].armed && this.decks[0].armTrigger === 1 ? [1, 0] : [0, 1];

    for (let i = 0; i < n; i++) {
      for (let k = 0; k < order.length; k++) {
        const d = order[k];
        const v = this.decks[d];
        if (v.armed) {
          const t = this.decks[v.armTrigger];
          if (t && t.rate > 0 && t.prevPos < v.armPos && t.pos >= v.armPos) {
            v.fireArmed();
            this.post({ type: 'started', deck: d, time: currentTime + i / sampleRate });
          }
        }
        v.renderFrame();
        if (this.pending.length) this.firePending(d, v);
        const out = outputs[d];
        if (out) {
          out[0][i] = v.l;
          if (out[1]) out[1][i] = v.r;
        }
      }
    }

    for (let d = 0; d < this.decks.length; d++) {
      const v = this.decks[d];
      if (v.endedFlag) {
        v.endedFlag = false;
        this.post({ type: 'ended', deck: d });
      }
    }

    if (++this.block % TICK_EVERY_BLOCKS === 0) {
      const ticks: DeckTick[] = this.decks.map((v) => ({
        pos: v.pos / v.srcRate,
        tempo: v.tempo,
        rate: v.playing || v.scratching || v.brakeMode !== 0 ? v.rate : 0,
        playing: v.playing,
        loopOn: v.loopOn,
        loopStart: v.src ? v.src.loopStart / v.srcRate : 0,
        loopEnd: v.src ? v.src.loopEnd / v.srcRate : 0,
        slipActive: v.slipActive,
        slipPos: v.slipPos / v.srcRate,
        armed: v.armed,
        scratching: v.scratching,
      }));
      this.post({ type: 'tick', time: currentTime + n / sampleRate, decks: ticks });
    }
    return true;
  }
}

registerProcessor('deck-engine', DeckEngineProcessor);
