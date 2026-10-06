import { useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

export interface FaderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  defaultValue?: number;
  orientation?: 'vertical' | 'horizontal';
  label?: string;
  /** Click on the track moves the cap there (channel faders); otherwise drag is relative (tempo). */
  jump?: boolean;
  detent?: number;
  /** Visually invert (e.g. tempo faders where up = slower on CDJs). */
  invert?: boolean;
  className?: string;
  midi?: string;
  format?: (v: number) => string;
  ticks?: number;
  title?: string;
}

/** Inset of the cap's travel from each end of the track (matches the groove in CSS). */
const PAD = 7;
const along = (f: number) => `calc(${PAD}px + (100% - ${2 * PAD}px) * ${f})`;

/** Linear fader with pointer, wheel and keyboard control. Double-click resets. */
export function Fader({
  value,
  onChange,
  min = 0,
  max = 1,
  defaultValue,
  orientation = 'vertical',
  label,
  jump = true,
  detent,
  invert = false,
  className = '',
  midi,
  format,
  ticks = 0,
  title,
}: FaderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; v: number; id: number } | null>(null);
  const lastTap = useRef(0);
  const [active, setActive] = useState(false);
  const range = max - min;
  const vertical = orientation === 'vertical';
  const reset = defaultValue ?? min;

  const clamp = (v: number) => {
    let n = Math.max(min, Math.min(max, v));
    if (detent !== undefined && Math.abs(n - detent) < range * 0.012) n = detent;
    return n;
  };

  const fracFromEvent = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let f = vertical
      ? 1 - (e.clientY - r.top - PAD) / (r.height - 2 * PAD)
      : (e.clientX - r.left - PAD) / (r.width - 2 * PAD);
    if (invert) f = 1 - f;
    return Math.max(0, Math.min(1, f));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastTap.current < 300) {
      onChange(reset);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    ref.current!.setPointerCapture(e.pointerId);
    const onCap = (e.target as HTMLElement).classList.contains('fader-cap');
    let v = value;
    if (jump && !onCap) {
      v = clamp(min + fracFromEvent(e) * range);
      onChange(v);
    }
    drag.current = { start: vertical ? e.clientY : e.clientX, v, id: e.pointerId };
    setActive(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const r = ref.current!.getBoundingClientRect();
    const len = Math.max(1, (vertical ? r.height : r.width) - 2 * PAD);
    let delta = ((vertical ? d.start - e.clientY : e.clientX - d.start) / len) * range;
    if (invert) delta = -delta;
    if (e.shiftKey) delta *= 0.2;
    const v = clamp(d.v + delta);
    if (v !== value) onChange(v);
  };

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setActive(false);
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const dir = -Math.sign(e.deltaY) * (invert ? -1 : 1);
    onChange(clamp(value + dir * range * (e.shiftKey ? 0.005 : 0.03)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = range * (e.shiftKey ? 0.005 : 0.03) * (invert ? -1 : 1);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - step));
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else if (e.key === 'Enter' || e.key === '0') onChange(reset);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let f = (value - min) / range;
  if (invert) f = 1 - f;
  const pos = along(f);
  const display = format ? format(value) : `${Math.round(((value - min) / range) * 100)}%`;

  return (
    <div
      className={`fader ${vertical ? 'is-v' : 'is-h'} ${active ? 'is-active' : ''} ${className}`}
      data-midi={midi}
    >
      <div
        ref={ref}
        className="fader-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 1000) / 1000}
        aria-valuetext={display}
        title={title ?? (label ? `${label}: ${display} (double-click to reset)` : undefined)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {ticks > 0 && (
          <div className="fader-ticks" aria-hidden>
            {Array.from({ length: ticks + 1 }, (_, i) => (
              <span key={i} style={vertical ? { bottom: along(i / ticks) } : { left: along(i / ticks) }} />
            ))}
          </div>
        )}
        <div className="fader-groove" />
        <div
          className="fader-fill"
          style={
            vertical
              ? { height: `calc((100% - ${2 * PAD}px) * ${f})` }
              : { width: `calc((100% - ${2 * PAD}px) * ${f})` }
          }
        />
        <div className="fader-cap" style={vertical ? { bottom: pos } : { left: pos }} />
        {active && <span className="fader-tip mono">{display}</span>}
      </div>
      {label && <span className="fader-label">{label}</span>}
    </div>
  );
}
