import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useLibrary } from '../../state/library';
import { useDecks } from '../../state/decks';
import { useSettings } from '../../state/settings';
import { useUI } from '../../state/ui';
import { useAI } from '../../state/ai';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { loadTrack } from '../../controller/decks';
import { referenceDeck } from '../../ai/suggest';
import { MIX_STYLES, recommend, trackBpm, trackKey } from '../../ai/recommender';
import { harmonicCompat, effectiveKey } from '../../ai/harmonic';
import { camelot } from '../../music/keys';
import { Artwork } from '../Artwork';
import { KeyBadge, EnergyMeter } from '../KeyBadge';
import { Icon } from '../Icon';
import { fmtTime } from '../../utils/format';
import type { TrackRecord } from '../../types';

type SortKey = 'added' | 'title' | 'artist' | 'bpm' | 'key' | 'energy' | 'match';

function useMatchScores(): Map<string, number> {
  const tracks = useLibrary((s) => s.tracks);
  const ref = useDecks((s) => {
    const r = referenceDeck();
    if (r === null) return null;
    const d = s.decks[r];
    return `${r}|${d.trackId}|${d.tempo.toFixed(3)}|${d.keyShift}|${d.keyLock}`;
  });
  const vibe = useSettings((s) => s.vibe);
  const style = useSettings((s) => s.mixStyle);
  return useMemo(() => {
    const m = new Map<string, number>();
    const r = referenceDeck();
    if (r === null) return m;
    const d = useDecks.getState().decks[r];
    const t = d.trackId ? tracks[d.trackId] : undefined;
    if (!t?.analysis) return m;
    const res = recommend(
      { track: t, analysis: t.analysis, rate: d.tempo, keyLock: d.keyLock, keyShift: d.keyShift },
      Object.values(tracks),
      {
        vibe,
        weights: MIX_STYLES[style].weights,
        exclude: new Set(),
        history: [],
        allowKeyShift: false,
        limit: 100000,
      },
    );
    for (const s of res) m.set(s.track.id, s.score);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, ref, vibe, style]);
}

const ROW_H = 46;
const ROW_H_MOBILE = 60;

function TrackRowView({
  t,
  score,
  mobile,
  onMenu,
}: {
  t: TrackRecord;
  score?: number;
  mobile: boolean;
  onMenu: (t: TrackRecord, x: number, y: number) => void;
}) {
  const active = useLibrary((s) => s.active.includes(t.id));
  const pending = useLibrary((s) => s.pending.includes(t.id));
  const error = useLibrary((s) => s.errors[t.id] ?? t.analysisError);
  const onA = useDecks((s) => s.decks[0].trackId === t.id);
  const onB = useDecks((s) => s.decks[1].trackId === t.id);
  const setDrag = useUI((s) => s.setDrag);
  const a = t.analysis;
  const bpm = trackBpm(t);
  return (
    <div
      className={`trow ${onA ? 'on-a' : ''} ${onB ? 'on-b' : ''}`}
      draggable={!mobile}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData('application/x-mixmind-track', t.id);
        e.dataTransfer.effectAllowed = 'copy';
        setDrag(t.id);
      }}
      onDragEnd={() => setDrag(null)}
      onDoubleClick={() => {
        const { decks } = useDecks.getState();
        const free = decks.findIndex((d) => !d.playing);
        if (free >= 0) void loadTrack(free, t.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(t, e.clientX, e.clientY);
      }}
    >
      <Artwork track={t} size={mobile ? 40 : 32} />
      <div className="trow-main">
        <span className="trow-title truncate">{t.title}</span>
        <span className="trow-artist truncate">
          {t.artist}
          {mobile && a ? (
            <span className="faint">
              {' '}
              · {bpm.toFixed(1)} BPM · E{a.energy}
            </span>
          ) : null}
        </span>
      </div>
      {!mobile && <span className="trow-genre truncate faint">{t.genre ?? ''}</span>}
      {!mobile && <span className="trow-bpm mono">{a ? bpm.toFixed(1) : '—'}</span>}
      <span className="trow-key">
        {a ? (
          <KeyBadge k={trackKey(t)} small />
        ) : active ? (
          <span className="spinner" />
        ) : pending ? (
          <span className="faint">…</span>
        ) : error ? (
          <span title={error}>⚠</span>
        ) : (
          '—'
        )}
      </span>
      {!mobile && <EnergyMeter value={a?.energy} className="trow-energy" />}
      {!mobile && <span className="trow-time mono faint">{fmtTime(a?.duration ?? t.duration)}</span>}
      <span
        className={`trow-match mono ${score === undefined ? 'faint' : score >= 75 ? 'is-great' : score >= 55 ? 'is-good' : 'is-meh'}`}
        title="AI match with what's playing"
      >
        {score === undefined ? '' : Math.round(score)}
      </span>
      <div className="trow-actions">
        <button
          type="button"
          className={`load-btn deck-a ${onA ? 'is-on' : ''}`}
          onClick={() => void loadTrack(0, t.id)}
          title="Load to deck A"
          aria-label={`Load ${t.title} to deck A`}
        >
          A
        </button>
        <button
          type="button"
          className={`load-btn deck-b ${onB ? 'is-on' : ''}`}
          onClick={() => void loadTrack(1, t.id)}
          title="Load to deck B"
          aria-label={`Load ${t.title} to deck B`}
        >
          B
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => onMenu(t, e.clientX, e.clientY)}
          aria-label="More actions"
          title="More"
        >
          ⋯
        </button>
      </div>
    </div>
  );
}

function RowMenu({ t, x, y, onClose }: { t: TrackRecord; x: number; y: number; onClose: () => void }) {
  const open = useUI((s) => s.open);
  const toast = useUI((s) => s.toast);
  const reanalyze = useLibrary((s) => s.reanalyze);
  const remove = useLibrary((s) => s.remove);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);
  const item = (label: string, fn: () => void, danger = false) => (
    <button
      type="button"
      className={danger ? 'is-danger' : ''}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        fn();
        onClose();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      className="menu"
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 220) }}
      role="menu"
    >
      {item('Queue for Auto DJ', () => {
        const ai = useAI.getState();
        ai.patch({ queue: [...ai.queue.filter((q) => q !== t.id), t.id] });
        toast(`Queued "${t.title}" for Auto DJ`, 'success');
      })}
      {item('Track details & beat grid', () => open('track', t.id))}
      {item('Re-analyse', () => reanalyze(t.id))}
      {item(
        'Remove from library',
        () => {
          const onDeck = useDecks.getState().decks.some((d) => d.trackId === t.id);
          if (onDeck) toast('Eject it from the deck first.', 'error');
          else void remove(t.id);
        },
        true,
      )}
    </div>
  );
}

export function LibraryPanel() {
  const tracks = useLibrary((s) => s.tracks);
  const ready = useLibrary((s) => s.ready);
  const importing = useLibrary((s) => s.importing);
  const pending = useLibrary((s) => s.pending.length + s.active.length);
  const addFiles = useLibrary((s) => s.addFiles);
  const addDemos = useLibrary((s) => s.addDemos);
  const toast = useUI((s) => s.toast);
  const mobile = useIsMobile();
  const scores = useMatchScores();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('match');
  const [compat, setCompat] = useState(false);
  const [tempoOnly, setTempoOnly] = useState(false);
  const [menu, setMenu] = useState<{ t: TrackRecord; x: number; y: number } | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [dropping, setDropping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowH = mobile ? ROW_H_MOBILE : ROW_H;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ref = referenceDeck();
  const refDeck = ref !== null ? useDecks.getState().decks[ref] : null;
  const refTrack = refDeck?.trackId ? tracks[refDeck.trackId] : undefined;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = Object.values(tracks);
    if (needle)
      out = out.filter(
        (t) =>
          `${t.title} ${t.artist} ${t.genre ?? ''} ${t.album ?? ''}`.toLowerCase().includes(needle) ||
          (t.analysis && camelot(trackKey(t)!).num + camelot(trackKey(t)!).letter === needle.toUpperCase()),
      );
    if ((compat || tempoOnly) && refTrack?.analysis && refDeck) {
      const k = effectiveKey(
        trackKey(refTrack) ?? refTrack.analysis.key,
        refDeck.tempo,
        refDeck.keyLock,
        refDeck.keyShift,
      );
      const bpm = trackBpm(refTrack) * refDeck.tempo;
      out = out.filter((t) => {
        if (!t.analysis) return false;
        if (compat && harmonicCompat(k, trackKey(t)!).score < 0.68) return false;
        if (tempoOnly) {
          const b = trackBpm(t);
          const best = Math.min(...[1, 2, 0.5].map((m) => Math.abs(bpm / (b * m) - 1)));
          if (best > 0.06) return false;
        }
        return true;
      });
    }
    const cmp: Record<SortKey, (a: TrackRecord, b: TrackRecord) => number> = {
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title),
      artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      bpm: (a, b) => trackBpm(a) - trackBpm(b),
      key: (a, b) => {
        const ka = a.analysis ? camelot(trackKey(a)!) : null;
        const kb = b.analysis ? camelot(trackKey(b)!) : null;
        return (
          (ka ? ka.num * 2 + (ka.letter === 'B' ? 1 : 0) : 99) -
          (kb ? kb.num * 2 + (kb.letter === 'B' ? 1 : 0) : 99)
        );
      },
      energy: (a, b) => (b.analysis?.energy ?? 0) - (a.analysis?.energy ?? 0),
      match: (a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1) || a.addedAt - b.addedAt,
    };
    return out.sort(cmp[sort]);
  }, [tracks, q, sort, compat, tempoOnly, scores, refTrack, refDeck]);

  const first = Math.max(0, Math.floor(scroll / rowH) - 4);
  const last = Math.min(list.length, Math.ceil((scroll + height) / rowH) + 4);
  const demosMissing = !Object.keys(tracks).some((id) => id.startsWith('demo-'));

  const onFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    const n = await addFiles(Array.from(files));
    toast(
      n ? `Imported ${n} track${n === 1 ? '' : 's'} – analysing…` : 'No audio files found.',
      n ? 'success' : 'error',
    );
  };

  return (
    <div
      className={`library ${dropping ? 'is-drop' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropping(false);
        void onFiles(e.dataTransfer.files);
      }}
    >
      <div className="lib-toolbar">
        <label className="search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search title, artist, genre, key (8A)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search library"
          />
        </label>
        <button type="button" className="btn btn-primary btn-s" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={13} /> Import
        </button>
        {!mobile && (
          <button
            type="button"
            className="btn btn-default btn-s"
            onClick={() => folderRef.current?.click()}
            title="Import a whole folder"
          >
            <Icon name="folder" size={13} /> Folder
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.aiff,.opus"
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files).then(() => (e.target.value = ''))}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => void onFiles(e.target.files).then(() => (e.target.value = ''))}
        />
        <div className="lib-filters">
          <button
            type="button"
            className={`chip ${compat ? 'is-on' : ''}`}
            onClick={() => setCompat(!compat)}
            disabled={!refTrack}
            title="Only harmonically compatible keys"
          >
            Key match
          </button>
          <button
            type="button"
            className={`chip ${tempoOnly ? 'is-on' : ''}`}
            onClick={() => setTempoOnly(!tempoOnly)}
            disabled={!refTrack}
            title="Only tracks within ±6% tempo"
          >
            BPM ±6%
          </button>
          <select
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort by"
          >
            <option value="match">Sort: AI match</option>
            <option value="added">Sort: recently added</option>
            <option value="title">Sort: title</option>
            <option value="artist">Sort: artist</option>
            <option value="bpm">Sort: BPM</option>
            <option value="key">Sort: key (Camelot)</option>
            <option value="energy">Sort: energy</option>
          </select>
        </div>
      </div>
      {(importing || pending > 0) && (
        <div className="lib-progress">
          {importing ? (
            <>
              <span className="spinner" /> Importing {importing.done}/{importing.total}{' '}
              {importing.current ? <span className="faint truncate">{importing.current}</span> : null}
            </>
          ) : (
            <>
              <span className="spinner" /> Analysing {pending} track{pending === 1 ? '' : 's'} (BPM, key,
              energy, structure)…
            </>
          )}
        </div>
      )}
      {!mobile && (
        <div className="trow trow-head" aria-hidden>
          <span />
          <span>Title / Artist</span>
          <span>Genre</span>
          <span>BPM</span>
          <span>Key</span>
          <span>Energy</span>
          <span>Time</span>
          <span title="AI match with the playing deck">Match</span>
          <span />
        </div>
      )}
      <div
        className="lib-list"
        ref={listRef}
        onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}
      >
        {ready && list.length === 0 && (
          <div className="lib-empty">
            {q || compat || tempoOnly ? (
              <p>No tracks match.</p>
            ) : (
              <>
                <Icon name="music" size={28} />
                <p>Drop audio files here or tap Import (MP3, WAV, FLAC, AAC, OGG).</p>
                {demosMissing && (
                  <button type="button" className="btn btn-ai btn-s" onClick={() => void addDemos()}>
                    <Icon name="sparkle" size={13} /> Add the 8 demo tracks
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <div style={{ height: list.length * rowH, position: 'relative' }}>
          {list.slice(first, last).map((t, i) => (
            <div
              key={t.id}
              style={{ position: 'absolute', top: (first + i) * rowH, left: 0, right: 0, height: rowH }}
            >
              <TrackRowView
                t={t}
                score={scores.get(t.id)}
                mobile={mobile}
                onMenu={(tt, x, y) => setMenu({ t: tt, x, y })}
              />
            </div>
          ))}
        </div>
        {ready && list.length > 0 && demosMissing && !q && (
          <div className="lib-foot">
            <button type="button" className="chip" onClick={() => void addDemos()}>
              + Add demo tracks
            </button>
          </div>
        )}
      </div>
      {menu && <RowMenu t={menu.t} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
