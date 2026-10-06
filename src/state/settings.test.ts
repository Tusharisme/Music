import { describe, expect, it } from 'vitest';
import { migrateSettings } from './settings';

describe('settings migration', () => {
  it('moves a saved Claude key into the per-provider settings', () => {
    const out = migrateSettings({ apiKey: ' sk-ant-123 ', model: 'claude-haiku-4-5', vibe: 'build' }, 1);
    expect(out).toMatchObject({
      aiProvider: 'anthropic',
      aiKeys: { anthropic: 'sk-ant-123' },
      aiModels: { anthropic: 'claude-haiku-4-5' },
      vibe: 'build',
    });
    expect(out).not.toHaveProperty('apiKey');
    expect(out).not.toHaveProperty('model');
  });

  it('starts people without a key on the free default', () => {
    expect(migrateSettings({ apiKey: '' }, 1)).toMatchObject({ aiProvider: 'gemini', aiKeys: {} });
    expect(migrateSettings({ aiProvider: 'retired-service' }, 2).aiProvider).toBe('gemini');
  });
});
