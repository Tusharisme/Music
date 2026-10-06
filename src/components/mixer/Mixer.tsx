import { useMixer } from '../../state/mixer';
import { useSettings } from '../../state/settings';
import { useDecks } from '../../state/decks';
import { engine } from '../../audio/engine';
import { Knob } from '../controls/Knob';
import { Fader } from '../controls/Fader';
import { Btn } from '../controls/Btn';
import { VUMeter } from './VUMeter';
import { Icon } from '../Icon';
import { eqKnobToGain, gainToDb, trimKnobToDb, filterKnob } from '../../audio/curves';
import type { CrossfaderCurve } from '../../audio/curves';

const eqFmt = (v: number) => {
  const g = eqKnobToGain(v);
  return g <= 0 ? 'KILL' : `${gainToDb(g) >= 0 ? '+' : ''}${gainToDb(g).toFixed(1)} dB`;
};
const trimFmt = (v: number) => `${trimKnobToDb(v) >= 0 ? '+' : ''}${trimKnobToDb(v).toFixed(1)} dB`;
const filterFmt = (v: number) => {
  const f = filterKnob(v);
  if (Math.abs(v) < 0.02) return 'OFF';
  const hz = v < 0 ? f.lpHz : f.hpHz;
  return `${v < 0 ? 'LP' : 'HP'} ${hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : Math.round(hz)}`;
};

function Channel({ deck }: { deck: number }) {
  const c = useMixer((s) => s.ch[deck]);
  const set = useMixer((s) => s.setChannel);
  const loaded = useDecks((s) => !!s.decks[deck].trackId);
  const m = `mixer.ch${deck}`;
  const letter = deck === 0 ? 'A' : 'B';
  return (
    <div className={`channel deck-${deck === 0 ? 'a' : 'b'} ${loaded ? '' : 'is-idle'}`}>
      <div className="channel-knobs">
        <Knob
          value={c.trim}
          onChange={(trim) => set(deck, { trim })}
          label="Trim"
          size={30}
          defaultValue={0.5}
          detent={0.5}
          format={trimFmt}
          midi={`${m}.trim`}
        />
        <Knob
          value={c.eqHigh}
          onChange={(eqHigh) => set(deck, { eqHigh })}
          label="Hi"
          size={34}
          defaultValue={0.5}
          detent={0.5}
          format={eqFmt}
          midi={`${m}.eqHigh`}
          className="knob-eq"
        />
        <Knob
          value={c.eqMid}
          onChange={(eqMid) => set(deck, { eqMid })}
          label="Mid"
          size={34}
          defaultValue={0.5}
          detent={0.5}
          format={eqFmt}
          midi={`${m}.eqMid`}
          className="knob-eq"
        />
        <Knob
          value={c.eqLow}
          onChange={(eqLow) => set(deck, { eqLow })}
          label="Low"
          size={34}
          defaultValue={0.5}
          detent={0.5}
          format={eqFmt}
          midi={`${m}.eqLow`}
          className="knob-eq"
        />
        <Knob
          value={c.filter}
          onChange={(filter) => set(deck, { filter })}
          min={-1}
          max={1}
          bipolar
          label="Filter"
          size={34}
          defaultValue={0}
          detent={0}
          format={filterFmt}
          midi={`${m}.filter`}
          className="knob-filter"
        />
      </div>
      <div className="channel-strip">
        <span className="channel-name">{letter}</span>
        <div className="channel-fader-row">
          <VUMeter get={() => [engine.strips[deck]?.meter]} />
          <Fader
            value={c.fader}
            onChange={(fader) => set(deck, { fader })}
            label="Vol"
            defaultValue={0.85}
            midi={`${m}.fader`}
            className="channel-fader"
            ticks={10}
          />
        </div>
        <Btn
          size="s"
          className="cue-btn"
          active={c.cue}
          onPress={() => set(deck, { cue: !c.cue })}
          title="Headphone cue (PFL) – needs Split cue in Settings"
          aria-label={`Headphone cue deck ${letter}`}
        >
          <Icon name="headphones" size={13} />
        </Btn>
      </div>
    </div>
  );
}

const CURVES: { value: CrossfaderCurve; label: string; title: string }[] = [
  { value: 'smooth', label: 'Smooth', title: 'Constant power – for long blends' },
  { value: 'dipped', label: 'Linear', title: 'Linear – a slight dip in the middle' },
  { value: 'sharp', label: 'Cut', title: 'Sharp cut-in – for scratching and quick cuts' },
];

export function Crossfader({ compact = false }: { compact?: boolean }) {
  const x = useMixer((s) => s.xfader);
  const setX = useMixer((s) => s.setXfader);
  const curve = useSettings((s) => s.crossfaderCurve);
  const setS = useSettings((s) => s.set);
  const cur = CURVES.find((c) => c.value === curve) ?? CURVES[0];
  return (
    <div className={`xfader ${compact ? 'is-compact' : ''}`}>
      <span className="xf-a">A</span>
      <Fader
        value={x}
        onChange={(v) => setX(v)}
        orientation="horizontal"
        label="Crossfader"
        defaultValue={0.5}
        detent={0.5}
        midi="mixer.xfader"
        className="xfader-fader"
        ticks={10}
      />
      <span className="xf-b">B</span>
      {!compact && (
        <button
          type="button"
          className="chip xf-curve"
          title={`Crossfader curve: ${cur.title} (click to change)`}
          onClick={() => setS({ crossfaderCurve: CURVES[(CURVES.indexOf(cur) + 1) % CURVES.length].value })}
        >
          {cur.label}
        </button>
      )}
    </div>
  );
}

export function Mixer() {
  const master = useMixer((s) => s.master);
  const setMaster = useMixer((s) => s.setMaster);
  const cueMix = useMixer((s) => s.cueMix);
  const setCueMix = useMixer((s) => s.setCueMix);
  const sampler = useMixer((s) => s.sampler);
  const setSampler = useMixer((s) => s.setSampler);
  const splitCue = useSettings((s) => s.splitCue);
  return (
    <section className="mixer panel" aria-label="Mixer">
      <div className="mixer-channels">
        <Channel deck={0} />
        <div className="mixer-center">
          <Knob
            value={master}
            onChange={setMaster}
            label="Master"
            size={40}
            defaultValue={0.8}
            midi="mixer.master"
          />
          <VUMeter
            className="vu-master"
            channels={2}
            get={() => [engine.master?.meterL, engine.master?.meterR]}
          />
          <Knob
            value={sampler}
            onChange={setSampler}
            label="Sampler"
            size={28}
            title="Sampler volume (pads: Sampler mode)"
            defaultValue={0.8}
            midi="mixer.sampler"
          />
          {splitCue && (
            <Knob value={cueMix} onChange={setCueMix} label="Cue mix" size={28} defaultValue={0.5} />
          )}
        </div>
        <Channel deck={1} />
      </div>
      <Crossfader />
    </section>
  );
}
