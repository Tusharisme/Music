import { engine } from '../audio/engine';
import { useAI, idleMix } from '../state/ai';
import { useDecks, deckState } from '../state/decks';
import { useLibrary } from '../state/library';
import { useMixer } from '../state/mixer';
import { useSettings } from '../state/settings';
import { useUI } from '../state/ui';
import { useHistory } from '../state/history';
import { loadTrack, play, position } from '../controller/decks';
import { autoMixer } from './automix';
import { computeSuggestions } from './suggest';
import { planTransition, type TechniqueId } from './transitions';
import type { TrackRecord } from '../types';

const toast = (t: string, k?: 'info' | 'success' | 'error') => useUI.getState().toast(t, k);

/** Plan and arm an AI transition from the playing (master) deck into `trackId`. */
export async function aiMix(
  trackId: string,
  opts: { when?: 'phrase' | 'now'; technique?: TechniqueId; onDone?: () => void } = {},
): Promise<boolean> {
  const { decks, master } = useDecks.getState();
  const out = decks[master].playing ? master : decks.findIndex((d) => d.playing);
  if (out < 0) {
    toast('Play a track first – the AI mixes from what is playing.', 'error');
    return false;
  }
  const inn = out === 0 ? 1 : 0;
  if (decks[inn].playing) {
    toast('Both decks are playing – stop one so the AI can use it.', 'error');
    return false;
  }
  const lib = useLibrary.getState().tracks;
  const outTrack = lib[decks[out].trackId!];
  const inTrack = lib[trackId];
  if (!outTrack?.analysis || !inTrack?.analysis) {
    toast('Still analysing – give it a moment.', 'error');
    return false;
  }
  const s = useSettings.getState();
  const makePlan = () => {
    const d = deckState(out);
    return planTransition({
      out: {
        track: outTrack,
        analysis: outTrack.analysis!,
        rate: d.tempo,
        pos: position(out),
        keyLock: d.keyLock,
        keyShift: d.keyShift,
      },
      incoming: { track: inTrack, analysis: inTrack.analysis! },
      when: opts.when ?? s.mixWhen,
      technique: opts.technique,
      allowKeyShift: s.allowKeyShift,
    });
  };
  let plan = makePlan();
  // Loading can take seconds (decoding / rendering), so load first and plan from where the
  // playing deck is afterwards – otherwise the chosen phrase may already be gone.
  if (deckState(inn).trackId !== trackId) {
    const ai = useAI.getState();
    ai.setMix({ phase: 'preparing', plan, outDeck: out, inDeck: inn, trackId, progress: -1 });
    const loaded = await loadTrack(inn, trackId, { startAt: plan.inStart });
    if (!loaded || !deckState(out).playing || useAI.getState().mix.trackId !== trackId) {
      if (useAI.getState().mix.trackId === trackId) ai.setMix(idleMix());
      return false;
    }
    plan = makePlan();
  }
  const ok = await autoMixer.start(plan, out, inn, trackId, opts.onDone);
  if (ok) toast(`AI mix armed: ${plan.summary}`, 'success');
  return ok;
}

function pickOpener(): TrackRecord | undefined {
  const tracks = Object.values(useLibrary.getState().tracks).filter((t) => t.analysis);
  const queue = useAI.getState().queue;
  const queued = queue.map((id) => useLibrary.getState().tracks[id]).find((t) => t?.analysis);
  if (queued) return queued;
  const played = new Set(useHistory.getState().entries.map((e) => e.trackId));
  const fresh = tracks.filter((t) => !played.has(t.id));
  const pool = fresh.length ? fresh : tracks;
  // Warm-up: start around the lower-middle of the library's energy range.
  pool.sort((a, b) => a.analysis!.energy - b.analysis!.energy);
  return pool[Math.floor(pool.length * 0.3)];
}

class AutoDJ {
  private planning = false;

  get enabled(): boolean {
    return useAI.getState().autoDj;
  }

  async start(): Promise<void> {
    await engine.init();
    useAI.getState().patch({ autoDj: true });
    const { decks } = useDecks.getState();
    const mixer = useMixer.getState();
    if (Math.abs(mixer.xfader - 0.5) > 0.02) mixer.setXfader(0.5);
    if (!decks.some((d) => d.playing)) {
      let deck = decks.findIndex((d) => d.trackId && !d.loading);
      if (deck < 0) {
        const opener = pickOpener();
        if (!opener) {
          toast('Auto DJ needs analysed tracks in the library.', 'error');
          this.stop();
          return;
        }
        deck = 0;
        if (!(await loadTrack(0, opener.id))) return this.stop();
      }
      if (mixer.ch[deck].fader < 0.5) mixer.setChannel(deck, { fader: 0.85 });
      await play(deck);
    }
    toast('Auto DJ on – the AI picks and mixes the next tracks.', 'success');
    void this.planNext();
  }

  stop(): void {
    useAI.getState().patch({ autoDj: false });
    if (autoMixer.busy && useAI.getState().mix.phase === 'armed') autoMixer.cancel(false);
  }

  /** Choose a different next track (keeps Auto DJ running). */
  async skip(): Promise<void> {
    if (useAI.getState().mix.phase === 'running') return;
    const current = useAI.getState().mix.trackId;
    autoMixer.cancel(false);
    await this.planNext(current ?? undefined);
  }

  async planNext(avoid?: string): Promise<void> {
    if (!this.enabled || this.planning || autoMixer.busy) return;
    this.planning = true;
    try {
      const { decks, master } = useDecks.getState();
      const out = decks[master].playing ? master : decks.findIndex((d) => d.playing);
      if (out < 0) return;
      const ai = useAI.getState();
      let nextId: string | undefined;
      while (ai.queue.length && !nextId) {
        const id = ai.queue[0];
        ai.patch({ queue: ai.queue.slice(1) });
        if (useLibrary.getState().tracks[id]?.analysis && id !== decks[out].trackId) nextId = id;
      }
      if (!nextId) {
        const sugg = computeSuggestions(out, 6).filter((s) => s.track.id !== avoid);
        nextId = sugg[0]?.track.id;
      }
      if (!nextId) {
        toast('Auto DJ: nothing left to play that mixes well.', 'error');
        return;
      }
      await aiMix(nextId, { when: 'phrase', onDone: () => setTimeout(() => void this.planNext(), 400) });
    } finally {
      this.planning = false;
    }
  }
}

export const autoDj = new AutoDJ();

/** Keep Auto DJ alive if a track ends without a transition (e.g. planning failed). */
export function startAutoDjWatchdog(): void {
  engine.on((ev) => {
    if (ev.type !== 'ended' || !autoDj.enabled) return;
    const other = ev.deck === 0 ? 1 : 0;
    const d = deckState(other);
    if (!d.playing && d.trackId) void play(other).then(() => autoDj.planNext());
  });
}
