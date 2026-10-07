import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  listOpenAiModels,
  openAiBackend,
  parseJsonLoose,
  pickModels,
  stripThink,
  thinkFilter,
} from './openai';
import { normalizePicks, runPicks, runSetPlan, streamChat, toTechnique, trimLibrary } from './core';
import { describeError } from './errors';
import type { BackendConfig } from './backend';
import { PicksRequestSchema, type DjContext, type TrackSummary } from './schema';

const track = (id: string, title: string): TrackSummary => ({
  id,
  title,
  artist: 'MixMind Studio',
  genre: 'House',
  bpm: 124,
  key: '8A',
  keyName: 'Am',
  energy: 6,
  durationSec: 190,
  mood: ['deep'],
  introBars: 16,
  outroBars: 16,
});

const library = [
  track('demo-alpha', 'Alpha'),
  track('demo-bravo', 'Bravo'),
  track('demo-charlie', 'Charlie'),
];

const context: DjContext = {
  decks: [
    {
      deck: 'A',
      playing: true,
      isMaster: true,
      track: library[0],
      positionSec: 60,
      remainingSec: 130,
      effectiveBpm: 124,
      effectiveKey: '8A',
      tempoPct: 0,
    },
    {
      deck: 'B',
      playing: false,
      isMaster: false,
      track: null,
      positionSec: 0,
      remainingSec: 0,
      effectiveBpm: 0,
      effectiveKey: '-',
      tempoPct: 0,
    },
  ],
  library,
  localSuggestions: [{ id: 'demo-bravo', score: 91, reasons: ['Same key 8A'] }],
  history: [],
  vibe: 'Build',
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let n = 0;
/** A fake provider; each test gets its own base URL so learned behaviour doesn't leak. */
function fake(respond: (call: Call, i: number) => Response) {
  const calls: Call[] = [];
  const baseUrl = `https://provider-${++n}.test/v1`;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    const call = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  const cfg = (o: Partial<BackendConfig> = {}): BackendConfig => ({
    provider: 'gemini',
    apiKey: 'free-key',
    baseUrl,
    fetch: fetchImpl as typeof fetch,
    ...o,
  });
  return { calls, cfg, baseUrl };
}

const completion = (content: string, finish = 'stop') =>
  new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );

const fail = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const picksJson = JSON.stringify({
  headline: 'Lift it',
  picks: [
    { trackId: 'demo-bravo', why: 'Same key', technique: 'Bass swap', tip: 'Swap lows on bar 9' },
    { trackId: 'made-up', why: 'invented', technique: 'quick-cut', tip: '-' },
    { trackId: 'Charlie', why: 'title instead of id', technique: 'echo out', tip: 'Echo the last bar' },
  ],
  discover: [{ title: 'Song', artist: 'Someone', why: 'fits', bpm: '124', key: '8A', mixTip: 'blend' }],
});

describe('OpenAI-compatible backend', () => {
  it('asks Gemini for schema-shaped JSON with a short think, and cleans up the answer', async () => {
    const { calls, cfg, baseUrl } = fake(() => completion(picksJson));
    const out = await runPicks(openAiBackend(cfg()), { context, discover: true });

    expect(out.picks.map((p) => [p.trackId, p.technique])).toEqual([
      ['demo-bravo', 'bass-swap'],
      ['demo-charlie', 'echo-out'],
    ]);
    expect(out.discover[0].bpm).toBe(124);

    const c = calls[0];
    expect(c.url).toBe(`${baseUrl}/chat/completions`);
    expect(c.headers.authorization).toBe('Bearer free-key');
    expect(c.body.model).toBe('gemini-flash-lite-latest');
    expect(c.body.reasoning_effort).toBe('low');
    const rf = c.body.response_format as { type: string; json_schema: { name: string; schema: object } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('dj_picks');
    expect(rf.json_schema.schema).not.toHaveProperty('$schema');
    const msgs = c.body.messages as { role: string; content: string }[];
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('demo-charlie | Charlie');
    expect(msgs[1].content).toContain('Reply with only a JSON object');
  });

  it('steps down to JSON mode when a model rejects schemas, and remembers it', async () => {
    const { calls, cfg } = fake((call) =>
      (call.body.response_format as { type?: string } | undefined)?.type === 'json_schema'
        ? fail(400, { error: { message: "response_format 'json_schema' is not supported by this model" } })
        : completion(picksJson),
    );
    const backend = () => openAiBackend(cfg({ provider: 'groq', model: 'some-model' }));
    await runPicks(backend(), { context, discover: false });
    expect(calls.map((c) => (c.body.response_format as { type: string }).type)).toEqual([
      'json_schema',
      'json_object',
    ]);

    await runPicks(backend(), { context, discover: false });
    expect((calls[2].body.response_format as { type: string }).type).toBe('json_object');
  });

  it('drops reasoning_effort for models that refuse it', async () => {
    const { calls, cfg } = fake((call) =>
      'reasoning_effort' in call.body
        ? fail(400, { error: { message: '`reasoning_effort` is not supported with this model' } })
        : completion(picksJson),
    );
    await runPicks(openAiBackend(cfg({ provider: 'groq', model: 'qwen-x' })), { context, discover: false });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).not.toHaveProperty('reasoning_effort');
    expect((calls[1].body.response_format as { type: string }).type).toBe('json_schema');
  });

  it('moves to another free model when one is overloaded, and skips it for a while', async () => {
    const { calls, cfg } = fake((call) =>
      call.body.model === 'gemini-flash-latest'
        ? fail(503, [{ error: { code: 503, message: 'This model is currently experiencing high demand.' } }])
        : completion(picksJson),
    );
    const backend = () => openAiBackend(cfg({ model: 'gemini-flash-latest' }));
    const out = await runPicks(backend(), { context, discover: false });
    expect(out.picks[0].trackId).toBe('demo-bravo');
    expect(calls.map((c) => c.body.model)).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest']);

    await runPicks(backend(), { context, discover: false });
    expect(calls[2].body.model).toBe('gemini-flash-lite-latest');
  });

  it('treats "thinking level not supported" as a reasoning refusal', async () => {
    const { calls, cfg } = fake((call) =>
      'reasoning_effort' in call.body
        ? fail(400, [
            { error: { code: 400, message: 'Thinking level LOW is not supported for this model.' } },
          ])
        : completion(picksJson),
    );
    await runPicks(openAiBackend(cfg({ model: 'gemini-3.8-flash' })), { context, discover: false });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).not.toHaveProperty('reasoning_effort');
    expect((calls[1].body.response_format as { type: string }).type).toBe('json_schema');
  });

  it('reads JSON wrapped in prose, fences or <think> blocks', async () => {
    expect(parseJsonLoose('Sure!\n```json\n{"a":1}\n```\nEnjoy')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"a":{"b":2}} – have fun')).toEqual({ a: { b: 2 } });
    expect(parseJsonLoose('no json here')).toBeUndefined();
    expect(stripThink('<think>hmm, 8A…</think>\n{"a":1}')).toBe('{"a":1}');

    const { cfg } = fake(() =>
      completion(
        `<think>Which track?</think>\`\`\`json\n${JSON.stringify({ title: 'Set', arc: 'up', items: [{ trackId: 'demo-bravo', note: 'opener', technique: 'filter' }] })}\n\`\`\``,
      ),
    );
    const plan = await runSetPlan(openAiBackend(cfg({ provider: 'ollama', model: 'llama3.2' })), {
      library,
      durationMin: 30,
      vibe: 'warm up',
    });
    expect(plan.items).toEqual([{ trackId: 'demo-bravo', note: 'opener', technique: 'filter-fade' }]);
  });

  it('falls all the way back to a JSON-only prompt, then gives a clear error', async () => {
    const { calls, cfg } = fake(() => completion('I would play Bravo next, it is great.'));
    await expect(
      runPicks(openAiBackend(cfg({ provider: 'openrouter', model: 'any/free-model' })), {
        context,
        discover: false,
      }),
    ).rejects.toThrow(/expected format/);
    expect(
      calls.map((c) => (c.body.response_format as { type?: string } | undefined)?.type ?? 'none'),
    ).toEqual(['json_schema', 'json_object', 'none']);
    expect(calls[0].headers['x-title']).toBe('MixMind');
  });

  it('streams chat, hiding <think> text split across chunks', async () => {
    const chunks = ['<thi', 'nk>planning', ' the answer</th', 'ink>\n\nPlay ', 'Bravo', ' next.'];
    const sse =
      chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
      ': keep-alive\n\ndata: [DONE]\n\n';
    const { calls, cfg } = fake(
      () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const deltas: string[] = [];
    const text = await streamChat(
      openAiBackend(cfg({ provider: 'groq' })),
      {
        context,
        messages: [
          { role: 'assistant', text: 'hi' },
          { role: 'user', text: 'what next?' },
          { role: 'user', text: 'deeper please' },
        ],
      },
      (d) => deltas.push(d),
    );
    expect(text).toBe('Play Bravo next.');
    expect(deltas.join('')).toBe('Play Bravo next.');
    const body = calls[0].body as {
      stream: boolean;
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.stream).toBe(true);
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[0].content).toContain('Decks right now');
    expect(body.messages[1].content).toContain('deeper please');
  });

  it('turns provider errors into plain advice', async () => {
    const run = async (res: Response, provider: BackendConfig['provider'] = 'gemini') => {
      const { cfg } = fake(() => res.clone());
      try {
        await runPicks(openAiBackend(cfg({ provider })), { context, discover: false });
        return 'no error';
      } catch (err) {
        return describeError(err);
      }
    };
    expect(
      await run(
        fail(400, [
          { error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } },
        ]),
      ),
    ).toEqual({
      message: "Google Gemini didn't accept the API key – check it in Settings → AI.",
      status: 401,
    });
    expect(
      (await run(
        fail(429, { error: { message: 'Rate limit reached for requests per minute' } }),
        'groq',
      )) as object,
    ).toMatchObject({
      status: 429,
      message: expect.stringContaining('rate-limiting'),
    });
    expect(
      (await run(
        fail(429, { error: { message: 'free-models-per-day limit reached' } }),
        'openrouter',
      )) as object,
    ).toMatchObject({
      message: expect.stringContaining("Today's free OpenRouter allowance"),
    });
    expect(
      (await run(
        fail(413, { error: { message: 'Request too large: tokens per minute' } }),
        'groq',
      )) as object,
    ).toMatchObject({
      status: 413,
    });
    expect((await run(fail(404, { error: { message: 'model not found' } }))) as object).toMatchObject({
      status: 404,
      message: expect.stringContaining('gemini-flash-lite-latest'),
    });
  });

  it('explains unreachable local servers', async () => {
    const backend = openAiBackend({
      provider: 'ollama',
      apiKey: '',
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    await expect(
      backend.json({ name: 'x', schema: z.object({}), system: '', library: '', prompt: '', shape: '' }),
    ).rejects.toThrow(/Ollama running/);
  });

  it('sends only as much library as a free tier can take, keeping what matters', () => {
    const big = Array.from({ length: 100 }, (_, i) => track(`t${i}`, `Track ${i}`));
    const kept = trimLibrary(big, 60, ['t99', 't98']);
    expect(kept).toHaveLength(60);
    expect(kept.slice(0, 2).map((t) => t.id)).toEqual(['t98', 't99']);
  });

  it('normalises sloppy picks', () => {
    expect(toTechnique('Long Blend')).toBe('long-blend');
    expect(toTechnique('spin back')).toBe('spinback');
    expect(toTechnique('something else')).toBe('long-blend');
    const out = normalizePicks(
      { picks: [{ id: 'demo-alpha', reason: 'r', technique: 'loop roll' }] },
      library,
      false,
    );
    expect(out.picks[0]).toEqual({ trackId: 'demo-alpha', why: 'r', technique: 'loop-roll', tip: '' });
    expect(out.headline).toBeTruthy();
    expect(() => normalizePicks({ picks: [] }, library, false)).toThrow(/no usable tracks/);
  });

  it('asks for Bollywood songs with their film and year, and never for lyrics', async () => {
    const answer = JSON.stringify({
      headline: 'Take it desi',
      picks: [{ trackId: 'demo-bravo', why: 'Same key', technique: 'quick-cut', tip: 'Cut in on the hook' }],
      discover: [
        { title: 'Song A', artist: 'Singer', film: 'Film X', year: '2016', why: 'fits', bpm: 125, key: null },
        { title: 'Song B', artist: 'Singer 2', album: '', year: 1850, why: 'old', bpm: null, key: null },
      ],
    });
    const { calls, cfg } = fake(() => completion(answer));
    const out = await runPicks(openAiBackend(cfg()), { context, discover: true, scene: 'bollywood' });
    expect(out.discover[0]).toMatchObject({ title: 'Song A', album: 'Film X', year: 2016, bpm: 125 });
    expect(out.discover[1]).toMatchObject({ album: null, year: null });

    const msgs = calls[0].body.messages as { content: string }[];
    const sent = msgs.map((m) => m.content).join('\n');
    expect(sent).toContain('real Bollywood songs');
    expect(sent).toContain('Never quote or paraphrase song lyrics');
    expect(sent).toContain('"album"');

    expect(PicksRequestSchema.safeParse({ context, discover: true, scene: 'bollywood' }).success).toBe(true);
    expect(PicksRequestSchema.safeParse({ context, discover: true, scene: 'k-pop' }).success).toBe(false);
  });

  it('lists usable models per provider', async () => {
    expect(
      pickModels('gemini', [
        { id: 'models/gemini-3.8-flash' },
        { id: 'models/gemini-flash-latest' },
        { id: 'models/gemini-embedding-001' },
        { id: 'models/gemini-3.8-flash-tts' },
        { id: 'models/imagen-4' },
        { id: 'models/gemini-2.5-flash-native-audio-latest' },
        { id: 'models/gemini-pro-latest' },
        { id: 'models/gemini-3.1-pro-preview' },
        { id: 'models/deep-research-preview-04-2026' },
        { id: 'models/gemma-4-31b-it' },
      ]),
    ).toEqual(['gemini-flash-latest', 'gemini-3.8-flash', 'gemma-4-31b-it']);
    expect(
      pickModels('openrouter', [
        { id: 'paid/model', pricing: { prompt: '0.000001', completion: '0.000002' } },
        {
          id: 'free/model:free',
          pricing: { prompt: '0', completion: '0' },
          architecture: { output_modalities: ['text'] },
        },
        { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } },
        {
          id: 'music/gen',
          pricing: { prompt: '0', completion: '0' },
          architecture: { output_modalities: ['audio'] },
        },
      ]),
    ).toEqual(['openrouter/free', 'free/model:free']);

    const { calls, cfg } = fake((call) =>
      call.url.endsWith('/key')
        ? new Response('{}', { status: 200 })
        : new Response(
            JSON.stringify({ data: [{ id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } }] }),
          ),
    );
    expect(await listOpenAiModels(cfg({ provider: 'openrouter' }))).toEqual(['openrouter/free']);
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['key', 'models']);

    const noList = fake(() => new Response('not here', { status: 404 }));
    expect(await listOpenAiModels(noList.cfg({ provider: 'custom' }))).toEqual([]);
  });

  it('filters reasoning from streamed text even when tags arrive whole', () => {
    const f = thinkFilter();
    expect(f.push('<think>secret</think>Hello')).toBe('Hello');
    expect(f.push(' <')).toBe(' ');
    expect(f.push('b>bold')).toBe('<b>bold');
    expect(f.flush()).toBe('');
  });
});
