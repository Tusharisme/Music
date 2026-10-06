import { useSettings, type MidiMapping } from '../state/settings';
import { useUI } from '../state/ui';
import { useMixer } from '../state/mixer';
import { useDecks } from '../state/decks';
import { engine } from '../audio/engine';
import * as ctl from '../controller/decks';

/** Web MIDI controller support with MIDI-learn (Chrome, Edge, Opera, Android). */

export const midiSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

let access: MIDIAccess | null = null;

function key(kind: 'cc' | 'note', ch: number, num: number): string {
  return `${kind}:${ch}:${num}`;
}

function dispatch(target: string, value: number, press: boolean | null, raw: number): void {
  const deckMatch = /^deck(\d)\.(.+)$/.exec(target);
  if (deckMatch) {
    const deck = Number(deckMatch[1]);
    const action = deckMatch[2];
    const d = useDecks.getState().decks[deck];
    if (action === 'tempo') {
      const range = d.tempoRange / 100;
      ctl.setTempo(deck, 1 - range + value * 2 * range);
      return;
    }
    if (action === 'jog') {
      const delta = raw < 64 ? raw : raw - 128;
      ctl.bend(deck, Math.max(-0.5, Math.min(0.5, delta * 0.04)));
      return;
    }
    if (action === 'fxmix') return ctl.setFx(deck, { mix: value });
    if (action === 'fxparam') return ctl.setFx(deck, { param: value });
    if (action === 'cue') {
      if (press === true) ctl.cueDown(deck);
      else if (press === false) ctl.cueUp(deck);
      return;
    }
    if (press !== true) return;
    if (action === 'play') ctl.togglePlay(deck);
    else if (action === 'sync') ctl.syncPress(deck);
    else if (action === 'loop') ctl.autoLoop(deck);
    else if (action === 'keylock') ctl.toggleKeyLock(deck);
    else if (action === 'fx') ctl.setFx(deck, { on: !d.fx.on });
    else if (action.startsWith('hotcue')) ctl.hotCue(deck, Number(action.slice(6)) - 1);
    return;
  }
  const mix = /^mixer\.ch(\d)\.(\w+)$/.exec(target);
  if (mix) {
    const deck = Number(mix[1]);
    const param = mix[2];
    const v = param === 'filter' ? value * 2 - 1 : value;
    useMixer.getState().setChannel(deck, { [param]: v });
    return;
  }
  if (target === 'mixer.xfader') return useMixer.getState().setXfader(value);
  if (target === 'mixer.master') return useMixer.getState().setMaster(value);
  if (target === 'mixer.sampler') return useMixer.getState().setSampler(value);
  const pad = /^sampler\.(\d)$/.exec(target);
  if (pad && press) engine.sampler?.trigger(Number(pad[1]) - 1);
}

function onMessage(e: MIDIMessageEvent): void {
  const data = e.data;
  if (!data || data.length < 2) return;
  const status = data[0] & 0xf0;
  const ch = (data[0] & 0x0f) + 1;
  const num = data[1];
  const val = data[2] ?? 0;
  let id: string;
  let press: boolean | null = null;
  if (status === 0xb0) id = key('cc', ch, num);
  else if (status === 0x90 || status === 0x80) {
    id = key('note', ch, num);
    press = status === 0x90 && val > 0;
  } else return;

  const ui = useUI.getState();
  if (ui.midiLearn && ui.midiLearnTarget) {
    const settings = useSettings.getState();
    const mapping: MidiMapping = { input: id, target: ui.midiLearnTarget };
    settings.set({
      midi: [...settings.midi.filter((m) => m.target !== mapping.target && m.input !== id), mapping],
    });
    ui.toast(`Mapped ${id} → ${ui.midiLearnTarget}`, 'success');
    ui.setMidiLearnTarget(null);
    return;
  }
  for (const m of useSettings.getState().midi) if (m.input === id) dispatch(m.target, val / 127, press, val);
}

export async function enableMidi(): Promise<boolean> {
  if (!midiSupported()) return false;
  if (access) return true;
  try {
    access = await navigator.requestMIDIAccess();
    const attach = () => access!.inputs.forEach((input) => (input.onmidimessage = onMessage));
    attach();
    access.onstatechange = attach;
    return true;
  } catch {
    return false;
  }
}

export function midiInputs(): string[] {
  if (!access) return [];
  const names: string[] = [];
  access.inputs.forEach((i) => names.push(i.name ?? 'MIDI device'));
  return names;
}

/** While MIDI-learn is on, clicking a control with data-midi selects it as the learn target. */
export function installMidiLearn(): void {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const ui = useUI.getState();
      if (!ui.midiLearn) return;
      const el = (e.target as HTMLElement).closest('[data-midi]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.midi-target').forEach((n) => n.classList.remove('midi-target'));
      el.classList.add('midi-target');
      ui.setMidiLearnTarget(el.dataset.midi ?? null);
      void enableMidi();
      ui.toast(`Now move a control on your MIDI device for “${el.dataset.midi}”`, 'info');
    },
    true,
  );
  useUI.subscribe((s, p) => {
    if (s.midiLearn !== p.midiLearn) {
      document.body.classList.toggle('midi-learn', s.midiLearn);
      if (s.midiLearn) void enableMidi();
      else document.querySelectorAll('.midi-target').forEach((n) => n.classList.remove('midi-target'));
    }
  });
  if (useSettings.getState().midi.length) void enableMidi();
}
