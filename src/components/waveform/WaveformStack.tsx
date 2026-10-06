import { useEffect, useRef, type PointerEvent, type WheelEvent } from 'react';
import { engine } from '../../audio/engine';
import { useDecks } from '../../state/decks';
import { getWaveform, useLibrary } from '../../state/library';
import { useSettings } from '../../state/settings';
import { useAI } from '../../state/ai';
import { useRaf } from '../../hooks/useRaf';
import { seek, bend } from '../../controller/decks';
import { AI_COLOR, CUE_COLOR, PALETTES } from './palette';
import type { WaveformData } from '../../types';

interface Lane {
  y: number;
  h: number;
}

function drawLane(
  c: CanvasRenderingContext2D,
  deck: number,
  lane: Lane,
  W: number,
  dpr: number,
  secondsVisible: number,
  style: string,
): void {
  const st = useDecks.getState();
  const d = st.decks[deck];
  const pal = PALETTES[deck];
  const { y, h } = lane;
  const mid = y + h / 2;
  c.fillStyle = '#080a16';
  c.fillRect(0, y, W, h);

  const tracks = useLibrary.getState().tracks;
  const t = d.trackId ? tracks[d.trackId] : undefined;
  const wf: WaveformData | undefined = d.trackId ? getWaveform(d.trackId) : undefined;
  const cx = W / 2;

  if (!t) {
    c.fillStyle = 'rgba(163,171,200,0.45)';
    c.font = `${12 * dpr}px Inter Variable, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`Deck ${deck === 0 ? 'A' : 'B'} – load or drop a track`, cx, mid);
    return;
  }

  const pos = engine.transport.position(deck);
  const rate = Math.max(0.25, d.tempo || 1);
  const secPerPx = (secondsVisible / W) * rate;
  const tAt = (x: number) => pos + (x - cx) * secPerPx;
  const xAt = (time: number) => cx + (time - pos) / secPerPx;

  // Loop region (under the waveform).
  if (d.loop.end > d.loop.start) {
    const x0 = xAt(d.loop.start);
    const x1 = xAt(d.loop.end);
    c.fillStyle = d.loop.on ? 'rgba(52, 211, 153, 0.16)' : 'rgba(148,163,255,0.07)';
    c.fillRect(x0, y, x1 - x0, h);
    c.fillStyle = d.loop.on ? 'rgba(52, 211, 153, 0.9)' : 'rgba(148,163,255,0.4)';
    c.fillRect(x0, y, 1.5 * dpr, h);
    c.fillRect(x1, y, 1.5 * dpr, h);
  }

  // AI transition span.
  const mix = useAI.getState().mix;
  if (mix.plan && mix.phase !== 'idle') {
    const beatSec = 60 / (d.bpm || 120);
    let a: number;
    let b: number;
    if (deck === mix.outDeck) {
      a = mix.plan.outSwitch + mix.plan.startBeat * beatSec;
      b = mix.plan.outSwitch + mix.plan.endBeat * beatSec;
    } else {
      a = mix.plan.inStart + mix.plan.startBeat * beatSec;
      b = mix.plan.inStart + mix.plan.endBeat * beatSec;
    }
    const x0 = xAt(a);
    const x1 = xAt(b);
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(167,139,250,0.05)');
    g.addColorStop(0.5, 'rgba(167,139,250,0.16)');
    g.addColorStop(1, 'rgba(34,211,238,0.06)');
    c.fillStyle = g;
    c.fillRect(x0, y, x1 - x0, h);
    const sw = xAt(deck === mix.outDeck ? mix.plan.outSwitch : mix.plan.inStart);
    c.fillStyle = AI_COLOR;
    c.fillRect(sw - dpr, y, 2 * dpr, h);
  }

  // Waveform columns.
  if (wf) {
    const pps = wf.pointsPerSecond;
    const n = wf.peak.length;
    const half = h / 2 - 2 * dpr;
    const cols = Math.ceil(W);
    const lo = new Float32Array(cols);
    const md = new Float32Array(cols);
    const hi = new Float32Array(cols);
    for (let x = 0; x < cols; x++) {
      const a = tAt(x) * pps;
      const b = tAt(x + 1) * pps;
      let i0 = Math.floor(a);
      let i1 = Math.max(i0 + 1, Math.floor(b));
      if (i1 <= 0 || i0 >= n) continue;
      i0 = Math.max(0, i0);
      i1 = Math.min(n, i1);
      let l = 0;
      let m = 0;
      let hh = 0;
      for (let i = i0; i < i1; i++) {
        if (wf.low[i] > l) l = wf.low[i];
        if (wf.mid[i] > m) m = wf.mid[i];
        if (wf.high[i] > hh) hh = wf.high[i];
      }
      lo[x] = l / 255;
      md[x] = m / 255;
      hi[x] = hh / 255;
    }
    const played = cx;
    if (style === 'rgb') {
      for (let x = 0; x < cols; x++) {
        const amp = Math.max(lo[x], md[x], hi[x]);
        if (amp <= 0) continue;
        const r = Math.round(60 + 195 * lo[x]);
        const gg = Math.round(40 + 215 * md[x]);
        const bb = Math.round(80 + 175 * hi[x]);
        c.fillStyle = `rgba(${r},${gg},${bb},${x < played ? 0.55 : 0.95})`;
        const hgt = amp * half;
        c.fillRect(x, mid - hgt, 1, hgt * 2);
      }
    } else {
      const layers: [Float32Array, string, number][] = [
        [lo, pal.low, 1],
        [md, pal.mid, 0.82],
        [hi, pal.high, 0.55],
      ];
      for (const [arr, color, scale] of layers) {
        c.fillStyle = color;
        for (let x = 0; x < cols; x++) {
          const v = arr[x];
          if (v <= 0.004) continue;
          const hgt = v * half * scale;
          c.fillRect(x, mid - hgt, 1, hgt * 2);
        }
      }
      // Dim what has already played.
      c.fillStyle = 'rgba(8,10,22,0.38)';
      c.fillRect(0, y, played, h);
    }
  } else {
    c.fillStyle = 'rgba(163,171,200,0.35)';
    c.font = `${11 * dpr}px Inter Variable, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('Analysing waveform…', cx, mid);
  }

  // Beat grid.
  if (d.bpm > 0) {
    const beat = 60 / d.bpm;
    const tStart = tAt(0);
    const tEnd = tAt(W);
    const k0 = Math.ceil((tStart - d.firstBeat) / beat);
    const k1 = Math.floor((tEnd - d.firstBeat) / beat);
    const pxPerBeat = beat / secPerPx;
    for (let k = k0; k <= k1; k++) {
      const x = xAt(d.firstBeat + k * beat);
      const isBar = ((k % 4) + 4) % 4 === 0;
      const isPhrase = ((k % 32) + 32) % 32 === 0;
      if (!isBar && pxPerBeat < 6 * dpr) continue;
      c.fillStyle = isPhrase
        ? 'rgba(255,255,255,0.55)'
        : isBar
          ? 'rgba(255,255,255,0.28)'
          : 'rgba(255,255,255,0.1)';
      c.fillRect(Math.round(x), y, isPhrase ? 2 * dpr : dpr, isBar ? h : h * 0.18);
      if (!isBar) c.fillRect(Math.round(x), y + h * 0.82, dpr, h * 0.18);
      if (isBar && pxPerBeat * 4 > 28 * dpr && k >= 0) {
        c.fillStyle = isPhrase ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
        c.font = `${(isPhrase ? 10 : 9) * dpr}px JetBrains Mono Variable, monospace`;
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText(String(k / 4 + 1), x + 3 * dpr, y + 2 * dpr);
      }
    }
  }

  // Structure markers from the analysis (AI cue points).
  const s = t.analysis?.structure;
  if (s) {
    const marks: [number, string, string][] = [
      [s.mixIn, 'MIX IN', '#34d399'],
      [s.mixOut, 'MIX OUT', AI_COLOR],
    ];
    if (s.mainDrop !== null) marks.push([s.mainDrop, 'DROP', '#f87171']);
    c.font = `600 ${9 * dpr}px Inter Variable, system-ui, sans-serif`;
    c.textBaseline = 'bottom';
    for (const [time, label, color] of marks) {
      const x = xAt(time);
      if (x < -60 * dpr || x > W + 10) continue;
      c.fillStyle = color;
      c.fillRect(x, y + h - 14 * dpr, 1.5 * dpr, 14 * dpr);
      const tw = c.measureText(label).width + 8 * dpr;
      c.globalAlpha = 0.9;
      c.fillRect(x, y + h - 14 * dpr, tw, 12 * dpr);
      c.globalAlpha = 1;
      c.fillStyle = '#07080f';
      c.textAlign = 'left';
      c.fillText(label, x + 4 * dpr, y + h - 3 * dpr);
    }
  }

  // Cue + hot cues.
  const triangle = (x: number, color: string, top: boolean) => {
    c.fillStyle = color;
    c.beginPath();
    const s0 = 6 * dpr;
    if (top) {
      c.moveTo(x - s0, y);
      c.lineTo(x + s0, y);
      c.lineTo(x, y + s0 * 1.2);
    } else {
      c.moveTo(x - s0, y + h);
      c.lineTo(x + s0, y + h);
      c.lineTo(x, y + h - s0 * 1.2);
    }
    c.fill();
  };
  triangle(xAt(d.cue), CUE_COLOR, true);
  d.hotCues.forEach((hc, i) => {
    if (!hc) return;
    const x = xAt(hc.time);
    if (x < -20 || x > W + 20) return;
    c.fillStyle = hc.color;
    c.fillRect(x, y, 1.5 * dpr, h);
    c.fillRect(x, y, 13 * dpr, 13 * dpr);
    c.fillStyle = '#07080f';
    c.font = `700 ${9 * dpr}px Inter Variable, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(i + 1), x + 6.5 * dpr, y + 7 * dpr);
  });

  // Playhead.
  c.fillStyle = 'rgba(255,255,255,0.95)';
  c.fillRect(cx - dpr, y, 2 * dpr, h);
  c.fillStyle = pal.accent;
  c.globalAlpha = 0.35;
  c.fillRect(cx - 3 * dpr, y, 6 * dpr, h);
  c.globalAlpha = 1;
}

/** Both decks' zoomed, scrolling waveforms in one canvas (beats line up when synced). */
export function WaveformStack({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const drag = useRef<{ deck: number; x: number; t: number; playing: boolean; pos: number } | null>(null);
  const seconds = useSettings((s) => s.waveformSeconds);
  const style = useSettings((s) => s.waveformStyle);
  const setSettings = useSettings((s) => s.set);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), dpr };
      const cv = canvasRef.current!;
      cv.width = size.current.w;
      cv.height = size.current.h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useRaf(() => {
    const cv = canvasRef.current;
    const { w, h, dpr } = size.current;
    if (!cv || !w || !h) return;
    const c = cv.getContext('2d');
    if (!c) return;
    const gap = 3 * dpr;
    const laneH = (h - gap) / 2;
    c.clearRect(0, 0, w, h);
    drawLane(c, 0, { y: 0, h: laneH }, w, dpr, seconds, style);
    drawLane(c, 1, { y: laneH + gap, h: laneH }, w, dpr, seconds, style);
  });

  const laneAt = (e: PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return e.clientY - r.top < r.height / 2 ? 0 : 1;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const deck = laneAt(e);
    const d = useDecks.getState().decks[deck];
    if (!d.trackId) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      deck,
      x: e.clientX,
      t: performance.now(),
      playing: d.playing,
      pos: engine.transport.position(deck),
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const d = useDecks.getState().decks[g.deck];
    const secPerCss = (seconds / r.width) * Math.max(0.25, d.tempo);
    if (g.playing) {
      const now = performance.now();
      const dx = e.clientX - g.x;
      const v = (-dx * secPerCss) / Math.max(0.008, (now - g.t) / 1000);
      bend(g.deck, Math.max(-0.5, Math.min(0.5, v * 0.15)));
      g.x = e.clientX;
      g.t = now;
    } else {
      const dx = e.clientX - g.x;
      seek(g.deck, g.pos - dx * secPerCss);
    }
  };

  const onPointerUp = () => {
    const g = drag.current;
    if (g?.playing) bend(g.deck, 0);
    drag.current = null;
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const next = Math.max(2, Math.min(40, seconds * (e.deltaY > 0 ? 1.15 : 0.87)));
    setSettings({ waveformSeconds: Math.round(next * 10) / 10 });
  };

  return (
    <div className={`wave-stack ${compact ? 'is-compact' : ''}`}>
      <div
        ref={wrapRef}
        className="wave-canvas-wrap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        title="Drag to scrub (paused) or nudge (playing) · scroll to zoom"
      >
        <canvas ref={canvasRef} className="wave-canvas" />
      </div>
      <div className="wave-zoom">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setSettings({ waveformSeconds: Math.max(2, Math.round(seconds * 0.75 * 10) / 10) })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setSettings({ waveformSeconds: Math.min(40, Math.round(seconds * 1.33 * 10) / 10) })}
        >
          −
        </button>
      </div>
    </div>
  );
}
