import { useState } from 'react';
import { useSettings } from '../../state/settings';
import { useAI } from '../../state/ai';
import { CLAUDE_MODELS, PROVIDERS, providerInfo, type ProviderId } from '../../ai/llm/providers';
import { testConnection } from '../../ai/llm/client';

type Field = 'key' | 'model' | 'baseUrl';
type Drafts = Record<Field, Partial<Record<ProviderId, string>>>;

/**
 * Pick an AI service (free ones first), add its key and connect. Edits stay drafts until the
 * connection test passes, so a half-typed key never switches the copilot over.
 */
export function ProviderSetup() {
  const saved = useSettings();
  const copilot = useAI((s) => s.copilot);
  const [id, setId] = useState<ProviderId>(saved.aiProvider);
  const [drafts, setDrafts] = useState<Drafts>(() => ({
    key: { ...saved.aiKeys },
    model: { ...saved.aiModels },
    baseUrl: { ...saved.aiBaseUrls },
  }));
  const [models, setModels] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const p = providerInfo(id);
  const draft = (f: Field) => drafts[f][id] ?? '';
  const edit = (f: Field, v: string) => {
    setDrafts((d) => ({ ...d, [f]: { ...d[f], [id]: v } }));
    setResult(null);
  };
  const inUse = copilot.state === 'ready' && copilot.via === 'byok' && saved.aiProvider === id;

  const connect = async () => {
    const conn = {
      provider: id,
      apiKey: draft('key').trim(),
      model: draft('model').trim() || p.defaultModel,
      baseUrl: draft('baseUrl').trim() || p.baseUrl,
    };
    setTesting(true);
    setResult(null);
    const r = await testConnection(conn);
    setTesting(false);
    setResult(r);
    if (r.models.length) setModels((m) => ({ ...m, [id]: r.models }));
    if (!r.ok) return;
    const s = useSettings.getState();
    s.set({
      aiProvider: id,
      aiKeys: { ...s.aiKeys, [id]: conn.apiKey },
      aiModels: { ...s.aiModels, [id]: draft('model').trim() },
      aiBaseUrls: { ...s.aiBaseUrls, [id]: draft('baseUrl').trim() },
      aiMode: s.aiMode === 'off' || s.aiMode === 'server' ? 'auto' : s.aiMode,
    });
  };

  const forget = () => {
    const s = useSettings.getState();
    s.set({ aiKeys: { ...s.aiKeys, [id]: '' } });
    edit('key', '');
  };

  const suggestions = models[id]?.length ? models[id]! : p.models;

  return (
    <div className="provider-setup">
      <div className="provider-grid">
        <div className="provider-list" role="radiogroup" aria-label="AI service">
          {PROVIDERS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={x.id === id}
              className={`provider ${x.id === id ? 'is-on' : ''}`}
              onClick={() => {
                setId(x.id);
                setResult(null);
              }}
            >
              <b>{x.label}</b>
              <span className={x.free ? 'provider-free' : 'faint'}>
                {saved.aiProvider === x.id && copilot.state === 'ready' && copilot.via === 'byok'
                  ? 'Connected'
                  : x.free
                    ? 'Free'
                    : x.id === 'custom'
                      ? 'Any service'
                      : 'Paid'}
              </span>
            </button>
          ))}
        </div>

        <div className="provider-detail">
          {p.free && <p className="provider-what">{p.free}</p>}
          <ol className="setup-steps">
            {p.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {p.keyUrl && (
            <a href={p.keyUrl} target="_blank" rel="noreferrer noopener" className="key-link">
              {!p.needsKey ? 'Download Ollama →' : p.free ? 'Get a free key →' : 'Get a key →'}
            </a>
          )}

          {(id === 'ollama' || id === 'custom') && (
            <label className="field">
              <span className="label">Address</span>
              <input
                className="input"
                value={draft('baseUrl')}
                placeholder={p.baseUrl || 'https://example.com/v1'}
                onChange={(e) => edit('baseUrl', e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          )}
          {(p.needsKey || id === 'custom') && (
            <label className="field">
              <span className="label">{p.needsKey ? `${p.short} API key` : 'API key (if it needs one)'}</span>
              <span className="field-row">
                <input
                  className="input"
                  type="password"
                  value={draft('key')}
                  placeholder={p.keyHint ?? ''}
                  onChange={(e) => edit('key', e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                {saved.aiKeys[id] && (
                  <button type="button" className="chip" onClick={forget} title="Remove the saved key">
                    Forget
                  </button>
                )}
              </span>
            </label>
          )}
          <label className="field">
            <span className="label">Model</span>
            {p.kind === 'anthropic' ? (
              <select
                className="select"
                value={draft('model') || p.defaultModel}
                onChange={(e) => edit('model', e.target.value)}
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  className="input"
                  list={`ai-models-${id}`}
                  value={draft('model')}
                  placeholder={p.defaultModel || 'model name'}
                  onChange={(e) => edit('model', e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <datalist id={`ai-models-${id}`}>
                  {suggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </label>

          <div className="provider-actions">
            <button
              type="button"
              className="btn btn-ai btn-m"
              onClick={() => void connect()}
              disabled={testing}
            >
              {testing && <span className="spinner" />} {inUse ? 'Save & reconnect' : 'Connect'}
            </button>
            {result && (
              <span className={`provider-result ${result.ok ? 'is-ok' : 'is-err'}`} role="status">
                {result.message}
              </span>
            )}
          </div>
          {p.note && <p className="faint small">{p.note}</p>}
          {(p.needsKey || id === 'custom') && (
            <p className="faint small">Your key is saved only in this browser and sent only to {p.label}.</p>
          )}
        </div>
      </div>
    </div>
  );
}
