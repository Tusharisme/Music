import * as ctl from './decks';
import { useMixer } from '../state/mixer';
import { useUI } from '../state/ui';
import { useAI } from '../state/ai';
import { aiMix, autoDj } from '../ai/autodj';
import { autoMixer } from '../ai/automix';
import { toggleRecording } from './recording';

export const SHORTCUTS: [string, string][] = [
  ['Q / U', 'Cue deck A / B (hold to preview)'],
  ['W / I', 'Play / pause deck A / B'],
  ['E / O', 'Sync deck A / B'],
  ['1–4 / 7–0', 'Hot cues 1–4 (Shift = delete)'],
  ['A S / J K', 'Nudge slower / faster (hold)'],
  ['D / L', 'Auto loop on/off'],
  ['F / ;', 'Key lock'],
  ['← → ↓', 'Crossfader left / right / centre'],
  ['M', 'AI Mix the top suggestion'],
  ['Shift + M', 'Cancel the AI transition'],
  ['N', 'Auto DJ on/off'],
  ['Shift + R', 'Start / stop recording'],
  ['/', 'Search the library'],
  ['?', 'Help'],
];

const DECK_KEYS: Record<string, [number, string]> = {
  q: [0, 'cue'],
  w: [0, 'play'],
  e: [0, 'sync'],
  a: [0, 'nudge-'],
  s: [0, 'nudge+'],
  d: [0, 'loop'],
  f: [0, 'keylock'],
  '1': [0, 'hc0'],
  '2': [0, 'hc1'],
  '3': [0, 'hc2'],
  '4': [0, 'hc3'],
  u: [1, 'cue'],
  i: [1, 'play'],
  o: [1, 'sync'],
  j: [1, 'nudge-'],
  k: [1, 'nudge+'],
  l: [1, 'loop'],
  ';': [1, 'keylock'],
  '7': [1, 'hc0'],
  '8': [1, 'hc1'],
  '9': [1, 'hc2'],
  '0': [1, 'hc3'],
};

const SHIFTED_DIGITS: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
};

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  );
}

export function installKeyboard(): void {
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (useUI.getState().modal) return;
    let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (SHIFTED_DIGITS[e.key]) k = SHIFTED_DIGITS[e.key];
    const mixer = useMixer.getState();
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      mixer.setXfader(Math.max(0, Math.min(1, mixer.xfader + (k === 'ArrowLeft' ? -0.04 : 0.04))));
      e.preventDefault();
      return;
    }
    if (k === 'ArrowDown') {
      mixer.setXfader(0.5);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (k === '?') return useUI.getState().open('help');
    if (k === 'm') {
      if (e.shiftKey) autoMixer.cancel();
      else {
        const top = useAI.getState().suggestions[0];
        if (top) void aiMix(top.track.id);
      }
      return;
    }
    if (k === 'n') return useAI.getState().autoDj ? autoDj.stop() : void autoDj.start();
    if (k === 'r' && e.shiftKey) return void toggleRecording();
    const hit = DECK_KEYS[k];
    if (!hit) return;
    e.preventDefault();
    const [deck, action] = hit;
    switch (action) {
      case 'cue':
        ctl.cueDown(deck);
        break;
      case 'play':
        ctl.togglePlay(deck);
        break;
      case 'sync':
        ctl.syncPress(deck);
        break;
      case 'nudge-':
        ctl.nudge(deck, -1);
        break;
      case 'nudge+':
        ctl.nudge(deck, 1);
        break;
      case 'loop':
        ctl.autoLoop(deck);
        break;
      case 'keylock':
        ctl.toggleKeyLock(deck);
        break;
      default:
        if (action.startsWith('hc')) {
          const i = Number(action.slice(2));
          if (e.shiftKey) ctl.deleteHotCue(deck, i);
          else ctl.hotCue(deck, i);
        }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (typing(e)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const hit = DECK_KEYS[k];
    if (!hit) return;
    const [deck, action] = hit;
    if (action === 'cue') ctl.cueUp(deck);
    if (action === 'nudge-' || action === 'nudge+') ctl.nudge(deck, 0);
  });
}
