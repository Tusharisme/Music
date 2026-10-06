import { useUI } from '../../state/ui';
import { useSettings } from '../../state/settings';
import { useDecks } from '../../state/decks';
import { useLibrary } from '../../state/library';
import { loadTrack } from '../../controller/decks';
import { Modal } from './Modal';
import { Icon } from '../Icon';

/** Same key (8A), 122 → 124 BPM: a textbook first blend. */
const STARTER: [string, string] = ['demo-midnight-drive', 'demo-afterglow'];

async function loadStarterPair() {
  if (!useLibrary.getState().ready) {
    await new Promise<void>((resolve) => {
      const off = useLibrary.subscribe((s) => {
        if (s.ready) {
          off();
          resolve();
        }
      });
    });
  }
  const { decks } = useDecks.getState();
  const { tracks } = useLibrary.getState();
  const jobs = STARTER.map((id, deck) =>
    !decks[deck].trackId && tracks[id] ? loadTrack(deck, id) : Promise.resolve(false),
  );
  if ((await Promise.all(jobs)).some(Boolean)) {
    useUI
      .getState()
      .toast('Two demo tracks are loaded – press ▶ on deck A, then hit “AI Mix” on a suggestion.', 'info');
  }
}

export function WelcomeModal() {
  const close = useUI((s) => s.close);
  const set = useSettings((s) => s.set);
  const done = () => {
    set({ seenWelcome: true });
    close();
    void loadStarterPair();
  };
  return (
    <Modal
      title={
        <>
          Welcome to Mix<b>Mind</b>
        </>
      }
      onClose={done}
      footer={
        <button type="button" className="btn btn-ai btn-m" onClick={done}>
          <Icon name="sparkle" size={14} /> Let's mix
        </button>
      }
    >
      <div className="welcome">
        <p className="muted">
          A two-deck DJ mixer in your browser – with an AI that knows what should come next and can mix it in
          for you.
        </p>
        <ul className="welcome-list">
          <li>
            <span className="w-ico">🎛️</span>
            <div>
              <b>Real DJ controls</b>
              <span className="muted">
                Jog wheels, sync, key lock, hot cues, loops, kill EQs, filters, FX, sampler and recording.
              </span>
            </div>
          </li>
          <li>
            <span className="w-ico">🧠</span>
            <div>
              <b>AI that hears your music</b>
              <span className="muted">
                Every track is analysed for BPM, key, energy and song structure, so suggestions are harmonic
                and on-tempo.
              </span>
            </div>
          </li>
          <li>
            <span className="w-ico">✨</span>
            <div>
              <b>AI Mix &amp; Auto DJ</b>
              <span className="muted">
                One tap and it beat-matches and blends on the phrase. Or let Auto DJ run the whole set.
              </span>
            </div>
          </li>
          <li>
            <span className="w-ico">🎵</span>
            <div>
              <b>8 demo tracks included</b>
              <span className="muted">
                Original tracks generated right here – deep house to drum &amp; bass. Import your own any
                time.
              </span>
            </div>
          </li>
        </ul>
      </div>
    </Modal>
  );
}
