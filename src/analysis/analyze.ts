import type { MusicalKey, TrackAnalysis, WaveformData } from '../types';
import { spectralAnalysis } from './spectral';
import { estimateBeatPhase, estimateTempo } from './tempo';
import { detectKey } from './key';
import { integratedLoudness } from './loudness';
import { computeWaveform } from './waveform';
import { analyzeStructure, beatEnergies, findDownbeat } from './structure';
import { computeFeatures } from './features';

/** Bump when analysis output changes so stored tracks get re-analysed. */
export const ANALYSIS_VERSION = 1;

export interface AnalyzeOptions {
  minBpm?: number;
  maxBpm?: number;
  /** BPM from file tags (refined, not trusted blindly). */
  hintBpm?: number;
  /** Key from file tags (trusted). */
  hintKey?: MusicalKey | null;
  /** Ground truth for generated demo tracks. */
  known?: { bpm: number; firstBeat: number; key: MusicalKey; energy?: number };
  /** How many channels the mono signal was mixed from. */
  channels?: number;
}

export interface AnalyzeResult {
  analysis: TrackAnalysis;
  waveform: WaveformData;
}

export function analyzeTrack(mono: Float32Array, sr: number, opts: AnalyzeOptions = {}): AnalyzeResult {
  const duration = mono.length / sr;
  const sp = spectralAnalysis(mono, sr);
  const waveform = computeWaveform(mono, sr);

  let bpm: number;
  let bpmConfidence: number;
  let firstBeat: number;
  if (opts.known) {
    bpm = opts.known.bpm;
    bpmConfidence = 1;
    firstBeat = opts.known.firstBeat;
  } else {
    const t = estimateTempo(sp, { minBpm: opts.minBpm, maxBpm: opts.maxBpm, hint: opts.hintBpm });
    bpm = t.bpm;
    bpmConfidence = t.confidence;
    const phase = estimateBeatPhase(mono, sr, bpm, sp);
    const be = beatEnergies(waveform, { bpm, phase, duration });
    const k = findDownbeat(be);
    firstBeat = phase + k * (60 / bpm);
    // Prefer the earliest downbeat (allowing a few ms before 0 for tracks that start on the beat).
    const barSec = (60 / bpm) * 4;
    while (firstBeat - barSec > -0.05) firstBeat -= barSec;
  }

  const loudness = integratedLoudness(mono, sr, opts.channels ?? 2);
  let key: MusicalKey;
  let keyConfidence: number;
  if (opts.known) {
    key = opts.known.key;
    keyConfidence = 1;
  } else if (opts.hintKey) {
    key = opts.hintKey;
    keyConfidence = 0.9;
  } else {
    const k = detectKey(mono, sr, { bpm, firstBeat });
    key = k.key;
    keyConfidence = k.confidence;
  }

  const { barEnergy, structure } = analyzeStructure(waveform, bpm, firstBeat, duration);
  const feats = computeFeatures({ sp, bpm, bpmConfidence, loudness, key });

  return {
    waveform,
    analysis: {
      version: ANALYSIS_VERSION,
      duration,
      beatgrid: { bpm, firstBeat },
      bpmConfidence: Math.round(bpmConfidence * 100) / 100,
      key,
      keyConfidence: Math.round(keyConfidence * 100) / 100,
      energy: opts.known?.energy ?? feats.energy,
      loudness: Math.round(loudness * 10) / 10,
      barEnergy,
      structure,
      timbre: feats.timbre,
      mood: feats.mood,
      danceability: feats.danceability,
    },
  };
}
