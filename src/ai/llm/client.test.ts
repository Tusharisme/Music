import { afterEach, describe, expect, it, vi } from 'vitest';

describe('copilot connection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses a key built into a static deployment unless the visitor connected their own', async () => {
    vi.stubEnv('VITE_SITE_AI_KEY', 'site-key');
    vi.stubEnv('VITE_NO_SERVER', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { checkCopilot } = await import('./client');
    const { useSettings } = await import('../../state/settings');

    expect(await checkCopilot(true)).toMatchObject({
      state: 'ready',
      via: 'site',
      provider: 'gemini',
      model: 'gemini-flash-lite-latest',
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // no /api probe on static hosting

    useSettings.getState().set({ aiProvider: 'groq', aiKeys: { groq: 'my-own-key' } });
    expect(await checkCopilot()).toMatchObject({ state: 'ready', via: 'byok', provider: 'groq' });

    useSettings.getState().set({ aiMode: 'byok', aiKeys: {} });
    expect((await checkCopilot()).state).toBe('unavailable');
  });

  it('asks the server when there is one and no key is built in', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, ai: true, provider: 'groq', model: 'openai/gpt-oss-120b' })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { checkCopilot } = await import('./client');
    expect(await checkCopilot(true)).toMatchObject({ state: 'ready', via: 'server', provider: 'groq' });
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('api/health');
  });
});
