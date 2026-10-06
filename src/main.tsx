import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import App from './App';
import { engine } from './audio/engine';
import { startBridge } from './controller/bridge';
import { installKeyboard } from './controller/keyboard';
import { useLibrary } from './state/library';
import { useSettings } from './state/settings';
import { useUI } from './state/ui';
import { useDecks } from './state/decks';
import { startSuggestionService } from './ai/suggest';
import { startAutoDjWatchdog } from './ai/autodj';
import { refreshClaudeStatus } from './ai/copilot';
import { installMidiLearn } from './midi/midi';
import { analysisQueue } from './library/analysisQueue';

// ---- analysis preferences follow settings
const syncAnalysisOptions = () => {
  const s = useSettings.getState();
  analysisQueue.options = { minBpm: s.bpmMin, maxBpm: s.bpmMax, trustTags: s.trustTags };
};
syncAnalysisOptions();
useSettings.subscribe(syncAnalysisOptions);

// ---- engine, library, AI services
startBridge();
void useLibrary.getState().init();
startSuggestionService();
startAutoDjWatchdog();
installKeyboard();
installMidiLearn();
void refreshClaudeStatus();

// ---- browsers only start audio after a user gesture
const unlock = () => {
  void engine.init().then(() => {
    if (engine.ctx?.state === 'suspended') void engine.ctx.resume();
  });
};
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

// ---- keep the screen awake while music is playing (phones/tablets)
let wakeLock: { release: () => Promise<void> } | null = null;
useDecks.subscribe(async (s) => {
  const playing = s.decks.some((d) => d.playing);
  const nav = navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
  };
  try {
    if (playing && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    else if (!playing && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
});

// ---- offline support / installable app
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

if (!useSettings.getState().seenWelcome) useUI.getState().open('welcome');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
