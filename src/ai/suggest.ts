import { engine } from '../audio/engine';
import { useAI } from '../state/ai';
import { useDecks } from '../state/decks';
import { useHistory } from '../state/history';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { prefetchDemo } from '../library/playback';
import { MIX_STYLES, recommend, type Suggestion } from './recommender';

/** The deck the AI should suggest "next" for: the master if playing, else any loaded deck. */
export function referenceDeck(): number | null {
  const { decks, master } = useDecks.getState();
  if (decks[master].trackId && decks[master].playing) return master;
  const playing = decks.findIndex((d) => d.playing && d.trackId);
  if (playing >= 0) return playing;
  if (decks[master].trackId) return master;
  const loaded = decks.findIndex((d) => d.trackId);
  return loaded >= 0 ? loaded : null;
}

export function computeSuggestions(refDeck = referenceDeck(), limit = 12): Suggestion[] {
  if (refDeck === null) return [];
  const { decks } = useDecks.getState();
  const d = decks[refDeck];
  const tracks = useLibrary.getState().tracks;
  const t = d.trackId ? tracks[d.trackId] : undefined;
  if (!t?.analysis) return [];
  const s = useSettings.getState();
  return recommend(
    { track: t, analysis: t.analysis, rate: d.tempo, keyLock: d.keyLock, keyShift: d.keyShift },
    Object.values(tracks),
    {
      vibe: s.vibe,
      weights: MIX_STYLES[s.mixStyle].weights,
      exclude: new Set(decks.map((x) => x.trackId).filter((x): x is string => !!x)),
      history: useHistory.getState().entries.map((e) => e.trackId),
      allowKeyShift: s.allowKeyShift,
      incomingKeyLock: s.defaultKeyLock,
      limit,
    },
  );
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastPrefetch = '';

function refresh(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const ref = referenceDeck();
    const suggestions = computeSuggestions(ref);
    useAI.getState().patch({ suggestions, refDeck: ref });
    const top = suggestions[0];
    if (top && engine.ctx && top.track.id !== lastPrefetch) {
      lastPrefetch = top.track.id;
      prefetchDemo(top.track, engine.ctx.sampleRate);
    }
  }, 250);
}

export function startSuggestionService(): void {
  useDecks.subscribe((s, p) => {
    const changed =
      s.master !== p.master ||
      s.decks.some(
        (d, i) =>
          d.trackId !== p.decks[i].trackId ||
          d.playing !== p.decks[i].playing ||
          Math.abs(d.tempo - p.decks[i].tempo) > 0.004 ||
          d.keyShift !== p.decks[i].keyShift,
      );
    if (changed) refresh();
  });
  useLibrary.subscribe((s, p) => {
    if (s.tracks !== p.tracks) refresh();
  });
  useSettings.subscribe((s, p) => {
    if (s.vibe !== p.vibe || s.mixStyle !== p.mixStyle || s.allowKeyShift !== p.allowKeyShift) refresh();
  });
  useHistory.subscribe(() => refresh());
  refresh();
}
