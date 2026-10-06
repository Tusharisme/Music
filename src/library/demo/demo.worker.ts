/// <reference lib="webworker" />
import { renderDemo } from './generate';
import { DEMO_RECIPES } from './recipes';
import { floatToInt16 } from '../../audio/dsp/pcm';

export interface DemoRenderRequest {
  id: string;
  recipeId: string;
  sampleRate: number;
}

export type DemoRenderResponse =
  | { id: string; ok: true; L: Int16Array; R: Int16Array; sampleRate: number; duration: number }
  | { id: string; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<DemoRenderRequest>) => {
  const { id, recipeId, sampleRate } = e.data;
  try {
    const recipe = DEMO_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) throw new Error(`Unknown demo track ${recipeId}`);
    const d = renderDemo(recipe, sampleRate);
    const L = floatToInt16(d.L);
    const R = floatToInt16(d.R);
    const msg: DemoRenderResponse = { id, ok: true, L, R, sampleRate: d.sampleRate, duration: d.duration };
    ctx.postMessage(msg, [L.buffer, R.buffer]);
  } catch (err) {
    const msg: DemoRenderResponse = { id, ok: false, error: (err as Error).message ?? String(err) };
    ctx.postMessage(msg);
  }
};
