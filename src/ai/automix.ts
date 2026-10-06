import { engine } from '../audio/engine';
import { useAI, idleMix } from '../state/ai';
import { useDecks, deckState } from '../state/decks';
import { useMixer, onUserMixerTouch, type ChannelState } from '../state/mixer';
import { useLibrary } from '../state/library';
import { useUI } from '../state/ui';
import { automation, autoKey } from '../controller/automation';
import { loadTrack, makeMaster, noteNowPlaying, setFx, setKeyShift, trackGrid } from '../controller/decks';
import { laneValue, type Lane, type LaneParam, type TransitionPlan } from './transitions';
import type { StripParam } from '../audio/mixer';

const LANE_TO_STRIP: Partial<
  Record<LaneParam, [side: 'out' | 'in', param: StripParam, key: keyof ChannelState]>
> = {
  'out.fader': ['out', 'fader', 'fader'],
  'in.fader': ['in', 'fader', 'fader'],
  'out.eqLow': ['out', 'eqLow', 'eqLow'],
  'out.eqMid': ['out', 'eqMid', 'eqMid'],
  'out.eqHigh': ['out', 'eqHigh', 'eqHigh'],
  'in.eqLow': ['in', 'eqLow', 'eqLow'],
  'in.eqMid': ['in', 'eqMid', 'eqMid'],
  'in.eqHigh': ['in', 'eqHigh', 'eqHigh'],
  'out.filter': ['out', 'filter', 'filter'],
  'in.filter': ['in', 'filter', 'filter'],
};

const TAG = 'automix';

/**
 * Executes a TransitionPlan. Everything time-critical is scheduled up front on the
 * audio clock (AudioParam ramps, position-triggered deck commands, armed start),
 * so the mix stays tight even when the tab is in the background. A light UI loop
 * mirrors the automation onto the on-screen controls.
 */
class AutoMixer {
  private plan: TransitionPlan | null = null;
  private out = 0;
  private inn = 1;
  private t0 = 0;
  private beatTrack = 0.5;
  private r0 = 1;
  private r1 = 1;
  private rampD = 0;
  private lanes: Lane[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private onDone: (() => void) | null = null;
  private started = false;

  constructor() {
    onUserMixerTouch((deck, keys) => this.userTouched(deck, keys));
  }

  get busy(): boolean {
    return this.plan !== null;
  }

  /** Context time of a beat relative to the switch point (handles tempo ramps). */
  private beatToTime(b: number): number {
    const bt = this.beatTrack;
    if (b <= 0 || this.rampD <= 0) return this.t0 + (b * bt) / this.r0;
    const s = b * bt;
    const sEnd = ((this.r0 + this.r1) / 2) * this.rampD;
    if (s >= sEnd) return this.t0 + this.rampD + (s - sEnd) / this.r1;
    const a = (this.r1 - this.r0) / (2 * this.rampD);
    if (Math.abs(a) < 1e-9) return this.t0 + s / this.r0;
    const tau = (-this.r0 + Math.sqrt(this.r0 * this.r0 + 4 * a * s)) / (2 * a);
    return this.t0 + tau;
  }

  private timeToBeat(t: number): number {
    const tau = t - this.t0;
    const bt = this.beatTrack;
    if (tau <= 0 || this.rampD <= 0) return (tau * this.r0) / bt;
    if (tau >= this.rampD)
      return (((this.r0 + this.r1) / 2) * this.rampD + (tau - this.rampD) * this.r1) / bt;
    return (this.r0 * tau + ((this.r1 - this.r0) * tau * tau) / (2 * this.rampD)) / bt;
  }

  async start(
    plan: TransitionPlan,
    outDeck: number,
    inDeck: number,
    trackId: string,
    onDone?: () => void,
  ): Promise<boolean> {
    if (this.plan) this.cancel(false);
    const ui = useUI.getState();
    const ai = useAI.getState();
    const outState = deckState(outDeck);
    if (!outState.playing) {
      ui.toast('Start the playing deck first – the AI mixes out of it.', 'error');
      return false;
    }
    ai.setMix({ phase: 'preparing', plan, outDeck, inDeck, trackId, progress: -1 });

    // 1. Make sure the incoming track is on the free deck, cued at the plan's start.
    if (deckState(inDeck).trackId !== trackId || deckState(inDeck).playing) {
      if (deckState(inDeck).playing) {
        ui.toast('The other deck is busy.', 'error');
        ai.setMix(idleMix());
        return false;
      }
      const ok = await loadTrack(inDeck, trackId, { startAt: plan.inStart });
      if (!ok) {
        ai.setMix(idleMix());
        return false;
      }
    }

    // 2. Timing model of the outgoing deck.
    const snap = engine.transport.snapshot(outDeck);
    if (!snap || snap.rate <= 0) {
      ai.setMix(idleMix());
      return false;
    }
    if (snap.loopOn) engine.send({ type: 'loopOff', deck: outDeck });
    const outTrack = useLibrary.getState().tracks[outState.trackId!];
    const g = trackGrid(outTrack);
    this.beatTrack = 60 / (g.bpm || 120);
    this.r0 = snap.tempo || snap.rate;
    this.r1 = this.r0 * (plan.inRateEnd / plan.inRate);
    const L = Math.max(1, plan.endBeat);
    this.rampD = Math.abs(this.r1 - this.r0) > 1e-4 ? (2 * L * this.beatTrack) / (this.r0 + this.r1) : 0;
    const now = engine.ctx!.currentTime;
    this.t0 = snap.time + (plan.outSwitch - snap.pos) / snap.rate;
    if (this.beatToTime(plan.startBeat) < now + 0.05) {
      ui.toast('Too late for that phrase – try "Mix now".', 'error');
      ai.setMix(idleMix());
      return false;
    }

    this.plan = plan;
    this.out = outDeck;
    this.inn = inDeck;
    this.onDone = onDone ?? null;
    this.started = false;

    // 3. Prepare the incoming deck: key lock, key shift, tempo-follow, initial mixer state.
    engine.setKeyLock(inDeck, true);
    useDecks.getState().setDeck(inDeck, { keyLock: true });
    setKeyShift(inDeck, plan.keyShift);
    makeMaster(outDeck);
    engine.setSyncMode(inDeck, 'beat');
    useDecks.getState().setDeck(inDeck, { sync: 'beat' });
    const mixer = useMixer.getState();
    const initIn: Partial<ChannelState> = { fader: 0, eqLow: 0.5, eqMid: 0.5, eqHigh: 0.5, filter: 0 };
    for (const lane of plan.lanes) {
      const map = LANE_TO_STRIP[lane.param];
      if (map && map[0] === 'in') initIn[map[2]] = lane.points[0][1] as never;
    }
    mixer.setChannel(inDeck, initIn, 'auto');
    if (mixer.ch[outDeck].fader < 0.05) mixer.setChannel(outDeck, { fader: 0.85 }, 'auto');
    if (Math.abs(mixer.xfader - 0.5) > 0.02) mixer.setXfader(0.5, 'auto');

    // 4. Arm the sample-accurate start of the incoming deck on the outgoing deck's downbeat.
    engine.send({
      type: 'arm',
      deck: inDeck,
      trigger: outDeck,
      triggerSec: plan.outSwitch,
      startSec: plan.inStart,
    });
    useDecks.getState().setDeck(inDeck, { armed: true });

    // 5. Pre-schedule the automation.
    this.lanes = [];
    for (const lane of plan.lanes) {
      const map = LANE_TO_STRIP[lane.param];
      const deck = lane.param.startsWith('out') ? outDeck : inDeck;
      if (map) {
        const pts = this.samplePoints(lane);
        engine.strips[deck]?.schedule(map[1], pts);
        automation.add(autoKey(deck, map[2]));
        this.lanes.push(lane);
      } else if (lane.param === 'out.fxMix') {
        engine.fx[outDeck]?.scheduleMix(this.samplePoints(lane));
        this.lanes.push(lane);
      }
    }
    for (const a of plan.actions) {
      const deck = a.deck === 'out' ? outDeck : inDeck;
      const when = this.beatToTime(a.beat);
      const outPosAt = plan.outSwitch + a.beat * this.beatTrack;
      switch (a.kind) {
        case 'fx': {
          const fx = { ...deckState(deck).fx, ...a.fx };
          setTimeout(() => useDecks.getState().setDeck(deck, { fx }), Math.max(0, (when - now) * 1000));
          engine.fx[deck]?.apply(fx, when);
          break;
        }
        case 'fxOff': {
          setTimeout(() => setFx(deck, { on: false }), Math.max(0, (when - now) * 1000));
          break;
        }
        case 'loop': {
          const size = (a.beats ?? 1) * this.beatTrack;
          engine.send({
            type: 'at',
            deck: outDeck,
            sec: outPosAt - 0.002,
            tag: TAG,
            cmd: { type: 'loop', deck: outDeck, startSec: outPosAt, endSec: outPosAt + size },
          });
          break;
        }
        case 'loopOff':
          setTimeout(() => engine.send({ type: 'loopOff', deck: outDeck }), Math.max(0, (when - now) * 1000));
          break;
        case 'spinback':
          engine.send({
            type: 'at',
            deck: outDeck,
            sec: outPosAt,
            tag: TAG,
            cmd: { type: 'spinback', deck: outDeck, seconds: 0.8 },
          });
          break;
        case 'brake':
          engine.send({
            type: 'at',
            deck: outDeck,
            sec: outPosAt,
            tag: TAG,
            cmd: { type: 'brake', deck: outDeck, seconds: 1.2 },
          });
          break;
        case 'sample':
          if (a.pad !== undefined) engine.sampler?.trigger(a.pad, when);
          break;
        case 'stopOut':
          break;
      }
    }
    if (this.rampD > 0) {
      engine.send({
        type: 'at',
        deck: outDeck,
        sec: plan.outSwitch,
        tag: TAG,
        cmd: { type: 'tempoRamp', deck: outDeck, to: this.r1, seconds: this.rampD },
      });
    }

    useAI.getState().setMix({ phase: 'armed', t0: this.t0, progress: -1 });
    this.loop();
    return true;
  }

  private samplePoints(lane: Lane): [number, number][] {
    const p = this.plan!;
    const pts: [number, number][] = [];
    const first = Math.min(p.startBeat, lane.points[0][0]);
    const last = Math.max(p.endBeat, lane.points[lane.points.length - 1][0]);
    for (let b = first; b <= last + 1e-9; b += 0.125)
      pts.push([this.beatToTime(b), laneValue(lane.points, b)]);
    // Include the exact breakpoints so steps (e.g. bass swaps) stay sharp.
    for (const [b, v] of lane.points) pts.push([this.beatToTime(b), v]);
    pts.sort((x, y) => x[0] - y[0]);
    return pts;
  }

  private loop(): void {
    const tick = () => this.update();
    this.timer = setInterval(tick, 250);
    const frame = () => {
      if (!this.plan) return;
      this.update();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private update(): void {
    const p = this.plan;
    if (!p || !engine.ctx) return;
    const now = engine.ctx.currentTime;
    const beat = this.timeToBeat(now);
    const ai = useAI.getState();
    // Mirror lane values onto the on-screen controls (engine already has them scheduled).
    const mixer = useMixer.getState();
    const patches: [Partial<ChannelState>, Partial<ChannelState>] = [{}, {}];
    for (const lane of this.lanes) {
      const map = LANE_TO_STRIP[lane.param];
      if (!map) continue;
      const deck = map[0] === 'out' ? this.out : this.inn;
      const v = laneValue(lane.points, beat);
      if (Math.abs((mixer.ch[deck][map[2]] as number) - v) > 0.002)
        (patches[deck] as Record<string, number>)[map[2]] = v;
    }
    patches.forEach((pt, d) => Object.keys(pt).length && mixer.setChannel(d, pt, 'auto'));
    if (beat >= 0 && !this.started) {
      // The incoming deck has started (armed trigger); it keeps following the outgoing
      // deck's tempo/phase until the transition completes.
      this.started = true;
      useDecks.getState().setDeck(this.inn, { playing: true, armed: false });
      noteNowPlaying(this.inn);
    }
    const span = Math.max(1, p.endBeat);
    ai.setMix({
      phase: beat >= Math.min(0, p.startBeat) ? 'running' : 'armed',
      progress: beat < 0 ? beat / Math.max(1, -p.startBeat || 16) : Math.min(1, beat / span),
    });
    if (beat >= p.endBeat + 0.5) this.finish();
  }

  private userTouched(deck: number | 'x', keys: string[]): void {
    if (!this.plan || deck === 'x') return;
    for (const k of keys) {
      const lane = this.lanes.find((l) => {
        const m = LANE_TO_STRIP[l.param];
        return m && m[2] === k && (m[0] === 'out' ? this.out : this.inn) === deck;
      });
      if (!lane) continue;
      const m = LANE_TO_STRIP[lane.param]!;
      engine.strips[deck]?.cancelSchedule(m[1]);
      automation.remove(autoKey(deck, m[2]));
      this.lanes = this.lanes.filter((l) => l !== lane);
      // Re-apply what the user set, now that the schedule is gone.
      const c = useMixer.getState().ch[deck];
      useMixer
        .getState()
        .setChannel(deck, { [k]: c[k as keyof ChannelState] } as Partial<ChannelState>, 'auto');
      if (m[1] === 'fader') engine.strips[deck]?.setFader(c.fader);
    }
  }

  private finish(): void {
    const p = this.plan;
    if (!p) return;
    const out = this.out;
    this.stopLoops();
    engine.pause(out);
    useDecks.getState().setDeck(out, { playing: false });
    // Reset the outgoing channel to neutral (fader stays down).
    automation.clear();
    useMixer.getState().setChannel(out, { eqLow: 0.5, eqMid: 0.5, eqHigh: 0.5, filter: 0, fader: 0 }, 'auto');
    for (const k of ['eqLow', 'eqMid', 'eqHigh', 'filter', 'fader'] as const) {
      const c = useMixer.getState().ch[out];
      if (k === 'fader') engine.strips[out]?.setFader(c.fader);
      else if (k === 'filter') engine.strips[out]?.setFilter(c.filter);
      else engine.strips[out]?.setEq(k === 'eqLow' ? 'low' : k === 'eqMid' ? 'mid' : 'high', c[k]);
    }
    const inC = useMixer.getState().ch[this.inn];
    engine.strips[this.inn]?.setFader(inC.fader);
    // Hand the lead to the new track.
    makeMaster(this.inn);
    engine.setSyncMode(this.inn, 'off');
    useDecks.getState().setDeck(this.inn, { sync: 'off' });
    if (deckState(out).fx.on) setFx(out, { on: false });
    this.plan = null;
    useAI.getState().setMix(idleMix());
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  private stopLoops(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
  }

  /** Abort: stop schedules where they are and hand the controls back. */
  cancel(notify = true): void {
    if (!this.plan) return;
    this.stopLoops();
    const pending = !this.started;
    engine.send({ type: 'cancelAt', deck: this.out, tag: TAG });
    if (pending) {
      engine.send({ type: 'disarm', deck: this.inn });
      useDecks.getState().setDeck(this.inn, { armed: false });
    }
    for (const lane of this.lanes) {
      const m = LANE_TO_STRIP[lane.param];
      if (!m) continue;
      const deck = m[0] === 'out' ? this.out : this.inn;
      engine.strips[deck]?.cancelSchedule(m[1]);
    }
    automation.clear();
    this.lanes = [];
    this.plan = null;
    useAI.getState().setMix(idleMix());
    if (notify) useUI.getState().toast('AI transition cancelled – you have the controls.', 'info');
  }
}

export const autoMixer = new AutoMixer();
