import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { modelInfo } from './models';
import { SYSTEM_PROMPT, chatSystem, libraryBlock, picksPrompt, setPlanPrompt } from './prompts';
import {
  PicksOutputSchema,
  SetPlanOutputSchema,
  type AiOptions,
  type ChatRequest,
  type PicksOutput,
  type PicksRequest,
  type SetPlanOutput,
  type SetPlanRequest,
} from './schema';

/**
 * Claude calls shared by the Node server (key from ANTHROPIC_API_KEY) and the
 * browser "bring your own key" mode. All requests go through the beta Messages
 * API so we can opt into server-side refusal fallbacks.
 */

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function modelParams(opts: AiOptions) {
  const info = modelInfo(opts.model);
  const effort = opts.effort ?? 'low';
  return {
    model: info.id,
    ...(info.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    effortConfig: info.effort ? { effort } : {},
  };
}

function system(libraryText: string, tail?: string): Anthropic.Beta.BetaTextBlockParam[] {
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: libraryText, cache_control: { type: 'ephemeral' } },
  ];
  if (tail) blocks.push({ type: 'text', text: tail });
  return blocks;
}

/** Structured-output request: check the stop reason before trusting the JSON, then validate it. */
async function structured<S extends z.ZodType>(
  client: Anthropic,
  schema: S,
  opts: AiOptions,
  libraryText: string,
  prompt: string,
): Promise<z.infer<S>> {
  const { effortConfig, ...p } = modelParams(opts);
  const msg = await client.beta.messages.create({
    ...p,
    max_tokens: 16000,
    system: system(libraryText),
    messages: [{ role: 'user', content: prompt }],
    output_config: { ...effortConfig, format: betaZodOutputFormat(schema) },
  });
  if (msg.stop_reason === 'refusal') throw new AiError('The AI declined this request.', 422);
  if (msg.stop_reason === 'max_tokens') throw new AiError('The AI response was cut off – try again.', 502);
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError('The AI response could not be read – try again.', 502);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AiError('The AI response had an unexpected shape – try again.', 502);
  return parsed.data;
}

export async function runPicks(
  client: Anthropic,
  req: PicksRequest,
  opts: AiOptions = {},
): Promise<PicksOutput> {
  const out = await structured(
    client,
    PicksOutputSchema,
    opts,
    libraryBlock(req.context.library),
    picksPrompt(req),
  );
  const ids = new Set(req.context.library.map((t) => t.id));
  const seen = new Set<string>();
  return {
    headline: out.headline,
    picks: out.picks
      .filter((x) => ids.has(x.trackId) && !seen.has(x.trackId) && seen.add(x.trackId))
      .slice(0, 4),
    discover: req.discover ? out.discover.slice(0, 5) : [],
  };
}

export async function streamChat(
  client: Anthropic,
  req: ChatRequest,
  opts: AiOptions,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { effortConfig, ...p } = modelParams(opts);
  // The API needs alternating turns starting with the user.
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of req.messages) {
    const last = messages[messages.length - 1];
    if (!last && m.role !== 'user') continue;
    if (last && last.role === m.role) last.content = `${last.content as string}\n\n${m.text}`;
    else messages.push({ role: m.role, content: m.text });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user')
    throw new AiError('Nothing to answer.', 400);
  const stream = client.beta.messages.stream(
    {
      ...p,
      max_tokens: 32000,
      system: system(libraryBlock(req.context.library), chatSystem(req)),
      messages,
      ...(Object.keys(effortConfig).length ? { output_config: effortConfig } : {}),
    },
    { signal },
  );
  stream.on('text', (delta) => onText(delta));
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new AiError('The AI declined this request.', 422);
  return final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export async function runSetPlan(
  client: Anthropic,
  req: SetPlanRequest,
  opts: AiOptions = {},
): Promise<SetPlanOutput> {
  const out = await structured(
    client,
    SetPlanOutputSchema,
    opts,
    libraryBlock(req.library),
    setPlanPrompt(req),
  );
  const ids = new Set(req.library.map((t) => t.id));
  const seen = new Set<string>();
  return {
    ...out,
    items: out.items.filter((i) => ids.has(i.trackId) && !seen.has(i.trackId) && seen.add(i.trackId)),
  };
}

/** Map SDK errors to a user-facing message and HTTP status. */
export function describeError(err: unknown): { message: string; status: number } {
  if (err instanceof AiError) return { message: err.message, status: err.status };
  if (err instanceof Anthropic.AuthenticationError)
    return { message: 'Invalid Anthropic API key.', status: 401 };
  if (err instanceof Anthropic.PermissionDeniedError)
    return { message: 'This API key is not allowed to use that model.', status: 403 };
  if (err instanceof Anthropic.NotFoundError)
    return { message: 'That Claude model is not available for this API key.', status: 404 };
  if (err instanceof Anthropic.RateLimitError)
    return { message: 'Rate limited by the Claude API – try again in a moment.', status: 429 };
  if (err instanceof Anthropic.BadRequestError)
    return { message: `Claude API rejected the request: ${err.message}`, status: 400 };
  if (err instanceof Anthropic.InternalServerError)
    return { message: 'Claude is overloaded right now – try again shortly.', status: 503 };
  if (err instanceof Anthropic.APIConnectionError)
    return { message: 'Could not reach the Claude API.', status: 502 };
  if (err instanceof Anthropic.APIError) return { message: err.message, status: err.status ?? 500 };
  if (err instanceof Error && err.name === 'AbortError') return { message: 'Cancelled.', status: 499 };
  return { message: 'Unexpected AI error.', status: 500 };
}
