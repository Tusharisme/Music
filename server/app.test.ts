import { afterEach, describe, expect, it } from 'vitest';
import { app, serverConfig } from './app';

describe('server AI config', () => {
  it('uses whichever provider has a key, free ones first', () => {
    expect(serverConfig({})).toBeNull();
    expect(serverConfig({ GROQ_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })).toMatchObject({
      provider: 'groq',
      apiKey: 'g',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    expect(serverConfig({ ANTHROPIC_API_KEY: 'a' })).toMatchObject({ provider: 'anthropic', apiKey: 'a' });
  });

  it('honours AI_PROVIDER, AI_MODEL and AI_BASE_URL', () => {
    expect(
      serverConfig({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'k',
        GROQ_API_KEY: 'g',
        AI_MODEL: 'gemini-3.8-flash',
      }),
    ).toMatchObject({ provider: 'gemini', apiKey: 'k', model: 'gemini-3.8-flash' });
    // Ollama needs no key; a custom service needs an address and a model.
    expect(serverConfig({ AI_PROVIDER: 'ollama' })).toMatchObject({ provider: 'ollama', model: 'llama3.2' });
    expect(serverConfig({ AI_PROVIDER: 'custom', AI_BASE_URL: 'http://x/v1' })).toBeNull();
    expect(
      serverConfig({ AI_PROVIDER: 'custom', AI_BASE_URL: 'http://x/v1', AI_MODEL: 'm', AI_API_KEY: 'k' }),
    ).toMatchObject({ provider: 'custom', baseUrl: 'http://x/v1', model: 'm', apiKey: 'k' });
    expect(serverConfig({ AI_PROVIDER: 'nope', GEMINI_API_KEY: 'k' })).toBeNull();
  });
});

describe('health endpoint', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reports the provider without exposing the key', async () => {
    for (const k of ['AI_PROVIDER', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'])
      delete process.env[k];
    process.env.GEMINI_API_KEY = 'secret-key';
    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body).toEqual({ ok: true, ai: true, provider: 'gemini', model: 'gemini-flash-latest' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
