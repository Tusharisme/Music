import type { ReactNode } from 'react';
import { useDecks, type PadMode } from '../../state/decks';
import { Btn, Segmented } from '../controls/Btn';
import { Fader } from '../controls/Fader';
import { Knob } from '../controls/Knob';
import { Icon } from '../Icon';
import * as ctl from '../../controller/decks';
import { FX_TYPES } from '../../audio/effects';
import { DEFAULT_PADS } from '../../audio/sampler';
import { engine } from '../../audio/engine';
import { fmtBeats, fmtPct } from '../../utils/format';

const RANGES = [6, 8, 16, 50];

export function TempoSection({ deck, horizontal = false }: { deck: number; horizontal?: boolean }) {
  const d = useDecks((s) => s.decks[deck]);
  const range = d.tempoRange / 100;
  const m = `deck${deck}`;
  return (
    <div className={`tempo ${horizontal ? 'is-h' : ''}`}>
      <div className="tempo-top">
        <button
          type="button"
          className="chip mono"
          title="Pitch range"
          onClick={() => ctl.setTempoRange(deck, RANGES[(RANGES.indexOf(d.tempoRange) + 1) % RANGES.length])}
        >
          ±{d.tempoRange}%
        </button>
        <span className={`mono tempo-val ${Math.abs(d.tempo - 1) < 1e-4 ? 'faint' : ''}`}>
          {fmtPct(d.tempo)}
        </span>
      </div>
      <Fader
        value={d.tempo}
        min={1 - range}
        max={1 + range}
        defaultValue={1}
        detent={1}
        jump={false}
        orientation={horizontal ? 'horizontal' : 'vertical'}
        label="Tempo"
        className="tempo-fader"
        ticks={8}
        midi={`${m}.tempo`}
        format={fmtPct}
        onChange={(v) => ctl.setTempo(deck, v)}
      />
      <div className="tempo-btns">
        <Btn
          size="s"
          onPress={() => ctl.nudge(deck, -1)}
          onRelease={() => ctl.nudge(deck, 0)}
          title="Nudge slower (hold)"
          aria-label="Nudge slower"
        >
          <Icon name="minus" size={12} />
        </Btn>
        <Btn size="s" onPress={() => ctl.resetTempo(deck)} title="Reset tempo to 0%">
          0
        </Btn>
        <Btn
          size="s"
          onPress={() => ctl.nudge(deck, 1)}
          onRelease={() => ctl.nudge(deck, 0)}
          title="Nudge faster (hold)"
          aria-label="Nudge faster"
        >
          <Icon name="plus" size={12} />
        </Btn>
      </div>
    </div>
  );
}

export function Transport({
  deck,
  compact = false,
  children,
}: {
  deck: number;
  compact?: boolean;
  children?: ReactNode;
}) {
  const d = useDecks((s) => s.decks[deck]);
  const isMaster = useDecks((s) => s.master === deck);
  const m = `deck${deck}`;
  const disabled = !d.trackId || d.loading;
  return (
    <div className={`transport ${compact ? 'is-compact' : ''}`}>
      <Btn
        variant="default"
        size="l"
        className="t-cue"
        disabled={disabled}
        onPress={() => ctl.cueDown(deck)}
        onRelease={() => ctl.cueUp(deck)}
        title="CUE: set/return to the cue point; hold to preview"
        midi={`${m}.cue`}
      >
        CUE
      </Btn>
      <Btn
        variant="accent"
        size="l"
        className={`t-play ${d.playing ? 'is-playing' : ''}`}
        active={d.playing}
        disabled={disabled}
        onPress={() => ctl.togglePlay(deck)}
        title="Play / pause"
        midi={`${m}.play`}
        aria-label={d.playing ? 'Pause' : 'Play'}
      >
        <Icon name={d.playing ? 'pause' : 'play'} size={18} />
      </Btn>
      <Btn
        size={compact ? 'l' : 'm'}
        className="t-sync"
        active={d.sync !== 'off'}
        disabled={disabled}
        onPress={() => ctl.syncPress(deck)}
        title="Sync tempo + beats to the other deck"
        midi={`${m}.sync`}
      >
        SYNC
      </Btn>
      {!compact && (
        <Btn
          size="m"
          className="t-master"
          active={isMaster && !!d.trackId}
          disabled={disabled}
          onPress={() => ctl.makeMaster(deck)}
          title="Make this the master (tempo leader)"
        >
          MASTER
        </Btn>
      )}
      {children}
    </div>
  );
}

const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const ROLL_SIZES = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8];
const JUMPS = [-16, -8, -4, -1, 1, 4, 8, 16];

export function Pads({ deck, count = 8 }: { deck: number; count?: number }) {
  const d = useDecks((s) => s.decks[deck]);
  const m = `deck${deck}`;
  const disabled = !d.trackId;
  const pads = Array.from({ length: count }, (_, i) => i);
  return (
    <div className="pads-wrap">
      <Segmented<PadMode>
        className="pad-modes"
        label="Pad mode"
        value={d.padMode}
        onChange={(padMode) => useDecks.getState().setDeck(deck, { padMode })}
        options={[
          { value: 'hotcue', label: 'Hot cue' },
          { value: 'loop', label: 'Loop' },
          { value: 'roll', label: 'Roll' },
          { value: 'jump', label: 'Jump' },
          { value: 'sampler', label: 'Sampler', title: 'Trigger one-shot samples' },
        ]}
      />
      <div className={`pads pads-${count}`}>
        {pads.map((i) => {
          if (d.padMode === 'hotcue') {
            const hc = d.hotCues[i];
            return (
              <Btn
                key={i}
                variant="pad"
                className={hc ? 'is-set' : ''}
                color={hc?.color}
                disabled={disabled}
                onPress={(e) => (e.shiftKey && hc ? ctl.deleteHotCue(deck, i) : ctl.hotCue(deck, i))}
                onLongPress={hc ? () => ctl.deleteHotCue(deck, i) : undefined}
                title={
                  hc
                    ? `Hot cue ${i + 1} – press to jump, long-press / right-click / shift-click to delete`
                    : `Set hot cue ${i + 1}`
                }
                midi={`${m}.hotcue${i + 1}`}
              >
                {i + 1}
              </Btn>
            );
          }
          if (d.padMode === 'loop') {
            const size = LOOP_SIZES[i];
            const on = d.loop.on && Math.abs(d.autoLoopBeats - size) < 1e-6;
            return (
              <Btn
                key={i}
                variant="pad"
                className="is-loop"
                active={on}
                disabled={disabled || d.bpm <= 0}
                onPress={() => (on ? ctl.exitLoop(deck) : ctl.autoLoop(deck, size))}
                title={`${fmtBeats(size)}-beat loop`}
              >
                {fmtBeats(size)}
              </Btn>
            );
          }
          if (d.padMode === 'roll') {
            const size = ROLL_SIZES[i];
            return (
              <Btn
                key={i}
                variant="pad"
                className="is-roll"
                disabled={disabled || d.bpm <= 0}
                onPress={() => ctl.roll(deck, size, true)}
                onRelease={() => ctl.roll(deck, size, false)}
                title={`Hold for a ${fmtBeats(size)}-beat roll (slip)`}
              >
                {fmtBeats(size)}
              </Btn>
            );
          }
          if (d.padMode === 'sampler') {
            const p = DEFAULT_PADS[i];
            if (!p) return <span key={i} />;
            return (
              <Btn
                key={i}
                variant="pad"
                className="is-set is-sample"
                color={p.color}
                onPress={() => void engine.init().then(() => engine.sampler?.trigger(i))}
                title={`${p.label} (sampler – volume on the mixer)`}
                midi={`sampler.${i + 1}`}
              >
                {p.label}
              </Btn>
            );
          }
          const j = JUMPS[i];
          return (
            <Btn
              key={i}
              variant="pad"
              className="is-jump"
              disabled={disabled || d.bpm <= 0}
              onPress={() => ctl.beatJump(deck, j)}
              title={`Jump ${j > 0 ? 'forward' : 'back'} ${Math.abs(j)} beats`}
            >
              {j > 0 ? `+${j}` : j}
            </Btn>
          );
        })}
      </div>
    </div>
  );
}

export function LoopBar({ deck }: { deck: number }) {
  const d = useDecks((s) => s.decks[deck]);
  const disabled = !d.trackId || d.bpm <= 0;
  const m = `deck${deck}`;
  return (
    <div className="loopbar" role="group" aria-label="Loop">
      <Btn size="s" disabled={disabled} onPress={() => ctl.loopIn(deck)} title="Loop in">
        IN
      </Btn>
      <Btn size="s" disabled={disabled} onPress={() => ctl.loopOut(deck)} title="Loop out">
        OUT
      </Btn>
      <Btn
        size="s"
        disabled={disabled}
        onPress={() => ctl.resizeLoop(deck, 0.5)}
        title="Halve loop"
        aria-label="Halve loop"
      >
        ½
      </Btn>
      <Btn
        size="s"
        className="loop-main"
        active={d.loop.on}
        disabled={disabled}
        onPress={() => ctl.autoLoop(deck)}
        title="Auto loop on/off"
        midi={`${m}.loop`}
      >
        <Icon name="loop" size={12} /> {fmtBeats(d.autoLoopBeats)}
      </Btn>
      <Btn
        size="s"
        disabled={disabled}
        onPress={() => ctl.resizeLoop(deck, 2)}
        title="Double loop"
        aria-label="Double loop"
      >
        ×2
      </Btn>
      <Btn
        size="s"
        disabled={disabled || d.loop.end <= d.loop.start}
        onPress={() => ctl.reloop(deck)}
        title="Reloop / exit"
      >
        {d.loop.on ? 'EXIT' : 'RELOOP'}
      </Btn>
    </div>
  );
}

export function KeyBar({ deck }: { deck: number }) {
  const d = useDecks((s) => s.decks[deck]);
  const disabled = !d.trackId;
  return (
    <div className="keybar" role="group" aria-label="Key">
      <Btn
        size="s"
        className="kb-lock"
        active={d.keyLock}
        disabled={disabled}
        onPress={() => ctl.toggleKeyLock(deck)}
        title="Key lock (master tempo): change tempo without changing pitch"
        midi={`deck${deck}.keylock`}
      >
        <Icon name="lock" size={11} /> KEY
      </Btn>
      <div className="keyshift">
        <Btn
          size="s"
          disabled={disabled}
          onPress={() => ctl.setKeyShift(deck, d.keyShift - 1)}
          aria-label="Key down"
          title="Key shift down a semitone"
        >
          ♭
        </Btn>
        <span className={`mono ${d.keyShift ? '' : 'faint'}`} title="Key shift (semitones)">
          {d.keyShift > 0 ? `+${d.keyShift}` : d.keyShift}
        </span>
        <Btn
          size="s"
          disabled={disabled}
          onPress={() => ctl.setKeyShift(deck, d.keyShift + 1)}
          aria-label="Key up"
          title="Key shift up a semitone"
        >
          ♯
        </Btn>
      </div>
      <Btn
        size="s"
        className="kb-match"
        disabled={disabled}
        onPress={() => ctl.keySync(deck)}
        title="Key sync: shift to the most compatible key with the other deck"
      >
        MATCH
      </Btn>
    </div>
  );
}

export function PerformBar({ deck }: { deck: number }) {
  const d = useDecks((s) => s.decks[deck]);
  const disabled = !d.trackId;
  return (
    <div className="perfbar" role="group" aria-label="Performance">
      <Btn
        size="s"
        active={d.slip}
        disabled={disabled}
        onPress={() => ctl.toggleSlip(deck)}
        title="Slip mode: loops/scratches/reverse return to where the track would have been"
      >
        SLIP
      </Btn>
      <Btn
        size="s"
        active={d.vinyl}
        onPress={() => useDecks.getState().setDeck(deck, { vinyl: !d.vinyl })}
        title="Vinyl mode: touch the platter to scratch"
      >
        VINYL
      </Btn>
      <Btn
        size="s"
        disabled={disabled}
        onPress={() => ctl.setReverse(deck, true)}
        onRelease={() => ctl.setReverse(deck, false)}
        title="Hold to play in reverse (censor)"
      >
        REV
      </Btn>
      <Btn
        size="s"
        disabled={disabled || !d.playing}
        onPress={() => ctl.brake(deck)}
        title="Vinyl brake stop"
      >
        BRAKE
      </Btn>
      <Btn size="s" disabled={disabled || !d.playing} onPress={() => ctl.brake(deck, true)} title="Spinback">
        SPIN
      </Btn>
    </div>
  );
}

const FX_BEATS = [0.25, 0.5, 0.75, 1, 2, 4];

export function FxUnit({ deck }: { deck: number }) {
  const fx = useDecks((s) => s.decks[deck].fx);
  const meta = FX_TYPES.find((f) => f.id === fx.type)!;
  const m = `deck${deck}`;
  return (
    <div className={`fxunit ${fx.on ? 'is-on' : ''}`}>
      <div className="fx-pick">
        <span className="label">FX</span>
        <select
          className="select select-s"
          value={fx.type}
          onChange={(e) => ctl.setFx(deck, { type: e.target.value as typeof fx.type })}
          aria-label="Effect"
        >
          {FX_TYPES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <Btn
          size="s"
          variant="accent"
          className="fx-on"
          active={fx.on}
          onPress={() => ctl.setFx(deck, { on: !fx.on })}
          midi={`${m}.fx`}
          title="Effect on/off"
        >
          {fx.on ? 'ON' : 'OFF'}
        </Btn>
      </div>
      <div className="fx-knobs">
        <Knob
          value={fx.mix}
          onChange={(mix) => ctl.setFx(deck, { mix })}
          label="Mix"
          size={30}
          defaultValue={0.5}
          midi={`${m}.fxmix`}
        />
        <Knob
          value={fx.param}
          onChange={(param) => ctl.setFx(deck, { param })}
          label={meta.paramLabel}
          size={30}
          defaultValue={0.5}
          midi={`${m}.fxparam`}
        />
      </div>
      <div className="fx-beats" role="radiogroup" aria-label="Beat division">
        {FX_BEATS.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={fx.beats === b}
            className={fx.beats === b ? 'is-on' : ''}
            onClick={() => ctl.setFx(deck, { beats: b })}
          >
            {fmtBeats(b)}
          </button>
        ))}
      </div>
    </div>
  );
}
