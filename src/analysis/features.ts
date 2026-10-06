import type { MusicalKey } from '../types';
import type { SpectralResult } from './spectral';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Onsets per second from the onset strength envelope (peak picking). */
export function onsetRate(sp: SpectralResult): number {
  const env = sp.onset;
  const n = env.length;
  if (n < 3) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (env[i] - mean) ** 2;
  sd = Math.sqrt(sd / n);
  const thr = mean + 0.5 * sd;
  const minGap = Math.round(sp.fps * 0.06);
  let count = 0;
  let last = -minGap;
  for (let i = 1; i < n - 1; i++) {
    if (env[i] > thr && env[i] >= env[i - 1] && env[i] > env[i + 1] && i - last >= minGap) {
      count++;
      last = i;
    }
  }
  return count / (n / sp.fps);
}

export interface FeatureInput {
  sp: SpectralResult;
  bpm: number;
  bpmConfidence: number;
  loudness: number;
  key: MusicalKey;
}

export interface FeatureResult {
  energy: number;
  danceability: number;
  mood: string[];
  timbre: number[];
}

export function computeFeatures({ sp, bpm, bpmConfidence, loudness, key }: FeatureInput): FeatureResult {
  const rate = onsetRate(sp);
  const loud01 = clamp01((loudness + 22) / 16);
  const dens01 = clamp01((rate - 1) / 7);
  const bright01 = clamp01((sp.centroidMean - 900) / 2600);
  const tempo01 = clamp01((bpm - 80) / 90);
  const lowShare = (sp.bandProfile[0] ?? 0) + (sp.bandProfile[1] ?? 0);
  const e = 0.33 * loud01 + 0.24 * dens01 + 0.15 * bright01 + 0.22 * tempo01 + 0.06 * clamp01(lowShare * 1.5);
  const energy = Math.max(1, Math.min(10, Math.round(1 + e * 9)));
  const danceability = clamp01(
    0.25 + 0.45 * bpmConfidence + 0.2 * dens01 + (bpm >= 100 && bpm <= 135 ? 0.1 : 0),
  );

  const mood: string[] = [];
  const minor = key.mode === 'minor';
  if (energy >= 9) mood.push('peak-time');
  else if (energy >= 7) mood.push(bpm >= 124 ? 'driving' : 'energetic');
  else if (energy <= 3) mood.push('chill');
  else if (energy <= 5) mood.push('laid-back');
  if (minor && sp.centroidMean < 1900) mood.push('dark');
  else if (!minor && energy >= 6) mood.push('euphoric');
  else if (minor && energy <= 5) mood.push('melancholic');
  else if (!minor) mood.push('bright');
  if (sp.centroidMean < 1500 && bpm >= 112 && bpm <= 126) mood.push('deep');
  else if (danceability > 0.75 && bpm < 128) mood.push('groovy');

  const timbre = [
    ...sp.mfccMean,
    ...sp.mfccStd,
    ...sp.bandProfile,
    sp.centroidMean / 1000,
    sp.centroidStd / 1000,
    sp.flatnessMean * 10,
    rate / 4,
  ].map((v) => Math.round(v * 1e4) / 1e4);

  return { energy, danceability: Math.round(danceability * 100) / 100, mood: mood.slice(0, 3), timbre };
}
