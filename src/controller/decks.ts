import { engine } from '../audio/engine';
import { deckState, freshDeck, HOT_CUE_COLORS, useDecks, type DeckState } from '../state/decks';
import { loadWaveform, useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { useUI } from '../state/ui';
import { useHistory } from '../state/history';
import { analysisQueue } from '../library/analysisQueue';
import { loadPlaybackPcm } from '../library/playback';
import type { FxSettings } from '../audio/effects';
import type { Beatgrid, TrackRecord } from '../types';
import { bestKeyShift, effectiveKey } from '../ai/harmonic';
import { trackKey } from '../ai/recommender';

const set = (deck: number, patch: Partial<DeckState>) => useDecks.getState().setDeck(deck, patch);
const toast = (t: string, k?: 'info' | 'success' | 'error') => useUI.getState().toast(t, k);
const other = (deck: number): 0 | 1 => (deck === 0 ? 1 : 0);

export function trackGrid(t: TrackRecord | undefined): Beatgrid {
  return t?.gridOverride ?? t?.analysis?.beatgrid ?? { bpm: 0, firstBeat: 0 };
}

export function deckTrack(deck: number): TrackRecord | undefined {
  const id = deckState(deck).trackId;
  return id ? useLibrary.getState().tracks[id] : undefined;
}

export function position(deck: number): number {
  return engine.transport.position(deck);
}

/** Snap a time to the deck's beat grid. */
export function snap(deck: number, t: number, mode: 'round' | 'floor' = 'round', resolution = 1): number {
  const d = deckState(deck);
  if (!d.quantize || d.bpm <= 0) return t;
  const beat = (60 / d.bpm) * resolution;
  const k = (t - d.firstBeat) / beat;
  const q = mode === 'floor' ? Math.floor(k + 1e-6) : Math.round(k);
  return Math.max(0, d.firstBeat + q * beat);
}

function autoGainDb(t: TrackRecord | undefined): number {
  const s = useSettings.getState();
  if (!s.autoGain || !t?.analysis) return 0;
  return Math.max(-12, Math.min(12, s.autoGainTarget - t.analysis.loudness));
}

export function applyAutoGain(deck: number): void {
  engine.strips[deck]?.setAutoGain(autoGainDb(deckTrack(deck)));
}

/** Push a (possibly late-arriving) beat grid to the engine and deck state. */
export function refreshGrid(deck: number): void {
  const t = deckTrack(deck);
  if (!t) return;
  const g = trackGrid(t);
  set(deck, { bpm: g.bpm, firstBeat: g.firstBeat });
  engine.setGrid(deck, g.bpm, g.firstBeat);
}

// ---------------------------------------------------------------- loading

export async function loadTrack(
  deck: number,
  trackId: string,
  opts: { force?: boolean; startAt?: number } = {},
): Promise<boolean> {
  const lib = useLibrary.getState();
  const t = lib.tracks[trackId];
  if (!t) return false;
  const d = deckState(deck);
  if (d.playing && !opts.force) {
    toast(`Deck ${deck === 0 ? 'A' : 'B'} is playing – pause it before loading a new track.`, 'error');
    return false;
  }
  await engine.init();
  analysisQueue.prioritize(trackId);
  void loadWaveform(trackId);
  const s = useSettings.getState();
  const known = trackGrid(t);
  set(deck, {
    ...freshDeck(),
    trackId,
    loading: true,
    duration: t.analysis?.duration ?? t.duration ?? 0,
    bpm: known.bpm,
    firstBeat: known.firstBeat,
    keyLock: s.defaultKeyLock,
    quantize: s.quantize,
    vinyl: s.vinylMode,
    tempoRange: s.tempoRange,
    fx: d.fx,
    padMode: d.padMode,
    autoLoopBeats: d.autoLoopBeats,
    jumpBeats: d.jumpBeats,
    hotCues: t.hotCues ? [...t.hotCues] : new Array(8).fill(null),
  });
  engine.pause(deck);
  try {
    const pcm = await loadPlaybackPcm(t, engine.ctx!);
    if (deckState(deck).trackId !== trackId) return false;
    const g = trackGrid(useLibrary.getState().tracks[trackId] ?? t);
    engine.loadDeckPcm(deck, pcm.L, pcm.R, pcm.sampleRate, pcm.duration, g.bpm, g.firstBeat);
    const latest = useLibrary.getState().tracks[trackId] ?? t;
    const cue = Math.max(0, opts.startAt ?? latest.cuePoint ?? latest.analysis?.structure.mixIn ?? 0);
    engine.seek(deck, cue, { smooth: false });
    engine.setTempo(deck, 1);
    engine.setKeyLock(deck, s.defaultKeyLock);
    engine.setKeyShift(deck, 0);
    engine.setSyncMode(deck, 'off');
    engine.send({ type: 'slip', deck, on: false });
    set(deck, { loading: false, duration: pcm.duration, bpm: g.bpm, firstBeat: g.firstBeat, cue });
    applyAutoGain(deck);
    return true;
  } catch (err) {
    set(deck, { loading: false, error: (err as Error).message });
    toast(`Couldn't load "${t.title}": ${(err as Error).message}`, 'error');
    return false;
  }
}

export function eject(deck: number): void {
  if (deckState(deck).playing) return;
  engine.unloadDeck(deck);
  set(deck, { ...freshDeck(), fx: deckState(deck).fx });
}

// ---------------------------------------------------------------- transport

function becomeMasterIfAlone(deck: number): void {
  const o = deckState(other(deck));
  if (!o.playing || !o.trackId) {
    useDecks.getState().setMaster(deck as 0 | 1);
    engine.setMaster(deck);
  }
}

export function noteNowPlaying(deck: number): void {
  const t = deckTrack(deck);
  if (!t) return;
  useHistory.getState().add({ trackId: t.id, title: t.title, artist: t.artist, deck });
  useLibrary.getState().markPlayed(t.id);
}

export async function play(deck: number): Promise<void> {
  const d = deckState(deck);
  if (!d.trackId || d.loading) return;
  await engine.init();
  becomeMasterIfAlone(deck);
  engine.play(deck);
  set(deck, { playing: true, armed: false });
  if (useDecks.getState().master === deck) noteNowPlaying(deck);
}

export function pause(deck: number): void {
  engine.pause(deck);
  set(deck, { playing: false, armed: false });
  const o = other(deck);
  if (useDecks.getState().master === deck && deckState(o).playing) {
    useDecks.getState().setMaster(o);
    engine.setMaster(o);
  }
}

export function togglePlay(deck: number): void {
  if (deckState(deck).playing) pause(deck);
  else void play(deck);
}

let cuePreview: [boolean, boolean] = [false, false];

export function cueDown(deck: number): void {
  const d = deckState(deck);
  if (!d.trackId || d.loading) return;
  if (d.playing && !cuePreview[deck]) {
    engine.pause(deck);
    engine.seek(deck, d.cue, { smooth: false });
    set(deck, { playing: false });
    return;
  }
  const pos = position(deck);
  if (Math.abs(pos - d.cue) > 0.03) {
    const q = snap(deck, pos);
    set(deck, { cue: q });
    engine.seek(deck, q, { smooth: false });
    const id = d.trackId;
    void useLibrary.getState().update(id, { cuePoint: q });
  }
  cuePreview[deck] = true;
  void engine.init().then(() => {
    engine.play(deck);
    set(deck, { playing: true });
  });
}

export function cueUp(deck: number): void {
  if (!cuePreview[deck]) return;
  cuePreview = deck === 0 ? [false, cuePreview[1]] : [cuePreview[0], false];
  const d = deckState(deck);
  engine.pause(deck);
  engine.seek(deck, d.cue, { smooth: false });
  set(deck, { playing: false });
}

/** Releasing CUE while holding PLAY keeps playing (CDJ "cue → play" move). */
export function cueToPlay(deck: number): void {
  cuePreview = deck === 0 ? [false, cuePreview[1]] : [cuePreview[0], false];
  void play(deck);
}

export function seek(deck: number, sec: number): void {
  const d = deckState(deck);
  if (!d.trackId) return;
  const target = Math.max(0, Math.min(d.duration - 0.05, sec));
  engine.seek(deck, target, { smooth: true, keepPhase: d.playing && d.quantize && d.bpm > 0 });
}

export function brake(deck: number, spin = false): void {
  if (!deckState(deck).playing) return;
  engine.send({ type: spin ? 'spinback' : 'brake', deck, seconds: spin ? 0.9 : 1.6 });
}

// ---------------------------------------------------------------- hot cues

export function hotCue(deck: number, i: number): void {
  const d = deckState(deck);
  if (!d.trackId) return;
  const hc = d.hotCues[i];
  if (!hc) {
    const t = snap(deck, position(deck));
    const hotCues = [...d.hotCues];
    hotCues[i] = { time: t, color: HOT_CUE_COLORS[i % HOT_CUE_COLORS.length] };
    set(deck, { hotCues });
    void useLibrary.getState().update(d.trackId, { hotCues });
    return;
  }
  engine.seek(deck, hc.time, { smooth: true, keepPhase: d.playing && d.quantize && d.bpm > 0 });
  if (!d.playing) void play(deck);
}

export function deleteHotCue(deck: number, i: number): void {
  const d = deckState(deck);
  if (!d.trackId) return;
  const hotCues = [...d.hotCues];
  hotCues[i] = null;
  set(deck, { hotCues });
  void useLibrary.getState().update(d.trackId, { hotCues });
}

// ---------------------------------------------------------------- loops

export function setLoop(deck: number, start: number, end: number): void {
  engine.send({ type: 'loop', deck, startSec: start, endSec: end });
  set(deck, { loop: { on: true, start, end } });
}

export function exitLoop(deck: number): void {
  engine.send({ type: 'loopOff', deck });
  const d = deckState(deck);
  set(deck, { loop: { ...d.loop, on: false } });
}

export function autoLoop(deck: number, beats?: number): void {
  const d = deckState(deck);
  if (!d.trackId || d.bpm <= 0) return;
  const size = beats ?? d.autoLoopBeats;
  if (d.loop.on && beats === undefined) return exitLoop(deck);
  const beat = 60 / d.bpm;
  const pos = position(deck);
  const start = d.quantize ? snap(deck, pos, 'floor', Math.min(1, size)) : pos;
  setLoop(deck, start, start + size * beat);
  set(deck, { autoLoopBeats: size });
}

export function resizeLoop(deck: number, factor: number): void {
  const d = deckState(deck);
  const size = Math.max(1 / 32, Math.min(64, d.autoLoopBeats * factor));
  set(deck, { autoLoopBeats: size });
  if (d.loop.on && d.bpm > 0) setLoop(deck, d.loop.start, d.loop.start + size * (60 / d.bpm));
}

let loopInPoint: [number | null, number | null] = [null, null];

export function loopIn(deck: number): void {
  const p = snap(deck, position(deck));
  loopInPoint = deck === 0 ? [p, loopInPoint[1]] : [loopInPoint[0], p];
  const d = deckState(deck);
  set(deck, { loop: { on: false, start: p, end: Math.max(p, d.loop.end) } });
}

export function loopOut(deck: number): void {
  const start = loopInPoint[deck];
  if (start === null) return;
  const end = snap(deck, position(deck));
  if (end - start < 0.05) return;
  setLoop(deck, start, end);
  const d = deckState(deck);
  if (d.bpm > 0) set(deck, { autoLoopBeats: Math.round(((end - start) / (60 / d.bpm)) * 4) / 4 });
}

export function reloop(deck: number): void {
  const d = deckState(deck);
  if (d.loop.on) return exitLoop(deck);
  if (d.loop.end > d.loop.start) setLoop(deck, d.loop.start, d.loop.end);
}

export function roll(deck: number, beats: number, down: boolean): void {
  const d = deckState(deck);
  if (!d.trackId || d.bpm <= 0) return;
  if (down) engine.send({ type: 'roll', deck, beats });
  else engine.send({ type: 'rollEnd', deck });
}

export function beatJump(deck: number, beats: number): void {
  const d = deckState(deck);
  if (!d.trackId || d.bpm <= 0) return;
  engine.send({ type: 'beatJump', deck, beats });
  if (d.loop.on) {
    const delta = beats * (60 / d.bpm);
    set(deck, { loop: { on: true, start: d.loop.start + delta, end: d.loop.end + delta } });
  }
}

// ---------------------------------------------------------------- tempo, sync, key

export function setTempo(deck: number, rate: number): void {
  const d = deckState(deck);
  const master = useDecks.getState().master;
  if (d.sync !== 'off' && master !== deck) {
    set(deck, { sync: 'off' });
    engine.setSyncMode(deck, 'off');
  }
  engine.setTempo(deck, rate);
  set(deck, { tempo: rate });
}

export function resetTempo(deck: number): void {
  setTempo(deck, 1);
}

export function setTempoRange(deck: number, range: number): void {
  set(deck, { tempoRange: range });
}

export function syncPress(deck: number): void {
  const d = deckState(deck);
  if (!d.trackId) return;
  if (d.sync !== 'off') {
    set(deck, { sync: 'off' });
    engine.setSyncMode(deck, 'off');
    return;
  }
  const o = other(deck);
  const od = deckState(o);
  if (!od.trackId || od.bpm <= 0 || d.bpm <= 0) {
    toast('Sync needs a beat grid on both decks.', 'error');
    return;
  }
  useDecks.getState().setMaster(o);
  engine.setMaster(o);
  const mode = useSettings.getState().defaultSync === 'off' ? 'beat' : useSettings.getState().defaultSync;
  engine.setSyncMode(deck, mode);
  set(deck, { sync: mode });
  if (d.playing && mode === 'beat') engine.send({ type: 'alignPhase', deck });
}

export function makeMaster(deck: number): void {
  useDecks.getState().setMaster(deck as 0 | 1);
  engine.setMaster(deck);
  const d = deckState(deck);
  if (d.sync !== 'off') {
    // The master can't follow itself; keep the other deck locked instead.
    set(deck, { sync: 'off' });
    engine.setSyncMode(deck, 'off');
  }
}

const bendTimers: (ReturnType<typeof setInterval> | null)[] = [null, null];

/** Pitch bend while a nudge button is held (re-sent so the engine's safety release doesn't fire). */
export function nudge(deck: number, dir: -1 | 0 | 1): void {
  const t = bendTimers[deck];
  if (t) clearInterval(t);
  bendTimers[deck] = null;
  const amount = dir * 0.04;
  engine.send({ type: 'bend', deck, amount });
  if (dir !== 0) bendTimers[deck] = setInterval(() => engine.send({ type: 'bend', deck, amount }), 120);
}

export function bend(deck: number, amount: number): void {
  engine.send({ type: 'bend', deck, amount });
}

export function toggleKeyLock(deck: number): void {
  const d = deckState(deck);
  const on = !d.keyLock;
  engine.setKeyLock(deck, on);
  set(deck, { keyLock: on, keyShift: on ? d.keyShift : 0 });
  if (!on) engine.setKeyShift(deck, 0);
}

export function setKeyShift(deck: number, semis: number): void {
  const s = Math.max(-6, Math.min(6, Math.round(semis)));
  const d = deckState(deck);
  if (!d.keyLock) {
    engine.setKeyLock(deck, true);
  }
  engine.setKeyShift(deck, s);
  set(deck, { keyShift: s, keyLock: true });
}

/** Shift this deck's key to the most compatible key with the other deck. */
export function keySync(deck: number): void {
  const t = deckTrack(deck);
  const o = deckTrack(other(deck));
  const od = deckState(other(deck));
  if (!t?.analysis || !o?.analysis) return;
  const oKey = effectiveKey(trackKey(o) ?? o.analysis.key, od.tempo, od.keyLock, od.keyShift);
  const m = bestKeyShift(oKey, trackKey(t) ?? t.analysis.key, 6);
  setKeyShift(deck, m.shift);
  toast(
    m.shift ? `Key shift ${m.shift > 0 ? '+' : ''}${m.shift}: ${m.label}` : `Already compatible: ${m.label}`,
    'success',
  );
}

// ---------------------------------------------------------------- misc deck options

export function toggleSlip(deck: number): void {
  const on = !deckState(deck).slip;
  engine.send({ type: 'slip', deck, on });
  set(deck, { slip: on });
}

export function setReverse(deck: number, on: boolean): void {
  engine.send({ type: 'reverse', deck, on });
  set(deck, { reverse: on });
}

export function setFx(deck: number, patch: Partial<FxSettings>): void {
  const fx = { ...deckState(deck).fx, ...patch };
  set(deck, { fx });
  engine.applyFx(deck, fx);
}

// ---------------------------------------------------------------- scratching

export function scratchStart(deck: number): void {
  engine.send({ type: 'scratchStart', deck });
}

export function scratchMove(deck: number, sec: number, vel: number): void {
  engine.send({ type: 'scratchMove', deck, sec, vel });
}

export function scratchEnd(deck: number): void {
  engine.send({ type: 'scratchEnd', deck });
}
