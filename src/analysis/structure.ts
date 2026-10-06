import type { TrackStructure, WaveformData } from '../types';

export interface GridInput {
  bpm: number;
  /** A beat time in [0, beatSec). */
  phase: number;
  duration: number;
}

/** Average of a 150 pps waveform channel between two times. */
function avg(arr: Uint8Array, pps: number, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 * pps));
  const b = Math.min(arr.length, Math.ceil(t1 * pps));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += arr[i];
  return s / (b - a) / 255;
}

/** Per-beat band levels (from the waveform data) – shared by downbeat & structure analysis. */
export function beatEnergies(
  wf: WaveformData,
  g: GridInput,
): { low: number[]; mid: number[]; high: number[] } {
  const beat = 60 / g.bpm;
  const low: number[] = [];
  const mid: number[] = [];
  const high: number[] = [];
  for (let t = g.phase; t < g.duration; t += beat) {
    low.push(avg(wf.low, wf.pointsPerSecond, t, t + beat));
    mid.push(avg(wf.mid, wf.pointsPerSecond, t, t + beat));
    high.push(avg(wf.high, wf.pointsPerSecond, t, t + beat));
  }
  return { low, mid, high };
}

/**
 * Which beat of the bar is "1"? Arrangement changes (elements entering/leaving)
 * happen on bar lines, so 4-beat windows aligned to the true downbeat change in
 * sharp steps while misaligned windows smear each change over two steps. We pick
 * the alignment with the largest sum of squared window-to-window changes, with a
 * bonus for the first audible beat (DJ tracks start on a downbeat).
 */
export function findDownbeat(e: { low: number[]; mid: number[]; high: number[] }): number {
  const n = e.low.length;
  if (n < 12) return 0;
  const bands = [e.low, e.mid, e.high].map((b) => {
    const mx = Math.max(1e-6, ...b);
    return b.map((v) => v / mx);
  });
  const score = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    for (const b of bands) {
      let prev: number | null = null;
      for (let s = k; s + 4 <= n; s += 4) {
        const m = (b[s] + b[s + 1] + b[s + 2] + b[s + 3]) / 4;
        if (prev !== null) score[k] += (m - prev) ** 2;
        prev = m;
      }
    }
  }
  const comb = bands[0].map((v, i) => v + bands[1][i] + bands[2][i]);
  const sorted = [...comb].sort((a, b) => a - b);
  const med = sorted[Math.floor(n / 2)] || 0;
  const first = comb.findIndex((v) => v > med * 0.25);
  const max = Math.max(...score);
  if (first >= 0) score[first % 4] += max * 0.25 + 1e-9;
  let best = 0;
  for (let k = 1; k < 4; k++) if (score[k] > score[best]) best = k;
  return best;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

export interface StructureResult {
  barEnergy: number[];
  structure: TrackStructure;
}

/** Phrase-level structure (8-bar phrases) and DJ mix points. */
export function analyzeStructure(
  wf: WaveformData,
  bpm: number,
  firstBeat: number,
  duration: number,
): StructureResult {
  // (firstBeat is re-anchored to the earliest bar line below)
  const pps = wf.pointsPerSecond;
  const bar = (60 / bpm) * 4;
  // Start at the earliest bar line ≥ ~0 so a grid anchor one bar in doesn't skip the intro.
  let start = firstBeat;
  while (start - bar > -0.05) start -= bar;
  firstBeat = start;
  const rawL: number[] = [];
  const rawM: number[] = [];
  const rawH: number[] = [];
  for (let t = Math.max(0, firstBeat); t + bar * 0.5 < duration; t += bar) {
    rawL.push(avg(wf.low, pps, t, t + bar));
    rawM.push(avg(wf.mid, pps, t, t + bar));
    rawH.push(avg(wf.high, pps, t, t + bar));
  }
  // Normalise each band by its "full arrangement" level so quiet bands (hats) count as much as loud ones (kick).
  const ref = (a: number[]) => Math.max(1e-6, percentile(a, 0.85));
  const nl = ref(rawL);
  const nm = ref(rawM);
  const nh = ref(rawH);
  const barFull = rawL.map(
    (l, i) => (Math.min(1.2, l / nl) + Math.min(1.2, rawM[i] / nm) + Math.min(1.2, rawH[i] / nh)) / 3,
  );
  const barLow = rawL.map((l) => l / nl);
  const nBars = barFull.length;
  const loud = rawL.map((l, i) => l + rawM[i] + rawH[i]);
  const peakBar = Math.max(1e-6, ...barFull);
  const peakLoud = Math.max(1e-6, ...loud);
  const barEnergy = loud.map((v) => Math.round((v / peakLoud) * 1000) / 1000);
  const timeOfBar = (b: number) => firstBeat + b * bar;

  const empty: TrackStructure = {
    mixIn: Math.max(0, firstBeat),
    introEnd: Math.max(0, firstBeat),
    mixOut: Math.max(0, duration - Math.min(duration * 0.25, bar * 16)),
    mainDrop: null,
    sections: [],
  };
  if (nBars < 8) return { barEnergy, structure: empty };

  const mainE = percentile(barFull, 0.75);
  const mainLow = percentile(barLow, 0.75);
  const PH = 8;
  const nPhrases = Math.ceil(nBars / PH);
  const phraseE: number[] = [];
  const phraseLow: number[] = [];
  for (let p = 0; p < nPhrases; p++) {
    const a = p * PH;
    const b = Math.min(nBars, a + PH);
    let e = 0;
    let l = 0;
    for (let i = a; i < b; i++) {
      e += barFull[i];
      l += barLow[i];
    }
    phraseE.push(e / (b - a));
    phraseLow.push(l / (b - a));
  }

  const isFull = (p: number) => phraseE[p] >= mainE * 0.86 && phraseLow[p] >= mainLow * 0.7;
  let firstFull = 0;
  while (firstFull < nPhrases && !isFull(firstFull)) firstFull++;
  if (firstFull >= nPhrases) firstFull = 0;
  let lastFull = nPhrases - 1;
  while (lastFull > 0 && !isFull(lastFull)) lastFull--;

  // First bar with audible content = mix-in point (bar 1 of the intro).
  let firstAudible = 0;
  while (firstAudible < nBars && barFull[firstAudible] < mainE * 0.08) firstAudible++;
  if (firstAudible >= nBars) firstAudible = 0;

  const sections: TrackStructure['sections'] = [];
  let mainDrop: number | null = null;
  let bestRise = 0.12 * mainE;
  for (let p = 0; p < nPhrases; p++) {
    let label: TrackStructure['sections'][number]['label'];
    if (p < firstFull) label = 'intro';
    else if (p > lastFull) label = 'outro';
    else if (phraseLow[p] < mainLow * 0.45) label = 'breakdown';
    else if (p > 0 && sections[p - 1]?.label === 'breakdown') label = 'drop';
    else label = 'main';
    if (
      label === 'breakdown' &&
      p + 1 <= lastFull &&
      phraseE[p] < phraseE[p + 1] &&
      p > 0 &&
      sections[p - 1]?.label === 'breakdown'
    ) {
      label = 'build';
    }
    sections.push({
      time: timeOfBar(p * PH),
      energy: Math.round((phraseE[p] / peakBar) * 1000) / 1000,
      label,
    });
    if (p > 0) {
      const rise = phraseE[p] - phraseE[p - 1];
      if (rise > bestRise && phraseE[p] >= mainE * 0.85 && p * PH >= 8) {
        bestRise = rise;
        mainDrop = timeOfBar(p * PH);
      }
    }
  }

  const mixIn = timeOfBar(firstAudible);
  const introEnd = timeOfBar(Math.max(firstAudible, firstFull * PH));
  const outroStartBar = (lastFull + 1) * PH;
  const barsAfterOutro = nBars - outroStartBar;
  let mixOutBar: number;
  if (outroStartBar < nBars && barsAfterOutro >= 8) mixOutBar = outroStartBar;
  else mixOutBar = Math.max(firstFull * PH + PH, Math.floor((nBars - 16) / PH) * PH);
  mixOutBar = Math.min(mixOutBar, Math.max(0, nBars - 4));

  return {
    barEnergy,
    structure: {
      mixIn,
      introEnd,
      mixOut: timeOfBar(mixOutBar),
      mainDrop,
      sections,
    },
  };
}
