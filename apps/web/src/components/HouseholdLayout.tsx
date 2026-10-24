import type { ReactNode } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Camera,
  History,
  House,
  Info,
  Leaf,
  Sparkles,
  Users,
} from 'lucide-react';

export type HouseholdTab = 'memory' | 'activity' | 'assistant' | 'camera';

export default function HouseholdLayout({
  children,
  tab,
  onTab,
  onHousehold,
  onAbout,
  memberName,
}: {
  children: ReactNode;
  tab: HouseholdTab;
  onTab?: (tab: HouseholdTab) => void;
  onHousehold?: () => void;
  onAbout?: () => void;
  memberName?: string;
}) {
  function navigate(next: HouseholdTab) {
    if (onTab) onTab(next);
    else
      window.location.assign(
        next === 'camera' ? '/camera' : next === 'memory' ? '/' : `/?view=${next}`,
      );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          aria-label="Commonplace home"
          onClick={(event) => {
            if (onTab) {
              event.preventDefault();
              onTab('memory');
            }
          }}
        >
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
            <small>Our shared space</small>
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
            className={tab === 'camera' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('camera')}
          >
            <Camera size={19} />
            Camera
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
            className={tab === 'assistant' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('assistant')}
          >
            <Sparkles size={19} />
            Ask Muse
          </button>
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
              <strong>{memberName ?? 'Join as a guest'}</strong>
              <small>Guest · no password</small>
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
                : tab === 'camera'
                  ? 'Camera'
                  : tab === 'assistant'
                    ? 'Ask Muse'
                    : 'Recent activity'}
            </strong>
          </div>
          <button
            className="people-button"
            onClick={onHousehold}
            disabled={!onHousehold}
            aria-label="Open guest household settings"
          >
            <span className="avatar avatar-pree">{memberName?.[0] ?? <Users size={16} />}</span>
            <span className="people-label">Better together</span>
          </button>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
