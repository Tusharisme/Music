import { useUI, type MobileTab } from '../../state/ui';
import { useAI } from '../../state/ai';
import { useDecks } from '../../state/decks';
import { Icon } from '../Icon';

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'decks', label: 'Decks', icon: 'disc' },
  { id: 'mixer', label: 'Mixer', icon: 'sliders' },
  { id: 'library', label: 'Library', icon: 'list' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
];

export function MobileNav() {
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const mixing = useAI((s) => s.mix.phase !== 'idle');
  const playing = useDecks((s) => s.decks.some((d) => d.playing));
  return (
    <nav className="mobile-nav" aria-label="Sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={tab === t.id ? 'is-on' : ''}
          onClick={() => setTab(t.id)}
          aria-current={tab === t.id ? 'page' : undefined}
        >
          <Icon name={t.icon} size={19} />
          <span>{t.label}</span>
          {t.id === 'ai' && mixing && <i className="nav-dot ai" />}
          {t.id === 'decks' && playing && <i className="nav-dot" />}
        </button>
      ))}
    </nav>
  );
}
