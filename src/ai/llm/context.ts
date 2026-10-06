import type { TrackRecord } from '../../types';
import { camelotLabel, musicalLabel } from '../../music/keys';
import { useDecks } from '../../state/decks';
import { useLibrary } from '../../state/library';
import { useHistory } from '../../state/history';
import { useAI } from '../../state/ai';
import { useSettings } from '../../state/settings';
import { engine } from '../../audio/engine';
import { effectiveKey } from '../harmonic';
import { trackBpm, trackKey, VIBES } from '../recommender';
import type { DjContext, TrackSummary } from './schema';

export function summarizeTrack(t: TrackRecord): TrackSummary | null {
  const a = t.analysis;
  if (!a) return null;
  const key = trackKey(t) ?? a.key;
  const bar = (60 / (trackBpm(t) || 120)) * 4;
  return {
    id: t.id,
    title: t.title.slice(0, 200),
    artist: t.artist.slice(0, 200),
    genre: t.genre?.slice(0, 80) ?? null,
    bpm: Math.round(trackBpm(t) * 10) / 10,
    key: camelotLabel(key),
    keyName: musicalLabel(key),
    energy: a.energy,
    durationSec: Math.round(a.duration),
    mood: a.mood.slice(0, 6),
    introBars: Math.round((a.structure.introEnd - a.structure.mixIn) / bar),
    outroBars: Math.round((a.duration - a.structure.mixOut) / bar),
  };
}

/** Snapshot of the DJ's situation for the AI copilot (library capped to the most relevant 300 tracks). */
export function buildContext(): DjContext {
  const { decks, master } = useDecks.getState();
  const tracks = useLibrary.getState().tracks;
  const ai = useAI.getState();
  const loadedIds = new Set(decks.map((d) => d.trackId));
  const suggestedIds = new Set(ai.suggestions.map((s) => s.track.id));
  const all = Object.values(tracks).filter((t) => t.analysis);
  all.sort(
    (a, b) =>
      Number(loadedIds.has(b.id) || suggestedIds.has(b.id)) -
        Number(loadedIds.has(a.id) || suggestedIds.has(a.id)) ||
      (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0),
  );
  const library = all
    .slice(0, 300)
    .map(summarizeTrack)
    .filter((x): x is TrackSummary => !!x);
  return {
    decks: decks.map((d, i) => {
      const t = d.trackId ? tracks[d.trackId] : undefined;
      const summary = t ? summarizeTrack(t) : null;
      const pos = engine.transport.position(i);
      const key = t?.analysis
        ? effectiveKey(trackKey(t) ?? t.analysis.key, d.tempo, d.keyLock, d.keyShift)
        : null;
      return {
        deck: i === 0 ? ('A' as const) : ('B' as const),
        playing: d.playing,
        isMaster: master === i,
        track: summary,
        positionSec: Math.round(pos),
        remainingSec: Math.max(0, Math.round((d.duration || 0) - pos)),
        effectiveBpm: Math.round(d.bpm * d.tempo * 10) / 10,
        effectiveKey: key ? camelotLabel(key) : '-',
        tempoPct: Math.round((d.tempo - 1) * 1000) / 10,
      };
    }),
    library,
    localSuggestions: ai.suggestions
      .slice(0, 10)
      .map((s) => ({ id: s.track.id, score: s.score, reasons: [...s.reasons, ...s.warnings].slice(0, 8) })),
    history: useHistory
      .getState()
      .entries.slice(-12)
      .map((e) => ({ title: e.title, artist: e.artist })),
    vibe: VIBES.find((v) => v.id === useSettings.getState().vibe)?.label ?? 'Auto',
  };
}
