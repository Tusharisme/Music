import { useEffect, useRef, useState } from 'react';
import { useAI, type CopilotPicks } from '../../state/ai';
import { useLibrary } from '../../state/library';
import { useUI } from '../../state/ui';
import { useDecks } from '../../state/decks';
import { askForPicks, buildSetPlan, clearChat, sendChat, stopChat } from '../../ai/copilot';
import { aiMix } from '../../ai/autodj';
import { autoDj } from '../../ai/autodj';
import { loadTrack } from '../../controller/decks';
import { TECHNIQUES, type TechniqueId } from '../../ai/transitions';
import { Artwork } from '../Artwork';
import { KeyBadge } from '../KeyBadge';
import { Icon } from '../Icon';
import { RichText } from './RichText';
import { ProviderSetup } from './ProviderSetup';
import { providerInfo } from '../../ai/llm/providers';
import { trackBpm, trackKey } from '../../ai/recommender';

function searchLinks(title: string, artist: string) {
  const q = encodeURIComponent(`${artist} ${title}`);
  return [
    { label: 'YouTube', href: `https://www.youtube.com/results?search_query=${q}` },
    { label: 'Spotify', href: `https://open.spotify.com/search/${q}` },
    { label: 'Beatport', href: `https://www.beatport.com/search?q=${q}` },
    { label: 'SoundCloud', href: `https://soundcloud.com/search?q=${q}` },
  ];
}

function freeDeckIndex(): number {
  const { decks } = useDecks.getState();
  const playing = decks.findIndex((d) => d.playing);
  if (playing >= 0) return decks[1 - playing].playing ? -1 : 1 - playing;
  return decks[0].trackId ? 1 : 0;
}

function PicksView({ picks }: { picks: CopilotPicks }) {
  const tracks = useLibrary((s) => s.tracks);
  return (
    <div className="picks">
      {picks.picks.map((p) => {
        const t = tracks[p.trackId];
        if (!t) return null;
        const tech = (p.technique && p.technique in TECHNIQUES ? p.technique : undefined) as
          TechniqueId | undefined;
        return (
          <div key={p.trackId} className="pick">
            <div className="pick-head">
              <Artwork track={t} size={34} />
              <div className="pick-text">
                <strong className="truncate">{t.title}</strong>
                <span className="muted truncate">
                  {t.artist} · <span className="mono">{trackBpm(t).toFixed(1)}</span>
                </span>
              </div>
              <KeyBadge k={trackKey(t)} small />
            </div>
            <p className="pick-why">{p.why}</p>
            {p.tip && (
              <p className="pick-tip">
                <Icon name="bolt" size={11} /> {tech ? <b>{TECHNIQUES[tech].name}: </b> : null}
                {p.tip}
              </p>
            )}
            <div className="pick-actions">
              <button
                type="button"
                className="btn btn-default btn-s"
                onClick={() => freeDeckIndex() >= 0 && void loadTrack(freeDeckIndex(), t.id)}
              >
                Load
              </button>
              <button
                type="button"
                className="btn btn-ai btn-s"
                onClick={() => void aiMix(t.id, { technique: tech })}
              >
                <Icon name="sparkle" size={11} /> AI Mix{tech ? ` · ${TECHNIQUES[tech].name}` : ''}
              </button>
            </div>
          </div>
        );
      })}
      {picks.discover.length > 0 && (
        <div className="discover">
          <span className="label">New music to dig for</span>
          {picks.discover.map((d) => (
            <div key={`${d.artist}-${d.title}`} className="disc">
              <div className="disc-head">
                <Icon name="disc" size={14} />
                <strong className="truncate">
                  {d.artist} – {d.title}
                </strong>
                {d.bpm ? <span className="mono faint">{Math.round(d.bpm)} BPM</span> : null}
                {d.key ? <span className="mono faint">{d.key}</span> : null}
              </div>
              <p>{d.why}</p>
              {d.mixTip && <p className="faint">Mix tip: {d.mixTip}</p>}
              <div className="disc-links">
                {searchLinks(d.title, d.artist).map((l) => (
                  <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener">
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
          <p className="faint small">
            Suggestions come from the AI's knowledge – check BPM/key after importing.
          </p>
        </div>
      )}
    </div>
  );
}

function CopilotSetup() {
  const status = useAI((s) => s.copilot);
  return (
    <div className="copilot-setup">
      <div className="ai-hero">
        <span className="ai-orb is-big" aria-hidden />
        <div>
          <h3>Turn on the AI DJ chat – for free</h3>
          <p className="muted">
            Suggestions, AI Mix and Auto DJ work without a key. Connect a language model to chat with an AI
            DJ, plan sets and discover new songs. Gemini and Groq are free, no card needed.
          </p>
        </div>
      </div>
      <ProviderSetup />
      {status.reason && status.state === 'unavailable' && <p className="faint small">{status.reason}</p>}
    </div>
  );
}

const QUICK: { label: string; run: () => void }[] = [
  { label: 'What should I play next?', run: () => void askForPicks(undefined, false) },
  {
    label: 'Build the energy',
    run: () => void askForPicks('I want to build the energy now – what next and how do I get there?', false),
  },
  {
    label: 'Take it deeper',
    run: () => void askForPicks('Take it deeper and darker, but keep the groove.', false),
  },
  {
    label: 'Find new songs like this',
    run: () =>
      void askForPicks(
        'Suggest real songs I should add to my crate that would mix well after this one.',
        true,
      ),
  },
  {
    label: 'How do I mix A into B?',
    run: () =>
      void sendChat(
        'How should I mix the track on the playing deck into the one on the other deck? Give me bar-by-bar steps.',
      ),
  },
];

export function CopilotChat() {
  const chat = useAI((s) => s.chat);
  const busy = useAI((s) => s.chatBusy || s.picksBusy);
  const streaming = useAI((s) => s.chatBusy);
  const status = useAI((s) => s.copilot);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat]);

  if (status.state === 'checking') {
    return (
      <div className="copilot-setup">
        <span className="spinner" /> Checking the AI connection…
      </div>
    );
  }
  if (status.state !== 'ready') return <CopilotSetup />;

  return (
    <div className="copilot">
      <div className="chat" ref={listRef} aria-live="polite">
        {chat.length === 0 && (
          <div className="chat-empty">
            <span className="ai-orb is-big" aria-hidden />
            <p>
              Ask your AI DJ anything – what to play next, how to mix it, or which new tracks to dig for. It
              sees both decks, your library and what you have played.
              <span className="faint">
                {' '}
                ({status.provider ? providerInfo(status.provider).label : 'AI'}
                {status.via === 'server' ? ' via the MixMind server' : ''})
              </span>
            </p>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`msg msg-${m.role} ${m.error ? 'is-error' : ''}`}>
            {m.role === 'assistant' && !m.text && !m.picks ? (
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <RichText text={m.text} />
            )}
            {m.picks && <PicksView picks={m.picks} />}
          </div>
        ))}
      </div>
      <div className="quick">
        {QUICK.map((q) => (
          <button key={q.label} type="button" className="chip" disabled={busy} onClick={q.run}>
            {q.label}
          </button>
        ))}
        {chat.length > 0 && (
          <button type="button" className="chip" onClick={clearChat} disabled={busy}>
            Clear
          </button>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void sendChat(text);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask the AI DJ… e.g. “something funky around 120 BPM?”"
          aria-label="Message the AI DJ"
        />
        {streaming ? (
          <button type="button" className="btn btn-default btn-s" onClick={stopChat}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-ai btn-s"
            disabled={busy || !text.trim()}
            aria-label="Send"
          >
            <Icon name="send" size={13} />
          </button>
        )}
      </form>
    </div>
  );
}

export function SetPlanner() {
  const plan = useAI((s) => s.setPlan);
  const busy = useAI((s) => s.setPlanBusy);
  const status = useAI((s) => s.copilot);
  const tracks = useLibrary((s) => s.tracks);
  const toast = useUI((s) => s.toast);
  const [mins, setMins] = useState(30);
  const [vibe, setVibe] = useState('Warm-up that builds into peak time');
  if (status.state !== 'ready') return <CopilotSetup />;
  return (
    <div className="planner">
      <div className="planner-form">
        <label>
          <span className="label">Length</span>
          <select className="select" value={mins} onChange={(e) => setMins(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span className="label">Vibe / brief</span>
          <input
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="Sunset rooftop, deep → melodic, finish high"
          />
        </label>
        <button
          type="button"
          className="btn btn-ai btn-s"
          disabled={busy}
          onClick={() => void buildSetPlan(mins, vibe)}
        >
          {busy ? <span className="spinner" /> : <Icon name="sparkle" size={12} />} Plan my set
        </button>
      </div>
      {plan && (
        <div className="plan">
          <h4>{plan.title}</h4>
          <p className="muted">{plan.arc}</p>
          <ol>
            {plan.items.map((it, i) => {
              const t = tracks[it.trackId];
              if (!t) return null;
              return (
                <li key={it.trackId}>
                  <span className="mono faint">{String(i + 1).padStart(2, '0')}</span>
                  <Artwork track={t} size={28} />
                  <div className="plan-text">
                    <strong className="truncate">
                      {t.title} <span className="faint">– {t.artist}</span>
                    </strong>
                    <span className="muted">
                      {it.technique && it.technique in TECHNIQUES ? (
                        <b>{TECHNIQUES[it.technique as TechniqueId].name}: </b>
                      ) : null}
                      {it.note}
                    </span>
                  </div>
                  <KeyBadge k={trackKey(t)} small />
                </li>
              );
            })}
          </ol>
          <div className="plan-actions">
            <button
              type="button"
              className="btn btn-ai btn-s"
              onClick={() => {
                const ids = plan.items.map((x) => x.trackId).filter((id) => tracks[id]);
                const playing = useDecks
                  .getState()
                  .decks.filter((d) => d.playing)
                  .map((d) => d.trackId);
                useAI.getState().patch({ queue: ids.filter((id) => !playing.includes(id)) });
                toast('Set queued – start Auto DJ to play it.', 'success');
                if (!useAI.getState().autoDj) void autoDj.start();
              }}
            >
              <Icon name="robot" size={13} /> Play this set with Auto DJ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
