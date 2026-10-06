import { useState } from 'react';
import { useAI } from '../../state/ai';
import { useSettings } from '../../state/settings';
import { useLibrary } from '../../state/library';
import { MIX_STYLES, VIBES, type MixStyle, type Vibe } from '../../ai/recommender';
import { autoDj } from '../../ai/autodj';
import { Switch } from '../controls/Btn';
import { Icon } from '../Icon';
import { MixStatus } from './MixStatus';
import { SuggestionCard, SuggestionRow } from './SuggestionCard';
import { CopilotChat, SetPlanner } from './Copilot';

type Tab = 'next' | 'ask' | 'plan';

function NextUp() {
  const suggestions = useAI((s) => s.suggestions);
  const refDeck = useAI((s) => s.refDeck);
  const queue = useAI((s) => s.queue);
  const tracks = useLibrary((s) => s.tracks);
  const analysing = useLibrary((s) => s.pending.length + s.active.length);
  if (refDeck === null) {
    return (
      <div className="ai-empty">
        <span className="ai-orb is-big" aria-hidden />
        <p>
          Load a track on a deck and the AI will rank your whole library for what to play next – by <b>key</b>{' '}
          (Camelot), <b>tempo</b>, <b>energy</b> and <b>sound</b> – and can mix it in for you.
        </p>
      </div>
    );
  }
  return (
    <div className="next-up">
      {queue.length > 0 && (
        <div className="queue-line">
          <Icon name="queue" size={13} />
          <span className="muted truncate">
            Auto DJ queue:{' '}
            {queue
              .map((id) => tracks[id]?.title)
              .filter(Boolean)
              .join(' → ')}
          </span>
          <button type="button" className="chip" onClick={() => useAI.getState().patch({ queue: [] })}>
            Clear
          </button>
        </div>
      )}
      {suggestions.length === 0 ? (
        <p className="faint pad">
          {analysing
            ? 'Analysing tracks…'
            : 'No suggestions yet – the playing track needs analysis, or the library is empty.'}
        </p>
      ) : (
        <>
          <SuggestionCard s={suggestions[0]} rank={0} />
          {suggestions.length > 1 && (
            <div className="sugg-list" role="list" aria-label="More suggestions">
              {suggestions.slice(1, 10).map((s, i) => (
                <SuggestionRow key={s.track.id} s={s} rank={i + 1} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AIPanel() {
  const [tab, setTab] = useState<Tab>('next');
  const vibe = useSettings((s) => s.vibe);
  const style = useSettings((s) => s.mixStyle);
  const when = useSettings((s) => s.mixWhen);
  const set = useSettings((s) => s.set);
  const autoDjOn = useAI((s) => s.autoDj);
  const copilot = useAI((s) => s.copilot);
  return (
    <div className="ai-panel">
      <div className="ai-head">
        <div className="ai-title">
          <span className="ai-orb" aria-hidden />
          <h2>AI Copilot</h2>
        </div>
        <div className="tabs ai-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'next'}
            className={tab === 'next' ? 'is-on' : ''}
            onClick={() => setTab('next')}
          >
            Next up
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ask'}
            className={tab === 'ask' ? 'is-on' : ''}
            onClick={() => setTab('ask')}
          >
            Ask AI {copilot.state === 'ready' ? <span className="dot is-good" /> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'plan'}
            className={tab === 'plan' ? 'is-on' : ''}
            onClick={() => setTab('plan')}
          >
            Set planner
          </button>
        </div>
        <Switch
          on={autoDjOn}
          onChange={(on) => (on ? void autoDj.start() : autoDj.stop())}
          label={<b>Auto DJ</b>}
          className="autodj-switch"
        />
      </div>
      {tab === 'next' && (
        <div className="ai-controls">
          <select
            className="select select-s"
            value={vibe}
            onChange={(e) => set({ vibe: e.target.value as Vibe })}
            aria-label="Vibe"
            title={VIBES.find((v) => v.id === vibe)?.hint}
          >
            {VIBES.map((v) => (
              <option key={v.id} value={v.id} title={v.hint}>
                Vibe: {v.label}
              </option>
            ))}
          </select>
          <select
            className="select select-s"
            value={style}
            onChange={(e) => set({ mixStyle: e.target.value as MixStyle })}
            aria-label="Mixing style"
            title="What matters most when ranking tracks"
          >
            {Object.entries(MIX_STYLES).map(([id, m]) => (
              <option key={id} value={id}>
                Style: {m.label}
              </option>
            ))}
          </select>
          <select
            className="select select-s"
            value={when}
            onChange={(e) => set({ mixWhen: e.target.value as 'phrase' | 'now' })}
            aria-label="When to mix"
            title="When an AI Mix starts"
          >
            <option value="phrase">Mix at the outro</option>
            <option value="now">Mix on the next phrase</option>
          </select>
        </div>
      )}
      <MixStatus />
      <div className="ai-body">
        {tab === 'next' && <NextUp />}
        {tab === 'ask' && <CopilotChat />}
        {tab === 'plan' && <SetPlanner />}
      </div>
    </div>
  );
}
