import { useRef } from 'react';
import { useRaf } from '../../hooks/useRaf';

const buf = new Float32Array(1024);

function level(an: AnalyserNode | null | undefined): number {
  if (!an) return 0;
  an.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > peak) peak = v;
  }
  const db = 20 * Math.log10(peak + 1e-9);
  return Math.max(0, Math.min(1, (db + 48) / 51));
}

/** LED-style peak meter fed by AnalyserNodes (one per channel). */
export function VUMeter({
  get,
  channels = 1,
  className = '',
}: {
  get: () => (AnalyserNode | null | undefined)[];
  channels?: number;
  className?: string;
}) {
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  const holds = useRef<(HTMLDivElement | null)[]>([]);
  const state = useRef(Array.from({ length: channels }, () => ({ v: 0, hold: 0, holdT: 0 })));
  useRaf((t) => {
    const ans = get();
    for (let c = 0; c < channels; c++) {
      const s = state.current[c];
      const l = level(ans[c]);
      s.v = l > s.v ? l : Math.max(l, s.v - 0.018);
      if (l >= s.hold || t - s.holdT > 1200) {
        s.hold = l;
        s.holdT = t;
      }
      const bar = bars.current[c];
      if (bar) bar.style.clipPath = `inset(${(1 - s.v) * 100}% 0 0 0)`;
      const h = holds.current[c];
      if (h) {
        h.style.bottom = `${s.hold * 100}%`;
        h.style.opacity = s.hold > 0.02 ? '1' : '0';
        h.classList.toggle('is-clip', s.hold > 0.94);
      }
    }
  });
  return (
    <div className={`vu ${className}`} aria-hidden>
      {Array.from({ length: channels }, (_, c) => (
        <div className="vu-ch" key={c}>
          <div className="vu-bg" />
          <div className="vu-bar" ref={(el) => void (bars.current[c] = el)} />
          <div className="vu-hold" ref={(el) => void (holds.current[c] = el)} />
        </div>
      ))}
    </div>
  );
}
