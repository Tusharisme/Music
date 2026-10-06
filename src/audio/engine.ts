import deckWorkletUrl from './worklets/deck-engine.worklet.ts?worker&url';
import fxWorkletUrl from './worklets/fx.worklet.ts?worker&url';
import { ChannelStrip, MasterSection, applyCrossfader } from './mixer';
import { DeckFx, type FxSettings } from './effects';
import { Sampler } from './sampler';
import { MixRecorder } from './recorder';
import { Transport } from './transport';
import { floatToInt16 } from './dsp/pcm';
import type { EngineCommand, EngineEvent, SyncMode } from './protocol';
import type { CrossfaderCurve } from './curves';
import type { DecodedAudio } from '../types';

type Listener = (ev: EngineEvent) => void;

interface AudioSessionLike {
  type: string;
}

/**
 * The audio engine: one AudioContext, the deck-engine worklet (both decks),
 * two channel strips with post-fader FX, a sampler and the master section.
 * Created lazily on the first user gesture (browsers require it).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  readonly transport = new Transport();
  strips: ChannelStrip[] = [];
  fx: DeckFx[] = [];
  master: MasterSection | null = null;
  sampler: Sampler | null = null;
  recorder: MixRecorder | null = null;

  private node: AudioWorkletNode | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly listeners = new Set<Listener>();
  private xfader = 0.5;
  private xfCurve: CrossfaderCurve = 'smooth';

  get ready(): boolean {
    return this.node !== null;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Create/resume the audio graph. Safe to call repeatedly; must first run inside a user gesture. */
  init(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.initPromise) this.initPromise = this.build();
    return this.initPromise;
  }

  private async build(): Promise<void> {
    const nav = navigator as Navigator & { audioSession?: AudioSessionLike };
    // iOS: play through the mute switch like a music app.
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* ignore */
      }
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.transport.attach(ctx);
    if (ctx.state === 'suspended') void ctx.resume();

    await ctx.audioWorklet.addModule(deckWorkletUrl);
    await ctx.audioWorklet.addModule(fxWorkletUrl);

    const node = new AudioWorkletNode(ctx, 'deck-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
    });
    node.port.onmessage = (e: MessageEvent<EngineEvent>) => this.onEvent(e.data);

    const master = new MasterSection(ctx);
    this.master = master;
    for (let d = 0; d < 2; d++) {
      const strip = new ChannelStrip(ctx);
      const fx = new DeckFx(ctx);
      node.connect(strip.input, d);
      strip.output.connect(fx.input);
      fx.output.connect(master.bus);
      strip.cueSend.connect(master.cueBus);
      this.strips.push(strip);
      this.fx.push(fx);
    }
    applyCrossfader(this.strips, this.xfader, this.xfCurve);

    this.sampler = new Sampler(ctx);
    this.sampler.output.connect(master.bus);
    void this.sampler.loadDefaults();

    this.recorder = new MixRecorder(ctx, master.recordTap);
    master.output.connect(ctx.destination);
    this.node = node;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onEvent(ev: EngineEvent): void {
    if (ev.type === 'tick') this.transport.update(ev.time, ev.decks);
    for (const l of this.listeners) l(ev);
  }

  send(cmd: EngineCommand, transfer?: Transferable[]): void {
    if (!this.node) return;
    if (transfer) this.node.port.postMessage(cmd, transfer);
    else this.node.port.postMessage(cmd);
  }

  // ------------------------------------------------------------------ decks

  /** Hand 16-bit PCM to a deck (transferred to the audio thread, not copied). */
  loadDeckPcm(
    deck: number,
    L: Int16Array,
    R: Int16Array,
    sampleRate: number,
    duration: number,
    bpm: number,
    firstBeat: number,
  ): void {
    this.transport.reset(deck, 0);
    this.transport.setDuration(deck, duration);
    this.send({ type: 'load', deck, L, R, sampleRate, bpm, firstBeat }, [L.buffer, R.buffer]);
  }

  /** Hand decoded audio to a deck. The PCM is converted to Int16 and transferred (not copied). */
  loadDeck(deck: number, audio: DecodedAudio, bpm: number, firstBeat: number): void {
    const L = floatToInt16(audio.channels[0]);
    const R = audio.channels[1] ? floatToInt16(audio.channels[1]) : L.slice();
    this.transport.reset(deck, 0);
    this.transport.setDuration(deck, audio.duration);
    this.send({ type: 'load', deck, L, R, sampleRate: audio.sampleRate, bpm, firstBeat }, [
      L.buffer,
      R.buffer,
    ]);
  }

  unloadDeck(deck: number): void {
    this.transport.reset(deck, 0);
    this.transport.setDuration(deck, 0);
    this.send({ type: 'unload', deck });
  }

  play(deck: number): void {
    void this.init();
    this.send({ type: 'play', deck });
  }

  pause(deck: number): void {
    this.send({ type: 'pause', deck });
  }

  seek(deck: number, sec: number, opts: { smooth?: boolean; keepPhase?: boolean } = {}): void {
    this.send({ type: 'seek', deck, sec, ...opts });
  }

  setTempo(deck: number, rate: number): void {
    this.send({ type: 'tempo', deck, rate });
  }

  setKeyLock(deck: number, on: boolean): void {
    this.send({ type: 'keyLock', deck, on });
  }

  setKeyShift(deck: number, semis: number): void {
    this.send({ type: 'keyShift', deck, semis });
  }

  setGrid(deck: number, bpm: number, firstBeat: number): void {
    this.send({ type: 'grid', deck, bpm, firstBeat });
  }

  setMaster(deck: number): void {
    this.send({ type: 'master', deck });
  }

  setSyncMode(deck: number, mode: SyncMode): void {
    this.send({ type: 'syncMode', deck, mode });
  }

  // ------------------------------------------------------------------ mixer

  setCrossfader(x: number, curve: CrossfaderCurve = this.xfCurve): void {
    this.xfader = x;
    this.xfCurve = curve;
    if (this.strips.length) applyCrossfader(this.strips, x, curve);
  }

  applyFx(deck: number, s: FxSettings): void {
    this.fx[deck]?.apply(s);
  }

  // ------------------------------------------------------------------ output

  async setOutputDevice(deviceId: string): Promise<boolean> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return false;
    await ctx.setSinkId(deviceId);
    return true;
  }

  get canChooseOutput(): boolean {
    return typeof (AudioContext.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function';
  }
}

export const engine = new AudioEngine();

if (import.meta.env.DEV) {
  (window as unknown as { __engine: AudioEngine }).__engine = engine;
}
