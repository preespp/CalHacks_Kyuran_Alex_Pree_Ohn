import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Camera,
  DoorOpen,
  House,
  History,
  Leaf,
  LoaderCircle,
  MapPin,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, timeAgo } from './api';
import CapturePanel from './components/CapturePanel';
import EvidenceImage from './components/EvidenceImage';
import Modal from './components/Modal';
import AssistantPanel from './components/AssistantPanel';
import GuestEntry from './components/GuestEntry';
import HouseholdLayout, { type HouseholdTab } from './components/HouseholdLayout';
import type { Health, MemoryObject, Observation, Session } from './types';

function loadSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('commonplace-guest-session') ?? 'null');
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
      : 'Location report';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<MemoryObject[]>([]);
  const [events, setEvents] = useState<Observation[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [room, setRoom] = useState('');
  const [tab, setTab] = useState<HouseholdTab>(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/camera') return 'camera';
    const view = new URLSearchParams(window.location.search).get('view');
    return view === 'assistant' || view === 'activity' ? view : 'memory';
  });
  useEffect(() => {
    const restore = () => {
      const view = new URLSearchParams(window.location.search).get('view');
      setTab(
        window.location.pathname.replace(/\/$/, '') === '/camera'
          ? 'camera'
          : view === 'assistant' || view === 'activity'
            ? view
            : 'memory',
      );
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  function navigate(next: HouseholdTab) {
    setTab(next);
    window.history.pushState(
      {},
      '',
      next === 'camera' ? '/camera' : next === 'memory' ? '/' : `/?view=${next}`,
    );
  }

  const [selected, setSelected] = useState<MemoryObject | null>(null);
  const [modal, setModal] = useState<'household' | 'about' | null>(null);
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
          setSelected((current) =>
            current ? (memory.objects.find((item) => item.id === current.id) ?? current) : null,
          );
          setEvents(activity.events);
          setHealth(status);
          setError('');
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setError(
            error instanceof ApiError && error.status === 404
              ? 'Your household is unavailable right now. Please try again shortly.'
              : error instanceof Error
                ? error.message
                : 'Could not load household memory.',
          );
          setLoading(false);
          if (error instanceof ApiError && error.status === 401) {
            sessionStorage.removeItem('commonplace-guest-session');
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

  async function joinGuest(name: string, userId?: string) {
    setSwitching(true);
    try {
      const next = await api<Session>('/api/guest/session', session?.token, {
        method: 'POST',
        body: JSON.stringify(userId ? { user_id: userId } : { name }),
      });
      sessionStorage.setItem('commonplace-guest-session', JSON.stringify(next));
      setItems([]);
      setEvents([]);
      setHealth(null);
      setSelected(null);
      setQuery('');
      setRoom('');
      setLoading(true);
      setSession(next);
      setModal(null);
      setError('');
      setToast(`Welcome, ${next.member.name}`);
    } finally {
      setSwitching(false);
    }
  }

  async function leaveGuest() {
    if (!session || switching) return;
    setSwitching(true);
    try {
      await api<void>('/api/guest/session', session.token, { method: 'DELETE' });
    } catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 401)) {
        setError(
          failure instanceof Error ? failure.message : 'Could not leave the session. Try again.',
        );
        setSwitching(false);
        setModal(null);
        return;
      }
    }
    sessionStorage.removeItem('commonplace-guest-session');
    setSession(null);
    setItems([]);
    setEvents([]);
    setHealth(null);
    setSelected(null);
    setModal(null);
    setError('');
    setToast('You left the guest session.');
    setSwitching(false);
  }

  return (
    <>
      <HouseholdLayout
        tab={tab}
        onTab={navigate}
        onHousehold={() => setModal('household')}
        onAbout={() => setModal('about')}
        memberName={session?.member.name}
      >
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span />
              LESS SEARCHING, MORE LIVING
            </div>
            <h1>
              {tab === 'memory'
                ? 'A home that remembers.'
                : tab === 'camera'
                  ? 'A view into our home.'
                  : tab === 'assistant'
                    ? 'Just ask your household.'
                    : 'Little updates. Shared.'}
            </h1>
            <p>
              {tab === 'memory'
                ? 'For the “where did we put that?” moments.'
                : tab === 'camera'
                  ? 'Look around your room and remember where things are.'
                  : tab === 'assistant'
                    ? 'Find the little things, with Muse and shared evidence.'
                    : 'The things your household has remembered along the way.'}
            </p>
          </div>
          {tab !== 'camera' && (
            <button
              className="primary-button"
              onClick={() => navigate('camera')}
              disabled={!session}
            >
              <Camera size={18} />
              Scan room
            </button>
          )}
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
          </div>
        )}

        {!session ? (
          <GuestEntry onJoin={joinGuest} onSelect={(id) => joinGuest('', id)} />
        ) : tab === 'memory' ? (
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
                  placeholder="Search remembered objects"
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
                <span>{items.length ? 'From your memory' : 'Your camera will add items here'}</span>
                {items.slice(0, 3).map((item) => (
                  <button key={item.id} onClick={() => setQuery(item.label)}>
                    {item.label}
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
                    <button className="object-card" key={item.id} onClick={() => setSelected(item)}>
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
                          <span>{sourceName(item.latest.source)}</span>
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
                  <h3>{search || room ? 'No stored match yet.' : 'No items remembered yet.'}</h3>
                  <p>
                    {search || room
                      ? 'Try a different name or scan the surface where you last saw it.'
                      : 'Turn on the camera and scan your room to start your shared memory.'}
                  </p>
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
        ) : tab === 'camera' || tab === 'assistant' ? null : (
          <section className="activity-section">
            <div className="section-heading">
              <div>
                <h2>Our household timeline</h2>
                <p>Camera observations and location history, shared with your household.</p>
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

        {session && health && (
          <div
            className={`persistent-media ${tab !== 'camera' && tab !== 'assistant' ? 'assistance-dock' : ''}`}
          >
            <section
              className={`camera-page ${tab === 'camera' ? '' : 'camera-summary'}`}
              aria-label="Household camera"
            >
              <CapturePanel
                key={session.token}
                token={session.token}
                health={health}
                compact={tab !== 'camera'}
                onSaved={() => setRevision((value) => value + 1)}
              />
            </section>
            <AssistantPanel
              key={session.token}
              token={session.token}
              health={health}
              compact={tab !== 'assistant'}
              onSelect={setSelected}
              onOpen={() => navigate('assistant')}
            />
          </div>
        )}

        <footer className="app-footer">
          <span className="footer-brand">
            <House size={14} />
            commonplace.
          </span>
          <span>© 2026 Commonplace · Built at Cal Hacks</span>
          <button onClick={() => setModal('about')}>
            How it works <ArrowUpRight size={12} />
          </button>
        </footer>
      </HouseholdLayout>

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal === 'household' && (
        <Modal title="Our little home" onClose={() => setModal(null)}>
          {session && (
            <p className="muted">
              You joined as <strong>{session.member.name}</strong>.
            </p>
          )}
          <GuestEntry
            onJoin={joinGuest}
            onSelect={(id) => joinGuest('', id)}
            currentUserId={session?.member.id}
            switching={!!session}
          />
          {session && (
            <button
              className="secondary-button"
              disabled={switching}
              onClick={() => void leaveGuest()}
            >
              Leave guest session
            </button>
          )}
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title="A little shared memory" onClose={() => setModal(null)}>
          <div className="about-steps">
            <div>
              <span>01</span>
              <p>
                <strong>Let your home remember.</strong> Point the camera around a room to remember
                visible objects and where they were last seen.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Find the little things.</strong> Search for an object and see its last-seen
                image evidence, location, and recorded time.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Share the same memory.</strong> Everyone can ask about the latest camera
                observations, without tracking who placed an item.
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
          <ObjectDetail item={selected} token={session.token} />
        </Modal>
      )}
    </>
  );
}

function Activity({ events, onSelect }: { events: Observation[]; onSelect: (id: string) => void }) {
  return (
    <div className="timeline">
      {events.length ? (
        events.map((event) => (
          <button key={event.id} className="timeline-row" onClick={() => onSelect(event.object_id)}>
            <span className="avatar">
              <Camera size={18} />
            </span>
            <span>
              <strong>{event.label}</strong>{' '}
              {event.kind === 'seen' ? 'last seen' : 'location updated'}
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

function ObjectDetail({ item, token }: { item: MemoryObject; token: string }) {
  const [history, setHistory] = useState<Observation[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const request = new AbortController();
    api<{ observations: Observation[] }>(`/api/objects/${item.id}/history`, token, {
      signal: request.signal,
    })
      .then((value) => {
        if (!request.signal.aborted) {
          setHistory(value.observations);
          setError('');
        }
      })
      .catch((failure) => {
        if (!request.signal.aborted) setError(failure.message);
      });
    return () => request.abort();
  }, [item.id, item.latest.id, token]);
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
            This earlier image shows the previous sighting. The latest location is a separate
            location report.
          </p>
        )}
        <p className="muted">{item.appearance}</p>
      </div>
      <div className="detail-content">
        <span className="mini-label">LAST RECORDED LOCATION</span>
        <h3>{item.latest.room}</h3>
        <p>{item.latest.location}</p>
        <p className="fine-print">
          {sourceName(item.latest.source)} · {new Date(item.latest.observed_at).toLocaleString()}
        </p>
        <p className="fine-print">
          Start a room scan to update visible objects automatically. This saved observation does not
          confirm that the object is still there.
        </p>
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
                {sourceName(event.source)} · {timeAgo(event.observed_at)}
              </small>
            </div>
          ))}
        </details>
      </div>
    </div>
  );
}
