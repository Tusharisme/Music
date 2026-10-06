import type { MusicalKey } from '../types';
import { keyHue, keyLabel } from '../music/keys';
import { useSettings } from '../state/settings';

export function KeyBadge({
  k,
  shifted = false,
  className = '',
  small = false,
}: {
  k: MusicalKey | null | undefined;
  shifted?: boolean;
  className?: string;
  small?: boolean;
}) {
  const notation = useSettings((s) => s.keyNotation);
  if (!k) return <span className={`key-badge is-empty ${small ? 'is-small' : ''} ${className}`}>—</span>;
  const hue = keyHue(k);
  return (
    <span
      className={`key-badge ${shifted ? 'is-shifted' : ''} ${small ? 'is-small' : ''} ${className}`}
      style={{ ['--hue' as string]: hue }}
      title={`${keyLabel(k, 'musical')} · ${keyLabel(k, 'camelot')} · ${keyLabel(k, 'openkey')}${shifted ? ' (shifted)' : ''}`}
    >
      {keyLabel(k, notation)}
    </span>
  );
}

export function EnergyMeter({ value, className = '' }: { value: number | undefined; className?: string }) {
  const v = Math.max(0, Math.min(10, value ?? 0));
  return (
    <span className={`energy ${className}`} title={`Energy ${v}/10`} aria-label={`Energy ${v} of 10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={v >= (i + 1) * 2 ? 'on' : v >= i * 2 + 1 ? 'half' : ''} />
      ))}
      <b className="mono">{v || '–'}</b>
    </span>
  );
}
