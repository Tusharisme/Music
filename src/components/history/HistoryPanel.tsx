import { useHistory, tracklistText } from '../../state/history';
import { useLibrary } from '../../state/library';
import { useUI } from '../../state/ui';
import { Artwork } from '../Artwork';
import { fmtTime } from '../../utils/format';
import { Icon } from '../Icon';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function HistoryPanel() {
  const entries = useHistory((s) => s.entries);
  const clear = useHistory((s) => s.clear);
  const tracks = useLibrary((s) => s.tracks);
  const toast = useUI((s) => s.toast);
  return (
    <div className="history">
      <div className="history-bar">
        <span className="muted">
          {entries.length} track{entries.length === 1 ? '' : 's'} played this session
        </span>
        <button
          type="button"
          className="chip"
          disabled={!entries.length}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(tracklistText(entries))
              .then(() => toast('Tracklist copied', 'success'));
          }}
        >
          Copy tracklist
        </button>
        <button
          type="button"
          className="chip"
          disabled={!entries.length}
          onClick={() =>
            download(`mixmind-tracklist-${new Date().toISOString().slice(0, 10)}.txt`, tracklistText(entries))
          }
        >
          <Icon name="download" size={12} /> Export
        </button>
        <button type="button" className="chip" disabled={!entries.length} onClick={clear}>
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="faint pad">
          Tracks you play appear here with timestamps – handy for tracklists and recordings.
        </p>
      ) : (
        <ol className="history-list">
          {entries.map((e, i) => (
            <li key={`${e.trackId}-${e.at}`}>
              <span className="mono faint">{String(i + 1).padStart(2, '0')}</span>
              <span className="mono">{fmtTime(e.setTime)}</span>
              <Artwork track={tracks[e.trackId]} size={26} />
              <span className="truncate">
                <b>{e.title}</b> <span className="faint">– {e.artist}</span>
              </span>
              <span className={`tag ${e.deck === 0 ? 'tag-a' : 'tag-b'}`}>{e.deck === 0 ? 'A' : 'B'}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
