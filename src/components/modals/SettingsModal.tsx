import { useEffect, useState, type ReactNode } from 'react';
import { useSettings, type AiMode, type Effort } from '../../state/settings';
import { useUI, type SettingsTab } from '../../state/ui';
import { useLibrary } from '../../state/library';
import { engine } from '../../audio/engine';
import { useAI } from '../../state/ai';
import { providerInfo } from '../../ai/llm/providers';
import { viaLabel } from '../../ai/llm/client';
import { ProviderSetup } from '../ai/ProviderSetup';
import { analysisQueue } from '../../library/analysisQueue';
import { enableMidi, midiInputs, midiSupported } from '../../midi/midi';
import { Segmented, Switch } from '../controls/Btn';
import { Modal } from './Modal';
import type { KeyNotation } from '../../music/keys';
import type { CrossfaderCurve } from '../../audio/curves';
import type { SyncMode } from '../../audio/protocol';

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <small className="faint">{hint}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function OutputDevice() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [current, setCurrent] = useState('default');
  const toast = useUI((s) => s.toast);
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((d) => setDevices(d.filter((x) => x.kind === 'audiooutput')));
  }, []);
  if (!engine.canChooseOutput) return <span className="faint">Your browser uses the system output.</span>;
  return (
    <select
      className="select"
      value={current}
      onChange={async (e) => {
        setCurrent(e.target.value);
        try {
          await engine.init();
          await engine.setOutputDevice(e.target.value === 'default' ? '' : e.target.value);
        } catch (err) {
          toast(`Couldn't switch output: ${(err as Error).message}`, 'error');
        }
      }}
    >
      <option value="default">System default</option>
      {devices
        .filter((d) => d.deviceId && d.deviceId !== 'default')
        .map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || 'Audio output'}
          </option>
        ))}
    </select>
  );
}

function Storage() {
  const [est, setEst] = useState<string>('');
  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then((e) =>
        setEst(
          `${((e.usage ?? 0) / 1024 / 1024).toFixed(0)} MB used of ${((e.quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB available`,
        ),
      );
  }, []);
  return <span className="faint">{est || '—'}</span>;
}

export function SettingsModal() {
  const s = useSettings();
  const close = useUI((u) => u.close);
  const toast = useUI((u) => u.toast);
  const copilot = useAI((a) => a.copilot);
  const tracks = useLibrary((l) => l.tracks);
  const [tab, setTab] = useState<SettingsTab>(() => useUI.getState().settingsTab);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);

  return (
    <Modal title="Settings" onClose={close} wide>
      <div className="tabs" role="tablist">
        {(
          [
            ['audio', 'Audio'],
            ['decks', 'Decks & display'],
            ['ai', 'AI'],
            ['library', 'Library'],
            ['midi', 'MIDI'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-on' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'audio' && (
        <div className="settings">
          <Row label="Output device" hint="Choose speakers / audio interface (Chrome, Edge)">
            <OutputDevice />
          </Row>
          <Row
            label="Split headphone cue"
            hint="Left ear = master (mono), right ear = cued decks. Use with the headphone buttons on the mixer."
          >
            <Switch on={s.splitCue} onChange={(splitCue) => s.set({ splitCue })} />
          </Row>
          <Row label="Master limiter" hint="Protects against clipping">
            <Switch on={s.limiter} onChange={(limiter) => s.set({ limiter })} />
          </Row>
          <Row label="Auto gain" hint="Level-match tracks using their measured loudness">
            <Switch on={s.autoGain} onChange={(autoGain) => s.set({ autoGain })} />
          </Row>
          <Row label="Auto gain target" hint="Integrated loudness (LUFS)">
            <input
              type="range"
              min={-16}
              max={-6}
              step={1}
              value={s.autoGainTarget}
              onChange={(e) => s.set({ autoGainTarget: Number(e.target.value) })}
            />
            <span className="mono">{s.autoGainTarget} LUFS</span>
          </Row>
          <Row label="Crossfader curve">
            <Segmented<CrossfaderCurve>
              value={s.crossfaderCurve}
              onChange={(crossfaderCurve) => s.set({ crossfaderCurve })}
              options={[
                { value: 'smooth', label: 'Smooth' },
                { value: 'dipped', label: 'Linear' },
                { value: 'sharp', label: 'Cut' },
              ]}
            />
          </Row>
          <Row label="Filter resonance">
            <input
              type="range"
              min={-3}
              max={12}
              step={0.5}
              value={s.filterResonance}
              onChange={(e) => s.set({ filterResonance: Number(e.target.value) })}
            />
            <span className="mono">{s.filterResonance} dB</span>
          </Row>
        </div>
      )}

      {tab === 'decks' && (
        <div className="settings">
          <Row label="Key lock by default" hint="Keep the pitch when changing tempo (master tempo)">
            <Switch on={s.defaultKeyLock} onChange={(defaultKeyLock) => s.set({ defaultKeyLock })} />
          </Row>
          <Row label="Quantize" hint="Snap cues, hot cues and loops to the beat grid">
            <Switch on={s.quantize} onChange={(quantize) => s.set({ quantize })} />
          </Row>
          <Row label="Sync mode" hint="Beat sync also keeps the beats aligned">
            <Segmented<SyncMode>
              value={s.defaultSync === 'off' ? 'beat' : s.defaultSync}
              onChange={(defaultSync) => s.set({ defaultSync })}
              options={[
                { value: 'beat', label: 'Beat sync' },
                { value: 'tempo', label: 'Tempo only' },
              ]}
            />
          </Row>
          <Row label="Vinyl mode" hint="Touching the jog wheel scratches">
            <Switch on={s.vinylMode} onChange={(vinylMode) => s.set({ vinylMode })} />
          </Row>
          <Row label="Default pitch range">
            <Segmented<number>
              value={s.tempoRange}
              onChange={(tempoRange) => s.set({ tempoRange })}
              options={[6, 8, 16, 50].map((r) => ({ value: r, label: `±${r}%` }))}
            />
          </Row>
          <Row label="Key notation">
            <Segmented<KeyNotation>
              value={s.keyNotation}
              onChange={(keyNotation) => s.set({ keyNotation })}
              options={[
                { value: 'camelot', label: 'Camelot (8A)' },
                { value: 'musical', label: 'Musical (Am)' },
                { value: 'openkey', label: 'Open Key (1m)' },
              ]}
            />
          </Row>
          <Row label="Waveform colours">
            <Segmented<'bands' | 'rgb'>
              value={s.waveformStyle === 'rgb' ? 'rgb' : 'bands'}
              onChange={(waveformStyle) => s.set({ waveformStyle })}
              options={[
                { value: 'bands', label: '3-band' },
                { value: 'rgb', label: 'RGB' },
              ]}
            />
          </Row>
        </div>
      )}

      {tab === 'ai' && (
        <div className="settings">
          <p className="muted">
            Track analysis, suggestions, AI Mix and Auto DJ run fully in your browser – no key needed. A
            language model adds the AI DJ chat, set planning and new-music discovery; Google Gemini, Groq,
            OpenRouter and Ollama can all be used for free.
          </p>
          <Row
            label="AI chat connection"
            hint={
              copilot.state === 'ready'
                ? `Connected: ${copilot.provider ? providerInfo(copilot.provider).label : 'AI'}${copilot.model ? ` · ${copilot.model}` : ''}${viaLabel(copilot.via) ? ` (${viaLabel(copilot.via)})` : ''}`
                : copilot.reason
            }
          >
            <Segmented<AiMode>
              value={s.aiMode}
              onChange={(aiMode) => s.set({ aiMode })}
              options={[
                {
                  value: 'auto',
                  label: 'Auto',
                  title: 'Your own service if you connected one, otherwise the AI this site provides',
                },
                {
                  value: 'server',
                  label: 'Site',
                  title: 'Only the AI this site provides (its server or built-in key)',
                },
                { value: 'byok', label: 'This browser', title: 'Only the service and key set up below' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </Row>
          <ProviderSetup />
          {s.aiProvider === 'anthropic' && (
            <Row label="Thinking depth" hint="Claude only. Deeper = smarter but slower">
              <Segmented<Effort>
                value={s.effort}
                onChange={(effort) => s.set({ effort })}
                options={[
                  { value: 'low', label: 'Fast' },
                  { value: 'medium', label: 'Balanced' },
                  { value: 'high', label: 'Deep' },
                ]}
              />
            </Row>
          )}
          <Row
            label="Allow key shift in AI mixes"
            hint="Fix key clashes by shifting the incoming track ±2 semitones"
          >
            <Switch on={s.allowKeyShift} onChange={(allowKeyShift) => s.set({ allowKeyShift })} />
          </Row>
        </div>
      )}

      {tab === 'library' && (
        <div className="settings">
          <Row label="BPM range for analysis" hint="Tempos outside are folded by halving/doubling">
            <input
              type="number"
              className="input input-num"
              min={50}
              max={120}
              value={s.bpmMin}
              onChange={(e) => s.set({ bpmMin: Number(e.target.value) })}
            />
            <span>–</span>
            <input
              type="number"
              className="input input-num"
              min={100}
              max={250}
              value={s.bpmMax}
              onChange={(e) => s.set({ bpmMax: Number(e.target.value) })}
            />
          </Row>
          <Row
            label="Trust BPM/key tags"
            hint="Use BPM and key from file tags (e.g. from Beatport or Mixed In Key)"
          >
            <Switch on={s.trustTags} onChange={(trustTags) => s.set({ trustTags })} />
          </Row>
          <Row label="Re-analyse everything">
            <button
              type="button"
              className="btn btn-default btn-s"
              onClick={() => {
                analysisQueue.options = { minBpm: s.bpmMin, maxBpm: s.bpmMax, trustTags: s.trustTags };
                analysisQueue.enqueue(Object.values(tracks).map((t) => ({ ...t, analysis: undefined })));
                toast(`Re-analysing ${Object.keys(tracks).length} tracks`, 'info');
              }}
            >
              Re-analyse {Object.keys(tracks).length} tracks
            </button>
          </Row>
          <Row label="Storage" hint="Tracks are stored privately in this browser (IndexedDB)">
            <Storage />
          </Row>
        </div>
      )}

      {tab === 'midi' && (
        <div className="settings">
          {!midiSupported() ? (
            <p className="muted">
              Web MIDI is not available in this browser. Use Chrome, Edge or Opera on desktop/Android to
              connect a DJ controller.
            </p>
          ) : (
            <>
              <Row label="Devices">
                <button
                  type="button"
                  className="btn btn-default btn-s"
                  onClick={() => void enableMidi().then(() => setMidiDevices(midiInputs()))}
                >
                  Scan
                </button>
                <span className="faint">
                  {midiDevices.length ? midiDevices.join(', ') : 'No devices scanned yet'}
                </span>
              </Row>
              <p className="muted">
                Turn on <b>MIDI learn</b> (the MIDI button in the top bar), click a control on screen, then
                move a knob or press a button on your controller.
              </p>
              <div className="midi-maps">
                {s.midi.length === 0 && <p className="faint">No mappings yet.</p>}
                {s.midi.map((m) => (
                  <div key={m.input} className="midi-map">
                    <code>{m.input}</code> → <code>{m.target}</code>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remove mapping"
                      onClick={() => s.set({ midi: s.midi.filter((x) => x !== m) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {s.midi.length > 0 && (
                <button type="button" className="btn btn-danger btn-s" onClick={() => s.set({ midi: [] })}>
                  Clear all mappings
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
