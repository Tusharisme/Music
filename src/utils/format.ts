export function fmtTime(sec: number, showMs = false): string {
  if (!Number.isFinite(sec)) return '0:00';
  const neg = sec < 0;
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const base = `${neg ? '-' : ''}${m}:${String(r).padStart(2, '0')}`;
  return showMs ? `${base}.${Math.floor((s % 1) * 10)}` : base;
}

export function fmtBpm(bpm: number): string {
  return bpm > 0 ? bpm.toFixed(1) : '--.-';
}

export function fmtPct(rate: number): string {
  const p = (rate - 1) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(Math.abs(p) < 10 ? 2 : 1)}%`;
}

export function fmtBeats(b: number): string {
  if (b >= 1) return String(b);
  const map: Record<string, string> = {
    '0.5': '½',
    '0.25': '¼',
    '0.125': '⅛',
    '0.0625': '1/16',
    '0.03125': '1/32',
    '0.75': '¾',
  };
  return map[String(b)] ?? b.toFixed(2);
}
