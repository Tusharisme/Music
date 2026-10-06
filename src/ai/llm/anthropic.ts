import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Backend, BackendConfig, ChatTask, JsonTask } from './backend';
import { AiError } from './errors';
import { claudeModel, providerInfo } from './providers';

/**
 * Claude through the beta Messages API, so requests can opt into server-side refusal
 * fallbacks. Used by the Node server (ANTHROPIC_API_KEY) and the browser's own-key mode.
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function client(cfg: BackendConfig): Anthropic {
  return new Anthropic({
    apiKey: cfg.apiKey.trim() || undefined,
    dangerouslyAllowBrowser: true,
    ...(cfg.fetch ? { fetch: cfg.fetch, maxRetries: 0 } : {}),
  });
}

function toAiError(err: unknown): unknown {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new AiError('Invalid Anthropic API key.', 401, err.message, 'auth');
  if (err instanceof Anthropic.PermissionDeniedError)
    return new AiError('This API key is not allowed to use that model.', 403, err.message, 'auth');
  if (err instanceof Anthropic.NotFoundError)
    return new AiError('That Claude model is not available for this API key.', 404, err.message, 'model');
  if (err instanceof Anthropic.RateLimitError)
    return new AiError('Rate limited by the Claude API – try again in a moment.', 429, err.message, 'limit');
  if (err instanceof Anthropic.BadRequestError)
    return new AiError(`Claude API rejected the request: ${err.message}`, 400, err.message, 'rejected');
  if (err instanceof Anthropic.InternalServerError)
    return new AiError('Claude is overloaded right now – try again shortly.', 503, err.message, 'provider');
  if (err instanceof Anthropic.APIConnectionError)
    return new AiError('Could not reach the Claude API.', 502, err.message, 'network');
  if (err instanceof Anthropic.APIError)
    return new AiError(err.message, err.status ?? 500, err.message, 'provider');
  return err;
}

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

export function anthropicBackend(cfg: BackendConfig): Backend {
  const sdk = client(cfg);
  const info = claudeModel(cfg.model);
  const params = {
    model: info.id,
    ...(info.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  };
  const effort = info.effort ? { effort: cfg.effort ?? 'low' } : {};
  const system = (system: string, library: string, tail?: string): Anthropic.Beta.BetaTextBlockParam[] => [
    { type: 'text', text: system },
    { type: 'text', text: library, cache_control: { type: 'ephemeral' } },
    ...(tail ? [{ type: 'text' as const, text: tail }] : []),
  ];

  async function json(task: JsonTask): Promise<unknown> {
    try {
      const msg = await sdk.beta.messages.create(
        {
          ...params,
          max_tokens: 16000,
          system: system(task.system, task.library),
          messages: [{ role: 'user', content: task.prompt }],
          output_config: { ...effort, format: betaZodOutputFormat(task.schema) },
        },
        { signal: task.signal },
      );
      if (msg.stop_reason === 'refusal')
        throw new AiError('The AI declined this request.', 422, '', 'refused');
      if (msg.stop_reason === 'max_tokens')
        throw new AiError('The AI response was cut off – try again.', 502, '', 'format');
      try {
        return JSON.parse(textOf(msg.content));
      } catch {
        throw new AiError('The AI response could not be read – try again.', 502, '', 'format');
      }
    } catch (err) {
      throw toAiError(err);
    }
  }

  async function chat(
    task: ChatTask,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const stream = sdk.beta.messages.stream(
        {
          ...params,
          max_tokens: 32000,
          system: system(task.system, task.library, task.tail),
          messages: task.messages,
          ...(Object.keys(effort).length ? { output_config: effort } : {}),
        },
        { signal },
      );
      stream.on('text', (delta) => onText(delta));
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal')
        throw new AiError('The AI declined this request.', 422, '', 'refused');
      return textOf(final.content);
    } catch (err) {
      throw toAiError(err);
    }
  }

  return {
    label: providerInfo('anthropic').label,
    maxTracks: providerInfo('anthropic').maxTracks,
    json,
    chat,
  };
}

export async function listClaudeModels(cfg: BackendConfig): Promise<string[]> {
  try {
    const page = await client(cfg).models.list({ limit: 50 });
    return page.data.map((m) => m.id);
  } catch (err) {
    throw toAiError(err);
  }
}
