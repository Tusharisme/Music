import { useState } from 'react';
import type { Suggestion } from '../../ai/recommender';
import { TECHNIQUES, type TechniqueId } from '../../ai/transitions';
import { aiMix } from '../../ai/autodj';
import { useDecks } from '../../state/decks';
import { useAI } from '../../state/ai';
import { useUI } from '../../state/ui';
import { loadTrack } from '../../controller/decks';
import { Artwork } from '../Artwork';
import { KeyBadge, EnergyMeter } from '../KeyBadge';
import { Icon } from '../Icon';
import { trackKey, trackBpm } from '../../ai/recommender';

export function ScoreRing({ score, size = 40 }: { score: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score));
  const color = v >= 75 ? 'var(--good)' : v >= 55 ? 'var(--ai)' : 'var(--warn)';
  return (
    <span className="score-ring" style={{ width: size, height: size }} title={`AI match ${v.toFixed(0)}/100`}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-fg"
          stroke={color}
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b className="mono">{Math.round(v)}</b>
    </span>
  );
}

function useMixTargets() {
  const mixBusy = useAI((st) => st.mix.phase !== 'idle');
  const freeDeck = useDecks((st) => {
    const playing = st.decks.findIndex((d) => d.playing);
    if (playing >= 0) return st.decks[1 - playing].playing ? -1 : 1 - playing;
    return st.decks[0].trackId ? 1 : 0;
  });
  const anyPlaying = useDecks((st) => st.decks.some((d) => d.playing));
  return { mixBusy, freeDeck, anyPlaying };
}

/** Compact row for the runners-up: why it fits on hover, one-tap load or mix. */
export function SuggestionRow({ s, rank }: { s: Suggestion; rank: number }) {
  const { mixBusy, freeDeck, anyPlaying } = useMixTargets();
  const t = s.track;
  const why = [...s.reasons, ...s.warnings.map((w) => `⚠ ${w}`)].join(' · ');
  return (
    <div className="sugg-row" role="listitem" title={why}>
      <span className="sugg-rank mono faint">{rank + 1}</span>
      <Artwork track={t} size={30} />
      <div className="sugg-row-text">
        <strong className="truncate">{t.title}</strong>
        <span className="truncate faint">{s.reasons[0] ?? t.artist}</span>
      </div>
      <KeyBadge k={trackKey(t)} small />
      <span className="mono sugg-bpm">{trackBpm(t).toFixed(0)}</span>
      <ScoreRing score={s.score} size={30} />
      <button
        type="button"
        className={`load-btn ${freeDeck === 1 ? 'deck-b' : 'deck-a'}`}
        disabled={freeDeck < 0}
        onClick={() => void loadTrack(freeDeck, t.id)}
        title={freeDeck < 0 ? 'Both decks are playing' : `Load to deck ${freeDeck === 0 ? 'A' : 'B'}`}
        aria-label={`Load ${t.title}`}
      >
        {freeDeck === 1 ? 'B' : 'A'}
      </button>
      <button
        type="button"
        className="mix-btn"
        disabled={!anyPlaying || mixBusy}
        onClick={() => void aiMix(t.id)}
        title={anyPlaying ? 'AI Mix this track in' : 'Play a track first'}
        aria-label={`AI Mix ${t.title}`}
      >
        <Icon name="sparkle" size={12} />
      </button>
    </div>
  );
}

/** The top "play next" recommendation with reasons, technique choice and actions. */
export function SuggestionCard({ s, rank }: { s: Suggestion; rank: number }) {
  const [tech, setTech] = useState<TechniqueId | 'auto'>('auto');
  const { mixBusy, freeDeck, anyPlaying } = useMixTargets();
  const toast = useUI((st) => st.toast);
  const t = s.track;
  return (
    <article className={`sugg ${rank === 0 ? 'is-top' : ''}`}>
      <div className="sugg-main">
        <Artwork track={t} size={44} />
        <div className="sugg-text">
          <strong className="truncate">{t.title}</strong>
          <span className="muted truncate">{t.artist}</span>
          <span className="sugg-meta">
            <KeyBadge k={trackKey(t)} small /> <span className="mono">{trackBpm(t).toFixed(1)}</span>
            <EnergyMeter value={s.analysis.energy} />
          </span>
        </div>
        <ScoreRing score={s.score} />
      </div>
      <div className="chips">
        {s.reasons.map((r) => (
          <span key={r} className="chip-static">
            {r}
          </span>
        ))}
        {s.warnings.map((w) => (
          <span key={w} className="chip-static is-warn">
            {w}
          </span>
        ))}
      </div>
      <div className="sugg-actions">
        <button
          type="button"
          className="btn btn-default btn-s"
          disabled={freeDeck < 0}
          onClick={() => void loadTrack(freeDeck, t.id)}
          title={freeDeck < 0 ? 'Both decks are playing' : `Load to deck ${freeDeck === 0 ? 'A' : 'B'}`}
        >
          Load {freeDeck >= 0 ? (freeDeck === 0 ? 'A' : 'B') : ''}
        </button>
        <button
          type="button"
          className="btn btn-ai btn-s"
          disabled={!anyPlaying || mixBusy}
          onClick={() => void aiMix(t.id, { technique: tech === 'auto' ? undefined : tech })}
          title={anyPlaying ? 'Let the AI mix it in on the next phrase' : 'Play a track first'}
        >
          <Icon name="sparkle" size={12} /> AI Mix
        </button>
        <select
          className="select select-s"
          value={tech}
          onChange={(e) => setTech(e.target.value as TechniqueId | 'auto')}
          aria-label="Transition technique"
        >
          <option value="auto">Auto technique</option>
          {Object.entries(TECHNIQUES).map(([id, m]) => (
            <option key={id} value={id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-btn"
          title="Queue for Auto DJ"
          aria-label="Queue for Auto DJ"
          onClick={() => {
            const ai = useAI.getState();
            ai.patch({ queue: [...ai.queue.filter((q) => q !== t.id), t.id] });
            toast(`Queued "${t.title}"`, 'success');
          }}
        >
          <Icon name="queue" size={14} />
        </button>
      </div>
    </article>
  );
}
