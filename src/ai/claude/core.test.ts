import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { runPicks, runSetPlan, streamChat, describeError } from './core';
import type { DjContext } from './schema';

const track = (id: string, title: string) => ({
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

const context: DjContext = {
  decks: [
    {
      deck: 'A',
      playing: true,
      isMaster: true,
      track: track('a', 'Alpha'),
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
  library: [track('a', 'Alpha'), track('b', 'Bravo'), track('c', 'Charlie')],
  localSuggestions: [{ id: 'b', score: 91, reasons: ['Same key 8A'] }],
  history: [],
  vibe: 'Build',
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function mockClient(respond: (body: Record<string, unknown>) => Response) {
  const calls: Captured[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(url), headers, body });
    return respond(body);
  };
  const client = new Anthropic({ apiKey: 'test-key', fetch: fetchImpl as typeof fetch, maxRetries: 0 });
  return { client, calls };
}

const message = (text: string, stop = 'end_turn') =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('Claude core', () => {
  it('requests structured picks with refusal fallbacks and filters unknown ids', async () => {
    const out = {
      headline: 'Lift it with Bravo',
      picks: [
        { trackId: 'b', why: 'Same key', technique: 'bass-swap', tip: 'Swap lows at bar 8' },
        { trackId: 'zzz', why: 'invented', technique: 'quick-cut', tip: '-' },
        { trackId: 'b', why: 'dup', technique: 'quick-cut', tip: '-' },
      ],
      discover: [{ title: 'Song', artist: 'Someone', why: 'fits', bpm: null, key: null, mixTip: 'blend' }],
    };
    const { client, calls } = mockClient(() => message(JSON.stringify(out)));
    const res = await runPicks(
      client,
      { context, discover: true },
      { model: 'claude-opus-5-5', effort: 'low' },
    );
    expect(res.picks.map((p) => p.trackId)).toEqual(['b']);
    expect(res.discover).toHaveLength(1);

    const call = calls[0];
    expect(call.url).toContain('/v1/messages');
    expect(call.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(call.body.model).toBe('claude-opus-5-5');
    expect(call.body.fallbacks).toBe('default');
    expect(call.body.betas).toBeUndefined();
    const oc = call.body.output_config as { effort: string; format: { type: string; schema: unknown } };
    expect(oc.effort).toBe('low');
    expect(oc.format.type).toBe('json_schema');
    expect(JSON.stringify(call.body.system)).toContain('Bravo');
    expect(call.body.thinking).toBeUndefined();
  });

  it('omits effort and fallbacks for Haiku', async () => {
    const { client, calls } = mockClient(() =>
      message(
        JSON.stringify({
          title: 'Set',
          arc: 'up',
          items: [{ trackId: 'c', note: 'open', technique: 'long-blend' }],
        }),
      ),
    );
    const plan = await runSetPlan(
      client,
      { library: context.library, durationMin: 30, vibe: 'warm up' },
      { model: 'claude-haiku-4-5' },
    );
    expect(plan.items[0].trackId).toBe('c');
    expect(calls[0].body.fallbacks).toBeUndefined();
    expect((calls[0].body.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect(calls[0].headers['anthropic-beta'] ?? '').not.toContain('server-side-fallback');
  });

  it('surfaces refusals as errors', async () => {
    const { client } = mockClient(() => message('{}', 'refusal'));
    await expect(runPicks(client, { context, discover: false }, {})).rejects.toThrow(/declined/);
  });

  it('streams chat text and merges consecutive turns', async () => {
    const sse = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Play ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bravo.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 3 },
      },
      { type: 'message_stop' },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join('');
    const { client, calls } = mockClient(
      () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const deltas: string[] = [];
    const text = await streamChat(
      client,
      {
        context,
        messages: [
          { role: 'assistant', text: 'hi' },
          { role: 'user', text: 'what next?' },
          { role: 'user', text: 'something deeper' },
        ],
      },
      { model: 'claude-sonnet-5-5', effort: 'medium' },
      (d) => deltas.push(d),
    );
    expect(text).toBe('Play Bravo.');
    expect(deltas.join('')).toBe('Play Bravo.');
    const msgs = calls[0].body.messages as { role: string; content: string }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('something deeper');
    expect(calls[0].body.stream).toBe(true);
  });

  it('maps API errors to friendly messages', async () => {
    const { client } = mockClient(
      () =>
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
          { status: 401 },
        ),
    );
    try {
      await runPicks(client, { context, discover: false }, {});
      expect.unreachable();
    } catch (err) {
      expect(describeError(err)).toEqual({ message: 'Invalid Anthropic API key.', status: 401 });
    }
  });
});
