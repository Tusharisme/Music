import { useRef } from 'react';
import { useDecks } from '../../state/decks';
import { useAI } from '../../state/ai';
import { useUI } from '../../state/ui';
import { useRaf } from '../../hooks/useRaf';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { useRecording, toggleRecording } from '../../controller/recording';
import { autoDj } from '../../ai/autodj';
import { fmtBpm, fmtTime } from '../../utils/format';
import { midiSupported } from '../../midi/midi';
import { Icon } from '../Icon';
import { providerInfo } from '../../ai/llm/providers';

function RecTimer() {
  const ref = useRef<HTMLSpanElement>(null);
  const recording = useRecording((s) => s.recording);
  useRaf(() => {
    const s = useRecording.getState();
    if (ref.current) ref.current.textContent = fmtTime((performance.now() - s.startedAt) / 1000);
  }, recording);
  return recording ? <span ref={ref} className="mono rec-time" /> : null;
}

export function TopBar() {
  const master = useDecks((s) => s.master);
  const md = useDecks((s) => s.decks[s.master]);
  const autoDjOn = useAI((s) => s.autoDj);
  const copilot = useAI((s) => s.copilot);
  const mixPhase = useAI((s) => s.mix.phase);
  const recording = useRecording((s) => s.recording);
  const open = useUI((s) => s.open);
  const openSettings = useUI((s) => s.openSettings);
  const midiLearn = useUI((s) => s.midiLearn);
  const setMidiLearn = useUI((s) => s.setMidiLearn);
  const { canInstall, install } = useInstallPrompt();
  const bpm = md.trackId ? md.bpm * md.tempo : 0;
  const aiName = copilot.provider ? providerInfo(copilot.provider).short : 'AI';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          <span />
        </span>
        <span className="brand-name">
          Mix<b>Mind</b>
        </span>
      </div>
      <div className="master-bpm" title="Master tempo">
        <span className="label">Master {md.trackId ? (master === 0 ? 'A' : 'B') : ''}</span>
        <span className={`mono ${master === 0 ? 'c-a' : 'c-b'}`}>{fmtBpm(bpm)}</span>
      </div>
      {mixPhase !== 'idle' && (
        <span className="tag tag-ai is-pulse">
          <Icon name="sparkle" size={11} /> AI mixing
        </span>
      )}
      <div className="topbar-spacer" />
      <button
        type="button"
        className={`top-btn ${autoDjOn ? 'is-on ai' : ''}`}
        onClick={() => (autoDjOn ? autoDj.stop() : void autoDj.start())}
        title="Auto DJ: the AI picks and mixes tracks for you"
      >
        <Icon name="robot" size={15} />
        <span className="hide-s">Auto DJ</span>
      </button>
      <button
        type="button"
        className={`top-btn ${recording ? 'is-rec' : ''}`}
        onClick={() => void toggleRecording()}
        title={recording ? 'Stop recording and download' : 'Record your mix'}
      >
        <Icon name={recording ? 'stop' : 'record'} size={13} />
        <span className="hide-s">{recording ? 'Stop' : 'Rec'}</span>
        <RecTimer />
      </button>
      <button
        type="button"
        className={`ai-dot ${copilot.state === 'ready' ? 'is-on' : ''}`}
        onClick={() => openSettings('ai')}
        title={
          copilot.state === 'ready'
            ? `AI chat connected: ${aiName}${copilot.model ? ` (${copilot.model})` : ''}${copilot.via === 'server' ? ' via the server' : ''}`
            : 'AI chat not connected – suggestions, AI Mix and Auto DJ still work. Click to connect a free AI.'
        }
      >
        <Icon name="sparkle" size={12} />{' '}
        <span className="hide-s">{copilot.state === 'ready' ? aiName : 'Offline AI'}</span>
      </button>
      {midiSupported() && (
        <button
          type="button"
          className={`top-btn icon-only hide-s ${midiLearn ? 'is-on' : ''}`}
          onClick={() => setMidiLearn(!midiLearn)}
          title="MIDI learn: click a control, then move a knob/button on your controller"
          aria-label="MIDI learn"
        >
          <Icon name="midi" size={15} />
        </button>
      )}
      {canInstall && (
        <button
          type="button"
          className="top-btn"
          onClick={() => void install()}
          title="Install MixMind as an app"
        >
          <Icon name="download" size={14} />
          <span className="hide-s">Install</span>
        </button>
      )}
      <button
        type="button"
        className="top-btn icon-only hide-s"
        onClick={() =>
          document.fullscreenElement
            ? void document.exitFullscreen()
            : void document.documentElement.requestFullscreen?.()
        }
        title="Full screen"
        aria-label="Full screen"
      >
        <Icon name="expand" size={14} />
      </button>
      <button
        type="button"
        className="top-btn icon-only"
        onClick={() => open('help')}
        title="Help & shortcuts"
        aria-label="Help"
      >
        <Icon name="help" size={15} />
      </button>
      <button
        type="button"
        className="top-btn icon-only"
        onClick={() => open('settings')}
        title="Settings"
        aria-label="Settings"
      >
        <Icon name="settings" size={15} />
      </button>
    </header>
  );
}
