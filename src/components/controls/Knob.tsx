import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

export interface KnobProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  defaultValue?: number;
  label?: string;
  size?: number;
  bipolar?: boolean;
  /** Snap to this value when close (e.g. the centre of an EQ). */
  detent?: number;
  format?: (v: number) => string;
  className?: string;
  midi?: string;
  disabled?: boolean;
  title?: string;
}

const START = -135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

/** Rotary control: drag up/down (or sideways), wheel, arrow keys; double-click resets. */
export function Knob({
  value,
  onChange,
  min = 0,
  max = 1,
  defaultValue,
  label,
  size = 44,
  bipolar = false,
  detent,
  format,
  className = '',
  midi,
  disabled,
  title,
}: KnobProps) {
  const drag = useRef<{ x: number; y: number; v: number; id: number } | null>(null);
  const lastTap = useRef(0);
  const [active, setActive] = useState(false);
  const range = max - min;
  const reset = defaultValue ?? (bipolar ? (min + max) / 2 : min);

  const commit = useCallback(
    (v: number) => {
      let n = Math.max(min, Math.min(max, v));
      if (detent !== undefined && Math.abs(n - detent) < range * 0.025) n = detent;
      if (n !== value) onChange(n);
    },
    [min, max, detent, range, value, onChange],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastTap.current < 300) {
      onChange(reset);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, v: value, id: e.pointerId };
    setActive(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const px = d.y - e.clientY + (e.clientX - d.x) * 0.6;
    const fine = e.shiftKey ? 0.25 : 1;
    commit(d.v + (px / 160) * range * fine);
  };

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setActive(false);
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (disabled) return;
    commit(value - Math.sign(e.deltaY) * range * (e.shiftKey ? 0.01 : 0.04));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = range * (e.shiftKey ? 0.01 : 0.04);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') commit(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') commit(value - step);
    else if (e.key === 'Home') commit(min);
    else if (e.key === 'End') commit(max);
    else if (e.key === 'Enter' || e.key === '0') onChange(reset);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const t = (value - min) / range;
  const angle = START + t * SWEEP;
  const c = size / 2;
  const r = c - 4;
  const from = bipolar ? START + SWEEP / 2 : START;
  const display = format ? format(value) : `${Math.round(t * 100)}%`;

  return (
    <div
      className={`knob ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
      data-midi={midi}
    >
      <div
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={display}
        title={title ?? (label ? `${label}: ${display} (double-click to reset)` : undefined)}
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path d={arc(c, c, r, START, START + SWEEP)} className="knob-track" />
          <path d={arc(c, c, r, Math.min(from, angle), Math.max(from, angle))} className="knob-value" />
          <circle cx={c} cy={c} r={r - 5} className="knob-cap" />
          <line
            x1={polar(c, c, r - 14, angle)[0]}
            y1={polar(c, c, r - 14, angle)[1]}
            x2={polar(c, c, r - 5, angle)[0]}
            y2={polar(c, c, r - 5, angle)[1]}
            className="knob-pointer"
          />
        </svg>
        {active && <span className="knob-tip mono">{display}</span>}
      </div>
      {label && <span className="knob-label">{label}</span>}
    </div>
  );
}
