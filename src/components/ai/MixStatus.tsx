import { useRef } from 'react';
import { useAI } from '../../state/ai';
import { useLibrary } from '../../state/library';
import { useRaf } from '../../hooks/useRaf';
import { engine } from '../../audio/engine';
import { autoMixer } from '../../ai/automix';
import { autoDj } from '../../ai/autodj';
import { Icon } from '../Icon';

/** Live view of an armed/running AI transition. */
export function MixStatus() {
  const mix = useAI((s) => s.mix);
  const autoDjOn = useAI((s) => s.autoDj);
  const t = useLibrary((s) => (mix.trackId ? s.tracks[mix.trackId] : undefined));
  const countdown = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useRaf(() => {
    const m = useAI.getState().mix;
    if (!m.plan || !engine.ctx) return;
    const left = m.t0 - engine.ctx.currentTime;
    if (countdown.current) {
      countdown.current.textContent =
        left > 0
          ? `starts in ${left >= 60 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${left.toFixed(1)}s`}`
          : `${Math.round(Math.max(0, m.progress) * 100)}%`;
    }
    if (bar.current) bar.current.style.width = `${Math.max(0, m.progress) * 100}%`;
  }, mix.phase !== 'idle');

  if (mix.phase === 'idle' || !mix.plan) return null;
  const p = mix.plan;
  const out = mix.outDeck === 0 ? 'A' : 'B';
  const inn = mix.inDeck === 0 ? 'A' : 'B';
  return (
    <div className={`mix-status is-${mix.phase}`} role="status" aria-live="polite">
      <div className="mix-head">
        <span className="ai-orb" aria-hidden />
        <div className="mix-title">
          <strong>
            {p.name}
            {p.technique !== 'echo-out' &&
            p.technique !== 'loop-roll' &&
            p.technique !== 'quick-cut' &&
            p.technique !== 'spinback'
              ? ` · ${p.bars} bars`
              : ''}
          </strong>
          <span className="muted truncate">
            {out} → {inn}: {t ? `${t.title} – ${t.artist}` : '…'}
          </span>
        </div>
        <span className="mix-count mono" ref={countdown}>
          {mix.phase === 'preparing' ? 'preparing…' : ''}
        </span>
        {autoDjOn && mix.phase === 'armed' && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => void autoDj.skip()}
            title="Pick a different next track"
            aria-label="Skip to another track"
          >
            <Icon name="skip" size={13} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={() => autoMixer.cancel()}
          title="Cancel – take over manually"
          aria-label="Cancel AI transition"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="mix-progress">
        <div ref={bar} />
      </div>
      <ol className="mix-steps">
        {p.steps.map((s, i) => (
          <li
            key={i}
            className={
              mix.progress * Math.max(1, p.endBeat) >= s.beat && mix.phase === 'running' ? 'is-done' : ''
            }
          >
            <span className="mono faint">
              {s.beat < 0 ? `${s.beat / 4} bar` : `bar ${Math.floor(s.beat / 4) + 1}`}
            </span>{' '}
            {s.text}
          </li>
        ))}
      </ol>
      <p className="mix-summary faint">{p.summary}</p>
    </div>
  );
}
