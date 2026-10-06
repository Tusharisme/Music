import { useState } from 'react';
import { useUI, type BottomTab } from './state/ui';
import { useMediaQuery, useIsMobile } from './hooks/useMediaQuery';
import { TopBar } from './components/layout/TopBar';
import { Toasts } from './components/layout/Toasts';
import { MobileNav } from './components/layout/MobileNav';
import { WaveformStack } from './components/waveform/WaveformStack';
import { DeckPanel, MobileDeck } from './components/deck/DeckPanel';
import { Crossfader, Mixer } from './components/mixer/Mixer';
import { LibraryPanel } from './components/library/LibraryPanel';
import { AIPanel } from './components/ai/AIPanel';
import { HistoryPanel } from './components/history/HistoryPanel';
import { SettingsModal } from './components/modals/SettingsModal';
import { HelpModal } from './components/modals/HelpModal';
import { TrackModal } from './components/modals/TrackModal';
import { WelcomeModal } from './components/modals/WelcomeModal';
import { useAI } from './state/ai';

function Modals() {
  const modal = useUI((s) => s.modal);
  if (modal === 'settings') return <SettingsModal />;
  if (modal === 'help') return <HelpModal />;
  if (modal === 'track') return <TrackModal />;
  if (modal === 'welcome') return <WelcomeModal />;
  return null;
}

function BottomTabs({ tabs }: { tabs: BottomTab[] }) {
  const [tab, setTab] = useState<BottomTab>(tabs[0]);
  const mixing = useAI((s) => s.mix.phase !== 'idle');
  const labels: Record<BottomTab, string> = { library: 'Library', ai: 'AI Copilot', history: 'History' };
  const current = tabs.includes(tab) ? tab : tabs[0];
  return (
    <section className="panel bottom-panel">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={current === t}
            className={current === t ? 'is-on' : ''}
            onClick={() => setTab(t)}
          >
            {labels[t]}
            {t === 'ai' && mixing && <span className="dot is-ai" />}
          </button>
        ))}
      </div>
      <div className="bottom-body">
        {current === 'library' && <LibraryPanel />}
        {current === 'ai' && <AIPanel />}
        {current === 'history' && <HistoryPanel />}
      </div>
    </section>
  );
}

function MobileApp() {
  const tab = useUI((s) => s.tab);
  return (
    <div className="app is-mobile">
      <TopBar />
      <WaveformStack compact />
      <main className="mobile-view">
        {tab === 'decks' && (
          <div className="mobile-decks">
            <MobileDeck deck={0} />
            <section className="panel mobile-xf">
              <Crossfader compact />
            </section>
            <MobileDeck deck={1} />
          </div>
        )}
        {tab === 'mixer' && <Mixer />}
        {tab === 'library' && (
          <section className="panel mobile-fill">
            <LibraryPanel />
          </section>
        )}
        {tab === 'ai' && (
          <section className="panel mobile-fill">
            <AIPanel />
          </section>
        )}
      </main>
      <MobileNav />
      <Modals />
      <Toasts />
    </div>
  );
}

export default function App() {
  const mobile = useIsMobile();
  const wide = useMediaQuery('(min-width: 1360px)');
  if (mobile) return <MobileApp />;
  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        <WaveformStack />
        <div className="console">
          <DeckPanel deck={0} />
          <Mixer />
          <DeckPanel deck={1} />
        </div>
        <div className={`bottom ${wide ? 'is-split' : ''}`}>
          {wide ? (
            <>
              <BottomTabs tabs={['library', 'history']} />
              <section className="panel bottom-panel ai-side">
                <AIPanel />
              </section>
            </>
          ) : (
            <BottomTabs tabs={['library', 'ai', 'history']} />
          )}
        </div>
      </main>
      <Modals />
      <Toasts />
    </div>
  );
}
