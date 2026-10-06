import { useState } from 'react';
import { useUI } from '../../state/ui';
import { useLibrary } from '../../state/library';
import { Modal } from './Modal';
import { Artwork } from '../Artwork';
import { KeyBadge, EnergyMeter } from '../KeyBadge';
import { fromCamelot, camelotLabel, longLabel } from '../../music/keys';
import { trackBpm, trackKey } from '../../ai/recommender';
import { fmtTime } from '../../utils/format';

export function TrackModal() {
  const id = useUI((s) => s.editTrackId);
  const close = useUI((s) => s.close);
  const t = useLibrary((s) => (id ? s.tracks[id] : undefined));
  const update = useLibrary((s) => s.update);
  const reanalyze = useLibrary((s) => s.reanalyze);
  const [title, setTitle] = useState(t?.title ?? '');
  const [artist, setArtist] = useState(t?.artist ?? '');
  const [genre, setGenre] = useState(t?.genre ?? '');
  if (!t) return null;
  const a = t.analysis;
  const grid = t.gridOverride ?? a?.beatgrid;
  const setGrid = (bpm: number, firstBeat: number) =>
    void update(t.id, { gridOverride: { bpm: Math.round(bpm * 1000) / 1000, firstBeat } });
  const key = trackKey(t);
  return (
    <Modal
      title="Track details"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-default btn-s" onClick={() => reanalyze(t.id)}>
            Re-analyse
          </button>
          <button
            type="button"
            className="btn btn-primary btn-s"
            onClick={() => {
              void update(t.id, {
                title: title.trim() || t.title,
                artist: artist.trim() || t.artist,
                genre: genre.trim() || undefined,
              });
              close();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="track-edit">
        <div className="te-head">
          <Artwork track={t} size={72} />
          <div className="te-fields">
            <label>
              <span className="label">Title</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              <span className="label">Artist</span>
              <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <label>
              <span className="label">Genre</span>
              <input className="input" value={genre} onChange={(e) => setGenre(e.target.value)} />
            </label>
          </div>
        </div>
        {!a ? (
          <p className="faint">
            {t.analysisError ? `Analysis failed: ${t.analysisError}` : 'Analysis pending…'}
          </p>
        ) : (
          <>
            <div className="te-stats">
              <div>
                <span className="label">BPM</span>
                <b className="mono">{trackBpm(t).toFixed(2)}</b>
                <small className="faint">confidence {Math.round(a.bpmConfidence * 100)}%</small>
              </div>
              <div>
                <span className="label">Key</span>
                <KeyBadge k={key} />
                <small className="faint">{key ? longLabel(key) : ''}</small>
              </div>
              <div>
                <span className="label">Energy</span>
                <EnergyMeter value={a.energy} />
              </div>
              <div>
                <span className="label">Loudness</span>
                <b className="mono">{a.loudness} LUFS</b>
              </div>
              <div>
                <span className="label">Length</span>
                <b className="mono">{fmtTime(a.duration)}</b>
              </div>
              <div>
                <span className="label">Mood</span>
                <span>{a.mood.join(', ') || '—'}</span>
              </div>
            </div>
            <div className="te-section">
              <span className="label">Beat grid</span>
              <div className="te-row">
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm / 2, grid.firstBeat)}
                >
                  ÷2 BPM
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm * 2, grid.firstBeat)}
                >
                  ×2 BPM
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm - 0.1, grid.firstBeat)}
                >
                  −0.1
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm + 0.1, grid.firstBeat)}
                >
                  +0.1
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm, grid.firstBeat - 0.01)}
                >
                  ◀ 10 ms
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm, grid.firstBeat + 0.01)}
                >
                  10 ms ▶
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => grid && setGrid(grid.bpm, grid.firstBeat + 60 / grid.bpm)}
                  title="Move the downbeat one beat later"
                >
                  Downbeat +1
                </button>
                {t.gridOverride && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void update(t.id, { gridOverride: undefined })}
                  >
                    Reset grid
                  </button>
                )}
              </div>
              <small className="faint">
                {grid ? `${grid.bpm.toFixed(2)} BPM, first downbeat at ${grid.firstBeat.toFixed(3)} s` : ''}
                {t.gridOverride ? ' (edited)' : ''}
              </small>
            </div>
            <div className="te-section">
              <span className="label">Key</span>
              <div className="te-row">
                <select
                  className="select"
                  value={key ? camelotLabel(key) : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    void update(t.id, {
                      keyOverride: fromCamelot(Number(v.slice(0, -1)), v.slice(-1) as 'A' | 'B'),
                    });
                  }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) =>
                    (['A', 'B'] as const).map((l) => (
                      <option key={`${n}${l}`} value={`${n}${l}`}>
                        {n}
                        {l} – {longLabel(fromCamelot(n, l))}
                      </option>
                    )),
                  )}
                </select>
                {t.keyOverride && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void update(t.id, { keyOverride: undefined })}
                  >
                    Use detected ({camelotLabel(a.key)})
                  </button>
                )}
              </div>
            </div>
            <div className="te-section">
              <span className="label">Structure (AI)</span>
              <div className="te-sections">
                {a.structure.sections.map((s, i) => (
                  <span key={i} className={`sec sec-${s.label}`} title={`${s.label} @ ${fmtTime(s.time)}`}>
                    {s.label}
                  </span>
                ))}
              </div>
              <small className="faint">
                Mix in {fmtTime(a.structure.mixIn)} · intro ends {fmtTime(a.structure.introEnd)} · mix out{' '}
                {fmtTime(a.structure.mixOut)}
                {a.structure.mainDrop !== null ? ` · drop ${fmtTime(a.structure.mainDrop)}` : ''}
              </small>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
