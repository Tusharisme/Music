import { useRef, type ReactNode, type PointerEvent } from 'react';

export interface BtnProps {
  children?: ReactNode;
  /** Fires on press (pointer down) for tight timing. */
  onPress?: (e: { shiftKey: boolean }) => void;
  onRelease?: () => void;
  onLongPress?: () => void;
  active?: boolean;
  variant?: 'default' | 'primary' | 'accent' | 'ghost' | 'pad' | 'danger' | 'ai';
  size?: 's' | 'm' | 'l';
  className?: string;
  title?: string;
  disabled?: boolean;
  midi?: string;
  color?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
}

/** Pointer-down button (DJ controls must react on press, not on release). */
export function Btn({
  children,
  onPress,
  onRelease,
  onLongPress,
  active,
  variant = 'default',
  size = 'm',
  className = '',
  title,
  disabled,
  midi,
  color,
  style,
  ...rest
}: BtnProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const down = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    down.current = true;
    long.current = false;
    if (onLongPress) {
      timer.current = setTimeout(() => {
        long.current = true;
        onLongPress();
      }, 550);
    }
    if (!onLongPress) onPress?.({ shiftKey: e.shiftKey });
  };

  const finish = (fire: boolean, shiftKey = false) => {
    if (!down.current) return;
    down.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (onLongPress && fire && !long.current) onPress?.({ shiftKey });
    onRelease?.();
  };

  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${active ? 'is-on' : ''} ${className}`}
      title={title}
      disabled={disabled}
      data-midi={midi}
      style={color ? { ...style, ['--pad' as string]: color } : style}
      aria-pressed={active === undefined ? undefined : active}
      aria-label={rest['aria-label']}
      onPointerDown={onPointerDown}
      onPointerUp={(e) => finish(true, e.shiftKey)}
      onPointerCancel={() => finish(false)}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress();
        }
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          onPress?.({ shiftKey: e.shiftKey });
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onRelease?.();
      }}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className = '',
  size = 's',
  label,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 's' | 'm';
  label?: string;
}) {
  return (
    <div className={`segmented seg-${size} ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  on,
  onChange,
  label,
  className = '',
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <label className={`switch ${on ? 'is-on' : ''} ${className}`}>
      <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
        <span />
      </button>
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}
