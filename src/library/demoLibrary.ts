import type { TrackRecord } from '../types';
import { DEMO_RECIPES } from './demo/recipes';

/** Library entries for the built-in demo crate (audio is synthesised on demand). */
export function demoTrackRecords(): TrackRecord[] {
  const now = Date.now();
  return DEMO_RECIPES.map((r, i) => {
    // Bars in the arrangement are fixed per style; duration is filled in by analysis.
    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      genre: r.genre,
      duration: 0,
      source: { kind: 'demo', recipeId: r.id },
      addedAt: now + i,
      playCount: 0,
    } satisfies TrackRecord;
  });
}

export function demoColor(recipeId: string): string {
  return DEMO_RECIPES.find((r) => r.id === recipeId)?.color ?? '#7c3aed';
}
