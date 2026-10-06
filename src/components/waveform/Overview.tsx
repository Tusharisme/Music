import { useEffect, useRef, type PointerEvent } from 'react';
import { engine } from '../../audio/engine';
import { useDecks } from '../../state/decks';
import { getWaveform, useLibrary } from '../../state/library';
import { useRaf } from '../../hooks/useRaf';
import { seek } from '../../controller/decks';
import { AI_COLOR, CUE_COLOR, PALETTES } from './palette';
import type { WaveformData } from '../../types';

const SECTION_COLORS: Record<string, string> = {
  intro: '#2dd4bf',
  build: '#fbbf24',
  main: '#64748b',
  breakdown: '#818cf8',
  drop: '#f87171',
  outro: '#2dd4bf',
};

function prerender(wf: WaveformData, w: number, h: number, deck: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const pal = PALETTES[deck];
  const n = wf.peak.length;
  const mid = h / 2;
  const layers: [Uint8Array, string, number][] = [
    [wf.low, pal.low, 1],
    [wf.mid, pal.mid, 0.8],
    [wf.high, pal.high, 0.5],
  ];
  for (const [arr, color, scale] of layers) {
    c.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * n);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
      let m = 0;
      for (let i = i0; i < i1 && i < n; i++) if (arr[i] > m) m = arr[i];
      const hh = (m / 255) * (h / 2 - 1) * scale;
      c.fillRect(x, mid - hh, 1, hh * 2);
    }
  }
  return cv;
}

/** Whole-track overview with playhead, markers and song sections. Click/drag to seek. */
export function Overview({ deck }: { deck: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cache = useRef<{ key: string; img: HTMLCanvasElement | null }>({ key: '', img: null });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dragging = useRef(false);
  const trackId = useDecks((s) => s.decks[deck].trackId);
  const version = useLibrary((s) => s.waveformVersion);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), dpr };
      canvasRef.current!.width = size.current.w;
      canvasRef.current!.height = size.current.h;
      cache.current.key = '';
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    cache.current.key = '';
  }, [trackId, version]);

  useRaf(() => {
    const cv = canvasRef.current;
    const { w, h, dpr } = size.current;
    if (!cv || !w || !h) return;
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, w, h);
    const d = useDecks.getState().decks[deck];
    if (!d.trackId) return;
    const wf = getWaveform(d.trackId);
    const t = useLibrary.getState().tracks[d.trackId];
    const dur = d.duration || t?.analysis?.duration || t?.duration || 0;
    if (!dur) return;
    const stripH = 4 * dpr;
    const waveH = h - stripH - dpr;
    const key = `${d.trackId}:${w}:${h}:${wf ? 1 : 0}`;
    if (wf && cache.current.key !== key) cache.current = { key, img: prerender(wf, w, waveH, deck) };
    if (wf && cache.current.img) c.drawImage(cache.current.img, 0, 0);
    else {
      c.fillStyle = 'rgba(148,163,255,0.08)';
      c.fillRect(0, waveH / 2 - dpr, w, 2 * dpr);
    }
    const xAt = (time: number) => (time / dur) * w;

    // Song sections strip.
    const secs = t?.analysis?.structure.sections ?? [];
    secs.forEach((s, i) => {
      const x0 = xAt(s.time);
      const x1 = i + 1 < secs.length ? xAt(secs[i + 1].time) : w;
      c.fillStyle = SECTION_COLORS[s.label] ?? '#64748b';
      c.globalAlpha = 0.85;
      c.fillRect(x0, h - stripH, Math.max(1, x1 - x0 - dpr), stripH);
      c.globalAlpha = 1;
    });

    const pos = engine.transport.position(deck);
    const px = xAt(pos);
    c.fillStyle = 'rgba(6,7,13,0.55)';
    c.fillRect(0, 0, px, waveH);

    if (d.loop.end > d.loop.start) {
      c.fillStyle = d.loop.on ? 'rgba(52,211,153,0.35)' : 'rgba(148,163,255,0.2)';
      c.fillRect(xAt(d.loop.start), 0, Math.max(2 * dpr, xAt(d.loop.end) - xAt(d.loop.start)), waveH);
    }
    const s = t?.analysis?.structure;
    if (s) {
      c.fillStyle = AI_COLOR;
      c.fillRect(xAt(s.mixOut), 0, 1.5 * dpr, waveH);
    }
    c.fillStyle = CUE_COLOR;
    c.fillRect(xAt(d.cue) - dpr, 0, 2 * dpr, waveH * 0.5);
    d.hotCues.forEach((hc) => {
      if (!hc) return;
      c.fillStyle = hc.color;
      c.fillRect(xAt(hc.time) - dpr, 0, 2 * dpr, waveH * 0.35);
    });
    c.fillStyle = '#ffffff';
    c.fillRect(px - dpr, 0, 2 * dpr, h);
  });

  const toTime = (e: PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const d = useDecks.getState().decks[deck];
    return ((e.clientX - r.left) / r.width) * d.duration;
  };

  return (
    <div
      ref={wrapRef}
      className="overview"
      role="slider"
      aria-label={`Deck ${deck === 0 ? 'A' : 'B'} track position`}
      aria-valuenow={0}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (!trackId) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        seek(deck, toTime(e));
      }}
      onPointerMove={(e) => dragging.current && seek(deck, toTime(e))}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
