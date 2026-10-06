import { useRef } from 'react';
import { useDecks } from '../../state/decks';
import { useLibrary } from '../../state/library';
import { useRaf } from '../../hooks/useRaf';
import { engine } from '../../audio/engine';
import { Artwork } from '../Artwork';
import { KeyBadge, EnergyMeter } from '../KeyBadge';
import { effectiveKey } from '../../ai/harmonic';
import { trackKey } from '../../ai/recommender';
import { fmtBpm, fmtPct, fmtTime } from '../../utils/format';
import { useUI } from '../../state/ui';
import { eject } from '../../controller/decks';
import { Icon } from '../Icon';

/** Remaining time (large, like a CDJ), elapsed and bar.beat. */
export function DeckClock({ deck }: { deck: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const rem = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useRaf(() => {
    const d = useDecks.getState().decks[deck];
    const pos = engine.transport.position(deck);
    if (el.current) el.current.textContent = fmtTime(pos);
    if (rem.current) {
      const r = Math.max(0, (d.duration || 0) - pos);
      rem.current.textContent = `-${fmtTime(r)}`;
      rem.current.classList.toggle('is-warn', d.playing && r < 30 && r > 0);
    }
    if (bar.current) {
      if (d.bpm > 0 && d.trackId) {
        const beats = (pos - d.firstBeat) / (60 / d.bpm);
        const barN = Math.floor(beats / 4) + 1;
        const beatN = (((Math.floor(beats) % 4) + 4) % 4) + 1;
        bar.current.textContent = `${barN}.${beatN}`;
      } else bar.current.textContent = '–';
    }
  });
  return (
    <div className="deck-clock mono">
      <span ref={rem} className="rem" title="Remaining">
        -0:00
      </span>
      <span className="sub">
        <span ref={el} title="Elapsed">
          0:00
        </span>
        <span ref={bar} className="beat" title="Bar.beat">
          –
        </span>
      </span>
    </div>
  );
}

export function DeckHeader({ deck, compact = false }: { deck: number; compact?: boolean }) {
  const d = useDecks((s) => s.decks[deck]);
  const isMaster = useDecks((s) => s.master === deck);
  const t = useLibrary((s) => (d.trackId ? s.tracks[d.trackId] : undefined));
  const analysing = useLibrary((s) =>
    d.trackId ? s.active.includes(d.trackId) || s.pending.includes(d.trackId) : false,
  );
  const open = useUI((s) => s.open);
  const key = t?.analysis
    ? effectiveKey(trackKey(t) ?? t.analysis.key, d.tempo, d.keyLock, d.keyShift)
    : null;
  const shifted = !!t?.analysis && (d.keyShift !== 0 || (!d.keyLock && Math.abs(d.tempo - 1) > 0.03));
  const letter = deck === 0 ? 'A' : 'B';

  return (
    <header className={`deck-head ${compact ? 'is-compact' : ''}`}>
      <span className="deck-letter" aria-label={`Deck ${letter}`}>
        {letter}
      </span>
      <Artwork track={t} size={compact ? 36 : 40} />
      <div className="deck-title">
        <div className="deck-title-row">
          {t ? (
            <button
              type="button"
              className="title truncate"
              onClick={() => open('track', t.id)}
              title="Track details"
            >
              {t.title}
            </button>
          ) : (
            <span className="title faint truncate">No track loaded</span>
          )}
          <span className="deck-status">
            {isMaster && d.trackId && <span className="tag tag-master">MASTER</span>}
            {d.sync !== 'off' && <span className="tag tag-sync">SYNC</span>}
            {d.armed && <span className="tag tag-ai is-pulse">AI ARMED</span>}
            {d.loading && (
              <span className="tag">
                <span className="spinner" /> Loading
              </span>
            )}
            {analysing && !d.loading && <span className="tag faint">Analysing…</span>}
            {d.trackId && !d.playing && !d.loading && (
              <button
                type="button"
                className="icon-btn eject"
                title="Eject"
                aria-label={`Eject deck ${letter}`}
                onClick={() => eject(deck)}
              >
                <Icon name="eject" size={12} />
              </button>
            )}
          </span>
        </div>
        {t ? (
          <span className="artist truncate">
            {t.artist}
            {t.genre ? <span className="faint"> · {t.genre}</span> : null}
          </span>
        ) : (
          <span className="artist faint truncate">Drag a track here or press {letter} in the library</span>
        )}
      </div>
      <div className="deck-bpm">
        <span className="mono bpm">{fmtBpm(d.bpm * d.tempo)}</span>
        <span className={`mono pct ${Math.abs(d.tempo - 1) < 1e-4 ? 'faint' : ''}`}>{fmtPct(d.tempo)}</span>
      </div>
      <div className="deck-tags">
        <KeyBadge k={key} shifted={shifted} />
        {!compact && <EnergyMeter value={t?.analysis?.energy} />}
      </div>
    </header>
  );
}
