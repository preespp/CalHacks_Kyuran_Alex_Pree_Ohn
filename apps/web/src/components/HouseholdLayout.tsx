import type { ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  History,
  House,
  Info,
  Leaf,
  Sparkles,
  Users,
} from 'lucide-react';

export type HouseholdTab = 'memory' | 'activity' | 'assistant';

export default function HouseholdLayout({
  children,
  tab,
  onTab,
  onHousehold,
  onAbout,
  memberName,
  testMode = false,
}: {
  children: ReactNode;
  tab: HouseholdTab;
  onTab?: (tab: HouseholdTab) => void;
  onHousehold?: () => void;
  onAbout?: () => void;
  memberName?: string;
  testMode?: boolean;
}) {
  function navigate(next: HouseholdTab) {
    if (onTab) onTab(next);
    else window.location.assign(next === 'memory' ? '/' : `/?view=${next}`);
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Commonplace home">
          <span className="brand-icon">
            <House size={23} strokeWidth={1.7} />
          </span>
          <span>
            commonplace<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-context">A LITTLE SHARED MEMORY</div>
        <button className="home-switch" onClick={onHousehold} disabled={!onHousehold}>
          <span className="home-avatar">
            <Leaf size={21} />
          </span>
          <span>
            <strong>Our little home</strong>
            <small>{testMode ? 'Memory disconnected' : '3 people, one shared space'}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <nav aria-label="Main navigation">
          <button
            className={tab === 'memory' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('memory')}
          >
            <House size={19} />
            Our memory
            <ArrowRight size={15} className="nav-arrow" />
          </button>
          <button
            className={tab === 'activity' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('activity')}
          >
            <History size={19} />
            Recent activity
          </button>
          <button className="nav-item" onClick={onHousehold} disabled={!onHousehold}>
            <Users size={19} />
            Household
          </button>
          <button
            className={tab === 'assistant' && !testMode ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('assistant')}
          >
            <Sparkles size={19} />
            Ask Muse
          </button>
          <a
            className={testMode ? 'nav-item active' : 'nav-item'}
            href="/muse"
            aria-current={testMode ? 'page' : undefined}
          >
            <ArrowUpRight size={19} />
            Muse chat
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="note-spark">
            <Sparkles size={20} />
          </span>
          <p>
            Someone remembers.
            <br />
            <strong>Now everyone can.</strong>
          </p>
          <span>
            A place for the little things
            <br />
            you share along the way.
          </span>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={onAbout} disabled={!onAbout}>
            <Info size={18} />
            How it works
          </button>
          <div className="profile">
            <span className="avatar avatar-pree">{memberName?.[0] ?? '–'}</span>
            <span>
              <strong>{memberName ?? (testMode ? 'Test session' : 'Connecting…')}</strong>
              <small>{testMode ? 'No household sign-in' : 'Demo household member'}</small>
            </span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <House size={16} />
            <span>Our little home</span>
            <span className="breadcrumb-divider">/</span>
            <strong>
              {tab === 'memory'
                ? 'Our memory'
                : tab === 'assistant'
                  ? 'Ask Muse'
                  : 'Recent activity'}
            </strong>
          </div>
          <button
            className="people-button"
            onClick={onHousehold}
            disabled={!onHousehold}
            aria-label={
              testMode
                ? 'Household members unavailable in test mode'
                : 'View three household members'
            }
          >
            <span className="avatar avatar-alex">A</span>
            <span className="avatar avatar-pree">P</span>
            <span className="avatar avatar-kyuran">K</span>
            <span className="people-label">{testMode ? 'Test mode' : 'Better together'}</span>
          </button>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
