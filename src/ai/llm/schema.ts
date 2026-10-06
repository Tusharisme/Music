import { z } from 'zod';

/** Shared (browser + server) request/response contracts for the AI DJ copilot. */

export const TECHNIQUE_IDS = [
  'bass-swap',
  'long-blend',
  'filter-fade',
  'echo-out',
  'loop-roll',
  'quick-cut',
  'tempo-ramp',
  'reverb-wash',
  'spinback',
] as const;

const str = (max: number) => z.string().max(max);

export const TrackSummarySchema = z.object({
  id: str(80),
  title: str(200),
  artist: str(200),
  genre: str(80).nullish(),
  bpm: z.number().min(0).max(400),
  key: str(8),
  keyName: str(16),
  energy: z.number().min(0).max(10),
  durationSec: z.number().min(0).max(36000),
  mood: z.array(str(24)).max(6),
  introBars: z.number().min(0).max(512).nullish(),
  outroBars: z.number().min(0).max(512).nullish(),
});
export type TrackSummary = z.infer<typeof TrackSummarySchema>;

export const DeckSummarySchema = z.object({
  deck: z.enum(['A', 'B']),
  playing: z.boolean(),
  isMaster: z.boolean(),
  track: TrackSummarySchema.nullable(),
  positionSec: z.number().min(0).max(36000),
  remainingSec: z.number().min(0).max(36000),
  effectiveBpm: z.number().min(0).max(400),
  effectiveKey: str(8),
  tempoPct: z.number().min(-100).max(300),
});

export const DjContextSchema = z.object({
  decks: z.array(DeckSummarySchema).max(2),
  library: z.array(TrackSummarySchema).max(400),
  localSuggestions: z
    .array(z.object({ id: str(80), score: z.number(), reasons: z.array(str(120)).max(8) }))
    .max(20),
  history: z.array(z.object({ title: str(200), artist: str(200) })).max(50),
  vibe: str(40),
});
export type DjContext = z.infer<typeof DjContextSchema>;

export const PicksRequestSchema = z.object({
  context: DjContextSchema,
  request: str(600).optional(),
  discover: z.boolean(),
});
export type PicksRequest = z.infer<typeof PicksRequestSchema>;

export const ChatRequestSchema = z.object({
  context: DjContextSchema,
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: str(6000) }))
    .min(1)
    .max(24),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const SetPlanRequestSchema = z.object({
  library: z.array(TrackSummarySchema).min(1).max(400),
  durationMin: z.number().min(5).max(360),
  vibe: str(400),
  startTrackId: str(80).optional(),
});
export type SetPlanRequest = z.infer<typeof SetPlanRequestSchema>;

/** Options the caller may choose (validated server-side against an allow-list). */
export const AiOptionsSchema = z.object({
  model: str(64).optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
});
export type AiOptions = z.infer<typeof AiOptionsSchema>;

// ---------------------------------------------------------------- structured outputs

export const PicksOutputSchema = z.object({
  headline: z.string().describe('One short, punchy line summarising the recommendation.'),
  picks: z
    .array(
      z.object({
        trackId: z.string().describe('The id of a track from the provided library – never invent ids.'),
        why: z
          .string()
          .describe('Why it works next, in DJ terms (key, tempo, energy, vibe). One or two sentences.'),
        technique: z.enum(TECHNIQUE_IDS).describe('Best transition technique for this pair.'),
        tip: z.string().describe('One concrete mixing tip for this transition (bars, EQ, FX).'),
      }),
    )
    .describe('Up to 4 tracks from the library, best first.'),
  discover: z
    .array(
      z.object({
        title: z.string(),
        artist: z.string(),
        why: z.string().describe('Why it would mix well after the current track.'),
        bpm: z.number().nullable().describe('Approximate BPM if known, else null.'),
        key: z.string().nullable().describe('Camelot key if known, else null.'),
        mixTip: z.string().describe('How to transition into it.'),
      }),
    )
    .describe('Up to 5 real, existing songs (not in the library) worth adding. Empty if not requested.'),
});
export type PicksOutput = z.infer<typeof PicksOutputSchema>;

export const SetPlanOutputSchema = z.object({
  title: z.string().describe('A short name for the set.'),
  arc: z.string().describe('One or two sentences describing the energy arc.'),
  items: z
    .array(
      z.object({
        trackId: z.string().describe('Track id from the library – never invent ids.'),
        note: z.string().describe('Short note on its role in the set / how to mix into it.'),
        technique: z.enum(TECHNIQUE_IDS),
      }),
    )
    .describe('Ordered tracklist.'),
});
export type SetPlanOutput = z.infer<typeof SetPlanOutputSchema>;
