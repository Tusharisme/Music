import { useState, type DragEvent } from 'react';
import { useDecks } from '../../state/decks';
import { useUI } from '../../state/ui';
import { useLibrary } from '../../state/library';
import { loadTrack } from '../../controller/decks';
import { DeckClock, DeckHeader } from './DeckHeader';
import { JogWheel } from './JogWheel';
import { FxUnit, KeyBar, LoopBar, Pads, PerformBar, TempoSection, Transport } from './DeckControls';
import { Overview } from '../waveform/Overview';
import { Btn } from '../controls/Btn';
import { Icon } from '../Icon';

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

/** Phone layout: the essentials for one deck; pads and loops fold out on demand. */
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
        <JogWheel deck={deck} size={104} />
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
          <TempoSection deck={deck} horizontal />
        </div>
      </div>
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
