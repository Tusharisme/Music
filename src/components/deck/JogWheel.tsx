import { useRef, type PointerEvent } from 'react';
import { engine } from '../../audio/engine';
import { useDecks } from '../../state/decks';
import { useLibrary } from '../../state/library';
import { useRaf } from '../../hooks/useRaf';
import { bend, scratchEnd, scratchMove, scratchStart } from '../../controller/decks';
import { Artwork } from '../Artwork';

const SEC_PER_REV = 1.8; // 33⅓ rpm

/**
 * Touch/mouse platter. Vinyl mode: touching the platter scratches (the record follows
 * your hand); the outer ring – or vinyl mode off – bends the pitch to nudge.
 */
/** `size` in px; omit it to size the platter from CSS (`--jog`). */
export function JogWheel({ deck, size }: { deck: number; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const platter = useRef<SVGGElement>(null);
  const g = useRef<{
    mode: 'scratch' | 'bend';
    last: number;
    t: number;
    acc: number;
    start: number;
    id: number;
  } | null>(null);
  const trackId = useDecks((s) => s.decks[deck].trackId);
  const vinyl = useDecks((s) => s.decks[deck].vinyl);
  const t = useLibrary((s) => (trackId ? s.tracks[trackId] : undefined));

  useRaf(() => {
    const el = platter.current;
    if (!el) return;
    const pos = engine.transport.position(deck);
    el.setAttribute('transform', `rotate(${((pos / SEC_PER_REV) * 360) % 360} 50 50)`);
  });

  const angle = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!trackId) return;
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const radius = Math.hypot(dx, dy) / (r.width / 2);
    const d = useDecks.getState().decks[deck];
    const mode = (vinyl && radius < 0.78) || !d.playing ? 'scratch' : 'bend';
    ref.current!.setPointerCapture(e.pointerId);
    g.current = {
      mode,
      last: angle(e),
      t: performance.now(),
      acc: 0,
      start: engine.transport.position(deck),
      id: e.pointerId,
    };
    if (mode === 'scratch') scratchStart(deck);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const a = angle(e);
    let da = a - s.last;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    const now = performance.now();
    const dt = Math.max(0.004, (now - s.t) / 1000);
    s.last = a;
    s.t = now;
    const dSec = (da / (2 * Math.PI)) * SEC_PER_REV;
    if (s.mode === 'scratch') {
      s.acc += dSec;
      scratchMove(deck, Math.max(0, s.start + s.acc), dSec / dt);
    } else {
      bend(deck, Math.max(-0.6, Math.min(0.6, (dSec / dt) * 0.35)));
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    if (s.mode === 'scratch') scratchEnd(deck);
    else bend(deck, 0);
    g.current = null;
  };

  return (
    <div
      ref={ref}
      className={`jog ${trackId ? '' : 'is-empty'} ${vinyl ? 'is-vinyl' : ''}`}
      style={size ? { width: size, height: size } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label={`Deck ${deck === 0 ? 'A' : 'B'} jog wheel – drag to ${vinyl ? 'scratch' : 'nudge'}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden>
        <defs>
          <radialGradient id={`jog-grad-${deck}`} cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#1e2448" />
            <stop offset="100%" stopColor="#0a0d1d" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="49" className="jog-ring" />
        <circle cx="50" cy="50" r="42" fill={`url(#jog-grad-${deck})`} />
        <g ref={platter}>
          {[38, 34, 30, 26].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} className="jog-groove" />
          ))}
          <rect x="49" y="8" width="2" height="12" rx="1" className="jog-marker" />
        </g>
      </svg>
      <div className="jog-label">
        <Artwork track={t} size={size ? size * 0.34 : 48} round />
      </div>
    </div>
  );
}
