import { useState, type DragEvent } from 'react';
import { useDecks } from '../../state/decks';
import { useUI } from '../../state/ui';
import { useLibrary } from '../../state/library';
import { useMixer } from '../../state/mixer';
import { useSmartChannel } from '../../hooks/useSmartChannel';
import { loadTrack } from '../../controller/decks';
import { DeckClock, DeckHeader } from './DeckHeader';
import { JogWheel } from './JogWheel';
import { FxUnit, KeyBar, LoopBar, Pads, PerformBar, TempoSection, Transport } from './DeckControls';
import { Overview } from '../waveform/Overview';
import { Btn } from '../controls/Btn';
import { Fader } from '../controls/Fader';
import { Knob } from '../controls/Knob';
import { Icon } from '../Icon';
import { eqFmt, filterFmt } from '../mixer/format';

function useDeckDrop(deck: number) {
  const [over, setOver] = useState(false);
  const addFiles = useLibrary((s) => s.addFiles);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: async (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('application/x-mixmind-track') || useUI.getState().dragTrackId;
        if (id) {
          void loadTrack(deck, id);
          return;
        }
        const files = Array.from(e.dataTransfer.files);
        if (files.length) {
          const before = new Set(Object.keys(useLibrary.getState().tracks));
          await addFiles(files);
          const added = Object.values(useLibrary.getState().tracks).find((t) => !before.has(t.id));
          if (added) void loadTrack(deck, added.id);
        }
      },
    },
  };
}

function OverviewRow({ deck }: { deck: number }) {
  return (
    <div className="deck-ov">
      <Overview deck={deck} />
      <DeckClock deck={deck} />
    </div>
  );
}

export function DeckPanel({ deck }: { deck: number }) {
  const { over, props } = useDeckDrop(deck);
  const playing = useDecks((s) => s.decks[deck].playing);
  return (
    <section
      className={`deck panel deck-${deck === 0 ? 'a' : 'b'} ${over ? 'is-drop' : ''} ${playing ? 'is-playing' : ''}`}
      aria-label={`Deck ${deck === 0 ? 'A' : 'B'}`}
      {...props}
    >
      <DeckHeader deck={deck} />
      <OverviewRow deck={deck} />
      <div className={`deck-body ${deck === 1 ? 'is-mirror' : ''}`}>
        <div className="deck-jog">
          <JogWheel deck={deck} />
        </div>
        <Transport deck={deck} />
        <div className="deck-perf">
          <Pads deck={deck} />
          <LoopBar deck={deck} />
          <div className="deck-bars">
            <KeyBar deck={deck} />
            <PerformBar deck={deck} />
          </div>
        </div>
        <TempoSection deck={deck} />
      </div>
      <FxUnit deck={deck} />
    </section>
  );
}

/** Phone deck: its bass and filter, so a mix doesn't need the Mixer tab. */
function DeckKnobs({ deck }: { deck: number }) {
  const c = useMixer((s) => s.ch[deck]);
  const set = useMixer((s) => s.setChannel);
  const smart = useSmartChannel(deck);
  const m = `mixer.ch${deck}`;
  return (
    <div className="mdeck-knobs">
      <Knob
        value={c.eqLow}
        ghost={smart.eqLow}
        onChange={(eqLow) => set(deck, { eqLow })}
        label="Bass"
        size={40}
        defaultValue={0.5}
        detent={0.5}
        format={eqFmt}
        midi={`${m}.eqLow`}
        className="knob-eq"
      />
      <Knob
        value={c.filter}
        ghost={smart.filter}
        onChange={(filter) => set(deck, { filter })}
        min={-1}
        max={1}
        bipolar
        label="Filter"
        size={40}
        defaultValue={0}
        detent={0}
        format={filterFmt}
        midi={`${m}.filter`}
        className="knob-filter"
      />
    </div>
  );
}

function DeckVolume({ deck }: { deck: number }) {
  const fader = useMixer((s) => s.ch[deck].fader);
  const set = useMixer((s) => s.setChannel);
  return (
    <Fader
      value={fader}
      onChange={(v) => set(deck, { fader: v })}
      label="Vol"
      defaultValue={0.85}
      midi={`mixer.ch${deck}.fader`}
      className="mdeck-vol"
      ticks={4}
    />
  );
}

/**
 * Phone layout: everything one deck needs during a mix on one screen – transport, bass, filter,
 * volume and tempo – so both thumbs can work at once. Pads and loops fold out on demand.
 */
export function MobileDeck({ deck }: { deck: number }) {
  const { over, props } = useDeckDrop(deck);
  const playing = useDecks((s) => s.decks[deck].playing);
  const [pads, setPads] = useState(false);
  return (
    <section
      className={`deck panel is-mobile deck-${deck === 0 ? 'a' : 'b'} ${over ? 'is-drop' : ''} ${playing ? 'is-playing' : ''}`}
      aria-label={`Deck ${deck === 0 ? 'A' : 'B'}`}
      {...props}
    >
      <DeckHeader deck={deck} compact />
      <OverviewRow deck={deck} />
      <div className="mdeck-row">
        <JogWheel deck={deck} size={96} />
        <div className="mdeck-col">
          <Transport deck={deck} compact>
            <Btn
              size="l"
              className="t-pads"
              active={pads}
              onPress={() => setPads(!pads)}
              title="Pads, loops & key"
              aria-label="Show pads and loops"
            >
              <Icon name="pads" size={16} />
            </Btn>
          </Transport>
          <DeckKnobs deck={deck} />
        </div>
        <DeckVolume deck={deck} />
      </div>
      <TempoSection deck={deck} inline />
      {pads && (
        <div className="mdeck-pads">
          <Pads deck={deck} />
          <LoopBar deck={deck} />
          <KeyBar deck={deck} />
        </div>
      )}
    </section>
  );
}
