/// <reference lib="webworker" />
import { analyzeTrack, type AnalyzeOptions, type AnalyzeResult } from './analyze';
import { renderDemo } from '../library/demo/generate';
import { DEMO_RECIPES } from '../library/demo/recipes';

export type AnalyzeRequest =
  | { id: string; kind: 'pcm'; channels: Float32Array[]; sampleRate: number; options: AnalyzeOptions }
  | { id: string; kind: 'demo'; recipeId: string; options: AnalyzeOptions };

export type AnalyzeResponse =
  { id: string; ok: true; result: AnalyzeResult } | { id: string; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const ANALYSIS_RATE = 22050;

ctx.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const req = e.data;
  try {
    let mono: Float32Array;
    let sampleRate: number;
    let channels = 2;
    let options = req.options;
    if (req.kind === 'demo') {
      const recipe = DEMO_RECIPES.find((r) => r.id === req.recipeId);
      if (!recipe) throw new Error(`Unknown demo track ${req.recipeId}`);
      const d = renderDemo(recipe, ANALYSIS_RATE);
      mono = new Float32Array(d.L.length);
      for (let i = 0; i < mono.length; i++) mono[i] = (d.L[i] + d.R[i]) * 0.5;
      sampleRate = ANALYSIS_RATE;
      options = {
        ...options,
        known: { bpm: recipe.bpm, firstBeat: d.firstBeat, key: recipe.key, energy: recipe.energy },
      };
    } else {
      sampleRate = req.sampleRate;
      channels = req.channels.length;
      const len = req.channels[0]?.length ?? 0;
      if (channels === 1) mono = req.channels[0];
      else {
        mono = new Float32Array(len);
        const k = 1 / channels;
        for (const ch of req.channels) for (let i = 0; i < len; i++) mono[i] += ch[i] * k;
      }
    }
    const result = analyzeTrack(mono, sampleRate, { ...options, channels });
    const w = result.waveform;
    const msg: AnalyzeResponse = { id: req.id, ok: true, result };
    ctx.postMessage(msg, [w.peak.buffer, w.low.buffer, w.mid.buffer, w.high.buffer]);
  } catch (err) {
    const msg: AnalyzeResponse = { id: req.id, ok: false, error: (err as Error).message ?? String(err) };
    ctx.postMessage(msg);
  }
};
