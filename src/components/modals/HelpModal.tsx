import { useUI } from '../../state/ui';
import { Modal } from './Modal';
import { SHORTCUTS } from '../../controller/keyboard';

export function HelpModal() {
  const close = useUI((s) => s.close);
  return (
    <Modal title="How to use MixMind" onClose={close} wide>
      <div className="help">
        <section>
          <h3>Quick start</h3>
          <ol>
            <li>
              <b>Load</b> a track: drag it from the library onto a deck, or press its <b>A</b>/<b>B</b>{' '}
              button. Import your own files with <b>Import</b> (they stay in your browser).
            </li>
            <li>
              <b>Play</b> it, then open <b>AI Copilot → Next up</b>: every track is scored against what's
              playing (key, tempo, energy, sound).
            </li>
            <li>
              Hit <b>AI Mix</b> on a suggestion – the AI cues it on the other deck, beat-matches it and
              performs the transition on the next phrase. Grab any knob to take over.
            </li>
            <li>
              Flip on <b>Auto DJ</b> and it keeps choosing and mixing tracks for you. Change the <b>vibe</b>{' '}
              (Build, Cool down, Switch it up…) any time.
            </li>
            <li>
              Connect <b>Claude</b> (Settings → AI) to chat with an AI DJ, plan whole sets and discover new
              songs that would mix well.
            </li>
          </ol>
        </section>
        <section>
          <h3>DJ basics</h3>
          <ul>
            <li>
              <b>CUE</b>: when paused, sets the cue point (hold to preview); when playing, jumps back to it.
            </li>
            <li>
              <b>SYNC</b>: matches tempo and aligns the beats to the other deck. <b>KEY</b> (key lock) keeps
              the pitch while you change tempo.
            </li>
            <li>
              <b>EQ</b>: turn a knob fully left to kill that band. Classic blend: cut the incoming low end,
              bring it in, then swap the basses on the phrase.
            </li>
            <li>
              <b>Filter</b>: left = low-pass, right = high-pass. <b>Hot cues</b> remember points in a track;{' '}
              <b>Loop/Roll</b> pads loop beats (rolls snap back when released).
            </li>
            <li>
              <b>Jog wheel</b>: in vinyl mode touch the platter to scratch; the outer ring nudges the tempo to
              line beats up by ear.
            </li>
            <li>
              Keys are shown on the <b>Camelot wheel</b>: same number, ±1, or switching A↔B mixes
              harmonically.
            </li>
          </ul>
        </section>
        <section>
          <h3>Keyboard shortcuts</h3>
          <table className="shortcuts">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Install as an app</h3>
          <ul>
            <li>
              <b>Desktop (Chrome/Edge)</b>: click <b>Install</b> in the top bar or the install icon in the
              address bar.
            </li>
            <li>
              <b>Android</b>: browser menu → <b>Install app</b> / Add to Home screen.
            </li>
            <li>
              <b>iPhone / iPad</b>: Share → <b>Add to Home Screen</b>. Turn off silent mode if you hear
              nothing.
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
