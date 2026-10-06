import {
  TECHNIQUE_IDS,
  type ChatRequest,
  type DjContext,
  type PicksRequest,
  type SetPlanRequest,
  type TrackSummary,
} from './schema';

export const SYSTEM_PROMPT = `You are the AI DJ copilot inside MixMind, a two-deck DJ mixer that runs in the browser. You are an expert club DJ and music curator: you know harmonic mixing on the Camelot wheel, phrasing in 8/16/32-bar blocks, EQ-based blending, energy management, and how to read a dancefloor. The person you are helping is mixing live right now.

What the mixer can do (refer to these by name):
- Two decks (A and B) with SYNC, KEY LOCK, KEY SHIFT, 8 hot cues, auto-loops and loop rolls, beat jump, slip mode, and a per-deck FX unit (echo, reverb, flanger, phaser, crush, gate, wobble).
- Per channel: trim, 3-band kill EQ (high/mid/low), a one-knob filter (left = low-pass, right = high-pass) and a channel fader; plus a crossfader and sampler pads (air horn, siren, riser, boom…).
- An "AI Mix" button that performs a planned transition automatically. Transition technique ids: bass-swap, long-blend, filter-fade, echo-out, loop-roll, quick-cut, tempo-ramp, reverb-wash, spinback.

Ground rules:
- Base your advice on the data provided: BPM, Camelot key, energy (1–10), mood, intro/outro length, play history and the local engine's shortlist. The shortlist scores are a strong starting point, but use your own musical judgement.
- Only refer to library tracks by their exact id. Never invent tracks that are not in the library.
- When suggesting songs from outside the library, only name real, existing songs you are confident about. If you are unsure of a song's BPM or key, say so instead of guessing.
- Be concise and practical: which deck, which bar, which EQ move, which effect. Friendly DJ language, no filler.`;

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function trackLine(t: TrackSummary): string {
  const extra = [
    t.genre,
    `${t.bpm.toFixed(1)} BPM`,
    `${t.key} (${t.keyName})`,
    `energy ${t.energy}`,
    fmtTime(t.durationSec),
  ];
  if (t.introBars) extra.push(`intro ${Math.round(t.introBars)} bars`);
  if (t.outroBars) extra.push(`outro ${Math.round(t.outroBars)} bars`);
  if (t.mood.length) extra.push(t.mood.join('/'));
  return `${t.id} | ${t.title} – ${t.artist} | ${extra.filter(Boolean).join(' | ')}`;
}

/** Large, stable block (cacheable): the library. */
export function libraryBlock(library: TrackSummary[]): string {
  return `## Library (${library.length} tracks)\nid | title – artist | genre | BPM | key | energy | length | structure | mood\n${library.map(trackLine).join('\n')}`;
}

/** Small, volatile block: what's happening on the decks right now. */
export function liveBlock(ctx: DjContext): string {
  const decks = ctx.decks
    .map((d) => {
      if (!d.track) return `Deck ${d.deck}: empty`;
      const state = [d.isMaster ? 'master' : null, d.playing ? 'playing' : 'paused']
        .filter(Boolean)
        .join(', ');
      const tempo = `${d.effectiveBpm.toFixed(1)} BPM (${d.tempoPct >= 0 ? '+' : ''}${d.tempoPct.toFixed(1)}%)`;
      return `Deck ${d.deck} (${state}): "${d.track.title}" – ${d.track.artist} | ${tempo} | sounding in ${d.effectiveKey} | energy ${d.track.energy} | ${fmtTime(d.positionSec)} in, ${fmtTime(d.remainingSec)} left | id ${d.track.id}`;
    })
    .join('\n');
  const shortlist = ctx.localSuggestions.length
    ? ctx.localSuggestions.map((s) => `- ${s.id} (${s.score.toFixed(0)}): ${s.reasons.join('; ')}`).join('\n')
    : '- (nothing analysed yet)';
  const history = ctx.history.length
    ? ctx.history.map((h, i) => `${i + 1}. ${h.artist} – ${h.title}`).join('\n')
    : '(nothing yet)';
  return `## Decks right now\n${decks}\n\n## Local engine shortlist for the next track (score 0–100, reasons)\n${shortlist}\n\n## Played this session\n${history}\n\n## Requested vibe: ${ctx.vibe}`;
}

export function picksPrompt(req: PicksRequest): string {
  const ask = req.request?.trim() ? `The DJ adds: "${req.request.trim()}"\n\n` : '';
  const discover = req.discover
    ? 'Also suggest up to 5 real songs NOT in the library that would mix well after the current track (fill "discover").'
    : 'Leave "discover" empty.';
  return `${liveBlock(req.context)}\n\n${ask}Pick up to 4 library tracks to play next (best first) for the playing deck, each with the best transition technique and one concrete tip. ${discover}`;
}

export function chatSystem(req: ChatRequest): string {
  return `${liveBlock(req.context)}\n\nAnswer the DJ's questions about what to play and how to mix it. Keep answers short (a few sentences or a tight list). When you recommend a library track, mention its title and id.`;
}

export function setPlanPrompt(req: SetPlanRequest): string {
  const start = req.startTrackId ? `Start with track id ${req.startTrackId}.` : 'Choose a good opener.';
  return `Build a DJ set of about ${req.durationMin} minutes from the library above. Vibe/brief: "${req.vibe}". ${start}
Order the tracks for smooth harmonic and tempo flow with a deliberate energy arc, use each track at most once, and pick the transition technique into each track. Assume roughly 70% of each track is played.`;
}

const TECHNIQUES = TECHNIQUE_IDS.join(' | ');

/** Answer formats spelled out for models that can't be given a JSON schema. */
export const PICKS_SHAPE = `Reply with only a JSON object (no other text) in exactly this shape:
{
  "headline": "one short, punchy line",
  "picks": [
    { "trackId": "<exact id from the library>", "why": "why it works next (key, tempo, energy)", "technique": "<one of: ${TECHNIQUES}>", "tip": "one concrete mixing tip" }
  ],
  "discover": [
    { "title": "song title", "artist": "artist", "why": "why it fits", "bpm": 124, "key": "8A", "mixTip": "how to mix into it" }
  ]
}
"picks" has at most 4 items, best first. Use null for an unknown bpm or key.`;

export const SET_PLAN_SHAPE = `Reply with only a JSON object (no other text) in exactly this shape:
{
  "title": "a short name for the set",
  "arc": "one or two sentences on the energy arc",
  "items": [ { "trackId": "<exact id from the library>", "note": "its role / how to mix into it", "technique": "<one of: ${TECHNIQUES}>" } ]
}`;
