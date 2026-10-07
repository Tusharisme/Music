import { engine } from '../audio/engine';
import { smartChannel } from '../audio/curves';
import { useMixer, type ChannelState } from '../state/mixer';
import { useSettings } from '../state/settings';
import { useDecks, deckState } from '../state/decks';
import { useLibrary } from '../state/library';
import { automation, autoKey } from './automation';
import { applyAutoGain, noteNowPlaying, refreshGrid } from './decks';
import type { EngineEvent } from '../audio/protocol';

const STRIP_KEYS: (keyof ChannelState)[] = ['trim', 'eqHigh', 'eqMid', 'eqLow', 'filter', 'fader', 'cue'];

/** A channel's low EQ and filter with the crossfader's combo move (if any) on top of the knobs. */
function smart(deck: number, c: ChannelState) {
  const mode = automation.has(autoKey('x', 'xfader')) ? 'off' : useSettings.getState().crossfaderMode;
  return smartChannel(mode, useMixer.getState().xfader, deck, c.eqLow, c.filter);
}

/** Re-apply the parts of both channels that follow the crossfader. */
function applySmart(): void {
  useMixer.getState().ch.forEach((c, d) => {
    const strip = engine.strips[d];
    if (!strip) return;
    const v = smart(d, c);
    if (!automation.has(autoKey(d, 'eqLow'))) strip.setEq('low', v.eqLow);
    if (!automation.has(autoKey(d, 'filter'))) strip.setFilter(v.filter);
  });
}

function applyChannel(deck: number, c: ChannelState, prev?: ChannelState): void {
  const strip = engine.strips[deck];
  if (!strip) return;
  for (const k of STRIP_KEYS) {
    if (prev && prev[k] === c[k]) continue;
    if (automation.has(autoKey(deck, k))) continue;
    switch (k) {
      case 'trim':
        strip.setTrim(c.trim);
        break;
      case 'eqHigh':
        strip.setEq('high', c.eqHigh);
        break;
      case 'eqMid':
        strip.setEq('mid', c.eqMid);
        break;
      case 'eqLow':
        strip.setEq('low', smart(deck, c).eqLow);
        break;
      case 'filter':
        strip.setFilter(smart(deck, c).filter);
        break;
      case 'fader':
        strip.setFader(c.fader);
        break;
      case 'cue':
        strip.setCue(c.cue);
        break;
    }
  }
}

function applyAll(): void {
  const m = useMixer.getState();
  const s = useSettings.getState();
  m.ch.forEach((c, d) => applyChannel(d, c));
  engine.setCrossfader(m.xfader, s.crossfaderCurve);
  engine.master?.setVolume(m.master);
  engine.master?.setCueLevel(m.cueMix);
  engine.master?.setLimiter(s.limiter);
  engine.master?.setSplitCue(s.splitCue);
  engine.sampler?.setVolume(m.sampler);
  engine.strips.forEach((st) => st.setFilterResonance(s.filterResonance));
  useDecks.getState().decks.forEach((d, i) => engine.applyFx(i, d.fx));
}

let lastFxTiming = 0;

function onEngineEvent(ev: EngineEvent): void {
  const decks = useDecks.getState();
  if (ev.type === 'ended') {
    decks.setDeck(ev.deck, { playing: false });
    return;
  }
  if (ev.type === 'started') {
    decks.setDeck(ev.deck, { playing: true, armed: false });
    return;
  }
  if (ev.type !== 'tick') return;
  ev.decks.forEach((t, i) => {
    const d = decks.decks[i];
    if (!d.trackId || d.loading) return;
    const patch: Partial<typeof d> = {};
    if (t.playing !== d.playing && !t.armed) patch.playing = t.playing;
    if (t.armed !== d.armed) patch.armed = t.armed;
    if (
      t.loopOn !== d.loop.on ||
      (t.loopOn && (Math.abs(t.loopStart - d.loop.start) > 1e-3 || Math.abs(t.loopEnd - d.loop.end) > 1e-3))
    ) {
      patch.loop = t.loopOn ? { on: true, start: t.loopStart, end: t.loopEnd } : { ...d.loop, on: false };
    }
    if (Math.abs(t.tempo - d.tempo) > 1e-5) patch.tempo = t.tempo;
    if (Object.keys(patch).length) decks.setDeck(i, patch);
  });
  // Master hand-over when the master stops.
  const m = decks.master;
  const o = m === 0 ? 1 : 0;
  if (!ev.decks[m]?.playing && ev.decks[o]?.playing && decks.decks[o].trackId) {
    decks.setMaster(o);
    engine.setMaster(o);
    noteNowPlaying(o);
  }
  // Beat-synced effects need the beat phase ~10x a second.
  if (ev.time - lastFxTiming > 0.1) {
    lastFxTiming = ev.time;
    ev.decks.forEach((t, i) => {
      const d = deckState(i);
      if (d.bpm <= 0) return;
      const beatSec = 60 / d.bpm / Math.max(0.05, t.tempo);
      const beat = (t.pos - d.firstBeat) / (60 / d.bpm);
      engine.fx[i]?.setTiming({ beatSec, refTime: ev.time, beat });
    });
  }
}

let started = false;

/** Wire stores ⇄ engine. Safe to call before the engine exists; applies once it's built. */
export function startBridge(): void {
  if (started) return;
  started = true;

  useMixer.subscribe(
    (s) => s.ch,
    (ch, prev) => ch.forEach((c, d) => applyChannel(d, c, prev[d])),
  );
  useMixer.subscribe(
    (s) => s.xfader,
    (x) => {
      if (automation.has(autoKey('x', 'xfader'))) return;
      engine.setCrossfader(x, useSettings.getState().crossfaderCurve);
      if (useSettings.getState().crossfaderMode !== 'off') applySmart();
    },
  );
  useMixer.subscribe(
    (s) => s.master,
    (v) => engine.master?.setVolume(v),
  );
  useMixer.subscribe(
    (s) => s.cueMix,
    (v) => engine.master?.setCueLevel(v),
  );
  useMixer.subscribe(
    (s) => s.sampler,
    (v) => engine.sampler?.setVolume(v),
  );
  useSettings.subscribe((s, p) => {
    if (s.crossfaderCurve !== p.crossfaderCurve)
      engine.setCrossfader(useMixer.getState().xfader, s.crossfaderCurve);
    if (s.crossfaderMode !== p.crossfaderMode) applySmart();
    if (s.limiter !== p.limiter) engine.master?.setLimiter(s.limiter);
    if (s.splitCue !== p.splitCue) engine.master?.setSplitCue(s.splitCue);
    if (s.filterResonance !== p.filterResonance)
      engine.strips.forEach((st) => st.setFilterResonance(s.filterResonance));
    if (s.autoGain !== p.autoGain || s.autoGainTarget !== p.autoGainTarget) [0, 1].forEach(applyAutoGain);
  });

  // Late analysis results (track loaded before its analysis finished, or grid edits).
  useLibrary.subscribe((s, p) => {
    if (s.tracks === p.tracks) return;
    useDecks.getState().decks.forEach((d, i) => {
      if (!d.trackId) return;
      const a = s.tracks[d.trackId];
      const b = p.tracks[d.trackId];
      if (!a || a === b) return;
      if (a.analysis !== b?.analysis || a.gridOverride !== b?.gridOverride) {
        refreshGrid(i);
        applyAutoGain(i);
      }
    });
  });

  engine.on(onEngineEvent);
  void engine.init().then(applyAll);
}
