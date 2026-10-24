import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  DoorOpen,
  History,
  House,
  Info,
  Leaf,
  LoaderCircle,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, timeAgo } from './api';
import CapturePanel from './components/CapturePanel';
import EvidenceImage from './components/EvidenceImage';
import Modal from './components/Modal';
import type { Health, MemoryObject, Observation, Profile, Session } from './types';

function loadSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('commonplace-session') ?? 'null');
    return value?.token && value?.member ? value : null;
  } catch {
    return null;
  }
}

function sourceName(source: Observation['source']) {
  return source === 'sample'
    ? 'Sample illustration'
    : source === 'gemini'
      ? 'Camera observation'
      : 'Member reported';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<MemoryObject[]>([]);
  const [events, setEvents] = useState<Observation[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [room, setRoom] = useState('');
  const [tab, setTab] = useState<'memory' | 'activity'>('memory');
  const [selected, setSelected] = useState<MemoryObject | null>(null);
  const [modal, setModal] = useState<'capture' | 'household' | 'about' | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (session) return;
    let cancelled = false;
    api<Session>('/api/demo/session', undefined, {
      method: 'POST',
      body: JSON.stringify({ profile: 'pree' }),
    })
      .then((value) => {
        if (!cancelled) {
          sessionStorage.setItem('commonplace-session', JSON.stringify(value));
          setSession(value);
          setError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, revision]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let running = false;
    const controller = new AbortController();
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const [memory, activity, status] = await Promise.all([
          api<{ objects: MemoryObject[] }>(
            `/api/objects?${new URLSearchParams({ q: search, room })}`,
            session!.token,
            { signal: controller.signal },
          ),
          api<{ events: Observation[] }>('/api/activity', session!.token, {
            signal: controller.signal,
          }),
          api<Health>('/api/health', undefined, { signal: controller.signal }),
        ]);
        if (!cancelled) {
          setItems(memory.objects);
          setEvents(activity.events);
          setHealth(status);
          setError('');
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Could not load household memory.');
          setLoading(false);
          if (error instanceof ApiError && error.status === 401) {
            sessionStorage.removeItem('commonplace-session');
            setSession(null);
          }
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [session, search, room, revision]);

  async function changeProfile(profile: Profile) {
    setSwitching(true);
    try {
      const next = await api<Session>('/api/demo/session', undefined, {
        method: 'POST',
        body: JSON.stringify({ profile }),
      });
      sessionStorage.setItem('commonplace-session', JSON.stringify(next));
      setSession(next);
      setSelected(null);
      setError('');
      setToast(`Now viewing as ${next.member.name}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not switch profile.');
    } finally {
      setSwitching(false);
    }
  }

  function saved(message: string) {
    setRevision((value) => value + 1);
    setToast(message);
  }

  return (
    <div className="app-shell">
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
        <button className="home-switch" onClick={() => setModal('household')}>
          <span className="home-avatar">
            <Leaf size={21} />
          </span>
          <span>
            <strong>Our little home</strong>
            <small>3 people, one shared space</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <nav aria-label="Main navigation">
          <button
            className={tab === 'memory' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('memory')}
          >
            <House size={19} />
            Our memory
            <ArrowRight size={15} className="nav-arrow" />
          </button>
          <button
            className={tab === 'activity' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('activity')}
          >
            <History size={19} />
            Recent activity
          </button>
          <button className="nav-item" onClick={() => setModal('household')}>
            <Users size={19} />
            Household
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
          <button className="nav-item" onClick={() => setModal('about')}>
            <Info size={18} />
            How it works
          </button>
          <div className="profile">
            <span className="avatar avatar-pree">{session?.member.name[0] ?? 'P'}</span>
            <span>
              <strong>{session?.member.name ?? 'Connecting…'}</strong>
              <small>Demo household member</small>
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
            <strong>{tab === 'memory' ? 'Our memory' : 'Recent activity'}</strong>
          </div>
          <button
            className="people-button"
            onClick={() => setModal('household')}
            aria-label="View three household members"
          >
            <span className="avatar avatar-alex">A</span>
            <span className="avatar avatar-pree">P</span>
            <span className="avatar avatar-kyuran">K</span>
            <span className="people-label">Better together</span>
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                LESS SEARCHING, MORE LIVING
              </div>
              <h1>{tab === 'memory' ? 'A home that remembers.' : 'Little updates. Shared.'}</h1>
              <p>
                {tab === 'memory'
                  ? 'For the “where did we put that?” moments.'
                  : 'The things your household has remembered along the way.'}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => setModal('capture')}
              disabled={!session}
            >
              <Plus size={18} />
              Remember something
            </button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
            </div>
          )}

          {tab === 'memory' ? (
            <>
              <section className="search-card" aria-label="Search household memory">
                <div className="search-card-copy">
                  <span className="mini-label">
                    <Sparkles size={15} />
                    YOUR HOUSEHOLD'S COLLECTIVE MEMORY
                  </span>
                  <h2>What are you looking for?</h2>
                  <p>If one of us has seen it, we can help you find it.</p>
                </div>
                <div className="search-input-wrap">
                  <Search size={22} />
                  <input
                    aria-label="Search objects"
                    placeholder="Try “HDMI adapter” or “blue water bottle”"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      onClick={() => setQuery('')}
                      aria-label="Clear search"
                    >
                      <X size={17} />
                    </button>
                  )}
                  <span className="search-enter">
                    <ArrowDownLeft size={17} />
                  </span>
                </div>
                <div className="search-suggestions">
                  <span>A little inspiration</span>
                  {['House keys', 'HDMI adapter', 'Blue water bottle'].map((label) => (
                    <button key={label} onClick={() => setQuery(label)}>
                      {label}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
                <div className="search-decoration" aria-hidden="true">
                  <div className="decor-ring" />
                  <Leaf size={72} strokeWidth={0.8} />
                  <span>home, held together</span>
                </div>
              </section>

              <section className="memory-section" aria-labelledby="memory-title">
                <div className="section-heading">
                  <div>
                    <h2 id="memory-title">
                      {search ? 'What we remember' : 'Around our home'}
                      <span className="count-badge">{items.length}</span>
                    </h2>
                    <p>Little things, with a place in our shared memory.</p>
                  </div>
                  <label className="room-filter">
                    <DoorOpen size={16} />
                    <select
                      aria-label="Filter by room"
                      value={room}
                      onChange={(event) => setRoom(event.target.value)}
                    >
                      <option value="">All rooms</option>
                      {['Living room', 'Kitchen', 'Bedroom', 'Office', 'Entryway'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {loading ? (
                  <div className="empty-state">
                    <LoaderCircle size={26} className="spin" />
                    <p>Opening our memory…</p>
                  </div>
                ) : items.length ? (
                  <div className="object-grid">
                    {items.map((item) => (
                      <button
                        className="object-card"
                        key={item.id}
                        onClick={() => setSelected(item)}
                      >
                        <div className="card-image">
                          <EvidenceImage
                            observation={item.last_visual}
                            token={session!.token}
                            highlight
                          />
                          <span
                            className={`source-pill ${item.latest.source === 'reported' ? 'reported' : ''}`}
                          >
                            {sourceName(item.latest.source)}
                          </span>
                          <span className="card-open">
                            <ArrowUpRight size={19} />
                          </span>
                        </div>
                        <div className="card-body">
                          <div className="card-title">
                            <h3>{item.label}</h3>
                            <span className="small-dot" />
                          </div>
                          <p className="card-location">
                            <MapPin size={14} />
                            {item.latest.room}
                          </p>
                          <p className="object-location">{item.latest.location}</p>
                          <div className="card-footer">
                            <span
                              className={`avatar avatar-${item.latest.actor_name.toLowerCase()}`}
                            >
                              {item.latest.actor_name[0]}
                            </span>
                            <span>
                              {item.latest.actor_name}{' '}
                              {item.latest.source === 'reported' ? 'reported' : 'remembered'}
                            </span>
                            <span className="card-time">
                              <Clock3 size={11} />
                              {timeAgo(item.latest.observed_at)}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Search size={29} />
                    <h3>No stored match yet.</h3>
                    <p>Try a different name or scan the surface where you last saw it.</p>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setQuery('');
                        setRoom('');
                      }}
                    >
                      Show all memories
                    </button>
                  </div>
                )}
              </section>
              <div className="bottom-note">
                <span>
                  <Users size={18} />A little less “have you seen my…?”
                </span>
                <span>Shared with care. Remembered together.</span>
              </div>
            </>
          ) : (
            <section className="activity-section">
              <div className="section-heading">
                <div>
                  <h2>Our household timeline</h2>
                  <p>Photo observations and member reports, kept as separate evidence.</p>
                </div>
              </div>
              <Activity
                events={events}
                onSelect={(id) => {
                  const found = items.find((item) => item.id === id);
                  if (found) setSelected(found);
                  else {
                    setQuery('');
                    setRoom('');
                    setTab('memory');
                  }
                }}
              />
            </section>
          )}

          <footer className="app-footer">
            <span className="footer-brand">
              <House size={14} />
              commonplace.
            </span>
            <span>
              {health?.vision_provider === 'gemini' ? 'Gemini photo analysis' : 'Sample data'} ·
              Shared updates every 5 seconds
            </span>
            <button onClick={() => setModal('about')}>
              Hackathon starter <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal === 'capture' && session && (
        <Modal title="Remember a little more" onClose={() => setModal(null)}>
          <CapturePanel
            token={session.token}
            health={health}
            onSaved={() => {
              setModal(null);
              setQuery('');
              setRoom('');
              setTab('memory');
              saved('A new observation was added to our memory.');
            }}
          />
        </Modal>
      )}
      {modal === 'household' && (
        <Modal title="Our little home" onClose={() => setModal(null)}>
          <p className="muted">Three people. One place to remember together.</p>
          <div className="notice">
            <strong>Demo profiles</strong>
            <p>
              Choose a person to try the shared-memory flow. These are development identities, not
              real sign-in accounts.
            </p>
          </div>
          <div className="member-list">
            {(['alex', 'pree', 'kyuran'] as Profile[]).map((profile) => (
              <button
                key={profile}
                disabled={switching}
                className="member-row"
                aria-label={`View as ${profile[0].toUpperCase() + profile.slice(1)}`}
                aria-pressed={session?.member.id === profile}
                onClick={() => void changeProfile(profile)}
              >
                <span className={`avatar avatar-${profile}`}>{profile[0].toUpperCase()}</span>
                <span>
                  <strong>{profile[0].toUpperCase() + profile.slice(1)}</strong>
                  <small>
                    {session?.member.id === profile
                      ? 'You are viewing as this person'
                      : 'Switch to this demo profile'}
                  </small>
                </span>
                {session?.member.id === profile && <Check size={18} />}
              </button>
            ))}
          </div>
          <p className="fine-print">
            Open this app in a second browser tab or on another device using the same backend.
            Choose another profile and try updating an item's location.
          </p>
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title="A little shared memory" onClose={() => setModal(null)}>
          <div className="about-steps">
            <div>
              <span>01</span>
              <p>
                <strong>Remember a scene.</strong> Take a deliberate photo of a shared surface.
                Gemini can describe the clearly visible objects.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Find the little things.</strong> Search for an object and see its last-seen
                evidence, location, and contributor.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Keep each other in the loop.</strong> Report when you move or find
                something. Everyone can see the update.
              </p>
            </div>
          </div>
          <div className="notice">
            <strong>Evidence makes a memory useful.</strong>
            <p>
              Sample illustrations are labeled. A photograph shows what was visible at that time. A
              household report records what someone told us. Objects can move between updates.
            </p>
          </div>
        </Modal>
      )}
      {selected && session && (
        <Modal title={selected.label} wide onClose={() => setSelected(null)}>
          <ObjectDetail
            item={selected}
            token={session.token}
            onSaved={(updated) => {
              setSelected(updated);
              saved('Your household can see the update.');
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Activity({ events, onSelect }: { events: Observation[]; onSelect: (id: string) => void }) {
  return (
    <div className="timeline">
      {events.length ? (
        events.map((event) => (
          <button key={event.id} className="timeline-row" onClick={() => onSelect(event.object_id)}>
            <span className={`avatar avatar-${event.actor_name.toLowerCase()}`}>
              {event.actor_name[0]}
            </span>
            <span>
              <strong>{event.actor_name}</strong>{' '}
              {event.kind === 'seen'
                ? 'remembered'
                : event.kind === 'moved'
                  ? 'moved'
                  : event.kind === 'found'
                    ? 'found'
                    : 'corrected'}{' '}
              <strong>{event.label}</strong>
              <small>
                {event.room} · {event.location}
              </small>
              <small className="timeline-source">{sourceName(event.source)}</small>
            </span>
            <time dateTime={event.observed_at}>{timeAgo(event.observed_at)}</time>
          </button>
        ))
      ) : (
        <div className="empty-state">
          <History size={25} />
          <p>No activity yet.</p>
        </div>
      )}
    </div>
  );
}

function ObjectDetail({
  item,
  token,
  onSaved,
}: {
  item: MemoryObject;
  token: string;
  onSaved: (item: MemoryObject) => void;
}) {
  const [history, setHistory] = useState<Observation[]>([]);
  const [room, setRoom] = useState(item.latest.room);
  const [location, setLocation] = useState(item.latest.location);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<{ observations: Observation[] }>(`/api/objects/${item.id}/history`, token)
      .then((value) => {
        if (!cancelled) setHistory(value.observations);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.latest.id, token]);
  async function report(kind: 'moved' | 'found') {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ observations: Observation[] }>(
        `/api/objects/${item.id}/notes`,
        token,
        { method: 'POST', body: JSON.stringify({ room, location, kind }) },
      );
      setHistory(result.observations);
      onSaved({ ...item, latest: result.observations[0] });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the update.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="object-detail">
      <div className="detail-evidence">
        <EvidenceImage observation={item.last_visual} token={token} highlight />
        <div className="evidence-caption">
          <span>
            {item.last_visual ? sourceName(item.last_visual.source) : 'No visual evidence'}
          </span>
          <span>{item.last_visual && timeAgo(item.last_visual.observed_at)}</span>
        </div>
        {item.latest.source === 'reported' && (
          <p className="fine-print">
            This earlier image shows the previous sighting. The latest location below was reported
            by a household member.
          </p>
        )}
        <p className="muted">{item.appearance}</p>
      </div>
      <div className="detail-content">
        <span className="mini-label">
          {item.latest.source === 'reported' ? 'LATEST REPORTED LOCATION' : 'LAST SEEN'}
        </span>
        <h3>{item.latest.room}</h3>
        <p>{item.latest.location}</p>
        <p className="fine-print">
          {item.latest.actor_name} · {new Date(item.latest.observed_at).toLocaleString()}
        </p>
        <hr />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void report('moved');
          }}
        >
          <h4>Keep everyone in the loop</h4>
          <label className="field-label">
            Room
            <select value={room} onChange={(event) => setRoom(event.target.value)}>
              {[
                'Living room',
                'Kitchen',
                'Bedroom',
                'Office',
                'Entryway',
                ...(!['Living room', 'Kitchen', 'Bedroom', 'Office', 'Entryway'].includes(room)
                  ? [room]
                  : []),
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Where is it now?
            <input
              required
              maxLength={300}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
          <div className="detail-actions">
            <button className="primary-button" disabled={busy || !location.trim()} type="submit">
              {busy ? <LoaderCircle className="spin" size={16} /> : <MapPin size={16} />}Update
              location
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !location.trim()}
              onClick={() => void report('found')}
            >
              <Check size={16} />
              Found it
            </button>
          </div>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <details className="history-details">
          <summary>Observation history ({history.length})</summary>
          {history.map((event) => (
            <div key={event.id} className="history-entry">
              <strong>{event.room}</strong>
              <span>{event.location}</span>
              <small>
                {sourceName(event.source)} · {event.actor_name} · {timeAgo(event.observed_at)}
              </small>
            </div>
          ))}
        </details>
      </div>
    </div>
  );
}
